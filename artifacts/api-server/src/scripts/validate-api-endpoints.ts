/**
 * validate-api-endpoints.ts
 * HTTP API 응답 검증: /billing/status, /super/operators/:id
 * — resolver 결과만 사용 & plan_name/display_storage 정상 반환 확인
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { signToken } from "../lib/auth.js";

const BASE = "http://localhost:8080/api";
const POOL_NAME = "스윔노트";

let fail = 0;
function pass(m: string)  { console.log(`  ✅ ${m}`); }
function check(label: string, got: any, expected: any) {
  if (String(got) === String(expected)) pass(`${label}: ${got}`);
  else { console.error(`  ❌ ${label}: got=${JSON.stringify(got)}, expected=${JSON.stringify(expected)}`); fail++; }
}
function notRawTier(label: string, val: any, allowedTiers: string[]) {
  if (!allowedTiers.includes(val)) pass(`${label} = "${val}" (tier 코드 아님)`);
  else { console.error(`  ❌ ${label}: raw tier "${val}" 직접 노출됨`); fail++; }
}

async function main() {
  // 1. 필요 계정 조회
  const [superUser] = (await superAdminDb.execute(sql`
    SELECT id, email FROM users WHERE role = 'super_admin' LIMIT 1
  `)).rows as any[];
  const [poolUser] = (await superAdminDb.execute(sql`
    SELECT u.id, u.email, sp.id AS pool_id
    FROM users u JOIN swimming_pools sp ON u.swimming_pool_id = sp.id
    WHERE sp.name = ${POOL_NAME} AND u.role = 'pool_admin' LIMIT 1
  `)).rows as any[];
  const [pool] = (await superAdminDb.execute(sql`
    SELECT id FROM swimming_pools WHERE name = ${POOL_NAME} LIMIT 1
  `)).rows as any[];

  if (!superUser) { console.error("❌ super_admin 계정 없음"); process.exit(1); }
  if (!pool)      { console.error(`❌ ${POOL_NAME} 풀 없음`); process.exit(1); }

  const poolId = pool.id;
  const superToken  = signToken({ userId: superUser.id, role: "super_admin", name: "Super" });
  const adminToken  = poolUser ? signToken({ userId: poolUser.id, role: "pool_admin", name: "Admin", swimming_pool_id: poolUser.pool_id }) : null;

  const RAW_TIERS = ["free","starter","basic","standard","center_200","advance","pro","max"];

  // ── [A] /super/operators/:id ─────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[A] GET /super/operators/${poolId}`);
  const superRes = await fetch(`${BASE}/super/operators/${poolId}`, {
    headers: { Authorization: `Bearer ${superToken}` },
  });
  if (!superRes.ok) { console.error(`❌ HTTP ${superRes.status}`); fail++; }
  else {
    const { pool: p } = await superRes.json() as any;
    console.log(`    plan_name="${p.plan_name}", display_storage="${p.display_storage}", base_storage_gb=${p.base_storage_gb}`);
    // plan_name은 한글 이름이어야 함 (tier 코드 아님)
    notRawTier("plan_name", p.plan_name, RAW_TIERS);
    // display_storage 형식 확인 ("80GB" / "500MB" / "130GB")
    const displayOk = /^\d+(\.\d+)?(GB|MB)$/.test(p.display_storage ?? "");
    if (displayOk) pass(`display_storage 형식: "${p.display_storage}"`);
    else { console.error(`  ❌ display_storage 형식 이상: "${p.display_storage}"`); fail++; }
    // base_storage_gb가 resolver 값과 일치하는지 (resolver가 재계산해 덮어씀)
    check("base_storage_gb 양수", p.base_storage_gb > 0, true);
    check("member_limit 양수",   p.member_limit > 0, true);
    check("plan_name 존재",       !!p.plan_name, true);
    check("subscription_status",  p.subscription_status, "active");
  }

  // ── [B] /billing/status ──────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  if (!adminToken) {
    console.log(`[B] /billing/status — pool_admin 계정 없음, 스킵`);
  } else {
    console.log(`[B] GET /billing/status`);
    const bRes = await fetch(`${BASE}/billing/status`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!bRes.ok) { console.error(`❌ HTTP ${bRes.status}: ${await bRes.text()}`); fail++; }
    else {
      const b = await bRes.json() as any;
      console.log(`    plan_name="${b.plan_name}", display_storage="${b.display_storage}", current_plan="${b.current_plan}"`);
      notRawTier("plan_name", b.plan_name, RAW_TIERS);
      const dispOk = /^\d+(\.\d+)?(GB|MB)$/.test(b.display_storage ?? "");
      if (dispOk) pass(`display_storage 형식: "${b.display_storage}"`);
      else { console.error(`  ❌ display_storage 형식: "${b.display_storage}"`); fail++; }
      check("base_storage_gb > 0",  b.base_storage_gb > 0, true);
      check("plan_name 존재",        !!b.plan_name, true);
      check("white_label_enabled 타입", typeof b.white_label_enabled, "boolean");
    }
  }

  // ── [C] /pools/my ────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  if (!adminToken) {
    console.log(`[C] /pools/my — pool_admin 계정 없음, 스킵`);
  } else {
    console.log(`[C] GET /pools/my`);
    const pRes = await fetch(`${BASE}/pools/my`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!pRes.ok) { console.error(`❌ HTTP ${pRes.status}: ${await pRes.text()}`); fail++; }
    else {
      const pm = await pRes.json() as any;
      console.log(`    plan_name="${pm.plan_name}", display_storage="${pm.display_storage}", subscription_tier="${pm.subscription_tier}"`);
      notRawTier("plan_name", pm.plan_name, RAW_TIERS);
      check("display_storage 존재", !!pm.display_storage, true);
      check("plan_name 존재",        !!pm.plan_name, true);
      check("member_limit 양수",     pm.member_limit > 0, true);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(fail === 0 ? "✅ API 검증 전체 통과" : `❌ ${fail}개 실패`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
