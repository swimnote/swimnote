/**
 * validate-subscription.ts — 구독 전환 시나리오 검증
 *
 * 테스트:
 *   1. free → pro  (memberLimit override 초기화)
 *   2. pro → advance (override 없음)
 *   3. advance → free (override 없음)
 *
 * 각 단계에서 검증:
 *   - DB 직접 읽기 (swimming_pools, pool_subscriptions)
 *   - resolveSubscription() 결과
 *   - 기대값과 일치 여부
 *
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/validate-subscription.ts
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { applySubscriptionState, resolveSubscription } from "../lib/subscriptionService.js";

const db = superAdminDb;
const POOL_NAME = "스윔노트";

// ── 플랜 기대값 ──────────────────────────────────────────────
const PLAN_EXPECTED: Record<string, {
  planName: string; memberLimit: number; storageMb: number;
  storageGb: number; displayStorage: string; videoEnabled: boolean;
}> = {
  pro:     { planName: "Premier 500", memberLimit: 500, storageMb: 133120, storageGb: 130,  displayStorage: "130GB", videoEnabled: true  },
  advance: { planName: "Premier 300", memberLimit: 300, storageMb: 81920,  storageGb: 80,   displayStorage: "80GB",  videoEnabled: true  },
  free:    { planName: "Free",        memberLimit: 10,  storageMb: 512,    storageGb: 0.5,  displayStorage: "500MB", videoEnabled: false },
};

let failCount = 0;
function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); failCount++; }
function check(label: string, got: any, expected: any) {
  if (String(got) === String(expected)) pass(`${label}: ${got}`);
  else fail(`${label}: got=${JSON.stringify(got)}, expected=${JSON.stringify(expected)}`);
}

async function readDb(poolId: string) {
  const [sp] = (await db.execute(sql`
    SELECT subscription_tier, subscription_status, subscription_source,
           base_storage_gb, video_storage_limit_mb, white_label_enabled, member_limit
    FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `)).rows as any[];
  const [ps] = (await db.execute(sql`
    SELECT tier, status FROM pool_subscriptions WHERE swimming_pool_id = ${poolId} LIMIT 1
  `)).rows as any[];
  return { sp, ps };
}

async function verifyTier(
  poolId: string,
  tier: string,
  label: string,
  opts: { memberLimitOverride?: number | null } = {}
) {
  const ex = PLAN_EXPECTED[tier];
  if (!ex) { fail(`기대값 미정의: ${tier}`); return; }

  // member_limit override 처리: undefined → 플랜 기본, null → clear, number → set
  const effectiveMemberLimit = opts.memberLimitOverride !== undefined
    ? (opts.memberLimitOverride ?? ex.memberLimit)
    : ex.memberLimit;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`시나리오: ${label}`);
  console.log(`옵션: memberLimitOverride=${JSON.stringify(opts.memberLimitOverride)}`);
  console.log(`${"─".repeat(60)}`);

  // 1. applySubscriptionState
  console.log("\n[1] applySubscriptionState 호출...");
  const applied = await applySubscriptionState(poolId, tier, "manual", "active", {
    resetReadonly: true,
    memberLimitOverride: opts.memberLimitOverride,
  });
  console.log(`    반환값: planName="${applied.planName}", storageGb=${applied.storageGb}, memberLimit=${applied.memberLimit}`);

  // 2. DB 직접 읽기
  console.log("\n[2] DB 직접 읽기...");
  const { sp, ps } = await readDb(poolId);
  check("swimming_pools.subscription_tier",      sp.subscription_tier,     tier);
  check("swimming_pools.subscription_status",     sp.subscription_status,   "active");
  check("swimming_pools.subscription_source",     sp.subscription_source,   "manual");
  check("swimming_pools.base_storage_gb",         Number(sp.base_storage_gb).toFixed(1), ex.storageGb.toFixed(1));
  check("swimming_pools.video_storage_limit_mb",  Number(sp.video_storage_limit_mb) > 0, ex.videoEnabled);
  check("swimming_pools.white_label_enabled",     sp.white_label_enabled,   ex.videoEnabled);
  check("pool_subscriptions.tier",                ps?.tier,                 tier);
  check("pool_subscriptions.status",              ps?.status,               "active");

  // member_limit DB 직접 값 확인
  if (opts.memberLimitOverride === null) {
    // null → DB에 NULL 저장되어야 함 → resolver는 플랜 기본값 사용
    const dbMl = sp.member_limit;
    if (dbMl === null || dbMl === undefined) pass("swimming_pools.member_limit: NULL (override 해제)");
    else fail(`swimming_pools.member_limit: ${dbMl} (NULL이어야 함)`);
  }

  // 3. resolveSubscription
  console.log("\n[3] resolveSubscription() 결과...");
  const resolved = await resolveSubscription(poolId);
  check("resolver.planCode",          resolved.planCode,      tier);
  check("resolver.planName",          resolved.planName,      ex.planName);
  check("resolver.status",            resolved.status,        "active");
  check("resolver.memberLimit",       resolved.memberLimit,   effectiveMemberLimit);
  check("resolver.storageMb",         resolved.storageMb,     ex.storageMb);
  check("resolver.storageGb",         resolved.storageGb.toFixed(1),    ex.storageGb.toFixed(1));
  check("resolver.displayStorage",    resolved.displayStorage, ex.displayStorage);
  check("resolver.videoEnabled",      resolved.videoEnabled,  ex.videoEnabled);
  check("resolver.whiteLabelEnabled", resolved.whiteLabelEnabled, ex.videoEnabled);

  // 4. DB ↔ resolver 교차 검증
  console.log("\n[4] DB ↔ resolver 교차 검증...");
  check("db.tier == resolver.planCode",              sp.subscription_tier, resolved.planCode);
  check("db.base_storage_gb == resolver.storageGb",  Number(sp.base_storage_gb).toFixed(1), resolved.storageGb.toFixed(1));
  check("db.white_label_enabled == resolver.whiteLabelEnabled", sp.white_label_enabled, resolved.whiteLabelEnabled);
}

async function main() {
  console.log("=".repeat(60));
  console.log("구독 전환 시나리오 검증");
  console.log("=".repeat(60));

  // 풀 ID 조회
  const [poolRow] = (await db.execute(sql`
    SELECT id, name, subscription_tier, base_storage_gb, member_limit
    FROM swimming_pools WHERE name = ${POOL_NAME} LIMIT 1
  `)).rows as any[];
  if (!poolRow) { fail(`풀을 찾을 수 없음: ${POOL_NAME}`); process.exit(1); }
  const poolId = poolRow.id;
  console.log(`\n대상: ${poolRow.name} (${poolId})`);
  console.log(`현재 상태: tier=${poolRow.subscription_tier}, base_storage_gb=${poolRow.base_storage_gb}, member_limit=${poolRow.member_limit}`);

  // ── 시나리오 1: → pro (memberLimitOverride=null → 플랜 기본값으로 리셋) ──
  await verifyTier(poolId, "pro", "→ pro (override 초기화 포함)", { memberLimitOverride: null });

  // ── 시나리오 2: pro → advance (override 없음, 플랜 기본값) ──────────────
  await verifyTier(poolId, "advance", "pro → advance (override 없음)");

  // ── 시나리오 3: advance → free (override 없음) ─────────────────────────
  await verifyTier(poolId, "free", "advance → free (override 없음)");

  // ── 시나리오 4(보너스): free → advance override=1000 ──────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("보너스: free → advance + memberLimit override=1000 테스트");
  console.log(`${"─".repeat(60)}`);
  const applied4 = await applySubscriptionState(poolId, "advance", "manual", "active", {
    memberLimitOverride: 1000, resetReadonly: true,
  });
  check("override 적용 후 memberLimit", applied4.memberLimit, 1000);
  const resolved4 = await resolveSubscription(poolId);
  check("resolver가 override 반영",    resolved4.memberLimit, 1000);
  check("resolver.overrideActive",     resolved4.overrideActive, true);

  // ── 원복: advance, override 초기화 ───────────────────────────────────
  console.log("\n\n원복: advance (override 해제) 복원...");
  const final = await applySubscriptionState(poolId, "advance", "manual", "active", { memberLimitOverride: null });
  console.log(`원복 완료: ${final.planName}, ${final.storageGb}GB, 회원한도 ${final.memberLimit}명`);

  console.log("\n" + "=".repeat(60));
  if (failCount > 0) {
    console.error(`❌ ${failCount}개 검증 실패`);
  } else {
    console.log("✅ 전체 검증 통과");
  }
  console.log("=".repeat(60));
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
