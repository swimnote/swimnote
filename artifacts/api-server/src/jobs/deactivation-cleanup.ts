/**
 * deactivation-cleanup.ts — 90일 유예 만료 수영장 영구 삭제 스케줄러
 *
 * 매일 한국시간 새벽 3시 실행
 * deletion_scheduled_at <= NOW() 인 수영장을 모두 영구 삭제
 */
import cron from "node-cron";
import { superAdminDb, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createOpsAlert } from "../lib/opsAlerts.js";
import { acquireLock, releaseLock } from "../lib/schedulerLock.js";

const LOCK_KEY = "deactivation-cleanup";

async function runDeactivationCleanup(): Promise<void> {
  const acquired = await acquireLock(LOCK_KEY, 60).catch(() => false);
  if (!acquired) {
    console.log("[deactivation-cleanup] 다른 인스턴스가 실행 중, 건너뜀");
    return;
  }
  try {
    const expiredPools = (await superAdminDb.execute(sql`
      SELECT id, name FROM swimming_pools
      WHERE deletion_scheduled_at IS NOT NULL
        AND deletion_scheduled_at <= NOW()
      LIMIT 50
    `)).rows as any[];

    if (expiredPools.length === 0) {
      console.log("[deactivation-cleanup] 삭제 대상 없음");
      return;
    }

    console.log(`[deactivation-cleanup] 삭제 대상 ${expiredPools.length}개 처리 시작`);
    let deleted = 0;

    for (const pool of expiredPools) {
      try {
        const poolId = pool.id;
        await db.execute(sql`DELETE FROM students WHERE swimming_pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM parent_accounts WHERE swimming_pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM teacher_invites WHERE swimming_pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM policy_consents WHERE pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM pool_subscriptions WHERE swimming_pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM users WHERE swimming_pool_id = ${poolId}`).catch(() => {});
        await superAdminDb.execute(sql`DELETE FROM swimming_pools WHERE id = ${poolId}`).catch(() => {});

        console.log(`[deactivation-cleanup] 영구 삭제 완료: ${poolId} (${pool.name})`);
        deleted++;

        await createOpsAlert({
          type: "pool_permanently_deleted",
          title: "수영장 영구 삭제",
          message: `${pool.name ?? poolId} 수영장이 90일 유예 만료로 영구 삭제되었습니다.`,
          severity: "warning",
          relatedPoolId: poolId,
        }).catch(console.error);
      } catch (e: any) {
        console.error(`[deactivation-cleanup] 삭제 오류 ${pool.id}:`, e.message);
      }
    }

    console.log(`[deactivation-cleanup] 완료: ${deleted}/${expiredPools.length}개 삭제`);
  } finally {
    await releaseLock(LOCK_KEY).catch(() => {});
  }
}

export function startDeactivationCleanupScheduler(): void {
  // 매일 한국시간 새벽 3시 (UTC 18:00)
  cron.schedule("0 18 * * *", async () => {
    console.log("[deactivation-cleanup] 스케줄 실행 시작");
    await runDeactivationCleanup().catch(e =>
      console.error("[deactivation-cleanup] 스케줄 오류:", e)
    );
  }, { timezone: "UTC" });

  console.log("[deactivation-cleanup] 스케줄러 시작 (매일 UTC 18:00 = KST 03:00)");
}
