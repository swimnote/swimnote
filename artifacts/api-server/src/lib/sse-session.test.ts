import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  expiresAt: 0,
  clients: new Set<any>(),
}));
vi.mock("./sse-access.js", () => ({
  checkStreamAccess: vi.fn(async () => true),
  streamPrincipal: (_token: string, poolId: string) => ({
    userId: "fixture-user", role: "pool_admin", poolId, expiresAt: fixture.expiresAt,
  }),
}));
vi.mock("./pg-realtime.js", () => ({
  addSseClient: (c: unknown) => fixture.clients.add(c),
  removeSseClient: (c: unknown) => fixture.clients.delete(c),
}));
import { openAdminStream, StreamAuthority } from "./sse-session";
const responses: any[] = [];
beforeEach(() => { vi.useFakeTimers(); fixture.expiresAt = Date.now() + 60_000; });
afterEach(() => {
  responses.splice(0).forEach(r => r.emit("close"));
  expect(fixture.clients.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});
function socket() {
  const req = Object.assign(new EventEmitter(), { headers: { authorization: "Bearer fixture-only" } });
  const res: any = Object.assign(new EventEmitter(), {
    headersSent: false, writableEnded: false, destroyed: false,
    write: vi.fn(), setHeader: vi.fn(),
    flushHeaders() { this.headersSent = true; },
    end(this: any) { this.writableEnded = true; this.emit("close"); },
    status: vi.fn(function(this: any) { return this; }),
    json: vi.fn(function(this: any) { this.end(); }),
  });
  responses.push(res);
  return { req, res, open: (authority: StreamAuthority, pool = "fixture-pool") =>
    openAdminStream(req as unknown as Request, res as Response, pool, authority) };
}
it("shares checks, stops exactly at JWT expiry and releases all resources", async () => {
  fixture.expiresAt = Date.now() + 500;
  const check = vi.fn(async () => true), authority = new StreamAuthority(check);
  const a = socket(), b = socket();
  await Promise.all([a.open(authority), b.open(authority)]);
  expect(check).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(500);
  expect(a.res.writableEnded).toBe(true); expect(b.res.writableEnded).toBe(true);
  expect(a.res.write).toHaveBeenLastCalledWith('data: {"type":"session.invalid","reason":"expired"}\n\n');
  expect(a.req.listenerCount("aborted")).toBe(0);
  expect(a.res.listenerCount("close")).toBe(0);
});
it("blocks event writes during a check and closes all sockets on revocation", async () => {
  let resolve!: (v: boolean) => void;
  const check = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const a = socket(); await a.open(new StreamAuthority(check));
  const client = [...fixture.clients][0];
  await vi.advanceTimersByTimeAsync(15_000);
  expect(client.canSend()).toBe(false);
  resolve(false); await vi.advanceTimersByTimeAsync(0);
  expect(a.res.writableEnded).toBe(true);
  expect(a.res.write).toHaveBeenLastCalledWith('data: {"type":"session.invalid","reason":"revoked"}\n\n');
});
it.each(["reject", "timeout"])("fails closed on %s, with a distinct transient control frame", async failure => {
  const check = vi.fn().mockResolvedValueOnce(true).mockImplementationOnce(() =>
    failure === "reject" ? Promise.reject(new Error("fixture")) : new Promise(() => {}));
  const a = socket(); await a.open(new StreamAuthority(check));
  await vi.advanceTimersByTimeAsync(17_000);
  expect(a.res.writableEnded).toBe(true);
  expect(a.res.write).toHaveBeenLastCalledWith('data: {"type":"session.invalid","reason":"unavailable"}\n\n');
});
it("uses pool-settings signals and requests one resync after the paused window", async () => {
  const check = vi.fn(async () => true);
  const a = socket(); await a.open(new StreamAuthority(check));
  const client = [...fixture.clients][0];
  client.beforeEvent("pool_settings.changed");
  expect(client.canSend()).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(a.res.write).toHaveBeenLastCalledWith('data: {"type":"resync.required"}\n\n');
  expect(check).toHaveBeenCalledTimes(2);
});
it("denies an initial failed check without opening a stream or leaking a timer", async () => {
  const a = socket(); await a.open(new StreamAuthority(async () => false));
  expect(a.res.status).toHaveBeenCalledWith(403);
  expect(a.res.flushHeaders && a.res.headersSent).toBe(false);
});
it("ignores a late initial DB response after the socket closes", async () => {
  let resolve!: (v: boolean) => void;
  const a = socket();
  const opening = a.open(new StreamAuthority(() => new Promise(r => { resolve = r; })));
  await Promise.resolve();
  a.res.emit("close"); resolve(true); await opening;
  expect(a.res.headersSent).toBe(false);
  expect(fixture.clients.size).toBe(0);
});
