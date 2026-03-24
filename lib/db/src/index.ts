/**
 * DB 연결 레이어
 *
 * superAdminDb — 슈퍼관리자용 DB (SUPABASE_DATABASE_URL)
 *                플랫폼 운영/구독/결제/감사/모니터링 데이터
 *
 * poolDb       — 수영장 운영용 DB (POOL_DATABASE_URL)
 *                회원/선생님/출결/수업/학부모 등 운영 데이터
 *                POOL_DATABASE_URL 미설정 시 superAdminDb와 동일 DB 사용 (fallback)
 *
 * db           — 하위 호환용 (= superAdminDb)
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

/** 슈퍼관리자 DB 연결 풀 */
const superAdminPool = new Pool(buildConfig(SUPER_URL, SUPER_PW));
superAdminPool.on("error", (err) => {
  console.error("[superAdminPool] idle client error:", err.message);
});

/** 수영장 운영 DB 연결 풀 (별도 DB 설정 시 다른 Supabase 프로젝트 사용) */
const poolOpsPool = POOL_URL
  ? new Pool(buildConfig(POOL_URL, POOL_PW))
  : superAdminPool;
if (poolOpsPool !== superAdminPool) {
  poolOpsPool.on("error", (err) => {
    console.error("[poolOpsPool] idle client error:", err.message);
  });
}

/** 슈퍼관리자용 DB (플랫폼 운영/모니터링/감사 데이터) */
export const superAdminDb = drizzle(superAdminPool, { schema });

/** 수영장 운영용 DB (회원/출결/수업/학부모 운영 데이터) */
export const poolDb = drizzle(poolOpsPool, { schema });

/** 하위 호환용 — 기존 코드에서 db로 접근하는 쿼리는 poolDb로 라우팅 (운영 원본 기준) */
export const pool = superAdminPool;
export const db = poolDb;

/** 두 DB가 물리적으로 분리되어 있는지 여부 */
export const isDbSeparated = !!POOL_URL;

export * from "./schema";
