import app, { setServerReady, setBootMeta } from "./app";
import { BOOT_ID, BOOT_STARTED_AT, COMMIT_SHA, SERVICE_VERSION } from "./lib/boot-state.js";
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

const IS_WORKER = process.env.WORKER_MODE === "true";

// ── 서버 기동 로그 — 장애 발생 시 restart/deploy 판별 기준 ──────────────────
// boot_id가 장애 전후로 바뀌면 → restart/deploy 가능성 매우 높음
// boot_id가 유지 + login request 미도달 → client/DNS/TLS/network 문제
const _bootPayload = {
  boot_id: BOOT_ID,
  started_at: BOOT_STARTED_AT,
  commit: COMMIT_SHA,
  version: SERVICE_VERSION,
  pid: process.pid,
  node: process.version,
  mode: IS_WORKER ? "worker" : "api",
};
console.log("[SERVER_BOOT]", JSON.stringify(_bootPayload));

// healthz additive metadata 등록 (app.ts에서 /healthz 응답에 포함)
setBootMeta({ boot_id: BOOT_ID, started_at: BOOT_STARTED_AT, commit: COMMIT_SHA, version: SERVICE_VERSION });

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

  // Keep-Alive 자기 핑 (슬립 방지)
  if (process.env["NODE_ENV"] === "production") {
    const PING_INTERVAL_MS = 4 * 60 * 1000;
    const selfBase = process.env["RENDER_EXTERNAL_URL"] || `http://localhost:${port}`;
    setInterval(async () => {
      try {
        const res = await fetch(`${selfBase}/api/healthz`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) console.warn(`[keep-alive] ping 응답 이상: ${res.status}`);
      } catch (e: any) {
        console.warn(`[keep-alive] ping 실패:`, e?.message ?? e);
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
  // [PROCESS_ERROR] — Render 로그에서 검색 가능한 고정 prefix
  // password/token/body 절대 포함 금지
  const safeStack = (err?.stack ?? String(err)).slice(0, 800);
  console.error("[PROCESS_ERROR]", JSON.stringify({
    type: "uncaughtException",
    boot_id: BOOT_ID,
    ts: new Date().toISOString(),
    error_class: err?.constructor?.name ?? "Error",
    message: err?.message?.slice(0, 200) ?? String(err).slice(0, 200),
    safe_stack: safeStack,
  }));
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  const safeStack = (err?.stack ?? String(reason)).slice(0, 800);
  console.error("[PROCESS_ERROR]", JSON.stringify({
    type: "unhandledRejection",
    boot_id: BOOT_ID,
    ts: new Date().toISOString(),
    error_class: err?.constructor?.name ?? "Error",
    message: err?.message?.slice(0, 200) ?? String(reason).slice(0, 200),
    safe_stack: safeStack,
  }));
});
