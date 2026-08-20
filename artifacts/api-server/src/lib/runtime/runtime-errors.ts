/**
 * runtime-errors.ts — AI Data Runtime 공통 에러 타입 (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 */

// ── Error codes ───────────────────────────────────────────────────────────────

export type RuntimeErrorCode =
  // Gateway errors
  | "GATEWAY_TIMEOUT"
  | "GATEWAY_RATE_LIMITED"
  | "GATEWAY_UPSTREAM_ERROR"
  | "GATEWAY_INVALID_RESPONSE"
  | "GATEWAY_UNSUPPORTED_FORMAT"
  // Retrieval errors
  | "RETRIEVAL_SCOPE_EMPTY"
  | "RETRIEVAL_NO_MATCH"
  // Evidence errors
  | "EVIDENCE_CROSS_TENANT"
  | "EVIDENCE_BUILD_FAILED"
  // Validation errors
  | "OUTPUT_VALIDATION_FAILED"
  | "GROUNDING_FAILED"
  // Policy errors
  | "POLICY_HUMAN_REQUIRED"
  | "POLICY_INSUFFICIENT_EVIDENCE";

// ── Base error class ──────────────────────────────────────────────────────────

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;

  constructor(code: RuntimeErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.retryable = retryable;
  }
}

// ── Specific errors ───────────────────────────────────────────────────────────

export class GatewayTimeoutError extends RuntimeError {
  constructor(message = "AI gateway request timed out") {
    super("GATEWAY_TIMEOUT", message, /* retryable */ true);
    this.name = "GatewayTimeoutError";
  }
}

export class GatewayRateLimitedError extends RuntimeError {
  constructor(message = "AI gateway rate limited (429)") {
    super("GATEWAY_RATE_LIMITED", message, /* retryable */ true);
    this.name = "GatewayRateLimitedError";
  }
}

export class GatewayUpstreamError extends RuntimeError {
  readonly statusCode: number;
  constructor(statusCode: number, message?: string) {
    super("GATEWAY_UPSTREAM_ERROR", message ?? `AI gateway upstream error: ${statusCode}`, /* retryable */ statusCode >= 500);
    this.name = "GatewayUpstreamError";
    this.statusCode = statusCode;
  }
}

export class GatewayInvalidResponseError extends RuntimeError {
  constructor(message = "AI gateway returned unparseable response") {
    super("GATEWAY_INVALID_RESPONSE", message, /* retryable */ false);
    this.name = "GatewayInvalidResponseError";
  }
}

export class GatewayUnsupportedFormatError extends RuntimeError {
  constructor(message = "Model does not support requested response format") {
    super("GATEWAY_UNSUPPORTED_FORMAT", message, /* retryable */ false);
    this.name = "GatewayUnsupportedFormatError";
  }
}

export class CrossTenantEvidenceError extends RuntimeError {
  constructor(matchTenant: string, contextTenant: string) {
    super(
      "EVIDENCE_CROSS_TENANT",
      `Cross-tenant evidence rejected: match tenant=${matchTenant} context tenant=${contextTenant}`,
      /* retryable */ false,
    );
    this.name = "CrossTenantEvidenceError";
  }
}

export class EvidenceBuildError extends RuntimeError {
  constructor(message: string) {
    super("EVIDENCE_BUILD_FAILED", message, false);
    this.name = "EvidenceBuildError";
  }
}
