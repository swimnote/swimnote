import app, { setServerReady } from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";
import { startParentLinkScheduler } from "./jobs/parent-link-scheduler.js";
import { startAutoAttendanceScheduler } from "./jobs/auto-attendance-scheduler.js";
import { startPushScheduler } from "./jobs/push-scheduler.js";
import { startDeactivationCleanupScheduler } from "./jobs/deactivation-cleanup.js";
import { startReadonlyTriggerScheduler } from "./jobs/readonly-trigger.js";
import { startStandbySyncJobs } from "./jobs/standby-sync.js";
import { startVideoExpiryCleanup } from "./jobs/video-expiry-cleanup.js";
import { startQueueWorker }         from "./jobs/queue-worker.js";
import { startGrowthReportScheduler }      from "./jobs/growth-report-scheduler.js";
import { startGrowthReportAnalysisWorker } from "./jobs/growth-report-analysis-worker.js";
import { initPoolDb } from "./migrations/pool-db-init.js";
import { initSuperDb } from "./migrations/super-db-init.js";
import { runGrInteractionsMigration } from "./migrations/pool-db-x-gr-interactions-init.js";
import { initV2PendingTable } from "./lib/auto-link-v2.js";
import { backfillPoolAdminRoles } from "./migrations/roles-backfill.js";
import { backfillPoolSubscriptionFields } from "./lib/subscriptionService.js";
import { isDbSeparated, isProtectDbConfigured, pool } from "@workspace/db";
import { getRecentAvgResponseMs } from "./lib/responseTracker.js";
import { createOpsAlert } from "./lib/opsAlerts.js";
import { sendPushToSuperAdmins } from "./lib/push-service.js";

const IS_WORKER = process.env.WORKER_MODE === "true";

// ── DB 구성 안내 ─────────────────────────────────────────────────────────────
if (!isDbSeparated) {
  console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.warn("⚠️  [백업 DB 미설정] POOL_DATABASE_URL이 설정되지 않았습니다.");
  console.warn("   pool 백업 기능이 비활성화됩니다.");
  console.warn("   ▶ Replit Secrets에 POOL_DATABASE_URL을 추가하면 활성화됩니다.");
  console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

if (!isProtectDbConfigured) {
  console.warn("⚠️  [보호백업 DB 미설정] SUPER_PROTECT_DATABASE_URL이 설정되지 않았습니다.");
  console.warn("   super 보호백업 기능이 비활성화됩니다.");
}

const rawPort = process.env["PORT"];

// Worker 모드에서는 HTTP를 열지 않으므로 PORT가 없어도 됨
if (!IS_WORKER && !rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort ?? "0");

if (!IS_WORKER && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// DB 초기화 (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — 멱등)
// 핵심 2개 완료 시 헬스체크를 200으로 전환 (Render 헬스체크 실패 방지)
// 헌법 원칙: 필수 DB Migration 실패 시 setServerReady() 미호출 + 프로세스 종료
Promise.all([
  initPoolDb(),
  initSuperDb(),
  runGrInteractionsMigration(),
])
  .then(() => {
    setServerReady();
    console.log("[server] DB 초기화 완료 — 헬스체크 200 응답 시작");
  })
  .catch((error) => {
    console.error("[FATAL] DB 초기화 실패 — 서버 기동 중단:", error);
    process.exit(1);
  });
initV2PendingTable().catch((e) => console.error("[v2-init] parent_v2_pending 테이블 초기화 오류:", e.message));
backfillPoolAdminRoles().catch((e) => console.error("[roles-backfill] 오류:", e.message));
// 일회성: diary_templates에서 "오늘은 " 접두사 제거
import("./migrations/strip-oneulun.js")
  .then(m => m.stripOneulun())
  .catch((e) => console.error("[strip-oneulun] 오류:", e.message));
// CS23A: Direct DB Answer Engine — support_intent_utterances + intent_id/answer_mode
import("./migrations/pool-db-cs-23a.js")
  .then(m => m.runCs23aMigration())
  .catch((e) => console.error("[cs23a] migration 오류:", e.message));
// CS24A: Support Query Log
import("./migrations/pool-db-cs-24a.js")
  .then(m => m.runCs24aMigration())
  .catch((e) => console.error("[cs24a] migration 오류:", e.message));
// CS24B: Support Knowledge Candidates
import("./migrations/pool-db-cs-24b.js")
  .then(m => m.runCs24bMigration())
  .catch((e) => console.error("[cs24b] migration 오류:", e.message));
// CS26: autonomous escalation outcomes (normalized queries only; no PII)
import("./migrations/pool-db-cs-26.js")
  .then(m => m.runCs26Migration())
  .catch((e) => console.error("[cs26] migration 오류:", e.message));
// GR-Interactions: readiness-critical — Promise.all로 이동됨 (위 참조)
// GR1B: gr_analysis_status_enum에 DATA_ACCUMULATING 추가 (additive, 멱등)
// gr1b migration (DATA_ACCUMULATING enum)은 수동 실행 전용.
// 스타트업 자동 실행 금지 — Render 재시작만으로 DB schema가 변경되어서는 안 됨.
setTimeout(() => {
  backfillPoolSubscriptionFields().catch((e) => console.error("[backfill-pools] 오류:", e.message));
}, 3000);

if (IS_WORKER) {
  // ── Worker 모드: 스케줄러만 실행, HTTP 없음 ─────────────────────────────
  console.log("[worker] WORKER_MODE=true — 스케줄러 전용 서버 시작");
  startBackupJobs();
  startParentLinkScheduler();
  startAutoAttendanceScheduler();
  startPushScheduler();
  startDeactivationCleanupScheduler();
  startReadonlyTriggerScheduler();
  startStandbySyncJobs();
  startVideoExpiryCleanup();
  startQueueWorker();
  startGrowthReportScheduler();
  startGrowthReportAnalysisWorker();
  console.log("[worker] 스케줄러 10개 등록 완료 (backup / parent-link / auto-attendance / push / readonly-trigger / standby-sync / video-expiry / queue-worker / growth-report / growth-report-analysis)");
  console.log("[worker] HTTP 서버 미실행 — DB 락으로 중복 실행 방지됨");
} else {
  // ── API 서버 모드: HTTP 실행 + 비활성화 정리 스케줄러 ───────────────────
  // queue-worker(retry-queue / makeup-expiry)는 WORKER_MODE=true 전용.
  // API 서버는 HTTP/API 역할만 수행한다.
  startDeactivationCleanupScheduler();
  startReadonlyTriggerScheduler();
  startStandbySyncJobs();
  startVideoExpiryCleanup();

  // ── 서버 성능 감시 + 푸시 알림 (5분마다) ───────────────────────────────────
  const SLOW_CHECK_INTERVAL = 5 * 60 * 1000;
  const WARN_THRESHOLD_MS   = 1500; // 경고: 평균 1.5초
  const CRIT_THRESHOLD_MS   = 3000; // 위험: 평균 3초

  setInterval(async () => {
    try {
      const { avg, count } = getRecentAvgResponseMs();
      if (count < 5 || avg < WARN_THRESHOLD_MS) return;

      const isCritical = avg >= CRIT_THRESHOLD_MS;
      const severity   = isCritical ? "error" : "warning";
      const emoji      = isCritical ? "🔴" : "🟡";
      const label      = isCritical ? "위험" : "경고";
      const bucketKey  = `server_slow:${new Date().toISOString().slice(0, 15)}0`; // 10분 버킷

      await createOpsAlert({
        type: "server_slow",
        title: `서버 지연 ${label}`,
        message: `최근 5분 평균 응답시간 ${avg}ms (${count}개 요청)`,
        severity,
        dedupeKey: bucketKey,
      });

      // 슈퍼관리자에게 푸시 알림
      await sendPushToSuperAdmins(
        `${emoji} 서버 응답 지연 ${label}`,
        `최근 5분 평균 ${avg}ms · ${count}개 요청\n빠른 확인이 필요합니다.`,
        { type: "server_perf", avg, count }
      );
      console.log(`[perf-monitor] 슬로우 감지 avg=${avg}ms count=${count} → 푸시 발송`);
    } catch (e: any) {
      console.error("[perf-monitor] 오류:", e?.message);
    }
  }, SLOW_CHECK_INTERVAL);

  // ── Keep-Alive 자기 핑 (슬립 방지 + 다운 감지) ──────────────────────────
  if (process.env["NODE_ENV"] === "production") {
    const PING_INTERVAL_MS = 4 * 60 * 1000;
    // 외부 URL 대신 localhost 직접 핑 — 네트워크 왕복 없이 빠르게 체크
    const selfBase = `http://localhost:${port}`;
    let pingFailCount = 0;

    setInterval(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const pingStart = Date.now();
        const res = await fetch(`${selfBase}/api/healthz`, { signal: controller.signal });
        clearTimeout(timer);
        const pingMs = Date.now() - pingStart;
        pingFailCount = 0;

        if (!res.ok) {
          console.warn(`[keep-alive] ping 응답 이상: ${res.status}`);
          await sendPushToSuperAdmins(
            "🔴 서버 헬스체크 실패",
            `HTTP ${res.status} 응답 — 서버 상태를 확인해 주세요.`,
            { type: "server_health", status: res.status }
          );
        } else if (pingMs > CRIT_THRESHOLD_MS) {
          console.warn(`[keep-alive] ping 응답 느림: ${pingMs}ms`);
        }
      } catch (e: any) {
        clearTimeout(timer);
        pingFailCount++;
        console.warn(`[keep-alive] ping 실패 (${pingFailCount}회):`, e?.message ?? e);
        // 2회 연속 실패시 푸시 (일시적 오류 제외)
        if (pingFailCount >= 2) {
          await sendPushToSuperAdmins(
            "🚨 서버 응답 없음",
            `헬스체크 ${pingFailCount}회 연속 실패\n서버가 다운됐을 수 있습니다.`,
            { type: "server_down", failCount: pingFailCount }
          ).catch(() => {});
        }
      }
    }, PING_INTERVAL_MS);
    console.log(`[keep-alive] 자기 핑 스케줄러 시작 (4분 간격) target=${selfBase}`);
  }

  const server = app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    console.log(`[DB] 운영 DB: superAdminDb (단일화 완료)`);
    console.log(`[DB] pool 백업: ${isDbSeparated ? "활성화" : "미설정 (비활성화)"}`);
    console.log(`[DB] 보호백업: ${isProtectDbConfigured ? "활성화" : "미설정 (비활성화)"}`);
  });

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  let isShuttingDown = false;

  function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[shutdown] ${signal} 수신 — graceful shutdown 시작`);

    server.close(async () => {
      console.log("[shutdown] 모든 요청 완료 — DB 연결 종료 중");
      try {
        await pool.end();
        console.log("[shutdown] DB 풀 종료 완료");
      } catch (e) {
        console.error("[shutdown] DB 풀 종료 오류:", e);
      }
      console.log("[shutdown] 서버 종료 완료");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[shutdown] 15초 초과 — 강제 종료");
      process.exit(1);
    }, 15_000).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
}

// 처리되지 않은 예외가 서버를 죽이지 않도록 로깅만 처리
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
