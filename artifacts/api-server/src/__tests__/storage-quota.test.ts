/**
 * storage-quota.test.ts
 *
 * storageQuota.ts canonical resolver 검증
 *
 * 정책 (2026-09-13 확정):
 *   ONE EFFECTIVE PLAN → ONE STORAGE QUOTA → SAME VALUE EVERYWHERE
 *
 * X 우선순위: management_override > paid_entitlement > manual_entitlement > BASE
 *
 * Test matrix (§8 필수 케이스):
 *  1. BASE swimnote           → 10GB
 *  2. Paid X300               → 300GB
 *  3. Paid X500               → 500GB
 *  4. Paid X1000              → 1TB (1000GB)
 *  5. Manual X300             → 300GB
 *  6. Manual X500             → 500GB
 *  7. Manual X1000            → 1TB
 *  8. Management X1000 + BASE billing swimnote → 1TB (핵심 케이스)
 *  9. X1000 + DATA100         → 1100GB
 * 10. X500 + DATA300          → 800GB
 * 11. x_plan_key=null MANUAL  → BASE (plan key 없으면 X 미인식)
 * 12. x_plan_key 미인식값     → BASE fallback
 * 13. free tier               → 0.1GB
 *
 * AI calls: 0 / DB write: NO / Migration: NO
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ──────────────────────────────────────────────────────────────────
// vi.hoisted ensures mockExecute is available when the vi.mock factory runs
// (vi.mock is hoisted to the top of the file by Vitest's transform).
const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }));

vi.mock("@workspace/db", () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) =>
      ({ _tag: "sql", strings, vals }),
    { raw: (s: string) => ({ _tag: "raw", s }) }
  );
  return {
    db: { execute: vi.fn() },
    superAdminDb: { execute: mockExecute },
    sql: sqlFn,
  };
});

import { resolveEffectiveStorageQuota, getPoolQuotaGb } from "../lib/storageQuota.js";

// ── Canonical plan table (mirrors production subscription_plans) ─────────────
const PLAN_GB: Record<string, number> = {
  free:     0.1,
  swimnote: 10,
  x300:     300,
  x500:     500,
  x1000:    1000,
};

/**
 * Build the row that storageQuota.ts expects back from superAdminDb.execute().
 * Mirrors the CASE expression in resolveEffectiveStorageQuota.
 */
function dbRow(opts: {
  mgmt?:     boolean;
  paid?:     boolean;
  manual?:   boolean;
  xPlanKey?: string | null;
  subTier?:  string;
  extraGb?:  number;
}): Record<string, unknown> {
  const mgmt   = opts.mgmt   ?? false;
  const paid   = opts.paid   ?? false;
  const manual = opts.manual ?? false;
  const xKey   = opts.xPlanKey ?? null;
  const CANONICAL = new Set(["x300", "x500", "x1000"]);

  const xActive = (mgmt || paid || manual) && !!xKey && CANONICAL.has(xKey);
  const effectiveTier = xActive ? xKey! : (opts.subTier ?? "free");
  const baseGb  = PLAN_GB[effectiveTier] ?? 0.1;
  const extraGb = opts.extraGb ?? 0;

  return { mgmt, paid, manual, x_plan_key: xKey, effective_tier: effectiveTier, base_gb: baseGb, extra_gb: extraGb };
}

function mockOnce(row: Record<string, unknown>) {
  mockExecute.mockResolvedValueOnce({ rows: [row] });
}

beforeEach(() => {
  vi.resetAllMocks();  // resets mockResolvedValueOnce queues
});

// ── resolveEffectiveStorageQuota ────────────────────────────────────────────

describe("resolveEffectiveStorageQuota", () => {

  it("1. BASE swimnote → 10GB, planSource=BASE", async () => {
    mockOnce(dbRow({ subTier: "swimnote" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("swimnote");
    expect(q.planSource).toBe("BASE");
    expect(q.baseStorageGb).toBe(10);
    expect(q.extraStorageGb).toBe(0);
    expect(q.totalStorageGb).toBe(10);
    expect(q.totalQuotaBytes).toBe(10 * 1024 ** 3);
  });

  it("2. Paid X300 → 300GB, planSource=PAID_X", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x300" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("x300");
    expect(q.planSource).toBe("PAID_X");
    expect(q.baseStorageGb).toBe(300);
    expect(q.totalStorageGb).toBe(300);
  });

  it("3. Paid X500 → 500GB, planSource=PAID_X", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x500" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("x500");
    expect(q.planSource).toBe("PAID_X");
    expect(q.baseStorageGb).toBe(500);
    expect(q.totalStorageGb).toBe(500);
  });

  it("4. Paid X1000 → 1TB (1000GB), planSource=PAID_X", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x1000" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("x1000");
    expect(q.planSource).toBe("PAID_X");
    expect(q.baseStorageGb).toBe(1000);
    expect(q.totalStorageGb).toBe(1000);
    expect(q.totalQuotaBytes).toBe(1000 * 1024 ** 3);
  });

  it("5. Manual X300 → 300GB, planSource=MANUAL_X", async () => {
    mockOnce(dbRow({ manual: true, xPlanKey: "x300" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("x300");
    expect(q.planSource).toBe("MANUAL_X");
    expect(q.baseStorageGb).toBe(300);
  });

  it("6. Manual X500 → 500GB, planSource=MANUAL_X", async () => {
    mockOnce(dbRow({ manual: true, xPlanKey: "x500" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.planSource).toBe("MANUAL_X");
    expect(q.totalStorageGb).toBe(500);
  });

  it("7. Manual X1000 → 1TB, planSource=MANUAL_X", async () => {
    mockOnce(dbRow({ manual: true, xPlanKey: "x1000" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.planSource).toBe("MANUAL_X");
    expect(q.totalStorageGb).toBe(1000);
  });

  it("8. Management Override X1000 + BASE billing (swimnote) → 1TB — 핵심 케이스", async () => {
    // ToyKids 케이스:
    //   x_management_override=true, subscription_tier='swimnote'
    //   pool_subscriptions.tier='swimnote' → 10GB (구버전 broken path)
    //   canonical resolver → x1000 → 1000GB
    mockOnce(dbRow({ mgmt: true, xPlanKey: "x1000", subTier: "swimnote" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("x1000");
    expect(q.planSource).toBe("MANAGEMENT_X");
    expect(q.baseStorageGb).toBe(1000);
    expect(q.totalStorageGb).toBe(1000);
    // billing tier(swimnote→10GB)가 아님을 명시적으로 검증
    expect(q.totalStorageGb).not.toBe(10);
    expect(q.totalQuotaBytes).toBe(1000 * 1024 ** 3);
  });

  it("9. X1000 + DATA100 → 1100GB", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x1000", extraGb: 100 }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.baseStorageGb).toBe(1000);
    expect(q.extraStorageGb).toBe(100);
    expect(q.totalStorageGb).toBe(1100);
    expect(q.totalQuotaBytes).toBe(1100 * 1024 ** 3);
  });

  it("10. X500 + DATA300 → 800GB", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x500", extraGb: 300 }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.baseStorageGb).toBe(500);
    expect(q.extraStorageGb).toBe(300);
    expect(q.totalStorageGb).toBe(800);
  });

  it("11. x_plan_key=null MANUAL → effective tier=BASE (plan key 없으면 X 미인식)", async () => {
    mockOnce(dbRow({ manual: true, xPlanKey: null, subTier: "swimnote" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    // x_plan_key가 null → CANONICAL_X_KEYS 체크 실패 → subscription_tier 사용
    expect(q.effectivePlanKey).toBe("swimnote");
    // planSource는 entitlement flag 기반 (manual=true)
    expect(q.planSource).toBe("MANUAL_X");
    expect(q.baseStorageGb).toBe(10);  // swimnote = 10GB
    expect(q.totalStorageGb).toBe(10);
  });

  it("12. x_plan_key 비표준값 → BASE subTier로 fallback", async () => {
    // x9999은 CANONICAL_X_KEYS에 없음 → effective_tier = subTier
    mockOnce(dbRow({ paid: true, xPlanKey: "x9999", subTier: "swimnote" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("swimnote");
    expect(q.baseStorageGb).toBe(10);
  });

  it("13. free tier → 0.1GB (100MB)", async () => {
    mockOnce(dbRow({ subTier: "free" }));
    const q = await resolveEffectiveStorageQuota("pool_test");
    expect(q.effectivePlanKey).toBe("free");
    expect(q.planSource).toBe("BASE");
    expect(q.baseStorageGb).toBeCloseTo(0.1);
    expect(q.totalStorageGb).toBeCloseTo(0.1);
  });

});

// ── getPoolQuotaGb backward compat wrapper ───────────────────────────────────

describe("getPoolQuotaGb (backward compat wrapper)", () => {

  it("Management X1000: quotaGb=1000, planSource=MANAGEMENT_X", async () => {
    mockOnce(dbRow({ mgmt: true, xPlanKey: "x1000", subTier: "swimnote" }));
    const r = await getPoolQuotaGb("pool_test");
    expect(r.quotaGb).toBe(1000);
    expect(r.baseGb).toBe(1000);
    expect(r.extraGb).toBe(0);
    expect(r.planSource).toBe("MANAGEMENT_X");
    expect(r.effectivePlanKey).toBe("x1000");
  });

  it("BASE swimnote: quotaGb=10, planSource=BASE", async () => {
    mockOnce(dbRow({ subTier: "swimnote" }));
    const r = await getPoolQuotaGb("pool_test");
    expect(r.quotaGb).toBe(10);
    expect(r.planSource).toBe("BASE");
    expect(r.effectivePlanKey).toBe("swimnote");
  });

  it("Paid X500 + DATA200: quotaGb=700", async () => {
    mockOnce(dbRow({ paid: true, xPlanKey: "x500", extraGb: 200 }));
    const r = await getPoolQuotaGb("pool_test");
    expect(r.baseGb).toBe(500);
    expect(r.extraGb).toBe(200);
    expect(r.quotaGb).toBe(700);
    expect(r.planSource).toBe("PAID_X");
  });

});
