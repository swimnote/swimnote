import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OfficeActionCore } from "./OfficeActionCore";
vi.mock("../lib/api-client", () => ({ api: {} })); // Never import operating API configuration.
const enabled = process.env.OFFICE_STAGE3_REAL_REPLAY === "true";
const session = enabled ? JSON.parse(readFileSync(resolve(process.cwd(), "../../generated-artifacts/office-stage3-isolated/fixture-session.json"), "utf8")) : null;
const root = "http://127.0.0.1:20411";
async function request(path: string, body?: unknown) {
  const r = await fetch(root + path, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + session.token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json(); if (!r.ok) throw { status: r.status, message: data.error, code: data.code }; return data;
}
const students = () => request("/api/students?pool_all=true");
const scenario = it.runIf(enabled);
const current = async () => (await students()).find((s: any) => s.id === "fixture_member");
function setup() {
  let destination: any = { screen: "members", memberId: "fixture_member", view: "full", tab: "basic" }, version = 0;
  const state = { failReads: false };
  const members = async () => {
    if (state.failReads) throw new Error("synthetic read failure");
    const queryStartedAt = Date.now(), data = await students();
    return { data, source: "network" as const, queryStartedAt, receivedAt: Date.now() };
  };
  const stage3 = { mode: "fixture" as const, prepare: (c: unknown) => request("/api/office/requests", c),
    write: vi.fn((c: unknown) => request("/api/office/command", c)),
    status: (id: string) => request("/api/office/commands/" + id),
    interpret: async () => { throw new Error("Paid inference forbidden in regression replay"); } };
  const core = new OfficeActionCore({ actor: { userId: "fixture_admin", poolId: "fixture_pool", role: "pool_admin" },
    scope: "isolated-real-replay-" + crypto.randomUUID(), isCurrent: () => true,
    destination: () => destination, navigationVersion: () => version,
    open: (d: any) => { destination = d; version++; return true; },
    filters: () => ({ search: "", status: "", classId: "" }), updateFilters() {},
    members, readHome: async () => ({ source: "network", queryStartedAt: Date.now(), receivedAt: Date.now() }), stage3 });
  return { core, stage3, state };
}
const input = async (changes: any) => ({ memberId: "fixture_member", requestId: "local_" + crypto.randomUUID(),
  expectedRevision: (await current()).office_revision, changes });
scenario("recorded real model multi-field proposal passes canonical Action, actual HTTP handlers, fresh query, card and read receipt", async () => {
  const before = await current();
  const evidence = readFileSync(resolve(process.cwd(), "../../generated-artifacts/office-stage3-real-ai/case-results.jsonl"), "utf8")
    .trim().split("\n").map(x => JSON.parse(x)).find(r => r.id === "fields" && r.round === 1);
  const { core } = setup();
  const outcome = await core.execute({ action: "office.member.update", input: await input(evidence.result.command.changes) }, "structured");
  expect(outcome.status).toBe("success");
  const card = core.getTasks()[0]; expect(card.status).toBe("completed"); expect(card.results[0].viewedAt).toBeUndefined();
  expect((await current()).assigned_class_ids).toEqual(before.assigned_class_ids);
  expect((await current()).weekly_count).toBe(before.weekly_count);
  await core.openTaskResult(card.id, card.results[0].id);
  expect(core.getTasks()[0].results[0].viewedAt).toBeDefined(); core.dispose();
});
scenario("actual stale revision is a failed conflict, not unknown or a repeat", async () => {
  const { core, stage3 } = setup();
  expect(await core.execute({ action: "office.member.update", input: {
    ...await input({ memo: "합성 충돌" }), expectedRevision: "0".repeat(32) } }, "menu")).toMatchObject({ status: "failed" });
  expect(stage3.write).toHaveBeenCalledTimes(1); core.dispose();
});
scenario("response loss remains unknown, never retries, then authentic receipt resolves with execution OFF", async () => {
  const { core, stage3 } = setup(), c = await input({ memo: "합성 응답 유실" });
  stage3.write = vi.fn(async body => { await request("/api/office/command", body); throw { status: 0 }; });
  expect(await core.execute({ action: "office.member.update", input: c }, "menu")).toMatchObject({ status: "unknown" });
  await core.execute({ action: "office.member.update", input: c }, "menu");
  expect(stage3.write).toHaveBeenCalledTimes(1);
  await request("/fixture/control", { writes: false });
  try { expect(await core.resolveMutation(c.requestId)).toMatchObject({ status: "success" }); }
  finally { await request("/fixture/control", { writes: true }); core.dispose(); }
});
scenario("result retrieval failure never changes unread state", async () => {
  const { core, state } = setup();
  await core.execute({ action: "office.member.update", input: await input({ memo: "합성 미열람" }) }, "menu");
  const task = core.getTasks()[0]; state.failReads = true;
  expect((await core.openTaskResult(task.id, task.results[0].id)).status).not.toBe("success");
  expect(core.getTasks()[0].results[0].viewedAt).toBeUndefined(); core.dispose();
});
