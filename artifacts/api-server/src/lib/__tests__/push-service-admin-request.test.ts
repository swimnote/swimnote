import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  superAdminExecute: vi.fn(),
  logOperationalError: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: (...args: any[]) => mocks.dbExecute(...args) },
  superAdminDb: { execute: (...args: any[]) => mocks.superAdminExecute(...args) },
}));

vi.mock("../event-logger.js", () => ({
  logOperationalError: (...args: any[]) => mocks.logOperationalError(...args),
}));

import { sendPushToUserWithResult } from "../push-service.js";

const expoUrl = "https://exp.host/--/api/v2/push/send";
const oneToken = [{ token: "ExponentPushToken[test-device]" }];

function sqlText(query: any): string {
  return new PgDialect().sqlToQuery(query).sql;
}

function setExpoTickets(tickets: any[]) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: tickets }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  mocks.dbExecute.mockReset().mockImplementation(async (query: any) => {
    const querySql = sqlText(query);
    if (querySql.includes("FROM push_settings")) return { rows: [] };
    if (querySql.includes("FROM push_tokens")) return { rows: oneToken };
    return { rows: [] };
  });
  mocks.superAdminExecute.mockReset().mockResolvedValue({ rows: [] });
  mocks.logOperationalError.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendPushToUserWithResult parent-link admin request", () => {
  it("uses the default-enabled preference and returns true for an accepted Expo ticket", async () => {
    const fetchMock = setExpoTickets([{ status: "ok", id: "ticket_ok" }]);

    const delivered = await sendPushToUserWithResult(
      "pool_admin",
      false,
      "parent_link_admin_request",
      "학부모 연결 승인 요청",
      "승인을 기다리는 요청이 있습니다.",
      { screen: "approvals", tab: "parent", pendingId: "pending_test" },
      "parent_v2_admin_request_pool_test_pending_test",
    );

    expect(delivered).toBe(true);
    expect(mocks.dbExecute.mock.calls.some(([query]) => sqlText(query).includes("FROM push_settings"))).toBe(true);
    expect(mocks.dbExecute.mock.calls.some(([query]) => sqlText(query).includes("FROM push_tokens"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expoUrl, expect.objectContaining({ method: "POST" }));
  });

  it("returns false when there is no configured token and does not call Expo", async () => {
    mocks.dbExecute.mockImplementation(async (query: any) => {
      const querySql = sqlText(query);
      if (querySql.includes("FROM push_settings")) return { rows: [] };
      if (querySql.includes("FROM push_tokens")) return { rows: [] };
      return { rows: [] };
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const delivered = await sendPushToUserWithResult(
      "pool_admin",
      false,
      "parent_link_admin_request",
      "title",
      "body",
    );

    expect(delivered).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns true when at least one device ticket is accepted despite another device failing", async () => {
    mocks.dbExecute.mockImplementation(async (query: any) => {
      const querySql = sqlText(query);
      if (querySql.includes("FROM push_settings")) return { rows: [] };
      if (querySql.includes("FROM push_tokens")) {
        return { rows: [
          { token: "ExponentPushToken[accepted-device]" },
          { token: "ExponentPushToken[rejected-device]" },
        ] };
      }
      return { rows: [] };
    });
    const fetchMock = setExpoTickets([
      { status: "ok", id: "ticket_ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const delivered = await sendPushToUserWithResult(
      "pool_admin",
      false,
      "parent_link_admin_request",
      "title",
      "body",
    );

    expect(delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.dbExecute.mock.calls.some(([query]) => sqlText(query).startsWith("DELETE FROM push_tokens"))).toBe(true);
  });

  it("returns false when every Expo ticket is rejected", async () => {
    const fetchMock = setExpoTickets([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const delivered = await sendPushToUserWithResult(
      "pool_admin",
      false,
      "parent_link_admin_request",
      "title",
      "body",
    );

    expect(delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});