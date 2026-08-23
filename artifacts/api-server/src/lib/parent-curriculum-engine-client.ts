/**
 * parent-curriculum-engine-client.ts
 *
 * APP → AI ENGINE HTTP client for Parent Curriculum Search.
 *
 * Environment:
 *   PARENT_CURRICULUM_ENGINE_URL        AI ENGINE base URL (required)
 *   JWT_SECRET                          HS256 shared secret with AI ENGINE (required)
 *   PARENT_CURRICULUM_ENGINE_TIMEOUT_MS Per-call timeout (default 60 000 ms)
 *
 * Auth: server-to-server HS256 JWT signed with JWT_SECRET (same secret as AI ENGINE).
 *       Static PARENT_CURRICULUM_ENGINE_SECRET is no longer used.
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No question interpretation
 *   - No curriculum knowledge
 *   - No GPT calls
 */

import jwt from "jsonwebtoken";

// ─── Contract constants ────────────────────────────────────────────────────────

export const PC_SCHEMA_VERSION = "1.0" as const;
export const PC_FEATURE        = "parent_curriculum_search" as const;

// ─── Engine configuration ─────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000; // curriculum search is faster than growth report

export function getParentCurriculumEngineUrl(): string {
  return (process.env["PARENT_CURRICULUM_ENGINE_URL"] ?? "").trim().replace(/\/+$/, "");
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
  /** Engine HTTP status code (0 = no HTTP request was sent). */
  public readonly engineStatus:      number;
  /** Resolved engine error code (body.error.code → body.error_code → ENGINE_HTTP_ERROR). */
  public readonly engineErrorCode:   string;
  /** Content-Type of the engine response (undefined when no HTTP response). */
  public readonly engineContentType: string | undefined;

  constructor(
    public readonly errorCode: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    message: string,
    engineDiag?: {
      engineStatus?:      number;
      engineErrorCode?:   string;
      engineContentType?: string;
    },
  ) {
    super(message);
    this.name             = "ParentCurriculumEngineError";
    this.engineStatus     = engineDiag?.engineStatus      ?? statusCode;
    this.engineErrorCode  = engineDiag?.engineErrorCode   ?? errorCode;
    this.engineContentType = engineDiag?.engineContentType;
  }
}

// ─── Engine JWT generation ─────────────────────────────────────────────────────

/**
 * Generates a short-lived HS256 JWT for server-to-server auth with the AI ENGINE.
 * JWT_SECRET must match the AI ENGINE's JWT_SECRET (shared secret).
 * Throws ParentCurriculumEngineError if JWT_SECRET is not set (fail-closed).
 */
export function generateEngineJwt(poolId: string): string {
  const secret = (process.env["JWT_SECRET"] ?? "").trim();
  if (!secret) {
    throw new ParentCurriculumEngineError(
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
 * Auth: Authorization: Bearer <HS256 JWT> signed with JWT_SECRET (shared with AI ENGINE)
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

  // generateEngineJwt throws ParentCurriculumEngineError if JWT_SECRET is missing (fail-closed)
  const engineJwt  = generateEngineJwt(request.context.pool_id);
  const timeoutMs  = getParentCurriculumEngineTimeoutMs();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  // AI01-05: Single attempt — no retry in this client.
  // actualCallCount increments only when an HTTP request is actually sent.
  let actualCallCount = 0;

  try {
    actualCallCount = 1; // HTTP request is about to be sent
    const engineEndpoint = `${baseUrl}/api/v1/parent-curriculum/search`;
    const engineUrlObj   = new URL(engineEndpoint);
    console.log(
      `[pc-engine] host=${engineUrlObj.host} pathname=${engineUrlObj.pathname} request_id=${request.request_id}`,
    );
    const res = await fetch(engineEndpoint, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        // AI01-05: propagate request_id as header for engine-side correlation
        "X-Request-Id":  request.request_id,
        // HS256 JWT signed with shared JWT_SECRET — same secret as AI ENGINE
        "Authorization": `Bearer ${engineJwt}`,
      },
      body:   JSON.stringify(request),
      signal: controller.signal,
    });

    if (!res.ok) {
      let errorCode    = "ENGINE_HTTP_ERROR";
      let errorMessage: string | undefined;
      let retryable    = res.status >= 500 || res.status === 429;
      const engineStatus      = res.status;
      const engineContentType = res.headers.get("content-type") ?? undefined;

      try {
        const body = (await res.json()) as {
          error?:      { code?: string; message?: string; retryable?: boolean };
          error_code?: string;
          message?:    string;
        };
        // Priority 1: nested body.error.code (engine v1 format)
        // Priority 2: flat body.error_code (legacy format)
        const code =
          (typeof body?.error?.code === "string" ? body.error.code  : undefined) ??
          (typeof body?.error_code  === "string" ? body.error_code  : undefined);
        if (code) {
          errorCode    = code;
          errorMessage = body?.error?.message ?? body?.message;
          // If engine supplies explicit retryable flag, honour it; else derive from code set
          retryable =
            typeof body?.error?.retryable === "boolean"
              ? body.error.retryable
              : PC_RETRYABLE_ERROR_CODES.has(errorCode);
        }
      } catch {
        // JSON parse failure (e.g. HTML 404) — keep defaults; status still preserved
      }

      throw new ParentCurriculumEngineError(
        errorCode,
        res.status,
        retryable,
        errorMessage ?? `ENGINE ${res.status}: ${errorCode}`,
        { engineStatus, engineErrorCode: errorCode, engineContentType },
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
