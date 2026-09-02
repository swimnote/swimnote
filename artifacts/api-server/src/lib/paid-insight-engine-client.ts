/**
 * paid-insight-engine-client.ts
 *
 * APP → AI ENGINE HTTP client for Paid Insight (Question Planning + Analysis).
 *
 * Environment:
 *   PARENT_CURRICULUM_ENGINE_URL  AI ENGINE base URL (shared with curriculum client)
 *   JWT_SECRET                    HS256 shared secret (same as curriculum client)
 *
 * Auth: server-to-server HS256 JWT signed with JWT_SECRET.
 *   Payload: { userId: poolId, role: 'pool_admin', poolId, tv: 1 }
 *
 * Endpoints:
 *   POST /api/v1/paid-insight/questions  — ~5 s
 *   POST /api/v1/paid-insight/analysis   — ~150 s
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No professional judgment generation
 *   - No growth analysis
 *   - Mobile App MUST NOT call AI Engine directly
 */

import jwt from "jsonwebtoken";

// ─── Schema version ────────────────────────────────────────────────────────────

export const PI_SCHEMA_VERSION = "1.0" as const;

// ─── Engine configuration ─────────────────────────────────────────────────────

export const PI_QUESTION_TIMEOUT_MS  =  15_000; // 5 s contract + buffer
export const PI_ANALYSIS_TIMEOUT_MS  = 165_000; // 150 s contract + buffer

export function getPaidInsightEngineUrl(): string {
  return (process.env["PARENT_CURRICULUM_ENGINE_URL"] ?? "").trim().replace(/\/+$/, "");
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class PaidInsightEngineError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "PaidInsightEngineError";
  }
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

export function generatePaidInsightEngineJwt(poolId: string): string {
  const secret = (process.env["JWT_SECRET"] ?? "").trim();
  if (!secret) {
    throw new PaidInsightEngineError(
      "JWT_SECRET_NOT_CONFIGURED",
      0,
      false,
      "JWT_SECRET env var not set — cannot authenticate with AI ENGINE",
    );
  }
  return jwt.sign(
    { userId: poolId, role: "pool_admin", poolId, tv: 1 },
    secret,
    { algorithm: "HS256", expiresIn: "5m" },
  );
}

// ─── Subject reference ───────────────────────────────────────────────────────

export interface PiSubjectRef {
  student_id: string;
  pool_id:    string;
}

// ─── Report context ───────────────────────────────────────────────────────────

export interface PiReportContext {
  report_id:     string;
  report_period?: string | null;
}

// ─── Snapshot (assembled by APP server, sent to AI Engine) ────────────────────

export interface PiSnapshotStudent {
  student_id:    string;
  birth_date?:   string | null;
  current_level?: string | null;
}

export interface PiSnapshotLessonRecord {
  date:       string;
  note?:      string | null;
  teacher_id?: string | null;
}

export interface PiSnapshotLevelHistory {
  level_name: string;
  confirmed_at: string;
}

export interface PiSnapshotCurriculumProgress {
  current_curriculum_id?: string | null;
  confirmed_progress_pct?: number | null;
  active_progress_pct?:    number | null;
}

export interface PiSnapshotGrowthEvent {
  curriculum_item_id?: string | null;
  growth_match_status: string;
  created_at:          string;
}

export interface PiSnapshotGrowthReport {
  report_id:      string;
  report_type:    string;
  report_period?: string | null;
  published_at?:  string | null;
  summary_text?:  string | null;
}

export interface GrowthDataSnapshot {
  schema_version:       string;
  assembled_at:         string;
  pool_id:              string;
  student:              PiSnapshotStudent;
  lesson_records:       PiSnapshotLessonRecord[];
  lesson_count:         number;
  level_history:        PiSnapshotLevelHistory[];
  curriculum_progress?: PiSnapshotCurriculumProgress | null;
  growth_events:        PiSnapshotGrowthEvent[];
  previous_reports:     PiSnapshotGrowthReport[];
  /** Optional: may be absent if student has no paid insight history */
  previous_paid_insights?: PiSnapshotGrowthReport[];
  /** Optional: video observation metadata if any */
  video_metadata?:      unknown | null;
}

// ─── Question Planning ────────────────────────────────────────────────────────

export interface PiExistingParentAnswer {
  question_id:  string;
  answer:       unknown;
  answered_at:  string;
}

export interface PiQuestionRequest {
  schema_version:          typeof PI_SCHEMA_VERSION;
  request_id:              string;
  subject_ref:             PiSubjectRef;
  report_context:          PiReportContext;
  snapshot_request:        GrowthDataSnapshot;
  existing_parent_answers: PiExistingParentAnswer[];
}

export type PiQuestionPlanStatus = "READY" | "NEEDS_PARENT_INPUT" | "INSUFFICIENT_EVIDENCE";

export interface PiQuestionOption {
  value: string;
  label: string;
}

export interface PiQuestion {
  question_id:   string;
  question_text: string;
  answer_type:   "single_choice" | "multi_choice" | "scale" | "short_text";
  options?:      PiQuestionOption[];
  is_required?:  boolean;
  metric_id?:    string | null;
  sequence?:     number;
}

export interface PiQuestionResponse {
  request_id:    string;
  schema_version: string;
  status:        PiQuestionPlanStatus;
  questions:     PiQuestion[];
  message?:      string | null;
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

export interface PiAnalysisRequest {
  schema_version:    typeof PI_SCHEMA_VERSION;
  request_id:        string;
  subject_ref:       PiSubjectRef;
  report_context:    PiReportContext;
  snapshot_request:  GrowthDataSnapshot;
  parent_answers:    PiExistingParentAnswer[];
}

export interface PiAnalysisResponse {
  request_id:            string;
  schema_version:        string;
  summary?:              string | null;
  swimming_progress?:    unknown | null;
  learning_strengths?:   unknown | null;
  growth_patterns?:      unknown | null;
  effective_conditions?: unknown | null;
  growth_blockers?:      unknown | null;
  lesson_strategy?:      unknown | null;
  next_growth_direction?: unknown | null;
  home_support?:         unknown | null;
  teacher_4week_plan?:   unknown | null;
  parent_4week_plan?:    unknown | null;
  roadmap_8_12_weeks?:   unknown | null;
  next_observation_targets?: unknown | null;
  confidence?:           unknown | null;
  limitations?:          string | null;
  claim_evidence_map?:   unknown | null;
  parent_reported?:      unknown | null;
  trace?:                unknown | null;
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function mapEngineError(status: number, body: unknown): PaidInsightEngineError {
  const b = (typeof body === "object" && body !== null) ? body as any : {};
  const code    = String(b.error_code ?? "ENGINE_ERROR");
  const message = String(b.message   ?? "AI Engine error");
  const retryable = b.retryable === true ||
                    status === 429 || status === 503 || status === 504;
  return new PaidInsightEngineError(code, status, retryable, message);
}

async function enginePost<Resp>(
  path: string,
  payload: unknown,
  engineJwt: string,
  requestId: string,
  timeoutMs: number,
): Promise<Resp> {
  const baseUrl = getPaidInsightEngineUrl();
  if (!baseUrl) {
    throw new PaidInsightEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      0,
      false,
      "PARENT_CURRICULUM_ENGINE_URL env var not set",
    );
  }

  const url = `${baseUrl}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${engineJwt}`,
        "X-Request-Id":  requestId,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError";
    throw new PaidInsightEngineError(
      isAbort ? "ENGINE_TIMEOUT" : "ENGINE_NETWORK_ERROR",
      0,
      true,
      isAbort ? `AI Engine timed out after ${timeoutMs}ms` : `AI Engine network error: ${err.message}`,
    );
  }
  clearTimeout(timer);

  let body: unknown;
  try { body = await resp.json(); } catch { body = null; }

  if (!resp.ok) throw mapEngineError(resp.status, body);
  return body as Resp;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * planPaidInsightQuestions — POST /api/v1/paid-insight/questions
 *
 * Timeout: PI_QUESTION_TIMEOUT_MS (~15 s).
 * Returns adaptive questions (0..N); 0 questions + status=READY means proceed.
 */
export async function planPaidInsightQuestions(
  request: PiQuestionRequest,
): Promise<PiQuestionResponse> {
  const engineJwt = generatePaidInsightEngineJwt(request.subject_ref.pool_id);
  return enginePost<PiQuestionResponse>(
    "/api/v1/paid-insight/questions",
    request,
    engineJwt,
    request.request_id,
    PI_QUESTION_TIMEOUT_MS,
  );
}

/**
 * runPaidInsightAnalysis — POST /api/v1/paid-insight/analysis
 *
 * Timeout: PI_ANALYSIS_TIMEOUT_MS (~165 s).
 * APP server MUST NOT call this without a verified payment context.
 */
export async function runPaidInsightAnalysis(
  request: PiAnalysisRequest,
): Promise<PiAnalysisResponse> {
  const engineJwt = generatePaidInsightEngineJwt(request.subject_ref.pool_id);
  return enginePost<PiAnalysisResponse>(
    "/api/v1/paid-insight/analysis",
    request,
    engineJwt,
    request.request_id,
    PI_ANALYSIS_TIMEOUT_MS,
  );
}
