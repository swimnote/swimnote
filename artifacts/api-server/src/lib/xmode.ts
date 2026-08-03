/**
 * SWIMNOTE X — mode 판정 모듈
 *
 * WP2 승인 범위:
 *   - XModeStatus / PoolMode / PoolModeResult 타입
 *   - computeMode()  — 순수 판정 함수 (DB 없음)
 *   - resolvePoolMode() — DB에서 pool 조회 후 mode 계산
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
  xmode_entitlement: boolean;
  xmode_config_status: XModeStatus;
}

// ── 판정 함수 (순수, DB 없음) ─────────────────────────────────────────────
//
// READY가 아닌 모든 허용 XModeStatus는 x_pending으로 처리한다.
// if 구조를 사용하여 XModeStatus에 새 값이 추가되더라도
// "READY"만 명시적으로 처리하고 나머지를 x_pending으로 흡수한다.
//
export function computeMode(
  entitlement: boolean,
  configStatus: XModeStatus,
): PoolMode {
  if (!entitlement) return "normal";
  if (configStatus === "READY") return "x";
  return "x_pending";
}

// ── pool 조회 + mode 계산 ─────────────────────────────────────────────────
//
// pool 미존재 시 null 반환.
// 호출부(Route handler / middleware)에서 null 여부를 확인하고 404 처리.
//
export async function resolvePoolMode(
  poolId: string,
): Promise<PoolModeResult | null> {
  const result = await superAdminDb.execute(sql`
    SELECT id, xmode_entitlement, xmode_config_status
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `);
  if (!result.rows.length) return null;

  const row = result.rows[0] as any;
  const entitlement = Boolean(row.xmode_entitlement);
  const configStatus = row.xmode_config_status as XModeStatus;

  return {
    pool_id: row.id,
    mode: computeMode(entitlement, configStatus),
    xmode_entitlement: entitlement,
    xmode_config_status: configStatus,
  };
}
