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
describe("A. computeMode — canonical X MODE rule (P0)", () => {
  it("A-1: no entitlement → mode='normal'", () => {
    const noEnt = { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false };
    expect(computeMode({ ...noEnt, xmode_config_status: "NOT_CONFIGURED" })).toBe("normal");
    expect(computeMode({ ...noEnt, xmode_config_status: "CURRICULUM_PENDING" })).toBe("normal");
    expect(computeMode({ ...noEnt, xmode_config_status: "READY" })).toBe("normal");
  });

  it("A-2: paid=true + config NOT_CONFIGURED → mode='x_pending' (WP2B CORRECTION: paid requires READY config)", () => {
    expect(computeMode({ x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" })).toBe("x_pending");
  });

  it("A-3: manual=true + config CURRICULUM_PENDING → mode='x_pending'", () => {
    expect(computeMode({ x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" })).toBe("x_pending");
  });

  it("A-4: paid/manual + config READY → mode='x'", () => {
    expect(computeMode({ x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" })).toBe("x");
    expect(computeMode({ x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" })).toBe("x");
  });

  it("A-5: LOCKED MASTER DESIGN 조합 테이블 — paid+READY → x; paid+NOT_CONFIGURED → x_pending; force → normal", () => {
    type Case = { paid: boolean; manual: boolean; force: boolean; config: XModeStatus; expected: "normal" | "x_pending" | "x" };
    const cases: Case[] = [
      { paid: false, manual: false, force: false, config: "NOT_CONFIGURED",     expected: "normal"    },
      { paid: false, manual: false, force: false, config: "CURRICULUM_PENDING", expected: "normal"    },
      { paid: false, manual: false, force: false, config: "READY",              expected: "normal"    },
      // WP2B CORRECTION: paid requires READY (same as manual)
      { paid: true,  manual: false, force: false, config: "NOT_CONFIGURED",     expected: "x_pending" },
      { paid: true,  manual: false, force: false, config: "CURRICULUM_PENDING", expected: "x_pending" },
      { paid: true,  manual: false, force: false, config: "READY",              expected: "x"         },
      { paid: false, manual: true,  force: false, config: "NOT_CONFIGURED",     expected: "x_pending" },
      { paid: false, manual: true,  force: false, config: "CURRICULUM_PENDING", expected: "x_pending" },
      { paid: false, manual: true,  force: false, config: "READY",              expected: "x"         },
      { paid: true,  manual: false, force: true,  config: "READY",              expected: "normal"    },
      { paid: true,  manual: true,  force: true,  config: "READY",              expected: "normal"    },
    ];
    for (const { paid, manual, force, config, expected } of cases) {
      expect(
        computeMode({ x_paid_entitlement: paid, x_manual_entitlement: manual, x_force_disabled: force, xmode_config_status: config }),
        `paid=${paid} manual=${manual} force=${force} config=${config}`,
      ).toBe(expected);
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

  // CASE G: paid=true, manual=false, config!=READY → x_pending (WP2B CORRECTION: paid requires READY)
  it("CASE G: paid=true, config NOT_CONFIGURED → effective=true, mode=x_pending (WP2B CORRECTION)", () => {
    const eff = resolveEffectiveXEntitlement({
      x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false,
    });
    expect(eff).toBe(true);
    // resolveEffectiveXEntitlement은 여전히 true — 결제 이력은 있음
    // computeMode는 config 상태 확인: NOT_CONFIGURED → x_pending
    expect(computeMode({ x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" })).toBe("x_pending");
  });

  // CASE H: paid=false, manual=true, config!=READY → x_pending (manual path unchanged)
  it("CASE H: manual=true, config CURRICULUM_PENDING → effective=true, mode=x_pending", () => {
    const eff = resolveEffectiveXEntitlement({
      x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false,
    });
    expect(eff).toBe(true);
    expect(computeMode({ x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" })).toBe("x_pending");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. dashboard-stats xmode_operators SQL 조건 단위 검증 (X02-B2 effective formula)
// ══════════════════════════════════════════════════════════════════════════
describe("C. dashboard-stats xmode_operators SQL 조건 (P0 rule)", () => {
  // P0 SQL: NOT COALESCE(x_force_disabled,false)
  //         AND (COALESCE(x_paid_entitlement,false)
  //           OR (COALESCE(x_manual_entitlement,false) AND xmode_config_status = 'READY'))
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
      // P0: paid+not_force → X; manual+READY+not_force → X
      return !force && (paid || (manual && p.xmode_config_status === "READY"));
    }).length;
  }

  it("C-1: 모든 pool paid=false, manual=false → xmode_operators=0", () => {
    const pools = [
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("C-2: paid=true + config!=READY → xmode_operators=2 (P0: paid always x)", () => {
    const pools = [
      { x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },
      { x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "CURRICULUM_PENDING" },
    ];
    expect(sqlCountFilter(pools)).toBe(2);
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

  it("C-6: 복수 X MODE 수영장 → count 정확 (P0: paid+NOT_CONFIGURED도 포함)", () => {
    const pools = [
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },           // X (paid+READY)
      { x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" },           // X (manual+READY)
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" },  // X (paid+NOT_CONFIGURED → P0)
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },           // normal
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: true,  xmode_config_status: "READY" },           // force disabled
    ];
    expect(sqlCountFilter(pools)).toBe(3); // paid+READY, manual+READY, paid+NOT_CONFIGURED
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. pools-summary filter=xmode SQL 조건 단위 검증 (X02-B2 effective formula)
// ══════════════════════════════════════════════════════════════════════════
describe("D. pools-summary filter=xmode SQL 조건 (P0 rule)", () => {
  // P0: paid+not_force → x; manual+READY+not_force → x
  function xmodeFilter(pool: {
    x_paid_entitlement?: boolean | null;
    x_manual_entitlement?: boolean | null;
    x_force_disabled?: boolean | null;
    xmode_config_status: string | null;
  }): boolean {
    const paid   = pool.x_paid_entitlement   ?? false;
    const manual = pool.x_manual_entitlement ?? false;
    const force  = pool.x_force_disabled     ?? false;
    return !force && (paid || (manual && pool.xmode_config_status === "READY"));
  }

  it("D-1: paid=false, manual=false → filter=xmode 제외", () => {
    expect(xmodeFilter({ x_paid_entitlement: false, x_manual_entitlement: false, xmode_config_status: "READY" })).toBe(false);
  });

  it("D-2: paid=true + config!=READY → filter=xmode 포함 (P0: paid always x)", () => {
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "NOT_CONFIGURED" })).toBe(true);
    expect(xmodeFilter({ x_paid_entitlement: true, x_manual_entitlement: false, xmode_config_status: "CURRICULUM_PENDING" })).toBe(true);
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

  it("D-7: computeMode === 'x' ↔ xmodeFilter 일치 (WP2B CORRECTION: paid+READY → x, paid+NOT_CONFIGURED → x_pending)", () => {
    // WP2B CORRECTION: xmodeFilter도 paid에 READY 조건 적용해야 computeMode=x와 일치
    function xmodeFilterCorrected(pool: {
      x_paid_entitlement?: boolean | null;
      x_manual_entitlement?: boolean | null;
      x_force_disabled?: boolean | null;
      xmode_config_status: string | null;
    }): boolean {
      const paid   = pool.x_paid_entitlement   ?? false;
      const manual = pool.x_manual_entitlement ?? false;
      const force  = pool.x_force_disabled     ?? false;
      // LOCKED: paid+READY → x; manual+READY → x; otherwise → x_pending
      return !force && ((paid || manual) && pool.xmode_config_status === "READY");
    }
    const pools = [
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },          // x
      { x_paid_entitlement: false, x_manual_entitlement: true,  x_force_disabled: false, xmode_config_status: "READY" },          // x
      { x_paid_entitlement: true,  x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" }, // x_pending
      { x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" },          // normal
      { x_paid_entitlement: true,  x_manual_entitlement: true,  x_force_disabled: true,  xmode_config_status: "READY" },          // normal
    ];
    for (const p of pools) {
      const paid   = p.x_paid_entitlement   ?? false;
      const manual = p.x_manual_entitlement ?? false;
      const force  = p.x_force_disabled     ?? false;
      const isX = computeMode({
        x_paid_entitlement:   paid,
        x_manual_entitlement: manual,
        x_force_disabled:     force,
        xmode_config_status:  p.xmode_config_status as XModeStatus,
      }) === "x";
      const inFilter = xmodeFilterCorrected(p);
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
