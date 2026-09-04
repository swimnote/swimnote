/**
 * db-safety.ts — Fail-closed staging mutation guard (Allowlist model)
 *
 * 목적:
 *   테스트/마이그레이션 스크립트가 Production DB를 실수로 변경하지 못하도록 차단.
 *   "명확히 승인된 Staging 프로젝트만 허용, 나머지는 모두 DENY."
 *
 * 설계 원칙 (WP8-P2 revision):
 *   ① Allowlist 우선: "Production을 알아내서 차단"이 아니라
 *      "정확히 승인된 Staging만 허용"
 *   ② Project ref 기반 식별: IPv6 prefix는 다른 Supabase 프로젝트와
 *      공유될 수 있으므로 사용 금지
 *   ③ 3-factor gate: TEST_DATABASE_URL + known ref + ALLOW_TEST_DB_MUTATIONS=true
 *      세 조건 모두 충족해야 ALLOW
 *
 * 판별 순서:
 *   1. TEST_DATABASE_URL 존재 확인
 *   2. URL에서 project ref 추출
 *   3. ref가 KNOWN_STAGING_PROJECT_REFS에 있는지 확인
 *   4. ALLOW_TEST_DB_MUTATIONS=true 여부 확인
 *
 * 중요:
 *   - connection string 전체는 절대 로그에 출력하지 않음
 *   - IPv6 prefix 기반 denylist 방식은 폐기됨 (WP8-P2)
 */

// ── Known Staging Project Refs (Allowlist) ────────────────────────────────────
//
// 이 목록에 없는 모든 DB는 DENY.
// Production, Unknown, Malformed URL 등 모두 포함.
//
// ⚠️  IMPORTANT: 여기에 추가할 project ref는 반드시 Production과 다른
//                별개의 Supabase 프로젝트여야 한다.
//                Production과 동일한 ref를 추가하면 보호가 무의미해짐.
//
// Current known staging:
//   swimnote-staging: mrgkiussgbbmxfnkjgqy (ap-northeast-2, Seoul)
//
const KNOWN_STAGING_PROJECT_REFS = new Set<string>([
  "mrgkiussgbbmxfnkjgqy", // swimnote-staging (ap-northeast-2)
]);

// ── Project ref extraction ────────────────────────────────────────────────────

/**
 * Supabase pooler / direct URL에서 project ref를 추출한다.
 * password는 절대 반환하지 않는다.
 *
 * Supabase URL formats:
 *   Shared Supavisor (tx/session):
 *     postgresql://postgres.<ref>:<pw>@aws-X-region.pooler.supabase.com:6543/postgres
 *   Dedicated PgBouncer:
 *     postgresql://postgres:<pw>@db.<ref>.supabase.co:6543/postgres
 *   Direct:
 *     postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 */
export function extractProjectRef(connectionString: string): string | null {
  try {
    const u = new URL(connectionString);
    // Shared Supavisor: username = postgres.<ref>
    const fromUser = u.username.match(/^postgres\.([a-z0-9]+)$/)?.[1] ?? null;
    // Direct / Dedicated: host = db.<ref>.supabase.co
    const fromHost = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? null;
    return fromUser ?? fromHost ?? null;
  } catch {
    return null;
  }
}

/**
 * TEST_DATABASE_URL의 project ref가 알려진 Staging 목록에 있는지 확인.
 * TEST_DATABASE_URL이 없거나, ref 추출 불가이거나, 목록에 없으면 false.
 */
export function isKnownStagingUrl(testDatabaseUrl: string | undefined): boolean {
  if (!testDatabaseUrl) return false;
  const ref = extractProjectRef(testDatabaseUrl);
  if (!ref) return false;
  return KNOWN_STAGING_PROJECT_REFS.has(ref);
}

// ── Legacy: getDbFingerprint (DB query 기반, 호환성 유지) ──────────────────────
// Pooler를 통한 연결에서는 inet_server_addr()이 null을 반환할 수 있으므로
// URL 파싱 방식(isKnownStagingUrl)을 우선 사용한다.

import { sql } from "drizzle-orm";

export async function getDbFingerprint(
  db: any
): Promise<{ host: string; dbName: string }> {
  try {
    const res = (
      await db.execute(sql`
        SELECT current_database() AS dbname,
               COALESCE(inet_server_addr()::text, 'pooler') AS host
      `)
    ).rows[0] as any;
    return {
      host: res?.host ?? "unknown",
      dbName: res?.dbname ?? "unknown",
    };
  } catch {
    return { host: "unknown", dbName: "unknown" };
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DbSafetyResult =
  | { safe: true; ref: string | null }
  | { safe: false; ref: string | null; reason: string };

// ── Primary safety check (URL-based, no DB query required) ───────────────────

/**
 * TEST_DATABASE_URL이 알려진 Staging 프로젝트인지 확인한다 (process.exit 없이).
 * getTestDb() 내부에서 호출.
 */
export function checkTestDatabaseUrl(testUrl: string | undefined): DbSafetyResult {
  if (!testUrl) {
    return {
      safe: false,
      ref: null,
      reason: "TEST_DATABASE_URL is not set. Cannot identify staging database.",
    };
  }

  let ref: string | null;
  try {
    ref = extractProjectRef(testUrl);
  } catch {
    return {
      safe: false,
      ref: null,
      reason: "TEST_DATABASE_URL is malformed and cannot be parsed.",
    };
  }

  if (!ref) {
    return {
      safe: false,
      ref: null,
      reason:
        "Cannot extract project ref from TEST_DATABASE_URL. " +
        "Expected Supabase pooler URL (postgres.<ref>@*.pooler.supabase.com) " +
        "or direct URL (db.<ref>.supabase.co).",
    };
  }

  if (!KNOWN_STAGING_PROJECT_REFS.has(ref)) {
    return {
      safe: false,
      ref,
      reason:
        `Project ref "${ref}" is not in the known staging allowlist. ` +
        `This may be a Production database or an unregistered project. ` +
        `Only explicitly approved staging projects are allowed for mutations.`,
    };
  }

  if (process.env.ALLOW_TEST_DB_MUTATIONS !== "true") {
    return {
      safe: false,
      ref,
      reason: "ALLOW_TEST_DB_MUTATIONS is not set to 'true'.",
    };
  }

  return { safe: true, ref };
}

// ── assertSafeMutationDatabase ────────────────────────────────────────────────

/**
 * mutation 전에 호출. Safe staging DB가 아니면 즉시 process.exit(1).
 * URL 기반 검사를 먼저 수행하고, 필요시 DB query로 보완.
 *
 * @param db    drizzle db instance (호환성 유지)
 * @param label 로그용 식별자
 */
export async function assertSafeMutationDatabase(
  db: any,
  label = "mutation"
): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  const result = checkTestDatabaseUrl(testUrl);

  if (!result.safe) {
    console.error(
      `\n🚫 REFUSING TO MUTATE DATABASE [${label}]` +
        `\n   Reason: ${result.reason}` +
        `\n   ` +
        `\n   To allow staging mutations:` +
        `\n     1. Set TEST_DATABASE_URL to an approved staging Supabase project` +
        `\n     2. Set ALLOW_TEST_DB_MUTATIONS=true` +
        `\n   ABORTING.\n`
    );
    process.exit(1);
  }

  // Optional: confirm via DB query (e.g. current_database match)
  // Pooler may return null for inet_server_addr; that's fine — URL check is authoritative.
  console.log(
    `[db-safety] ✅ Staging DB confirmed [${label}]: project=${result.ref}`
  );
}

// ── checkDbSafety (legacy / unit-test version) ────────────────────────────────

/**
 * process.exit 없이 결과만 반환하는 버전 (단위 테스트에서 사용).
 * DB query 없이 URL 기반으로만 동작하므로 db 인자는 무시됨.
 */
export async function checkDbSafety(_db?: any): Promise<DbSafetyResult> {
  return checkTestDatabaseUrl(process.env.TEST_DATABASE_URL);
}

// ── isProductionHost (deprecated) ────────────────────────────────────────────
// IPv6-prefix 기반 방식은 폐기됨. 하위 호환성을 위해 항상 false 반환.
/** @deprecated IPv6 prefix denylist는 폐기됨. checkTestDatabaseUrl() 사용. */
export function isProductionHost(_host: string): boolean {
  return false;
}
