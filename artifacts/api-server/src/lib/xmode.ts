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
  | "x";

export interface PoolModeResult {
  pool_id: string;
  mode: PoolMode;
  /** effective entitlement = (paid OR manual) AND NOT force_disabled. backward compat 필드명 유지. */
  xmode_entitlement: boolean;
  xmode_config_status: XModeStatus;
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
// P0 정책 (2026-08-16):
//   x_force_disabled      → normal  (force override 최우선)
//   x_paid_entitlement    → x       (설정 완료 여부 무관 — 결제 자체가 X 활성 조건)
//   x_manual_entitlement  → config READY이면 x, 아니면 x_pending
//   otherwise             → normal
//
export function computeMode(pool: {
  x_paid_entitlement: boolean;
  x_manual_entitlement: boolean;
  x_force_disabled: boolean;
  xmode_config_status: XModeStatus;
}): PoolMode {
  if (pool.x_force_disabled) return "normal";
  if (pool.x_paid_entitlement) return "x";
  if (pool.x_manual_entitlement) {
    return pool.xmode_config_status === "READY" ? "x" : "x_pending";
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
  const result = await superAdminDb.execute(sql`
    SELECT id, xmode_config_status,
           COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
           COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
           COALESCE(x_force_disabled,    false) AS x_force_disabled
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

  return {
    pool_id: row.id,
    mode: computeMode({
      x_paid_entitlement:   Boolean(row.x_paid_entitlement),
      x_manual_entitlement: Boolean(row.x_manual_entitlement),
      x_force_disabled:     Boolean(row.x_force_disabled),
      xmode_config_status:  configStatus,
    }),
    xmode_entitlement: entitlement,   // backward compat: effective 값 반환
    xmode_config_status: configStatus,
  };
}
