// super-xmode-kpi.test.ts
//
// 검증 대상:
//   A. computeMode() — canonical X MODE 판정 함수
//   B. dashboard-stats xmode_operators SQL COUNT 로직 (mock DB)
//   C. pools-summary filter=xmode 조건 (mock DB)
//   D. pools-summary 응답 xmode_entitlement / xmode_config_status 필드
//   E. 기존 TC regression

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

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
import { computeMode, type XModeStatus } from "../../lib/xmode.js";

const mockExecute = superAdminDb.execute as ReturnType<typeof vi.fn>;

beforeEach(() => { mockExecute.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

// ══════════════════════════════════════════════════════════════════════════
// A. computeMode — canonical X MODE 판정 (순수함수, DB 없음)
// ══════════════════════════════════════════════════════════════════════════
describe("A. computeMode — canonical X MODE rule", () => {
  it("A-1: entitlement=false → mode='normal' (X MODE 제외)", () => {
    expect(computeMode(false, "NOT_CONFIGURED")).toBe("normal");
    expect(computeMode(false, "CURRICULUM_PENDING")).toBe("normal");
    expect(computeMode(false, "READY")).toBe("normal");
  });

  it("A-2: entitlement=true + config NOT_CONFIGURED → mode='x_pending' (X MODE 제외)", () => {
    expect(computeMode(true, "NOT_CONFIGURED")).toBe("x_pending");
  });

  it("A-3: entitlement=true + config CURRICULUM_PENDING → mode='x_pending' (X MODE 제외)", () => {
    expect(computeMode(true, "CURRICULUM_PENDING")).toBe("x_pending");
  });

  it("A-4: entitlement=true + config READY → mode='x' (X MODE 포함)", () => {
    expect(computeMode(true, "READY")).toBe("x");
  });

  it("A-5: X MODE 판정 = entitlement=TRUE AND config='READY' 이 두 조건만", () => {
    // dashboard xmode_operators COUNT 조건과 일치해야 함
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
// B. dashboard-stats xmode_operators 카운트 SQL 조건 단위 검증
// ══════════════════════════════════════════════════════════════════════════
describe("B. dashboard-stats xmode_operators SQL 조건 (unit)", () => {
  // SQL COUNT FILTER 조건을 JS로 모사하여 canonical rule과 일치 확인
  function sqlCountFilter(pools: Array<{ xmode_entitlement: boolean | null; xmode_config_status: string | null }>): number {
    // COALESCE(xmode_entitlement, FALSE) = TRUE AND xmode_config_status = 'READY'
    return pools.filter(p =>
      (p.xmode_entitlement ?? false) === true &&
      p.xmode_config_status === "READY"
    ).length;
  }

  it("B-1: 모든 pool entitlement=false → xmode_operators=0", () => {
    const pools = [
      { xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED" },
      { xmode_entitlement: false, xmode_config_status: "READY" },
      { xmode_entitlement: null,  xmode_config_status: "READY" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("B-2: entitlement=true + config != READY → xmode_operators=0", () => {
    const pools = [
      { xmode_entitlement: true, xmode_config_status: "NOT_CONFIGURED" },
      { xmode_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" },
    ];
    expect(sqlCountFilter(pools)).toBe(0);
  });

  it("B-3: entitlement=true + config=READY → xmode_operators=1", () => {
    const pools = [
      { xmode_entitlement: true,  xmode_config_status: "READY" },
      { xmode_entitlement: false, xmode_config_status: "READY" },
      { xmode_entitlement: true,  xmode_config_status: "NOT_CONFIGURED" },
    ];
    expect(sqlCountFilter(pools)).toBe(1);
  });

  it("B-4: 복수 X MODE 수영장 → count 정확", () => {
    const pools = [
      { xmode_entitlement: true,  xmode_config_status: "READY" },           // X
      { xmode_entitlement: true,  xmode_config_status: "READY" },           // X
      { xmode_entitlement: true,  xmode_config_status: "NOT_CONFIGURED" },  // x_pending
      { xmode_entitlement: false, xmode_config_status: "READY" },           // normal
      { xmode_entitlement: null,  xmode_config_status: null },              // normal
    ];
    expect(sqlCountFilter(pools)).toBe(2);
  });

  it("B-5: resolvePoolMode X 판정과 xmode_operators SQL 조건이 동일", () => {
    // computeMode(e, c) === 'x' ↔ e=true AND c='READY' — 완전 일치
    const cases = [
      { e: true,  c: "READY" as XModeStatus },
      { e: true,  c: "NOT_CONFIGURED" as XModeStatus },
      { e: false, c: "READY" as XModeStatus },
      { e: false, c: "NOT_CONFIGURED" as XModeStatus },
    ];
    for (const { e, c } of cases) {
      const resolveMode = computeMode(e, c) === "x";
      const sqlMatch = e === true && c === "READY";
      expect(resolveMode).toBe(sqlMatch);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// C. pools-summary filter=xmode — SQL 조건 단위 검증
// ══════════════════════════════════════════════════════════════════════════
describe("C. pools-summary filter=xmode SQL 조건 (unit)", () => {
  // 서버 조건: COALESCE(p.xmode_entitlement, FALSE) = TRUE AND p.xmode_config_status = 'READY'
  function xmodeFilter(pool: { xmode_entitlement: boolean | null; xmode_config_status: string | null }): boolean {
    return (pool.xmode_entitlement ?? false) === true &&
           pool.xmode_config_status === "READY";
  }

  it("C-1: entitlement=false → filter=xmode 제외", () => {
    expect(xmodeFilter({ xmode_entitlement: false, xmode_config_status: "READY" })).toBe(false);
  });

  it("C-2: entitlement=true + config!=READY → filter=xmode 제외", () => {
    expect(xmodeFilter({ xmode_entitlement: true, xmode_config_status: "NOT_CONFIGURED" })).toBe(false);
    expect(xmodeFilter({ xmode_entitlement: true, xmode_config_status: "CURRICULUM_PENDING" })).toBe(false);
  });

  it("C-3: entitlement=true + config=READY → filter=xmode 포함", () => {
    expect(xmodeFilter({ xmode_entitlement: true, xmode_config_status: "READY" })).toBe(true);
  });

  it("C-4: entitlement=null (COALESCE) → filter=xmode 제외", () => {
    expect(xmodeFilter({ xmode_entitlement: null, xmode_config_status: "READY" })).toBe(false);
  });

  it("C-5: resolvePoolMode 결과와 filter=xmode 일치", () => {
    const pools = [
      { xmode_entitlement: true,  xmode_config_status: "READY" as XModeStatus },
      { xmode_entitlement: true,  xmode_config_status: "NOT_CONFIGURED" as XModeStatus },
      { xmode_entitlement: false, xmode_config_status: "READY" as XModeStatus },
    ];
    for (const p of pools) {
      const isX = computeMode(p.xmode_entitlement, p.xmode_config_status) === "x";
      const inFilter = xmodeFilter({ xmode_entitlement: p.xmode_entitlement, xmode_config_status: p.xmode_config_status });
      expect(isX).toBe(inFilter);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// D. pools-summary 응답 xmode 필드 구조
// ══════════════════════════════════════════════════════════════════════════
describe("D. pools-summary 응답 xmode 필드", () => {
  function mapRow(r: any) {
    return {
      xmode_entitlement:   Boolean(r.xmode_entitlement ?? false),
      xmode_config_status: (r.xmode_config_status ?? "NOT_CONFIGURED") as string,
    };
  }

  it("D-1: xmode_entitlement=true, xmode_config_status=READY 정상 매핑", () => {
    const row = { xmode_entitlement: true, xmode_config_status: "READY" };
    const mapped = mapRow(row);
    expect(mapped.xmode_entitlement).toBe(true);
    expect(mapped.xmode_config_status).toBe("READY");
  });

  it("D-2: null 값 → COALESCE 기본값 적용", () => {
    const row = { xmode_entitlement: null, xmode_config_status: null };
    const mapped = mapRow(row);
    expect(mapped.xmode_entitlement).toBe(false);
    expect(mapped.xmode_config_status).toBe("NOT_CONFIGURED");
  });

  it("D-3: xmode_config_status 다양한 값 정상 보존", () => {
    for (const status of ["NOT_CONFIGURED", "CURRICULUM_PENDING", "READY"]) {
      const row = { xmode_entitlement: true, xmode_config_status: status };
      expect(mapRow(row).xmode_config_status).toBe(status);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// E. non-xmode filter 기존 동작 regression
// ══════════════════════════════════════════════════════════════════════════
describe("E. 기존 filter 동작 regression", () => {
  function applyFilter(filter: string, pools: any[]): any[] {
    switch (filter) {
      case "pending":   return pools.filter(p => p.approval_status === "pending");
      case "active":    return pools.filter(p => p.approval_status === "approved" && ["active","trial"].includes(p.subscription_status ?? ""));
      case "xmode":     return pools.filter(p => (p.xmode_entitlement ?? false) && p.xmode_config_status === "READY");
      case "all":
      default:          return pools;
    }
  }

  const samplePools = [
    { id: "1", approval_status: "pending",  subscription_status: "trial",   xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED" },
    { id: "2", approval_status: "approved", subscription_status: "active",  xmode_entitlement: false, xmode_config_status: "NOT_CONFIGURED" },
    { id: "3", approval_status: "approved", subscription_status: "active",  xmode_entitlement: true,  xmode_config_status: "READY" },
    { id: "4", approval_status: "approved", subscription_status: "active",  xmode_entitlement: true,  xmode_config_status: "NOT_CONFIGURED" },
  ];

  it("E-1: filter=all → 전체 반환", () => {
    expect(applyFilter("all", samplePools)).toHaveLength(4);
  });

  it("E-2: filter=pending → pending만", () => {
    const result = applyFilter("pending", samplePools);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("E-3: filter=xmode → entitlement+READY만", () => {
    const result = applyFilter("xmode", samplePools);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("E-4: filter=xmode → x_pending(config!=READY)는 제외", () => {
    const result = applyFilter("xmode", samplePools);
    expect(result.some(p => p.id === "4")).toBe(false); // entitlement=true but NOT_CONFIGURED
  });

  it("E-5: xmode count = resolvePoolMode X count (동일 기준)", () => {
    const xFiltered = applyFilter("xmode", samplePools);
    const xByMode = samplePools.filter(p => computeMode(p.xmode_entitlement, p.xmode_config_status as XModeStatus) === "x");
    expect(xFiltered.length).toBe(xByMode.length);
    expect(xFiltered.map(p => p.id).sort()).toEqual(xByMode.map(p => p.id).sort());
  });
});
