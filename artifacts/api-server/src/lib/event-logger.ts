/**
 * 이벤트 로거 — 운영 행위를 event_logs 테이블에 기록
 *
 * WP6: logOperationalError() 추가
 * - 기존 logEvent()는 감사/audit 목적 (누가 무엇을 변경했는가)
 * - logOperationalError()는 운영 진단 목적 (무엇이 실패했는가)
 * - 같은 event_logs 테이블을 사용하되 WP6 additive 컬럼 활용
 */
import { superAdminDb as db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type EventCategory =
  | "삭제"
  | "결제"
  | "구독"
  | "해지"
  | "권한"
  | "선생님"
  | "저장공간"
  | "휴무일"
  | "보안"
  | "로그인"
  | "백업"
  | "킬스위치"
  | "플랜"
  | "시스템"
  | "AI";   // WP10: AI 호출 trace/cost 기록

export interface EventLogParams {
  pool_id:     string;
  category:    EventCategory;
  actor_id?:   string;
  actor_name?: string;
  target?:     string;
  description: string;
  metadata?:   Record<string, unknown>;
}

export async function logEvent(params: EventLogParams): Promise<void> {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = params.metadata ? JSON.stringify(params.metadata) : "{}";
  await db.execute(sql`
    INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
    VALUES (
      ${id},
      ${params.pool_id},
      ${params.category},
      ${params.actor_id ?? null},
      ${params.actor_name ?? null},
      ${params.target ?? null},
      ${params.description},
      ${metadata}::jsonb
    )
  `);
}

// ── WP6: Operational Error Logging ───────────────────────────────────────────
// Uses WP6 additive columns: level, feature, error_code, safe_message,
// request_id, trace_id, entity_type, entity_id
// These columns are added via ALTER TABLE in the startup migration.

export type OpErrorLevel   = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type OpErrorFeature =
  | "AUTH" | "API" | "AI" | "DIARY" | "CURRICULUM" | "GROWTH"
  | "JOB" | "PUSH" | "UPLOAD" | "STORAGE" | "BILLING" | "SUBSCRIPTION"
  | "DATABASE" | "SYSTEM" | "UNKNOWN";

export interface OpErrorParams {
  pool_id:      string;            // required; use "global" for system-level errors
  feature:      OpErrorFeature;
  level:        OpErrorLevel;
  error_code:   string;            // e.g. "R2_PUT_FAILED", "PUSH_SEND_FAILED"
  safe_message: string;            // human-readable, NO secrets, NO PII beyond IDs
  actor_id?:    string;            // user_id if available
  request_id?:  string;           // correlate with AI traces / API requests
  trace_id?:    string;
  entity_type?: string;            // e.g. "file", "push", "batch_job"
  entity_id?:   string;           // e.g. file_id, job_id — NO object keys
  metadata?:    Record<string, unknown>; // safe subset only
}

/**
 * Best-effort operational error logger.
 * Failure of this logger MUST NOT propagate to the calling business logic.
 * Call with .catch(console.error) or void logOperationalError(...).
 */
export async function logOperationalError(params: OpErrorParams): Promise<void> {
  const id = `operr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Sanitize metadata — strip any secrets (belt-and-suspenders)
  const safeMetadata = sanitizeMetadata(params.metadata ?? {});
  const metaStr = JSON.stringify(safeMetadata);
  try {
    await db.execute(sql`
      INSERT INTO event_logs (
        id, pool_id, category, description,
        actor_id, metadata,
        level, feature, error_code, safe_message,
        request_id, trace_id, entity_type, entity_id
      ) VALUES (
        ${id},
        ${params.pool_id},
        ${"시스템"},
        ${`[${params.feature}] ${params.error_code}: ${params.safe_message}`},
        ${params.actor_id ?? null},
        ${metaStr}::jsonb,
        ${params.level},
        ${params.feature},
        ${params.error_code},
        ${params.safe_message},
        ${params.request_id ?? null},
        ${params.trace_id ?? null},
        ${params.entity_type ?? null},
        ${params.entity_id ?? null}
      )
    `);
  } catch {
    // Silently absorb — logging must never cascade into the calling operation
  }
}

// ── PII / Secret sanitization ─────────────────────────────────────────────────
const BLOCKED_KEYS = new Set([
  "password", "password_hash", "jwt", "token", "access_token", "refresh_token",
  "authorization", "api_key", "openai_key", "secret", "signing_key",
  "r2_secret", "signed_url", "prompt", "llm_response", "phone", "phone_number",
]);

function sanitizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === "string" && v.length > 500) {
      result[k] = v.slice(0, 200) + "...[truncated]";
    } else {
      result[k] = v;
    }
  }
  return result;
}
