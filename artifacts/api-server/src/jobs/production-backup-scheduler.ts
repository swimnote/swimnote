/**
 * jobs/production-backup-scheduler.ts — 자동 일일 Production → Backup DB 스냅샷
 *
 * 스케줄:  매일 새벽 04:00 Asia/Seoul (사용량 최소 시간대)
 * 명령:    pnpm run backup:production (동일 로직 — 수동/자동 일치)
 * 안전:    atomic transaction (BEGIN/COMMIT/ROLLBACK) → 실패 시 이전 VERIFIED 보존
 * 락:      schedulerLock "production-backup-daily" (TTL 3600s) → 중복 실행 방지
 * 모니터:  recordHeartbeat → scheduler_heartbeat 테이블에 마지막 상태 기록
 *
 * PII/secret 출력 금지. Production READ ONLY.
 */

import cron from "node-cron";
import { runProductionBackup } from "../scripts/backup-production.js";
import { acquireLock, releaseLock, refreshLock, recordHeartbeat } from "../lib/schedulerLock.js";

const JOB_NAME = "production-backup-daily";
const JOB_TTL  = 3600; // 1시간 TTL — 백업 최대 소요 시간 상한

export async function runScheduledProductionBackup(): Promise<void> {
  const locked = await acquireLock(JOB_NAME, JOB_TTL);
  if (!locked) {
    console.log("[production-backup] 다른 인스턴스가 실행 중 — 스킵");
    return;
  }

  // 장시간 실행 중 TTL 만료 방지: 10분마다 락 갱신
  const refreshInterval = setInterval(() => {
    refreshLock(JOB_NAME, JOB_TTL).catch(() => {});
  }, 10 * 60 * 1000);

  console.log(`[production-backup] 자동 스냅샷 시작 → ${new Date().toISOString()}`);
  const startedAt = Date.now();

  try {
    const result = await runProductionBackup();

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[production-backup] 완료 — snapshot: ${result.snapshotId}` +
      `, tables: ${result.tableCount}` +
      `, status: ${result.verificationStatus}` +
      `, elapsed: ${(elapsedMs / 1000).toFixed(1)}s`
    );

    await recordHeartbeat(JOB_NAME, {
      status:              "success",
      snapshot_id:         result.snapshotId,
      table_count:         result.tableCount,
      verification_status: result.verificationStatus,
      elapsed_ms:          elapsedMs,
    });

  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    // Sanitized error — no PII, no secrets
    const safeMsg = (err?.message ?? String(err)).slice(0, 200).replace(/postgres:\/\/[^@]+@[^/]+/g, "[REDACTED]");
    console.error(`[production-backup] 실패 — ${safeMsg}`);

    await recordHeartbeat(JOB_NAME, {
      status:     "error",
      error:      safeMsg,
      elapsed_ms: elapsedMs,
    }).catch(() => {});
  } finally {
    clearInterval(refreshInterval);
    await releaseLock(JOB_NAME);
  }
}

export function startProductionBackupScheduler(): void {
  // 매일 새벽 04:00 Asia/Seoul — 사용량 최소 시간대
  cron.schedule("0 4 * * *", async () => {
    try {
      await runScheduledProductionBackup();
    } catch (e: any) {
      console.error("[cron] production-backup 예외:", e?.message?.slice(0, 100));
    }
  }, { timezone: "Asia/Seoul" });

  console.log("[production-backup] 일일 자동 스냅샷 스케줄러 등록 (04:00 Asia/Seoul)");
}
