// Fixed loopback endpoints and synthetic member IDs only; no operating DSN or provider.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { token } = JSON.parse(await readFile(new URL("../../generated-artifacts/office-stage3-isolated/fixture-session.json", import.meta.url), "utf8"));
const root = "http://127.0.0.1:20411/api";
async function call(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(root + path, { method,
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.status, 200, `Synthetic request failed: ${method} ${path} ${response.status}`);
  return response.json();
}
assert.equal((await fetch(root + "/students")).status, 401);
assert.equal((await fetch(root + "/students/fixture_member", { method: "PATCH",
  headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: "{}" })).status, 404);
const current = async () => (await call("/students?pool_all=true")).find(s => s.id === "fixture_member");
let student = await current();
const update = { action: "update", memberId: "fixture_member", requestId: "isolated_update",
  expectedRevision: student.office_revision, changes: { memo: "격리 합성 메모" } };
Object.assign(update, await call("/office/requests", update));
const saved = await call("/office/command", update);
assert.equal((await call("/office/command", update)).revision, saved.revision);
assert.equal((await call("/office/commands/" + update.requestId)).revision, saved.revision);
student = await current(); assert.equal(student.memo, "격리 합성 메모");
const move = { action: "move", memberId: "fixture_member", requestId: "isolated_move",
  expectedRevision: student.office_revision, fromClassId: "fixture_a", toClassId: "fixture_c" };
Object.assign(move, await call("/office/requests", move));
await call("/office/command", move);
student = await current();
assert.deepEqual(student.assigned_class_ids, ["fixture_c", "fixture_b"]); assert.equal(student.weekly_count, 3);
const html = await fetch("http://127.0.0.1:20412/admin/members");
assert.equal(html.status, 200); assert.match(await html.text(), /isolated-renderer/);
console.log("ISOLATED_SMOKE_PASS: authenticated API, issued update, duplicate/status, move, preserved membership/frequency, legacy denied, renderer HTTP");
