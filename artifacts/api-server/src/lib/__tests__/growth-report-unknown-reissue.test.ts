import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEngineReissueHeaders,
  buildEngineReissuePayload,
  callReissue,
  operatorBearerFromRequest,
  reissueUnknownGrowthReports,
} from "../growth-report-unknown-reissue.js";
import { PgDialect } from "drizzle-orm/pg-core";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";

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
const dialect = new PgDialect();
const queryText = (query: unknown) => dialect.sqlToQuery(query as any).sql;

function historicalFailedTarget(proof: Record<string, unknown>) {
  const payload = {
    ...originalPayload,
    context: { student_id: "student-1", pool_id: "pool-1", report_period: "2026-10" },
    snapshot: { payload_hash: "original-canonical-hash" },
  };
  return {
    report_id: originalPayload.report_id,
    student_id: "student-1",
    swimming_pool_id: "pool-1",
    report_period: "2026-10",
    analysis_request_id: originalRequestId,
    analysis_request_payload: payload,
    analysis_identity_hash: getGrowthReportAnalysisIdentityHash(payload as any, "FINAL_ANALYSIS"),
    snapshot_hash: "original-canonical-hash",
    product_status: "ANALYZING",
    analysis_status: null,
    analysis_uncertain_at: new Date(),
    analysis_response_payload: null,
    analysis_claim_token: null,
    analysis_lease_until: null,
    analysis_call_started_at: null,
    report_type: "growth",
    monthly_final_disposition: null,
    report_content: null,
    report_fact_package: null,
    sns_summary: null,
    updated_at: new Date(),
    created_at: new Date(),
    first_pass_outcome: "failed",
    first_pass_completed_at: new Date(),
    recovery_epoch: 1,
    recovery_approved_by: "operator-1",
    recovery_approval_reason: "approved next attempt",
    policy_excluded_at: null,
    policy_exclusion_reason: null,
    eligibility_sealed_at: new Date(),
    eligible_total: 1,
    parent_input_close_at: null,
    actual_eligible_total: 1,
    ...proof,
  };
}

function operationLookupDb(selectedRow: Record<string, unknown>) {
  const statements: string[] = [];
  let operationLookups = 0;
  const execute = async (query: unknown) => {
    const text = queryText(query);
    statements.push(text);
    if (text.includes("SELECT * FROM growth_report_unknown_reissue_operations")) {
      operationLookups++;
      if (operationLookups === 2) throw new Error("OPERATION_LOOKUP_REACHED");
      return { rows: [] };
    }
    if (text.includes("SELECT report.id AS report_id")) return { rows: [selectedRow] };
    return { rows: [] };
  };
  return {
    statements,
    get operationLookups() { return operationLookups; },
    execute,
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback({ execute }),
  };
}

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
    expect(body.original_request_id).toBe(originalRequestId);
    expect(body.new_request_id).toBe(replacementRequestId);
  });

  it.each([
    ["zero recovery epoch", { recovery_epoch: 0 }],
    ["missing approving operator", { recovery_approved_by: null }],
    ["blank approval reason", { recovery_approval_reason: "   " }],
  ])("rejects historical FAILED UNKNOWN dispatch without %s proof", async (_label, proof) => {
    const db = operationLookupDb(historicalFailedTarget(proof));
    const [result] = await reissueUnknownGrowthReports(db as any, {
      reportIds: [originalPayload.report_id],
      actorId: "operator-1",
      actorRole: "super_admin",
      reason: "approved next attempt",
      operatorAuthorization: "Bearer operator-token",
    });
    expect(result.state).toBe("HOLD");
    expect(result.error_code).toBe("UNKNOWN_RECOVERY_APPROVAL_REQUIRED");
    expect(db.operationLookups).toBe(1);
  });

  it("allows a valid failed-recovery proof through to persisted operation lookup", async () => {
    const db = operationLookupDb(historicalFailedTarget({}));
    await expect(reissueUnknownGrowthReports(db as any, {
      reportIds: [originalPayload.report_id],
      actorId: "operator-1",
      actorRole: "super_admin",
      reason: "approved next attempt",
      operatorAuthorization: "Bearer operator-token",
    })).rejects.toThrow("OPERATION_LOOKUP_REACHED");
    expect(db.operationLookups).toBe(2);
    const select = db.statements.find(text => text.includes("SELECT report.id AS report_id"));
    expect(select).toContain("target.recovery_epoch");
    expect(select).toContain("target.recovery_approved_by");
    expect(select).toContain("target.recovery_approval_reason");
    expect(select).not.toContain("target.first_pass_outcome = 'unknown'");
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