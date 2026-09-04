/**
 * lib/x-billing.ts — SWIMNOTE X 구매 계약 헬퍼 (X02-C)
 *
 * 포함:
 *  - resolveXProductForSequence()  §7  server-only tier/product/discount mapping
 *  - formatFranchiseNumber()       §8  deterministic franchise number
 *  - fetchRCSubscriberEntitlement() §14 RevenueCat server-side API 검증
 *  - reserveXSlot()                §3~10  slot 예약 비즈니스 로직
 *  - syncXSubscription()           §11~19 sync 비즈니스 로직
 *  - commitXPurchaseTransaction()  §18 shared purchase commit (sync + webhook)
 *  - processXWebhookEvent()        §20~29 X webhook 통합 처리
 *  - auditXEvent()                 §33 audit helper
 *
 * 금지:
 *  - client tier/product 수신
 *  - REVENUECAT_SECRET_API_KEY 로그 출력
 *  - x_manual_entitlement / x_force_disabled / config_status 수정
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { handleXEntitlementEvent } from "./x-entitlement.js";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface XTierMapping {
  tierKey: "tier1" | "tier2" | "tier3" | "standard";
  discountPercent: number;
  storeProductId: string;
}

export interface RCEntitlementData {
  isActive: boolean;
  productIdentifier: string | null;
  expiresAt: string | null;
  purchaseDate: string | null;
  originalPurchaseDate: string | null;
  originalTransactionId: string | null;
  latestTransactionId: string | null;
  environment: "SANDBOX" | "PRODUCTION";
}

export interface XPurchaseCommitParams {
  slotId: number | string;
  poolId: string;
  appUserId: string;
  rcOriginalAppUserId: string | null;
  rcOriginalTransactionId: string | null;
  rcLatestTransactionId: string | null;
  rcEnvironment: string;
  purchasedAt: string | null;
  expiresAt: string | null;
  tierKey: string;
}

export interface XWebhookEventParams {
  eventId: string | null;
  eventType: string;
  appUserId: string;
  poolId: string;
  productId: string;
  expiresAt: string | null;
  isSandbox: boolean;
  originalTransactionId: string | null;
  latestTransactionId: string | null;
}

// ── §7 서버 전용 Tier Mapping ─────────────────────────────────────────────────
//
// 1~100   → tier1 (50%) / com.swimnote.x.monthly.tier1
// 101~300 → tier2 (30%) / com.swimnote.x.monthly.tier2
// 301~500 → tier3 (10%) / com.swimnote.x.monthly.tier3
// 501+    → standard (0%) / com.swimnote.x.monthly.standard

export function resolveXProductForSequence(sequence: number): XTierMapping {
  if (sequence >= 1 && sequence <= 100) {
    return { tierKey: "tier1", discountPercent: 50, storeProductId: "com.swimnote.x.monthly.tier1" };
  }
  if (sequence >= 101 && sequence <= 300) {
    return { tierKey: "tier2", discountPercent: 30, storeProductId: "com.swimnote.x.monthly.tier2" };
  }
  if (sequence >= 301 && sequence <= 500) {
    return { tierKey: "tier3", discountPercent: 10, storeProductId: "com.swimnote.x.monthly.tier3" };
  }
  return { tierKey: "standard", discountPercent: 0, storeProductId: "com.swimnote.x.monthly.standard" };
}

// ── §8 Franchise Number ────────────────────────────────────────────────────────
//
// 1 → "x-0001", 29 → "x-0029", 299 → "x-0299", 1000 → "x-1000"

export function formatFranchiseNumber(sequence: number): string {
  return `x-${String(Math.max(1, Math.floor(sequence))).padStart(4, "0")}`;
}

// ── §14/15 RevenueCat Server-side Verification (V2) ──────────────────────────

const RC_V2_BASE = "https://api.revenuecat.com/v2";

/**
 * RevenueCat V2 server-side 구독 검증.
 *
 * 경로:
 *   GET /v2/projects/{project_id}/customers/{customer_id}          → original_app_user_id
 *   GET /v2/projects/{project_id}/customers/{customer_id}/subscriptions → gives_access + X product
 *
 * REVENUECAT_SECRET_API_KEY / REVENUECAT_PROJECT_ID 미설정 시 throw.
 * secret은 절대 로그에 출력하지 않는다.
 * entitlementId 파라미터는 V2에서 직접 사용되지 않음 — X product IDs 기반 필터로 대체.
 */
export async function fetchRCSubscriberEntitlement(
  appUserId: string,
  _entitlementId: string = "x_mode",
): Promise<{ entitlement: RCEntitlementData | null; originalAppUserId: string }> {
  const secret = process.env.REVENUECAT_SECRET_API_KEY;
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!secret) throw new Error("REVENUECAT_SECRET_API_KEY not configured");
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID not configured");

  const headers = { Authorization: `Bearer ${secret}` };
  const customerBase =
    `${RC_V2_BASE}/projects/${projectId}/customers/${encodeURIComponent(appUserId)}`;

  // ── Step 1: customer → original_app_user_id ───────────────────────────────
  const custResp = await fetch(customerBase, { headers });
  if (!custResp.ok) {
    if (custResp.status === 404) {
      return { entitlement: null, originalAppUserId: appUserId };
    }
    const body = await custResp.text().catch(() => "");
    throw new Error(`RC V2 customer ${custResp.status}: ${body.slice(0, 200)}`);
  }
  const custData = (await custResp.json()) as any;
  const originalAppUserId: string = custData.original_app_user_id ?? appUserId;

  // ── Step 2: subscriptions → gives_access=true + X product 필터 ───────────
  const subResp = await fetch(`${customerBase}/subscriptions`, { headers });
  if (!subResp.ok) {
    const body = await subResp.text().catch(() => "");
    throw new Error(`RC V2 subscriptions ${subResp.status}: ${body.slice(0, 200)}`);
  }
  const subData = (await subResp.json()) as any;

  const xProductIds = new Set<string>(
    (process.env.REVENUECAT_X_PRODUCT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // gives_access=true + X product인 구독만 허용
  const activeSubs: any[] = ((subData.items ?? []) as any[]).filter((sub: any) => {
    const storeId: string = sub.product?.store_identifier ?? "";
    return (
      sub.gives_access === true &&
      (xProductIds.size === 0 || xProductIds.has(storeId))
    );
  });

  if (activeSubs.length === 0) return { entitlement: null, originalAppUserId };

  // 여러 개면 expiry가 가장 늦은 것 선택 (가장 활성)
  const best = activeSubs.sort((a: any, b: any) => {
    const aTs = a.current_period_end_at ? new Date(a.current_period_end_at).getTime() : 0;
    const bTs = b.current_period_end_at ? new Date(b.current_period_end_at).getTime() : 0;
    return bTs - aTs;
  })[0];

  const productId: string | null = best.product?.store_identifier ?? null;
  const expiresAt: string | null = best.current_period_end_at ?? null;
  const envStr: string = (best.environment ?? "").toLowerCase();
  const environment: "SANDBOX" | "PRODUCTION" =
    envStr === "sandbox" ? "SANDBOX" : "PRODUCTION";

  return {
    originalAppUserId,
    entitlement: {
      isActive: true, // gives_access=true → active
      productIdentifier: productId,
      expiresAt,
      purchaseDate: best.purchase_date ?? null,
      originalPurchaseDate: best.original_purchase_date ?? null,
      originalTransactionId: best.original_transaction_id ?? null,
      latestTransactionId: best.store_transaction_id ?? null,
      environment,
    },
  };
}

// ── §3~10 Slot 예약 ───────────────────────────────────────────────────────────

export interface XSlotReserveResult {
  id: string;
  sequenceNumber: number;
  franchiseNumber: string;
  tierKey: string;
  discountPercent: number;
  storeProductId: string;
  paymentDeadlineAt: string;
  /** true: 기존 valid reservation 반환 */
  existing?: boolean;
}

/**
 * X subscription slot 예약. pool_admin 전용.
 *
 * §5A: 이미 PURCHASED → throw { code: "ALREADY_SUBSCRIBED" }
 * §5B: 유효한 RESERVED 존재 → 기존 반환
 * §5C: 만료된 RESERVED → lazy-release 후 신규
 * §6:  atomic INSERT (CTE + nextval)
 */
export async function reserveXSlot(
  poolId: string,
  userId: string,
): Promise<XSlotReserveResult> {
  // §5A: 기존 PURCHASED 활성 slot 체크
  const [purchasedSlot] = (await superAdminDb.execute(sql`
    SELECT id FROM x_subscription_slots
    WHERE pool_id = ${poolId} AND status = 'PURCHASED'
    LIMIT 1
  `)).rows as any[];
  if (purchasedSlot) {
    const err: any = new Error("이미 X 정기결제가 활성화되어 있습니다.");
    err.code = "ALREADY_SUBSCRIBED";
    throw err;
  }

  // §5B/5C: 기존 RESERVED 체크
  const [reservedSlot] = (await superAdminDb.execute(sql`
    SELECT id, sequence_number, franchise_number, tier_key, store_product_id, payment_deadline_at
    FROM x_subscription_slots
    WHERE pool_id = ${poolId} AND status = 'RESERVED'
    LIMIT 1
  `)).rows as any[];

  if (reservedSlot) {
    const deadline = new Date(reservedSlot.payment_deadline_at);
    if (deadline > new Date()) {
      // §5B: valid reservation 반환
      const mapping = resolveXProductForSequence(Number(reservedSlot.sequence_number));
      return {
        id: String(reservedSlot.id),
        sequenceNumber: Number(reservedSlot.sequence_number),
        franchiseNumber: reservedSlot.franchise_number,
        tierKey: reservedSlot.tier_key,
        discountPercent: mapping.discountPercent,
        storeProductId: reservedSlot.store_product_id,
        paymentDeadlineAt: reservedSlot.payment_deadline_at,
        existing: true,
      };
    } else {
      // §5C: 만료 → lazy-release
      await superAdminDb.execute(sql`
        UPDATE x_subscription_slots
        SET status = 'RELEASED',
            released_at = NOW(),
            released_reason = 'deadline_expired',
            updated_at = NOW()
        WHERE id = ${reservedSlot.id} AND status = 'RESERVED'
      `);
      await auditXEvent({
        action: "x_slot_released",
        poolId,
        actorId: userId,
        before: { status: "RESERVED", slot_id: String(reservedSlot.id) },
        after: { status: "RELEASED", reason: "deadline_expired" },
        reason: "예약 기한 초과 자동 해제 (lazy cleanup)",
      });
    }
  }

  // §6: atomic INSERT — CTE nextval + CASE tier mapping (SQL)
  // partial unique (WHERE status='RESERVED') 가 동시 요청 2개를 막는다.
  let inserted: any;
  try {
    [inserted] = (await superAdminDb.execute(sql`
      WITH seq AS (SELECT nextval('x_slot_seq') AS n)
      INSERT INTO x_subscription_slots (
        pool_id, sequence_number, franchise_number,
        tier_key, store_product_id,
        status, reserved_by_user_id,
        reserved_at, payment_deadline_at
      )
      SELECT
        ${poolId},
        seq.n,
        'x-' || LPAD(seq.n::text, 4, '0'),
        CASE
          WHEN seq.n BETWEEN 1   AND 100 THEN 'tier1'
          WHEN seq.n BETWEEN 101 AND 300 THEN 'tier2'
          WHEN seq.n BETWEEN 301 AND 500 THEN 'tier3'
          ELSE 'standard'
        END,
        CASE
          WHEN seq.n BETWEEN 1   AND 100 THEN 'com.swimnote.x.monthly.tier1'
          WHEN seq.n BETWEEN 101 AND 300 THEN 'com.swimnote.x.monthly.tier2'
          WHEN seq.n BETWEEN 301 AND 500 THEN 'com.swimnote.x.monthly.tier3'
          ELSE 'com.swimnote.x.monthly.standard'
        END,
        'RESERVED',
        ${userId},
        NOW(),
        NOW() + INTERVAL '1 hour'
      FROM seq
      RETURNING id, sequence_number, franchise_number, tier_key, store_product_id, payment_deadline_at
    `)).rows as any[];
  } catch (insertErr: any) {
    // partial unique violation → concurrent request got the slot first, re-fetch
    if (insertErr?.code === "23505") {
      const [concurrent] = (await superAdminDb.execute(sql`
        SELECT id, sequence_number, franchise_number, tier_key, store_product_id, payment_deadline_at
        FROM x_subscription_slots
        WHERE pool_id = ${poolId} AND status = 'RESERVED'
        LIMIT 1
      `)).rows as any[];
      if (concurrent) {
        const mapping = resolveXProductForSequence(Number(concurrent.sequence_number));
        return {
          id: String(concurrent.id),
          sequenceNumber: Number(concurrent.sequence_number),
          franchiseNumber: concurrent.franchise_number,
          tierKey: concurrent.tier_key,
          discountPercent: mapping.discountPercent,
          storeProductId: concurrent.store_product_id,
          paymentDeadlineAt: concurrent.payment_deadline_at,
          existing: true,
        };
      }
    }
    throw insertErr;
  }

  if (!inserted) throw new Error("slot 생성 실패");

  const seq = Number(inserted.sequence_number);
  const mapping = resolveXProductForSequence(seq);

  await auditXEvent({
    action: "x_slot_reserved",
    poolId,
    actorId: userId,
    before: {},
    after: {
      slot_id: String(inserted.id),
      sequence: seq,
      franchise: inserted.franchise_number,
      tier: inserted.tier_key,
      product: inserted.store_product_id,
    },
    reason: `X slot 예약: seq=${seq} tier=${inserted.tier_key}`,
  });

  return {
    id: String(inserted.id),
    sequenceNumber: seq,
    franchiseNumber: inserted.franchise_number,
    tierKey: inserted.tier_key,
    discountPercent: mapping.discountPercent,
    storeProductId: inserted.store_product_id,
    paymentDeadlineAt: inserted.payment_deadline_at,
  };
}

// ── §11~19 Sync Subscription ──────────────────────────────────────────────────

export interface XSyncResult {
  synced: boolean;
  alreadySynced?: boolean;
  slotId?: string;
  tierKey?: string;
}

/**
 * 앱 purchasePackage 성공 후 서버 검증 + 동기화.
 *
 * §13: RESERVED slot 우선 조회
 * §14: RevenueCat server-side 검증
 * §16: product match
 * §17: deadline check (RC purchase timestamp grace)
 * §18: commit transaction
 * §19: idempotency
 */
export async function syncXSubscription(params: {
  poolId: string;
  userId: string;
}): Promise<XSyncResult> {
  const { poolId, userId } = params;

  // §13: RESERVED 슬롯 조회
  const [reservedSlot] = (await superAdminDb.execute(sql`
    SELECT id, pool_id, store_product_id, tier_key,
           payment_deadline_at, status, rc_original_transaction_id
    FROM x_subscription_slots
    WHERE pool_id = ${poolId}
      AND status = 'RESERVED'
    LIMIT 1
  `)).rows as any[];

  // PURCHASED slot (idempotent re-sync)
  if (!reservedSlot) {
    const [purchasedSlot] = (await superAdminDb.execute(sql`
      SELECT id, tier_key FROM x_subscription_slots
      WHERE pool_id = ${poolId} AND status = 'PURCHASED'
      ORDER BY purchased_at DESC LIMIT 1
    `)).rows as any[];
    if (purchasedSlot) {
      return { synced: true, alreadySynced: true, slotId: String(purchasedSlot.id), tierKey: purchasedSlot.tier_key };
    }
    const err: any = new Error("유효한 예약 슬롯이 없습니다. x-reserve-slot을 먼저 호출하세요.");
    err.code = "NO_RESERVED_SLOT";
    throw err;
  }

  // §17: deadline check
  const deadline = new Date(reservedSlot.payment_deadline_at);
  const now = new Date();

  // §14: RevenueCat server-side 검증
  const { entitlement, originalAppUserId } = await fetchRCSubscriberEntitlement(userId, "x_mode");

  if (!entitlement || !entitlement.isActive) {
    // deadline grace: RC purchaseDate < deadline이면 허용 (slot이 deadline 이후에도 RC confirm 가능)
    const err: any = new Error("RevenueCat x_mode entitlement가 활성화되어 있지 않습니다.");
    err.code = "RC_ENTITLEMENT_INACTIVE";
    throw err;
  }

  // §16: product match
  if (entitlement.productIdentifier !== reservedSlot.store_product_id) {
    await auditXEvent({
      action: "x_product_mismatch",
      poolId,
      actorId: userId,
      before: { slot_product: reservedSlot.store_product_id },
      after: { rc_product: entitlement.productIdentifier },
      reason: "sync product mismatch: slot과 RC entitlement product 불일치",
    });
    const err: any = new Error(
      `구매한 상품(${entitlement.productIdentifier})이 예약한 상품(${reservedSlot.store_product_id})과 다릅니다.`,
    );
    err.code = "PRODUCT_MISMATCH";
    throw err;
  }

  // §17: deadline + RC purchase timestamp grace
  if (deadline < now) {
    // RC purchaseDate가 deadline 이전이면 허용
    const rcPurchaseDate = entitlement.purchaseDate ? new Date(entitlement.purchaseDate) : null;
    if (!rcPurchaseDate || rcPurchaseDate >= deadline) {
      const err: any = new Error("결제 기한이 만료되었습니다. 다시 예약 후 결제하세요.");
      err.code = "PAYMENT_DEADLINE_EXPIRED";
      throw err;
    }
    console.log(`[x-billing] sync deadline grace: rcPurchaseDate=${rcPurchaseDate.toISOString()} < deadline=${deadline.toISOString()}`);
  }

  // §18/19: commit
  const { alreadySynced } = await commitXPurchaseTransaction({
    slotId: reservedSlot.id,
    poolId,
    appUserId: userId,
    rcOriginalAppUserId: originalAppUserId !== userId ? originalAppUserId : null,
    rcOriginalTransactionId: entitlement.originalTransactionId,
    rcLatestTransactionId: entitlement.latestTransactionId,
    rcEnvironment: entitlement.environment,
    purchasedAt: entitlement.purchaseDate,
    expiresAt: entitlement.expiresAt,
    tierKey: reservedSlot.tier_key,
  });

  if (!alreadySynced) {
    await auditXEvent({
      action: "x_purchase_synced",
      poolId,
      actorId: userId,
      before: { x_paid_entitlement: false, status: "RESERVED" },
      after: {
        x_paid_entitlement: true,
        status: "PURCHASED",
        slot_id: String(reservedSlot.id),
        tier: reservedSlot.tier_key,
        product: entitlement.productIdentifier,
        expires_at: entitlement.expiresAt,
      },
      reason: `sync-x-subscription: ${reservedSlot.tier_key}`,
    });
    // commitXPurchaseTransaction이 x_paid_entitlement=true 포함 모든 필드 처리
    // handleXEntitlementEvent 중복 호출 금지 (before-state 오염 방지)
  }

  return {
    synced: true,
    alreadySynced,
    slotId: String(reservedSlot.id),
    tierKey: reservedSlot.tier_key,
  };
}

// ── §18/19 Shared Purchase Commit ─────────────────────────────────────────────

export async function commitXPurchaseTransaction(
  params: XPurchaseCommitParams,
): Promise<{ alreadySynced: boolean }> {
  const {
    slotId, poolId, appUserId,
    rcOriginalAppUserId, rcOriginalTransactionId,
    rcLatestTransactionId, rcEnvironment,
    purchasedAt, expiresAt, tierKey,
  } = params;

  // §19 idempotency
  const [existing] = (await superAdminDb.execute(sql`
    SELECT status, rc_original_transaction_id
    FROM x_subscription_slots WHERE id = ${slotId} LIMIT 1
  `)).rows as any[];

  if (existing?.status === "PURCHASED") {
    const sameRc = rcOriginalTransactionId
      ? existing.rc_original_transaction_id === rcOriginalTransactionId
      : true;
    if (sameRc) {
      console.log(`[x-billing] commitXPurchase alreadySynced slot=${slotId}`);
      return { alreadySynced: true };
    }
  }

  const purchasedTs = purchasedAt ?? new Date().toISOString();
  const isDiscountTier = tierKey !== "standard";
  let discountEndsAt: string | null = null;
  if (isDiscountTier) {
    const d = new Date(purchasedTs);
    d.setMonth(d.getMonth() + 36);
    discountEndsAt = d.toISOString();
  }

  // slot 갱신
  await superAdminDb.execute(sql`
    UPDATE x_subscription_slots
    SET status                     = 'PURCHASED',
        purchased_at               = ${purchasedTs},
        rc_app_user_id             = ${appUserId},
        rc_original_app_user_id    = ${rcOriginalAppUserId ?? null},
        rc_original_transaction_id = ${rcOriginalTransactionId ?? null},
        rc_latest_transaction_id   = ${rcLatestTransactionId ?? null},
        rc_environment             = ${rcEnvironment},
        discount_started_at        = ${isDiscountTier ? purchasedTs : null},
        discount_ends_at           = ${discountEndsAt},
        updated_at                 = NOW()
    WHERE id = ${slotId}
  `);

  // pool 갱신 (§18: x_manual_entitlement / x_force_disabled / config_status 수정 금지)
  await superAdminDb.execute(sql`
    UPDATE swimming_pools
    SET x_paid_entitlement        = true,
        xmode_subscription_end_at = ${expiresAt ?? null},
        xmode_purchased_at        = COALESCE(xmode_purchased_at, ${purchasedTs}),
        x_slot_id                 = ${slotId},
        updated_at                = NOW()
    WHERE id = ${poolId}
  `);

  console.log(
    `[x-billing] PURCHASED slot=${slotId} pool=${poolId} tier=${tierKey} env=${rcEnvironment}`,
  );
  return { alreadySynced: false };
}

// ── §33 Audit Helper ──────────────────────────────────────────────────────────

export async function auditXEvent(params: {
  action: string;
  poolId: string;
  actorId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string;
}): Promise<void> {
  try {
    const vRes = await superAdminDb.execute(sql`
      SELECT next_audit_version('swimming_pool_xmode', ${params.poolId}) AS v
    `);
    const version = (vRes.rows[0] as any)?.v ?? 1;
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'swimming_pool_xmode', ${params.poolId}, ${version},
        ${params.action}, 'system', ${params.actorId}, ${params.poolId},
        ${JSON.stringify(params.before)}::jsonb,
        ${JSON.stringify(params.after)}::jsonb,
        ${params.reason},
        NULL, NULL, NULL
      )
    `);
  } catch (e: any) {
    console.warn("[x-billing] audit failed:", e?.message);
  }
}

// ── §20~29 Webhook Event Processor ───────────────────────────────────────────

/**
 * X webhook 이벤트 통합 처리.
 *
 * §20: event_id dedup (revenuecat_webhook_events UNIQUE)
 * §22: INITIAL_PURCHASE — slot binding + product match + commit
 * §23: sync 이후 webhook 도착 → idempotent
 * §24: RENEWAL — transaction binding 우선
 * §25: CANCELLATION
 * §26: EXPIRATION
 * §27: REFUND
 * §28: PRODUCT_CHANGE — record only
 * §29: cross-pool defense
 */
export async function processXWebhookEvent(
  params: XWebhookEventParams,
): Promise<{ skipped?: boolean }> {
  const {
    eventId, eventType, appUserId, poolId, productId,
    expiresAt, isSandbox,
    originalTransactionId, latestTransactionId,
  } = params;

  const rcEnv = isSandbox ? "SANDBOX" : "PRODUCTION";

  // §20: dedup — ON CONFLICT DO NOTHING + rowCount 확인
  if (eventId) {
    const dupResult = await superAdminDb.execute(sql`
      INSERT INTO revenuecat_webhook_events
        (event_id, event_type, app_user_id, product_id, environment, processed_at, created_at)
      VALUES
        (${eventId}, ${eventType}, ${appUserId}, ${productId ?? ""}, ${rcEnv}, NOW(), NOW())
      ON CONFLICT (event_id) DO NOTHING
    `);
    const inserted = Number((dupResult as any).rowCount ?? 0);
    if (inserted === 0) {
      console.log(`[x-webhook] duplicate eventId=${eventId} type=${eventType} — skipped`);
      await auditXEvent({
        action: "x_webhook_duplicate",
        poolId,
        actorId: `rc:${eventId}`,
        before: {},
        after: { event_id: eventId, event_type: eventType, product_id: productId },
        reason: `RC webhook 중복 수신: ${eventType}`,
      });
      return { skipped: true };
    }
  }

  switch (eventType) {
    case "INITIAL_PURCHASE": {
      // §22: pool의 RESERVED slot 조회 + product match + commit
      const [reservedSlot] = (await superAdminDb.execute(sql`
        SELECT id, pool_id, store_product_id, tier_key, payment_deadline_at,
               rc_original_transaction_id
        FROM x_subscription_slots
        WHERE pool_id = ${poolId} AND status = 'RESERVED'
        LIMIT 1
      `)).rows as any[];

      if (reservedSlot) {
        // §16: product match
        if (reservedSlot.store_product_id !== productId) {
          console.warn(
            `[x-webhook] INITIAL_PURCHASE product mismatch pool=${poolId} ` +
            `slot=${reservedSlot.store_product_id} event=${productId}`,
          );
          await auditXEvent({
            action: "x_product_mismatch",
            poolId,
            actorId: `rc:${eventId ?? "unknown"}`,
            before: { slot_product: reservedSlot.store_product_id },
            after: { event_product: productId, event_type: eventType },
            reason: `RC INITIAL_PURCHASE product mismatch`,
          });
          break;
        }

        // §23: commit (idempotent if already synced)
        const { alreadySynced } = await commitXPurchaseTransaction({
          slotId: reservedSlot.id,
          poolId,
          appUserId,
          rcOriginalAppUserId: null,
          rcOriginalTransactionId: originalTransactionId,
          rcLatestTransactionId: latestTransactionId,
          rcEnvironment: rcEnv,
          purchasedAt: null,
          expiresAt,
          tierKey: reservedSlot.tier_key,
        });

        if (!alreadySynced) {
          await auditXEvent({
            action: "x_purchase_webhook_confirmed",
            poolId,
            actorId: `rc:${eventId ?? "unknown"}`,
            before: { x_paid_entitlement: false, status: "RESERVED" },
            after: {
              x_paid_entitlement: true,
              status: "PURCHASED",
              product: productId,
              slot_id: String(reservedSlot.id),
              env: rcEnv,
            },
            reason: `RC INITIAL_PURCHASE webhook confirmed`,
          });
        }
        // commitXPurchaseTransaction이 x_paid_entitlement=true 포함 모든 pool 필드 처리
      } else {
        // RESERVED slot 없음: sync가 먼저 완료했거나 예약 없음
        // fallback — handleXEntitlementEvent로 paid 상태 갱신 (idempotent)
        await handleXEntitlementEvent({
          eventType, poolId, appUserId, productId,
          eventId, expiresAt, isSandbox,
        });
      }
      break;
    }

    case "RENEWAL": {
      // §24: transaction binding으로 원래 pool 우선
      const resolvedPoolId = await resolvePoolIdByTransaction(originalTransactionId, poolId);
      if (resolvedPoolId !== poolId) {
        await handleCrossPoolBlock({ eventType, originalTransactionId, appUserId, currentPoolId: poolId, slotPoolId: resolvedPoolId, eventId });
        return {};
      }
      await handleXEntitlementEvent({
        eventType, poolId: resolvedPoolId, appUserId, productId,
        eventId, expiresAt, isSandbox,
      });
      // latest transaction ID 갱신
      if (latestTransactionId) {
        await superAdminDb.execute(sql`
          UPDATE x_subscription_slots
          SET rc_latest_transaction_id = ${latestTransactionId}, updated_at = NOW()
          WHERE pool_id = ${resolvedPoolId} AND status = 'PURCHASED'
        `).catch(() => {});
      }
      break;
    }

    case "CANCELLATION": {
      // §25
      const resolvedPoolId = await resolvePoolIdByTransaction(originalTransactionId, poolId);
      if (resolvedPoolId !== poolId && originalTransactionId) {
        await handleCrossPoolBlock({ eventType, originalTransactionId, appUserId, currentPoolId: poolId, slotPoolId: resolvedPoolId, eventId });
        return {};
      }
      await handleXEntitlementEvent({
        eventType, poolId: resolvedPoolId, appUserId, productId,
        eventId, expiresAt, isSandbox,
      });
      break;
    }

    case "EXPIRATION": {
      // §26: x_paid_entitlement=false, x_slot_id는 최소 변경
      const resolvedPoolId = await resolvePoolIdByTransaction(originalTransactionId, poolId);
      if (resolvedPoolId !== poolId && originalTransactionId) {
        await handleCrossPoolBlock({ eventType, originalTransactionId, appUserId, currentPoolId: poolId, slotPoolId: resolvedPoolId, eventId });
        return {};
      }
      await handleXEntitlementEvent({
        eventType, poolId: resolvedPoolId, appUserId, productId,
        eventId, expiresAt, isSandbox,
      });
      break;
    }

    case "REFUND": {
      // §27: x_paid_entitlement=false, manual 유지, slot history 유지
      const resolvedPoolId = await resolvePoolIdByTransaction(originalTransactionId, poolId);
      if (resolvedPoolId !== poolId && originalTransactionId) {
        await handleCrossPoolBlock({ eventType, originalTransactionId, appUserId, currentPoolId: poolId, slotPoolId: resolvedPoolId, eventId });
        return {};
      }
      await handleXEntitlementEvent({
        eventType, poolId: resolvedPoolId, appUserId, productId,
        eventId, expiresAt, isSandbox,
      });
      break;
    }

    case "PRODUCT_CHANGE": {
      // §28: 인식 + 기록만, entitlement 변경 금지, 자동 tier 변경 금지
      console.log(
        `[x-webhook] PRODUCT_CHANGE: pool=${poolId} product=${productId} tx=${originalTransactionId}`,
      );
      await auditXEvent({
        action: "x_product_mismatch",
        poolId,
        actorId: `rc:${eventId ?? "unknown"}`,
        before: {},
        after: { event_type: eventType, new_product: productId, original_tx: originalTransactionId },
        reason: `RC PRODUCT_CHANGE 감지: ${productId} (자동 tier 변경 없음)`,
      });
      break;
    }

    default:
      console.log(`[x-webhook] 미지원 X 이벤트: ${eventType} pool=${poolId}`);
  }

  return {};
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

/** §21: rc_original_transaction_id로 PURCHASED slot의 원래 pool 조회 */
async function resolvePoolIdByTransaction(
  originalTransactionId: string | null,
  fallbackPoolId: string,
): Promise<string> {
  if (!originalTransactionId) return fallbackPoolId;
  const [slot] = (await superAdminDb.execute(sql`
    SELECT pool_id FROM x_subscription_slots
    WHERE rc_original_transaction_id = ${originalTransactionId}
      AND status = 'PURCHASED'
    LIMIT 1
  `)).rows as any[];
  return (slot?.pool_id as string | null) ?? fallbackPoolId;
}

/** §29: cross-pool block + audit */
async function handleCrossPoolBlock(params: {
  eventType: string;
  originalTransactionId: string | null;
  appUserId: string;
  currentPoolId: string;
  slotPoolId: string;
  eventId: string | null;
}): Promise<void> {
  console.warn(
    `[x-webhook] CROSS-POOL BLOCKED: event=${params.eventType} ` +
    `user=${params.appUserId} currentPool=${params.currentPoolId} ` +
    `originalPool=${params.slotPoolId} tx=${params.originalTransactionId}`,
  );
  await auditXEvent({
    action: "x_cross_pool_blocked",
    poolId: params.slotPoolId,
    actorId: `rc:${params.eventId ?? "unknown"}`,
    before: { current_pool: params.currentPoolId },
    after: {
      event_type: params.eventType,
      original_pool: params.slotPoolId,
      current_pool: params.currentPoolId,
      transaction: params.originalTransactionId,
    },
    reason: `Cross-pool ${params.eventType}: user=${params.appUserId} moved to different pool`,
  });
}
