import { computeCanonicalHash } from "./growth-report-engine-client.js";

export interface AnalysisRequestIdentity {
  requestId: string;
  payloadHash: string;
  identityHash: string;
  request: Record<string, any>;
  reused: boolean;
  replacePreviousStageRequest: boolean;
}

function stripVolatileIdentityFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileIdentityFields);
  if (value === null || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => ![
      "request_id",
      "requestId",
      "analysis_request_id",
      "created_at",
      "payload_hash",
    ].includes(key))
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stripVolatileIdentityFields(record[key]);
      return result;
    }, {});
}

/**
 * Fingerprint the logical analysis input, not transport metadata. Snapshot
 * creation time, request IDs, and the payload hash derived from them are
 * deliberately excluded; all report/version/input fields remain included.
 */
export function getGrowthReportAnalysisIdentityHash(
  request: Record<string, any>,
  stage: "PREANALYSIS" | "FINAL_ANALYSIS",
): string {
  return computeCanonicalHash({
    analysis_stage: stage,
    request: stripVolatileIdentityFields(request) as object,
  });
}

export function isGrowthReportRequestIdentityForStage(
  request: unknown,
  identityHash: string | null | undefined,
  stage: "PREANALYSIS" | "FINAL_ANALYSIS",
): boolean {
  if (
    !identityHash ||
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request)
  ) return false;
  return identityHash === getGrowthReportAnalysisIdentityHash(
    request as Record<string, any>,
    stage,
  );
}

/**
 * Once a request has been persisted, it is the durable identity of that
 * unfinished analysis. Rebuilding inputs during recovery must never mint a
 * second request_id (in particular after an ENGINE timeout/UNKNOWN outcome).
 */
export function resolveGrowthReportAnalysisIdentity(params: {
  freshRequest: Record<string, any>;
  freshPayloadHash: string;
  stage: "PREANALYSIS" | "FINAL_ANALYSIS";
  persistedRequest?: unknown;
  persistedRequestId?: string | null;
  persistedPayloadHash?: string | null;
  persistedIdentityHash?: string | null;
}): AnalysisRequestIdentity {
  const freshIdentityHash = getGrowthReportAnalysisIdentityHash(
    params.freshRequest,
    params.stage,
  );
  const persisted = params.persistedRequest;
  if (typeof params.persistedRequestId === "string") {
    const persistedRecord =
      persisted !== null && typeof persisted === "object" && !Array.isArray(persisted)
        ? persisted as Record<string, any>
        : null;
    if (
      !persistedRecord ||
      typeof params.persistedPayloadHash !== "string" ||
      persistedRecord.request_id !== params.persistedRequestId ||
      persistedRecord.snapshot?.payload_hash !== params.persistedPayloadHash
    ) {
      throw new Error(
        "Persisted analysis request is incomplete; refusing to issue a new request identity.",
      );
    }

    if (isGrowthReportRequestIdentityForStage(
      persistedRecord,
      params.persistedIdentityHash,
      params.stage,
    )) {
      return {
        requestId: params.persistedRequestId!,
        payloadHash: params.persistedPayloadHash!,
        identityHash: params.persistedIdentityHash!,
        request: persistedRecord,
        reused: true,
        replacePreviousStageRequest: false,
      };
    }

    const previousStage = params.stage === "PREANALYSIS" ? "FINAL_ANALYSIS" : "PREANALYSIS";
    if (!isGrowthReportRequestIdentityForStage(
      persistedRecord,
      params.persistedIdentityHash,
      previousStage,
    )) {
      throw new Error(
        "Persisted analysis identity is invalid; refusing to issue a new request identity.",
      );
    }

    return {
      requestId: String(params.freshRequest.request_id),
      payloadHash: params.freshPayloadHash,
      identityHash: freshIdentityHash,
      request: params.freshRequest,
      reused: false,
      replacePreviousStageRequest: true,
    };
  }

  return {
    requestId: String(params.freshRequest.request_id),
    payloadHash: params.freshPayloadHash,
    identityHash: freshIdentityHash,
    request: params.freshRequest,
    reused: false,
    replacePreviousStageRequest: false,
  };
}

export function retryDisposition(
  currentRetryCount: number,
  maxRetryCount: number,
): { nextRetryCount: number; terminal: boolean } {
  const nextRetryCount = Math.max(0, currentRetryCount) + 1;
  return {
    nextRetryCount,
    terminal: nextRetryCount >= Math.max(1, maxRetryCount),
  };
}

export function getGrowthReportRetryDelayMs(
  retryCount: number,
  random = Math.random,
): number {
  const configuredBase = Number(process.env["GROWTH_REPORT_RETRY_BASE_MS"]);
  const configuredMax = Number(process.env["GROWTH_REPORT_RETRY_MAX_MS"]);
  const baseMs = Number.isFinite(configuredBase) && configuredBase > 0
    ? configuredBase
    : 30_000;
  const maxMs = Number.isFinite(configuredMax) && configuredMax >= baseMs
    ? configuredMax
    : Math.max(30 * 60_000, baseMs);
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, retryCount - 1));
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.min(maxMs, Math.max(1, Math.round(exponential * jitter)));
}
