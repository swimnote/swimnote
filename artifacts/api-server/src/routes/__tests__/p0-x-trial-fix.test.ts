// p0-x-trial-fix.test.ts — P0 X Trial 모드 전환 버그 수정 테스트
//
// Root cause: DB는 올바르게 기록되나 client refreshMode() 가 isRefreshingRef lock으로
//             silently no-op 반환 → mode 업데이트 없음
// Fix: ModeContext.forceRefreshMode() — lock 해제 + seqRef 증가 + 즉시 새 fetch
//
// 서버 순수 함수 테스트 (computeMode — DB 없음):
//   R6. x_trial_ends_at > NOW → computeMode = x_trial
//   R7. x_trial_ends_at ≤ NOW → computeMode = normal (trial 만료 복귀)
//   R8. x_paid_entitlement = true + trial active → x (paid 우선)
//   R9. x_force_disabled = true + trial active → normal
//   R10. x_management_override → x (최우선, trial 무시)
//   R11. x_trial_started_at null → trial 분기 건너뜀
//   R12. x_trial_ends_at null → trial 분기 건너뜀
//   R13. payment_suspended pool + active trial → x_trial (trial > subscription_required)
//   R14. SWIMNOTE active + trial → x_trial (trial 분기는 paid/manual 다음, sub_required 앞)

import { describe, it, expect } from "vitest";
import { computeMode } from "../../lib/xmode.js";

const basePool = {
  x_paid_entitlement:    false,
  x_manual_entitlement:  false,
  x_force_disabled:      false,
  xmode_config_status:   "READY" as const,
  x_management_override: false,
  subscription_tier:     null as string | null,
  subscription_status:   null as string | null,
  base_manual_entitlement: false,
};

const FUTURE_72H = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
const PAST_1H    = new Date(Date.now() - 3600 * 1000).toISOString();
const NOW_STR    = new Date().toISOString();

describe("computeMode — x_trial 우선순위 및 lazy expiration", () => {
  it("R6: x_trial_ends_at > NOW → x_trial", () => {
    expect(computeMode({
      ...basePool,
      x_trial_started_at: NOW_STR,
      x_trial_ends_at:    FUTURE_72H,
    })).toBe("x_trial");
  });

  it("R7: x_trial_ends_at ≤ NOW → normal (trial 만료 복귀)", () => {
    expect(computeMode({
      ...basePool,
      x_trial_started_at: new Date(Date.now() - 73 * 3600 * 1000).toISOString(),
      x_trial_ends_at:    PAST_1H,
    })).toBe("normal");
  });

  it("R8: paid X + active trial → x (paid 우선순위 > trial)", () => {
    expect(computeMode({
      ...basePool,
      x_paid_entitlement: true,
      x_trial_started_at: NOW_STR,
      x_trial_ends_at:    FUTURE_72H,
    })).toBe("x"); // READY config → x
  });

  it("R9: x_force_disabled + active trial → normal (force 최우선 차단)", () => {
    expect(computeMode({
      ...basePool,
      x_force_disabled:   true,
      x_trial_started_at: NOW_STR,
      x_trial_ends_at:    FUTURE_72H,
    })).toBe("normal");
  });

  it("R10: x_management_override + active trial → x (override 절대 우선)", () => {
    expect(computeMode({
      ...basePool,
      x_management_override: true,
      x_trial_started_at:    NOW_STR,
      x_trial_ends_at:       FUTURE_72H,
    })).toBe("x");
  });

  it("R11: x_trial_started_at null → trial 분기 건너뜀 → normal", () => {
    expect(computeMode({
      ...basePool,
      x_trial_started_at: null,
      x_trial_ends_at:    FUTURE_72H,
    })).toBe("normal");
  });

  it("R12: x_trial_ends_at null → trial 분기 건너뜀 → normal", () => {
    expect(computeMode({
      ...basePool,
      x_trial_started_at: NOW_STR,
      x_trial_ends_at:    null,
    })).toBe("normal");
  });

  it("R13: payment_suspended pool + active trial → x_trial (trial > subscription_required)", () => {
    // payment_suspended는 subscription_required 경로(NEW_2_TIERS + non-active)와 겹칠 수 있음.
    // 그러나 x_trial 분기가 subscription_required 보다 먼저 평가됨.
    expect(computeMode({
      ...basePool,
      x_trial_started_at:  NOW_STR,
      x_trial_ends_at:     FUTURE_72H,
      subscription_tier:   "swimnote",
      subscription_status: "payment_suspended",
    })).toBe("x_trial");
  });

  it("R14: SWIMNOTE active pool + no trial → normal (trial 시작 전)", () => {
    expect(computeMode({
      ...basePool,
      subscription_tier:   "swimnote",
      subscription_status: "active",
    })).toBe("normal");
  });

  it("R14b: SWIMNOTE active pool + active trial → x_trial", () => {
    expect(computeMode({
      ...basePool,
      subscription_tier:   "swimnote",
      subscription_status: "active",
      x_trial_started_at:  NOW_STR,
      x_trial_ends_at:     FUTURE_72H,
    })).toBe("x_trial");
  });

  it("manual X (NOT_CONFIGURED) + active trial → x_pending (manual 우선순위 > trial)", () => {
    expect(computeMode({
      ...basePool,
      x_manual_entitlement: true,
      xmode_config_status:  "NOT_CONFIGURED",
      x_trial_started_at:   NOW_STR,
      x_trial_ends_at:      FUTURE_72H,
    })).toBe("x_pending");
  });
});
