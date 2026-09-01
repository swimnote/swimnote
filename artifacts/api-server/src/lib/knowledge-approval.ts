/**
 * knowledge-approval.ts — WP-CS16: Human Review / Knowledge Approval Governance
 *
 * 핵심 원칙:
 *  - AI가 Knowledge를 생성할 수 있으나, Production Truth는 인간이 확정.
 *  - PENDING → ACTIVE 전환은 명시적 human approval 없이 절대 불가.
 *  - 승인권한 = server-authoritative role (JWT req.user.role 기준).
 *  - client body role/reviewer_id 신뢰 금지.
 *
 * §0 절대 원칙:
 *  1. 새로운 LLM 호출 추가 금지.
 *  2. CS12 PENDING 21개 자동 ACTIVE 처리 금지.
 *  3. Production DB write 금지 (이번 WP).
 *  4. ACTIVE Knowledge 수정 금지 (테스트 목적).
 *  5. client claim role 신뢰 금지.
 *  6. 승인 결정 = server-authoritative role.
 */

// ── §2: Allowed Reviewer Roles ────────────────────────────────────────────────

/** APPROVE/REJECT/REQUEST_EDIT 가능한 역할 (server-authoritative, 불변) */
export const ALLOWED_REVIEWER_ROLES: readonly string[] = [
  "super_admin",
  "platform_admin",
];

/**
 * 역할이 승인권한을 가지는지 검사.
 * JWT req.user.role 기준 — client body role을 절대 신뢰하지 말 것.
 */
export function isApprovalAllowed(role: string | undefined): boolean {
  if (!role) return false;
  return (ALLOWED_REVIEWER_ROLES as string[]).includes(role);
}

/** §16: global Candidate는 super_admin/platform_admin만 승인 가능 */
export function isGlobalApprovalAllowed(role: string | undefined): boolean {
  return isApprovalAllowed(role); // global = same as general approval allowed
}

// ── §3 / §11: Status Model ────────────────────────────────────────────────────

/** Knowledge Candidate / Item Status */
export type ApprovalStatus =
  | "pending"
  | "active"
  | "rejected"
  | "edit_required"
  | "archived"
  | "superseded";

/** 허용 상태 전환 맵 — §4 STATE TRANSITION 기준 */
export const ALLOWED_TRANSITIONS: Record<ApprovalStatus, ApprovalStatus[]> = {
  pending:       ["active", "rejected", "edit_required"],
  edit_required: ["pending", "rejected"],
  active:        ["archived", "superseded"],
  rejected:      [],   // 자동 재활성화 금지; 재검토 없이 active 불가
  archived:      [],
  superseded:    [],
};

export function isTransitionAllowed(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ── §11: Reject Reasons ───────────────────────────────────────────────────────

export const REJECT_REASONS = [
  "UNSUPPORTED_SOURCE",
  "NOT_IMPLEMENTED",
  "WRONG_ROLE",
  "WRONG_MODE",
  "POLICY_UNVERIFIED",
  "DUPLICATE",
  "CONFLICT",
  "OUTDATED",
  "SECURITY_RISK",
  "OTHER",
] as const;

export type RejectReason = typeof REJECT_REASONS[number];

export function isValidRejectReason(r: string): r is RejectReason {
  return (REJECT_REASONS as readonly string[]).includes(r);
}

// ── §5: Approval Checklist ────────────────────────────────────────────────────

export type ChecklistDimension =
  | "SOURCE"
  | "IMPLEMENTATION"
  | "ROLE"
  | "MODE"
  | "POOL"
  | "ACTION"
  | "POLICY"
  | "SECURITY"
  | "GROUNDING"
  | "CONFLICT"
  | "FRESHNESS";

export type ChecklistOutcome = "PASS" | "WARN" | "FAIL" | "UNKNOWN";

export interface ChecklistItem {
  dimension:   ChecklistDimension;
  outcome:     ChecklistOutcome;
  reason?:     string;
  /** true = APPROVE 불가 blocker */
  is_blocker:  boolean;
}

export interface ChecklistResult {
  candidate_id: string;
  readiness:    "READY_FOR_HUMAN_REVIEW" | "REVIEW_REQUIRED" | "BLOCKED";
  items:        ChecklistItem[];
  blockers:     ChecklistItem[];
}

/** Candidate row 최소 인터페이스 (DB row 기준) */
export interface CandidateRow {
  id:                  string;
  item_type:           string;
  status:              string;
  scope?:              string | null;
  source_ref?:         string | null;
  source_type?:        string | null;
  affected_roles?:     string[] | null;
  affected_modes?:     string[] | null;
  feature?:            string | null;
  category?:           string | null;
  pool_id?:            string | null;
  content?:            string | null;
  answer?:             string | null;
  solution_steps?:     unknown;
  revision?:           number;
  updated_at?:         string | null;
  reviewed_by?:        string | null;
}

/**
 * §6 서버 측 사전 검증 — APPROVE 요청 시 최소 재검증.
 * UNIT-TESTABLE: DB 호출 없음.
 */
export function validateApprovalChecklist(candidate: CandidateRow): ChecklistResult {
  const items: ChecklistItem[] = [];

  // SOURCE: source_ref 존재 여부
  const hasSource = Boolean(candidate.source_ref && candidate.source_ref.trim().length > 0);
  items.push({
    dimension:  "SOURCE",
    outcome:    hasSource ? "PASS" : "FAIL",
    reason:     hasSource ? undefined : "source_ref 없음 — 승인 불가",
    is_blocker: !hasSource,
  });

  // IMPLEMENTATION: feature 또는 content 존재 여부 (최소 검증)
  const hasContent = Boolean(
    (candidate.content && candidate.content.trim().length > 10) ||
    (candidate.answer  && candidate.answer.trim().length  > 10)
  );
  items.push({
    dimension:  "IMPLEMENTATION",
    outcome:    hasContent ? "PASS" : "WARN",
    reason:     hasContent ? undefined : "content/answer 없거나 매우 짧음",
    is_blocker: false,
  });

  // ROLE: affected_roles 존재 여부
  const hasRoles = Array.isArray(candidate.affected_roles) && candidate.affected_roles.length > 0;
  // "parent" is legacy alias for "parent_account" — accepted as valid
  const VALID_ROLES = ["teacher", "pool_admin", "sub_admin", "parent_account", "parent", "all"];
  const rolesValid = !hasRoles || (candidate.affected_roles ?? []).every(r => VALID_ROLES.includes(r));
  items.push({
    dimension:  "ROLE",
    outcome:    hasRoles && rolesValid ? "PASS" : hasRoles && !rolesValid ? "FAIL" : "WARN",
    reason:     !hasRoles ? "affected_roles 미지정" : !rolesValid ? "알 수 없는 role 포함" : undefined,
    is_blocker: hasRoles && !rolesValid,
  });

  // MODE: affected_modes 유효성 (null = all modes)
  const VALID_MODES = ["normal", "x", "x_pending", "x_trial"];
  const modes = candidate.affected_modes;
  const modesValid = !modes || modes.length === 0 || modes.every(m => VALID_MODES.includes(m));
  items.push({
    dimension:  "MODE",
    outcome:    modesValid ? "PASS" : "FAIL",
    reason:     modesValid ? undefined : "알 수 없는 mode 포함",
    is_blocker: !modesValid,
  });

  // POOL: global scope 인지 확인
  const isGlobal = !candidate.pool_id && (candidate.scope === "global" || !candidate.scope);
  items.push({
    dimension:  "POOL",
    outcome:    isGlobal ? "PASS" : "WARN",
    reason:     isGlobal ? undefined : "pool_id 지정됨 — pool-specific candidate, 추가 검토 필요",
    is_blocker: false,
  });

  // ACTION: solution_steps 또는 answer에 수행 가능한 action 있는지 (존재 여부만)
  const hasAction = Boolean(
    candidate.solution_steps ||
    (candidate.answer && candidate.answer.length > 0) ||
    (candidate.content && candidate.content.includes("1."))
  );
  items.push({
    dimension:  "ACTION",
    outcome:    hasAction ? "PASS" : "WARN",
    reason:     hasAction ? undefined : "명확한 action step 없음",
    is_blocker: false,
  });

  // POLICY: billing/refund/withdrawal 관련 키워드 포함 시 WARN (policy 검증 필요)
  const POLICY_KEYWORDS = ["환불", "탈퇴", "결제", "구독", "billing", "withdraw", "refund", "payment"];
  const contentStr = `${candidate.content ?? ""} ${candidate.answer ?? ""}`.toLowerCase();
  const hasPolicyKeyword = POLICY_KEYWORDS.some(kw => contentStr.includes(kw));
  items.push({
    dimension:  "POLICY",
    outcome:    hasPolicyKeyword ? "WARN" : "PASS",
    reason:     hasPolicyKeyword ? "정책 관련 내용 포함 — policy claim 검증 필요" : undefined,
    is_blocker: false,
  });

  // SECURITY: 민감정보 키워드 검사
  const SENSITIVE_KEYWORDS = ["password", "비밀번호", "api_key", "secret", "token", "내부", "private"];
  const hasSensitive = SENSITIVE_KEYWORDS.some(kw => contentStr.includes(kw));
  items.push({
    dimension:  "SECURITY",
    outcome:    hasSensitive ? "FAIL" : "PASS",
    reason:     hasSensitive ? "민감정보 노출 가능성 — 검토 필요" : undefined,
    is_blocker: hasSensitive,
  });

  // GROUNDING: content가 있으면 PASS (source 범위 초과 여부는 human review에서 판단)
  items.push({
    dimension:  "GROUNDING",
    outcome:    hasContent ? "PASS" : "WARN",
    reason:     hasContent ? undefined : "content 부재 — grounding 불가",
    is_blocker: false,
  });

  // CONFLICT: hasUnresolvedConflict는 caller가 DB evidence 조회 후 주입
  // 여기서는 UNKNOWN (server route에서 별도 검사)
  items.push({
    dimension:  "CONFLICT",
    outcome:    "UNKNOWN",
    reason:     "ACTIVE Knowledge conflict 검사는 서버 라우트에서 수행",
    is_blocker: false,
  });

  // FRESHNESS: updated_at 기반 간단 판단
  const updatedAt = candidate.updated_at ? new Date(candidate.updated_at) : null;
  const daysSinceUpdate = updatedAt
    ? (Date.now() - updatedAt.getTime()) / 86_400_000
    : null;
  const freshnessOutcome: ChecklistOutcome =
    daysSinceUpdate === null  ? "UNKNOWN"
    : daysSinceUpdate < 30   ? "PASS"
    : daysSinceUpdate < 180  ? "WARN"
    : "FAIL";
  items.push({
    dimension:  "FRESHNESS",
    outcome:    freshnessOutcome,
    reason:     freshnessOutcome === "WARN" ? "30-180일 경과 — source 버전 재확인 권장"
               : freshnessOutcome === "FAIL" ? "180일 이상 경과 — source 유효성 재검증 필요"
               : undefined,
    is_blocker: false, // freshness는 blocker 아님; human reviewer 판단 사항
  });

  const blockers = items.filter(i => i.is_blocker);

  // BLOCKED: source 없음 / role invalid / mode invalid / security 이슈
  // REVIEW_REQUIRED: WARN 항목 있음 (policy, freshness, action 등)
  // READY_FOR_HUMAN_REVIEW: blockers 없고 WARN만 있거나 모두 PASS
  let readiness: ChecklistResult["readiness"];
  if (blockers.length > 0) {
    readiness = "BLOCKED";
  } else {
    const hasWarns = items.some(i => i.outcome === "WARN" || i.outcome === "UNKNOWN");
    readiness = hasWarns ? "REVIEW_REQUIRED" : "READY_FOR_HUMAN_REVIEW";
  }

  return { candidate_id: candidate.id, readiness, items, blockers };
}

// ── §14/15: CS12 Candidate Readiness Matrix (static audit) ───────────────────

export type Cs12ReadinessLabel = "READY_FOR_HUMAN_REVIEW" | "REVIEW_REQUIRED" | "BLOCKED";

export interface Cs12CandidateAudit {
  id:         string;
  item_type:  "FAQ" | "SOLUTION";
  p0_area:    string;
  readiness:  Cs12ReadinessLabel;
  note?:      string;
}

/**
 * CS12 21개 Candidate 정적 readiness 감사.
 * 실제 APPROVE를 수행하지 않으며, human reviewer에게 검토 준비 상태를 제공한다.
 *
 * KNOWN_ISSUE triage 계열(server/ai/push/billing error)은 REVIEW_REQUIRED:
 *   §15: 일반 triage Knowledge와 actual incident를 분리.
 *   "장애가 발생했다"는 고정사실 Knowledge로 쓰면 안 됨.
 *   현재 증상이 일시적 장애인지 영구 버그인지 human이 판단해야 함.
 */
export const CS12_CANDIDATE_READINESS: Cs12CandidateAudit[] = [
  // P0 — AUTH_ACCOUNT_WITHDRAWAL
  { id: "ki_cs12_account_withdrawal",             item_type: "FAQ",      p0_area: "AUTH_ACCOUNT_WITHDRAWAL",        readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_pool_admin_withdrawal_deferred", item_type: "FAQ",      p0_area: "AUTH_ACCOUNT_WITHDRAWAL",        readiness: "READY_FOR_HUMAN_REVIEW",
    note: "pool_admin 탈퇴 90일 유예 정책 — policy claim 검증 필요" },
  // P0 — AUTH_POOL_ACCESS_DENIED
  { id: "ki_cs12_pool_access_denied",             item_type: "FAQ",      p0_area: "AUTH_POOL_ACCESS_DENIED",        readiness: "READY_FOR_HUMAN_REVIEW" },
  // P0 — ATTENDANCE_PERMISSION_DENIED
  { id: "ki_cs12_attendance_permission",          item_type: "SOLUTION", p0_area: "ATTENDANCE_PERMISSION_DENIED",   readiness: "READY_FOR_HUMAN_REVIEW" },
  // P0 — NOTIFICATION_PERMISSION_OS
  { id: "ki_cs12_notification_permission_ios",    item_type: "SOLUTION", p0_area: "NOTIFICATION_PERMISSION_OS",    readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_notification_permission_android",item_type: "SOLUTION", p0_area: "NOTIFICATION_PERMISSION_OS",    readiness: "READY_FOR_HUMAN_REVIEW" },
  // P0 — DATA_NOT_VISIBLE_ROLE_MISMATCH
  { id: "ki_cs12_data_role_mismatch",             item_type: "FAQ",      p0_area: "DATA_NOT_VISIBLE_ROLE_MISMATCH", readiness: "READY_FOR_HUMAN_REVIEW" },
  // P0 — DATA_NOT_VISIBLE_FILTER
  { id: "ki_cs12_data_filter_check",              item_type: "SOLUTION", p0_area: "DATA_NOT_VISIBLE_FILTER",        readiness: "READY_FOR_HUMAN_REVIEW" },
  // P0 — KNOWN_ISSUE_SERVER_API (triage guide — §15 incident model separation note 필요)
  { id: "ki_cs12_server_error_triage",            item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_SERVER_API",         readiness: "REVIEW_REQUIRED",
    note: "§15: actual incident vs triage guide 구분 필요. 현재 내용은 일반 triage이나 human이 incident model과 충돌 없음을 확인해야 함." },
  // P0 — KNOWN_ISSUE_AI_PROVIDER
  { id: "ki_cs12_ai_error_triage",                item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_AI_PROVIDER",        readiness: "REVIEW_REQUIRED",
    note: "§15: AI 제공자 장애를 고정사실로 서술하지 않는지 확인. 일반 triage이면 수용 가능." },
  // P0 — KNOWN_ISSUE_PUSH
  { id: "ki_cs12_push_not_working",               item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_PUSH",               readiness: "REVIEW_REQUIRED",
    note: "§15: push 미수신을 영구 장애로 서술하지 않는지 확인. 트리아지 절차로 한정되어야 함." },
  // P0 — KNOWN_ISSUE_BILLING
  { id: "ki_cs12_billing_error_triage",           item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_BILLING",            readiness: "REVIEW_REQUIRED",
    note: "§15: 결제 오류를 고정 장애로 서술 금지. 결제 정책 claim은 policy 검증 필요." },
  // Additional non-P0 candidates (functionality specific)
  { id: "ki_cs12_diary_ai_failed",               item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_AI_PROVIDER",        readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_diary_save_failed",             item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_SERVER_API",         readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_diary_photo_upload_failed",     item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_SERVER_API",         readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_billing_payment_failed",        item_type: "SOLUTION", p0_area: "KNOWN_ISSUE_BILLING",            readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_parent_not_linked",             item_type: "SOLUTION", p0_area: "DATA_NOT_VISIBLE_ROLE_MISMATCH", readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_parent_diary_not_visible",      item_type: "FAQ",      p0_area: "DATA_NOT_VISIBLE_ROLE_MISMATCH", readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_x_setup_howto",                 item_type: "FAQ",      p0_area: "AUTH_POOL_ACCESS_DENIED",        readiness: "READY_FOR_HUMAN_REVIEW",
    note: "X mode 전용 — affected_modes=['x'] 확인 권장" },
  { id: "ki_cs12_growth_report_pending",         item_type: "FAQ",      p0_area: "DATA_NOT_VISIBLE_FILTER",        readiness: "READY_FOR_HUMAN_REVIEW" },
  { id: "ki_cs12_attendance_save_failed",        item_type: "SOLUTION", p0_area: "ATTENDANCE_PERMISSION_DENIED",   readiness: "READY_FOR_HUMAN_REVIEW" },
];

/** CS12 P0 커버리지 readiness 요약 */
export function getP0CoverageReadiness(): Record<string, Cs12ReadinessLabel> {
  const p0Areas = [
    "AUTH_ACCOUNT_WITHDRAWAL",
    "AUTH_POOL_ACCESS_DENIED",
    "ATTENDANCE_PERMISSION_DENIED",
    "NOTIFICATION_PERMISSION_OS",
    "DATA_NOT_VISIBLE_ROLE_MISMATCH",
    "DATA_NOT_VISIBLE_FILTER",
    "KNOWN_ISSUE_SERVER_API",
    "KNOWN_ISSUE_AI_PROVIDER",
    "KNOWN_ISSUE_PUSH",
    "KNOWN_ISSUE_BILLING",
  ];

  const result: Record<string, Cs12ReadinessLabel> = {};
  for (const area of p0Areas) {
    const candidates = CS12_CANDIDATE_READINESS.filter(c => c.p0_area === area);
    if (candidates.length === 0) {
      result[area] = "BLOCKED";
    } else if (candidates.every(c => c.readiness === "READY_FOR_HUMAN_REVIEW")) {
      result[area] = "READY_FOR_HUMAN_REVIEW";
    } else if (candidates.some(c => c.readiness === "BLOCKED")) {
      result[area] = "BLOCKED";
    } else {
      result[area] = "REVIEW_REQUIRED";
    }
  }
  return result;
}

// ── §21: No Auto-Promotion Guarantee ─────────────────────────────────────────

/**
 * §21 보장: PENDING → ACTIVE 자동 전환 코드 경로 목록.
 * 이 목록에 있는 경로 중 실제 자동 전환을 수행하는 코드가 없어야 한다.
 * 검사 결과: UNAUTHORIZED_AUTO_PROMOTION_PATHS = 0
 */
export const CHECKED_AUTO_PROMOTION_PATHS = [
  "background-worker.ts (retry-queue / makeup-expiry)",
  "pool-db-cs-12.ts (seed migration — status='pending' only)",
  "pool-db-cs-15.ts (incident migration — no knowledge status change)",
  "pool-db-cs-16.ts (approval migration — no auto-promotion)",
  "support-respond.ts (AI response — status='active' WHERE guard only reads)",
  "resolution-router.ts (routing only — no DB write to knowledge status)",
  "knowledge-search.ts /approve route — explicit human action required",
  "ai-engine-doc.ts (template pipeline — reads only)",
  "diary.ts (diary routes — no knowledge status write)",
] as const;

/**
 * UNAUTHORIZED_AUTO_PROMOTION_PATHS = 0
 * background job / migration / cron / AI response 중 어느 것도
 * PENDING → ACTIVE 자동 전환을 수행하지 않음.
 */
export const NO_AUTO_PROMOTION_GUARANTEE = true;

// ── §8: Approval Audit Record ────────────────────────────────────────────────

export type AuditDecision = "APPROVE" | "REJECT" | "REQUEST_EDIT" | "ROLLBACK";

export interface ApprovalAuditRecord {
  candidate_id:          string;
  previous_status:       string;
  new_status:            string;
  reviewer_id:           string;   // JWT req.user.id — client body 무시
  reviewer_role:         string;   // JWT req.user.role — client body 무시
  reviewed_at:           string;   // ISO timestamp
  decision:              AuditDecision;
  review_notes?:         string;
  reject_reason?:        RejectReason;
  request_id:            string;   // CS15 traceability 연결
  candidate_revision:    number;
  resulting_knowledge_id?: string; // approve → active 시 knowledge_id
  source_version?:       string;   // source_ref의 version
}

/**
 * 감사 기록 생성 — reviewer는 JWT actor 기준.
 * §9: client body reviewer_id 무시.
 */
export function buildApprovalAuditRecord(
  candidate: Pick<CandidateRow, "id" | "status" | "revision">,
  actor: { id: string; role: string },
  decision: AuditDecision,
  newStatus: string,
  requestId: string,
  opts?: {
    review_notes?:   string;
    reject_reason?:  RejectReason;
    resulting_knowledge_id?: string;
    source_version?: string;
  }
): ApprovalAuditRecord {
  return {
    candidate_id:          candidate.id,
    previous_status:       candidate.status,
    new_status:            newStatus,
    reviewer_id:           actor.id,    // JWT actor only — §9
    reviewer_role:         actor.role,  // JWT role only — §9
    reviewed_at:           new Date().toISOString(),
    decision,
    review_notes:          opts?.review_notes,
    reject_reason:         opts?.reject_reason,
    request_id:            requestId,
    candidate_revision:    candidate.revision ?? 1,
    resulting_knowledge_id: opts?.resulting_knowledge_id,
    source_version:        opts?.source_version,
  };
}

/** AI가 reviewer로 기록되면 FAIL (§8) */
export function isAiReviewerAttempt(reviewerId: string, reviewerRole: string): boolean {
  const AI_IDS = ["ai", "system", "agent", "llm", "openai", "anthropic", "gemini"];
  return AI_IDS.some(id =>
    reviewerId.toLowerCase().includes(id) ||
    reviewerRole.toLowerCase().includes(id)
  );
}

// ── §19: Rollback Support ─────────────────────────────────────────────────────

/** §19: 잘못 승인된 Knowledge rollback — ACTIVE → ARCHIVED */
export function isRollbackAllowed(
  role: string | undefined,
  currentStatus: string
): { allowed: boolean; reason?: string } {
  if (!isApprovalAllowed(role)) {
    return { allowed: false, reason: "승인권한 없음 — super_admin 또는 platform_admin만 rollback 가능" };
  }
  if (currentStatus !== "active") {
    return { allowed: false, reason: `rollback은 active 상태만 가능 (현재: ${currentStatus})` };
  }
  return { allowed: true };
}

// ── §20: Approval Trace ───────────────────────────────────────────────────────

/** HTTP response에 노출할 approval trace (reviewer 개인정보 제외) */
export interface PublicApprovalTrace {
  candidate_id:    string;
  status:          string;
  approved_at?:    string;
  revision:        number;
  // reviewed_by / reviewer_role은 HTTP response에 노출 안 함 (§20)
}

export function buildPublicApprovalTrace(
  candidate: Pick<CandidateRow, "id" | "status" | "revision" | "reviewed_by"> & {
    reviewed_at?: string | null;
  }
): PublicApprovalTrace {
  return {
    candidate_id: candidate.id,
    status:       candidate.status,
    approved_at:  candidate.status === "active" ? (candidate.reviewed_at ?? undefined) : undefined,
    revision:     candidate.revision ?? 1,
    // reviewer identity는 내부 audit에만 (§20)
  };
}
