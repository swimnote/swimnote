/**
 * DB 연결 레이어 (단일화 완료)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * [유일한 운영 DB]
 *   superAdminDb — SUPABASE_DATABASE_URL
 *                  모든 운영 데이터(학생/반/출결/보강/일지/공지/정산/결제)는
 *                  반드시 여기에만 저장
 *
 * [백업 전용 DB]  — 앱 로직에서 절대 사용 금지
 *   getBackupDb() — POOL_DATABASE_URL (백업/복구 모듈 전용)
 *   backupProtectDb — SUPER_PROTECT_DATABASE_URL (전체 백업 전용)
 *
 * [런타임 차단]
 *   poolDb — poolDb.select/insert/update/delete/execute 호출 시
 *            즉시 Error("POOL DB ACCESS FORBIDDEN") 발생
 *            (백업 모듈은 poolDb 대신 getBackupDb() 사용)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const SUPER_URL   = process.env.SUPABASE_DATABASE_URL;
const SUPER_PW    = process.env.SUPABASE_DB_PASSWORD;
const FALLBACK    = process.env.DATABASE_URL;

const POOL_URL    = process.env.POOL_DATABASE_URL;
const POOL_PW     = process.env.POOL_DB_PASSWORD;

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
      host:              u.hostname,
      port:              parseInt(u.port || "5432", 10),
      user:              decodeURIComponent(u.username),
      password:          finalPassword,
      database:          u.pathname.replace(/^\//, ""),
      ssl:               { rejectUnauthorized: false },
      max:               parseInt(process.env.DB_POOL_MAX ?? "5", 10),
      idleTimeoutMillis:       30000,
      connectionTimeoutMillis: 15000,
      keepAlive:               true,
      keepAliveInitialDelayMillis: 10000,
    };
  }
  return { connectionString: FALLBACK! };
}

// ── 운영 DB (유일한 앱 데이터 저장소) ─────────────────────────────────────
const superAdminPool = new Pool(buildConfig(SUPER_URL, SUPER_PW));
superAdminPool.on("error", (err) => {
  console.error("[superAdminPool] idle client error:", err.message);
});

/** 슈퍼관리자용 DB — 모든 운영 읽기/쓰기의 유일한 대상 */
export const superAdminDb = drizzle(superAdminPool, { schema });

/** 하위 호환용 별칭 (= superAdminDb) */
export const db   = superAdminDb;
export const pool = superAdminPool;

// ── 백업 DB (백업/복구 모듈 전용) ─────────────────────────────────────────
const _backupPool = POOL_URL
  ? new Pool(buildConfig(POOL_URL, POOL_PW))
  : null;
if (_backupPool) {
  _backupPool.on("error", (err) => {
    console.error("[backupPool] idle client error:", err.message);
  });
}

const _backupDb = _backupPool
  ? drizzle(_backupPool, { schema })
  : null;

/**
 * 백업/복구 모듈 전용 DB 접근 함수.
 * 백업 모듈(backup-batch, backup-status, pool-db-init) 이외에서 호출 금지.
 * POOL_DATABASE_URL 미설정 시 null 반환.
 */
export function getBackupDb() {
  return _backupDb;
}

/**
 * getPoolDb — 개발 기간 완전 차단.
 *
 * 운영 데이터는 무조건 superAdminDb(= db)만 사용한다.
 * 이 함수는 호출 즉시 에러를 발생시킨다.
 * 백업 모듈은 반드시 getBackupDb()를 사용할 것.
 */
export function getPoolDb(): never {
  const msg = "[POOL_DB_DISABLED_IN_DEV] getPoolDb() 호출 금지. 운영 데이터는 superAdminDb(db)만 사용하세요.";
  console.error(msg);
  throw new Error(msg);
}

/**
 * poolDb — 앱 로직에서 사용 금지.
 *
 * 이 export는 하위 호환을 위해 유지되지만,
 * select/insert/update/delete/execute 호출 시 즉시 에러를 발생시킨다.
 * 백업 모듈은 반드시 getBackupDb() 를 사용할 것.
 */
const FORBIDDEN_METHODS = new Set(["select", "insert", "update", "delete", "execute", "transaction"]);

export const poolDb = new Proxy(
  // Proxy 대상 — 타입 호환용 더미 (실제로는 절대 실행되지 않음)
  superAdminDb,
  {
    get(_target, prop) {
      if (FORBIDDEN_METHODS.has(String(prop))) {
        const errMsg = `[POOL DB ACCESS FORBIDDEN] poolDb.${String(prop)}()는 앱 로직에서 사용 금지입니다. superAdminDb 또는 getBackupDb()를 사용하세요.`;
        console.error(errMsg);
        throw new Error(errMsg);
      }
      // 타입/메타 프로퍼티(Symbol, 설정 등)는 허용
      return (superAdminDb as any)[prop];
    },
  },
);

// ── 보호백업 DB (전체 백업 전용) ───────────────────────────────────────────
const protectPool = PROTECT_URL
  ? new Pool(buildConfig(PROTECT_URL, PROTECT_PW))
  : null;
if (protectPool) {
  protectPool.on("error", (err) => {
    console.error("[protectPool] idle client error:", err.message);
  });
}

/** super 보호백업 DB (전체 백업 전용 — 미설정 시 null) */
export const backupProtectDb = protectPool
  ? drizzle(protectPool, { schema })
  : null;

// ── 상태 플래그 ────────────────────────────────────────────────────────────
/** 물리적으로 분리된 백업 DB가 설정되어 있는지 여부 */
export const isDbSeparated = !!POOL_URL;

/** super 보호백업 DB가 설정되어 있는지 여부 */
export const isProtectDbConfigured = !!PROTECT_URL;

export * from "./schema";
