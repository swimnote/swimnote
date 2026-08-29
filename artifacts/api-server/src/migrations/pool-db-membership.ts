/**
 * pool-db-membership.ts — user_pool_memberships 테이블 생성 + 기존 사용자 backfill
 *
 * Multi-Pool Membership 구조 마이그레이션.
 * 서버 기동 시 한 번 실행: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING backfill.
 *
 * 테이블 구조:
 *   user_pool_memberships(id, account_id, account_type, pool_id, role, status, created_at, updated_at)
 *
 *   account_id   — users.id 또는 parent_accounts.id
 *   account_type — 'user' | 'parent'
 *   pool_id      — swimming_pools.id
 *   role         — pool_admin | teacher | sub_admin | parent_account
 *   status       — active | inactive | pending
 *   UNIQUE(account_id, pool_id, role)
 *
 * Backfill:
 *   users 테이블: swimming_pool_id IS NOT NULL + role IN (pool_admin,teacher,sub_admin)
 *   users의 roles[] 배열에서 role 하나씩 membership 생성
 *   parent_accounts: swimming_pool_id IS NOT NULL → role='parent_account'
 *
 * SECURITY: 모든 런타임 파라미터는 drizzle sql 템플릿 바인딩 사용.
 *           sql.raw는 DDL/backfill(외부 입력 없음)에만 사용.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// 허용되는 role 목록 (화이트리스트)
const VALID_ROLES = new Set(["pool_admin", "teacher", "sub_admin", "parent_account"]);
const VALID_STATUS = new Set(["active", "inactive", "pending"]);
const VALID_ACCOUNT_TYPE = new Set(["user", "parent"]);

export async function initMembershipSchema(): Promise<void> {
  const db = superAdminDb;

  // ─── 1. user_pool_memberships 테이블 생성 ──────────────────────────────
  // DDL: 외부 입력 없음, sql.raw 안전 사용
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS user_pool_memberships (
      id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      account_id   text        NOT NULL,
      account_type text        NOT NULL DEFAULT 'user',
      pool_id      text        NOT NULL,
      role         text        NOT NULL,
      status       text        NOT NULL DEFAULT 'active',
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT uq_membership UNIQUE (account_id, pool_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_membership_account ON user_pool_memberships(account_id);
    CREATE INDEX IF NOT EXISTS idx_membership_pool   ON user_pool_memberships(pool_id);
    CREATE INDEX IF NOT EXISTS idx_membership_role   ON user_pool_memberships(role);
    CREATE INDEX IF NOT EXISTS idx_membership_status ON user_pool_memberships(status);
  `));

  // ─── 2. users 테이블 backfill (roles[] 배열 기준) ─────────────────────
  // backfill: users/parent_accounts 데이터만 읽음 (외부 입력 없음), sql.raw 안전 사용
  await db.execute(sql.raw(`
    INSERT INTO user_pool_memberships (id, account_id, account_type, pool_id, role, status, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      u.id,
      'user',
      u.swimming_pool_id,
      unnested_role,
      'active',
      u.created_at,
      u.updated_at
    FROM users u,
    LATERAL (
      SELECT unnest(
        CASE
          WHEN u.roles IS NOT NULL AND array_length(u.roles, 1) > 0
          THEN u.roles
          ELSE ARRAY[u.role::text]
        END
      ) AS unnested_role
    ) r
    WHERE u.swimming_pool_id IS NOT NULL
      AND unnested_role IN ('pool_admin', 'teacher', 'sub_admin')
    ON CONFLICT (account_id, pool_id, role) DO NOTHING;
  `)).catch(e => {
    console.warn("[membership] users backfill 경고:", e?.message);
  });

  // ─── 3. parent_accounts 테이블 backfill ───────────────────────────────
  await db.execute(sql.raw(`
    INSERT INTO user_pool_memberships (id, account_id, account_type, pool_id, role, status, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      pa.id,
      'parent',
      pa.swimming_pool_id,
      'parent_account',
      'active',
      pa.created_at,
      pa.updated_at
    FROM parent_accounts pa
    WHERE pa.swimming_pool_id IS NOT NULL
    ON CONFLICT (account_id, pool_id, role) DO NOTHING;
  `)).catch(e => {
    console.warn("[membership] parent_accounts backfill 경고:", e?.message);
  });

  console.log("[membership] initMembershipSchema 완료");
}

/**
 * getMemberships — 계정의 유효 membership 목록 조회
 * accountId: JWT에서 추출된 신뢰할 수 있는 값
 * SECURITY: drizzle sql 템플릿 파라미터 바인딩 사용
 */
export async function getMemberships(accountId: string): Promise<Array<{
  pool_id: string;
  pool_name: string;
  role: string;
  status: string;
}>> {
  const db = superAdminDb;
  // drizzle sql 템플릿: ${accountId}는 prepared statement 파라미터로 바인딩됨
  const result = await db.execute(sql`
    SELECT
      m.pool_id,
      COALESCE(sp.name, m.pool_id) AS pool_name,
      m.role,
      m.status
    FROM user_pool_memberships m
    LEFT JOIN swimming_pools sp ON sp.id = m.pool_id
    WHERE m.account_id = ${accountId}
      AND m.status = 'active'
    ORDER BY m.created_at ASC
  `);
  return result.rows as any[];
}

/**
 * upsertMembership — membership 생성 또는 활성화
 * SECURITY: 모든 파라미터 drizzle sql 템플릿 바인딩.
 *           role/accountType/status는 화이트리스트 검증 후 사용.
 */
export async function upsertMembership(opts: {
  accountId: string;
  accountType: "user" | "parent";
  poolId: string;
  role: string;
  status?: string;
}): Promise<void> {
  const { accountId, accountType, poolId, role, status = "active" } = opts;

  // 화이트리스트 검증 (외부 입력값 방어)
  if (!VALID_ROLES.has(role)) throw new Error(`유효하지 않은 role: ${role}`);
  if (!VALID_STATUS.has(status)) throw new Error(`유효하지 않은 status: ${status}`);
  if (!VALID_ACCOUNT_TYPE.has(accountType)) throw new Error(`유효하지 않은 accountType: ${accountType}`);

  const db = superAdminDb;
  // drizzle sql 템플릿: 모든 변수는 prepared statement 파라미터로 바인딩
  await db.execute(sql`
    INSERT INTO user_pool_memberships (id, account_id, account_type, pool_id, role, status, created_at, updated_at)
    VALUES (gen_random_uuid()::text, ${accountId}, ${accountType}, ${poolId}, ${role}, ${status}, now(), now())
    ON CONFLICT (account_id, pool_id, role) DO UPDATE
      SET status = ${status}, updated_at = now()
  `);
}

/**
 * checkMembership — membership 존재 여부 확인
 * SECURITY: drizzle sql 템플릿 파라미터 바인딩.
 *           role은 화이트리스트 검증.
 * 반환: true면 유효 membership 존재
 */
export async function checkMembership(opts: {
  accountId: string;
  poolId: string;
  role: string;
}): Promise<boolean> {
  const { accountId, poolId, role } = opts;

  // role 화이트리스트 검증 — 허용되지 않는 role은 즉시 false
  if (!VALID_ROLES.has(role)) return false;

  const db = superAdminDb;
  // drizzle sql 템플릿: 모든 변수 prepared statement 파라미터
  const result = await db.execute(sql`
    SELECT 1 FROM user_pool_memberships
    WHERE account_id = ${accountId}
      AND pool_id = ${poolId}
      AND role = ${role}
      AND status = 'active'
    LIMIT 1
  `);
  return result.rows.length > 0;
}

/**
 * validateMigration — backfill 검증 (row-level anti-join 방식)
 *
 * A. users_missing: expected (account_id, pool_id, role) 조합 중 membership 없는 수
 * B. parents_missing: expected parent membership 중 없는 수
 * C. duplicates: (account_id, pool_id, role) 그룹에서 COUNT > 1인 수
 * D. invalid: 존재하지 않는 account_id/pool_id 또는 허용되지 않는 role을 가진 membership 수
 *
 * SECURITY: DDL/집계 쿼리 — 외부 입력 없음, sql.raw 안전 사용
 */
export async function validateMigration(): Promise<{
  usersMissing: number;
  parentsMissing: number;
  duplicates: number;
  invalid: number;
  totalMemberships: number;
}> {
  const db = superAdminDb;

  const [usersMissingRes, parentsMissingRes, dupRes, invalidRes, totalRes] = await Promise.all([
    // A. users_missing: anti-join — expected membership이 없는 (account_id, pool_id, role) 조합
    // ※ users.swimming_pool_id가 swimming_pools에 실제 존재하는 경우만 검사
    //   (삭제된 pool을 가리키는 users는 expected 대상에서 제외)
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM (
        SELECT
          u.id AS account_id,
          u.swimming_pool_id AS pool_id,
          unnested_role AS role
        FROM users u
        INNER JOIN swimming_pools sp ON sp.id = u.swimming_pool_id
        , LATERAL (
          SELECT unnest(
            CASE
              WHEN u.roles IS NOT NULL AND array_length(u.roles, 1) > 0
              THEN u.roles
              ELSE ARRAY[u.role::text]
            END
          ) AS unnested_role
        ) r
        WHERE u.swimming_pool_id IS NOT NULL
          AND unnested_role IN ('pool_admin', 'teacher', 'sub_admin')
      ) expected
      WHERE NOT EXISTS (
        SELECT 1 FROM user_pool_memberships m
        WHERE m.account_id = expected.account_id
          AND m.pool_id = expected.pool_id
          AND m.role = expected.role
          AND m.status = 'active'
      )
    `)),
    // B. parents_missing: anti-join — parent_accounts 중 membership 없는 수
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM parent_accounts pa
      WHERE pa.swimming_pool_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_pool_memberships m
          WHERE m.account_id = pa.id
            AND m.pool_id = pa.swimming_pool_id
            AND m.role = 'parent_account'
            AND m.status = 'active'
        )
    `)),
    // C. duplicates: (account_id, pool_id, role) GROUP BY + HAVING COUNT > 1
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM (
        SELECT account_id, pool_id, role
        FROM user_pool_memberships
        GROUP BY account_id, pool_id, role
        HAVING COUNT(*) > 1
      ) sub
    `)),
    // D. invalid: active row 중 account_id 없거나 pool_id 없거나 허용되지 않는 role
    // ※ inactive row (삭제된 pool 비활성화 포함)는 검사 대상 제외
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM user_pool_memberships m
      WHERE m.status = 'active'
        AND (
          (
            NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.account_id)
            AND NOT EXISTS (SELECT 1 FROM parent_accounts pa WHERE pa.id = m.account_id)
          )
          OR NOT EXISTS (SELECT 1 FROM swimming_pools sp WHERE sp.id = m.pool_id)
          OR m.role NOT IN ('pool_admin', 'teacher', 'sub_admin', 'parent_account')
        )
    `)),
    // 전체 active membership 수
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM user_pool_memberships WHERE status = 'active'
    `)),
  ]);

  const usersMissing = (usersMissingRes.rows[0] as any)?.cnt ?? 0;
  const parentsMissing = (parentsMissingRes.rows[0] as any)?.cnt ?? 0;
  const duplicates = (dupRes.rows[0] as any)?.cnt ?? 0;
  const invalid = (invalidRes.rows[0] as any)?.cnt ?? 0;
  const totalMemberships = (totalRes.rows[0] as any)?.cnt ?? 0;

  return { usersMissing, parentsMissing, duplicates, invalid, totalMemberships };
}
