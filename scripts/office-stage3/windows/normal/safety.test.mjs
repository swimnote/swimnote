import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ROOT } from "../common.mjs";
import { localCredentials } from "./credentials.mjs";
test("runtime synthetic credentials independent and never shared across runs", () => {
  const a=localCredentials("OFFICE-WIN-AUTH-test"), b=localCredentials("OFFICE-WIN-AUTH-test");
  const all=[a.dbPassword,a.jwtKey,...a.accounts.map(u=>u.password),a.accounts[0].pin];
  assert.ok(new Set(all).size===all.length);
  assert.ok(a.dbPassword!==b.dbPassword && a.jwtKey!==b.jwtKey && a.accounts[0].password!==b.accounts[0].password);
  assert.ok(/^\d{4}$/.test(a.accounts[0].pin));
  const admins=a.accounts.filter(u=>u.role==="pool_admin");
  assert.ok(new Set(admins.map(u=>u.poolId)).size===admins.length);
});
test("actual built input graph contains product auth, never operating DB/bootstrap or external send modules", () => {
  const graph=JSON.parse(fs.readFileSync(ROOT+"/generated-artifacts/office-normal-auth-final/normal-build-inputs.json"));
  const names=Object.keys(graph.reports.entry.inputs).join("\n");
  for(const value of ["routes/auth.ts","middlewares/auth.ts","lib/auth.ts","routes/pools.ts","routes/office.ts","schema/users.ts"])
    assert.ok(names.includes(value),value);
  assert.ok(!/lib\/db\/src\/index|src\/app\.ts|lib\/push-service|growth-report-monthly|utils\/notify/.test(names));
  assert.ok(graph.seams.some(s=>s.mode.includes("denied")));
});
test("Windows-only faults and credentials are outside all product entrypoints", () => {
  const product=fs.readFileSync(ROOT+"/artifacts/api-server/src/routes/office.ts","utf8");
  assert.ok(!/DropNext|FailMembers|fault-control|test.endpoint/.test(product));
  const source=fs.readFileSync(new URL("./entry.ts",import.meta.url),"utf8");
  for(const value of ["requireAuth","requireDbRoleCheck","WEB_LOGIN_REQUIRED","USE_SYNTHETIC_LOGIN_ID","res.flushHeaders()","res.destroy()"])
    assert.ok(source.includes(value),value);
});
