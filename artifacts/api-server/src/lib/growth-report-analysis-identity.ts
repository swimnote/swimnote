import { computeCanonicalHash } from "./growth-report-engine-client.js";

export interface AnalysisRequestIdentity {
  requestId: string;
  payloadHash: string;
  identityHash: string;
  request: Record<string, any>;
  reused: boolean;
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

/**
 * Reuse the exact, previously persisted HTTP request only when its logical
 * identity is unchanged. A changed input keeps the freshly built request and
 * its new request ID, avoiding accidental replay of obsolete input.
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
  const identityHash = getGrowthReportAnalysisIdentityHash(
    params.freshRequest,
    params.stage,
  );
  const persisted = params.persistedRequest;
  const reusable =
    params.persistedIdentityHash === identityHash &&
    typeof params.persistedRequestId === "string" &&
    typeof params.persistedPayloadHash === "string" &&
    persisted !== null &&
    typeof persisted === "object" &&
    !Array.isArray(persisted) &&
    (persisted as Record<string, unknown>).request_id === params.persistedRequestId &&
    ((persisted as Record<string, any>).snapshot?.payload_hash === params.persistedPayloadHash);

  if (reusable) {
    return {
      requestId: params.persistedRequestId!,
      payloadHash: params.persistedPayloadHash!,
      identityHash,
      request: persisted as Record<string, any>,
      reused: true,
    };
  }

  return {
    requestId: String(params.freshRequest.request_id),
    payloadHash: params.freshPayloadHash,
    identityHash,
    request: params.freshRequest,
    reused: false,
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
