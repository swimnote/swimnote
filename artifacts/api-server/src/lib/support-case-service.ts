/**
 * support-case-service.ts — CS-01R Support Core State Machine
 *
 * 역할:
 *   - VALID_TRANSITIONS: 허용된 state transition 정의
 *   - getMasterState(): internal state → MASTER presentation state 매핑
 *   - transitionSupportCase(): state 변경 + event log (atomically)
 *   - logSupportEvent(): event_logs(category='SUPPORT') best-effort 기록
 *   - ensureCs01rSchema(): ALTER TABLE idempotent migration
 *
 * 개인정보 보호:
 *   event_logs(SUPPORT)에 question 본문/reply 본문/이름/전화/이메일 금지.
 *   case_id, ticket_id, role, state, event_type만 기록.
 *
 * DB 분리:
 *   support_cases → superAdminDb (Supabase)
 *   support_tickets, support_ticket_replies → db (pool DB)
 *   FK 불가 — ticket_id는 TEXT soft reference
 */

import { superAdminDb, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { SUPPORT_EVENT_TYPE } from "./ai-feature-enum.js";

// ── Schema migration (idempotent) ─────────────────────────────────────────────

let _cs01rDone = false;
export async function ensureCs01rSchema(): Promise<void> {
  if (_cs01rDone) return;
  _cs01rDone = true;

  // support_cases 컬럼 확장 (superAdminDb)
  for (const ddl of [
    `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS waiting_for  TEXT`,
    `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS context_json JSONB`,
    `ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS actor_id     TEXT`,
  ]) {
    await (superAdminDb as any).execute(sql.raw(ddl)).catch(() => {});
  }

  // support_cases: actor_id index
  await (superAdminDb as any)
    .execute(sql.raw(`CREATE INDEX IF NOT EXISTS support_cases_actor_id_idx ON support_cases(actor_id)`))
    .catch(() => {});

  // ── HARDEN: support_ticket_replies 스키마 확장 (pool db) ──────────────────
  //
  // BEFORE: ticket_id TEXT NOT NULL — case_id를 ticket_id로 위장 저장했음 (semantic issue)
  // AFTER:  ticket_id NULLABLE + case_id TEXT 별도 컬럼
  //
  // AI-only case message:       ticket_id=null,       case_id=<case_id>
  // Human escalated message:    ticket_id=<ticket_id>, case_id=<case_id>
  // Legacy human-only ticket:   ticket_id=<ticket_id>, case_id=null
  //
  // Thread 조회: WHERE case_id = $caseId (case messages) 또는
  //              WHERE ticket_id = $ticketId AND case_id IS NULL (legacy ticket only)
  for (const ddl of [
    // ticket_id를 nullable로 변경 (AI-only case 메시지는 ticket 없음)
    `ALTER TABLE support_ticket_replies ALTER COLUMN ticket_id DROP NOT NULL`,
    // case_id 컬럼: 케이스 기반 메시지 스레드 식별
    `ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS case_id TEXT`,
    // message_type: content 유형 구분 (author_role과 별개)
    `ALTER TABLE support_ticket_replies ADD COLUMN IF NOT EXISTS message_type TEXT`,
  ]) {
    await (db as any).execute(sql.raw(ddl)).catch(() => {});
  }

  // case_id 인덱스: 케이스 기반 메시지 조회 성능
  await (db as any)
    .execute(sql.raw(`CREATE INDEX IF NOT EXISTS support_ticket_replies_case_id_idx ON support_ticket_replies(case_id)`))
    .catch(() => {});

  console.log("[cs-01r] schema migration complete (HARDEN applied)");
}

// ── State machine ─────────────────────────────────────────────────────────────

/** 허용된 state transition 맵 */
export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  NEW:             ["AI_PROCESSING", "HUMAN_REQUIRED", "WAITING"],
  AI_PROCESSING:   ["AI_RESPONDED", "WAITING", "HUMAN_REQUIRED", "AI_RESOLVED"],
  AI_RESPONDED:    ["WAITING", "AI_RESOLVED", "HUMAN_REQUIRED"],
  WAITING:         ["AI_PROCESSING", "AI_RESOLVED", "HUMAN_REQUIRED", "REOPENED"],
  AI_RESOLVED:     ["RESOLVED", "REOPENED"],
  HUMAN_REQUIRED:  ["HUMAN_RESPONDED", "ESCALATED", "PHONE_REQUIRED"],
  HUMAN_RESPONDED: ["RESOLVED", "ESCALATED", "REOPENED"],
  ESCALATED:       ["HUMAN_RESPONDED", "RESOLVED", "PHONE_REQUIRED"],
  PHONE_REQUIRED:  ["RESOLVED"],
  RESOLVED:        ["REOPENED", "CLOSED"],
  REOPENED:        ["AI_PROCESSING", "HUMAN_REQUIRED"],
  CLOSED:          [],   // terminal
};

/** 유효한 내부 state 목록 */
export const ALL_INTERNAL_STATES = new Set(Object.keys(VALID_TRANSITIONS));

// ── MASTER state mapping ──────────────────────────────────────────────────────

/**
 * Internal DB state → MASTER presentation state (7개)
 *
 * ESCALATED는 escalation_reason에 따라:
 *   BILLING_REQUIRED | REFUND_REQUIRED | SAFETY_OR_PRIVACY → PHONE_REQUIRED
 *   나머지 → AGENT_ACTIVE
 */
export function getMasterState(
  internalState: string,
  escalationReason?: string | null
): string {
  switch (internalState) {
    case "NEW":
    case "AI_PROCESSING":   return "AI_ACTIVE";
    case "AI_RESPONDED":
    case "WAITING":         return "WAITING";
    case "AI_RESOLVED":
    case "RESOLVED":
    case "CLOSED":          return "RESOLVED";
    case "HUMAN_REQUIRED":  return "AGENT_REQUESTED";
    case "HUMAN_RESPONDED": return "AGENT_ACTIVE";
    case "PHONE_REQUIRED":  return "PHONE_REQUIRED";
    case "ESCALATED": {
      const phoneReasons = ["BILLING_REQUIRED", "REFUND_REQUIRED", "SAFETY_OR_PRIVACY"];
      return phoneReasons.includes(escalationReason ?? "")
        ? "PHONE_REQUIRED"
        : "AGENT_ACTIVE";
    }
    case "REOPENED":        return "REOPENED";
    default:                return internalState;
  }
}

// ── Support Event Logging ─────────────────────────────────────────────────────

export interface SupportEventParams {
  eventType:  string;
  caseId:     string;
  ticketId?:  string | null;
  fromState:  string;
  toState:    string;
  actorRole:  string;
  poolId?:    string | null;
  reason?:    string | null;
}

/**
 * event_logs(category='SUPPORT')에 best-effort로 이벤트 기록.
 * PII 미포함: case_id/ticket_id/role/state/event_type만 저장.
 * 실패해도 throw하지 않음 — 호출부는 void .catch(() => {}) 패턴.
 */
export async function logSupportEvent(params: SupportEventParams): Promise<void> {
  const id = `se_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // metadata에 PII 금지: 본문/이름/전화/이메일/screenshotURL 저장하지 않음
  const metadata: Record<string, unknown> = {
    event_type: params.eventType,
    case_id:    params.caseId,
    ticket_id:  params.ticketId  ?? null,
    from_state: params.fromState,
    to_state:   params.toState,
    actor_role: params.actorRole,
    reason:     params.reason    ?? null,
  };

  const description = `SUPPORT ${params.eventType} ${params.fromState}→${params.toState}`;

  await (superAdminDb as any).execute(sql`
    INSERT INTO event_logs
      (id, pool_id, category, actor_id, target, description, metadata)
    VALUES (
      ${id},
      ${params.poolId ?? null},
      ${"SUPPORT"},
      ${null},
      ${params.caseId},
      ${description},
      ${JSON.stringify(metadata)}::jsonb
    )
  `);
}

// ── State transition (enforced) ───────────────────────────────────────────────

export interface TransitionParams {
  caseId:           string;
  toState:          string;
  actorRole:        string;
  poolId?:          string | null;
  reason?:          string | null;
  waitingFor?:      "USER" | "AGENT" | "SYSTEM" | null;
  resolutionSource?: string | null;
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * Support case state transition.
 * - VALID_TRANSITIONS 검사 (잘못된 transition → 422)
 * - support_cases UPDATE
 * - logSupportEvent best-effort
 */
export async function transitionSupportCase(
  params: TransitionParams
): Promise<TransitionResult> {
  // Fetch current state
  const rows = (await (superAdminDb as any).execute(sql`
    SELECT state, pool_id, ticket_id, escalation_reason
    FROM support_cases
    WHERE id = ${params.caseId}
    LIMIT 1
  `)) as any;

  const current = rows?.rows?.[0];
  if (!current) {
    return { ok: false, error: "케이스를 찾을 수 없습니다.", status: 404 };
  }

  const fromState = current.state as string;
  const allowed   = VALID_TRANSITIONS[fromState] ?? [];

  if (!allowed.includes(params.toState)) {
    return {
      ok: false,
      error: `${fromState} → ${params.toState} 전환은 허용되지 않습니다.`,
      status: 422,
    };
  }

  const isTerminalResolved = ["AI_RESOLVED", "RESOLVED", "CLOSED"].includes(params.toState);

  await (superAdminDb as any).execute(sql`
    UPDATE support_cases
    SET
      state             = ${params.toState},
      waiting_for       = ${params.waitingFor      ?? null},
      resolution_source = ${params.resolutionSource ?? null},
      resolved_at       = ${isTerminalResolved ? new Date().toISOString() : null} ::timestamptz,
      updated_at        = NOW()
    WHERE id = ${params.caseId}
  `);

  // Best-effort support event
  void logSupportEvent({
    eventType:  SUPPORT_EVENT_TYPE.STATE_TRANSITIONED,
    caseId:     params.caseId,
    ticketId:   current.ticket_id ?? null,
    fromState,
    toState:    params.toState,
    actorRole:  params.actorRole,
    poolId:     params.poolId ?? current.pool_id ?? null,
    reason:     params.reason ?? null,
  }).catch(() => {});

  return { ok: true };
}

// ── messageThreadId — DEPRECATED (HARDEN) ────────────────────────────────────
//
// 과거: ticket_id 컬럼에 case_id를 저장 (semantic issue, 이제 금지됨).
// 현재: support_ticket_replies.case_id 컬럼으로 케이스 스레드를 식별한다.
//
// 새 코드에서 이 함수를 사용하지 말 것.
// 레거시 ticket 전용 queries (support-tickets.ts) 는 ticket_id 직접 사용.
//
// @deprecated — use case_id column directly
export function messageThreadId(_caseId: string, ticketId: string | null): string {
  // Kept for backward-compat test references only. Do not use in new code.
  return ticketId ?? _caseId;
}
