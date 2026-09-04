/**
 * SWIMNOTE X — mode 판정 모듈
 *
 * WP2 승인 범위:
 *   - XModeStatus / PoolMode / PoolModeResult 타입
 *   - computeMode()  — 순수 판정 함수 (DB 없음)
 *   - resolvePoolMode() — DB에서 pool 조회 후 mode 계산
 *
 * X02-B2 변경:
 *   - resolveEffectiveXEntitlement() 추가 — (paid OR manual) AND NOT force
 *   - resolvePoolMode() → x_paid_entitlement / x_manual_entitlement / x_force_disabled 사용
 *   - PoolModeResult.xmode_entitlement → effective 값 반환 (backward compat)
 *   - legacy xmode_entitlement 컬럼은 DROP 금지, read compat 유지
 *
 * 금지:
 *   - capabilities 추가
 *   - 캐시 추가
 *   - fallback 추가
 *   - 별도 오류 클래스 생성
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── 타입 ──────────────────────────────────────────────────────────────────
export type XModeStatus =
  | "NOT_CONFIGURED"
  | "CURRICULUM_PENDING"
  | "READY";

export type PoolMode =
  | "normal"
  | "x_pending"
  | "x"
  | "x_trial"            // WP2B additive: 3일 무료체험 활성 상태
  | "subscription_required"; // Amendment A1: 신규 2.0 paid lifecycle 만료, active base plan 없음

/** Amendment A1: 신규 2.0 paid tier 집합 */
const NEW_2_TIERS = new Set(["swimnote", "x300", "x500", "x1000"]);

export interface PoolModeResult {
  pool_id: string;
  mode: PoolMode;
  /** effective entitlement = (paid OR manual) AND NOT force_disabled. backward compat 필드명 유지. */
  xmode_entitlement: boolean;
  xmode_config_status: XModeStatus;
  /** WP2B additive: trial 관련 필드 (기존 소비처 미변경) */
  x_trial_active: boolean;
  x_trial_started_at: string | null;
  x_trial_ends_at: string | null;
  x_trial_used: boolean;
}

// ── effective entitlement 계산 (단일 source of truth) ─────────────────────
//
// X02-B2: 결제 출처(paid)와 수동 출처(manual)를 OR 합산하고,
//         운영 차단(force_disabled)이 있으면 전체 false로 override.
//
export function resolveEffectiveXEntitlement(pool: {
  x_paid_entitlement: boolean;
  x_manual_entitlement: boolean;
  x_force_disabled: boolean;
}): boolean {
  return (pool.x_paid_entitlement || pool.x_manual_entitlement) && !pool.x_force_disabled;
}

// ── 판정 함수 (순수, DB 없음) ─────────────────────────────────────────────
//
// 우선순위 (WP2B CORRECTION — LOCKED MASTER DESIGN):
//   1. x_force_disabled                            → normal  (force override 최우선)
//   2. x_paid_entitlement || x_manual_entitlement  → READY이면 x, 아니면 x_pending
//      (paid가 config 완료 전에는 x_pending 유지 — 결제 직후 setup 필요)
//   3. x_trial active                              → x_trial (lazy expiration: ends_at > NOW())
//   4. otherwise                                   → normal
//
// Trial lazy expiration: background worker 불필요.
// x_trial_ends_at <= NOW() 이면 Trial 비활성 — 다음 API 요청에서 즉시 normal 반환.
//
export function computeMode(pool: {
  x_paid_entitlement: boolean;
  x_manual_entitlement: boolean;
  x_force_disabled: boolean;
  xmode_config_status: XModeStatus;
  // WP2B additive — optional for backward compat with existing callers
  x_trial_started_at?: string | Date | null;
  x_trial_ends_at?: string | Date | null;
  // Amendment A1 additive — optional for backward compat
  subscription_tier?: string | null;
  subscription_status?: string | null;
}): PoolMode {
  if (pool.x_force_disabled) return "normal";
  // WP2B CORRECTION: paid는 config 완료 전까지 x_pending (결제 직후 setup 필요)
  // paid와 manual 모두 동일 규칙: READY → x / 그 외 → x_pending
  if (pool.x_paid_entitlement || pool.x_manual_entitlement) {
    return pool.xmode_config_status === "READY" ? "x" : "x_pending";
  }
  // X Trial: lazy expiration — ends_at > NOW() 조건만 확인
  if (pool.x_trial_started_at && pool.x_trial_ends_at) {
    const endsAt = pool.x_trial_ends_at instanceof Date
      ? pool.x_trial_ends_at
      : new Date(pool.x_trial_ends_at);
    if (endsAt > new Date()) return "x_trial";
  }
  // Amendment A1: subscription_required — 신규 2.0 paid lifecycle 만료
  //
  // 조건: subscription_tier ∈ NEW_2_TIERS + subscription_status ≠ "active"
  //   → X 만료 후 SWIMNOTE 없음 = subscription_required
  //
  // 예외:
  //   - subscription_tier = "swimnote" + status = "active" → normal (SWIMNOTE 기본플랜 활성)
  //   - legacy tiers (free / Coach / Premier) → 기존 behavior 유지 (normal)
  //   - trial lifecycle: trial 종료 후 subscription_required 아님 (Trial ≠ paid lifecycle)
  //
  // BACKWARD COMPAT: subscription_tier/status 미전달 시 → existing behavior (normal)
  if (pool.subscription_tier && NEW_2_TIERS.has(pool.subscription_tier)) {
    if (pool.subscription_status === "active") {
      // SWIMNOTE active OR X (should have been caught by x_paid_entitlement above) → normal
      return "normal";
    }
    // 2.0 paid tier + 비활성 → subscription_required
    return "subscription_required";
  }
  return "normal";
}

// ── pool 조회 + mode 계산 ─────────────────────────────────────────────────
//
// pool 미존재 시 null 반환.
// 호출부(Route handler / middleware)에서 null 여부를 확인하고 404 처리.
//
// X02-B2: x_paid_entitlement / x_manual_entitlement / x_force_disabled 로
//         effective entitlement 계산. legacy xmode_entitlement 컬럼은
//         PoolModeResult.xmode_entitlement 필드로 effective 값을 반환하여
//         기존 소비처 계약 유지.
//
export async function resolvePoolMode(
  poolId: string,
): Promise<PoolModeResult | null> {
  // WP2B: x_trial_* 컬럼 추가 SELECT (column이 없는 구 DB에서는 NULL 반환 — 안전)
  // Amendment A1: subscription_tier, subscription_status 추가 SELECT
  const result = await superAdminDb.execute(sql`
    SELECT id, xmode_config_status,
           COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
           COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
           COALESCE(x_force_disabled,    false) AS x_force_disabled,
           x_trial_started_at,
           x_trial_ends_at,
           x_trial_used_at,
           subscription_tier,
           subscription_status
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `);
  if (!result.rows.length) return null;

  const row = result.rows[0] as any;
  const entitlement = resolveEffectiveXEntitlement({
    x_paid_entitlement:  Boolean(row.x_paid_entitlement),
    x_manual_entitlement: Boolean(row.x_manual_entitlement),
    x_force_disabled:    Boolean(row.x_force_disabled),
  });
  const configStatus = row.xmode_config_status as XModeStatus;

  // WP2B: trial active 계산 (lazy expiration)
  const trialEndsAt: string | null = row.x_trial_ends_at
    ? new Date(row.x_trial_ends_at).toISOString() : null;
  const trialStartedAt: string | null = row.x_trial_started_at
    ? new Date(row.x_trial_started_at).toISOString() : null;
  const trialUsedAt: string | null = row.x_trial_used_at
    ? new Date(row.x_trial_used_at).toISOString() : null;
  const trialActive = !!(trialStartedAt && trialEndsAt && new Date(trialEndsAt) > new Date());

  return {
    pool_id: row.id,
    mode: computeMode({
      x_paid_entitlement:   Boolean(row.x_paid_entitlement),
      x_manual_entitlement: Boolean(row.x_manual_entitlement),
      x_force_disabled:     Boolean(row.x_force_disabled),
      xmode_config_status:  configStatus,
      x_trial_started_at:   trialStartedAt,
      x_trial_ends_at:      trialEndsAt,
      // Amendment A1: subscription_required 판정용
      subscription_tier:    row.subscription_tier  ? String(row.subscription_tier)  : null,
      subscription_status:  row.subscription_status ? String(row.subscription_status) : null,
    }),
    xmode_entitlement: entitlement,   // backward compat: effective 값 반환
    xmode_config_status: configStatus,
    // WP2B additive trial fields
    x_trial_active:     trialActive,
    x_trial_started_at: trialStartedAt,
    x_trial_ends_at:    trialEndsAt,
    x_trial_used:       trialUsedAt !== null,
  };
}
