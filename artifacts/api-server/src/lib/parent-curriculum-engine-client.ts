/**
 * parent-curriculum-engine-client.ts
 *
 * APP → AI ENGINE HTTP client for Parent Curriculum Search.
 *
 * Environment:
 *   PARENT_CURRICULUM_ENGINE_URL        AI ENGINE base URL (required)
 *   PARENT_CURRICULUM_ENGINE_SECRET     Bearer token for server-to-server auth
 *   PARENT_CURRICULUM_ENGINE_TIMEOUT_MS Per-call timeout (default 60 000 ms)
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No question interpretation
 *   - No curriculum knowledge
 *   - No GPT calls
 */

// ─── Contract constants ────────────────────────────────────────────────────────

export const PC_SCHEMA_VERSION = "1.0" as const;
export const PC_FEATURE        = "parent_curriculum_search" as const;

// ─── Engine configuration ─────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000; // curriculum search is faster than growth report

export function getParentCurriculumEngineUrl(): string {
  return (process.env["PARENT_CURRICULUM_ENGINE_URL"] ?? "").trim();
}
export function getParentCurriculumEngineSecret(): string {
  return (process.env["PARENT_CURRICULUM_ENGINE_SECRET"] ?? "").trim();
}
export function getParentCurriculumEngineTimeoutMs(): number {
  const raw = Number(process.env["PARENT_CURRICULUM_ENGINE_TIMEOUT_MS"]);
  return raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

// ─── Request / Response types ─────────────────────────────────────────────────

export interface PcCurriculumItem {
  id:       string;
  title:    string;
  content:  string;
  level?:   string | null;
  order:    number;
}

export interface PcCurriculumScope {
  source:           "POOL" | "X_GLOBAL" | "X_POOL";
  template_set_id?: string;
  curriculum_items: PcCurriculumItem[];
}

export interface PcStudentProgress {
  current_curriculum_id?: string;
}

/**
 * WP1.2: Recent conversation context entry.
 * ENGINE 측 질문 이해 보조용. Grounding source 아님.
 */
export interface PcRecentMessage {
  role:    "USER" | "ASSISTANT";
  content: string;
}

export interface ParentCurriculumEngineRequest {
  request_id:     string;
  schema_version: "1.0";
  feature:        "parent_curriculum_search";
  query:          string;
  context: {
    pool_id:              string;
    pool_name:            string;
    student_id:           string;
    mode:                 "NORMAL" | "X";
    curriculum_scope:     PcCurriculumScope;
    student_progress?:    PcStudentProgress;
    /**
     * WP1.2: 최근 대화 context (optional).
     * - 최대 6 messages (권장 3 turn = USER 3 + ASSISTANT 3)
     * - 오래된 순 → 최신 순
     * - 현재 query 미포함
     * - 질문 이해용 보조 context. Grounding source 아님.
     */
    recent_conversation?: PcRecentMessage[];
  };
}

export interface PcResultProgress {
  title:   string;
  summary: string;
}

export interface ParentCurriculumEngineResponse {
  request_id:     string;
  schema_version: string;
  feature:        string;
  result: {
    answer:            string;
    current_progress?: PcResultProgress | null;
    next_step?:        PcResultProgress | null;
  };
  grounding: {
    curriculum_ids:         string[];
    knowledge_ids?:         string[];
    student_progress_used?: boolean;
    validation:             string;
  };
  meta?: {
    intent?:                    string;
    mode?:                      string;
    curriculum_source?:         string;
    engine_version?:            string;
    model?:                     string;
    latency_ms?:                number;
    /** WP1.2: ENGINE이 recent_conversation을 실제로 사용했는지 여부. */
    conversation_context_used?: boolean;
  };
}

// ─── Error classification ──────────────────────────────────────────────────────

export const PC_RETRYABLE_ERROR_CODES = new Set([
  "COMPOSITION_TIMEOUT",
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "GENERATION_FAILED",
]);

export class ParentCurriculumEngineError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "ParentCurriculumEngineError";
  }
}

// ─── Engine HTTP Client ────────────────────────────────────────────────────────

/** AI01-05: Engine call tracking result */
export interface PcEngineCallResult {
  response:        ParentCurriculumEngineResponse;
  /** Total HTTP attempts sent to the engine in this logical request */
  actualCallCount: number;
  /** Number of retries (attempts beyond the first) */
  retryCount:      number;
}

/**
 * searchParentCurriculum — sends ParentCurriculumEngineRequest to AI ENGINE
 * POST /api/v1/parent-curriculum/search
 *
 * Auth: Authorization: Bearer <PARENT_CURRICULUM_ENGINE_SECRET>
 * Timeout: PARENT_CURRICULUM_ENGINE_TIMEOUT_MS (default 60 s)
 *
 * If PARENT_CURRICULUM_ENGINE_URL is not set the call is rejected without a
 * network request (prevents accidental production calls in development).
 *
 * AI01-05: Returns PcEngineCallResult so callers can record actual HTTP attempt counts.
 * The request_id is forwarded as both the body field and X-Request-Id header.
 */
export async function searchParentCurriculum(
  request: ParentCurriculumEngineRequest,
): Promise<PcEngineCallResult> {
  const baseUrl = getParentCurriculumEngineUrl();
  if (!baseUrl) {
    // Validation failure — no HTTP request sent
    throw new ParentCurriculumEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      0,
      false,
      "PARENT_CURRICULUM_ENGINE_URL env var not set",
    );
  }

  const secret     = getParentCurriculumEngineSecret();
  const timeoutMs  = getParentCurriculumEngineTimeoutMs();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  // AI01-05: Single attempt — no retry in this client.
  // actualCallCount increments only when an HTTP request is actually sent.
  let actualCallCount = 0;

  try {
    actualCallCount = 1; // HTTP request is about to be sent
    const res = await fetch(`${baseUrl}/api/v1/parent-curriculum/search`, {
      method: "POST",
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
          retryable  = PC_RETRYABLE_ERROR_CODES.has(errorCode);
        }
      } catch {
        // JSON parse failure — keep defaults
      }
      throw new ParentCurriculumEngineError(
        errorCode,
        res.status,
        retryable,
        `ENGINE ${res.status}: ${errorCode}`,
      );
    }

    const response = (await res.json()) as ParentCurriculumEngineResponse;
    return { response, actualCallCount, retryCount: 0 };
  } catch (err) {
    if (err instanceof ParentCurriculumEngineError) throw err;
    const isAbort = (err as Error).name === "AbortError";
    throw new ParentCurriculumEngineError(
      isAbort ? "COMPOSITION_TIMEOUT" : "NETWORK_ERROR",
      0,
      true,
      (err as Error).message,
    );
  } finally {
    clearTimeout(timer);
  }
}
