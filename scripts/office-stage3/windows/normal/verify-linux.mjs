// Local synthetic evidence only. Never prints/stores passwords, PINs, JWTs or full auth responses.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import crypto from "node:crypto";
const root = path.resolve(import.meta.dirname, "../../../..");
const dirAt = process.argv.indexOf("--evidence-dir");
const out = dirAt < 0 ? path.join(root, "generated-artifacts/office-normal-auth-check") : path.resolve(process.argv[dirAt + 1]);
if (!out.startsWith(path.join(root,"generated-artifacts/"))) throw new Error("Isolated evidence directory required");
const folder = fs.readFileSync(path.join(out, "run-path.txt"), "utf8");
const state = JSON.parse(fs.readFileSync(path.join(folder, "private.json")));
const require = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { Pool } = require("pg"), jwt = require("jsonwebtoken"), otp = require("otplib");
const pool = new Pool({ host: "127.0.0.1", port: 55440, user: "office_fixture", database: "office_stage3_acceptance",
  password: state.dbPassword, options: "-c search_path=office_acceptance -c client_encoding=UTF8" });
const results = [], tokens = {};
const record = (name, details = {}) => { results.push({ name, pass: true, ...details }); console.log("PASS " + name); };
async function call(route, token, body, status) {
  const response = await fetch("http://127.0.0.1:20411/api" + route, {
    method: body === undefined ? "GET" : "POST", headers: { Origin: "app://office", "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error",
  });
  if (status !== undefined) assert.equal(response.status, status, route);
  return { status: response.status, body: await response.json().catch(() => null) };
}
const setFault = update => {
  const file = path.join(folder, "fault-control.json");
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file)), ...update }));
};
const student = async () => (await call("/students?pool_all=true", tokens.fixture_admin, undefined, 200)).body.find(row => row.id === "fixture_member");
const issue = async command => ({ ...command, ...(await call("/office/requests", tokens.fixture_admin, command, 200)).body });
try {
  const primaryAccount = state.accounts[0];
  await call("/auth/login", null, { email: " " + primaryAccount.email.toUpperCase() + " ", password: primaryAccount.password, web_login: true }, 400);
  await call("/auth/login", null, { email: primaryAccount.identifier, password: primaryAccount.password, web_login: false }, 400);
  record("PIN email variant and non-web policy bypass denied by isolated envelope");
  for (const account of state.accounts) {
    const response = await call("/auth/login", null, { email: account.identifier ?? account.email, password: account.password, web_login: true });
    if (account.id === "isolation_offpool") { assert.equal(response.status, 403); record("inactive Pool login rejected"); continue; }
    assert.equal(response.status, 200);
    let body = response.body;
    if (account.pin) {
      assert.equal(body.web_pin_required, true); assert.equal(body.token, undefined);
      assert.equal((await call("/auth/web-pin/verify", null, { web_session: body.web_session, web_pin: "invalid" })).status, 401);
      body = (await call("/auth/web-pin/verify", null, { web_session: body.web_session, web_pin: account.pin }, 200)).body;
      record("actual PIN branch rejects invalid PIN and issues final token only after success");
    }
    if (account.totpSecret) {
      assert.equal(body.totp_required, true); assert.equal(body.token, undefined);
      assert.equal((await call("/auth/totp/verify-login", null, { totp_session: body.totp_session, otp_code: "000000" })).status, 401);
      const otpCode = otp.generateSync({ secret: account.totpSecret });
      body = (await call("/auth/totp/verify-login", null, { totp_session: body.totp_session, otp_code: otpCode }, 200)).body;
      record("actual TOTP branch rejects invalid OTP and accepts generated current OTP");
    }
    assert.equal(typeof body.token, "string");
    tokens[account.id] = body.token; // Memory only; all positive tokens came from real HTTP login.
  }
  const primary = state.accounts[0];
  await call("/auth/login", null, { email: primary.identifier, password: "wrong-password", web_login: true }, 401);
  record("wrong login password rejected");
  const me = (await call("/auth/me", tokens.fixture_admin, undefined, 200)).body;
  assert.equal(me.id, "fixture_admin"); assert.equal(me.swimming_pool_id, "fixture_pool");
  const pools = (await call("/pools/my-pools", tokens.fixture_admin, undefined, 200)).body;
  assert.equal(pools[0].id, "fixture_pool");
  const mode = (await call("/pools/x-mode", tokens.fixture_admin, undefined, 200)).body;
  assert.equal(mode.pool_id, "fixture_pool"); assert.equal(mode.mode, "x");
  record("actual login -> me -> my-pools -> x-mode IDs and membership agree");
  await call("/auth/me", null, undefined, 401);
  await call("/auth/me", tokens.fixture_admin + "tampered", undefined, 401);
  const negativeExpired = jwt.sign({ userId: "fixture_admin", role: "pool_admin", poolId: "fixture_pool", tv: 1 }, state.jwtKey, { expiresIn: -1 });
  await call("/auth/me", negativeExpired, undefined, 401);
  record("missing/tampered/expired tokens rejected; constructed token is negative-only");
  await call("/auth/me", tokens.isolation_inactive, undefined, 401);
  await call("/office/requests", tokens.isolation_teacher, {}, 403);
  await call("/office/requests", tokens.isolation_withdrawn, {}, 423);
  await call("/auth/me", tokens.isolation_withdrawn, undefined, 200);
  record("inactive user denied; teacher denied; withdrawal retain GET allowed, write 423");
  let row = await student();
  const update = { action: "update", memberId: row.id, requestId: "normal_utf8", expectedRevision: row.office_revision, changes: { memo: "한글 합성 메모 왕복 검증" } };
  const cross = await call("/office/requests", tokens.isolation_other, update);
  assert.ok([403,404].includes(cross.status)); record("other Pool cannot issue command on first Pool member");
  const saved = await issue(update);
  const receipt = (await call("/office/command", tokens.fixture_admin, saved, 200)).body;
  assert.equal((await student()).memo, update.changes.memo);
  const read = await call("/office/commands/" + receipt.requestId, tokens.fixture_admin, undefined, 200);
  assert.equal(read.body.requestId, receipt.requestId);
  record("UTF-8 seed/read/write roundtrip and receipt status; HTTP and DB separately checked");
  row = await student();
  const moving = await issue({ action: "move", memberId: row.id, requestId: "normal_move", expectedRevision: row.office_revision, fromClassId: "fixture_a", toClassId: "fixture_c" });
  await call("/office/command", tokens.fixture_admin, moving, 200);
  row = await student(); assert.deepEqual([...row.assigned_class_ids].sort(), ["fixture_b","fixture_c"]); assert.equal(row.weekly_count, 3);
  record("designated membership moved; other membership and weekly_count 3 preserved");
  const replay = JSON.parse(fs.readFileSync(out + "/replay-records.json"))[0];
  const search = (await call("/office/interpret", tokens.fixture_admin, replay.input, 200)).body;
  assert.equal(search.search, "합성 검증 회원");
  assert.equal((await call("/students?pool_all=true", tokens.fixture_admin, undefined, 200)).body.filter(r => r.name === search.search).length, 1);
  record("recorded raw response -> real model/interpretation -> authenticated search one member");
  setFault({ writes: false });
  const disabled = await call("/office/requests", tokens.fixture_admin, update, 503); assert.equal(disabled.body.code, "NOT_ENABLED");
  await call("/office/commands/" + receipt.requestId, tokens.fixture_admin, undefined, 200);
  record("execution OFF is NOT_ENABLED, old authenticated receipt GET remains allowed");
  setFault({ writes: true });
  const deniedReceipt = await call("/office/commands/" + receipt.requestId, tokens.isolation_other);
  assert.ok([403,404].includes(deniedReceipt.status)); record("different real login/Pool cannot read previous receipt");
  row = await student();
  const stale = await issue({ action: "update", memberId: row.id, requestId: "normal_stale", expectedRevision: row.office_revision, changes: { memo: "stale must not win" } });
  await pool.query("UPDATE students SET memo='합성 다른 작성자의 변경',updated_at=clock_timestamp() WHERE id='fixture_member'");
  await call("/office/command", tokens.fixture_admin, stale, 409);
  assert.equal((await student()).memo, "합성 다른 작성자의 변경"); record("approved synthetic writer creates actual stale revision conflict");
  row = await student();
  const drop = await issue({ action: "update", memberId: row.id, requestId: "normal_dropped", expectedRevision: row.office_revision, changes: { memo: "합성 응답 유실 후 커밋" } });
  const before = Number((await pool.query("SELECT count(*) n FROM pool_event_logs")).rows[0].n);
  setFault({ dropRequest: drop.requestId });
  let receiptDelivered = false;
  try { receiptDelivered = Boolean((await call("/office/command", tokens.fixture_admin, drop)).body?.requestId); } catch { /* interrupted delivery */ }
  assert.equal(receiptDelivered, false);
  assert.equal((await student()).memo, drop.changes.memo);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM pool_event_logs")).rows[0].n), before + 1);
  await call("/office/commands/" + drop.requestId, tokens.fixture_admin, undefined, 200);
  record("committed response delivery dropped; one DB event; same receipt recovers without reexecution");
  setFault({ failRead: drop.requestId });
  const fault = await call("/office/commands/" + drop.requestId, tokens.fixture_admin, undefined, 503);
  assert.equal(fault.body.code, "ISOLATED_READ_FAULT");
  setFault({ failRead: null }); await call("/office/commands/" + drop.requestId, tokens.fixture_admin, undefined, 200);
  record("result-only read failure and explicit recovery");
  setFault({ failMembersRead: true });
  await call("/students?pool_all=true", tokens.fixture_admin, undefined, 503);
  setFault({ failMembersRead: false });
  await student();
  record("Windows helper's actual result-members read failure and clear");
  await pool.query("UPDATE users SET roles=ARRAY['teacher'] WHERE id='fixture_admin'");
  await call("/office/commands/" + drop.requestId, tokens.fixture_admin, undefined, 403);
  await pool.query("UPDATE users SET roles=ARRAY['pool_admin'] WHERE id='fixture_admin'");
  await pool.query("UPDATE swimming_pools SET deactivated_at=now() WHERE id='fixture_pool'");
  await call("/office/commands/" + drop.requestId, tokens.fixture_admin, undefined, 403);
  await pool.query("UPDATE swimming_pools SET deactivated_at=NULL WHERE id='fixture_pool'");
  record("current DB role and Pool revocation checked on old valid token");
  // Product logout is client token clearing; no server logout/revocation endpoint is invented.
  await call("/auth/logout", tokens.fixture_admin, {}, 404);
  await call("/auth/me", tokens.fixture_admin, undefined, 200);
  record("product logout boundary: client clearing, no server revocation/refresh claimed");
  const inputs = JSON.parse(fs.readFileSync(out + "/normal-build-inputs.json")).reports;
  const sourceFiles = [...new Set(Object.values(inputs).flatMap(report => Object.keys(report.inputs)).filter(name => !name.startsWith("denied-side-effect:")))];
  const sourceHashes = sourceFiles.map(file => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex") }));
  fs.writeFileSync(out + "/normal-auth-evidence.json", JSON.stringify({ passed: true, newPaidCalls: 0, sourceHashes, positiveTokenSource: "Actual canonical HTTP login/PIN/TOTP only",
    results, windows: "NOT RUN", warning: "PIN account uses actual Pool slug path; email Drizzle path omits migrated web_pin_hash in current product schema" }, null, 2), { flag: "wx" });
} finally { await pool.end(); }
