import app from "./app";
import { startBackupJobs } from "./jobs/backup-batch.js";
import { initPoolDb } from "./migrations/pool-db-init.js";
import { initSuperDb } from "./migrations/super-db-init.js";

// ── DB 이원화 강제 점검 ──────────────────────────────────────────
const POOL_URL = process.env.POOL_DATABASE_URL;
if (!POOL_URL) {
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("🔴 [DB 이원화 오류] POOL_DATABASE_URL 환경변수가 설정되지 않았습니다.");
  console.error("   수영장 운영 DB와 슈퍼관리자 DB는 반드시 분리되어야 합니다.");
  console.error("   ▶ Replit Secrets에 POOL_DATABASE_URL을 추가하세요:");
  console.error("     POOL_DATABASE_URL = (신규 Supabase 프로젝트 Connection String)");
  console.error("     POOL_DB_PASSWORD  = (신규 Supabase 프로젝트 DB 비밀번호)");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exit(1);
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
});
