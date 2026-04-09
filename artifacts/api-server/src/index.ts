import app from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";
import { startParentLinkScheduler } from "./jobs/parent-link-scheduler.js";
import { startAutoAttendanceScheduler } from "./jobs/auto-attendance-scheduler.js";
import { initPoolDb } from "./migrations/pool-db-init.js";
import { initSuperDb } from "./migrations/super-db-init.js";
import { initV2PendingTable } from "./lib/auto-link-v2.js";
import { backfillPoolAdminRoles } from "./migrations/roles-backfill.js";
import { backfillPoolSubscriptionFields } from "./lib/subscriptionService.js";
import { isDbSeparated, isProtectDbConfigured, pool } from "@workspace/db";

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

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
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

// 배치 잡 시작
startBackupJobs();
startParentLinkScheduler();
startAutoAttendanceScheduler();

// ── Keep-Alive 자기 핑 (Autoscale 0 스케일다운 방지) ─────────────────────────
// 프로덕션 환경에서 4분마다 자기 healthz에 HTTP 요청 → 서버가 꺼지지 않음
if (process.env["NODE_ENV"] === "production") {
  const PING_INTERVAL_MS = 4 * 60 * 1000; // 4분
  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/healthz`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.warn(`[keep-alive] ping 응답 이상: ${res.status}`);
    } catch (e: any) {
      console.warn(`[keep-alive] ping 실패:`, e?.message ?? e);
    }
  }, PING_INTERVAL_MS);
  console.log("[keep-alive] 자기 핑 스케줄러 시작 (4분 간격)");
}

const server = app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`[DB] 운영 DB: superAdminDb (단일화 완료)`);
  console.log(`[DB] pool 백업: ${isDbSeparated ? "활성화" : "미설정 (비활성화)"}`);
  console.log(`[DB] 보호백업: ${isProtectDbConfigured ? "활성화" : "미설정 (비활성화)"}`);
});

// ── Graceful Shutdown ────────────────────────────────────────────────────────
// SIGTERM/SIGINT 수신 시 기존 요청을 완료한 후 서버를 안전하게 종료.
// 이렇게 해야 재시작 중에도 처리 중인 요청이 502가 되지 않음.
let isShuttingDown = false;

function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] ${signal} 수신 — graceful shutdown 시작`);

  // 새 연결 수락 중단, 기존 요청 완료 대기 (최대 15초)
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

  // 15초 이내에 완료 안 되면 강제 종료
  setTimeout(() => {
    console.error("[shutdown] 15초 초과 — 강제 종료");
    process.exit(1);
  }, 15_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// 처리되지 않은 예외가 서버를 죽이지 않도록 로깅만 처리
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
