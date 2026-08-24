/**
 * curriculum-progress-mapper.ts
 *
 * STEP-GAUGE-04: Teacher Diary 저장 시 생성된 growth_events를 이용해
 * 학생 1명 + lesson_session 1회당 대표 CPO(curriculum_progress_observations) 1개를
 * 안전하게 UPSERT / INVALIDATE 한다.
 *
 * 설계 원칙:
 *   - source: teacher_ai / teacher_manual 만 허용
 *   - fail-closed: eligible 없으면 CPO 무효화 또는 NO_ELIGIBLE_EVIDENCE
 *   - cross-pool 차단: curriculum_item이 해당 pool의 version에 속해야 함
 *   - SCP 확인 엔진(GAUGE-05) 호출 금지 — raw CPO 사실만 기록
 *   - AI / Professional / 외부 LLM 의존성 없음
 *
 * TX 정책: diary TX 커밋 후 fail-safe(try-catch)로 호출.
 *   diary 저장 성공 보장 우선, CPO는 eventually consistent.
 */

import { sql } from "drizzle-orm";
import { classifyObservationType } from "./curriculum-evidence-classifier.js";
import {
  computeItemRank,
  CurriculumRankError,
} from "./curriculum-rank-calculator.js";

// ── DB interface (drizzle-orm compatible) ─────────────────────────────────────

export interface MapperDb {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

// ── 결과 타입 ─────────────────────────────────────────────────────────────────

export type UpsertSessionObservationStatus =
  | "UPSERTED"
  | "INVALIDATED"
  | "NO_ELIGIBLE_EVIDENCE";

export interface UpsertSessionObservationResult {
  status: UpsertSessionObservationStatus;
  /** 대표 관찰로 선택된 curriculum item ID */
  curriculumItemId?: string;
  progressRank?: number;
  totalCount?: number;
  progressPct?: number;
  observationType?: string;
  isGaugeEligible?: boolean;
  /** 내부 diagnostic */
  _diagnostics?: {
    candidateCount: number;
    eligibleCount: number;
    skipReasons: string[];
  };
}

// ── 허용 evidence source ──────────────────────────────────────────────────────

const ALLOWED_SOURCES = new Set(["teacher_ai", "teacher_manual"]);

// ── 내부 row 타입 ─────────────────────────────────────────────────────────────

interface GrowthEventRow {
  id: string;
  curriculum_item_id: string;
  curriculum_version_id: string;
  source: string;
  confidence: number;
  diary_note_id: string | null;
  evidence_text: string | null; // class_diary_student_notes.note_content 조인 결과
}

// ── 핵심 함수 ─────────────────────────────────────────────────────────────────

/**
 * upsertSessionObservation
 *
 * 지정된 lesson_session + student에 대해
 * 현재 유효 growth_events를 재조회하고 CPO를 UPSERT 또는 INVALIDATE 한다.
 *
 * @param db    drizzle db 또는 tx (TX 외부 fail-safe 호출 권장)
 * @param params.studentId       학생 ID (text)
 * @param params.poolId          수영장 ID
 * @param params.lessonSessionId class_diaries.id (cd_xxx)
 */
export async function upsertSessionObservation(
  db: MapperDb,
  params: {
    studentId: string;
    poolId: string;
    lessonSessionId: string;
  }
): Promise<UpsertSessionObservationResult> {
  const { studentId, poolId, lessonSessionId } = params;

  // ── Step 1: 해당 session/student의 유효 growth_events 조회 ─────────────────
  // lesson_session_id = class_diaries.id → 해당 diary의 student_notes 경유 조인
  const geRows = await db.execute(sql`
    SELECT
      ge.id,
      ge.curriculum_item_id,
      ge.curriculum_version_id,
      ge.source,
      ge.confidence::float    AS confidence,
      ge.diary_note_id,
      csn.note_content        AS evidence_text
    FROM growth_events ge
    LEFT JOIN class_diary_student_notes csn
      ON ge.diary_note_id = csn.id
    WHERE ge.diary_note_id IN (
      SELECT id FROM class_diary_student_notes
      WHERE diary_id = ${lessonSessionId}
        AND student_id = ${studentId}
    )
      AND ge.source IN ('teacher_ai', 'teacher_manual')
      AND ge.is_invalidated = false
      AND ge.curriculum_item_id  IS NOT NULL
      AND ge.curriculum_version_id IS NOT NULL
  `);

  const rawEvents = geRows.rows as GrowthEventRow[];

  const skipReasons: string[] = [];
  interface Candidate {
    event: GrowthEventRow;
    progressRank: number;
    totalCount: number;
    progressPct: number;
    observationType: string;
    isGaugeEligible: boolean;
    evidenceSnippet: string | null;
  }

  const eligibles: Candidate[] = [];

  // ── Step 2: 각 event 처리 ──────────────────────────────────────────────────

  for (const ge of rawEvents) {
    // 2-a. source guard
    if (!ALLOWED_SOURCES.has(ge.source)) {
      skipReasons.push(`${ge.id}: source=${ge.source} not allowed`);
      continue;
    }

    // 2-b. pool / version guard
    // curriculum_items는 curriculum_version에 속하고
    // curriculum_versions는 swimming_pool_id를 가짐 → cross-pool 차단
    const versionRows = await db.execute(sql`
      SELECT id, swimming_pool_id, is_active
      FROM curriculum_versions
      WHERE id = ${ge.curriculum_version_id}
        AND swimming_pool_id = ${poolId}
    `);
    if (versionRows.rows.length === 0) {
      skipReasons.push(
        `${ge.id}: version=${ge.curriculum_version_id} not in pool=${poolId} (cross-pool blocked)`
      );
      continue;
    }
    const version = versionRows.rows[0] as {
      id: string;
      swimming_pool_id: string;
      is_active: boolean;
    };

    // 2-c. classify evidence
    const classified = classifyObservationType({
      evidenceText: ge.evidence_text,
      evidenceSource: ge.source,
    });

    // 2-d. compute rank (fail-closed: error → skip)
    let rankResult: Awaited<ReturnType<typeof computeItemRank>>;
    try {
      rankResult = await computeItemRank(
        db as any,
        ge.curriculum_version_id,
        ge.curriculum_item_id
      );
    } catch (err) {
      if (err instanceof CurriculumRankError) {
        skipReasons.push(
          `${ge.id}: rank error ${err.code} for item=${ge.curriculum_item_id}`
        );
      } else {
        skipReasons.push(`${ge.id}: rank unexpected error`);
      }
      continue;
    }

    // 2-e. ineligible type → skip (not added to eligibles, no CPO contribution)
    if (!classified.isGaugeEligible) {
      skipReasons.push(
        `${ge.id}: observationType=${classified.observationType} ineligible`
      );
      continue;
    }

    // evidence_text_snippet: 최대 200자 (DB CHECK chk_cpo_snippet_len)
    const snippet = ge.evidence_text
      ? ge.evidence_text.slice(0, 200)
      : null;

    eligibles.push({
      event: ge,
      progressRank: rankResult.progressRank,
      totalCount: rankResult.totalCount,
      progressPct: rankResult.progressPct,
      observationType: classified.observationType,
      isGaugeEligible: true,
      evidenceSnippet: snippet,
    });
  }

  // ── Step 3: 대표 관찰 선택 ────────────────────────────────────────────────
  // eligible item 중 progressRank DESC, curriculum_item_id ASC (tie-breaker)

  if (eligibles.length === 0) {
    // 기존 CPO 확인
    const existingCpo = await db.execute(sql`
      SELECT id FROM curriculum_progress_observations
      WHERE lesson_session_id = ${lessonSessionId}
        AND student_id = ${studentId}
    `);

    if (existingCpo.rows.length === 0) {
      return {
        status: "NO_ELIGIBLE_EVIDENCE",
        _diagnostics: {
          candidateCount: rawEvents.length,
          eligibleCount: 0,
          skipReasons,
        },
      };
    }

    // 기존 CPO 무효화
    await db.execute(sql`
      UPDATE curriculum_progress_observations
      SET
        is_invalidated    = true,
        invalidated_at    = NOW(),
        invalidated_reason = 'no_eligible_evidence',
        updated_at        = NOW()
      WHERE lesson_session_id = ${lessonSessionId}
        AND student_id        = ${studentId}
    `);

    return {
      status: "INVALIDATED",
      _diagnostics: {
        candidateCount: rawEvents.length,
        eligibleCount: 0,
        skipReasons,
      },
    };
  }

  // 대표 = progressRank DESC → curriculum_item_id ASC
  eligibles.sort((a, b) => {
    if (b.progressRank !== a.progressRank)
      return b.progressRank - a.progressRank;
    return a.event.curriculum_item_id.localeCompare(b.event.curriculum_item_id);
  });

  const rep = eligibles[0];

  // mapping_confidence: growth_event.confidence 그대로 사용
  // teacher_manual + no confidence (null/NaN) → 1.000 (explicit selection = max confidence)
  const rawConf = rep.event.confidence;
  const mappingConfidence =
    typeof rawConf === "number" && isFinite(rawConf) && rawConf >= 0 && rawConf <= 1
      ? rawConf
      : 1.0;

  // ── Step 4: CPO UPSERT ────────────────────────────────────────────────────
  // UNIQUE(lesson_session_id, student_id) ON CONFLICT DO UPDATE
  // stale value 잔존 금지: 모든 필드 갱신

  await db.execute(sql`
    INSERT INTO curriculum_progress_observations (
      student_id,
      swimming_pool_id,
      lesson_session_id,
      last_diary_note_id,
      curriculum_version_id,
      curriculum_item_id,
      observed_progress_rank,
      observed_total_count,
      observed_progress_pct,
      observation_type,
      is_gauge_eligible,
      evidence_source,
      evidence_text_snippet,
      mapping_confidence,
      is_invalidated,
      invalidated_at,
      invalidated_reason,
      updated_at
    )
    VALUES (
      ${studentId},
      ${poolId},
      ${lessonSessionId},
      ${rep.event.diary_note_id ?? null},
      ${rep.event.curriculum_version_id},
      ${rep.event.curriculum_item_id},
      ${rep.progressRank},
      ${rep.totalCount},
      ${rep.progressPct},
      ${rep.observationType},
      ${rep.isGaugeEligible},
      ${rep.event.source},
      ${rep.evidenceSnippet ?? null},
      ${mappingConfidence},
      false,
      NULL,
      NULL,
      NOW()
    )
    ON CONFLICT (lesson_session_id, student_id) DO UPDATE SET
      swimming_pool_id       = EXCLUDED.swimming_pool_id,
      last_diary_note_id     = EXCLUDED.last_diary_note_id,
      curriculum_version_id  = EXCLUDED.curriculum_version_id,
      curriculum_item_id     = EXCLUDED.curriculum_item_id,
      observed_progress_rank = EXCLUDED.observed_progress_rank,
      observed_total_count   = EXCLUDED.observed_total_count,
      observed_progress_pct  = EXCLUDED.observed_progress_pct,
      observation_type       = EXCLUDED.observation_type,
      is_gauge_eligible      = EXCLUDED.is_gauge_eligible,
      evidence_source        = EXCLUDED.evidence_source,
      evidence_text_snippet  = EXCLUDED.evidence_text_snippet,
      mapping_confidence     = EXCLUDED.mapping_confidence,
      is_invalidated         = false,
      invalidated_at         = NULL,
      invalidated_reason     = NULL,
      updated_at             = NOW()
  `);

  return {
    status: "UPSERTED",
    curriculumItemId: rep.event.curriculum_item_id,
    progressRank: rep.progressRank,
    totalCount: rep.totalCount,
    progressPct: rep.progressPct,
    observationType: rep.observationType,
    isGaugeEligible: rep.isGaugeEligible,
    _diagnostics: {
      candidateCount: rawEvents.length,
      eligibleCount: eligibles.length,
      skipReasons,
    },
  };
}

/**
 * invalidateSessionObservation
 *
 * Diary DELETE 완료 후 호출.
 * 해당 session의 잔존 유효 growth_events를 재조회하고:
 *   - 잔존 eligible 있으면 CPO 재계산 (upsertSessionObservation 재사용)
 *   - 없으면 CPO.is_invalidated=true ('diary_delete')
 *
 * SCP 재계산은 GAUGE-05에서 처리.
 */
export async function invalidateSessionObservation(
  db: MapperDb,
  params: {
    studentId: string;
    poolId: string;
    lessonSessionId: string;
  }
): Promise<UpsertSessionObservationResult> {
  // 재조회 후 eligible 있으면 upsert, 없으면 invalidate
  // upsertSessionObservation 내부에서 eligible=0 일 때 자동 invalidate 처리
  const result = await upsertSessionObservation(db, params);

  // INVALIDATED 상태이면 invalidated_reason을 'diary_delete'로 갱신
  if (result.status === "INVALIDATED") {
    await db.execute(sql`
      UPDATE curriculum_progress_observations
      SET invalidated_reason = 'diary_delete'
      WHERE lesson_session_id = ${params.lessonSessionId}
        AND student_id        = ${params.studentId}
    `);
  }

  return result;
}
