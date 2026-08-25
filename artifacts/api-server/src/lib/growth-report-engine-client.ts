/**
 * growth-report-engine-client.ts
 *
 * APP → AI ENGINE HTTP client for Growth Report analysis.
 *
 * Environment:
 *   GROWTH_REPORT_ENGINE_URL        AI ENGINE base URL (required in production)
 *   GROWTH_REPORT_ENGINE_SECRET     Bearer token for server-to-server auth
 *   GROWTH_REPORT_ENGINE_TIMEOUT_MS Per-call timeout (default 120 000 ms, 2 min)
 *   GROWTH_REPORT_MAX_HISTORY_PERIODS Longitudinal depth (default 12)
 *
 * Canonical hash: SHA-256 of deep-key-sorted JSON (object key-order independent).
 * ENGINE WP5 uses the same canonical serialization — APP and ENGINE hashes must match.
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No metric interpretation
 *   - No question creation
 *   - No report re-analysis
 */

import { createHash } from "node:crypto";

// ─── Contract constants ───────────────────────────────────────────────────────

export const GR_CONTRACT_VERSION  = "GR-1.0" as const;
export const GR_SNAPSHOT_VERSION  = 1        as const;

// ─── Engine configuration ─────────────────────────────────────────────────────

const DEFAULT_ENGINE_TIMEOUT_MS   = 120_000; // Growth Report GPT can be slow
const DEFAULT_MAX_HISTORY_PERIODS = 12;

export function getEngineUrl(): string {
  return (process.env["GROWTH_REPORT_ENGINE_URL"] ?? "").trim();
}
export function getEngineSecret(): string {
  return (process.env["GROWTH_REPORT_ENGINE_SECRET"] ?? "").trim();
}
export function getEngineTimeoutMs(): number {
  const raw = Number(process.env["GROWTH_REPORT_ENGINE_TIMEOUT_MS"]);
  return raw > 0 ? raw : DEFAULT_ENGINE_TIMEOUT_MS;
}
export function getMaxHistoryPeriods(): number {
  const raw = Number(process.env["GROWTH_REPORT_MAX_HISTORY_PERIODS"]);
  return raw > 0 ? raw : DEFAULT_MAX_HISTORY_PERIODS;
}

// ─── Canonical hash ───────────────────────────────────────────────────────────

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return (obj as unknown[]).map(sortObjectKeys);
  const record = obj as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortObjectKeys(record[key]);
      return acc;
    }, {});
}

/**
 * computeCanonicalHash — SHA-256 of deep-key-sorted JSON.
 * Object key insertion order does NOT affect the output.
 * Must match ENGINE WP5 canonical serialization.
 */
export function computeCanonicalHash(payload: object): string {
  const sorted    = sortObjectKeys(payload);
  const canonical = JSON.stringify(sorted);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Snapshot / Request Types ─────────────────────────────────────────────────

export interface DiarySnapshotItem {
  id: string;
  lesson_date: string;              // "YYYY-MM-DD"
  common_content: string | null;
  student_notes: Array<{
    student_ref: string;            // student_id (PII-safe internal ref)
    content: string | null;
  }>;
  level?: string | null;
  stroke_code?: string | null;
  focus_points?: string | null;
}

export interface GrowthEventSnapshotItem {
  id: string;
  student_ref: string;
  occurred_at: string;              // ISO timestamp
  event_type: string;
  description: string | null;
  context: unknown;
  result: unknown;
  confidence: number | null;
  growth_match_status: string;
}

export interface AttendanceSnapshotItem {
  id: string;
  student_ref: string;
  lesson_date: string;              // attendance.date value
  status: string;
  duration_min?: number | null;
}

export interface CurriculumStateSnapshot {
  curriculum_id: string | null;
  current_level: string | null;
  stage: string | null;
  recent_topics: string[];
  mastery_flags: unknown;
  // GAUGE-07: curriculum progress snapshot (immutable at report creation time)
  confirmed_progress_pct: number | null;    // display_confirmed_pct at snapshot time
  active_confirmed_rank: number;             // SCP.active_confirmed_rank (0 = no data)
  active_total_count: number;                // SCP.active_confirmed_total (0 = no data)
  active_version_id: string | null;          // SCP.active_curriculum_version_id
  period_start_pct: number | null;           // previous PUBLISHED report confirmed_progress_pct
  progress_delta_pct: number | null;         // confirmed - period_start (null on first report)
  observation_session_count: number;         // SCP.observation_session_count (0 = no sessions)
}

export interface TeacherReviewSnapshot {
  reviewed_by?: string | null;
  reviewed_at?: string | null;
}

export interface LongitudinalSnapshot {
  metric_state_history: unknown[];
  positive_growth_signal_history: unknown[];
  success_condition_history: unknown[];
  support_lever_history: unknown[];
  parent_evidence_history: unknown[];
  observation_target_history: unknown[];
  previous_report_structured_results: unknown[];
}

export interface ParentAnswerSnapshot {
  question_id: string;
  metric_id: string;
  selected_values: unknown[];
  answered_at: string;
  parent_account_ref?: string | null;
}

export interface GrowthReportAnalysisRequest {
  contract_version: string;
  request_id: string;
  report_id: string;
  context: {
    student_id: string;
    pool_id: string;
    organization_id?: string | null;
    report_period: string;
    analysis_from: string | null;
    analysis_cutoff_at: string;
    timezone: string;
  };
  snapshot: {
    snapshot_version: number;
    payload_hash: string;
    created_at: string;
    diaries: DiarySnapshotItem[];
    growth_events: GrowthEventSnapshotItem[];
    attendance: AttendanceSnapshotItem[];
    curriculum_state: CurriculumStateSnapshot | null;
    teacher_review?: TeacherReviewSnapshot;
    longitudinal: LongitudinalSnapshot;
    parent_answers: ParentAnswerSnapshot[];
  };
}

// ─── Engine Response Types ────────────────────────────────────────────────────

export type EngineAnalysisStatus =
  | "COMPLETE"
  | "COMPLETE_WITH_QUESTIONS_AVAILABLE"
  | "COMPLETE_WITH_PARENT_EVIDENCE"
  | "PARTIAL"
  | "DATA_ACCUMULATING"; // Insufficient data — parent UI shows friendly accumulating message

const ENGINE_ANALYSIS_STATUSES = new Set<string>([
  "COMPLETE",
  "COMPLETE_WITH_QUESTIONS_AVAILABLE",
  "COMPLETE_WITH_PARENT_EVIDENCE",
  "PARTIAL",
  "DATA_ACCUMULATING",
]);

export interface EngineQuestion {
  engine_question_id: string;
  metric_id: string;
  question_text: string;
  answer_type: string;
  options: unknown[];
  parent_confirmable_behavior?: string | null;
  question_stage?: string | null;
  reason_codes?: unknown;
  sequence: number;
  is_required: boolean;
  metric_definition_version?: string | null;
  question_policy_version?: string | null;
}

export interface GrowthReportAnalysisResponse {
  request_id: string;
  report_id: string;
  analysis_status: EngineAnalysisStatus;
  questions: EngineQuestion[];
  report_content: Record<string, unknown>;
  sns_summary: {
    text?: string | null;
    share_safe: boolean;
    [key: string]: unknown;
  };
  fact_package: Record<string, unknown>;
  validation: {
    grounding: "PASS" | "REVISED_PASS" | "FAIL";
    growth_framing: "PASS" | "REVISED_PASS" | "FAIL";
  };
  trace: {
    payload_hash: string;
    [key: string]: unknown;
  };
  metric_evidence?: Record<string, unknown> | null;
  positive_signals?: unknown[] | null;
  synthesis?: Record<string, unknown> | null;
}

// ─── Error classification ─────────────────────────────────────────────────────

/** ENGINE error codes that are safe to retry */
export const RETRYABLE_ENGINE_ERROR_CODES = new Set([
  "COMPOSITION_PROVIDER_ERROR",
  "COMPOSITION_TIMEOUT",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
]);

/** ENGINE error codes that must NOT be retried */
export const NON_RETRYABLE_ENGINE_ERROR_CODES = new Set([
  "INVALID_CONTRACT",
  "PAYLOAD_HASH_MISMATCH",
  "UNKNOWN_METRIC_ID",
  "SOURCE_AFTER_ANALYSIS_CUTOFF",
  "IDEMPOTENCY_PAYLOAD_CONFLICT",
]);

export class EngineCallError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "EngineCallError";
  }
}

export function isRetryableEngineError(err: unknown): boolean {
  if (err instanceof EngineCallError) return err.retryable;
  // Network-level AbortError / ECONNREFUSED → retryable
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("timeout")  ||
      msg.includes("abort")    ||
      msg.includes("network")  ||
      msg.includes("econnrefused")
    );
  }
  return false;
}

export function isValidEngineAnalysisStatus(v: unknown): v is EngineAnalysisStatus {
  return typeof v === "string" && ENGINE_ANALYSIS_STATUSES.has(v);
}

export const GROUNDING_PASS_VALUES = new Set(["PASS", "REVISED_PASS"]);

// ─── Engine HTTP Client ───────────────────────────────────────────────────────

/** AI01-05: Engine call tracking result */
export interface GrEngineCallResult {
  response:        GrowthReportAnalysisResponse;
  /** Total HTTP attempts sent to the engine in this logical request */
  actualCallCount: number;
  /** Number of retries (attempts beyond the first) */
  retryCount:      number;
}

/**
 * analyzeGrowthReport — sends GrowthReportAnalysisRequest to AI ENGINE
 * POST /api/v1/growth-report/analyze.
 *
 * Auth: Authorization: Bearer <GROWTH_REPORT_ENGINE_SECRET>
 * Timeout: GROWTH_REPORT_ENGINE_TIMEOUT_MS (default 120 s)
 *
 * If GROWTH_REPORT_ENGINE_URL is not set the call is rejected without a network
 * request (prevents accidental production calls in development).
 *
 * AI01-05: Returns GrEngineCallResult so callers can record actual HTTP attempt counts.
 * The request_id is forwarded as both the body field and X-Request-Id header.
 *
 * NOTE: analysis_retry_count in the DB tracks cross-invocation retries (how many
 * times the worker has been re-scheduled for this report). It is NOT equivalent to
 * HTTP attempt count within a single invocation. Do NOT use it as actual_call_count.
 */
export async function analyzeGrowthReport(
  request: GrowthReportAnalysisRequest,
): Promise<GrEngineCallResult> {
  const baseUrl = getEngineUrl();
  if (!baseUrl) {
    // Validation failure — no HTTP request sent
    throw new EngineCallError(
      "ENGINE_URL_NOT_CONFIGURED",
      0,
      false,
      "GROWTH_REPORT_ENGINE_URL env var not set",
    );
  }

  const secret     = getEngineSecret();
  const timeoutMs  = getEngineTimeoutMs();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  // AI01-05: Single attempt — no retry in this client.
  // actualCallCount increments only when an HTTP request is actually sent.
  let actualCallCount = 0;

  try {
    actualCallCount = 1; // HTTP request is about to be sent
    const res = await fetch(`${baseUrl}/api/v1/growth-report/analyze`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        // AI01-05: propagate request_id as header for engine-side correlation
        "X-Request-Id":  request.request_id,
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body:   JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorCode = "ENGINE_HTTP_ERROR";
      let retryable = res.status >= 500 || res.status === 429;
      try {
        const body = (await res.json()) as { error_code?: string };
        if (typeof body?.error_code === "string") {
          errorCode = body.error_code;
          retryable  = RETRYABLE_ENGINE_ERROR_CODES.has(errorCode);
        }
      } catch {
        // JSON parse failure — keep defaults
      }
      throw new EngineCallError(
        errorCode,
        res.status,
        retryable,
        `ENGINE ${res.status}: ${errorCode}`,
      );
    }

    const response = (await res.json()) as GrowthReportAnalysisResponse;
    return { response, actualCallCount, retryCount: 0 };
  } catch (err) {
    if (err instanceof EngineCallError) throw err;
    const isAbort = (err as Error).name === "AbortError";
    throw new EngineCallError(
      isAbort ? "COMPOSITION_TIMEOUT" : "NETWORK_ERROR",
      0,
      true,
      (err as Error).message,
    );
  } finally {
    clearTimeout(timer);
  }
}
