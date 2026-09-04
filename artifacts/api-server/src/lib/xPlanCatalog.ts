/**
 * xPlanCatalog.ts — SWIMNOTE X Plan Authoritative Catalog (SERVER SIDE)
 *
 * Single source of truth for X plan keys, member limits, and display metadata.
 * The server uses this to:
 *   1. Validate x_plan_key in PATCH /super/operators/:id/xmode
 *   2. Set member_limit from x_plan_key (client value NOT trusted)
 *   3. Render UI display in Super Admin Control Center
 *
 * PRICE POLICY (확정 2026-09-05):
 *   X300  → ₩119,000/월, 300명
 *   X500  → ₩189,000/월, 500명
 *   X1000 → ₩349,000/월, 1000명
 *
 * DO NOT import from swim-app or swimnote-web here.
 * Web/App clients reference their own display constants but MUST match these limits.
 *
 * NOTE: officialPlanCatalog.ts is the full 6-plan catalog (base + x + data_addon).
 *       This file is kept for backward compatibility and X-specific utilities.
 */

export interface XPlanDef {
  /** DB key stored in swimming_pools.x_plan_key */
  key: string;
  /** Human-readable label */
  label: string;
  /** Maximum member count enforced by the server */
  memberLimit: number;
  /** Monthly price in KRW */
  priceMonthlyKrw: number;
  priceLabel: string;
}

export const X_PLAN_CATALOG: readonly XPlanDef[] = [
  { key: "x300",  label: "SWIMNOTE X300",  memberLimit: 300,  priceMonthlyKrw: 119000, priceLabel: "₩119,000/월" },
  { key: "x500",  label: "SWIMNOTE X500",  memberLimit: 500,  priceMonthlyKrw: 189000, priceLabel: "₩189,000/월" },
  { key: "x1000", label: "SWIMNOTE X1000", memberLimit: 1000, priceMonthlyKrw: 349000, priceLabel: "₩349,000/월" },
] as const;

/** Authoritative member limits — server MUST use this, never client-supplied value */
export const X_PLAN_LIMITS: Record<string, number> = Object.fromEntries(
  X_PLAN_CATALOG.map((p) => [p.key, p.memberLimit]),
);

/** Valid plan keys — server validation */
export const VALID_X_PLAN_KEYS = new Set(X_PLAN_CATALOG.map((p) => p.key));

export function getXPlan(key: string): XPlanDef | undefined {
  return X_PLAN_CATALOG.find((p) => p.key === key);
}

export function getXMemberLimit(key: string): number | null {
  return X_PLAN_LIMITS[key] ?? null;
}
