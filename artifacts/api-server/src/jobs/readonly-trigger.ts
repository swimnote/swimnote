/**
 * jobs/readonly-trigger.ts — 구독 만료 수영장 자동 읽기전용 전환
 *
 * 기능 플래그 `readonly_auto_trigger` 가 활성화된 경우,
 * 구독이 만료(expired/cancelled/suspended)된 수영장의 is_readonly를 true로 설정.
 *
 * 매일 KST 04:00 (UTC 19:00) 실행
 */
import cron from "node-cron";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import { createOpsAlert } from "../lib/opsAlerts.js";
import { acquireLock, releaseLock } from "../lib/schedulerLock.js";
import { logEvent } from "../lib/event-logger.js";

const LOCK_KEY = "readonly-trigger";

async function runReadonlyTrigger(): Promise<void> {
  const flagEnabled = await isFeatureEnabled("readonly_auto_trigger").catch(() => false);
  if (!flagEnabled) {
    console.log("[readonly-trigger] readonly_auto_trigger 플래그 비활성화 — 건너뜀");
    return;
  }

  const acquired = await acquireLock(LOCK_KEY, 30).catch(() => false);
  if (!acquired) {
    console.log("[readonly-trigger] 다른 인스턴스가 실행 중, 건너뜀");
    return;
  }

  try {
    // 구독 만료된 수영장 중 아직 읽기전용이 아닌 것
    const targets = (await superAdminDb.execute(sql`
      SELECT id, name, subscription_status, subscription_end_at
      FROM swimming_pools
      WHERE approval_status = 'approved'
        AND is_readonly = false
        AND deletion_scheduled_at IS NULL
        AND subscription_status IN ('expired', 'cancelled', 'suspended', 'payment_failed')
        AND (subscription_end_at IS NULL OR subscription_end_at < NOW())
      LIMIT 100
    `)).rows as any[];

    if (targets.length === 0) {
      console.log("[readonly-trigger] 읽기전용 전환 대상 없음");
      return;
    }

    console.log(`[readonly-trigger] ${targets.length}개 수영장 읽기전용 전환`);
    let updated = 0;

    for (const pool of targets) {
      try {
        await superAdminDb.execute(sql`
          UPDATE swimming_pools
          SET is_readonly = true,
              metadata = COALESCE(metadata, '{}'::jsonb) ||
                jsonb_build_object('readonly_triggered_at', NOW()::text,
                                   'readonly_reason', 'auto_trigger_subscription_expired')
          WHERE id = ${pool.id}
        `);

        await logEvent({
          pool_id:    pool.id,
          category:   "읽기전용",
          actor_name: "시스템",
          description: `구독 만료로 읽기전용 자동 전환 (상태: ${pool.subscription_status})`,
          metadata:   { subscription_status: pool.subscription_status, subscription_end_at: pool.subscription_end_at },
        }).catch(() => {});

        console.log(`[readonly-trigger] 읽기전용 전환: ${pool.id} (${pool.name})`);
        updated++;
      } catch (e: any) {
        console.error(`[readonly-trigger] 오류 ${pool.id}:`, e.message);
      }
    }

    if (updated > 0) {
      await createOpsAlert({
        type:          "readonly_auto_triggered",
        title:         "읽기전용 자동 전환",
        message:       `구독 만료 ${updated}개 수영장이 자동으로 읽기전용으로 전환되었습니다.`,
        severity:      "info",
        relatedPoolId: undefined,
      }).catch(console.error);
    }

    console.log(`[readonly-trigger] 완료: ${updated}/${targets.length}개 전환`);
  } finally {
    await releaseLock(LOCK_KEY).catch(() => {});
  }
}

export function startReadonlyTriggerScheduler(): void {
  // 매일 KST 04:00 (UTC 19:00)
  cron.schedule("0 19 * * *", async () => {
    console.log("[readonly-trigger] 스케줄 실행 시작");
    await runReadonlyTrigger().catch(e =>
      console.error("[readonly-trigger] 스케줄 오류:", e)
    );
  }, { timezone: "UTC" });

  console.log("[readonly-trigger] 스케줄러 시작 (매일 UTC 19:00 = KST 04:00)");
}

/** 즉시 실행용 (관리자 수동 트리거) */
export { runReadonlyTrigger };
