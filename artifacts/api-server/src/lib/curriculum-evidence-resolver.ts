/**
 * curriculum-evidence-resolver.ts — Manual Diary Evidence Resolver
 *
 * 설계 원칙:
 *   - Manual Diary (curriculum_matches 없음) → searchCurriculumForDiary() 재사용
 *     + directMatchCurriculumItem() deterministic fallback
 *     → growth_events INSERT (source='teacher_manual')
 *     → 기존 CPO/SCP downstream 진입 (AI Diary와 동일)
 *
 *   - AI Diary (curriculum_matches 이미 존재) → 이 모듈 스킵
 *
 *   - Precision Guard (false positive 방지):
 *     stroke-specific item은 strokeMatch > 0 필수.
 *     strokeMatch = 0 → 스킵 (stroke 불일치 과잉 추론 금지).
 *
 *   - Deterministic Direct Match (stroke_low_score 복구):
 *     searchCurriculumForDiary()가 NO_CANDIDATES인 경우,
 *     텍스트에 영법+기술이 명시적으로 존재하면 DB 직접 매핑 (LLM 미사용).
 *
 *   - Strong Negative 문맥 guard:
 *     부정 키워드가 있더라도 "성공" 결론이 함께 있으면 스킵 안 함.
 *
 *   - fail-safe: diary TX 외부, 실패해도 일지 저장에 영향 없음
 *   - dry-run 모드 지원 (backfill dry-run용)
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
  noteId: string;
  studentId: string;
  noteContent: string;
}

export interface ResolveManualEvidenceParams {
  db: any;
  poolId: string;
  diaryId: string;
  notes: ManualEvidenceNote[];
  dryRun?: boolean;
}

export interface ResolveManualEvidenceResult {
  notesProcessed: number;
  growthEventsInserted: number;
  skipped: number;
  skipReasons: string[];
  dryRunCandidates?: Array<{
    studentId: string;
    noteId: string;
    curriculumItemId: string;
    curriculumItemTitle: string;
    curriculumVersionId: string;
    score: number;
    mappedBy: "search" | "direct";
    mapped: boolean;
  }>;
}

// ── Stroke 매핑 (DB enum → 한글 / 한글 → DB enum) ──────────────────────────

/** 한글 영법 키워드 → DB stroke enum */
const KR_TO_STROKE: Array<[string[], string]> = [
  [['자유형', '프리스타일'], 'freestyle'],
  [['배영', '백스트로크'], 'backstroke'],
  [['평영', '브레스트'], 'breaststroke'],
  [['접영', '버터플라이'], 'butterfly'],
];

/** 텍스트에서 DB stroke enum 추출 */
function detectStrokeEnum(text: string): string | null {
  for (const [kws, strokeEnum] of KR_TO_STROKE) {
    if (kws.some(k => text.includes(k))) return strokeEnum;
  }
  return null;
}

/** stroke-specific item인지 (general 항목은 stroke guard 불필요) */
function isGeneralStrokeItem(levelName: string): boolean {
  return levelName.startsWith("general/") || levelName.split("/")[0] === "general";
}

// ── 기술 키워드 → DB atomic_skill 검색용 keyword ─────────────────────────────

/**
 * 노트 한글 키워드 → DB 검색 keyword (title/atomic_skill ILIKE '%kw%').
 * DB atomic_skill 실제 형태: "평영 킥 타이밍", "배영 킥 물누르기", "접영 풀 동작" 등
 * 즉 영법 prefix + 기술명 혼합 → title/atomic_skill 모두 ILIKE로 검색.
 */
const DIRECT_SKILL_MAP: Array<[string[], string]> = [
  // 발차기/킥 → DB에 "킥" 포함 (평영 킥 타이밍, 접영 첫 번째 킥 타이밍 등)
  [['발차기', '킥보드', '킥판 발차기', '킥 연습'], '킥'],
  // 팔동작/팔돌리기 → "팔|풀" (자유형·배영=풀 동작 / 평영=팔 모으기) — DB query OR로 처리
  [['팔동작', '팔 동작', '팔돌리기', '팔 돌리기', '풀 동작'], '팔|풀'],
  // 호흡 → DB에 "호흡" 포함 (자유형 호흡 타이밍, 평영 호흡 타이밍)
  [['호흡', '브리딩', '숨쉬기', '왼호흡', '오른호흡', '양쪽 호흡', '음파발차기'], '호흡'],
  // 유선형/스트림라인 → DB에 "스트림라인" 포함
  [['유선형', '스트림라인', '유선형 자세'], '스트림라인'],
  // 글라이드 → DB에 "글라이딩" 포함
  [['글라이드', '글라이딩', '활공'], '글라이딩'],
  // 롤링 → DB에 "롤링" 포함
  [['롤링', '몸 회전', '회전'], '롤링'],
  // 턴 → DB에 "전환" 포함
  [['턴', '플립턴', '터치턴'], '전환'],
  // 푸시 → DB에 "푸시" 포함
  [['푸시', '밀기', '벽 차기', '출발'], '푸시'],
];

function detectSkillKeyword(text: string): string | null {
  for (const [kws, dbKw] of DIRECT_SKILL_MAP) {
    if (kws.some(k => text.includes(k))) return dbKw;
  }
  return null;
}

// ── 부정 evidence 사전 필터 ───────────────────────────────────────────────────

const STRONG_NEGATIVE_PATTERNS: RegExp[] = [
  /못\s*(했|함|하겠|하는)/,
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
 * "성공 결론" 패턴: 부정 키워드가 있어도 성공 결론이 있으면 skip 금지.
 * 예: "실패했지만 마지막에는 완주에 성공했습니다"
 */
const SUCCESS_CONCLUSION_PATTERNS: RegExp[] = [
  /완주에.{0,30}성공/,
  /성공했습니다/,
  /성공했어요/,
  /해냈습니다/,
  /해냈어요/,
  /잘\s*됩니다/,
  /잘\s*됐어요/,
  /잘\s*진행/,
  /크게\s*개선/,
  /많이\s*좋아/,
  /안정되고\s*있/,
  /안정됐/,
];

/**
 * 부정 문맥 여부 판별.
 * 성공 결론이 함께 있으면 false 반환 (skip 안 함).
 */
export function isStronglyNegative(text: string): boolean {
  if (!STRONG_NEGATIVE_PATTERNS.some(p => p.test(text))) return false;
  // 부정 키워드 있어도 성공 결론이 있으면 false
  if (SUCCESS_CONCLUSION_PATTERNS.some(p => p.test(text))) return false;
  return true;
}

const MIN_NOTE_LENGTH = 6;

// ── Deterministic Direct Match ────────────────────────────────────────────────

interface DirectMatchResult {
  curriculumItemId: string;
  curriculumVersionId: string;
  title: string;
  stroke: string;
}

/**
 * 텍스트에 영법+기술이 명시적으로 포함된 경우 DB에서 직접 매핑.
 * LLM 미사용, score threshold bypass, false positive guard 내장.
 *
 * 조건: note에 (영법 키워드) AND (기술 키워드)가 모두 명시 → DB에서 stroke+atomic_skill 조회
 */
async function directMatchCurriculumItem(
  poolId: string,
  curriculumVersionId: string,
  noteText: string,
): Promise<DirectMatchResult | null> {
  const strokeEnum = detectStrokeEnum(noteText);
  if (!strokeEnum) return null; // 영법 키워드 없음 → 직접 매핑 불가

  const skillKw = detectSkillKeyword(noteText);
  if (!skillKw) return null; // 기술 키워드 없음 → 직접 매핑 불가

  // 복합 keyword (예: '팔|풀') 처리 — OR 검색
  const kwParts = skillKw.split("|").map(k => k.trim()).filter(Boolean);
  const kwPatterns = kwParts.map(k => `%${k}%`);

  // DB에서 stroke + atomic_skill 매칭 (순서 정렬: sort_order ASC)
  // kwParts가 복수일 때 OR 조건으로 첫 번째부터 순서대로 검색
  let rows: any = { rows: [] };
  for (const pat of kwPatterns) {
    rows = await superAdminDb.execute(sql`
      SELECT id, title, stroke, atomic_skill
      FROM curriculum_items
      WHERE curriculum_version_id = ${curriculumVersionId}
        AND stroke = ${strokeEnum}
        AND is_active = true
        AND NOT is_test_item
        AND (
          atomic_skill ILIKE ${pat}
          OR title      ILIKE ${pat}
        )
      ORDER BY sort_order ASC
      LIMIT 1
    `);
    if (rows.rows.length > 0) break; // 첫 번째 매칭 사용
  }

  if (rows.rows.length === 0) return null;

  const r = rows.rows[0] as any;
  return {
    curriculumItemId:    r.id,
    curriculumVersionId: curriculumVersionId,
    title:               r.title,
    stroke:              r.stroke,
  };
}

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

/**
 * Manual Diary 저장 후 evidence 자동 해석 + growth_events 삽입.
 *
 * 매핑 경로 (우선순위):
 *   1. searchCurriculumForDiary() → strokeMatch > 0 (precision guard 통과) → INSERT
 *   2. directMatchCurriculumItem() → 명시적 영법+기술 deterministic → INSERT
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

  // 1. Active curriculum version 확인
  const version = await getActiveCurriculumVersion(poolId);
  if (!version) {
    result.skipReasons.push(`pool=${poolId} has no ACTIVE curriculum version`);
    result.skipped = notes.length;
    return result;
  }

  for (const note of notes) {
    result.notesProcessed++;
    const { noteId, studentId, noteContent } = note;
    const trimmed = (noteContent ?? "").trim();

    // 2. 최소 길이
    if (trimmed.length < MIN_NOTE_LENGTH) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} skip=TOO_SHORT(${trimmed.length})`);
      continue;
    }

    // 3. 부정 문맥 (성공 결론 있으면 skip 안 함)
    if (isStronglyNegative(trimmed)) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=STRONG_NEGATIVE`);
      continue;
    }

    // 4. 의미 추출 + curriculum 검색
    const meaning = extractMeaning(trimmed);
    let searchResult;
    try {
      searchResult = await searchCurriculumForDiary(poolId, meaning);
    } catch (e: any) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} skip=SEARCH_ERROR(${e.message?.slice(0, 60)})`);
      continue;
    }

    let curriculumItemId: string | null = null;
    let curriculumVersionId: string = version.id;
    let confidence = 0;
    let mappedBy: "search" | "direct" = "search";
    let itemTitle = "";

    // 5a. Search 경로 (strokeMatch > 0 precision guard)
    const top = searchResult.usedTemplates[0];
    if (top) {
      const strokeMatch = top.breakdown?.strokeMatch ?? 0;
      const levelName   = top.level_name ?? "";
      const strokeOk    = strokeMatch > 0 || isGeneralStrokeItem(levelName);

      if (strokeOk) {
        curriculumItemId = top.level_id;
        confidence       = Math.min(1, Math.max(0, top.score ?? 0));
        itemTitle        = top.level_name ?? "";
        mappedBy         = "search";
      } else {
        // strokeMatch = 0: stroke 불일치 → precision guard 차단
        result.skipReasons.push(
          `note=${noteId} search_candidate="${top.level_id}" rejected: strokeMatch=0 ` +
          `(levelName="${levelName}" meaning.strokes=${JSON.stringify(meaning.strokes)})`
        );
      }
    }

    // 5b. Direct Match 경로 (search 실패 또는 precision guard 탈락 시 fallback)
    if (!curriculumItemId) {
      try {
        const direct = await directMatchCurriculumItem(poolId, version.id, trimmed);
        if (direct) {
          curriculumItemId    = direct.curriculumItemId;
          curriculumVersionId = direct.curriculumVersionId;
          confidence          = 1.0; // deterministic match = 확신
          itemTitle           = direct.title;
          mappedBy            = "direct";
        }
      } catch (e: any) {
        result.skipReasons.push(`note=${noteId} direct_match_error: ${e.message?.slice(0, 60)}`);
      }
    }

    // 6. 매핑 실패
    if (!curriculumItemId) {
      result.skipped++;
      result.skipReasons.push(`note=${noteId} student=${studentId} skip=NO_CANDIDATES`);
      continue;
    }

    // dry-run
    if (dryRun) {
      result.dryRunCandidates!.push({
        studentId, noteId,
        curriculumItemId,
        curriculumItemTitle: itemTitle.slice(0, 80),
        curriculumVersionId,
        score: confidence,
        mappedBy,
        mapped: true,
      });
      result.growthEventsInserted++;
      continue;
    }

    // 7. growth_events INSERT
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
          ${'diary_text_search_v2'},
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
          `[manual-resolver] INSERTED by=${mappedBy} diary=${diaryId} note=${noteId}` +
          ` student=${studentId} item=${curriculumItemId} conf=${confidence.toFixed(3)}`
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
