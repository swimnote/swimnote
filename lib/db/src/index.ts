/**
 * DB 연결 레이어
 *
 * superAdminDb — 슈퍼관리자용 DB (SUPABASE_DATABASE_URL)
 *                모든 운영 데이터: 학생/반/출결/보강/일지/공지/정산/결제 전부 저장
 *                앱은 오직 superAdminDb만 사용
 *
 * poolDb       — pool 백업 DB (POOL_DATABASE_URL)
 *                운영 사용 금지, 백업 전용
 *                POOL_DATABASE_URL 미설정 시 superAdminDb와 동일 DB 사용 (fallback)
 *
 * backupProtectDb — super 보호백업 DB (SUPER_PROTECT_DATABASE_URL)
 *                   운영 사용 금지, 전체 백업 전용
 *                   미설정 시 null (백업 비활성화)
 *
 * db           — 하위 호환용 (= superAdminDb)
 *                모든 운영 쿼리는 superAdminDb로 라우팅
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const SUPER_URL = process.env.SUPABASE_DATABASE_URL;
const SUPER_PW  = process.env.SUPABASE_DB_PASSWORD;
const FALLBACK  = process.env.DATABASE_URL;

const POOL_URL  = process.env.POOL_DATABASE_URL;
const POOL_PW   = process.env.POOL_DB_PASSWORD;

const PROTECT_URL = process.env.SUPER_PROTECT_DATABASE_URL;
const PROTECT_PW  = process.env.SUPER_PROTECT_DB_PASSWORD;

if (!SUPER_URL && !FALLBACK) {
  throw new Error(
    "SUPABASE_DATABASE_URL (또는 DATABASE_URL) 환경변수가 설정되지 않았습니다.",
  );
}

function buildConfig(url: string | undefined, password: string | undefined) {
  if (url) {
    let u: URL;
    try { u = new URL(url); } catch {
      throw new Error(`DB URL 파싱 실패 (올바른 postgresql:// 형식인지 확인): ${url.slice(0, 30)}...`);
    }
    const urlPassword = decodeURIComponent(u.password);
    const isPlaceholder = urlPassword.includes("[") || urlPassword.includes("]");
    const finalPassword = password || (isPlaceholder ? "" : urlPassword);
    return {
      host:     u.hostname,
      port:     parseInt(u.port || "5432", 10),
      user:     decodeURIComponent(u.username),
      password: finalPassword,
      database: u.pathname.replace(/^\//, ""),
      ssl:      { rejectUnauthorized: false },
      max:      10,
      idleTimeoutMillis: 30000,
    };
  }
  return { connectionString: FALLBACK! };
}

/** 슈퍼관리자 DB 연결 풀 (운영 원본 — 앱이 유일하게 사용하는 DB) */
const superAdminPool = new Pool(buildConfig(SUPER_URL, SUPER_PW));
superAdminPool.on("error", (err) => {
  console.error("[superAdminPool] idle client error:", err.message);
});

/** pool 백업 DB 연결 풀 (백업 전용 — 운영 사용 금지) */
const poolOpsPool = POOL_URL
  ? new Pool(buildConfig(POOL_URL, POOL_PW))
  : superAdminPool;
if (poolOpsPool !== superAdminPool) {
  poolOpsPool.on("error", (err) => {
    console.error("[poolOpsPool] idle client error:", err.message);
  });
}

/** super 보호백업 DB 연결 풀 (전체 백업 전용 — 운영 사용 금지) */
const protectPool = PROTECT_URL
  ? new Pool(buildConfig(PROTECT_URL, PROTECT_PW))
  : null;
if (protectPool) {
  protectPool.on("error", (err) => {
    console.error("[protectPool] idle client error:", err.message);
  });
}

/** 슈퍼관리자용 DB (운영 원본 — 모든 읽기/쓰기) */
export const superAdminDb = drizzle(superAdminPool, { schema });

/** pool 백업 DB (백업 전용 — 운영 사용 금지) */
export const poolDb = drizzle(poolOpsPool, { schema });

/** super 보호백업 DB (전체 백업 전용 — 미설정 시 null) */
export const backupProtectDb = protectPool
  ? drizzle(protectPool, { schema })
  : null;

/** 하위 호환용 — superAdminDb와 동일 (DB 단일화: 앱은 항상 superAdminDb 사용) */
export const pool = superAdminPool;
export const db = superAdminDb;

/** pool 백업 DB가 물리적으로 분리되어 있는지 여부 */
export const isDbSeparated = !!POOL_URL;

/** super 보호백업 DB가 설정되어 있는지 여부 */
export const isProtectDbConfigured = !!PROTECT_URL;

export * from "./schema";
