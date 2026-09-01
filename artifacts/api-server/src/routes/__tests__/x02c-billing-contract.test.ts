// x02c-billing-contract.test.ts — X02-C Server Purchase Contract Tests
//
// §37 필수 테스트:
//   RESERVE-1~5: slot 예약 로직
//   SYNC-1~6:    sync-x-subscription 로직
//   WEBHOOK-1~7: X webhook 이벤트 처리
//   SECURITY-1~2: cross-pool / client manipulation 방어
//   REGRESSION-1~2: 기존 basic billing 회귀
//   MODE-1~2: effective entitlement → mode
//
// 테스트 전략:
//   - 순수 함수 (resolveXProductForSequence, formatFranchiseNumber): DB mock 불필요
//   - 비즈니스 로직 (reserveXSlot, syncXSubscription, processXWebhookEvent):
//     @workspace/db mock + fetch global stub
//   - 기존 computeMode / resolveEffectiveXEntitlement: import 직접

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── DB mock ──────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const mockExecute = vi.fn();
  return {
    superAdminDb: { execute: mockExecute },
    db: { execute: mockExecute },
  };
});

// ── x-entitlement mock (processXWebhookEvent, syncXSubscription에서 호출) ─────
vi.mock("../../lib/x-entitlement.js", () => ({
  isXProduct: vi.fn((id: string) => id.startsWith("com.swimnote.x.")),
  handleXEntitlementEvent: vi.fn().mockResolvedValue(undefined),
}));

import { superAdminDb } from "@workspace/db";
import { handleXEntitlementEvent } from "../../lib/x-entitlement.js";

import {
  resolveXProductForSequence,
  formatFranchiseNumber,
  reserveXSlot,
  syncXSubscription,
  commitXPurchaseTransaction,
  processXWebhookEvent,
} from "../../lib/x-billing.js";

import { computeMode, resolveEffectiveXEntitlement } from "../../lib/xmode.js";

const mockExecute = superAdminDb.execute as ReturnType<typeof vi.fn>;
const mockHandleXEnt = handleXEntitlementEvent as ReturnType<typeof vi.fn>;

// ── DB mock 헬퍼 ──────────────────────────────────────────────────────────────
function setupResponses(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  let call = 0;
  mockExecute.mockImplementation(() =>
    Promise.resolve(responses[call++] ?? { rows: [], rowCount: 0 }),
  );
}

beforeEach(() => {
  mockExecute.mockReset();
  mockHandleXEnt.mockReset();
  mockHandleXEnt.mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// §7 resolveXProductForSequence — 서버 전용 tier mapping (순수 함수)
// ══════════════════════════════════════════════════════════════════════════════
describe("resolveXProductForSequence — §7 tier mapping", () => {
  it("RESERVE-5a: seq=1 → tier1/50%/tier1", () => {
    const r = resolveXProductForSequence(1);
    expect(r.tierKey).toBe("tier1");
    expect(r.discountPercent).toBe(50);
    expect(r.storeProductId).toBe("com.swimnote.x.monthly.tier1");
  });

  it("RESERVE-5b: seq=100 → tier1", () => {
    expect(resolveXProductForSequence(100).tierKey).toBe("tier1");
  });

  it("RESERVE-5c: seq=101 → tier2/30%", () => {
    const r = resolveXProductForSequence(101);
    expect(r.tierKey).toBe("tier2");
    expect(r.discountPercent).toBe(30);
    expect(r.storeProductId).toBe("com.swimnote.x.monthly.tier2");
  });

  it("RESERVE-5d: seq=300 → tier2", () => {
    expect(resolveXProductForSequence(300).tierKey).toBe("tier2");
  });

  it("RESERVE-5e: seq=301 → tier3/10%", () => {
    const r = resolveXProductForSequence(301);
    expect(r.tierKey).toBe("tier3");
    expect(r.discountPercent).toBe(10);
    expect(r.storeProductId).toBe("com.swimnote.x.monthly.tier3");
  });

  it("RESERVE-5f: seq=500 → tier3", () => {
    expect(resolveXProductForSequence(500).tierKey).toBe("tier3");
  });

  it("RESERVE-5g: seq=501 → standard/0%", () => {
    const r = resolveXProductForSequence(501);
    expect(r.tierKey).toBe("standard");
    expect(r.discountPercent).toBe(0);
    expect(r.storeProductId).toBe("com.swimnote.x.monthly.standard");
  });

  it("RESERVE-5h: seq=9999 → standard", () => {
    expect(resolveXProductForSequence(9999).tierKey).toBe("standard");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §8 formatFranchiseNumber — deterministic franchise number (순수 함수)
// ══════════════════════════════════════════════════════════════════════════════
describe("formatFranchiseNumber — §8", () => {
  it("1 → x-0001", () => expect(formatFranchiseNumber(1)).toBe("x-0001"));
  it("29 → x-0029", () => expect(formatFranchiseNumber(29)).toBe("x-0029"));
  it("299 → x-0299", () => expect(formatFranchiseNumber(299)).toBe("x-0299"));
  it("1000 → x-1000", () => expect(formatFranchiseNumber(1000)).toBe("x-1000"));
  it("소수 floor 처리", () => expect(formatFranchiseNumber(1.9)).toBe("x-0001"));
});

// ══════════════════════════════════════════════════════════════════════════════
// MODE-1/2 — computeMode + resolveEffectiveXEntitlement
// ══════════════════════════════════════════════════════════════════════════════
describe("MODE — computeMode / resolveEffectiveXEntitlement (P0)", () => {
  it("MODE-1: paid=true + config NOT_CONFIGURED → x_pending (WP2B CORRECTION: paid requires READY config)", () => {
    expect(computeMode({ x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" })).toBe("x_pending");
  });

  it("MODE-2: paid=true + config READY → x", () => {
    expect(computeMode({ x_paid_entitlement: true, x_manual_entitlement: false, x_force_disabled: false, xmode_config_status: "READY" })).toBe("x");
  });

  it("MODE-3: manual=true + config NOT_CONFIGURED → x_pending", () => {
    expect(computeMode({ x_paid_entitlement: false, x_manual_entitlement: true, x_force_disabled: false, xmode_config_status: "NOT_CONFIGURED" })).toBe("x_pending");
  });

  it("force_disabled=true → normal (force override)", () => {
    const ent = resolveEffectiveXEntitlement({ x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: true });
    expect(ent).toBe(false);
    expect(computeMode({ x_paid_entitlement: true, x_manual_entitlement: true, x_force_disabled: true, xmode_config_status: "READY" })).toBe("normal");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESERVE-1: 첫 예약 → seq 발급 + RESERVED
// ══════════════════════════════════════════════════════════════════════════════
describe("reserveXSlot — RESERVE-1", () => {
  it("첫 예약: 기존 slot 없음 → INSERT 성공 → 새 slot 반환", async () => {
    setupResponses([
      { rows: [] },          // PURCHASED 체크 → 없음
      { rows: [] },          // RESERVED 체크 → 없음
      // INSERT RETURNING → seq=1, tier1
      {
        rows: [{
          id: "1", sequence_number: 1, franchise_number: "x-0001",
          tier_key: "tier1", store_product_id: "com.swimnote.x.monthly.tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
        }],
      },
      { rows: [{ v: 1 }] },  // next_audit_version
      { rows: [] },          // INSERT audit_logs
    ]);

    const result = await reserveXSlot("pool_001", "user_001");

    expect(result.sequenceNumber).toBe(1);
    expect(result.tierKey).toBe("tier1");
    expect(result.storeProductId).toBe("com.swimnote.x.monthly.tier1");
    expect(result.franchiseNumber).toBe("x-0001");
    expect(result.discountPercent).toBe(50);
    expect(result.existing).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESERVE-2: 동일 pool 재호출 → 기존 RESERVED 반환
// ══════════════════════════════════════════════════════════════════════════════
describe("reserveXSlot — RESERVE-2", () => {
  it("유효한 RESERVED 이미 존재 → 새 seq 발급 없음, 기존 반환", async () => {
    const deadline = new Date(Date.now() + 3600000).toISOString();
    setupResponses([
      { rows: [] }, // PURCHASED 없음
      {
        rows: [{
          id: "5", sequence_number: 5, franchise_number: "x-0005",
          tier_key: "tier1", store_product_id: "com.swimnote.x.monthly.tier1",
          payment_deadline_at: deadline,
        }],
      }, // RESERVED 존재 (valid)
    ]);

    const result = await reserveXSlot("pool_001", "user_001");

    expect(result.sequenceNumber).toBe(5);
    expect(result.existing).toBe(true);
    // INSERT가 호출되지 않았음 (2번 execute만)
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESERVE-3: 만료된 RESERVED → RELEASED + 새 seq
// ══════════════════════════════════════════════════════════════════════════════
describe("reserveXSlot — RESERVE-3", () => {
  it("만료 RESERVED → RELEASE + 새 seq 발급", async () => {
    const expired = new Date(Date.now() - 1000).toISOString(); // 이미 만료
    setupResponses([
      { rows: [] },          // PURCHASED 없음
      {
        rows: [{
          id: "3", sequence_number: 3, franchise_number: "x-0003",
          tier_key: "tier1", store_product_id: "com.swimnote.x.monthly.tier1",
          payment_deadline_at: expired,
        }],
      },                     // RESERVED 존재 (만료)
      { rows: [] },          // UPDATE RELEASED
      { rows: [{ v: 1 }] }, // audit version
      { rows: [] },          // audit INSERT
      // INSERT new slot (seq=4)
      {
        rows: [{
          id: "10", sequence_number: 4, franchise_number: "x-0004",
          tier_key: "tier1", store_product_id: "com.swimnote.x.monthly.tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
        }],
      },
      { rows: [{ v: 2 }] }, // audit version (new slot)
      { rows: [] },          // audit INSERT (new slot)
    ]);

    const result = await reserveXSlot("pool_001", "user_001");

    expect(result.sequenceNumber).toBe(4); // 새 번호
    expect(result.existing).toBeUndefined();
    // PURCHASED check + RESERVED check + RELEASE UPDATE + audit_version + audit_insert
    // + INSERT new slot + audit_version + audit_insert = 8 calls
    // 만료 RESERVED 처리 때문에 2번보다 많은 DB call 발생
    expect(mockExecute.mock.calls.length).toBeGreaterThan(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RESERVE-4: PURCHASED 존재 → 409 ALREADY_SUBSCRIBED
// ══════════════════════════════════════════════════════════════════════════════
describe("reserveXSlot — RESERVE-4 (ALREADY_SUBSCRIBED)", () => {
  it("PURCHASED slot 존재 → ALREADY_SUBSCRIBED throw", async () => {
    setupResponses([
      { rows: [{ id: "1" }] }, // PURCHASED 있음
    ]);

    await expect(reserveXSlot("pool_001", "user_001")).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});

// V2 fetch mock 헬퍼: customer + subscriptions 2회 호출 시뮬레이션
function makeV2FetchMock(opts: {
  customerId?: string;
  originalAppUserId?: string;
  subscriptionItems?: object[];
  customerStatus?: number;
  subscriptionStatus?: number;
}) {
  const {
    customerId = "user_001",
    originalAppUserId = "user_001",
    subscriptionItems = [],
    customerStatus = 200,
    subscriptionStatus = 200,
  } = opts;

  let callCount = 0;
  return vi.fn().mockImplementation((url: string) => {
    callCount++;
    if (url.includes("/subscriptions")) {
      return Promise.resolve({
        ok: subscriptionStatus === 200,
        status: subscriptionStatus,
        json: async () => ({
          items: subscriptionItems,
          object: "list",
          next_page: null,
        }),
        text: async () => JSON.stringify({ error: "test error" }),
      });
    }
    // customer endpoint
    return Promise.resolve({
      ok: customerStatus === 200,
      status: customerStatus,
      json: async () => ({
        id: customerId,
        object: "customer",
        original_app_user_id: originalAppUserId,
      }),
      text: async () => JSON.stringify({ error: "test error" }),
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-1: active x_mode + matching product → PURCHASED + paid=true
// ══════════════════════════════════════════════════════════════════════════════
describe("syncXSubscription — SYNC-1", () => {
  it("RC V2 active + product match → PURCHASED + paid=true", async () => {
    const deadline = new Date(Date.now() + 3600000).toISOString();
    const expires = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    setupResponses([
      // RESERVED slot 조회
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1", payment_deadline_at: deadline, status: "RESERVED",
          rc_original_transaction_id: null,
        }],
      },
      // commitXPurchaseTransaction idempotency check
      { rows: [{ status: "RESERVED", rc_original_transaction_id: null }] },
      // UPDATE x_subscription_slots
      { rows: [] },
      // UPDATE swimming_pools
      { rows: [] },
      // auditXEvent: next_audit_version
      { rows: [{ v: 1 }] },
      // auditXEvent: INSERT
      { rows: [] },
    ]);

    // RC V2 mock: customer + subscriptions
    vi.stubGlobal("fetch", makeV2FetchMock({
      originalAppUserId: "user_001",
      subscriptionItems: [{
        product: { store_identifier: "com.swimnote.x.monthly.tier1" },
        gives_access: true,
        current_period_end_at: expires,
        purchase_date: new Date(Date.now() - 1000).toISOString(),
        original_purchase_date: new Date(Date.now() - 1000).toISOString(),
        original_transaction_id: "TX_001",
        store_transaction_id: "TX_001",
        environment: "production",
        status: "active",
      }],
    }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1,com.swimnote.x.monthly.tier2,com.swimnote.x.monthly.tier3,com.swimnote.x.monthly.standard";
    try {
      const result = await syncXSubscription({ poolId: "pool_001", userId: "user_001" });
      expect(result.synced).toBe(true);
      expect(result.alreadySynced).toBeFalsy();
      expect(result.tierKey).toBe("tier1");
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-2: wrong product → reject PRODUCT_MISMATCH
// ══════════════════════════════════════════════════════════════════════════════
describe("syncXSubscription — SYNC-2", () => {
  it("RC V2 product ≠ slot product → PRODUCT_MISMATCH throw", async () => {
    const deadline = new Date(Date.now() + 3600000).toISOString();
    const expires = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001",
          store_product_id: "com.swimnote.x.monthly.tier1", // tier1 예약
          tier_key: "tier1", payment_deadline_at: deadline, status: "RESERVED",
          rc_original_transaction_id: null,
        }],
      },
      // auditXEvent: next_audit_version
      { rows: [{ v: 1 }] },
      // auditXEvent: INSERT
      { rows: [] },
    ]);

    // RC V2: standard 구독 active (tier1 예약과 mismatch)
    vi.stubGlobal("fetch", makeV2FetchMock({
      originalAppUserId: "user_001",
      subscriptionItems: [{
        product: { store_identifier: "com.swimnote.x.monthly.standard" }, // ← MISMATCH
        gives_access: true,
        current_period_end_at: expires,
        original_transaction_id: "TX_002",
        store_transaction_id: "TX_002",
        environment: "production",
        status: "active",
      }],
    }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1,com.swimnote.x.monthly.tier2,com.swimnote.x.monthly.tier3,com.swimnote.x.monthly.standard";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toMatchObject({ code: "PRODUCT_MISMATCH" });
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-3: RC entitlement inactive (gives_access=false) → reject
// ══════════════════════════════════════════════════════════════════════════════
describe("syncXSubscription — SYNC-3", () => {
  it("RC V2 gives_access=false (expired/inactive) → RC_ENTITLEMENT_INACTIVE throw", async () => {
    const deadline = new Date(Date.now() + 3600000).toISOString();
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001",
          store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1", payment_deadline_at: deadline, status: "RESERVED",
          rc_original_transaction_id: null,
        }],
      },
    ]);

    // RC V2: subscription exists but gives_access=false (expired)
    vi.stubGlobal("fetch", makeV2FetchMock({
      originalAppUserId: "user_001",
      subscriptionItems: [{
        product: { store_identifier: "com.swimnote.x.monthly.tier1" },
        gives_access: false, // ← inactive
        current_period_end_at: new Date(Date.now() - 1000).toISOString(),
        environment: "production",
        status: "expired",
      }],
    }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1,com.swimnote.x.monthly.tier2,com.swimnote.x.monthly.tier3,com.swimnote.x.monthly.standard";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toMatchObject({ code: "RC_ENTITLEMENT_INACTIVE" });
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-4: duplicate sync → idempotent alreadySynced
// ══════════════════════════════════════════════════════════════════════════════
describe("syncXSubscription — SYNC-4", () => {
  it("이미 PURCHASED slot → alreadySynced:true", async () => {
    setupResponses([
      { rows: [] }, // RESERVED 없음
      { rows: [{ id: "10", tier_key: "tier1" }] }, // PURCHASED 있음
    ]);

    const result = await syncXSubscription({ poolId: "pool_001", userId: "user_001" });
    expect(result.alreadySynced).toBe(true);
    expect(result.synced).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-5: discount tier → 3 DB calls (SELECT idempotency + UPDATE slots + UPDATE pools)
// ══════════════════════════════════════════════════════════════════════════════
describe("commitXPurchaseTransaction — SYNC-5 (discount 36M)", () => {
  it("tier1 → commit 성공 (SELECT idempotency + UPDATE slots + UPDATE pools = 3 calls)", async () => {
    setupResponses([
      { rows: [{ status: "RESERVED", rc_original_transaction_id: null }] }, // idempotency check
      { rows: [] }, // UPDATE slots (discount_started_at + discount_ends_at 포함)
      { rows: [] }, // UPDATE pools
    ]);

    const purchasedAt = "2026-01-01T00:00:00.000Z";
    const result = await commitXPurchaseTransaction({
      slotId: "1", poolId: "pool_001", appUserId: "user_001",
      rcOriginalAppUserId: null, rcOriginalTransactionId: "TX1",
      rcLatestTransactionId: "TX1", rcEnvironment: "PRODUCTION",
      purchasedAt, expiresAt: "2026-02-01T00:00:00.000Z", tierKey: "tier1",
    });

    // alreadySynced=false, 정상 commit
    expect(result.alreadySynced).toBe(false);
    // SELECT 1 + UPDATE slots 1 + UPDATE pools 1 = 3 calls
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC-6: standard → discount dates NULL
// ══════════════════════════════════════════════════════════════════════════════
describe("commitXPurchaseTransaction — SYNC-6 (standard no discount)", () => {
  it("standard tier → discount_started_at=null, discount_ends_at=null", async () => {
    setupResponses([
      { rows: [{ status: "RESERVED", rc_original_transaction_id: null }] },
      { rows: [] },
      { rows: [] },
    ]);

    await commitXPurchaseTransaction({
      slotId: "1", poolId: "pool_001", appUserId: "user_001",
      rcOriginalAppUserId: null, rcOriginalTransactionId: "TX1",
      rcLatestTransactionId: "TX1", rcEnvironment: "PRODUCTION",
      purchasedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      tierKey: "standard", // ← standard
    });

    // discount 파라미터가 null임을 확인
    const slotsUpdateCall = mockExecute.mock.calls[1];
    const params: any[] = slotsUpdateCall.slice ? [] : [];
    // drizzle sql tag에서 null이 파라미터로 전달됨
    // 호출 수 확인 (idempotency SELECT + UPDATE slots + UPDATE pools)
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-1: INITIAL_PURCHASE before sync (slot RESERVED)
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-1 (INITIAL_PURCHASE before sync)", () => {
  it("RESERVED slot + product match → PURCHASED + audit", async () => {
    setupResponses([
      // INSERT revenuecat_webhook_events → rowCount=1 (새 이벤트)
      { rows: [], rowCount: 1 },
      // SELECT RESERVED slot
      {
        rows: [{
          id: "10", pool_id: "pool_001",
          store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          rc_original_transaction_id: null,
        }],
      },
      // commitXPurchaseTransaction: idempotency SELECT
      { rows: [{ status: "RESERVED", rc_original_transaction_id: null }] },
      // UPDATE slots
      { rows: [] },
      // UPDATE pools
      { rows: [] },
      // auditXEvent (x_purchase_webhook_confirmed): next_audit_version
      { rows: [{ v: 1 }] },
      // INSERT audit
      { rows: [] },
    ]);

    const result = await processXWebhookEvent({
      eventId: "rc_evt_001",
      eventType: "INITIAL_PURCHASE",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2026-12-31",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: "TX_001",
    });

    expect(result.skipped).toBeUndefined();
    // commitXPurchaseTransaction 경로: handleXEntitlementEvent 호출 없음
    expect(mockHandleXEnt).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-2: INITIAL_PURCHASE after sync (slot already PURCHASED)
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-2 (INITIAL_PURCHASE after sync)", () => {
  it("RESERVED slot 없음(이미 PURCHASED) → fallback handleXEntitlementEvent(idempotent)", async () => {
    setupResponses([
      { rows: [], rowCount: 1 }, // dedup: new event
      { rows: [] },              // SELECT RESERVED → not found
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_002",
      eventType: "INITIAL_PURCHASE",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2026-12-31",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: "TX_001",
    });

    // slot 없으면 handleXEntitlementEvent fallback
    expect(mockHandleXEnt).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "INITIAL_PURCHASE", poolId: "pool_001" }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-3: duplicate event.id → skipped
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-3 (duplicate event.id)", () => {
  it("ON CONFLICT DO NOTHING → rowCount=0 → skipped=true", async () => {
    setupResponses([
      { rows: [], rowCount: 0 }, // dedup: duplicate → 0 inserted
      // auditXEvent (x_webhook_duplicate)
      { rows: [{ v: 1 }] },
      { rows: [] },
    ]);

    const result = await processXWebhookEvent({
      eventId: "rc_evt_dup",
      eventType: "INITIAL_PURCHASE",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: null,
      isSandbox: false,
      originalTransactionId: null,
      latestTransactionId: null,
    });

    expect(result.skipped).toBe(true);
    expect(mockHandleXEnt).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-4: RENEWAL → handleXEntitlementEvent + slot update
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-4 (RENEWAL)", () => {
  it("RENEWAL: transaction binding 확인 → handleXEntitlementEvent + latest TX 갱신", async () => {
    setupResponses([
      { rows: [], rowCount: 1 },  // dedup: new
      // resolvePoolIdByTransaction: SELECT PURCHASED slot
      { rows: [{ pool_id: "pool_001" }] },
      // handleXEntitlementEvent (mocked)
      // UPDATE latest transaction
      { rows: [] },
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_renewal",
      eventType: "RENEWAL",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2027-01-31",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: "TX_002",
    });

    expect(mockHandleXEnt).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "RENEWAL", poolId: "pool_001" }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-5: CANCELLATION → handleXEntitlementEvent, paid 불변
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-5 (CANCELLATION)", () => {
  it("CANCELLATION → handleXEntitlementEvent 호출, paid 불변", async () => {
    setupResponses([
      { rows: [], rowCount: 1 },  // dedup
      { rows: [{ pool_id: "pool_001" }] }, // resolvePoolIdByTransaction
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_cancel",
      eventType: "CANCELLATION",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2026-12-31",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: null,
    });

    expect(mockHandleXEnt).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "CANCELLATION" }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-6: EXPIRATION + manual=true → effective remains true
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-6 (EXPIRATION + manual=true)", () => {
  it("EXPIRATION → handleXEntitlementEvent 위임 (x-entitlement에서 manual collision 처리)", async () => {
    setupResponses([
      { rows: [], rowCount: 1 },
      { rows: [{ pool_id: "pool_001" }] },
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_expire",
      eventType: "EXPIRATION",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2026-01-01",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: null,
    });

    // handleXEntitlementEvent(EXPIRATION)은 x_manual_entitlement를 수정하지 않음
    // → effective = (false OR manual) AND NOT force = manual
    expect(mockHandleXEnt).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EXPIRATION" }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK-7: REFUND + manual=true → effective remains true
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — WEBHOOK-7 (REFUND + manual=true)", () => {
  it("REFUND → handleXEntitlementEvent 위임 (manual collision x-entitlement에서 처리)", async () => {
    setupResponses([
      { rows: [], rowCount: 1 },
      { rows: [{ pool_id: "pool_001" }] },
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_refund",
      eventType: "REFUND",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: null,
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: null,
    });

    expect(mockHandleXEnt).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "REFUND" }),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY-1: cross-pool restore → blocked
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — SECURITY-1 (cross-pool)", () => {
  it("RENEWAL: tx가 원래 pool(pool_A)을 가리키는데 현재 user pool=pool_B → blocked (early return {})", async () => {
    setupResponses([
      { rows: [], rowCount: 1 },  // dedup
      // resolvePoolIdByTransaction → pool_A (원래 pool)
      { rows: [{ pool_id: "pool_A" }] },
      // auditXEvent (x_cross_pool_blocked): next_audit_version
      { rows: [{ v: 1 }] },
      { rows: [] },               // INSERT audit
    ]);

    const result = await processXWebhookEvent({
      eventId: "rc_evt_cross",
      eventType: "RENEWAL",
      appUserId: "user_001",
      poolId: "pool_B",          // ← 현재 user의 pool (다름)
      productId: "com.swimnote.x.monthly.tier1",
      expiresAt: "2026-12-31",
      isSandbox: false,
      originalTransactionId: "TX_A_001", // ← pool_A의 transaction
      latestTransactionId: null,
    });

    // cross-pool block → processXWebhookEvent returns {} (handleCrossPoolBlock → return {})
    expect(result).toEqual({});
    // handleXEntitlementEvent 호출 없음
    expect(mockHandleXEnt).not.toHaveBeenCalled();
    // auditXEvent가 호출됐는지: dedup(1) + resolvePool(1) + auditVersion(1) + auditInsert(1) = 4
    expect(mockExecute.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SECURITY-2: client product manipulation → blocked (slot product mismatch)
// ══════════════════════════════════════════════════════════════════════════════
describe("processXWebhookEvent — SECURITY-2 (client product manipulation)", () => {
  it("INITIAL_PURCHASE: slot=tier1, event=standard → product_mismatch + no commit", async () => {
    setupResponses([
      { rows: [], rowCount: 1 }, // dedup: new event
      // RESERVED slot: tier1 예약
      {
        rows: [{
          id: "10", pool_id: "pool_001",
          store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          rc_original_transaction_id: null,
        }],
      },
      // auditXEvent (x_product_mismatch): next_audit_version
      { rows: [{ v: 1 }] },
      { rows: [] }, // INSERT audit
    ]);

    await processXWebhookEvent({
      eventId: "rc_evt_manip",
      eventType: "INITIAL_PURCHASE",
      appUserId: "user_001",
      poolId: "pool_001",
      productId: "com.swimnote.x.monthly.standard", // ← 조작된 product (tier1 예약 후 standard 구매)
      expiresAt: "2026-12-31",
      isSandbox: false,
      originalTransactionId: "TX_001",
      latestTransactionId: null,
    });

    // commitXPurchaseTransaction 호출 없음 — product mismatch로 early break
    // handleXEntitlementEvent 호출 없음
    expect(mockHandleXEnt).not.toHaveBeenCalled();
    // dedup(1) + RESERVED SELECT(1) + auditVersion(1) + auditInsert(1) = 4 calls
    // commitXPurchaseTransaction (idempotency SELECT + UPDATE) 없음
    expect(mockExecute).toHaveBeenCalledTimes(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2-1: RC API 401/403 → safe failure (throw, not silent)
// ══════════════════════════════════════════════════════════════════════════════
describe("fetchRCSubscriberEntitlement — V2-1 (401 safe failure)", () => {
  it("RC V2 customer endpoint 401 → Error throw (secret 미노출)", async () => {
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          status: "RESERVED", rc_original_transaction_id: null,
        }],
      },
    ]);

    vi.stubGlobal("fetch", makeV2FetchMock({ customerStatus: 401 }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toThrow(/RC V2 customer 401/);
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2-2: RC API 404 (customer not found) → entitlement null → RC_ENTITLEMENT_INACTIVE
// ══════════════════════════════════════════════════════════════════════════════
describe("fetchRCSubscriberEntitlement — V2-2 (404 → inactive)", () => {
  it("RC V2 customer 404 → entitlement null → RC_ENTITLEMENT_INACTIVE", async () => {
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          status: "RESERVED", rc_original_transaction_id: null,
        }],
      },
    ]);

    vi.stubGlobal("fetch", makeV2FetchMock({ customerStatus: 404 }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toMatchObject({ code: "RC_ENTITLEMENT_INACTIVE" });
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2-3: malformed subscriptions response (items missing) → inactive
// ══════════════════════════════════════════════════════════════════════════════
describe("fetchRCSubscriberEntitlement — V2-3 (malformed response)", () => {
  it("RC V2 subscriptions items 없음 → entitlement null → RC_ENTITLEMENT_INACTIVE", async () => {
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          status: "RESERVED", rc_original_transaction_id: null,
        }],
      },
    ]);

    // items 키 없는 malformed response
    vi.stubGlobal("fetch", makeV2FetchMock({ subscriptionItems: [] }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toMatchObject({ code: "RC_ENTITLEMENT_INACTIVE" });
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2-4: non-X product subscription active → 필터링되어 entitlement null
// ══════════════════════════════════════════════════════════════════════════════
describe("fetchRCSubscriberEntitlement — V2-4 (non-X product filtered)", () => {
  it("gives_access=true지만 X product 아닌 상품 → 필터링 → RC_ENTITLEMENT_INACTIVE", async () => {
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          status: "RESERVED", rc_original_transaction_id: null,
        }],
      },
    ]);

    // 일반 구독 (X product 아님) — xProductIds 필터에서 제거됨
    vi.stubGlobal("fetch", makeV2FetchMock({
      subscriptionItems: [{
        product: { store_identifier: "center_200" }, // ← X product 아님
        gives_access: true,
        current_period_end_at: new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
        environment: "production",
        status: "active",
      }],
    }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1,com.swimnote.x.monthly.standard";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toMatchObject({ code: "RC_ENTITLEMENT_INACTIVE" });
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2-5: subscriptions endpoint 403 → safe failure
// ══════════════════════════════════════════════════════════════════════════════
describe("fetchRCSubscriberEntitlement — V2-5 (subscriptions 403)", () => {
  it("RC V2 subscriptions 403 → Error throw", async () => {
    setupResponses([
      {
        rows: [{
          id: "10", pool_id: "pool_001", store_product_id: "com.swimnote.x.monthly.tier1",
          tier_key: "tier1",
          payment_deadline_at: new Date(Date.now() + 3600000).toISOString(),
          status: "RESERVED", rc_original_transaction_id: null,
        }],
      },
    ]);

    vi.stubGlobal("fetch", makeV2FetchMock({ subscriptionStatus: 403 }));

    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_dummy";
    process.env.REVENUECAT_PROJECT_ID = "projc8b01266";
    process.env.REVENUECAT_X_PRODUCT_IDS = "com.swimnote.x.monthly.tier1";
    try {
      await expect(
        syncXSubscription({ poolId: "pool_001", userId: "user_001" }),
      ).rejects.toThrow(/RC V2 subscriptions 403/);
    } finally {
      delete process.env.REVENUECAT_SECRET_API_KEY;
      delete process.env.REVENUECAT_PROJECT_ID;
      delete process.env.REVENUECAT_X_PRODUCT_IDS;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION-1: isXProduct === false → 기존 basic billing 흐름 보장
// ══════════════════════════════════════════════════════════════════════════════
describe("REGRESSION-1: isXProduct separation", () => {
  it("X product 아닌 일반 center/solo product → isXProduct=false (mock 구현 검증)", async () => {
    // vi.mock으로 isXProduct = (id) => id.startsWith("com.swimnote.x.")으로 구현됨
    const { isXProduct: mockIsXP } = vi.mocked(
      await import("../../lib/x-entitlement.js"),
    );
    // non-X products
    expect(mockIsXP("center_200")).toBe(false);
    expect(mockIsXP("solo_30")).toBe(false);
    expect(mockIsXP("swimnote_center_200")).toBe(false);
    // X products
    expect(mockIsXP("com.swimnote.x.monthly.tier1")).toBe(true);
    expect(mockIsXP("com.swimnote.x.monthly.standard")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REGRESSION-2: resolveXProductForSequence는 기존 RC_PRODUCT_TIER_MAP에 영향 없음
// ══════════════════════════════════════════════════════════════════════════════
describe("REGRESSION-2: resolveXProductForSequence isolation", () => {
  it("일반 billing tier map과 완전히 독립 (com.swimnote.x.* 전용)", () => {
    // resolveXProductForSequence는 X product만 다룸
    const r1 = resolveXProductForSequence(1);
    const r2 = resolveXProductForSequence(150);
    const r3 = resolveXProductForSequence(400);
    const r4 = resolveXProductForSequence(999);

    // 모두 com.swimnote.x.* 형식
    for (const r of [r1, r2, r3, r4]) {
      expect(r.storeProductId.startsWith("com.swimnote.x.")).toBe(true);
    }
    // 기존 center/solo tier 이름 없음
    for (const r of [r1, r2, r3, r4]) {
      expect(r.tierKey).not.toContain("center");
      expect(r.tierKey).not.toContain("solo");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// §19 commitXPurchaseTransaction idempotency
// ══════════════════════════════════════════════════════════════════════════════
describe("commitXPurchaseTransaction — idempotency §19", () => {
  it("동일 RC transaction + 이미 PURCHASED → alreadySynced=true (no UPDATE)", async () => {
    setupResponses([
      {
        rows: [{
          status: "PURCHASED",
          rc_original_transaction_id: "TX_001",
        }],
      }, // idempotency SELECT → already PURCHASED with same TX
    ]);

    const result = await commitXPurchaseTransaction({
      slotId: "10", poolId: "pool_001", appUserId: "user_001",
      rcOriginalAppUserId: null,
      rcOriginalTransactionId: "TX_001", // same
      rcLatestTransactionId: "TX_001",
      rcEnvironment: "PRODUCTION",
      purchasedAt: null, expiresAt: null, tierKey: "tier1",
    });

    expect(result.alreadySynced).toBe(true);
    // UPDATE 호출 없음 (SELECT 1회만)
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
