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
