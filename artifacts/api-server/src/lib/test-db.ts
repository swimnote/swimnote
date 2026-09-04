/**
 * test-db.ts — Isolated Test DB Client
 *
 * 목적:
 *   mutation test / preflight script가 TEST_DATABASE_URL만 사용하도록 강제.
 *   Production fallback 완전 차단.
 *
 * 사용:
 *   import { getTestDb, closeTestDb } from "../lib/test-db.js";
 *   const db = await getTestDb("wp8-preflight");
 *   // ... mutations ...
 *   await closeTestDb();
 *
 * 제약:
 *   - TEST_DATABASE_URL 미설정 시 즉시 exit(1)
 *   - assertSafeMutationDatabase 통과 필수
 *   - Production fallback (SUPABASE_DATABASE_URL) 없음
 *   - 일반 runtime import와 완전 분리 (api boot path에서 import 금지)
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { assertSafeMutationDatabase, getDbFingerprint } from "./db-safety.js";

const { Pool } = pg;

let _pool: pg.Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

/**
 * TEST_DATABASE_URL 기반 drizzle client를 반환.
 * 최초 호출 시 연결 + safety 검증, 이후 재사용.
 *
 * @param label 로그용 호출자 식별자 (예: "wp8-preflight")
 */
export async function getTestDb(label = "test"): Promise<ReturnType<typeof drizzle>> {
  if (_db) return _db;

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    console.error(
      `\n🚫 REFUSING TO MUTATE: TEST_DATABASE_URL NOT CONFIGURED [${label}]` +
      `\n   TEST_DATABASE_URL env var is not set.` +
      `\n   Set it to a dedicated staging/test Supabase project.` +
      `\n   DO NOT use SUPABASE_DATABASE_URL for mutation tests.` +
      `\n   ABORTING.\n`
    );
    process.exit(1);
  }

  _pool = new Pool({
    connectionString: testUrl,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
  });

  _db = drizzle(_pool, { schema });

  // Fail-closed safety check
  await assertSafeMutationDatabase(_db, label);

  const { host, dbName } = await getDbFingerprint(_db);
  console.log(`[test-db] Connected: ${dbName} @ ${host} [${label}]`);

  return _db;
}

/**
 * 테스트 완료 후 연결 종료.
 */
export async function closeTestDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
    console.log("[test-db] Connection closed.");
  }
}

/**
 * 현재 test DB 연결 fingerprint 반환 (safety 검증용).
 * getTestDb() 호출 후에만 유효.
 */
export async function getTestDbFingerprint(): Promise<{ host: string; dbName: string } | null> {
  if (!_db) return null;
  return getDbFingerprint(_db);
}
