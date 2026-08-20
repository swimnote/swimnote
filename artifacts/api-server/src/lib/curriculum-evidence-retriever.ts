/**
 * curriculum-evidence-retriever.ts — WP-A Evidence Retriever
 *
 * 학생의 실제 수업/성장 Evidence를 DB에서 수집하여 EvidenceBundle로 반환.
 *
 * Evidence 분류:
 *   DIRECT  — 특정 diary_note 1회에서 확인된 evidence
 *   TRACKED — 최근 90일 내 동일 curriculum_item이 서로 다른 diary_note 2회 이상 확인
 *   INFERRED — curriculum_items sort_order 기반 다음 단계 추론 (실제 기록 아님)
 *
 * 원칙:
 *   - growth_events.is_invalidated = false 인 것만 사용
 *   - 원본 diary evidence 보존
 *   - 과도한 추론 금지 (INFERRED 타입 명시)
 *   - DB 오류 시 빈 bundle 반환 (상위 레이어 실패 없음)
 *
 * DB Contract:
 *   - EvidenceDb 인터페이스로 주입 (테스트 mock 지원)
 *   - 운영: productionEvidenceDb (superAdminDb via raw SQL)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface DirectEvidence {
  type: "DIRECT";
  source: "DIARY";
  diary_note_id: string;
  /** class_diaries.lesson_date (YYYY-MM-DD) — null이면 날짜 불명 */
  diary_date: string | null;
  evidence_text: string | null;
  curriculum_item_id: string;
  curriculum_title: string;
  confidence: number;
  growth_match_status: string | null;
}

export interface TrackedEvidence {
  type: "TRACKED";
  curriculum_item_id: string;
  curriculum_title: string;
  /** 확인된 서로 다른 diary_note 수 */
  diary_count: number;
  /** 최초 확인 날짜 (YYYY-MM-DD 또는 null) */
  first_seen: string | null;
  /** 최근 확인 날짜 (YYYY-MM-DD 또는 null) */
  last_seen: string | null;
  confidence_avg: number;
  /** 수집된 모든 evidence_text (명시적 완료 키워드 탐지에 사용) */
  evidence_texts: string[];
}

export interface InferredEvidence {
  type: "INFERRED";
  basis: "CURRICULUM_ORDER";
  curriculum_item_id: string;
  curriculum_title: string;
  sort_order: number;
}

export interface StudentLevelRecord {
  id: string;
  level: string | null;
  level_order: number | null;
  achieved_date: string;
  note: string | null;
}

export interface EvidenceBundle {
  direct: DirectEvidence[];
  tracked: TrackedEvidence[];
  /** INFERRED는 progress resolver가 채움 — retriever는 빈 배열 반환 */
  inferred: InferredEvidence[];
  level_history: StudentLevelRecord[];
  retrieved_at: string; // ISO 8601
}

// ── DB 인터페이스 (테스트 mock 주입 지원) ─────────────────────────────────────

export interface RawGrowthEventRow {
  growth_event_id: string;
  curriculum_item_id: string;
  curriculum_title: string;
  sort_order: number | null;
  diary_note_id: string | null;
  diary_date: string | null; // lesson_date from class_diaries
  confidence: number;
  growth_match_status: string | null;
  evidence_text: string | null;
}

export interface EvidenceDb {
  getGrowthEventRows(studentId: string, poolId: string): Promise<RawGrowthEventRow[]>;
  getStudentLevels(studentId: string, poolId: string): Promise<StudentLevelRecord[]>;
}

// ── 운영 DB 구현 ─────────────────────────────────────────────────────────────

const productionEvidenceDb: EvidenceDb = {
  async getGrowthEventRows(studentId, poolId) {
    try {
      const result = await superAdminDb.execute(sql`
        SELECT
          ge.id                   AS growth_event_id,
          ge.curriculum_item_id,
          COALESCE(ci.title, '')  AS curriculum_title,
          ci.sort_order,
          ge.diary_note_id,
          cd.lesson_date::text    AS diary_date,
          ge.confidence::float    AS confidence,
          ge.growth_match_status,
          ge.evidence_text
        FROM growth_events ge
        LEFT JOIN curriculum_items ci
          ON ci.id = ge.curriculum_item_id
        LEFT JOIN class_diary_student_notes csn
          ON csn.id = ge.diary_note_id
        LEFT JOIN class_diaries cd
          ON cd.id = csn.diary_id
        WHERE ge.student_id        = ${studentId}
          AND ge.swimming_pool_id  = ${poolId}
          AND ge.is_invalidated    = false
          AND ge.curriculum_item_id IS NOT NULL
        ORDER BY cd.lesson_date DESC NULLS LAST, ge.created_at DESC
      `);
      return result.rows as RawGrowthEventRow[];
    } catch {
      return [];
    }
  },

  async getStudentLevels(studentId, poolId) {
    try {
      const result = await superAdminDb.execute(sql`
        SELECT
          id,
          level,
          level_order,
          achieved_date::text AS achieved_date,
          note
        FROM student_levels
        WHERE student_id = ${studentId}
          AND (swimming_pool_id = ${poolId} OR swimming_pool_id IS NULL)
        ORDER BY achieved_date DESC NULLS LAST, created_at DESC
      `);
      return result.rows as StudentLevelRecord[];
    } catch {
      return [];
    }
  },
};

// ── TRACKED 계산 임계값 ───────────────────────────────────────────────────────

/** TRACKED 판정에 필요한 최소 서로 다른 diary_note 수 */
const TRACKED_MIN_DIARY_COUNT = 2;
/** TRACKED 판정에 적용되는 최근 기간 (일) */
const TRACKED_WINDOW_DAYS = 90;

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(a).getTime() - new Date(b).getTime()) / 86_400_000,
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * 학생의 실제 Evidence를 수집하여 EvidenceBundle로 반환.
 *
 * DB 오류 발생 시 빈 bundle 반환 (상위 레이어 실패 없음).
 *
 * @param studentId  students.id
 * @param poolId     swimming_pools.id
 * @param db         EvidenceDb (기본: productionEvidenceDb, 테스트: mock 주입)
 */
export async function retrieveEvidence(
  studentId: string,
  poolId: string,
  db: EvidenceDb = productionEvidenceDb,
): Promise<EvidenceBundle> {
  const today = todayStr();

  // 병렬 조회
  const [rawRows, levelHistory] = await Promise.all([
    db.getGrowthEventRows(studentId, poolId),
    db.getStudentLevels(studentId, poolId),
  ]);

  if (rawRows.length === 0) {
    return {
      direct: [],
      tracked: [],
      inferred: [],
      level_history: levelHistory,
      retrieved_at: new Date().toISOString(),
    };
  }

  // curriculum_item_id별 그룹화
  const byItem = new Map<
    string,
    {
      title: string;
      sort_order: number | null;
      rows: RawGrowthEventRow[];
    }
  >();

  for (const row of rawRows) {
    const key = row.curriculum_item_id;
    if (!byItem.has(key)) {
      byItem.set(key, { title: row.curriculum_title, sort_order: row.sort_order, rows: [] });
    }
    byItem.get(key)!.rows.push(row);
  }

  const direct: DirectEvidence[] = [];
  const tracked: TrackedEvidence[] = [];

  for (const [itemId, { title, rows }] of byItem) {
    // 서로 다른 diary_note_id 집합 (null 제외)
    const distinctDiaryIds = new Set(
      rows.map((r) => r.diary_note_id).filter((id): id is string => id !== null),
    );

    // 90일 이내 rows만 추려서 TRACKED 기준 계산
    const recentRows = rows.filter(
      (r) => r.diary_date && daysBetween(r.diary_date, today) <= TRACKED_WINDOW_DAYS,
    );
    const recentDiaryIds = new Set(
      recentRows.map((r) => r.diary_note_id).filter((id): id is string => id !== null),
    );

    if (recentDiaryIds.size >= TRACKED_MIN_DIARY_COUNT) {
      // TRACKED: 90일 내 다른 diary 2회 이상 확인
      const dates = recentRows
        .map((r) => r.diary_date)
        .filter((d): d is string => d !== null)
        .sort();
      const confidences = recentRows.map((r) => r.confidence);
      const avgConf =
        confidences.reduce((s, c) => s + c, 0) / confidences.length;

      tracked.push({
        type: "TRACKED",
        curriculum_item_id: itemId,
        curriculum_title: title,
        diary_count: recentDiaryIds.size,
        first_seen: dates[0] ?? null,
        last_seen: dates[dates.length - 1] ?? null,
        confidence_avg: Math.round(avgConf * 1000) / 1000,
        evidence_texts: recentRows
          .map((r) => r.evidence_text)
          .filter((t): t is string => t !== null),
      });
    } else {
      // DIRECT: 각 row를 개별 evidence로 변환 (중복 diary 허용)
      const seenDiaries = new Set<string>();
      for (const row of rows) {
        // diary_note_id 단위로 deduplicate (같은 diary에서 여러 growth_event → 1개만)
        const diaryKey = row.diary_note_id ?? `no_diary_${row.growth_event_id}`;
        if (seenDiaries.has(diaryKey)) continue;
        seenDiaries.add(diaryKey);

        direct.push({
          type: "DIRECT",
          source: "DIARY",
          diary_note_id: row.diary_note_id ?? "",
          diary_date: row.diary_date,
          evidence_text: row.evidence_text,
          curriculum_item_id: itemId,
          curriculum_title: title,
          confidence: row.confidence,
          growth_match_status: row.growth_match_status,
        });
      }
    }

    // TRACKED와 DIRECT 중복 방지: TRACKED로 분류된 item은 DIRECT에서 제거
    // (위 분기가 mutually exclusive이므로 자동 처리됨)
    void distinctDiaryIds; // lint silence
  }

  return {
    direct,
    tracked,
    inferred: [], // Progress Resolver가 채움
    level_history: levelHistory,
    retrieved_at: new Date().toISOString(),
  };
}
