import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEngineReissueHeaders,
  buildEngineReissuePayload,
  callReissue,
  operatorBearerFromRequest,
} from "../growth-report-unknown-reissue.js";

const originalRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const replacementRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const originalPayload = {
  contract_version: "1.0",
  request_id: originalRequestId,
  report_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  snapshot: { payload_hash: "original-canonical-hash", created_at: "stored-value" },
};
const operation: any = {
  id: operationId,
  report_id: originalPayload.report_id,
  original_request_id: originalRequestId,
  new_request_id: replacementRequestId,
  expected_payload_hash: "original-canonical-hash",
  original_payload: originalPayload,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("operator-approved UNKNOWN reissue transport contract", () => {
  it("forwards the immutable original request and stable replacement identity verbatim", () => {
    const body = buildEngineReissuePayload(operation);
    expect(body).toEqual({
      original_request_id: originalRequestId,
      new_request_id: replacementRequestId,
      recovery_operation_id: operationId,
      expected_payload_hash: "original-canonical-hash",
      original_payload: originalPayload,
      operator_approval: {
        approved: true,
        reason: "OPERATOR_APPROVED_UNKNOWN_REISSUE",
      },
    });
    expect(body.original_payload).toBe(originalPayload);
    expect(body.original_payload.request_id).toBe(originalRequestId);
  });

  it("uses the existing opaque service secret and forwards the verified operator Bearer token", () => {
    expect(buildEngineReissueHeaders("opaque-service-secret", "Bearer operator.jwt")).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer opaque-service-secret",
      "X-Operator-Authorization": "Bearer operator.jwt",
    });
    expect(operatorBearerFromRequest({
      header: (name: string) => name === "authorization" ? "Bearer verified.operator.jwt" : undefined,
    } as any)).toBe("Bearer verified.operator.jwt");
    expect(operatorBearerFromRequest({
      header: () => "Basic not-a-bearer",
    } as any)).toBeNull();
  });

  it("sends only the reissue endpoint with direct server service auth; retry reuses identical IDs", async () => {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid/");
    vi.stubEnv("PROFESSIONAL_ENGINE_API_SECRET", "opaque-production-service-secret");
    vi.stubEnv("JWT_SECRET", "must-not-be-used-as-service-auth");
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => ({
      status: 200,
      json: async () => ({ status: "PROCESSING", recovery_operation_id: operationId }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await callReissue(operation, "Bearer currently-verified.operator.jwt");
    await callReissue(operation, "Bearer currently-verified.operator.jwt");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe("https://engine.invalid/api/v1/growth-report/recovery/reissue");
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer opaque-production-service-secret",
        "X-Operator-Authorization": "Bearer currently-verified.operator.jwt",
      });
      const requestBody = JSON.parse(String(options?.body));
      expect(requestBody.recovery_operation_id).toBe(operationId);
      expect(requestBody.new_request_id).toBe(replacementRequestId);
      expect(requestBody.original_payload).toEqual(originalPayload);
    }
  });
});