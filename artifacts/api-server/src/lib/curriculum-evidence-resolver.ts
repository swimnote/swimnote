/**
 * curriculum-evidence-resolver.ts — Manual Diary Evidence Resolver
 *
 * 설계 원칙:
 *   - Manual Diary (curriculum_matches 없음) → 기존 AI Engine searchCurriculumForDiary() 재사용
 *     → growth_events INSERT (source='teacher_manual')
 *     → 기존 CPO/SCP downstream 진입 (AI Diary와 동일)
 *
 *   - AI Diary (curriculum_matches 이미 존재) → 이 모듈 스킵 (기존 insertGrowthEvents() 경로)
 *
 *   - 기존 AI Diary generate / MatchToken / insertGrowthEvents() 경로 완전 보존.
 *
 *   - Evidence 우선순위:
 *     1. AI curriculum_matches (이미 처리됨 — 여기서 재처리 안 함)
 *     2. Manual Diary note_content → searchCurriculumForDiary() 자동 매핑
 *
 *   - fail-safe: diary TX 외부, 실패해도 일지 저장에 영향 없음
 *   - DB write 없이 dry-run 모드 지원 (backfill dry-run용)
 *   - negative evidence 사전 필터: 명백한 부정 문맥은 growth_event 미생성
 */

import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";
import {
  searchCurriculumForDiary,
  getActiveCurriculumVersion,
} from "./curriculum-diary-service.js";
import { extractMeaning } from "./diary-parser.js";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ManualEvidenceNote {
  /** class_diary_student_notes.id */
  noteId: string;
  /** students.id */
  studentId: string;
  /** 일지 본문 */
  noteContent: string;
}

export interface ResolveManualEvidenceParams {
  /** drizzle db (TX 외부) */
  db: any;
  /** swimming_pools.id */
  poolId: string;
  /** class_diaries.id */
  diaryId: string;
  /** 저장된 학생 개인 노트 목록 (note_content 포함) */
  notes: ManualEvidenceNote[];
  /**
   * dry-run=true이면 growth_events INSERT 없이 예상 결과만 반환.
   * backfill dry-run 전용.
   */
  dryRun?: boolean;
}

export interface ResolveManualEvidenceResult {
  /** 처리된 노트 수 */
  notesProcessed: number;
  /** growth_events INSERT 성공 수 */
  growthEventsInserted: number;
  /** 스킵된 노트 수 (내용 부족, 부정 문맥, 후보 없음 등) */
  skipped: number;
  /** 스킵 사유 목록 (로깅용) */
  skipReasons: string[];
  /** dry-run용: 후보 매핑 결과 목록 */
  dryRunCandidates?: Array<{
    studentId: string;
    noteId: string;
    curriculumItemId: string;
    curriculumItemTitle: string;
    curriculumVersionId: string;
    score: number;
    mapped: boolean;
  }>;
}

// ── 부정 evidence 사전 필터 ──────────────────────────────────────────────────
//
// 명백히 "못함/실패" 수준의 텍스트에 growth_event 생성 안 함.
// 세밀한 분류(FUTURE_PLAN/PAST_REFERENCE 등)는 CPO mapper의 evidence-classifier가 처리.

const STRONG_NEGATIVE_PATTERNS: RegExp[] = [
  /못\s*(했|함|하겠|하겠어요|하는)/,
  /안\s*됨/,
  /실패\s*(했|함)/,
  /전혀\s*(못|안)/,
  /잘\s*못함/,
  /하기\s*싫어/,
  /거부/,
  /참여\s*(안|거부|못)/,
  /결석/,
];

/**
 * 명백한 부정 문맥 여부 판별.
 * true → growth_event 생성 안 함.
 */
function isStronglyNegative(text: string): boolean {
  return STRONG_NEGATIVE_PATTERNS.some((p) => p.test(text));
}

/**
 * 최소 유효 텍스트 길이 (글자 수).
 * 너무 짧으면 의미 추출 불가.
 */
const MIN_NOTE_LENGTH = 6;

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

/**
 * Manual Diary 저장 후 evidence 자동 해석 + growth_events 삽입.
 *
 * AI Diary의 curriculum_matches가 이미 있는 경우 이 함수를 호출하지 말 것.
 */
export async function resolveManualDiaryEvidence(
  params: ResolveManualEvidenceParams
): Promise<ResolveManualEvidenceResult> {
  const { db, poolId, diaryId, notes, dryRun = false } = params;

  const result: ResolveManualEvidenceResult = {
    notesProcessed: 0,
    growthEventsInserted: 0,
    skipped: 0,
    skipReasons: [],
    dryRunCandidates: dryRun ? [] : undefined,
  };

  // 1. Active curriculum version 확인 (없으면 조기 반환)
  const version = await getActiveCurriculumVersion(poolId);
  if (!version) {
    result.skipReasons.push(`pool=${poolId} has no ACTIVE curriculum version — skipping all notes`);
    result.skipped = notes.length;
    return result;
  }

  for (const note of notes) {
    result.notesProcessed++;
    const { noteId, studentId, noteContent } = note;

    // 2. 최소 길이 필터
    const trimmed = noteContent?.trim() ?? "";
    if (trimmed.length < MIN_NOTE_LENGTH) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=TOO_SHORT(${trimmed.length})`);
      continue;
    }

    // 3. 부정 문맥 사전 필터
    if (isStronglyNegative(trimmed)) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=STRONG_NEGATIVE`);
      continue;
    }

    // 4. 의미 추출 → curriculum 검색
    const meaning = extractMeaning(trimmed);
    let searchResult;
    try {
      searchResult = await searchCurriculumForDiary(poolId, meaning);
    } catch (e: any) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=SEARCH_ERROR(${e.message})`);
      continue;
    }

    if (!searchResult.usedTemplates || searchResult.usedTemplates.length === 0) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=NO_CANDIDATES`);
      continue;
    }

    // 5. 상위 후보 1개만 사용 (top-1: 가장 confidence 높은 item)
    //    Multi-item growth_event는 rank 계산 복잡성 증가 → 단일 evidence 원칙
    const top = searchResult.usedTemplates[0]!;
    const curriculumItemId    = top.level_id;   // curriculum_items.id
    const curriculumVersionId = version.id;
    const confidence          = Math.min(1, Math.max(0, top.score ?? 0));

    if (dryRun) {
      result.dryRunCandidates!.push({
        studentId,
        noteId,
        curriculumItemId,
        curriculumItemTitle: top.template_text?.slice(0, 80) ?? top.level_name ?? "",
        curriculumVersionId,
        score: top.score,
        mapped: true,
      });
      result.growthEventsInserted++;
      continue;
    }

    // 6. growth_events INSERT (source='teacher_manual', match_token_id=NULL)
    //    ON CONFLICT DO NOTHING: uq_growth_events_per_note
    //      (diary_note_id, student_id, curriculum_item_id, source)
    //      WHERE diary_note_id IS NOT NULL AND is_invalidated = false
    try {
      const insertRes = await db.execute(sql`
        INSERT INTO growth_events (
          student_id,
          swimming_pool_id,
          curriculum_item_id,
          curriculum_version_id,
          diary_note_id,
          source,
          match_token_id,
          growth_match_status,
          confidence,
          matching_algorithm_version,
          evidence_text,
          evidence_source_type,
          contract_version,
          request_id
        ) VALUES (
          ${studentId},
          ${poolId},
          ${curriculumItemId},
          ${curriculumVersionId},
          ${noteId},
          'teacher_manual',
          NULL,
          'PENDING_REVIEW',
          ${confidence},
          'diary_text_search_v1',
          ${trimmed.slice(0, 500)},
          'diary_note',
          NULL,
          ${diaryId}
        )
        ON CONFLICT (diary_note_id, student_id, curriculum_item_id, source)
          WHERE diary_note_id IS NOT NULL AND is_invalidated = false
        DO NOTHING
      `);

      const rowCount = (insertRes as any).rowCount ?? 0;
      if (rowCount > 0) {
        result.growthEventsInserted++;
        console.log(
          `[manual-resolver] INSERTED diary=${diaryId} note=${noteId}` +
          ` student=${studentId} item=${curriculumItemId} confidence=${confidence.toFixed(3)}`
        );
      } else {
        result.skipped++;
        result.skipReasons.push(`note=${noteId} skip=CONFLICT_DUPLICATE`);
      }
    } catch (e: any) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} skip=INSERT_ERROR(${e.message?.slice(0, 80)})`);
      console.error(`[manual-resolver] INSERT_ERROR diary=${diaryId} note=${noteId}`, e.message);
    }
  }

  return result;
}
