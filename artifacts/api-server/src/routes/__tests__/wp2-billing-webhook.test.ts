// wp2-billing-webhook.test.ts -- WP2 RevenueCat X Entitlement Sync
//
// X02-B2 업데이트:
//   - handleXEntitlementEvent → x_paid_entitlement만 수정
//   - mock pool row → x_paid_entitlement / x_manual_entitlement / x_force_disabled
//   - effective = (paid OR manual) AND NOT force
//   - collision 시나리오: EXPIRATION + manual=true → effective 유지, audit 없음
//
// 검증 대상:
//   A. isXProduct() -- env 기반 X product 판정
//   B. handleXEntitlementEvent() -- X 이벤트별 DB call count + 상태 분기
//   C. 일반 구독 regression -- isXProduct separation
//   D. X02-B2 collision tests

import { describe, it, expect, vi, beforeEach } from "vitest";

// @workspace/db mock: superAdminDb.execute를 vi.fn()으로 교체
vi.mock("@workspace/db", () => {
  const mockExecute = vi.fn();
  return {
    superAdminDb: { execute: mockExecute },
    db:           { execute: mockExecute },
  };
});

import { superAdminDb } from "@workspace/db";
import {
  isXProduct,
  handleXEntitlementEvent,
} from "../../lib/x-entitlement.js";

const mockExecute = superAdminDb.execute as ReturnType<typeof vi.fn>;

// ── 환경변수 헬퍼 ──────────────────────────────────────────────────────────
function withXProducts(ids: string, fn: () => void) {
  const prev = process.env.REVENUECAT_X_PRODUCT_IDS;
  process.env.REVENUECAT_X_PRODUCT_IDS = ids;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.REVENUECAT_X_PRODUCT_IDS;
    else process.env.REVENUECAT_X_PRODUCT_IDS = prev;
  }
}

// ── DB mock 헬퍼 (X02-B2: 새 컬럼 구조) ───────────────────────────────────
// handleXEntitlementEvent 호출 시 DB execute 순서:
//   1) SELECT pool (x_paid / x_manual / x_force + 기타 필드)
//   2) UPDATE (이벤트 처리)
//   3) SELECT next_audit_version (effective 변경 시만)
//   4) INSERT audit_logs (effective 변경 시만)
function mockPoolRow(overrides: Record<string, unknown> = {}) {
  return {
    // X02-B2: 새 소스 분리 컬럼
    x_paid_entitlement:    false,
    x_manual_entitlement:  false,
    x_force_disabled:      false,
    // 기타 필드
    xmode_config_status:       "NOT_CONFIGURED",
    xmode_purchased_at:        null,
    xmode_subscription_end_at: null,
    ...overrides,
  };
}

/** execute 호출마다 순서대로 반환값 설정 */
function setupResponses(responses: Array<{ rows: unknown[] }>) {
  let call = 0;
  mockExecute.mockImplementation(() =>
    Promise.resolve(responses[call++] ?? { rows: [] }),
  );
}

/** effective entitlement 변경이 있는 이벤트용 (4번 execute) */
function setupWithAudit(poolOverrides: Record<string, unknown> = {}) {
  setupResponses([
    { rows: [mockPoolRow(poolOverrides)] }, // SELECT pool
    { rows: [] },                           // UPDATE
    { rows: [{ v: 2 }] },                  // next_audit_version
    { rows: [] },                           // INSERT audit_logs
  ]);
}

/** effective entitlement 변경 없는 이벤트용 (2번 execute) */
function setupNoAudit(poolOverrides: Record<string, unknown> = {}) {
  setupResponses([
    { rows: [mockPoolRow(poolOverrides)] }, // SELECT pool
    { rows: [] },                           // UPDATE (or no-op)
  ]);
}

const BASE = {
  poolId:    "pool_test_001",
  appUserId: "user_test_001",
  productId: "swimnote_x_monthly",
  eventId:   "rc_event_abc123",
  expiresAt: "2026-12-31",
  isSandbox: false,
};

// ══════════════════════════════════════════════════════════════════════
// A. isXProduct() 단위 테스트 (pure function, DB 없음)
// ══════════════════════════════════════════════════════════════════════
describe("isXProduct()", () => {
  it("REVENUECAT_X_PRODUCT_IDS 미설정 -> 항상 false", () => {
    delete process.env.REVENUECAT_X_PRODUCT_IDS;
    expect(isXProduct("swimnote_x_monthly")).toBe(false);
    expect(isXProduct("center_200")).toBe(false);
  });

  it("설정된 product ID -> true", () => {
    withXProducts("swimnote_x_monthly,swimnote_x_monthly:monthly", () => {
      expect(isXProduct("swimnote_x_monthly")).toBe(true);
      expect(isXProduct("swimnote_x_monthly:monthly")).toBe(true);
    });
  });

  it("일반 center/solo product -> false (X 상품 아님)", () => {
    withXProducts("swimnote_x_monthly", () => {
      expect(isXProduct("center_200")).toBe(false);
      expect(isXProduct("solo_30")).toBe(false);
      expect(isXProduct("solo_100:monthly")).toBe(false);
      expect(isXProduct("swimnote_center_200")).toBe(false);
      expect(isXProduct("SWIMNOTE_200")).toBe(false);
      expect(isXProduct("coach_30")).toBe(false);
    });
  });

  it("빈 문자열 productId -> false", () => {
    withXProducts("swimnote_x_monthly", () => {
      expect(isXProduct("")).toBe(false);
    });
  });

  it("공백/쉼표 trim 처리", () => {
    withXProducts(" swimnote_x_monthly , ios_x_product ", () => {
      expect(isXProduct("swimnote_x_monthly")).toBe(true);
      expect(isXProduct("ios_x_product")).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// B. handleXEntitlementEvent() -- call count 기반 행위 검증
//    X02-B2: x_paid_entitlement 기반, effective 변경 시 audit
// ══════════════════════════════════════════════════════════════════════
describe("handleXEntitlementEvent()", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  // Test 1: X INITIAL_PURCHASE (paid=false → true): effective false→true, audit 4 calls
  it("X INITIAL_PURCHASE: paid false->true, effective 변경, audit 4 calls", async () => {
    setupWithAudit({ x_paid_entitlement: false, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 2: X RENEWAL (paid=true → true): effective 변경 없음, audit 없음 2 calls
  it("X RENEWAL: 이미 paid=true, effective 변경 없음, audit 없음 (2 calls)", async () => {
    setupNoAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "RENEWAL" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 3: X RENEWAL (paid=false → true): effective 변경, audit 4 calls
  it("X RENEWAL: paid false->true, effective 변경, audit 기록 (4 calls)", async () => {
    setupWithAudit({ x_paid_entitlement: false, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "RENEWAL" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 4: X UNCANCELLATION (paid=false → true): effective 변경, audit 4 calls
  it("X UNCANCELLATION: paid false->true, effective 변경, audit 기록 (4 calls)", async () => {
    setupWithAudit({ x_paid_entitlement: false, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "UNCANCELLATION" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 5: X CANCELLATION: paid 불변, effective 불변, audit 없음 (2 calls)
  it("X CANCELLATION: paid 불변, effective 변경 없음, audit 없음 (2 calls)", async () => {
    setupNoAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "CANCELLATION" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 6: X EXPIRATION (paid=true → false, manual=false): effective true→false, audit 4 calls
  it("X EXPIRATION: paid true->false, manual=false, effective 변경, audit 4 calls", async () => {
    setupWithAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "EXPIRATION" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 7: X REFUND (paid=true → false, manual=false): effective true→false, audit 4 calls
  it("X REFUND: paid true->false, manual=false, effective 변경, audit 4 calls", async () => {
    setupWithAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "REFUND" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 8: X BILLING_ISSUE: payment_failed_at만 기록, paid 불변, audit 없음 (2 calls)
  it("X BILLING_ISSUE: payment_failed_at 기록, paid 불변, audit 없음 (2 calls)", async () => {
    setupNoAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "BILLING_ISSUE" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 9: INITIAL_PURCHASE 재전송 (이미 paid=true): audit 없음 (2 calls)
  it("INITIAL_PURCHASE 재전송 (이미 paid=true): audit 없음 (2 calls)", async () => {
    setupNoAudit({
      x_paid_entitlement:  true,
      x_manual_entitlement: false,
      xmode_purchased_at:  "2026-01-01T00:00:00.000Z",
    });
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 10: pool 없음 → early return (SELECT 1회 후 즉시 종료)
  it("pool 없음 -> early return (1 call)", async () => {
    setupResponses([{ rows: [] }]);
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  // Test 11: TRANSFER → log-only, SELECT 1회 (no UPDATE)
  it("TRANSFER: log-only, SELECT 후 return (1 call, no UPDATE)", async () => {
    setupResponses([
      { rows: [mockPoolRow({ x_paid_entitlement: true })] },
    ]);
    await handleXEntitlementEvent({ ...BASE, eventType: "TRANSFER" });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════
// C. 일반 구독 regression -- isXProduct separation
// ══════════════════════════════════════════════════════════════════════
describe("일반 구독 X 상태 독립 보장", () => {
  it("X env 설정 시에도 일반 center/solo product는 isXProduct=false", () => {
    withXProducts("swimnote_x_monthly", () => {
      const normalIds = [
        "center_200", "center_300", "center_500", "center_1000",
        "solo_30", "solo_50", "solo_100",
        "center_200:monthly", "solo_30:monthly",
        "swimnote_solo_30", "swimnote_center_200",
        "swimnote_center_monthly", "center_monthly",
        "SWIMNOTE_200", "SWIMNOTE_30",
        "coach_30", "coach_50",
        // X02-B2 제품 목록
        "com.swimnote.x.monthly.tier1",
        "com.swimnote.x.monthly.tier2",
        "com.swimnote.x.monthly.tier3",
        "com.swimnote.x.monthly.standard",
      ];
      // X product IDs 목록에 없는 것들은 false여야 함
      for (const id of normalIds) {
        expect(isXProduct(id), `${id} should not be X product (env='swimnote_x_monthly')`).toBe(false);
      }
    });
  });

  it("X product ID 목록에 있는 것만 true", () => {
    const xIds = [
      "com.swimnote.x.monthly.tier1",
      "com.swimnote.x.monthly.tier2",
      "com.swimnote.x.monthly.tier3",
      "com.swimnote.x.monthly.standard",
    ];
    withXProducts(xIds.join(","), () => {
      for (const id of xIds) {
        expect(isXProduct(id), `${id} should be X product`).toBe(true);
      }
      expect(isXProduct("center_200")).toBe(false);
      expect(isXProduct("solo_30")).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// D. X02-B2 collision tests
//    paid / manual 동시 존재 시 충돌 없음 보장
// ══════════════════════════════════════════════════════════════════════
describe("X02-B2 collision tests", () => {
  beforeEach(() => { mockExecute.mockReset(); });

  // 시나리오 1: manual=true, paid=false → EXPIRATION(paid→false) → effective 유지
  it("시나리오 1: manual=true + EXPIRATION → paid=false, effective=true 유지, audit 없음 (2 calls)", async () => {
    // before: paid=false, manual=true → effective=true
    // EXPIRATION: paid=false(no change), manual=true → effective=true (변경 없음)
    setupNoAudit({ x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "EXPIRATION" });
    // effective 변경 없음 → audit 없음 → 2 calls (SELECT + UPDATE)
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // 시나리오 2: paid=true, manual=false → Super Admin OFF (manual API) = 별도 경로
  //   이 테스트에서는 EXPIRATION(paid→false)이 manual에 영향 없음을 확인
  it("시나리오 2: paid=true + REFUND → paid=false, manual=false → effective false (audit 4 calls)", async () => {
    // before: paid=true, manual=false → effective=true
    // REFUND: paid=false, manual=false → effective=false (변경 있음)
    setupWithAudit({ x_paid_entitlement: true, x_manual_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "REFUND" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // 시나리오 3: paid=true + manual=true → REFUND → manual=true, effective=true 유지
  it("시나리오 3: paid=true + manual=true + REFUND → manual=true 유지, effective=true, audit 없음 (2 calls)", async () => {
    // before: paid=true, manual=true → effective=true
    // REFUND: paid=false, manual=true → effective=true (변경 없음)
    setupNoAudit({ x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "REFUND" });
    // effective 변경 없음 → audit 없음 → 2 calls
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // force_disabled=true → effective=false (force override)
  it("force_disabled=true → INITIAL_PURCHASE → paid=true이지만 effective=false (force), audit 없음 (2 calls)", async () => {
    // before: paid=false, manual=false, force=true → effective=false
    // INITIAL_PURCHASE: paid=true, force=true → effective=false (변경 없음)
    setupNoAudit({ x_paid_entitlement: false, x_manual_entitlement: false, x_force_disabled: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    // effective 변경 없음 (force=true로 override) → audit 없음 → 2 calls
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
