/**
 * lib/member-limit.ts — WP2: Canonical X Member Limit Enforcement
 *
 * 공식 한도:
 *   x300  → 300
 *   x500  → 500
 *   x1000 → 1000
 *
 * Active member 정의 (공식 lifecycle 기준):
 *   status NOT IN ('withdrawn', 'archived', 'deleted')
 *   근거: admin.ts, auto-link-v2.ts, parent.ts 등 codebase 전체 일관 사용
 *
 * Race 안전:
 *   assertMemberLimitInTx()는 반드시 db.transaction() 내부에서 호출해야 함.
 *   swimming_pools row에 SELECT ... FOR UPDATE를 걸어 동일 pool의 동시 증가를 직렬화.
 *
 * 중요:
 *   - mode=x를 paid로 해석하지 않음
 *   - client가 보낸 plan/member_limit 신뢰 금지
 *   - x_plan_key가 X 한도 canonical source
 */

import { sql } from "drizzle-orm";

// ── X Plan 공식 회원 한도 ─────────────────────────────────────────────────
const X_PLAN_LIMITS: Record<string, number> = {
  x300:  300,
  x500:  500,
  x1000: 1000,
};

const X_PLAN_LABELS: Record<string, string> = {
  x300:  "X300",
  x500:  "X500",
  x1000: "X1000",
};

// ── 공식 Active member count 정의 ─────────────────────────────────────────
// 근거: admin.ts total_members, auto-link-v2.ts, parent.ts 등 codebase 전체 일관
// excluded: withdrawn (퇴원), archived (아카이브), deleted (삭제)
export const MEMBER_LIMIT_EXCLUDED_STATUSES = `('withdrawn', 'archived', 'deleted')`;

// ── MemberLimitError ──────────────────────────────────────────────────────

export class MemberLimitError extends Error {
  readonly code = "PLAN_MEMBER_LIMIT_REACHED";
  readonly limit: number;
  readonly current: number;
  readonly planKey: string;

  constructor(limit: number, current: number, planKey: string) {
    super(`회원 한도 도달: 현재 ${current}명 / 최대 ${limit}명 (${planKey})`);
    this.limit = limit;
    this.current = current;
    this.planKey = planKey;
  }
}

// ── HTTP 응답 헬퍼 ────────────────────────────────────────────────────────

export function sendMemberLimitResponse(res: any, e: MemberLimitError): void {
  const planLabel = X_PLAN_LABELS[e.planKey] ?? e.planKey;
  res.status(403).json({
    success: false,
    error: "PLAN_MEMBER_LIMIT_REACHED",
    code:  "PLAN_MEMBER_LIMIT_REACHED",
    message: `현재 ${planLabel} 회원 한도 ${e.limit}명에 도달했습니다. 상위 플랜으로 변경하면 회원을 추가할 수 있습니다.`,
    limit:   e.limit,
    current: e.current,
    plan:    e.planKey,
  });
}

// ── 유효 한도 조회 (tx 없이 read-only 용도) ───────────────────────────────

export interface MemberLimitConfig {
  limit:   number;
  planKey: string;
}

/**
 * 풀의 유효 회원 한도를 반환.
 * X pool: x_plan_key 기준 (x300/x500/x1000).
 * 일반 pool: swimming_pools.member_limit 개별 override 우선, 없으면 subscription_plans.member_limit.
 *
 * Client가 보낸 어떤 값도 신뢰하지 않음 — poolId만 입력.
 * NOTE: race-safe하지 않음. 단순 read-only 조회용. race-safe는 assertMemberLimitInTx 사용.
 */
export async function getMemberLimitConfig(poolId: string, db: any): Promise<MemberLimitConfig> {
  const [row] = (await db.execute(sql`
    SELECT
      sp.x_plan_key,
      sp.x_paid_entitlement,
      sp.x_manual_entitlement,
      sp.x_management_override,
      sp.x_force_disabled,
      sp.member_limit      AS pool_override_limit,
      sp.subscription_tier,
      COALESCE(spl.member_limit, 5) AS plan_limit
    FROM swimming_pools sp
    LEFT JOIN subscription_plans spl ON spl.tier = sp.subscription_tier
    WHERE sp.id = ${poolId}
    LIMIT 1
  `)).rows as any[];

  return resolveConfig(row);
}

// ── 내부: pool row → { limit, planKey } ─────────────────────────────────

function resolveConfig(row: any): MemberLimitConfig {
  if (!row) return { limit: 5, planKey: "free" };

  const isX = (
    Boolean(row.x_management_override) ||
    Boolean(row.x_paid_entitlement) ||
    Boolean(row.x_manual_entitlement)
  ) && !Boolean(row.x_force_disabled);

  if (isX && row.x_plan_key) {
    const xLimit = X_PLAN_LIMITS[row.x_plan_key as string];
    if (xLimit !== undefined) {
      return { limit: xLimit, planKey: row.x_plan_key as string };
    }
  }

  // 일반 pool: pool override > plan default
  const limit = row.pool_override_limit != null
    ? Number(row.pool_override_limit)
    : Number(row.plan_limit ?? 5);

  return { limit, planKey: row.subscription_tier ?? "free" };
}

// ── 현재 active member 수 조회 (공식 lifecycle 기준) ─────────────────────

export async function getActiveMemberCount(tx: any, poolId: string): Promise<number> {
  const [cnt] = (await tx.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM students
    WHERE swimming_pool_id = ${poolId}
      AND status NOT IN ('withdrawn', 'archived', 'deleted')
  `)).rows as any[];
  return Number(cnt?.cnt ?? 0);
}

// ── Race-safe 한도 검사 (transaction 내부 전용) ───────────────────────────

/**
 * db.transaction() 콜백 안에서 호출.
 *
 * 1. SELECT id FROM swimming_pools WHERE id = poolId FOR UPDATE
 *    — 동일 pool의 동시 회원 증가 요청을 row-level lock으로 직렬화
 * 2. 유효 한도 조회 (server-side, x_plan_key 기준)
 * 3. active member count (공식 lifecycle: NOT IN ('withdrawn','archived','deleted'))
 * 4. 한도 초과 시 MemberLimitError throw → transaction 자동 ROLLBACK
 * 5. 정상 시 { limit, current, planKey } 반환 (caller는 이후 INSERT/UPDATE 진행)
 *
 * @param tx  drizzle-orm transaction handle
 * @param poolId  서버에서 확인된 pool ID
 */
export async function assertMemberLimitInTx(
  tx: any,
  poolId: string,
): Promise<{ limit: number; current: number; planKey: string }> {
  // 1. swimming_pools row에 SELECT FOR UPDATE (단일 쿼리)
  //    - 동일 pool에 대한 동시 회원 증가 요청을 row-level lock으로 직렬화
  //    - FOR UPDATE OF sp: LEFT JOIN 대상 중 swimming_pools row만 lock
  //    - subscription_plans는 읽기 전용이므로 lock 불필요
  const [planRow] = (await tx.execute(sql`
    SELECT
      sp.x_plan_key,
      sp.x_paid_entitlement,
      sp.x_manual_entitlement,
      sp.x_management_override,
      sp.x_force_disabled,
      sp.member_limit      AS pool_override_limit,
      sp.subscription_tier,
      COALESCE(spl.member_limit, 5) AS plan_limit
    FROM swimming_pools sp
    LEFT JOIN subscription_plans spl ON spl.tier = sp.subscription_tier
    WHERE sp.id = ${poolId}
    FOR UPDATE OF sp
  `)).rows as any[];

  const { limit, planKey } = resolveConfig(planRow ?? null);

  // 3. Active member count (공식 lifecycle 기준)
  const current = await getActiveMemberCount(tx, poolId);

  console.log(`[member-limit] poolId=${poolId} plan=${planKey} limit=${limit} current=${current}`);

  // 4. 한도 검사
  if (current >= limit) {
    throw new MemberLimitError(limit, current, planKey);
  }

  return { limit, current, planKey };
}
