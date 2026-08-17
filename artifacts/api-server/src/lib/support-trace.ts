/**
 * support-trace.ts — P0-OBSERVABILITY: Structured Production Request Trace
 *
 * POST /support/respond 한 요청에 대해 stage-by-stage trace를 수집,
 * 최종적으로 event_logs (category='SUPPORT') 에 단일 JSONB 레코드로 저장.
 *
 * 개인정보 보호 (spec §2):
 *   저장 금지: raw user message, raw AI answer, prompt, 전화, email, 이름, JWT
 *   저장 허용: request_id, case_id, pool_id, user_role, service_mode, stage names,
 *              pg error code/constraint, http_status, boolean flags
 *
 * 저장소: event_logs (기존 테이블 재사용 — 신규 테이블 생성 없음)
 *   category  = 'SUPPORT'
 *   target    = case_id
 *   description = 'SUPPORT_RESPOND_TRACE'
 *   metadata  = { stages, http_status, ... }
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── Stage names (spec §3) ─────────────────────────────────────────────────────

export type SupportStage =
  | "REQUEST_RECEIVED"
  | "CASE_RESOLVED"
  | "USER_MESSAGE_INSERT_START"
  | "USER_MESSAGE_INSERT_OK"
  | "USER_MESSAGE_INSERT_FAIL"
  | "AI_PROCESSING_START"
  | "AI_PROCESSING_OK"
  | "AI_PROCESSING_FAIL"
  | "RESOLUTION_START"
  | "RESOLUTION_DONE"
  | "RESOLUTION_FAIL"
  | "EVIDENCE_START"
  | "EVIDENCE_DONE"
  | "EVIDENCE_FAIL"
  | "LLM_START"
  | "LLM_DONE"
  | "LLM_FAIL"
  | "LLM_SKIPPED"
  | "AI_MESSAGE_INSERT_START"
  | "AI_MESSAGE_INSERT_OK"
  | "AI_MESSAGE_INSERT_FAIL"
  | "FINAL_STATE_START"
  | "FINAL_STATE_OK"
  | "FINAL_STATE_FAIL"
  | "HTTP_RESPONSE";

// ── DB error category (spec §4) ───────────────────────────────────────────────

export type DbErrorCategory =
  | "NOT_NULL"
  | "FK"
  | "ENUM"
  | "MISSING_TABLE"
  | "OTHER";

/** pg error code → human-safe category */
export function classifyPgError(err: unknown): DbErrorCategory {
  const code = (err as any)?.code ?? "";
  if (code === "23502") return "NOT_NULL";
  if (code === "23503") return "FK";
  if (code === "23514" || code === "23505") return "ENUM"; // check/unique
  if (code === "42P01") return "MISSING_TABLE";
  return "OTHER";
}

// ── Stage record ──────────────────────────────────────────────────────────────

export interface StageEntry {
  s: SupportStage;
  /** milliseconds since request start */
  t: number;
  [key: string]: unknown;
}

// ── Trace context ─────────────────────────────────────────────────────────────

export interface SupportTraceCtx {
  readonly request_id:    string;
  readonly case_id:       string;
  readonly pool_id:       string | null;
  readonly user_role:     string;
  readonly service_mode:  string;
  readonly start_ms:      number;
  readonly stages:        StageEntry[];
}

export function createSupportTrace(params: {
  request_id:   string;
  case_id:      string;
  pool_id:      string | null;
  user_role:    string;
  service_mode: string;
}): SupportTraceCtx {
  return {
    ...params,
    start_ms: Date.now(),
    stages:   [],
  };
}

/**
 * Append a stage entry to the trace.
 * `extra` must NOT contain raw message content, prompts, or PII.
 */
export function addStage(
  ctx: SupportTraceCtx,
  stage: SupportStage,
  extra: Record<string, unknown> = {}
): void {
  ctx.stages.push({ s: stage, t: Date.now() - ctx.start_ms, ...extra });
}

/**
 * Message contract trace (spec §5):
 * logs structural fields only — content value is NEVER recorded.
 */
export interface MessageContract {
  author_role:          string;
  author_user_id_is_null: boolean;
  case_id_present:      boolean;
  ticket_id_present:    boolean;
  message_type:         string;
  content_present:      boolean;
}

// ── Flush to event_logs ───────────────────────────────────────────────────────

function genTraceId(): string {
  return `str_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface FlushParams {
  http_status:     number;
  success:         boolean;
  safe_error_code?: string | null;
  /** Set on the HTTP_RESPONSE stage */
  answer_present?:   boolean;
  case_id_present?:  boolean;
}

/**
 * Write the accumulated trace to event_logs (best-effort, never throws).
 * Called exactly once per request at HTTP_RESPONSE time.
 */
export async function flushSupportTrace(
  ctx: SupportTraceCtx,
  params: FlushParams
): Promise<void> {
  try {
    const id = genTraceId();
    const latency_ms = Date.now() - ctx.start_ms;

    const metadata = {
      request_id:   ctx.request_id,
      case_id:      ctx.case_id,
      pool_id:      ctx.pool_id,
      user_role:    ctx.user_role,
      service_mode: ctx.service_mode,
      http_status:  params.http_status,
      success:      params.success,
      safe_error_code: params.safe_error_code ?? null,
      answer_present:  params.answer_present  ?? null,
      case_id_present: params.case_id_present ?? null,
      latency_ms,
      stages: ctx.stages,
    };

    await (superAdminDb as any).execute(sql`
      INSERT INTO event_logs
        (id, pool_id, category, actor_id, target, description, metadata)
      VALUES (
        ${id},
        ${ctx.pool_id},
        ${"SUPPORT"},
        ${null},
        ${ctx.case_id},
        ${"SUPPORT_RESPOND_TRACE"},
        ${JSON.stringify(metadata)}::jsonb
      )
    `);
  } catch {
    // telemetry failure must not affect response — silent
  }
}

/**
 * Immediate-flush for AI_MESSAGE_INSERT_FAIL:
 * captures actual pg error before any early-return path.
 * best-effort — never throws.
 */
export async function flushInsertFailStage(
  ctx: SupportTraceCtx,
  err: unknown,
  which: "DETERMINISTIC" | "LLM"
): Promise<void> {
  try {
    const id = genTraceId();
    const pgCode      = (err as any)?.code        ?? null;
    const pgConstraint= (err as any)?.constraint  ?? null;
    const pgColumn    = (err as any)?.column      ?? null;
    const pgTable     = (err as any)?.table       ?? null;
    const category    = classifyPgError(err);

    const metadata = {
      request_id:   ctx.request_id,
      case_id:      ctx.case_id,
      pool_id:      ctx.pool_id,
      user_role:    ctx.user_role,
      service_mode: ctx.service_mode,
      failure_stage: "AI_MESSAGE_INSERT_FAIL",
      which,
      pg_code:      pgCode,
      constraint:   pgConstraint,
      column:       pgColumn,
      table:        pgTable,
      error_category: category,
      stages: ctx.stages,
    };

    const id2 = genTraceId();
    await (superAdminDb as any).execute(sql`
      INSERT INTO event_logs
        (id, pool_id, category, actor_id, target, description, metadata)
      VALUES (
        ${id2},
        ${ctx.pool_id},
        ${"SUPPORT"},
        ${null},
        ${ctx.case_id},
        ${"SUPPORT_INSERT_FAIL_TRACE"},
        ${JSON.stringify(metadata)}::jsonb
      )
    `);
  } catch {
    // silent
  }
}
