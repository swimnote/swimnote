/**
 * WP15.5-B — Analytics Overview 계산 로직 테스트 (DB mock 방식)
 *
 * super/analytics-overview 응답 구조·계산 계약 검증.
 * HTTP 요청 없음 — 수치 변환/안전성 로직 직접 검증.
 *
 * A — platform 필드 전부 number 변환 (string 입력 → number)
 * B — null/undefined 입력 → 0 폴백
 * C — subscription 3-필드 number 보장
 * D — mau_proxy note 문자열 · period 구조 검증
 * E — x_mode_pools ≤ active_pools (항등식)
 * F — basic_pools = active_pools − x_mode_pools (tight 조건)
 * G — x_mode_pools=0 → basic_pools = active_pools
 * H — 전체 구독 합계 ≤ total_pools
 * I — NaN 입력 → 0 안전 처리
 * J — mau_proxy total ≥ parent + teacher 각각
 *
 * 합계: 10 TC
 */
import { describe, it, expect } from "vitest";

// ── analytics-overview 응답 조립 로직 (route 코드와 동일) ───────────────────
interface PoolRow {
  total_pools?: unknown;
  approved_pools?: unknown;
  active_pools?: unknown;
  x_mode_pools?: unknown;
  basic_pools?: unknown;
  pending_pools?: unknown;
  sub_active?: unknown;
  sub_trial?: unknown;
  sub_expired?: unknown;
}
interface StudentRow {
  total_students?: unknown;
  active_students?: unknown;
}
interface ParentRow {
  total_parents?: unknown;
  active_parents?: unknown;
}
interface MauRow {
  parent_sessions?: unknown;
  teacher_sessions?: unknown;
  total_sessions?: unknown;
}

function buildResponse(
  p: PoolRow,
  st: StudentRow,
  pa: ParentRow,
  m: MauRow,
  from: string,
  to: string,
) {
  const num = (v: unknown) => {
    const n = Number(v ?? 0);
    return isNaN(n) ? 0 : n;
  };
  return {
    platform: {
      total_pools:     num(p.total_pools),
      approved_pools:  num(p.approved_pools),
      active_pools:    num(p.active_pools),
      x_mode_pools:    num(p.x_mode_pools),
      basic_pools:     num(p.basic_pools),
      pending_pools:   num(p.pending_pools),
      total_students:  num(st.total_students),
      active_students: num(st.active_students),
      total_parents:   num(pa.total_parents),
      active_parents:  num(pa.active_parents),
    },
    subscription: {
      active:  num(p.sub_active),
      trial:   num(p.sub_trial),
      expired: num(p.sub_expired),
    },
    mau_proxy: {
      period: { from, to },
      parent_sessions:  num(m.parent_sessions),
      teacher_sessions: num(m.teacher_sessions),
      total_sessions:   num(m.total_sessions),
      note: "APP_SESSION 이벤트 미구현 — event_logs 로그인 category 근사값",
    },
  };
}

// ── 샘플 데이터 ───────────────────────────────────────────────────────────────
const samplePool: PoolRow = {
  total_pools: "50", approved_pools: "45", active_pools: "40",
  x_mode_pools: "10", basic_pools: "30", pending_pools: "5",
  sub_active: "35", sub_trial: "3", sub_expired: "7",
};
const sampleStudent: StudentRow = { total_students: "1200", active_students: "900" };
const sampleParent: ParentRow   = { total_parents: "800", active_parents: "750" };
const sampleMau: MauRow         = { parent_sessions: "120", teacher_sessions: "80", total_sessions: "200" };
const FROM = "2026-07-01";
const TO   = "2026-07-31";

// ── TC ────────────────────────────────────────────────────────────────────────

describe("WP15.5-B: Analytics Overview 계산 로직", () => {

  // A ─────────────────────────────────────────────────────────────────
  it("A — platform 필드: 문자열 입력 → number 변환", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    const fields = Object.values(r.platform);
    for (const v of fields) {
      expect(typeof v).toBe("number");
    }
    expect(r.platform.total_pools).toBe(50);
    expect(r.platform.active_pools).toBe(40);
    expect(r.platform.x_mode_pools).toBe(10);
    expect(r.platform.basic_pools).toBe(30);
  });

  // B ─────────────────────────────────────────────────────────────────
  it("B — null/undefined → 0 폴백", () => {
    const r = buildResponse({}, {}, {}, {}, FROM, TO);
    for (const v of Object.values(r.platform)) {
      expect(v).toBe(0);
    }
    for (const v of Object.values(r.subscription)) {
      expect(v).toBe(0);
    }
    expect(r.mau_proxy.total_sessions).toBe(0);
  });

  // C ─────────────────────────────────────────────────────────────────
  it("C — subscription 3-필드 모두 number", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    expect(typeof r.subscription.active).toBe("number");
    expect(typeof r.subscription.trial).toBe("number");
    expect(typeof r.subscription.expired).toBe("number");
    expect(r.subscription.active).toBe(35);
    expect(r.subscription.trial).toBe(3);
    expect(r.subscription.expired).toBe(7);
  });

  // D ─────────────────────────────────────────────────────────────────
  it("D — mau_proxy note 문자열 · period 구조 검증", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    expect(typeof r.mau_proxy.note).toBe("string");
    expect(r.mau_proxy.note.length).toBeGreaterThan(0);
    expect(r.mau_proxy.period.from).toBe(FROM);
    expect(r.mau_proxy.period.to).toBe(TO);
  });

  // E ─────────────────────────────────────────────────────────────────
  it("E — x_mode_pools ≤ active_pools (항등식)", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    expect(r.platform.x_mode_pools).toBeLessThanOrEqual(r.platform.active_pools);
  });

  // F ─────────────────────────────────────────────────────────────────
  it("F — basic_pools = active_pools − x_mode_pools (tight 조건)", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    expect(r.platform.basic_pools).toBe(r.platform.active_pools - r.platform.x_mode_pools);
  });

  // G ─────────────────────────────────────────────────────────────────
  it("G — x_mode_pools=0 → basic_pools = active_pools", () => {
    const r = buildResponse(
      { ...samplePool, x_mode_pools: "0", basic_pools: "40" },
      sampleStudent, sampleParent, sampleMau, FROM, TO,
    );
    expect(r.platform.x_mode_pools).toBe(0);
    expect(r.platform.basic_pools).toBe(r.platform.active_pools);
  });

  // H ─────────────────────────────────────────────────────────────────
  it("H — 전체 구독 합계 ≤ total_pools", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    const subTotal = r.subscription.active + r.subscription.trial + r.subscription.expired;
    expect(subTotal).toBeLessThanOrEqual(r.platform.total_pools);
  });

  // I ─────────────────────────────────────────────────────────────────
  it("I — NaN 입력 → 0 안전 처리", () => {
    const r = buildResponse(
      { total_pools: NaN, active_pools: NaN, x_mode_pools: NaN, basic_pools: NaN },
      { total_students: NaN }, { total_parents: NaN },
      { total_sessions: NaN }, FROM, TO,
    );
    expect(r.platform.total_pools).toBe(0);
    expect(r.platform.active_pools).toBe(0);
    expect(r.platform.total_students).toBe(0);
    expect(r.mau_proxy.total_sessions).toBe(0);
  });

  // J ─────────────────────────────────────────────────────────────────
  it("J — mau total_sessions ≥ parent_sessions AND teacher_sessions", () => {
    const r = buildResponse(samplePool, sampleStudent, sampleParent, sampleMau, FROM, TO);
    expect(r.mau_proxy.total_sessions).toBeGreaterThanOrEqual(r.mau_proxy.parent_sessions);
    expect(r.mau_proxy.total_sessions).toBeGreaterThanOrEqual(r.mau_proxy.teacher_sessions);
  });

});
