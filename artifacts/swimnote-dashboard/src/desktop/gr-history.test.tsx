// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isAllowedAuthRequest } from "../../desktop/security.cts";

const base = "https://swimnote-api.onrender.com/api";
const id = "student_1790000000000_abc123xyz";
const path = `/admin/growth-reports/students/${id}`;
let history: typeof import("../pages/members/gr-history");
let api: typeof import("../lib/api-client")["api"];
const fetcher = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE", base);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockImplementation(async () => { throw new Error("Unexpected fixture request"); });
  const storage = await import("../lib/token");
  storage.useDesktopTokenStorage();
  history = await import("../pages/members/gr-history");
  api = (await import("../lib/api-client")).api;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("uses the real API client, exact canonical URL and GET for a server-generated text ID", async () => {
  const signal = new AbortController().signal;
  fetcher.mockImplementation(async (url, options) => {
    expect(url).toBe(base + path);
    expect(options.method ?? "GET").toBe("GET");
    expect(options.signal).toBe(signal);
    expect(isAllowedAuthRequest(url, options.method ?? "GET")).toBe(true);
    return new Response(JSON.stringify({ success: true, reports: [{
      report_id: "fixture-report", student_id: id, report_period: "2026-09",
      published_at: "2026-10-05T00:00:00.000Z", summary_text: null,
    }] }));
  });
  const result = await history.loadGrHistory(id, signal);
  expect(result.reports).toHaveLength(1);
  expect(result.reports[0].report_period).toBe("2026-09");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("recognizes only a successful empty reports array as an empty history", async () => {
  fetcher.mockResolvedValue(new Response('{"success":true,"reports":[]}'));
  expect(await history.loadGrHistory(id)).toEqual({ success: true, reports: [] });
});

it.each([{}, { success: false, reports: [] }, { success: true, reports: null },
  { success: true }, { success: true, reports: [{}] }])(
  "rejects a malformed success envelope instead of showing zero history: %j", async body => {
    fetcher.mockResolvedValue(new Response(JSON.stringify(body)));
    const error = await history.loadGrHistory(id).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(history.grHistoryErrorMessage(error)).toContain("응답 형식");
  },
);

it.each([401, 403, 404, 500])("keeps HTTP %s separate from empty/network/parsing failures", async status => {
  fetcher.mockResolvedValue(new Response('{"error":"PRIVATE_FIXTURE_BODY"}', { status }));
  const error = await history.loadGrHistory(id).catch(value => value);
  expect(error.status).toBe(status);
  expect(history.grHistoryErrorMessage(error)).toBe(`발행 이력 조회 요청에 실패했습니다 (HTTP ${status}).`);
});

it("classifies invalid JSON separately from fetch rejection", async () => {
  fetcher.mockResolvedValue(new Response("<html>not-json</html>"));
  const error = await history.loadGrHistory(id).catch(value => value);
  expect(history.grHistoryErrorMessage(error)).toContain("응답 형식");
});

it("does not claim whether fetch rejection is offline, CORS or policy denial", async () => {
  fetcher.mockRejectedValue(new TypeError("PRIVATE_FIXTURE_URL"));
  const error = await history.loadGrHistory(id).catch(value => value);
  expect(history.grHistoryErrorMessage(error)).toContain("세부 원인은 미확인");
  expect(history.grHistoryErrorMessage(error)).not.toContain("PRIVATE_FIXTURE");
});

it("preserves fail-closed business write blocking before any network request", async () => {
  await expect(api.patch("/admin/students/fixture/info", {})).rejects.toMatchObject({ status: 403 });
  await expect(api.post("/students", {})).rejects.toMatchObject({ status: 403 });
  await expect(api.delete("/students/fixture")).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});
