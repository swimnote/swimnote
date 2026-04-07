/**
 * poolOperatorService.ts
 *
 * 단일 소스: 풀 운영자(pool_admin) 조회
 *
 * 기준:
 *   - users 테이블
 *   - role = 'pool_admin'
 *   - swimming_pool_id = poolId
 *   - is_activated = TRUE  (status='active' 에 해당)
 *
 * getPoolOperators(poolId) 결과를 카운트·목록 모두 사용한다.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface PoolOperator {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  is_activated: boolean;
  created_at: string;
  last_login_at: string | null;
}

/**
 * 특정 수영장의 활성 운영자 목록을 반환한다.
 *
 * @param poolId  swimming_pool_id
 * @returns       PoolOperator[]  (비어있으면 [])
 */
export async function getPoolOperators(poolId: string): Promise<PoolOperator[]> {
  const result = await superAdminDb.execute(sql`
    SELECT
      id,
      name,
      email,
      phone,
      role::text AS role,
      is_activated,
      created_at,
      last_login_at
    FROM users
    WHERE role       = 'pool_admin'
      AND swimming_pool_id = ${poolId}
      AND is_activated = TRUE
    ORDER BY created_at ASC
  `);
  return result.rows as unknown as PoolOperator[];
}

/**
 * 활성 운영자 수만 반환 (COUNT 최적화).
 */
export async function countPoolOperators(poolId: string): Promise<number> {
  const result = await superAdminDb.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM users
    WHERE role       = 'pool_admin'
      AND swimming_pool_id = ${poolId}
      AND is_activated = TRUE
  `);
  return (result.rows[0] as any)?.cnt ?? 0;
}
