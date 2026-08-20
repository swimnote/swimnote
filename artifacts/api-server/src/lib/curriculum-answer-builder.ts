/**
 * curriculum-answer-builder.ts — WP-A Answer Builder
 *
 * Intent + Evidence + Progress를 종합하여
 * 최적 Answer Mode와 Grounded Package를 결정.
 *
 * Answer Mode:
 *   DIRECT_DB     — DB 사실만으로 충분히 답변 가능 (quota 0)
 *   GROUNDED_GPT  — 실제 Evidence를 근거로 GPT 답변 필요 (quota +1)
 *   HUMAN_ONLY    — 서버/GPT 답변 불가, 교사 직접 응대 필요 (quota 0)
 *
 * 원칙:
 *   - GPT가 학생 progress 판단하지 않음
 *   - 전문 DB(curriculum)를 학생 actual evidence로 사용 금지
 *   - evidence 없는데 GROUNDED_GPT 강제 금지
 *   - WP-B를 위한 knowledge_request 패키지 준비
 */

import type { ParsedIntent } from "./curriculum-intent-parser.js";
import type { EvidenceBundle } from "./curriculum-evidence-retriever.js";
import type {
  ProgressResolution,
  CurriculumItemRef,
} from "./curriculum-progress-resolver.js";

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export type AnswerMode = "DIRECT_DB" | "GROUNDED_GPT" | "HUMAN_ONLY";

export interface KnowledgeRequest {
  feature: "parent_curriculum_search";
  stroke?: string;
  skill?: string;
  requested_types: Array<"PRINCIPLE" | "COACHING_TIP" | "CAUTION">;
}

/**
 * WP-A 최종 출력 패키지.
 * parent_curriculum_messages.metadata 에 JSON으로 저장 가능.
 */
export interface GroundedPackage {
  student_id: string;
  query: string;
  intent: ParsedIntent;
  evidence: EvidenceBundle;
  progress_state: ProgressResolution;
  /** 현재 IN_PROGRESS / REVIEW 상태 항목 (없으면 null) */
  curriculum_current: CurriculumItemRef | null;
  /** Progress Resolver가 계산한 next item */
  curriculum_next: CurriculumItemRef | null;
  answer_mode: AnswerMode;
  /** GROUNDED_GPT 시 WP-B Engine에 전달할 knowledge 요청 패키지 */
  knowledge_request: KnowledgeRequest | null;
  /** 메타 정보 (WP-B 통합용) */
  meta: {
    has_direct_evidence: boolean;
    has_tracked_evidence: boolean;
    has_level_history: boolean;
    evidence_item_count: number;
  };
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

function hasUsableEvidence(evidence: EvidenceBundle): boolean {
  return (
    evidence.direct.length > 0 ||
    evidence.tracked.length > 0 ||
    evidence.level_history.length > 0
  );
}

/**
 * 현재 IN_PROGRESS 또는 REVIEW 상태 항목 중 sort_order가 가장 높은 것 반환.
 */
function findCurrentItem(
  progress: ProgressResolution,
): CurriculumItemRef | null {
  const activeEntries = progress.entries.filter(
    (e) => e.status === "IN_PROGRESS" || e.status === "REVIEW",
  );
  if (activeEntries.length === 0) return null;
  activeEntries.sort((a, b) => b.sort_order - a.sort_order);
  const e = activeEntries[0];
  return {
    id: e.curriculum_item_id,
    title: e.curriculum_title,
    sort_order: e.sort_order,
  };
}

/**
 * intent에 맞는 knowledge_request 생성.
 * DIRECT_DB / HUMAN_ONLY 모드에서는 null 반환.
 */
function buildKnowledgeRequest(
  intent: ParsedIntent,
  mode: AnswerMode,
): KnowledgeRequest | null {
  if (mode !== "GROUNDED_GPT") return null;

  const base: KnowledgeRequest = {
    feature: "parent_curriculum_search",
    requested_types: ["PRINCIPLE", "COACHING_TIP", "CAUTION"],
  };

  if (intent.stroke) base.stroke = intent.stroke;
  if (intent.skill) base.skill = intent.skill;

  return base;
}

// ── Answer Mode 결정 로직 ─────────────────────────────────────────────────────

/**
 * intent + evidence + progress를 종합하여 AnswerMode를 결정.
 *
 * 결정 규칙:
 *   HUMAN_ONLY  → 의도가 HUMAN_ONLY인 경우
 *   DIRECT_DB   → DB 사실만으로 충분히 답변 가능한 경우:
 *                  CURRENT_PROGRESS + evidence + level_history 있음
 *                  RECENT_LESSONS + IN_PROGRESS 항목 있음
 *                  LEVEL_PROGRESS + level_history 있음
 *   GROUNDED_GPT → 실제 evidence가 있고 설명이 필요한 경우
 *   DIRECT_DB   → evidence가 전혀 없는 경우도 (no evidence → DB로만 답변, evidence 없음 명시)
 */
function determineAnswerMode(
  intent: ParsedIntent,
  evidence: EvidenceBundle,
  progress: ProgressResolution,
): AnswerMode {
  const { intent: i } = intent;

  // HUMAN_ONLY 최우선
  if (i === "HUMAN_ONLY") return "HUMAN_ONLY";

  const hasEvidence = hasUsableEvidence(evidence);
  const hasTracked = evidence.tracked.length > 0;
  const hasLevelHistory = evidence.level_history.length > 0;
  const hasCurrentItem = findCurrentItem(progress) !== null;

  // LEVEL_PROGRESS: level_history만 있어도 DIRECT_DB로 충분
  if (i === "LEVEL_PROGRESS") {
    return hasLevelHistory ? "DIRECT_DB" : "GROUNDED_GPT";
  }

  // RECENT_LESSONS: 현재 진행 중인 항목이 명확하면 DIRECT_DB
  if (i === "RECENT_LESSONS") {
    return hasCurrentItem ? "DIRECT_DB" : (hasEvidence ? "GROUNDED_GPT" : "DIRECT_DB");
  }

  // CURRENT_PROGRESS: evidence가 있으면 GROUNDED_GPT (종합 설명 필요), 없으면 DIRECT_DB (없음 명시)
  if (i === "CURRENT_PROGRESS") {
    return hasTracked ? "GROUNDED_GPT" : "DIRECT_DB";
  }

  // STROKE_PROGRESS / SKILL_STATUS: evidence 있으면 GROUNDED_GPT, 없으면 DIRECT_DB (없음 명시)
  if (i === "STROKE_PROGRESS" || i === "SKILL_STATUS") {
    return hasEvidence ? "GROUNDED_GPT" : "DIRECT_DB";
  }

  // NEXT_STEP: next_item이 있으면 GROUNDED_GPT (다음 단계 설명 필요)
  if (i === "NEXT_STEP") {
    return progress.next_item ? "GROUNDED_GPT" : "DIRECT_DB";
  }

  // WHY_CURRENT_STEP: 항상 설명 필요 → GROUNDED_GPT (단, evidence 없으면 DIRECT_DB)
  if (i === "WHY_CURRENT_STEP") {
    return hasEvidence ? "GROUNDED_GPT" : "DIRECT_DB";
  }

  // PROGRESS_CHANGE: 발전/변화 설명 → evidence 있으면 GROUNDED_GPT
  if (i === "PROGRESS_CHANGE") {
    return hasTracked ? "GROUNDED_GPT" : "DIRECT_DB";
  }

  // CURRICULUM_INFO: 커리큘럼 정보 → GROUNDED_GPT (evidence 여부와 무관)
  if (i === "CURRICULUM_INFO") {
    return "GROUNDED_GPT";
  }

  // UNKNOWN: evidence 있으면 GROUNDED_GPT, 없으면 DIRECT_DB
  return hasEvidence ? "GROUNDED_GPT" : "DIRECT_DB";
}

// ── 메인 함수 ─────────────────────────────────────────────────────────────────

/**
 * WP-A 최종 Grounded Package 빌드.
 *
 * WP-B에서 parent-curriculum.ts 라우트에 연결 예정.
 * 현재는 독립 lib로 완성 — 직접 GPT 호출 없음.
 *
 * @param studentId   students.id
 * @param query       학부모 원문 질문
 * @param intent      parseIntent() 결과
 * @param evidence    retrieveEvidence() 결과
 * @param progress    resolveProgress() 결과
 */
export function buildGroundedPackage(
  studentId: string,
  query: string,
  intent: ParsedIntent,
  evidence: EvidenceBundle,
  progress: ProgressResolution,
): GroundedPackage {
  const answerMode = determineAnswerMode(intent, evidence, progress);
  const curriculumCurrent = findCurrentItem(progress);
  const curriculumNext = progress.next_item;
  const knowledgeRequest = buildKnowledgeRequest(intent, answerMode);

  return {
    student_id: studentId,
    query,
    intent,
    evidence,
    progress_state: progress,
    curriculum_current: curriculumCurrent,
    curriculum_next: curriculumNext,
    answer_mode: answerMode,
    knowledge_request: knowledgeRequest,
    meta: {
      has_direct_evidence: evidence.direct.length > 0,
      has_tracked_evidence: evidence.tracked.length > 0,
      has_level_history: evidence.level_history.length > 0,
      evidence_item_count:
        evidence.direct.length +
        evidence.tracked.length +
        evidence.inferred.length,
    },
  };
}
