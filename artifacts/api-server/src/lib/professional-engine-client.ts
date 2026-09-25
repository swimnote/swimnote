/**
 * professional-engine-client.ts
 *
 * APP → Professional AI Engine HTTP client.
 *
 * Environment (server-side only — NEVER expose to frontend/mobile):
 *   PROFESSIONAL_ENGINE_BASE_URL     Professional Engine base URL (required)
 *   PROFESSIONAL_ENGINE_API_SECRET   Bearer token for server-to-server auth
 *
 * Timeout: 5 000 ms (fixed — per WP-PRO-04A spec)
 *
 * RESPONSIBILITY BOUNDARY:
 *   - HTTP transport only
 *   - No KF subsystem
 *   - No AI retrieval / ranking logic
 *   - No generic GPT fallback
 *   - Engine internal metadata NOT re-interpreted
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRO_ENGINE_TIMEOUT_MS = 5_000;

export const PRO_ENGINE_SERVICE    = "professional_engine" as const;
export const PRO_ENGINE_FEATURE    = "professional_retrieval" as const;

// ─── Env accessors (server-side only) ────────────────────────────────────────

export function getProfessionalEngineBaseUrl(): string {
  return (process.env["PROFESSIONAL_ENGINE_BASE_URL"] ?? "").trim();
}
/** Secret MUST NOT be logged, returned in error responses, or exposed to client. */
function getProfessionalEngineSecret(): string {
  return (process.env["PROFESSIONAL_ENGINE_API_SECRET"] ?? "").trim();
}

// ─── Request / Response types ─────────────────────────────────────────────────

export interface ProfessionalRetrieveRequest {
  /** Forwarded from APP request trace — same ID used end-to-end. */
  request_id: string;
  query:      string;
  limit:      number;
}

/**
 * Single retrieved knowledge item — raw internal metadata NOT included.
 * Only fields needed by upstream callers are exposed.
 */
export interface ProfessionalKnowledgeItem {
  knowledge_id:   string;
  title:          string;
  text:           string;
  knowledge_type: string;
  score:          number;
  evidence_id:    string;
}

export interface ProfessionalRetrievalMeta {
  latency_ms?:      number;
  engine_version?:  string;
  [key: string]:    unknown; // pass-through, not re-interpreted
}

export interface ProfessionalEngineResponse {
  request_id:    string;
  results:       ProfessionalKnowledgeItem[];
  retrieval_meta: ProfessionalRetrievalMeta;
}

// ─── Error classification ─────────────────────────────────────────────────────

export type ProfessionalEngineErrorCode =
  | "ENGINE_TIMEOUT"
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_UNAUTHORIZED"
  | "ENGINE_RETRIEVAL_FAILED"
  | "ENGINE_URL_NOT_CONFIGURED";

export class ProfessionalEngineError extends Error {
  constructor(
    public readonly errorCode: ProfessionalEngineErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ProfessionalEngineError";
  }
}

// ─── Call result (observability) ──────────────────────────────────────────────

export interface ProfessionalEngineCallResult {
  response:       ProfessionalEngineResponse;
  /** Actual HTTP requests sent (0 if validation failed, 1 on success/error). */
  actualCallCount: number;
  /** Retry count — 0 (no retry policy; follows existing contract). */
  retryCount:      number;
  /** Wall-clock latency from request send to response received. */
  latencyMs:       number;
}

// ─── Engine HTTP Client ───────────────────────────────────────────────────────

/**
 * retrieveProfessionalKnowledge
 *
 * POST {PROFESSIONAL_ENGINE_BASE_URL}/api/professional/retrieve
 *
 * Headers:
 *   Authorization: Bearer <PROFESSIONAL_ENGINE_API_SECRET>  (server-only)
 *   Content-Type:  application/json
 *   X-Request-Id:  <request_id>  (same as body field)
 *
 * On any error:
 *   - ENGINE_TIMEOUT     → AbortController fires at 5 000 ms
 *   - ENGINE_UNAUTHORIZED → 401
 *   - ENGINE_UNAVAILABLE  → network error / 5xx
 *   - ENGINE_RETRIEVAL_FAILED → 4xx other than 401
 *
 * NO generic GPT fallback. Callers must handle errors explicitly.
 */
export async function retrieveProfessionalKnowledge(
  params: ProfessionalRetrieveRequest,
): Promise<ProfessionalEngineCallResult> {
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) {
    throw new ProfessionalEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      0,
      "PROFESSIONAL_ENGINE_BASE_URL env var not set",
    );
  }

  const secret     = getProfessionalEngineSecret();
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), PRO_ENGINE_TIMEOUT_MS);

  let actualCallCount = 0;
  const callStart     = Date.now();

  try {
    actualCallCount = 1;
    const res = await fetch(
      `${baseUrl}/api/professional/retrieve`,
      {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "X-Request-Id":  params.request_id,
          // Secret is server-side only — NEVER propagated to client responses or logs.
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body:   JSON.stringify({
          query:      params.query,
          limit:      params.limit,
          request_id: params.request_id,
        }),
        signal: controller.signal,
      },
    );

    const latencyMs = Date.now() - callStart;

    if (!res.ok) {
      let errorCode: ProfessionalEngineErrorCode;
      if (res.status === 401) {
        errorCode = "ENGINE_UNAUTHORIZED";
      } else if (res.status >= 500) {
        errorCode = "ENGINE_UNAVAILABLE";
      } else {
        errorCode = "ENGINE_RETRIEVAL_FAILED";
      }
      throw new ProfessionalEngineError(
        errorCode,
        res.status,
        `Professional Engine HTTP ${res.status}: ${errorCode}`,
      );
    }

    const raw      = (await res.json()) as {
      request_id:     string;
      results:        unknown[];
      retrieval_meta: Record<string, unknown>;
    };

    // Map to typed response — only expose required fields, drop internal metadata.
    const results: ProfessionalKnowledgeItem[] = (raw.results ?? []).map(
      (item: unknown) => {
        const r = item as Record<string, unknown>;
        return {
          knowledge_id:   String(r["knowledge_id"]   ?? ""),
          title:          String(r["title"]           ?? ""),
          text:           String(r["text"]            ?? ""),
          knowledge_type: String(r["knowledge_type"]  ?? ""),
          score:          Number(r["score"]           ?? 0),
          evidence_id:    String(r["evidence_id"]     ?? ""),
        };
      },
    );

    const response: ProfessionalEngineResponse = {
      request_id:     raw.request_id ?? params.request_id,
      results,
      retrieval_meta: raw.retrieval_meta ?? {},
    };

    return { response, actualCallCount, retryCount: 0, latencyMs };
  } catch (err) {
    if (err instanceof ProfessionalEngineError) throw err;
    const isAbort = (err as Error).name === "AbortError";
    throw new ProfessionalEngineError(
      isAbort ? "ENGINE_TIMEOUT" : "ENGINE_UNAVAILABLE",
      0,
      (err as Error).message,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Teacher Diary Bridge — Service JWT ───────────────────────────────────────

import jwt from "jsonwebtoken";

/** JWT_SECRET accessor — same shared secret as Professional Engine. */
function getJwtSecretForDiary(): string {
  return (process.env["JWT_SECRET"] ?? "").trim();
}

/**
 * createTeacherDiaryServiceJwt — Professional Engine 호출용 단기 service JWT.
 *
 * Growth Report S2S pattern 동일: JWT_SECRET 공유 방식 (HS256, 5m TTL).
 * Raw secret을 Authorization 헤더에 직접 전송하지 않음.
 */
export function createTeacherDiaryServiceJwt(poolId: string): string {
  const secret = getJwtSecretForDiary();
  if (!secret) {
    throw new ProfessionalEngineError(
      "ENGINE_UNAUTHORIZED",
      0,
      "JWT_SECRET env var not set — cannot create service JWT for teacher diary",
    );
  }
  return jwt.sign(
    {
      userId: "service:teacher-diary",
      role:   "platform_admin",
      poolId,
      tv:     1,
    },
    secret,
    { algorithm: "HS256", expiresIn: "5m" },
  );
}

// ─── Teacher Diary Bridge — Request / Response types ──────────────────────────

export interface TeacherDiaryStudentEntry {
  ref:  string;
  name: string;
}

export interface TeacherDiaryEngineRequest {
  contract_version: string;
  request_id:       string;
  schema_version:   string;
  feature:          string;
  locale?:          string;
  input:            { text: string };
  context: {
    pool_id:      string;
    class_id:     string;
    lesson_date:  string;
    student_refs: string[];
    students:     TeacherDiaryStudentEntry[];
  };
}

export interface TeacherDiaryStudentResult {
  student_ref: string;
  content:     string;
}

/** Raw response body from Professional Engine V1.2 (pass-through). */
export interface TeacherDiaryEngineResult {
  contract_version:  string;
  request_id:        string;
  schema_version?:   string;
  engine_version?:   string;
  feature?:          string;
  result: {
    common:   string;
    students: TeacherDiaryStudentResult[];
  };
  meta?:   Record<string, unknown>;
  usage?:  Record<string, unknown>;
}

/** Timeout for teacher diary — GPT involved, allow 60 s. */
export const PRO_DIARY_TIMEOUT_MS = 60_000;

/**
 * generateProfessionalTeacherDiary
 *
 * POST {PROFESSIONAL_ENGINE_BASE_URL}/api/v1/teacher-diary/generate
 *
 * Auth: Authorization: Bearer <service JWT (JWT_SECRET, HS256, 5m)>
 *       — same pattern as analyzeGrowthReport (growth-report-engine-client.ts).
 *
 * NO silent fallback to local pipeline on failure.
 *   401/403  → ProfessionalEngineError("ENGINE_UNAUTHORIZED")
 *   timeout  → ProfessionalEngineError("ENGINE_TIMEOUT")
 *   5xx/net  → ProfessionalEngineError("ENGINE_UNAVAILABLE")
 */
export async function generateProfessionalTeacherDiary(
  params: TeacherDiaryEngineRequest,
): Promise<TeacherDiaryEngineResult> {
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) {
    throw new ProfessionalEngineError(
      "ENGINE_URL_NOT_CONFIGURED",
      0,
      "PROFESSIONAL_ENGINE_BASE_URL env var not set",
    );
  }

  const serviceJwt = createTeacherDiaryServiceJwt(params.context.pool_id);
  const controller  = new AbortController();
  const timer       = setTimeout(() => controller.abort(), PRO_DIARY_TIMEOUT_MS);

  try {
    const res = await fetch(
      `${baseUrl}/api/v1/teacher-diary/generate`,
      {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "X-Request-Id":  params.request_id,
          // Service JWT — server-side only, never propagated to client.
          "Authorization": `Bearer ${serviceJwt}`,
        },
        body:   JSON.stringify(params),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      let errorCode: ProfessionalEngineErrorCode;
      if (res.status === 401 || res.status === 403) {
        errorCode = "ENGINE_UNAUTHORIZED";
      } else if (res.status >= 500) {
        errorCode = "ENGINE_UNAVAILABLE";
      } else {
        errorCode = "ENGINE_RETRIEVAL_FAILED";
      }
      throw new ProfessionalEngineError(
        errorCode,
        res.status,
        `Professional Engine teacher-diary HTTP ${res.status}: ${errorCode}`,
      );
    }

    return (await res.json()) as TeacherDiaryEngineResult;
  } catch (err) {
    if (err instanceof ProfessionalEngineError) throw err;
    const isAbort = (err as Error).name === "AbortError";
    throw new ProfessionalEngineError(
      isAbort ? "ENGINE_TIMEOUT" : "ENGINE_UNAVAILABLE",
      0,
      (err as Error).message,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ─── Health check (ops use only — NOT called per user request) ────────────────

export interface ProfessionalEngineHealth {
  status: "ok" | "degraded" | "error";
  [key: string]: unknown;
}

export async function checkProfessionalEngineHealth(): Promise<ProfessionalEngineHealth> {
  const baseUrl = getProfessionalEngineBaseUrl();
  if (!baseUrl) {
    return { status: "error", reason: "ENGINE_URL_NOT_CONFIGURED" };
  }
  try {
    const res = await fetch(`${baseUrl}/api/professional/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return { status: "error", httpStatus: res.status };
    return (await res.json()) as ProfessionalEngineHealth;
  } catch {
    return { status: "error", reason: "NETWORK_ERROR" };
  }
}
