// Mark as ES module so top-level await is allowed.
export {};

/**
 * staging-api-server.ts — Staging-Only API Server Bootstrap
 *
 * 목적:
 *   WP8/CC E2E 테스트를 위해 TEST_DATABASE_URL 기반의 일회성 API 서버를 실행.
 *   Production server DB config를 변경하지 않음.
 *
 * 필수 환경변수:
 *   STAGING_API_TEST_MODE=true
 *   ALLOW_TEST_DB_MUTATIONS=true
 *   TEST_DATABASE_URL=postgresql://postgres.lspmacdbyvpzysnrjsww:...
 *
 * 실행:
 *   STAGING_API_TEST_MODE=true ALLOW_TEST_DB_MUTATIONS=true \
 *   PORT=8099 npx tsx src/scripts/staging-api-server.ts
 *
 * 안전 규칙:
 *   - STAGING_API_TEST_MODE=true 없으면 즉시 종료
 *   - TEST_DATABASE_URL이 Production ref(mrgkiussgbbmxfnkjgqy)이면 즉시 종료
 *   - SUPABASE_DATABASE_URL fallback 없음
 *   - 포트 default: 8099 (Production API와 다른 포트)
 *
 * 구조:
 *   1. Safety gates 통과
 *   2. TEST_DATABASE_URL을 SUPABASE_DATABASE_URL로 임시 설정
 *      (Express app이 @workspace/db를 통해 staging DB를 바라보도록)
 *      ⚠️ 이 기법은 staging-api-server 전용. staging-manifest에서는 금지.
 *   3. Express app import + 서버 시작
 *
 * 주의:
 *   WP8_TEST_API_BASE_URL 환경변수로 wp8-preflight와 cc-preflight의 HTTP endpoint를
 *   이 서버를 가리키도록 설정해야 함.
 *   예: WP8_TEST_API_BASE_URL=http://localhost:8099/api
 */

// ── Gate 1: STAGING_API_TEST_MODE ──────────────────────────────────────────
if (process.env.STAGING_API_TEST_MODE !== "true") {
  console.error(
    "\n🚫 STAGING API SERVER BLOCKED:\n" +
    "   STAGING_API_TEST_MODE must be set to 'true'.\n" +
    "   This server is for isolated staging E2E tests only.\n" +
    "   Do NOT run this against Production.\n"
  );
  process.exit(1);
}

// ── Gate 2: ALLOW_TEST_DB_MUTATIONS ────────────────────────────────────────
if (process.env.ALLOW_TEST_DB_MUTATIONS !== "true") {
  console.error(
    "\n🚫 STAGING API SERVER BLOCKED:\n" +
    "   ALLOW_TEST_DB_MUTATIONS must be set to 'true'.\n"
  );
  process.exit(1);
}

// ── Gate 3: TEST_DATABASE_URL presence + ref check ─────────────────────────
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error(
    "\n🚫 STAGING API SERVER BLOCKED:\n" +
    "   TEST_DATABASE_URL is not set.\n" +
    "   Set it to the staging Supabase project connection string.\n"
  );
  process.exit(1);
}

const PRODUCTION_REF = "mrgkiussgbbmxfnkjgqy";
const STAGING_REFS   = new Set(["lspmacdbyvpzysnrjsww"]);

function extractRef(url: string): string | null {
  try {
    const m = new URL(url).username.match(/^postgres\.([a-z0-9]+)$/);
    return m ? m[1] : null;
  } catch { return null; }
}

const ref = extractRef(testUrl);
if (!ref) {
  console.error(
    "\n🚫 STAGING API SERVER BLOCKED:\n" +
    "   Cannot extract project ref from TEST_DATABASE_URL.\n" +
    "   Expected format: postgres.{project_ref}@...\n"
  );
  process.exit(1);
}

if (ref === PRODUCTION_REF) {
  console.error(
    "\n🚫 STAGING API SERVER BLOCKED:\n" +
    "   TEST_DATABASE_URL points to PRODUCTION project.\n" +
    "   Production ref detected. Startup blocked permanently.\n"
  );
  process.exit(1);
}

if (!STAGING_REFS.has(ref)) {
  console.error(
    `\n🚫 STAGING API SERVER BLOCKED:\n` +
    `   Project ref '${ref}' is not in the staging allowlist.\n` +
    `   Known staging refs: ${[...STAGING_REFS].join(", ")}\n`
  );
  process.exit(1);
}

console.log(`\n✅ [staging-api] Staging ref confirmed: ${ref}`);
console.log(`[staging-api] All safety gates passed. Starting staging API server...\n`);

// ── Point @workspace/db at TEST_DATABASE_URL ────────────────────────────────
// This is the ONLY context where this env override is permitted:
// staging-api-server.ts runs as an isolated process dedicated to staging.
// staging-manifest.ts MUST NOT use this technique.
const _originalSupabaseUrl = process.env.SUPABASE_DATABASE_URL;
process.env.SUPABASE_DATABASE_URL = testUrl;
console.log(`[staging-api] SUPABASE_DATABASE_URL → staging (ref: ${ref})`);

// ── Port ─────────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? "8099");
if (Number.isNaN(port) || port <= 0) {
  console.error(`[staging-api] Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

// ── Start Express app ────────────────────────────────────────────────────────
// Top-level await requires this file to be treated as an ES module.
// The dynamic imports below are intentional — they run after env guards complete.
const { default: app, setServerReady, setBootMeta } = await import("../app.js"); // eslint-disable-line @typescript-eslint/no-floating-promises

setBootMeta({ boot_id: "staging", started_at: new Date().toISOString(), commit: "staging", version: "staging" });

app.listen(port, () => {
  setServerReady();
  console.log(`\n[staging-api] ✅ Staging API server listening on port ${port}`);
  console.log(`[staging-api] WP8 E2E: set WP8_TEST_API_BASE_URL=http://localhost:${port}/api`);
  console.log(`[staging-api] CC  E2E: set TEST_API_BASE_URL=http://localhost:${port}/api`);
  console.log(`[staging-api] DB: staging ref=${ref} (TEST_DATABASE_URL)`);
  console.log(`[staging-api] IMPORTANT: Do NOT use this server for Production traffic.\n`);
});

process.on("SIGTERM", () => {
  console.log("[staging-api] SIGTERM received. Shutting down.");
  process.exit(0);
});
