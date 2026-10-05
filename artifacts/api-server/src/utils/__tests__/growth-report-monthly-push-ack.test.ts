import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { execute, enabled } = vi.hoisted(() => ({ execute: vi.fn(), enabled: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { execute }, superAdminDb: { execute } }));
vi.mock("../../lib/push-service.js", () => ({
  checkPushEnabled: enabled, sendPushToUser: vi.fn(),
  sendPushToSuperAdmins: vi.fn(), sendPushToPoolAdmins: vi.fn(),
}));
import { sendMonthlyGrowthReportAdminPush } from "../notify.js";
import { KnownGrowthReportPushRejection } from "../growth-report-notification-outbox.js";

const item = {
  type: "GROWTH_REPORT_DAY5_DEADLINE_BLOCKED" as const,
  poolId: "pool", reportPeriod: "2026-09", recipientId: "super",
  recipientType: "user" as const, title: "blocked", body: "aggregate",
  deepLink: "/super/ai", payload: { unknown: 2 }, eventKey: "day5",
};
describe("monthly PUSH must not silently acknowledge a skipped send", () => {
  beforeEach(() => {
    enabled.mockReset().mockResolvedValue(true);
    execute.mockReset().mockResolvedValue({rows:[{token:"ExpoPushToken[fixture]"}]});
  });
  afterEach(() => vi.unstubAllGlobals());
  it("keeps disabled PUSH explicitly rejected rather than falsely delivered", async () => {
    enabled.mockResolvedValue(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    await expect(sendMonthlyGrowthReportAdminPush(item)).rejects.toBeInstanceOf(KnownGrowthReportPushRejection);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps missing tokens explicitly rejected rather than falsely delivered", async () => {
    execute.mockResolvedValue({rows:[]});
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    await expect(sendMonthlyGrowthReportAdminPush(item)).rejects.toBeInstanceOf(KnownGrowthReportPushRejection);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("acknowledges only an accepted provider response", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok:true,status:200,json:async()=>({data:[{status:"ok",id:"ticket"}]}),
    });
    vi.stubGlobal("fetch",fetch);
    expect(await sendMonthlyGrowthReportAdminPush(item)).toEqual({providerReceiptId:'["ticket"]'});
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)[0].data).toEqual({unknown:2});
  });
});
