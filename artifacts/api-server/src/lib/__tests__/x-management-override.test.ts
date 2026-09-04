/**
 * x-management-override.test.ts
 *
 * Super Admin Management Override — computeMode() 동작 검증
 *
 * 테스트 케이스:
 *  A. override=true, paid=false, manual=false → mode="x" (override 최우선)
 *  B. override=true, config=CURRICULUM_PENDING → mode="x" (config status 무시)
 *  C. override=true, force_disabled=true → mode="x" (force_disabled 무시)
 *  D. override=true, paid=false, manual=false (RC expired 시뮬) → mode="x"
 *  E. override=false → 기존 resolver 사용 (manual=true + READY → "x")
 *  F. override=false → 기존 resolver 사용 (manual=true + CURRICULUM_PENDING → "x_pending")
 *  G. override=false, force_disabled=true → mode="normal" (기존 동작 유지)
 *  H. 다른 pool: override=false (default) → override 영향 없음
 *  I. override=true, plan_key=x1000 → mode="x" (plan_key는 별도, mode는 항상 "x")
 *  J. override=undefined (backward compat) → 기존 resolver 사용
 */

import { describe, it, expect } from "vitest";
import { computeMode } from "../xmode.js";

// ── 공통 base ────────────────────────────────────────────────────────────────
const BASE = {
  x_paid_entitlement:   false,
  x_manual_entitlement: false,
  x_force_disabled:     false,
  xmode_config_status:  "CURRICULUM_PENDING" as const,
  x_management_override: false,
};

describe("computeMode — Management Override", () => {
  // A. override=true, paid=false, manual=false → "x"
  it("A: override=true, no entitlement → mode=x (override 최우선)", () => {
    expect(computeMode({ ...BASE, x_management_override: true })).toBe("x");
  });

  // B. override=true + CURRICULUM_PENDING → "x" (config status 무시)
  it("B: override=true, config=CURRICULUM_PENDING → mode=x", () => {
    expect(computeMode({
      ...BASE,
      xmode_config_status: "CURRICULUM_PENDING",
      x_management_override: true,
    })).toBe("x");
  });

  // C. override=true + force_disabled=true → "x" (force_disabled 무시)
  it("C: override=true, force_disabled=true → mode=x (force_disabled 무시)", () => {
    expect(computeMode({
      ...BASE,
      x_force_disabled: true,
      x_management_override: true,
    })).toBe("x");
  });

  // D. override=true, RC expired 시뮬 (paid=false, manual=false) → "x"
  it("D: override=true, RC expired → mode=x", () => {
    expect(computeMode({
      ...BASE,
      x_paid_entitlement:  false,
      x_manual_entitlement: false,
      subscription_tier:   "x1000",
      subscription_status: "expired",
      x_management_override: true,
    })).toBe("x");
  });

  // E. override=false, manual=true, READY → "x" (기존 동작 유지)
  it("E: override=false, manual=true, READY → mode=x (기존 동작)", () => {
    expect(computeMode({
      ...BASE,
      x_manual_entitlement: true,
      xmode_config_status: "READY",
      x_management_override: false,
    })).toBe("x");
  });

  // F. override=false, manual=true, CURRICULUM_PENDING → "x_pending" (기존 동작)
  it("F: override=false, manual=true, CURRICULUM_PENDING → mode=x_pending", () => {
    expect(computeMode({
      ...BASE,
      x_manual_entitlement: true,
      xmode_config_status: "CURRICULUM_PENDING",
      x_management_override: false,
    })).toBe("x_pending");
  });

  // G. override=false, force_disabled=true → "normal" (기존 동작 유지)
  it("G: override=false, force_disabled=true → mode=normal", () => {
    expect(computeMode({
      ...BASE,
      x_force_disabled: true,
      x_management_override: false,
    })).toBe("normal");
  });

  // H. 다른 pool (override=false default) → override 영향 없음
  it("H: override=false (normal pool) → 기존 resolver 결과", () => {
    expect(computeMode({ ...BASE })).toBe("normal");
  });

  // I. override=true → mode="x" (planKey/memberLimit은 별도 처리, mode만 판정)
  it("I: override=true → mode=x regardless of plan_key context", () => {
    expect(computeMode({
      ...BASE,
      x_management_override: true,
    })).toBe("x");
  });

  // J. override=undefined (backward compat — 기존 호출부 영향 없음)
  it("J: override=undefined (backward compat) → 기존 resolver 사용", () => {
    expect(computeMode({
      x_paid_entitlement:   false,
      x_manual_entitlement: false,
      x_force_disabled:     false,
      xmode_config_status:  "READY",
      // x_management_override 미전달
    })).toBe("normal");
  });

  // 추가: override=true는 subscription_required도 건너뜀
  it("K: override=true, subscription expired (subscription_required 조건) → mode=x", () => {
    expect(computeMode({
      ...BASE,
      x_management_override: true,
      subscription_tier:     "swimnote",
      subscription_status:   "expired",
    })).toBe("x");
  });
});
