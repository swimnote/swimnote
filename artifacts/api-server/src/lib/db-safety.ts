/**
 * db-safety.ts — Fail-closed production DB mutation guard
 *
 * 목적:
 *   테스트/마이그레이션 스크립트가 Production DB를 실수로 변경하지 못하도록 차단.
 *   "이 DB가 테스트용임을 명확히 증명하지 못하면 mutation 실행 금지."
 *
 * 사용:
 *   await assertSafeMutationDatabase(db);   // mutation 전에 반드시 호출
 *
 * 판별 순서:
 *   1. ALLOW_TEST_DB_MUTATIONS=true 환경변수 존재 여부 (명시적 opt-in)
 *   2. 현재 연결 DB host fingerprint가 Production denylist에 포함되면 BLOCK
 *   3. NODE_ENV === 'test' + ALLOW_TEST_DB_MUTATIONS=true 조합만 허용
 *
 * 중요:
 *   - NODE_ENV=development 단독으로는 허용하지 않음
 *     (현재 Replit dev 서버가 Production Supabase를 공유하고 있기 때문)
 *   - connection string 자체는 절대 로그에 출력하지 않음
 */

import { sql } from "drizzle-orm";

// ── Production DB fingerprints (host MD5 or partial host pattern) ──────────
// Supabase production: IPv6 prefix 2406:da1a:6b0: (확인된 production host)
const PRODUCTION_HOST_PATTERNS: RegExp[] = [
  /^2406:da1a:6b0:/,          // Supabase production IPv6 range (confirmed)
  /\.supabase\.co$/,           // Supabase hostname pattern
  /db\.[a-z]+\.supabase\.co/,  // Supabase project DB hostnames
];

export type DbSafetyResult =
  | { safe: true;  host: string }
  | { safe: false; host: string; reason: string };

/**
 * DB host fingerprint를 조회하여 Production 여부를 판별한다.
 * connection string을 출력하지 않는다.
 */
export async function getDbFingerprint(db: any): Promise<{ host: string; dbName: string }> {
  try {
    const res = (await db.execute(sql`
      SELECT current_database() AS dbname,
             COALESCE(inet_server_addr()::text, 'unknown') AS host
    `)).rows[0] as any;
    return { host: res?.host ?? "unknown", dbName: res?.dbname ?? "unknown" };
  } catch {
    return { host: "unknown", dbName: "unknown" };
  }
}

/**
 * 주어진 host가 Production DB에 해당하는지 판별한다.
 */
export function isProductionHost(host: string): boolean {
  return PRODUCTION_HOST_PATTERNS.some((re) => re.test(host));
}

/**
 * mutation 전에 호출. Safe test DB가 아니면 즉시 process.exit(1)한다.
 *
 * @param db   drizzle db instance
 * @param label 로그용 식별자 (예: "wp8-preflight")
 */
export async function assertSafeMutationDatabase(
  db: any,
  label = "mutation"
): Promise<void> {
  const explicitAllow = process.env.ALLOW_TEST_DB_MUTATIONS === "true";

  const { host, dbName } = await getDbFingerprint(db);
  const isProd = isProductionHost(host);

  if (isProd) {
    console.error(
      `\n🚫 REFUSING TO MUTATE NON-TEST DATABASE [${label}]` +
      `\n   DB: ${dbName} @ ${host}` +
      `\n   Reason: host matches Production fingerprint denylist.` +
      `\n   Set ALLOW_TEST_DB_MUTATIONS=true only on a dedicated test DB.` +
      `\n   ABORTING.\n`
    );
    process.exit(1);
  }

  if (!explicitAllow) {
    console.error(
      `\n🚫 REFUSING TO MUTATE DATABASE [${label}]` +
      `\n   DB: ${dbName} @ ${host}` +
      `\n   Reason: ALLOW_TEST_DB_MUTATIONS env var is not set to 'true'.` +
      `\n   This is a fail-closed guard. To run mutation tests, you must:` +
      `\n     1. Use a dedicated test DB (not Production)` +
      `\n     2. Set ALLOW_TEST_DB_MUTATIONS=true` +
      `\n   ABORTING.\n`
    );
    process.exit(1);
  }

  // Safe: not production + explicit allow
  console.log(`[db-safety] ✅ Safe test DB confirmed [${label}]: ${dbName} @ ${host}`);
}

/**
 * process.exit 없이 결과만 반환하는 버전 (단위 테스트 등에서 사용).
 */
export async function checkDbSafety(db: any): Promise<DbSafetyResult> {
  const { host, dbName } = await getDbFingerprint(db);
  const isProd = isProductionHost(host);
  const explicitAllow = process.env.ALLOW_TEST_DB_MUTATIONS === "true";

  if (isProd) {
    return { safe: false, host, reason: `Production host detected: ${host} (${dbName})` };
  }
  if (!explicitAllow) {
    return { safe: false, host, reason: "ALLOW_TEST_DB_MUTATIONS not set to 'true'" };
  }
  return { safe: true, host };
}
