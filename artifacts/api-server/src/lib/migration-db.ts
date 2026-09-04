/**
 * migration-db.ts — Migration 전용 DB Factory
 *
 * 규칙:
 *   1. TEST_DATABASE_URL만 사용 (SUPABASE_DATABASE_URL fallback 완전 금지)
 *   2. TEST_DATABASE_URL 미설정 시 FAIL CLOSED
 *   3. Staging project ref lspmacdbyvpzysnrjsww 외 mutation 차단
 *   4. Production ref mrgkiussgbbmxfnkjgqy 무조건 BLOCK
 *   5. Unknown ref BLOCK
 *   6. ALLOW_TEST_DB_MUTATIONS=true 필수
 *   7. connection string/password 로그 출력 금지
 *   8. module import 시 자동 연결 금지 (호출 시 명시적으로 client 생성)
 *
 * 사용:
 *   const { db, close } = await getMigrationDb("my-migration");
 *   await runMigration(db);
 *   await close();
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";

const { Pool } = pg;

// ── Known project refs ─────────────────────────────────────────────────────
const KNOWN_STAGING_REFS = new Set(["lspmacdbyvpzysnrjsww"]);
const PRODUCTION_REF     = "mrgkiussgbbmxfnkjgqy";

// ── Exported type ──────────────────────────────────────────────────────────
export type MigrationDb = ReturnType<typeof drizzle<typeof schema>>;

export interface MigrationDbHandle {
  db: MigrationDb;
  close: () => Promise<void>;
}

/**
 * Extracts the Supabase project ref from a connection URL's username field.
 * Username format: postgres.{project_ref}
 * Returns null if format is unexpected.
 */
export function extractProjectRef(url: string): string | null {
  try {
    const username = new URL(url).username;
    const match = username.match(/^postgres\.([a-z0-9]+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * getMigrationDb — Staging-only, explicit DB client for migrations.
 *
 * Fails closed on:
 *   - TEST_DATABASE_URL missing
 *   - Production ref
 *   - Unknown ref
 *   - ALLOW_TEST_DB_MUTATIONS !== "true"
 *
 * @param label  Caller identifier for log messages (no secrets)
 */
export async function getMigrationDb(label = "migration"): Promise<MigrationDbHandle> {
  // Gate 1: mutation flag
  if (process.env.ALLOW_TEST_DB_MUTATIONS !== "true") {
    console.error(
      `\n🚫 [${label}] MIGRATION BLOCKED: ALLOW_TEST_DB_MUTATIONS is not 'true'.\n` +
      `   Set ALLOW_TEST_DB_MUTATIONS=true to confirm this is a staging environment.\n`
    );
    process.exit(1);
  }

  // Gate 2: TEST_DATABASE_URL presence
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    console.error(
      `\n🚫 [${label}] MIGRATION BLOCKED: TEST_DATABASE_URL is not set.\n` +
      `   Migrations MUST use TEST_DATABASE_URL. SUPABASE_DATABASE_URL is Production.\n`
    );
    process.exit(1);
  }

  // Gate 3: project ref validation (fail-closed on unknown + Production)
  const ref = extractProjectRef(testUrl);

  if (!ref) {
    console.error(
      `\n🚫 [${label}] MIGRATION BLOCKED: Cannot extract project ref from TEST_DATABASE_URL.\n` +
      `   Expected format: postgres.{project_ref}@...\n`
    );
    process.exit(1);
  }

  if (ref === PRODUCTION_REF) {
    console.error(
      `\n🚫 [${label}] MIGRATION BLOCKED: TEST_DATABASE_URL points to PRODUCTION project.\n` +
      `   Production ref detected. Mutations are permanently blocked.\n`
    );
    process.exit(1);
  }

  if (!KNOWN_STAGING_REFS.has(ref)) {
    console.error(
      `\n🚫 [${label}] MIGRATION BLOCKED: Project ref '${ref}' is not in the staging allowlist.\n` +
      `   Known staging refs: ${[...KNOWN_STAGING_REFS].join(", ")}\n` +
      `   Update KNOWN_STAGING_REFS in migration-db.ts after explicit review.\n`
    );
    process.exit(1);
  }

  console.log(`[migration-db] ✅ Staging ref confirmed: ${ref} [${label}]`);

  // Create pool + drizzle client
  const pool = new Pool({
    connectionString: testUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  // Verify connectivity
  try {
    const res = await pool.query("SELECT current_database() AS db");
    console.log(`[migration-db] Connected to: ${res.rows[0].db} [${label}]`);
  } catch (e: any) {
    console.error(`[migration-db] ❌ Connection failed [${label}]: ${e.message}`);
    await pool.end();
    process.exit(1);
  }

  const db = drizzle(pool, { schema }) as MigrationDb;

  return {
    db,
    close: async () => {
      await pool.end();
      console.log(`[migration-db] Connection closed [${label}]`);
    },
  };
}

/**
 * runWithMigrationDb — Convenience wrapper for standalone migration scripts.
 * Handles getMigrationDb + close lifecycle.
 *
 * Usage in migration CLI runner:
 *   if (import.meta.url === `file://${process.argv[1]}`) {
 *     runWithMigrationDb("my-migration", runMigration).catch(...);
 *   }
 */
export async function runWithMigrationDb(
  label: string,
  fn: (db: MigrationDb) => Promise<void>
): Promise<void> {
  const { db, close } = await getMigrationDb(label);
  try {
    await fn(db);
    console.log(`[${label}] ✅ Migration complete`);
  } finally {
    await close();
  }
}
