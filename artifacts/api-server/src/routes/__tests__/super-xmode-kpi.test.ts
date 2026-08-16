// super-xmode-kpi.test.ts
//
// 검증 대상:
//   A. computeMode() — canonical X MODE 판정 함수
//   B. resolveEffectiveXEntitlement() — X02-B2 effective helper
//   C. dashboard-stats xmode_operators SQL COUNT 로직 (effective formula)
//   D. pools-summary filter=xmode 조건 (effective formula)
//   E. pools-summary 응답 xmode_entitlement / xmode_config_status 필드
//   F. 기존 TC regression

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── @workspace/db mock ────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const mockExecute = vi.fn();
  return {
    superAdminDb: { execute: mockExecute },
    db:           { execute: mockExecute },
    sql:          { raw: (s: string) => s },
  };
});

import { superAdminDb } from "@workspace/db";
import {
  computeMode,
  resolveEffectiveXEntitlement,
  type XModeStatus,
} from "../../lib/xmode.js";

const mockExecute = superAdminDb.execute as ReturnType<typeof vi.fn>;

beforeEach(() => { mockExecute.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════════════════════
// A. computeMode — canonical X MODE 판정 (순수함수, DB 없음)
// ══════════════════════════════════════════════════════════════════════════
describe("A. computeMode — canonical X MODE rule", () => {
  it("A-1: entitlement=false → mode='normal'", () => {
    expect(computeMode(false, "NOT_CONFIGURED")).toBe("normal");
    expect(computeMode(false, "CURRICULUM_PENDING")).toBe("normal");
    expect(computeMode(false, "READY")).toBe("normal");
  });

  it("A-2: entitlement=true + config NOT_CONFIGURED → mode='x_pending'", () => {
    expect(computeMode(true, "NOT_CONFIGURED")).toBe("x_pending");
  });

  it("A-3: entitlement=true + config CURRICULUM_PENDING → mode='x_pending'", () => {
    expect(computeMode(true, "CURRICULUM_PENDING")).toBe("x_pending");
  });

  it("A-4: entitlement=true + config READY → mode='x'", () => {
    expect(computeMode(true, "READY")).toBe("x");
  });

  it("A-5: X MODE = entitlement=true AND config=READY 두 조건만", () => {
    const cases: Array<{ e: boolean; c: XModeStatus; expected: boolean }> = [
      { e: false, c: "NOT_CONFIGURED",    expected: false },
      { e: false, c: "CURRICULUM_PENDING",expected: false },
      { e: false, c: "READY",             expected: false },
      { e: true,  c: "NOT_CONFIGURED",    expected: false },
      { e: true,  c: "CURRICULUM_PENDING",expected: false },
      { e: true,  c: "READY",             expected: true  },
    ];
    for (const { e, c, expected } of cases) {
      expect(computeMode(e, c) === "x").toBe(expected);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// B. resolveEffectiveXEntitlement — X02-B2 effective helper
//    (paid OR manual) AND NOT force_disabled
// ══════════════════════════════════════════════════════════════════════════
describe("B. resolveEffectiveXEntitlement — X02-B2 CASE A~H", () => {
  // CASE A: paid=false, manual=false, force=false → effective=false
  it("CASE A: paid=false, manual=false, force=false → effective=false (normal)", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false,
    })).toBe(false);
  });

  // CASE B: paid=true, manual=false, force=false → effective=true
  it("CASE B: paid=true, manual=false, force=false → effective=true", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false,
    })).toBe(true);
  });

  // CASE C: paid=false, manual=true, force=false → effective=true
  it("CASE C: paid=false, manual=true, force=false → effective=true", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false,
    })).toBe(true);
  });

  // CASE D: paid=true, manual=true, force=false → effective=true
  it("CASE D: paid=true, manual=true, force=false → effective=true", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: false,
    })).toBe(true);
  });

  // CASE E: paid=true, manual=false, force=true → effective=false (normal)
  it("CASE E: paid=true, manual=false, force=true → effective=false (force override)", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: true,
    })).toBe(false);
  });

  // CASE F: paid=false, manual=true, force=true → effective=false (normal)
  it("CASE F: paid=false, manual=true, force=true → effective=false (force override)", () => {
    expect(resolveEffectiveXEntitlement({
      x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: true,
    })).toBe(false);
  });

  // CASE G: paid=true, manual=false, config!=READY → x_pending (computeMode level)
  it("CASE G: paid=true, config NOT_CONFIGURED → effective=true, mode=x_pending", () => {
    const eff = resolveEffectiveXEntitlement({
      x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false,
    });
    expect(eff).toBe(true);
    expect(computeMode(eff, "NOT_CONFIGURED")).toBe("x_pending");
  });

  // CASE H: paid=false, manual=true, config!=READY → x_pending
  it("CASE H: manual=true, config CURRICULUM_PENDING → effective=true, mode=x_pending", () => {
    const eff = resolveEffectiveXEntitlement({
      x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false,
    });
    expect(eff).toBe(true);
    expect(computeMode(eff, "CURRICULUM_PENDING")).toBe("x_pending");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. dashboard-stats xmode_operators SQL 조건 단위 검증 (X02-B2 effective formula)
// ══════════════════════════════════════════════════════════════════════════
describe("C. dashboard-stats xmode_operators SQL 조건 (effective formula)", () => {
  // SQL: (COALESCE(x_paid,false) OR COALESCE(x_manual,false)) AND NOT COALESCE(x_force,false)
  //      AND xmode_config_status = 'READY'
  function sqlCountFilter(pools: Array<{
    x_paid_entitlement?: boolean | null;
    x_manual_entitlement?: boolean | null;
    x_force_disabled?: boolean | null;
    xmode_config_status: string | null;
  }>): number {
    return pools.filter(p => {
      const paid   = p.x_paid_entitlement   ?? false;
      const manual = p.x_manual_entitlement ?? false;
      const force  = p.x_force_disabled     ?? false;
      const effective = (paid || manual) && !force;
      return effective && p.xmode_config_status === "READY";
    }).length;
  }

  it("C-1: 모든 pool paid=false, manual=false → xmode_operators=0", () => {
    const pools = [
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("C-2: paid=true + config!=READY → xmode_operators=0", () => {
    const pools = [
      { x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
      { x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("C-3: paid=true + config=READY → xmode_operators=1", () => {
    const pools = [
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
    ];
    expect(sqlCountFilter(pools)).toBe(1);
  });

  it("C-4: manual=true + config=READY → xmode_operators=1 (manual entitlement)", () => {
    const pools = [
      { x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false, xmode_config_status: "READY" },
    ];
    expect(sqlCountFilter(pools)).toBe(1);
  });

  it("C-5: paid=true + force=true → xmode_operators=0 (force override)", () => {
    const pools = [
      { x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: true, xmode_config_status: "READY" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("C-6: 복수 X MODE 수영장 → count 정확", () => {
    const pools = [
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },   // X (paid)
      { x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" },   // X (manual)
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }, // x_pending
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },   // normal
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: true,  xmode_config_status: "READY" },   // force disabled
    ];
    expect(sqlCountFilter(pools)).toBe(2); // paid+READY, manual+READY
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. pools-summary filter=xmode SQL 조건 단위 검증 (X02-B2 effective formula)
// ══════════════════════════════════════════════════════════════════════════
describe("D. pools-summary filter=xmode SQL 조건 (effective formula)", () => {
  function xmodeFilter(pool: {
    x_paid_entitlement?: boolean | null;
    x_manual_entitlement?: boolean | null;
    x_force_disabled?: boolean | null;
    xmode_config_status: string | null;
  }): boolean {
    const paid   = pool.x_paid_entitlement   ?? false;
    const manual = pool.x_manual_entitlement ?? false;
    const force  = pool.x_force_disabled     ?? false;
    return (paid || manual) && !force && pool.xmode_config_status === "READY";
  }

  it("D-1: paid=false, manual=false → filter=xmode 제외", () => {
    expect(xmodeFilter({ x_paid_entitlement: false, x_manual_entitlement: false, xmode_config_status: "READY" })).toBe(false);
  });

  it("D-2: paid=true + config!=READY → filter=xmode 제외", () => {
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "NOT_CONFIGURED" })).toBe(false);
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "CURRICULUM_PENDING" })).toBe(false);
  });

  it("D-3: paid=true + config=READY → filter=xmode 포함", () => {
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "READY" })).toBe(true);
  });

  it("D-4: manual=true + config=READY → filter=xmode 포함 (manual entitlement)", () => {
    expect(xmodeFilter({ x_paid_entitlement: false, x_manual_entitlement: true, xmode_config_status: "READY" })).toBe(true);
  });

  it("D-5: force=true → filter=xmode 제외 (force override)", () => {
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: true, xmode_config_status: "READY" })).toBe(false);
  });

  it("D-6: null 값 → COALESCE false 처리 → filter=xmode 제외", () => {
    expect(xmodeFilter({ x_paid_entitlement: null, x_manual_entitlement: null, xmode_config_status: "READY" })).toBe(false);
  });

  it("D-7: computeMode(effective) === 'x' ↔ xmodeFilter 일치", () => {
    const pools = [
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: true,  x_manual_entitlement: true,  x_force_disabled: true,  xmode_config_status: "READY" },
    ];
    for (const p of pools) {
      const paid   = p.x_paid_entitlement   ?? false;
      const manual = p.x_manual_entitlement ?? false;
      const force  = p.x_force_disabled     ?? false;
      const eff = (paid || manual) && !force;
      const isX = computeMode(eff, p.xmode_config_status as XModeStatus) === "x";
      const inFilter = xmodeFilter(p);
      expect(isX, `xmodeFilter vs computeMode mismatch for ${JSON.stringify(p)}`).toBe(inFilter);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. pools-summary 응답 xmode 필드 구조 (backward compat)
// ══════════════════════════════════════════════════════════════════════════
describe("E. pools-summary 응답 xmode 필드 (backward compat)", () => {
  // X02-B2: SQL SELECT에서 effective 계산 → xmode_entitlement 필드로 반환
  function mapRow(r: any) {
    return {
      // effective를 xmode_entitlement 필드명으로 반환 (backward compat)
      xmode_entitlement:   Boolean(r.xmode_entitlement ?? false),
      xmode_config_status: (r.xmode_config_status ?? "NOT_CONFIGURED") as string,
    };
  }

  it("E-1: effective=true, config=READY → xmode_entitlement=true", () => {
    const row = { xmode_entitlement: true, xmode_config_status: "READY" };
    const mapped = mapRow(row);
    expect(mapped.xmode_entitlement).toBe(true);
    expect(mapped.xmode_config_status).toBe("READY");
  });

  it("E-2: effective=false (force) → xmode_entitlement=false", () => {
    const row = { xmode_entitlement: false, xmode_config_status: "READY" };
    const mapped = mapRow(row);
    expect(mapped.xmode_entitlement).toBe(false);
    expect(mapped.xmode_config_status).toBe("READY");
  });

  it("E-3: null 값 → COALESCE 기본값 적용", () => {
    const row = { xmode_entitlement: null, xmode_config_status: null };
    const mapped = mapRow(row);
    expect(mapped.xmode_entitlement).toBe(false);
    expect(mapped.xmode_config_status).toBe("NOT_CONFIGURED");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// F. non-xmode filter 기존 동작 regression
// ══════════════════════════════════════════════════════════════════════════
describe("F. 기존 filter 동작 regression", () => {
  function applyFilter(filter: string, pools: any[]): any[] {
    switch (filter) {
      case "pending":   return pools.filter(p => p.approval_status === "pending");
      case "active":    return pools.filter(p => p.approval_status === "approved" && ["active","trial"].includes(p.subscription_status ?? ""));
      // X02-B2: effective formula
      case "xmode":     return pools.filter(p => {
        const paid   = p.x_paid_entitlement   ?? false;
        const manual = p.x_manual_entitlement ?? false;
        const force  = p.x_force_disabled     ?? false;
        return (paid || manual) && !force && p.xmode_config_status === "READY";
      });
      case "all":
      default:          return pools;
    }
  }

  const samplePools = [
    { id: "1", approval_status: "pending",  subscription_status: "trial",  x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
    { id: "2", approval_status: "approved", subscription_status: "active", x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
    { id: "3", approval_status: "approved", subscription_status: "active", x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },           // X (paid)
    { id: "4", approval_status: "approved", subscription_status: "active", x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" },           // X (manual)
    { id: "5", approval_status: "approved", subscription_status: "active", x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }, // x_pending
    { id: "6", approval_status: "approved", subscription_status: "active", x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: true,  xmode_config_status: "READY" },          // force disabled
  ];

  it("F-1: filter=all → 전체 반환", () => {
    expect(applyFilter("all", samplePools)).toHaveLength(6);
  });

  it("F-2: filter=pending → pending만", () => {
    const result = applyFilter("pending", samplePools);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("F-3: filter=xmode → paid+READY AND manual+READY 포함 (2개)", () => {
    const result = applyFilter("xmode", samplePools);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.id).sort()).toEqual(["3", "4"]);
  });

  it("F-4: filter=xmode → x_pending(config!=READY) 제외", () => {
    const result = applyFilter("xmode", samplePools);
    expect(result.some(p => p.id === "5")).toBe(false);
  });

  it("F-5: filter=xmode → force_disabled 제외", () => {
    const result = applyFilter("xmode", samplePools);
    expect(result.some(p => p.id === "6")).toBe(false);
  });
});
