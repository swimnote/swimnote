import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { Response } from "express";

const fixture = vi.hoisted(() => ({
  handlers: {} as Record<string, (value: any) => void>,
  query: vi.fn(async () => {}),
}));
vi.mock("pg", () => ({
  default: { Client: class {
    on(name: string, handler: (value: any) => void) { fixture.handlers[name] = handler; }
    async connect() {}
    query = fixture.query;
    async end() {}
  } },
}));
import { addSseClient, removeSseClient, startListener } from "./pg-realtime";

const registered: Array<{ poolId: string; res: Response }> = [];
beforeAll(async () => {
  // No DB connection: pg.Client is mocked before the production registry is imported.
  vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://fixture");
  await startListener();
});
afterEach(() => { registered.splice(0).forEach(removeSseClient); });
afterAll(() => vi.unstubAllEnvs());
function client(poolId: string) {
  const write = vi.fn();
  const entry = { poolId, res: { write } as unknown as Response };
  registered.push(entry);
  addSseClient(entry);
  return { entry, write };
}
function notify(poolId: string, channel = "pool_events") {
  fixture.handlers.notification({
    channel, payload: JSON.stringify({ type: "member.changed", pool_id: poolId, entity_id: "fixture-id" }),
  });
}
it("the existing registry delivers only to the matching pool, without pool identifiers in client payloads", () => {
  const a = client("fixture-pool-a"), b = client("fixture-pool-b");
  notify("fixture-pool-a");
  expect(a.write).toHaveBeenCalledWith('data: {"type":"member.changed","entity_id":"fixture-id"}\n\n');
  expect(b.write).not.toHaveBeenCalled();
  notify("fixture-pool-a", "other_channel");
  expect(a.write).toHaveBeenCalledTimes(1);
});
it("disconnect cleanup prevents later delivery", () => {
  const a = client("fixture-pool-a");
  removeSseClient(a.entry);
  notify("fixture-pool-a");
  expect(a.write).not.toHaveBeenCalled();
});
it("gates matching-pool broadcasts while authority is unknown, without touching another pool", () => {
  const a = client("fixture-pool-a"), b = client("fixture-pool-b");
  const gate = vi.fn(() => false), before = vi.fn();
  Object.assign(a.entry, { canSend: gate, beforeEvent: before });
  const otherGate = vi.fn(() => true);
  Object.assign(b.entry, { canSend: otherGate });
  notify("fixture-pool-a");
  expect(a.write).not.toHaveBeenCalled();
  expect(gate).toHaveBeenCalledTimes(1);
  expect(before).toHaveBeenCalledWith("member.changed");
  expect(otherGate).not.toHaveBeenCalled();
  expect(b.write).not.toHaveBeenCalled();
  gate.mockReturnValue(true);
  notify("fixture-pool-a");
  expect(a.write).toHaveBeenCalledTimes(1);
});
it("delegates a broken socket write to the guarded cleanup callback", () => {
  const a = client("fixture-pool-a");
  const close = vi.fn();
  Object.assign(a.entry, { onWriteError: close });
  a.write.mockImplementation(() => { throw new Error("fixture socket closed"); });
  notify("fixture-pool-a");
  expect(close).toHaveBeenCalledTimes(1);
});
