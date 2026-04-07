/**
 * verify-operators.ts — 운영자 카운트·목록 일치 검증 스크립트
 * 실행: npx tsx src/scripts/verify-operators.ts
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getPoolOperators } from "../lib/poolOperatorService.js";

async function main() {
  console.log("=".repeat(60));
  console.log("운영자 카운트·목록 일치 검증");
  console.log("=".repeat(60));

  // ── 1. swimming_pools 목록
  const pools = (await superAdminDb.execute(sql`
    SELECT id, name FROM swimming_pools ORDER BY created_at
  `)).rows as any[];

  console.log(`\n▶ swimming_pools 총 ${pools.length}개`);
  pools.forEach(p => console.log(`  • ${p.id}  →  ${p.name}`));

  // ── 2. 전체 users WHERE role='pool_admin' 원본 데이터
  const allAdmins = (await superAdminDb.execute(sql`
    SELECT id, name, role, swimming_pool_id, is_activated
    FROM users
    WHERE role = 'pool_admin'
    ORDER BY swimming_pool_id, created_at
  `)).rows as any[];

  console.log(`\n▶ users WHERE role='pool_admin' 전체 ${allAdmins.length}명`);
  allAdmins.forEach(u => {
    const inPool = pools.some(p => p.id === u.swimming_pool_id);
    const tag = inPool ? "✅ 풀 존재" : "⚠️  고아(풀 없음)";
    console.log(`  [${tag}] id=${u.id} | name=${u.name} | pool=${u.swimming_pool_id} | is_activated=${u.is_activated}`);
  });

  // ── 3. 고아 레코드 분리
  const orphans = allAdmins.filter(u => !pools.some(p => p.id === u.swimming_pool_id));
  console.log(`\n▶ 고아 레코드 (swimming_pools에 없음) ${orphans.length}명`);
  orphans.forEach(u => {
    console.log(`  ❌ id=${u.id} | name=${u.name} | swimming_pool_id=${u.swimming_pool_id} | is_activated=${u.is_activated}`);
  });

  // ── 4. 풀별 3-way 검증
  console.log("\n" + "=".repeat(60));
  console.log("풀별 3-way 검증 (dashboard-stats / /admin/operators / /super/operators/:id)");
  console.log("=".repeat(60));

  for (const pool of pools) {
    const poolId = pool.id;

    // getPoolOperators (단일 소스)
    const operators = await getPoolOperators(poolId);

    // dashboard-stats의 total_operators와 동일 로직: countPoolOperators
    const countRow = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM users
      WHERE role = 'pool_admin'
        AND swimming_pool_id = ${poolId}
        AND is_activated = TRUE
    `)).rows[0] as any;

    const cnt = countRow?.cnt ?? 0;
    const match = cnt === operators.length ? "✅ 일치" : "❌ 불일치";

    console.log(`\n  수영장: ${pool.name} (${poolId})`);
    console.log(`    getPoolOperators()  = ${operators.length}명`);
    console.log(`    countPoolOperators()= ${cnt}명`);
    console.log(`    → ${match}`);

    if (operators.length > 0) {
      console.log(`    운영자 목록:`);
      operators.forEach(op => {
        console.log(`      • ${op.id} | ${op.name} | is_activated=${op.is_activated}`);
      });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("검증 완료");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
