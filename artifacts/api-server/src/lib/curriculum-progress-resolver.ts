/**
 * curriculum-progress-resolver.ts — WP-A Progress Resolver
 *
 * EvidenceBundle + curriculum_items 순서를 기반으로
 * 각 항목의 progress 상태를 결정.
 *
 * 출력 상태:
 *   COMPLETED     — 강한 구조적 근거(student_levels 달성 또는 명시적 완료 증거)가 있음
 *   IN_PROGRESS   — 최근 30일 내 반복적으로 수행 중
 *   REVIEW        — 과거 COMPLETED 뒷받침 근거가 있고 최근에 다시 등장 (재확인)
 *   NOT_CONFIRMED — 확인 가능한 근거 없거나 1회 diary만 있음, 또는 반복됐으나 완료 근거 없음
 *   NEXT          — 현재 progress 이후 curriculum 순서상 다음 항목
 *
 * 원칙:
 *   - GPT가 상태를 결정하지 않음 (완전 deterministic)
 *   - diary 1회 등장만으로 COMPLETED 판정 금지
 *   - "오래됐다"는 이유만으로 COMPLETED 판정 금지
 *   - TRACKED 반복만으로 COMPLETED 금지 — 강한 완료 근거 필수
 *   - 강한 완료 근거 = student_levels 달성 OR evidence_text 명시적 완료 키워드
 *   - INFERRED type은 NEXT 항목에만 사용
 *   - 빈 curriculum → NEXT 생성 금지
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

/**
 * 명시적 완료 키워드 (evidence_text에서 탐지).
 * 단순 수행·반복·언급이 아닌, 명확한 완료/통과/마스터 의미의 표현.
 */
const EXPLICIT_COMPLETION_KEYWORDS = [
  "완료",
  "통과",
  "마스터",
  "완성",
  "성공",
  "합격",
  "달성",
  "마침",
  "끝냄",
  "다 했",
  "완전히",
];

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysSince(date: string | null, today: string): number {
  if (!date) return Infinity;
  return (new Date(today).getTime() - new Date(date).getTime()) / 86_400_000;
}

/**
 * evidence_text에 명시적 완료 키워드가 포함돼 있는지 확인.
 * confidence >= 0.6 조건 추가로 낮은 신뢰도 매핑은 제외.
 */
function hasExplicitCompletionText(text: string | null | undefined): boolean {
  if (!text) return false;
  return EXPLICIT_COMPLETION_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * TrackedEvidence 내 모든 evidence_texts 중 명시적 완료 키워드가 있는지 확인.
 */
function trackedHasExplicitCompletion(tracked: TrackedEvidence): boolean {
  return tracked.evidence_texts.some((t) => hasExplicitCompletionText(t));
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

  // student_levels에서 달성 level_order 집합 추출 (level 완료의 강한 구조적 근거)
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

    // ── 강한 완료 근거 판별 ───────────────────────────────────────────────────
    // A. student_levels 달성 기록으로 sort_order 매핑
    const hasStructuredCompletion = achievedLevelOrders.has(item.sort_order);
    // B. evidence_text 내 명시적 완료 키워드
    const hasExplicitDiaryCompletion = tracked
      ? trackedHasExplicitCompletion(tracked)
      : directs.some((d) => hasExplicitCompletionText(d.evidence_text));
    // 강한 완료 근거 = A OR B
    const hasStrongCompletionBasis = hasStructuredCompletion || hasExplicitDiaryCompletion;

    if (tracked) {
      // TRACKED evidence 존재 → 최근 여부 + 완료 근거로 상태 결정
      const daysSinceLast = daysSince(tracked.last_seen, today);
      const isRecentlyActive = daysSinceLast <= IN_PROGRESS_WINDOW_DAYS;

      supporting.push(tracked);

      if (isRecentlyActive) {
        if (hasStrongCompletionBasis) {
          // 과거 완료 근거 있음 + 최근 재등장 → REVIEW (재확인)
          status = "REVIEW";
        } else {
          // 완료 근거 없이 최근 반복 → IN_PROGRESS
          status = "IN_PROGRESS";
        }
      } else {
        // 최근 30일 이내가 아님
        if (hasStrongCompletionBasis) {
          // 강한 완료 근거 있고 최근 반복 없음 → COMPLETED
          status = "COMPLETED";
        } else {
          // 반복 기록만 있고 명시적 완료 근거 없음 → NOT_CONFIRMED
          // (오래됐다는 이유만으로 COMPLETED 판정 금지)
          status = "NOT_CONFIRMED";
        }
      }
    } else if (directs.length > 0) {
      // DIRECT evidence만 있음 (1회 diary)
      supporting.push(...directs);

      if (hasExplicitDiaryCompletion) {
        // 1회 diary라도 명시적 완료 표현이 있으면 COMPLETED candidate
        // (단, 단순 언급·반복 수행만으로는 불가)
        status = "COMPLETED";
      } else {
        // diary 1회 = COMPLETED 금지 → NOT_CONFIRMED
        status = "NOT_CONFIRMED";
      }
    }
    // else: evidence 없음 → NOT_CONFIRMED (기본값)

    // student_levels 달성 기록으로 NOT_CONFIRMED → COMPLETED 격상
    // (해당 sort_order에 매핑되는 level 달성이 있으면 강한 근거로 승격)
    if (status === "NOT_CONFIRMED" && hasStructuredCompletion) {
      status = "COMPLETED";
    }

    entries.push({
      curriculum_item_id: item.id,
      curriculum_title: item.title,
      status,
      sort_order: item.sort_order,
      supporting_evidence: supporting,
    });
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
