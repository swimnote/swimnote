import app from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";
import { startParentLinkScheduler } from "./jobs/parent-link-scheduler.js";
import { startAutoAttendanceScheduler } from "./jobs/auto-attendance-scheduler.js";
import { startPushScheduler } from "./jobs/push-scheduler.js";
import { initPoolDb } from "./migrations/pool-db-init.js";
import { initSuperDb } from "./migrations/super-db-init.js";
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
initPoolDb().catch((e) => console.error("[pool-db-init] 초기화 오류:", e.message));
initSuperDb().catch((e) => console.error("[super-db-init] 초기화 오류:", e.message));
initV2PendingTable().catch((e) => console.error("[v2-init] parent_v2_pending 테이블 초기화 오류:", e.message));
backfillPoolAdminRoles().catch((e) => console.error("[roles-backfill] 오류:", e.message));
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
  console.log("[worker] 스케줄러 4개 등록 완료 (backup / parent-link / auto-attendance / push)");
  console.log("[worker] HTTP 서버 미실행 — DB 락으로 중복 실행 방지됨");
} else {
  // ── API 서버 모드: HTTP 실행, 스케줄러 없음 ─────────────────────────────

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
    const selfBase = process.env["RENDER_EXTERNAL_URL"] || `http://localhost:${port}`;
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
