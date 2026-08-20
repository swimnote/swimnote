/**
 * curriculum-progress-resolver.ts — WP-A Progress Resolver
 *
 * EvidenceBundle + curriculum_items 순서를 기반으로
 * 각 항목의 progress 상태를 결정.
 *
 * 출력 상태:
 *   COMPLETED     — 충분한 실제 Evidence가 있고 최근 30일 내 반복 없음
 *   IN_PROGRESS   — 최근 30일 내 반복적으로 수행 중
 *   REVIEW        — 과거 확인됐던 기술이 최근 다시 등장 (재확인)
 *   NOT_CONFIRMED — 확인 가능한 근거 없거나 1회 diary만 있음
 *   NEXT          — 현재 progress 이후 curriculum 순서상 다음 항목
 *
 * 원칙:
 *   - GPT가 상태를 결정하지 않음 (완전 deterministic)
 *   - diary 1회 등장만으로 COMPLETED 판정 금지
 *   - INFERRED type은 NEXT 항목에만 사용
 *   - 빈 curriculum → NEXT 생성 금지
 *   - student_levels 달성 기록은 레벨 완료의 강한 근거로 사용
 */

import type {
  EvidenceBundle,
  DirectEvidence,
  TrackedEvidence,
  InferredEvidence,
} from "./curriculum-evidence-retriever.js";

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export type ProgressStatus =
  | "COMPLETED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "NOT_CONFIRMED"
  | "NEXT";

export interface CurriculumItemRef {
  id: string;
  title: string;
  sort_order: number;
}

export interface ProgressEntry {
  curriculum_item_id: string;
  curriculum_title: string;
  status: ProgressStatus;
  sort_order: number;
  /** 상태 판정의 근거 evidence */
  supporting_evidence: Array<DirectEvidence | TrackedEvidence | InferredEvidence>;
}

export interface ProgressResolution {
  entries: ProgressEntry[];
  /** COMPLETED 또는 IN_PROGRESS 중 sort_order가 가장 높은 항목 */
  highest_confirmed_item: CurriculumItemRef | null;
  /** highest_confirmed_item 이후 다음 sort_order 항목 (INFERRED) */
  next_item: CurriculumItemRef | null;
}

// ── 임계값 ────────────────────────────────────────────────────────────────────

/** IN_PROGRESS 판정 기준: last_seen이 이 일수 이내 */
const IN_PROGRESS_WINDOW_DAYS = 30;
/** COMPLETED 판정에 필요한 최소 confidence 평균 */
const COMPLETED_MIN_CONFIDENCE = 0.5;
/** REVIEW 판정: COMPLETED인데 최근 N일 이내 다시 등장 */
const REVIEW_RECENT_DAYS = 30;

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(date: string | null, today: string): number {
  if (!date) return Infinity;
  return (new Date(today).getTime() - new Date(date).getTime()) / 86_400_000;
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * Evidence + curriculum 순서를 기반으로 각 항목의 progress 상태를 결정.
 *
 * @param evidence       retrieveEvidence() 결과
 * @param curriculumItems 순서가 있는 curriculum items (sort_order 오름차순)
 */
export function resolveProgress(
  evidence: EvidenceBundle,
  curriculumItems: CurriculumItemRef[],
): ProgressResolution {
  const today = todayStr();
  const entries: ProgressEntry[] = [];

  // sort_order 오름차순 정렬
  const sortedItems = [...curriculumItems].sort((a, b) => a.sort_order - b.sort_order);

  // TRACKED evidence를 item_id로 빠르게 조회
  const trackedByItem = new Map<string, TrackedEvidence>();
  for (const t of evidence.tracked) {
    trackedByItem.set(t.curriculum_item_id, t);
  }

  // DIRECT evidence를 item_id로 그룹화
  const directByItem = new Map<string, DirectEvidence[]>();
  for (const d of evidence.direct) {
    if (!directByItem.has(d.curriculum_item_id)) {
      directByItem.set(d.curriculum_item_id, []);
    }
    directByItem.get(d.curriculum_item_id)!.push(d);
  }

  // student_levels에서 달성 level_order 집합 추출 (level 완료 근거)
  const achievedLevelOrders = new Set<number>(
    evidence.level_history
      .map((l) => l.level_order)
      .filter((o): o is number => o !== null),
  );

  // 각 curriculum item에 대해 상태 결정
  for (const item of sortedItems) {
    const tracked = trackedByItem.get(item.id);
    const directs = directByItem.get(item.id) ?? [];

    let status: ProgressStatus = "NOT_CONFIRMED";
    const supporting: Array<DirectEvidence | TrackedEvidence | InferredEvidence> = [];

    if (tracked) {
      // TRACKED evidence 존재 → COMPLETED / IN_PROGRESS / REVIEW 판정
      const daysSinceLast = daysSince(tracked.last_seen, today);
      const isRecentlyActive = daysSinceLast <= IN_PROGRESS_WINDOW_DAYS;
      const hasMinConfidence = tracked.confidence_avg >= COMPLETED_MIN_CONFIDENCE;

      // first_seen과 last_seen의 간격 (반복 기간)
      const spanDays =
        tracked.first_seen && tracked.last_seen
          ? daysSince(tracked.first_seen, tracked.last_seen)
          : 0;

      if (isRecentlyActive) {
        if (spanDays > REVIEW_RECENT_DAYS && hasMinConfidence) {
          // 오래된 기록도 있고, 최근에도 등장 → REVIEW (이미 익혔던 기술을 재확인)
          status = "REVIEW";
        } else {
          // 최근에 반복 진행 중
          status = "IN_PROGRESS";
        }
      } else {
        // 최근 30일 이내가 아님 → 완료 판정 가능
        if (hasMinConfidence) {
          status = "COMPLETED";
        } else {
          // confidence 낮음 → 완료 단정 불가
          status = "NOT_CONFIRMED";
        }
      }

      supporting.push(tracked);
    } else if (directs.length > 0) {
      // DIRECT evidence만 있음 (1회 diary) → NOT_CONFIRMED (diary 1회 = 완료 불가)
      // 단, student_levels로 level 달성이 확인되면 COMPLETED 가능 — 이는 레벨 전체에 적용
      status = "NOT_CONFIRMED";
      supporting.push(...directs);
    }
    // else: evidence 없음 → NOT_CONFIRMED (기본값)

    entries.push({
      curriculum_item_id: item.id,
      curriculum_title: item.title,
      status,
      sort_order: item.sort_order,
      supporting_evidence: supporting,
    });
  }

  // student_levels 달성 기록으로 COMPLETED 보강
  // (level_order 기반으로 sort_order와 매핑 — 동일 개념이면 COMPLETED 격상)
  if (achievedLevelOrders.size > 0) {
    for (const entry of entries) {
      if (
        entry.status === "NOT_CONFIRMED" &&
        achievedLevelOrders.has(entry.sort_order)
      ) {
        entry.status = "COMPLETED";
      }
    }
  }

  // highest_confirmed_item: COMPLETED 또는 IN_PROGRESS 중 가장 높은 sort_order
  const confirmedEntries = entries.filter(
    (e) => e.status === "COMPLETED" || e.status === "IN_PROGRESS",
  );
  confirmedEntries.sort((a, b) => b.sort_order - a.sort_order);
  const highestEntry = confirmedEntries[0] ?? null;
  const highestConfirmed: CurriculumItemRef | null = highestEntry
    ? {
        id: highestEntry.curriculum_item_id,
        title: highestEntry.curriculum_title,
        sort_order: highestEntry.sort_order,
      }
    : null;

  // next_item: highest_confirmed 이후 sort_order에서 아직 NOT_CONFIRMED인 첫 번째 항목
  let nextItem: CurriculumItemRef | null = null;
  if (highestConfirmed && sortedItems.length > 0) {
    const candidate = sortedItems.find(
      (item) => item.sort_order > highestConfirmed.sort_order,
    );
    if (candidate) {
      // NEXT 상태로 마킹
      const candidateEntry = entries.find(
        (e) => e.curriculum_item_id === candidate.id,
      );
      if (candidateEntry && candidateEntry.status === "NOT_CONFIRMED") {
        candidateEntry.status = "NEXT";
        const inferred: InferredEvidence = {
          type: "INFERRED",
          basis: "CURRICULUM_ORDER",
          curriculum_item_id: candidate.id,
          curriculum_title: candidate.title,
          sort_order: candidate.sort_order,
        };
        candidateEntry.supporting_evidence = [inferred];
        // evidence.inferred에도 추가
        evidence.inferred.push(inferred);
      }
      nextItem = {
        id: candidate.id,
        title: candidate.title,
        sort_order: candidate.sort_order,
      };
    }
    // curriculum 없으면 next_item = null (추측 생성 금지)
  }

  return { entries, highest_confirmed_item: highestConfirmed, next_item: nextItem };
}
