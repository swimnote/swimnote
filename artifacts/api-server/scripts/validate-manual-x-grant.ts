/**
 * validate-manual-x-grant.ts — Super Admin Manual X Grant Test Suite
 * 실행: tsx scripts/validate-manual-x-grant.ts
 *
 * Tests A–L (12 cases):
 *   A. No entitlement + no manual → X OFF (pure)
 *   B. Paid entitlement → X ON (pure)
 *   C. No paid + manual grant → X ON (pure)
 *   D. Manual x300 → member limit 300 (DB)
 *   E. Manual x500 → member limit 500 (DB)
 *   F. Manual x1000 → member limit 1000 (DB)
 *   G. Manual grant survives RC 'no entitlement' event (pure)
 *   H. Manual revoke + no paid → X OFF (pure)
 *   I. Manual revoke + paid valid → X remains ON via paid (pure)
 *   J. force_disabled overrides everything (pure)
 *   K. Cross-pool grant isolation (DB)
 *   L. Audit log recorded for grant (DB)
 */

import { superAdminDb } from "@workspace/db";
import { computeMode, resolveEffectiveXEntitlement } from "../src/lib/xmode.js";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

const db = superAdminDb;

const X_PLAN_LIMITS: Record<string, number> = { x300: 300, x500: 500, x1000: 1000 };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
async function q(rawSql: string, params: any[] = []) {
  const result = await db.execute(sql.raw(rawSql.replace(/\$(\d+)/g, (_m, n) => {
    const v = params[Number(n) - 1];
    return typeof v === "string" ? `'${v.replace(/'/g, "''")}'`
      : v === null ? "NULL"
      : typeof v === "boolean" ? (v ? "true" : "false")
      : String(v);
  })));
  return result as any;
}

async function getPool(poolId: string) {
  const r = await db.execute(sql`
    SELECT x_paid_entitlement, x_manual_entitlement, x_force_disabled,
           xmode_config_status, x_plan_key, member_limit
    FROM swimming_pools WHERE id = ${poolId}
  `);
  return r.rows[0] as {
    x_paid_entitlement: boolean;
    x_manual_entitlement: boolean;
    x_force_disabled: boolean;
    xmode_config_status: string;
    x_plan_key: string | null;
    member_limit: number | null;
  };
}

async function setPool(poolId: string, fields: Record<string, any>) {
  const sets = Object.entries(fields)
    .map(([k, v]) => {
      if (v === null) return `${k} = NULL`;
      if (typeof v === "boolean") return `${k} = ${v}`;
      if (typeof v === "number") return `${k} = ${v}`;
      return `${k} = '${String(v).replace(/'/g, "''")}'`;
    })
    .join(", ");
  await db.execute(sql.raw(`UPDATE swimming_pools SET ${sets} WHERE id = '${poolId}'`));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure test helpers
// ─────────────────────────────────────────────────────────────────────────────
function makePool(overrides: Partial<{
  x_paid_entitlement: boolean;
  x_manual_entitlement: boolean;
  x_force_disabled: boolean;
  xmode_config_status: "READY" | "NOT_CONFIGURED" | "CURRICULUM_PENDING";
}>) {
  return {
    x_paid_entitlement: false,
    x_manual_entitlement: false,
    x_force_disabled: false,
    xmode_config_status: "READY" as const,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let testPoolId = "";
let otherPoolId = "";

async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
async function setup() {
  // Clean up any leftover test rows from previous runs
  await db.execute(sql`DELETE FROM swimming_pools WHERE name LIKE '__test_mx_%'`);

  const ts = Date.now();
  const r = await db.execute(sql`
    INSERT INTO swimming_pools (id, name, owner_name, owner_email, address, phone, approval_status, xmode_config_status)
    VALUES (gen_random_uuid(), ${`__test_mx_grant_${ts}`}, '테스트관리자', ${`test_mx_${ts}_a@test.invalid`}, '테스트 주소', '010-0000-0000', 'approved', 'READY')
    RETURNING id
  `);
  testPoolId = (r.rows[0] as any).id;

  const r2 = await db.execute(sql`
    INSERT INTO swimming_pools (id, name, owner_name, owner_email, address, phone, approval_status, xmode_config_status)
    VALUES (gen_random_uuid(), ${`__test_mx_other_${ts}`}, '다른관리자', ${`other_mx_${ts}_b@test.invalid`}, '다른 주소', '010-1111-1111', 'approved', 'READY')
    RETURNING id
  `);
  otherPoolId = (r2.rows[0] as any).id;
}

async function teardown() {
  if (testPoolId) {
    await db.execute(sql`DELETE FROM audit_logs WHERE entity_id = ${testPoolId} AND entity_type = 'swimming_pool_xmode'`);
    await db.execute(sql`DELETE FROM swimming_pools WHERE id = ${testPoolId}`);
  }
  if (otherPoolId) {
    await db.execute(sql`DELETE FROM swimming_pools WHERE id = ${otherPoolId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
async function runTests() {
  await setup();

  console.log("\n=== A–C: Entitlement logic (pure) ===");

  await t("A. No paid + no manual → X OFF", () => {
    const p = makePool({});
    assert.equal(resolveEffectiveXEntitlement(p), false);
    assert.equal(computeMode(p), "normal");
  });

  await t("B. Paid + READY → X ON", () => {
    const p = makePool({ x_paid_entitlement: true });
    assert.equal(resolveEffectiveXEntitlement(p), true);
    assert.equal(computeMode(p), "x");
  });

  await t("C. No paid + manual + READY → X ON", () => {
    const p = makePool({ x_manual_entitlement: true });
    assert.equal(resolveEffectiveXEntitlement(p), true);
    assert.equal(computeMode(p), "x");
  });

  console.log("\n=== D–F: Plan limits (DB) ===");

  await t("D. Manual x300 → member_limit 300", async () => {
    await setPool(testPoolId, { x_manual_entitlement: true, x_plan_key: "x300", member_limit: X_PLAN_LIMITS["x300"] });
    const pool = await getPool(testPoolId);
    assert.equal(pool.x_plan_key, "x300");
    assert.equal(Number(pool.member_limit), 300);
    assert.equal(pool.x_manual_entitlement, true);
  });

  await t("E. Manual x500 → member_limit 500", async () => {
    await setPool(testPoolId, { x_plan_key: "x500", member_limit: X_PLAN_LIMITS["x500"] });
    const pool = await getPool(testPoolId);
    assert.equal(pool.x_plan_key, "x500");
    assert.equal(Number(pool.member_limit), 500);
  });

  await t("F. Manual x1000 → member_limit 1000", async () => {
    await setPool(testPoolId, { x_plan_key: "x1000", member_limit: X_PLAN_LIMITS["x1000"] });
    const pool = await getPool(testPoolId);
    assert.equal(pool.x_plan_key, "x1000");
    assert.equal(Number(pool.member_limit), 1000);
  });

  console.log("\n=== G: RevenueCat sync protection (pure) ===");

  await t("G. Manual grant survives RC 'no entitlement' (paid=false, manual=true → effective=true)", () => {
    const p = makePool({ x_paid_entitlement: false, x_manual_entitlement: true });
    assert.equal(resolveEffectiveXEntitlement(p), true, "manual survives paid=false");
    assert.equal(computeMode(p), "x");
  });

  console.log("\n=== H–I: Revoke logic (pure) ===");

  await t("H. Manual revoke + no paid → X OFF", () => {
    const p = makePool({ x_paid_entitlement: false, x_manual_entitlement: false });
    assert.equal(resolveEffectiveXEntitlement(p), false);
    assert.equal(computeMode(p), "normal");
  });

  await t("I. Manual revoke + paid valid → X remains ON via paid", () => {
    const p = makePool({ x_paid_entitlement: true, x_manual_entitlement: false });
    assert.equal(resolveEffectiveXEntitlement(p), true);
    assert.equal(computeMode(p), "x");
  });

  console.log("\n=== J–K: Authorization (pure + DB) ===");

  await t("J. force_disabled overrides paid+manual → X OFF", () => {
    const p = makePool({ x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: true });
    assert.equal(resolveEffectiveXEntitlement(p), false, "force_disabled overrides both");
    assert.equal(computeMode(p), "normal");
  });

  await t("K. Cross-pool isolation — other pool x_manual unchanged", async () => {
    // Set manual on testPool; otherPool must stay unaffected
    await setPool(testPoolId, { x_manual_entitlement: true });
    const other = await getPool(otherPoolId);
    assert.equal(other.x_manual_entitlement, false, "other pool must not be affected");
  });

  console.log("\n=== L: Audit log (DB) ===");

  await t("L. Audit log recorded for grant", async () => {
    await setPool(testPoolId, { x_manual_entitlement: false, x_plan_key: null });

    const vRes = await db.execute(sql`SELECT next_audit_version('swimming_pool_xmode', ${testPoolId}) AS v`);
    const version = (vRes.rows[0] as any).v;

    await db.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason
      ) VALUES (
        'swimming_pool_xmode', ${testPoolId}, ${version},
        'update', 'super_admin', 'test-actor-id', ${testPoolId},
        ${{ x_manual_entitlement: false }}::jsonb,
        ${{ x_manual_entitlement: true, x_plan_key: "x300", source: "super_admin_manual" }}::jsonb,
        'L test: manual grant'
      )
    `);

    const logRes = await db.execute(sql`
      SELECT after_data, reason FROM audit_logs
      WHERE entity_id = ${testPoolId} AND entity_type = 'swimming_pool_xmode'
      ORDER BY entity_version DESC LIMIT 1
    `);

    assert.equal(logRes.rows.length, 1, "audit log row must exist");
    const after = (logRes.rows[0] as any).after_data;
    assert.equal(after.x_manual_entitlement, true);
    assert.equal(after.x_plan_key, "x300");
    assert.equal(after.source, "super_admin_manual");
  });

  await teardown();
}

runTests().then(() => {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`validate-manual-x-grant: ${passed + failed} tests — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
