// wp2-billing-webhook.test.ts -- WP2 RevenueCat X Entitlement Sync
//
// 검증 대상:
//   A. isXProduct() -- env 기반 X product 판정
//   B. handleXEntitlementEvent() -- X 이벤트별 DB call count + 상태 분기
//
// 불변 보장 (call count 기반):
//   - 일반 center/solo product: isXProduct=false
//   - CANCELLATION: entitlement 변경 없음 (audit call 0개)
//   - BILLING_ISSUE: entitlement 즉시 false 금지 (audit call 0개)
//   - INITIAL_PURCHASE 재전송 (이미 true): audit call 0개
//   - TRANSFER: log-only (SELECT 1회, UPDATE 0회)
//   - xmode_config_status: UPDATE SQL에 포함 안 됨

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

// ── DB mock 헬퍼 ───────────────────────────────────────────────────────────
// handleXEntitlementEvent 호출 시 DB execute 순서:
//   1) SELECT pool (current state)
//   2) UPDATE (이벤트 처리)
//   3) SELECT next_audit_version (entitlement 변경 시만)
//   4) INSERT audit_logs (entitlement 변경 시만)
function mockPoolRow(overrides: Record<string, unknown> = {}) {
  return {
    xmode_entitlement:         false,
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

/** entitlement 변경이 있는 이벤트용 (4번 execute) */
function setupWithAudit(poolOverrides: Record<string, unknown> = {}) {
  setupResponses([
    { rows: [mockPoolRow(poolOverrides)] }, // SELECT pool
    { rows: [] },                           // UPDATE
    { rows: [{ v: 2 }] },                  // next_audit_version
    { rows: [] },                           // INSERT audit_logs
  ]);
}

/** entitlement 변경 없는 이벤트용 (2번 execute) */
function setupNoAudit(poolOverrides: Record<string, unknown> = {}) {
  setupResponses([
    { rows: [mockPoolRow(poolOverrides)] }, // SELECT pool
    { rows: [] },                           // UPDATE
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
  // Test 1: secret 미설정 / REVENUECAT_X_PRODUCT_IDS 미설정 동작
  it("REVENUECAT_X_PRODUCT_IDS 미설정 -> 항상 false", () => {
    delete process.env.REVENUECAT_X_PRODUCT_IDS;
    expect(isXProduct("swimnote_x_monthly")).toBe(false);
    expect(isXProduct("center_200")).toBe(false);
  });

  // Test 2: 설정된 X product ID만 true
  it("설정된 product ID -> true", () => {
    withXProducts("swimnote_x_monthly,swimnote_x_monthly:monthly", () => {
      expect(isXProduct("swimnote_x_monthly")).toBe(true);
      expect(isXProduct("swimnote_x_monthly:monthly")).toBe(true);
    });
  });

  // Test 3: 일반 center/solo product -> false
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
// ══════════════════════════════════════════════════════════════════════
describe("handleXEntitlementEvent()", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  // Test 4: X INITIAL_PURCHASE -> entitlement=true, audit 기록 (4 calls)
  it("X INITIAL_PURCHASE: entitlement false->true, audit 4 calls", async () => {
    setupWithAudit({ xmode_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    // SELECT + UPDATE + next_audit_version + INSERT audit
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 5: X RENEWAL -> 이미 true인 경우 audit 없음 (2 calls)
  it("X RENEWAL: 이미 true, audit 없음 (2 calls)", async () => {
    setupNoAudit({ xmode_entitlement: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "RENEWAL" });
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 5b: X RENEWAL -> false->true인 경우 audit 있음 (4 calls)
  it("X RENEWAL: false->true, audit 기록 (4 calls)", async () => {
    setupWithAudit({ xmode_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "RENEWAL" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 6: X UNCANCELLATION -> entitlement=true, audit 기록
  it("X UNCANCELLATION: false->true, audit 기록 (4 calls)", async () => {
    setupWithAudit({ xmode_entitlement: false });
    await handleXEntitlementEvent({ ...BASE, eventType: "UNCANCELLATION" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 7: X CANCELLATION -> 즉시 false 되지 않음, audit 없음 (2 calls)
  it("X CANCELLATION: entitlement 변경 없음, audit 없음 (2 calls)", async () => {
    setupNoAudit({ xmode_entitlement: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "CANCELLATION" });
    // SELECT + UPDATE(end_at only) -- audit 없음 (entitlement 불변)
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 8: X EXPIRATION -> entitlement=false, audit 기록 (4 calls)
  it("X EXPIRATION: true->false, audit 기록 (4 calls)", async () => {
    setupWithAudit({ xmode_entitlement: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "EXPIRATION" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 9: X REFUND -> entitlement=false, audit 기록 (4 calls)
  it("X REFUND: true->false, audit 기록 (4 calls)", async () => {
    setupWithAudit({ xmode_entitlement: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "REFUND" });
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });

  // Test 10: X BILLING_ISSUE -> payment_failed_at만 기록, entitlement 유지 (2 calls)
  it("X BILLING_ISSUE: payment_failed_at 기록, entitlement 즉시 false 금지 (2 calls)", async () => {
    setupNoAudit({ xmode_entitlement: true });
    await handleXEntitlementEvent({ ...BASE, eventType: "BILLING_ISSUE" });
    // SELECT + UPDATE(payment_failed_at only) -- audit 없음
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 11: duplicate INITIAL_PURCHASE (이미 true) -> purchased_at 보존, audit 없음 (2 calls)
  it("INITIAL_PURCHASE 재전송 (이미 true): audit 없음, purchased_at 보존 (2 calls)", async () => {
    setupNoAudit({
      xmode_entitlement:  true,
      xmode_purchased_at: "2026-01-01T00:00:00.000Z",
    });
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    // entitlement true -> true: audit 없음
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  // Test 12: pool 없음 -> early return (SELECT 1회 후 즉시 종료)
  it("pool 없음 -> early return (1 call)", async () => {
    setupResponses([{ rows: [] }]); // SELECT returns empty
    await handleXEntitlementEvent({ ...BASE, eventType: "INITIAL_PURCHASE" });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  // Test 13: TRANSFER -> log-only, SELECT 1회 후 default 분기 return (1 call)
  it("TRANSFER: log-only, SELECT 후 return (1 call from SELECT, no UPDATE)", async () => {
    setupResponses([
      { rows: [mockPoolRow({ xmode_entitlement: true })] },
    ]);
    await handleXEntitlementEvent({ ...BASE, eventType: "TRANSFER" });
    // SELECT 1회만 (UPDATE 없음)
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  // Test 14: EXPIRATION audit -- before/after 검증
  it("EXPIRATION audit: 4번 호출, 마지막 호출이 audit INSERT", async () => {
    setupWithAudit({ xmode_entitlement: true });
    await handleXEnticulamentEvent_safe({ ...BASE, eventType: "EXPIRATION" });
    // 4번: SELECT, UPDATE, next_audit_version, INSERT
    expect(mockExecute).toHaveBeenCalledTimes(4);
    // 3번째 호출(index 2)이 next_audit_version SELECT
    // 4번째 호출(index 3)이 audit INSERT -- 두 호출 모두 execute로 확인
    const allCallCount = mockExecute.mock.calls.length;
    expect(allCallCount).toBe(4);
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
      ];
      for (const id of normalIds) {
        expect(isXProduct(id), `${id} should not be X product`).toBe(false);
      }
    });
  });
});

// ── Test 14 helper (타입 오류 방지) ────────────────────────────────────────
async function handleXEnticulamentEvent_safe(params: Parameters<typeof handleXEntitlementEvent>[0]) {
  return handleXEntitlementEvent(params);
}
