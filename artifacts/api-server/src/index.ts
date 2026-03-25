import app from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";
import { initPoolDb } from "./migrations/pool-db-init.js";
import { initSuperDb } from "./migrations/super-db-init.js";
import { isDbSeparated, isProtectDbConfigured } from "@workspace/db";

// ── DB 구성 안내 ─────────────────────────────────────────────────────────────
// 앱은 superAdminDb(SUPABASE_DATABASE_URL)만 운영 DB로 사용합니다.
// pool 백업 DB(POOL_DATABASE_URL)와 보호백업 DB(SUPER_PROTECT_DATABASE_URL)는
// 백업 전용으로, 미설정 시에는 백업 기능이 비활성화됩니다.

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

// 새벽 배치 잡 시작 (앱이 켜져 있는 동안 스케줄 유지)
startBackupJobs();

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`[DB] 운영 DB: superAdminDb (단일화 완료)`);
  console.log(`[DB] pool 백업: ${isDbSeparated ? "활성화" : "미설정 (비활성화)"}`);
  console.log(`[DB] 보호백업: ${isProtectDbConfigured ? "활성화" : "미설정 (비활성화)"}`);
});
