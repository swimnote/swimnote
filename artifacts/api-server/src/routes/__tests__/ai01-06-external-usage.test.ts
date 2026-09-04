/**
 * AI01-06 — Provider-Neutral External Usage Recorder + SMS
 *
 * TC1: saveExternalUsage → SMS category event 저장 가능
 * TC2: SMS 성공 → provider / service=sms_send / actual_call_count=1
 * TC3: SMS provider HTTP 실패 → success=false / actual_call_count=1
 * TC4: provider 호출 전 validation 실패 → actual_call_count 거짓 기록 안 함
 * TC5: 계약 단가 미확인 → estimated_cost_usd=null / cost_source=UNKNOWN
 * TC6: usage recorder 실패 → SMS 본 동작 결과 덮어쓰지 않음
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock superAdminDb — prevent real DB writes
vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: vi.fn().mockResolvedValue({}),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — saveExternalUsage: SMS category event 저장 가능
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1. saveExternalUsage — SMS category event 저장", () => {
  it("SMS usage event를 event_logs에 저장한다 (category=EXTERNAL_USAGE)", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const { saveExternalUsage, EXTERNAL_USAGE_CATEGORY } = await import(
      "../../lib/external-usage-service.js"
    );
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    await saveExternalUsage({
      provider:          "sens",
      service:           "sms_send",
      feature:           EXTERNAL_USAGE_CATEGORY.SMS,
      trigger_type:      "USER_ACTION",
      pool_id:           "pool_001",
      request_id:        "req-tc1-001",
      actor_id:          "user_001",
      actual_call_count: 1,
      retry_count:       0,
      success:           true,
      latency_ms:        230,
      estimated_cost_usd: null,
      cost_source:       "UNKNOWN",
      units:             1,
    });

    expect(executeMock).toHaveBeenCalledOnce();

    // 저장된 SQL 인수에서 category 확인
    const callArgs = executeMock.mock.calls[0]?.[0] as any;
    // sql template literal → inspect the queryChunks or toString
    const sqlStr = callArgs?.queryChunks
      ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
      ?.join("") ?? "";
    expect(sqlStr).toContain("event_logs");
    expect(sqlStr).toContain("EXTERNAL_USAGE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — SMS 성공 → provider / service=sms_send / actual_call_count=1
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2. SMS 성공 — provider / service / actual_call_count 기록", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("SENS success → saveExternalUsage: provider=sens, service=sms_send, actual_call_count=1, success=true", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    // stub NAVER_SENS_* env so getActiveProvider() → "sens"
    process.env["NAVER_SENS_ACCESS_KEY"]   = "test_ak";
    process.env["NAVER_SENS_SECRET_KEY"]   = "test_sk";
    process.env["NAVER_SENS_SERVICE_ID"]   = "test_sid";
    process.env["NAVER_SENS_SENDER_PHONE"] = "0101234567";
    delete process.env["SMS_PROVIDER"];

    // stub fetch → SENS success
    vi.stubGlobal("fetch", async () => ({
      ok:   true,
      json: async () => ({ statusCode: "202", requestId: "sens-req-001" }),
    }));

    const { sendSms } = await import("../../lib/sms/sendSms.js");

    // flush module cache so env changes take effect
    // (in vitest, dynamic imports with vi.mock are cached — we check the mock instead)
    await sendSms({ phone: "01012345678", message: "test msg" });

    // usage event should have been recorded
    expect(executeMock).toHaveBeenCalled();

    // inspect metadata arg
    const lastCall = executeMock.mock.calls[executeMock.mock.calls.length - 1]?.[0] as any;
    const sqlStr   = lastCall?.queryChunks
      ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
      ?.join("") ?? "";
    expect(sqlStr).toContain("EXTERNAL_USAGE");
    expect(sqlStr).toContain("sms_send");
    expect(sqlStr).toContain("sens");
    expect(sqlStr).toContain('"success":true');
    expect(sqlStr).toContain('"actual_call_count":1');

    // cleanup env
    delete process.env["NAVER_SENS_ACCESS_KEY"];
    delete process.env["NAVER_SENS_SECRET_KEY"];
    delete process.env["NAVER_SENS_SERVICE_ID"];
    delete process.env["NAVER_SENS_SENDER_PHONE"];
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — SMS HTTP 실패 → success=false / actual_call_count=1
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3. SMS HTTP 실패 — success=false / actual_call_count=1", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("SENS HTTP error → saveExternalUsage: success=false, actual_call_count=1, error_type 포함", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    process.env["NAVER_SENS_ACCESS_KEY"]   = "test_ak";
    process.env["NAVER_SENS_SECRET_KEY"]   = "test_sk";
    process.env["NAVER_SENS_SERVICE_ID"]   = "test_sid";
    process.env["NAVER_SENS_SENDER_PHONE"] = "0101234567";
    delete process.env["SMS_PROVIDER"];

    // stub fetch → SENS error response
    vi.stubGlobal("fetch", async () => ({
      ok:     false,
      status: 400,
      json:   async () => ({ errorMessage: "Invalid recipient" }),
    }));

    const { sendSms } = await import("../../lib/sms/sendSms.js");

    await expect(
      sendSms({ phone: "01012345678", message: "test msg" })
    ).rejects.toThrow();

    // usage event must still be recorded even on failure
    expect(executeMock).toHaveBeenCalled();

    const lastCall = executeMock.mock.calls[executeMock.mock.calls.length - 1]?.[0] as any;
    const sqlStr   = lastCall?.queryChunks
      ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
      ?.join("") ?? "";
    expect(sqlStr).toContain('"success":false');
    expect(sqlStr).toContain('"actual_call_count":1');
    expect(sqlStr).toContain('"error_type"');

    delete process.env["NAVER_SENS_ACCESS_KEY"];
    delete process.env["NAVER_SENS_SECRET_KEY"];
    delete process.env["NAVER_SENS_SERVICE_ID"];
    delete process.env["NAVER_SENS_SENDER_PHONE"];
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — Validation 실패 → actual_call_count 거짓 기록 안 함
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4. Provider 호출 전 validation 실패 — usage event 미생성", () => {
  it("provider 미설정(null) → sendSms throws before HTTP → saveExternalUsage 미호출", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    // clear all provider config
    delete process.env["NAVER_SENS_ACCESS_KEY"];
    delete process.env["NAVER_SENS_SECRET_KEY"];
    delete process.env["NAVER_SENS_SERVICE_ID"];
    delete process.env["NAVER_SENS_SENDER_PHONE"];
    delete process.env["SMS_PROVIDER"];
    delete process.env["SMS_API_KEY"];

    const { sendSms } = await import("../../lib/sms/sendSms.js");

    await expect(
      sendSms({ phone: "01012345678", message: "test" })
    ).rejects.toThrow();

    // saveExternalUsage must NOT have been called (no HTTP attempt)
    // The throw happens before the try block, so no usage recorded
    // (DB execute should have 0 calls for EXTERNAL_USAGE from sendSms)
    const extUsageCalls = executeMock.mock.calls.filter((call) => {
      const sqlStr = (call[0] as any)?.queryChunks
        ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
        ?.join("") ?? "";
      return sqlStr.includes("EXTERNAL_USAGE");
    });
    expect(extUsageCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — 계약 단가 미확인 → cost_source=UNKNOWN, estimated_cost_usd=null
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5. 계약 단가 미확인 — cost_source=UNKNOWN", () => {
  it("saveExternalUsage: estimated_cost_usd=null, cost_source=UNKNOWN 기록", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const { saveExternalUsage, EXTERNAL_USAGE_CATEGORY } = await import(
      "../../lib/external-usage-service.js"
    );
    const executeMock = vi.mocked(superAdminDb.execute);
    executeMock.mockClear();

    await saveExternalUsage({
      provider:           "sens",
      service:            "sms_send",
      feature:            EXTERNAL_USAGE_CATEGORY.SMS,
      trigger_type:       "USER_ACTION",
      pool_id:            "pool_tc5",
      actual_call_count:  1,
      success:            true,
      latency_ms:         200,
      estimated_cost_usd: null,    // 계약 단가 미확인
      cost_source:        "UNKNOWN",
    });

    expect(executeMock).toHaveBeenCalledOnce();
    const sqlStr = (executeMock.mock.calls[0]?.[0] as any)?.queryChunks
      ?.map((c: any) => (typeof c === "string" ? c : String(c?.value ?? "")))
      ?.join("") ?? "";
    expect(sqlStr).toContain('"cost_source":"UNKNOWN"');
    // estimated_cost_usd=null 이면 metadata에서 absent (undefined 분기)
    expect(sqlStr).not.toContain('"estimated_cost_usd"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — usage recorder 실패 → SMS 본 동작 결과 보존
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6. usage recorder 실패 — SMS 본 동작 결과 불변", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saveExternalUsage DB error → sendSms의 성공 결과를 덮어쓰지 않음", async () => {
    const { superAdminDb } = await import("@workspace/db");
    const executeMock = vi.mocked(superAdminDb.execute);

    // First call from saveExternalUsage → simulate failure
    executeMock.mockRejectedValueOnce(new Error("DB connection lost"));

    process.env["NAVER_SENS_ACCESS_KEY"]   = "test_ak";
    process.env["NAVER_SENS_SECRET_KEY"]   = "test_sk";
    process.env["NAVER_SENS_SERVICE_ID"]   = "test_sid";
    process.env["NAVER_SENS_SENDER_PHONE"] = "0101234567";
    delete process.env["SMS_PROVIDER"];

    vi.stubGlobal("fetch", async () => ({
      ok:   true,
      json: async () => ({ statusCode: "202", requestId: "sens-req-tc6" }),
    }));

    const { sendSms } = await import("../../lib/sms/sendSms.js");

    // sendSms 자체는 성공 (usage recording 실패와 무관)
    await expect(
      sendSms({ phone: "01012345678", message: "test msg" })
    ).resolves.toBeUndefined();

    delete process.env["NAVER_SENS_ACCESS_KEY"];
    delete process.env["NAVER_SENS_SECRET_KEY"];
    delete process.env["NAVER_SENS_SERVICE_ID"];
    delete process.env["NAVER_SENS_SENDER_PHONE"];
  });
});
