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
 *   role         — pool_admin | teacher | parent_account
 *   status       — active | inactive | pending
 *   UNIQUE(account_id, pool_id, role)
 *
 * Backfill:
 *   users 테이블: swimming_pool_id IS NOT NULL + role IN (pool_admin,teacher) → account_type='user'
 *   users의 roles[] 배열에서 role 하나씩 membership 생성
 *   parent_accounts: swimming_pool_id IS NOT NULL → account_type='parent', role='parent_account'
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function initMembershipSchema(): Promise<void> {
  const db = superAdminDb;

  // ─── 1. user_pool_memberships 테이블 생성 ──────────────────────────────
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
  // roles[] 배열에 있는 각 role마다 membership row를 생성한다.
  // roles[]가 비어있으면 primary role(role 컬럼)을 사용.
  // swimming_pool_id가 없는 user는 건너뜀.
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
 * account_id: users.id 또는 parent_accounts.id
 * 반환: { pool_id, pool_name, role, status }[]
 */
export async function getMemberships(accountId: string): Promise<Array<{
  pool_id: string;
  pool_name: string;
  role: string;
  status: string;
}>> {
  const db = superAdminDb;
  const result = await db.execute(sql.raw(`
    SELECT
      m.pool_id,
      COALESCE(sp.name, m.pool_id) AS pool_name,
      m.role,
      m.status
    FROM user_pool_memberships m
    LEFT JOIN swimming_pools sp ON sp.id = m.pool_id
    WHERE m.account_id = '${accountId}'
      AND m.status = 'active'
    ORDER BY m.created_at ASC
  `));
  return result.rows as any[];
}

/**
 * upsertMembership — membership 생성 또는 활성화
 */
export async function upsertMembership(opts: {
  accountId: string;
  accountType: "user" | "parent";
  poolId: string;
  role: string;
  status?: string;
}): Promise<void> {
  const { accountId, accountType, poolId, role, status = "active" } = opts;
  const db = superAdminDb;
  await db.execute(sql.raw(`
    INSERT INTO user_pool_memberships (id, account_id, account_type, pool_id, role, status, created_at, updated_at)
    VALUES (gen_random_uuid()::text, '${accountId}', '${accountType}', '${poolId}', '${role}', '${status}', now(), now())
    ON CONFLICT (account_id, pool_id, role) DO UPDATE
      SET status = '${status}', updated_at = now()
  `));
}

/**
 * checkMembership — membership 존재 여부 확인
 * 반환: true면 유효 membership 존재
 */
export async function checkMembership(opts: {
  accountId: string;
  poolId: string;
  role: string;
}): Promise<boolean> {
  const { accountId, poolId, role } = opts;
  const db = superAdminDb;
  const result = await db.execute(sql.raw(`
    SELECT 1 FROM user_pool_memberships
    WHERE account_id = '${accountId}'
      AND pool_id = '${poolId}'
      AND role = '${role}'
      AND status = 'active'
    LIMIT 1
  `));
  return result.rows.length > 0;
}

/**
 * validateMigration — backfill 검증
 * 기존 users/parent_accounts 수와 생성된 membership 수를 비교
 */
export async function validateMigration(): Promise<{
  usersWithPool: number;
  parentsWithPool: number;
  totalMemberships: number;
  missing: number;
  duplicates: number;
}> {
  const db = superAdminDb;

  const [usersRes, parentsRes, membershipRes, dupRes] = await Promise.all([
    db.execute(sql.raw(`
      SELECT COUNT(DISTINCT id)::int AS cnt
      FROM users
      WHERE swimming_pool_id IS NOT NULL
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(DISTINCT id)::int AS cnt
      FROM parent_accounts
      WHERE swimming_pool_id IS NOT NULL
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM user_pool_memberships WHERE status = 'active'
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM (
        SELECT account_id, pool_id, role, COUNT(*) AS c
        FROM user_pool_memberships
        GROUP BY account_id, pool_id, role
        HAVING COUNT(*) > 1
      ) sub
    `)),
  ]);

  const usersWithPool  = (usersRes.rows[0] as any)?.cnt ?? 0;
  const parentsWithPool = (parentsRes.rows[0] as any)?.cnt ?? 0;
  const totalMemberships = (membershipRes.rows[0] as any)?.cnt ?? 0;
  const duplicates = (dupRes.rows[0] as any)?.cnt ?? 0;
  const missing = Math.max(0, (usersWithPool + parentsWithPool) - totalMemberships);

  return { usersWithPool, parentsWithPool, totalMemberships, missing, duplicates };
}
