/**
 * jobs/ops-monitor-scheduler.ts — WP9 Operational Monitor Poller
 *
 * 기존 schedulerLock 패턴 재사용.
 * 2분 간격 polling (MONITOR_POLL_INTERVAL_MS 환경변수로 조정 가능).
 * health endpoint 자체가 부하 원인이 되지 않음 — 모든 쿼리 bounded.
 */
import { acquireLock, releaseLock, recordHeartbeat } from "../lib/schedulerLock.js";
import {
  getSystemHealth,
  checkDb,
  check5xxSpike,
  checkPushFanout,
  checkRevenueCat,
  checkGrowthWorkers,
  checkWorkers,
  THRESHOLDS,
} from "../lib/monitoring.js";
import { processHealthIncidents } from "../lib/incident-alerts.js";

const WORKER_LOCK    = "ops-monitor";
const WORKER_TTL_SEC = 60; // lock TTL — 1분 (poll 2분 → 이전 lock은 만료됨)

async function runMonitorCycle(): Promise<void> {
  const locked = await acquireLock(WORKER_LOCK, WORKER_TTL_SEC);
  if (!locked) return; // 다른 인스턴스가 실행 중

  try {
    // 모든 체크 병렬 실행
    const [db, fiveXx, push, rc, growth, workers] = await Promise.all([
      checkDb(),
      check5xxSpike(),
      checkPushFanout(),
      checkRevenueCat(),
      checkGrowthWorkers(),
      checkWorkers(),
    ]);

    const checkedAt = new Date().toISOString();
    const snapshot = {
      overallStatus: "GREEN" as const,
      api: db,
      db,
      push,
      revenuecat: rc,
      growth,
      workers,
      checkedAt,
      fiveXx,
    };

    await processHealthIncidents(snapshot);
    await recordHeartbeat(WORKER_LOCK, { status: "ok", overallStatus: "calculated", ts: checkedAt });
  } catch (e: any) {
    console.error("[ops-monitor] 사이클 오류:", e?.message?.slice(0, 200));
    await recordHeartbeat(WORKER_LOCK, { status: "error", error: e?.message?.slice(0, 100) });
  } finally {
    await releaseLock(WORKER_LOCK);
  }
}

export function startOpsMonitorScheduler(): void {
  // Initial delay 45s — 서버 기동 완료 후 시작
  setTimeout(() => {
    void runMonitorCycle();
    setInterval(() => {
      void runMonitorCycle();
    }, THRESHOLDS.pollIntervalMs);
  }, 45_000);

  console.log(`[ops-monitor] 모니터 스케줄러 등록 (interval=${THRESHOLDS.pollIntervalMs}ms)`);
}
