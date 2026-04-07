/**
 * billing.ts — 구독 결제 API (스토어 결제 정책 기준)
 *
 * - 일할 계산 없음 / 내부 환불 계산 없음 / 강제 재결제 없음
 * - 업그레이드: 즉시 적용 (기존 플랜 종료 → 새 플랜 active)
 * - 다운그레이드: next_billing_date 이후 적용 (현재 플랜 유지)
 * - 환불: 스토어 환불 이벤트 수신 시 payment_status=refunded 및 구독 상태 업데이트
 * - 결제 처리는 payment/ 모듈에 위임 (Toss / PortOne / Mock 교체 가능)
 */
import { Router } from "express";
import cron from "node-cron";
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getPaymentProvider } from "../payment/index.js";
import { logEvent } from "../lib/event-logger.js";
import { billingEnabled } from "../config/billing.js";
import { resolveSubscription } from "../lib/subscriptionResolver.js";

const router = Router();

// ── 구 티어명 → 현재 티어명 정규화 (DB에 저장된 구 값 호환) ──────────────
const TIER_NORMALIZE: Record<string, string> = {
  growth:     "center_200",
  premium:    "pro",
  enterprise: "max",
  center_300: "advance",
  center_500: "pro",
  center_1000: "max",
};
function normalizeTier(tier: string | null | undefined): string {
  if (!tier) return "free";
  return TIER_NORMALIZE[tier] ?? tier;
}

// ── 플랜 기능 조회 (billingEnabled 무관, 전 역할 접근 가능) ──────────────
const CENTER_TIERS = new Set(["center_200", "advance", "pro", "max"]);

router.get("/features", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.json({ video_enabled: false, storage_quota_gb: 0.5, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" }); return; }

    let tier = "free";
    let uploadBlocked = false;
    try {
      const [row] = (await db.execute(sql`
        SELECT COALESCE(sp.subscription_tier, ps.tier, 'free') AS tier,
               sp.upload_blocked
        FROM swimming_pools sp
        LEFT JOIN pool_subscriptions ps ON ps.swimming_pool_id = sp.id AND ps.status = 'active'
        WHERE sp.id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (row) { tier = normalizeTier(row.tier); uploadBlocked = !!row.upload_blocked; }
    } catch {}

    let storageQuotaGb = 0.5;
    try {
      const [plan] = (await db.execute(sql`SELECT storage_gb FROM subscription_plans WHERE tier = ${tier} LIMIT 1`)).rows as any[];
      if (plan) storageQuotaGb = Number(plan.storage_gb ?? 0.5);
    } catch {}

    let usedBytes = 0;
    try {
      const [r] = (await db.execute(sql`
        SELECT COALESCE(SUM(file_size),0) AS used_bytes FROM photo_assets_meta WHERE pool_id = ${poolId}
      `)).rows as any[];
      const [rv] = (await db.execute(sql`
        SELECT COALESCE(SUM(file_size),0) AS used_bytes FROM video_assets_meta WHERE pool_id = ${poolId}
      `)).rows as any[];
      usedBytes = Number(r?.used_bytes ?? 0) + Number(rv?.used_bytes ?? 0);
    } catch {}

    const storageUsedGb = +(usedBytes / (1024 ** 3)).toFixed(3);
    const storageUsedPct = storageQuotaGb > 0 ? Math.round((storageUsedGb / storageQuotaGb) * 100) : 0;

    res.json({
      video_enabled: CENTER_TIERS.has(tier),
      storage_quota_gb: storageQuotaGb,
      storage_used_gb: storageUsedGb,
      storage_used_pct: storageUsedPct,
      upload_blocked: uploadBlocked,
      tier,
    });
  } catch (err) {
    console.error("[billing/features]", err);
    res.json({ video_enabled: false, storage_quota_gb: 0.5, storage_used_gb: 0, storage_used_pct: 0, upload_blocked: false, tier: "free" });
  }
});

// ── RevenueCat 제품 ID → 구독 tier 매핑 ─────────────────────────────
const RC_PRODUCT_TIER_MAP: Record<string, string> = {
  // RevenueCat 패키지 식별자 (solo 3단계)
  "solo_30":  "starter",
  "solo_50":  "basic",
  "solo_100": "standard",
  // 앱스토어/플레이스토어 상품 ID — solo 3단계
  "swimnote_solo_30":          "starter",
  "swimnote_solo_50":          "basic",
  "swimnote_solo_100":         "standard",
  "swimnote_solo_30:monthly":  "starter",
  "swimnote_solo_50:monthly":  "basic",
  "swimnote_solo_100:monthly": "standard",
  // 단일 solo 월정액 (대시보드에서 직접 생성된 경우)
  "swimnote_solo_monthly":         "basic",
  "swimnote_solo_monthly:monthly": "basic",
  // center 플랜 — 4단계 (패키지 ID는 plan_id 기준)
  "center_200":                       "center_200",
  "center_300":                       "advance",
  "center_500":                       "pro",
  "center_1000":                      "max",
  "swimnote_center_200":              "center_200",
  "swimnote_center_300":              "advance",
  "swimnote_center_500":              "pro",
  "swimnote_center_1000":             "max",
  "swimnote_center_200:monthly":      "center_200",
  "swimnote_center_300:monthly":      "advance",
  "swimnote_center_500:monthly":      "pro",
  "swimnote_center_1000:monthly":     "max",
  // 구버전 단일 center 호환
  "swimnote_center_monthly":         "center_200",
  "swimnote_center_monthly:monthly": "center_200",
  "center_monthly":                  "center_200",
  // 구버전 coach 명칭 호환
  "swimnote_coach_30":  "starter",
  "swimnote_coach_50":  "basic",
  "swimnote_coach_100": "standard",
  "coach_30":  "starter",
  "coach_50":  "basic",
  "coach_100": "standard",
};

// ── RevenueCat Webhook (인증 불필요, billingEnabled 무관) ─────────────
router.post("/revenuecat-webhook", async (req, res) => {
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== webhookSecret) {
      console.warn("[rc-webhook] 인증 실패");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const event = req.body?.event;
  if (!event) { res.json({ received: true }); return; }

  const eventType  = event.type as string;
  const appUserId  = event.app_user_id as string;
  const productId  = (event.product_id as string) ?? "";
  const expiresMs  = event.expiration_at_ms as number | null;
  const expiresAt  = expiresMs ? new Date(expiresMs).toISOString().split("T")[0] : null;
  const tier       = RC_PRODUCT_TIER_MAP[productId] ?? null;

  console.log(`[rc-webhook] 이벤트: ${eventType} | 사용자: ${appUserId} | 제품: ${productId} | tier: ${tier}`);

  try {
    // 사용자 → 수영장 찾기
    const [userRow] = (await db.execute(sql`
      SELECT id, swimming_pool_id FROM users WHERE id = ${appUserId} LIMIT 1
    `)).rows as any[];

    if (!userRow?.swimming_pool_id) {
      console.warn(`[rc-webhook] 사용자 또는 수영장을 찾을 수 없음: ${appUserId}`);
      res.json({ received: true });
      return;
    }

    const poolId = userRow.swimming_pool_id as string;
    const todayStr = new Date().toISOString().split("T")[0];

    switch (eventType) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "UNCANCELLATION": {
        if (!tier) { console.warn("[rc-webhook] 알 수 없는 제품:", productId); break; }
        const nextBilling = expiresAt ?? addOneMonth();
        await db.execute(sql`
          INSERT INTO pool_subscriptions
            (swimming_pool_id, tier, status, current_period_start, next_billing_at)
          VALUES (${poolId}, ${tier}, 'active', ${todayStr}, ${nextBilling})
          ON CONFLICT (swimming_pool_id) DO UPDATE
            SET tier = ${tier}, status = 'active',
                current_period_start = ${todayStr},
                next_billing_at      = ${nextBilling},
                pending_tier = NULL, downgrade_at = NULL,
                updated_at = now()
        `);
        await superAdminDb.execute(sql`
          UPDATE swimming_pools
          SET subscription_status = 'active',
              subscription_tier   = ${tier},
              subscription_source = 'revenuecat',
              is_readonly         = false,
              upload_blocked      = false,
              readonly_reason     = null,
              payment_failed_at   = null,
              updated_at          = now()
          WHERE id = ${poolId}
        `);
        const plan = (await db.execute(sql`SELECT name, price_per_month FROM subscription_plans WHERE tier = ${tier} LIMIT 1`)).rows[0] as any;
        const poolInfo = (await superAdminDb.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`)).rows[0] as any;
        if (eventType !== "UNCANCELLATION") {
          await recordPayment({
            poolId, poolName: poolInfo?.name,
            amount: plan?.price_per_month ?? 0,
            status: "success",
            type: eventType === "RENEWAL" ? "renewal" : "new_subscription",
            description: `${plan?.name ?? tier} ${eventType === "RENEWAL" ? "갱신" : "신규 구독"} (RevenueCat)`,
            planId: tier, planName: plan?.name,
            eventType: eventType === "RENEWAL" ? "renewal" : "new_subscription",
          });
        }
        logEvent({ pool_id: poolId, category: "구독", actor_id: "revenuecat", actor_name: "RevenueCat",
          description: `${eventType}: ${productId} → ${tier}`, metadata: { eventType, productId, tier } }).catch(console.error);
        break;
      }

      case "CANCELLATION": {
        // 취소 예약 — 만료일까지 서비스 유지, 상태만 기록
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET subscription_status = 'active', updated_at = now() WHERE id = ${poolId}
        `);
        logEvent({ pool_id: poolId, category: "구독", actor_id: "revenuecat", actor_name: "RevenueCat",
          description: `구독 취소 예약 (${expiresAt ?? "만료일 미상"} 이후 만료)`,
          metadata: { eventType, productId, expiresAt } }).catch(console.error);
        break;
      }

      case "EXPIRATION": {
        // 구독 만료 → 무료 전환
        await db.execute(sql`
          INSERT INTO pool_subscriptions
            (swimming_pool_id, tier, status, current_period_start, next_billing_at)
          VALUES (${poolId}, 'free', 'inactive', ${todayStr}, NULL)
          ON CONFLICT (swimming_pool_id) DO UPDATE
            SET tier = 'free', status = 'inactive', next_billing_at = NULL, updated_at = now()
        `);
        await superAdminDb.execute(sql`
          UPDATE swimming_pools
          SET subscription_status = 'payment_failed',
              subscription_tier   = 'free',
              is_readonly         = true,
              upload_blocked      = true,
              readonly_reason     = 'expired',
              payment_failed_at   = now(),
              updated_at          = now()
          WHERE id = ${poolId}
        `);
        logEvent({ pool_id: poolId, category: "구독", actor_id: "revenuecat", actor_name: "RevenueCat",
          description: `구독 만료: ${productId}`, metadata: { eventType, productId } }).catch(console.error);
        break;
      }

      case "BILLING_ISSUE": {
        await superAdminDb.execute(sql`
          UPDATE swimming_pools
          SET subscription_status = 'payment_failed',
              is_readonly         = true,
              upload_blocked      = true,
              readonly_reason     = 'payment_failed',
              payment_failed_at   = now(),
              updated_at          = now()
          WHERE id = ${poolId}
        `);
        logEvent({ pool_id: poolId, category: "결제", actor_id: "revenuecat", actor_name: "RevenueCat",
          description: `결제 실패 (RevenueCat): ${productId}`, metadata: { eventType, productId } }).catch(console.error);
        break;
      }

      case "PRODUCT_CHANGE": {
        const newTier = RC_PRODUCT_TIER_MAP[productId] ?? null;
        if (newTier) {
          await db.execute(sql`
            UPDATE pool_subscriptions SET tier = ${newTier}, updated_at = now() WHERE swimming_pool_id = ${poolId}
          `);
          await superAdminDb.execute(sql`
            UPDATE swimming_pools SET subscription_tier = ${newTier}, updated_at = now() WHERE id = ${poolId}
          `);
        }
        break;
      }

      default:
        console.log(`[rc-webhook] 처리하지 않는 이벤트 타입: ${eventType}`);
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error("[rc-webhook] 처리 오류:", err);
    res.status(500).json({ error: err?.message ?? "webhook 처리 오류" });
  }
});

// ── RevenueCat 구매 완료 후 서버 DB 동기화 (앱이 호출) ────────────────
router.post("/sync-rc-subscription", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const { productId, entitlementId, expiresAt, isActive } = req.body as {
      productId: string;
      entitlementId: string;
      expiresAt: string | null;
      isActive: boolean;
    };

    const tier = RC_PRODUCT_TIER_MAP[productId] ?? null;

    if (!isActive || !tier) {
      res.json({ synced: false, reason: "active 구독 없음" }); return;
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const nextBilling = expiresAt ?? addOneMonth();

    await db.execute(sql`
      INSERT INTO pool_subscriptions
        (swimming_pool_id, tier, status, current_period_start, next_billing_at)
      VALUES (${poolId}, ${tier}, 'active', ${todayStr}, ${nextBilling})
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET tier                 = ${tier},
            status               = 'active',
            current_period_start = ${todayStr},
            next_billing_at      = ${nextBilling},
            pending_tier         = NULL,
            downgrade_at         = NULL,
            updated_at           = now()
    `);

    await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'active',
          subscription_tier   = ${tier},
          subscription_source = 'revenuecat',
          is_readonly         = false,
          upload_blocked      = false,
          readonly_reason     = null,
          payment_failed_at   = null,
          updated_at          = now()
      WHERE id = ${poolId}
    `);

    const plan = (await db.execute(sql`SELECT name, price_per_month FROM subscription_plans WHERE tier = ${tier} LIMIT 1`)).rows[0] as any;
    const poolInfo = (await superAdminDb.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`)).rows[0] as any;

    await recordPayment({
      poolId, poolName: poolInfo?.name,
      amount: plan?.price_per_month ?? 0,
      status: "success",
      type: "new_subscription",
      description: `${plan?.name ?? tier} 구독 (RevenueCat 앱 내 구매)`,
      planId: tier, planName: plan?.name,
      eventType: "new_subscription",
    });

    logEvent({ pool_id: poolId, category: "구독", actor_id: req.user!.userId, actor_name: "관리자",
      description: `RevenueCat 구독 동기화: ${productId} → ${tier}`,
      metadata: { productId, tier, expiresAt } }).catch(console.error);

    res.json({ synced: true, tier, nextBilling });
  } catch (err: any) {
    console.error("[sync-rc-subscription]", err);
    res.status(500).json({ error: err?.message ?? "동기화 오류" });
  }
});

// ── 앱스토어 제출용: 결제 기능 비활성화 차단 ──────────────────────────────
router.use((_req, res, next) => {
  if (!billingEnabled) {
    res.status(403).json({ error: "billing disabled", message: "현재 앱 내 결제 기능은 제공되지 않습니다." });
    return;
  }
  next();
});

// ── 테이블 보장 (서버 시작 시 1회 실행) ──────────────────────────────
async function ensureBillingTables() {
  // revenue_logs: 정산용 이벤트 로그 (지시서 §8 요구사항 반영)
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS revenue_logs (
      id                      TEXT PRIMARY KEY,
      pool_id                 TEXT NOT NULL,
      pool_name               TEXT,
      plan_id                 TEXT NOT NULL,
      plan_name               TEXT,
      event_type              TEXT NOT NULL DEFAULT 'new_subscription',
      gross_amount            INTEGER NOT NULL DEFAULT 0,
      intro_discount_amount   INTEGER NOT NULL DEFAULT 0,
      charged_amount          INTEGER NOT NULL DEFAULT 0,
      refunded_amount         INTEGER NOT NULL DEFAULT 0,
      store_fee               INTEGER NOT NULL DEFAULT 0,
      net_revenue             INTEGER NOT NULL DEFAULT 0,
      payment_provider        TEXT NOT NULL DEFAULT 'store',
      provider_transaction_id TEXT,
      occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // 기존 테이블에 누락된 컬럼 추가 (하위 호환)
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS pool_name TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS plan_name TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'new_subscription'`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS gross_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS intro_discount_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS charged_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS refunded_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'store'`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS store_fee INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS net_revenue INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  // 다운그레이드 예약 컬럼 추가
  await db.execute(sql`ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS pending_tier TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS downgrade_at DATE`).catch(() => {});
  // subscription_plans 확장 컬럼
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_mb INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_storage TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
  // swimming_pools 최초 할인 컬럼
  await superAdminDb.execute(sql`ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS first_payment_used BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
}
ensureBillingTables().catch(console.error);

// ── 헬퍼 ──────────────────────────────────────────────────────────────

async function getPoolId(userId: string): Promise<string | null> {
  const [u] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.swimming_pool_id ?? null;
}

async function getActorInfo(userId: string): Promise<{ pool_id: string | null; name: string }> {
  const [u] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id, name: usersTable.name })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return { pool_id: u?.swimming_pool_id ?? null, name: (u as any)?.name || "관리자" };
}

function addOneMonth(from: Date = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split("T")[0];
}

async function recordPayment(params: {
  poolId: string; amount: number; status: "success" | "failed";
  type: string; description: string; periodStart?: string; periodEnd?: string;
  pgTransactionId?: string;
  planId?: string; planName?: string; poolName?: string;
  eventType?: string; grossAmount?: number; introDiscount?: number;
}): Promise<string> {
  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await superAdminDb.execute(sql`
    INSERT INTO payment_logs
      (id, swimming_pool_id, amount, status, method, type, description,
       billing_period_start, billing_period_end, paid_at)
    VALUES
      (${id}, ${params.poolId}, ${params.amount}, ${params.status},
       'store', ${params.type}, ${params.description},
       ${params.periodStart ?? null}, ${params.periodEnd ?? null},
       ${params.status === "success" ? sql`now()` : null})
  `);
  // 성공 결제 → revenue_logs 기록 (스토어 수수료 30%, 지시서 §8 필드 포함)
  if (params.status === "success" && params.planId && params.amount > 0) {
    const revId     = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storeFee  = Math.round(params.amount * 0.3);
    const netRev    = params.amount - storeFee;
    const grossAmt  = params.grossAmount ?? params.amount;
    const introDis  = params.introDiscount ?? 0;
    const evtType   = params.eventType ?? "new_subscription";
    await superAdminDb.execute(sql`
      INSERT INTO revenue_logs
        (id, pool_id, pool_name, plan_id, plan_name, event_type,
         gross_amount, intro_discount_amount, charged_amount,
         store_fee, net_revenue, payment_provider, occurred_at)
      VALUES
        (${revId}, ${params.poolId}, ${params.poolName ?? null},
         ${params.planId}, ${params.planName ?? null}, ${evtType},
         ${grossAmt}, ${introDis}, ${params.amount},
         ${storeFee}, ${netRev}, 'store', NOW())
    `).catch(console.error);
  }
  return id;
}

// ── 현재 구독 현황 ────────────────────────────────────────────────────
router.get("/status", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    let sub: any = undefined;
    let card: any = undefined;
    let plans: any[] = [];
    let usedBytes = 0;
    let storagePolicyRow: any = undefined;

    try {
      [sub] = (await db.execute(sql`
        SELECT ps.*, sp.name AS plan_name, sp.price_per_month, sp.member_limit, sp.storage_gb
        FROM pool_subscriptions ps
        LEFT JOIN subscription_plans sp ON sp.tier = ps.tier
        WHERE ps.swimming_pool_id = ${poolId} LIMIT 1
      `)).rows as any[];
    } catch { /* pool_subscriptions 미존재 */ }

    try {
      [card] = (await db.execute(sql`
        SELECT id, card_last4, card_brand, card_nickname, is_default, created_at
        FROM payment_cards WHERE swimming_pool_id = ${poolId}
        ORDER BY is_default DESC, created_at DESC LIMIT 1
      `)).rows as any[];
    } catch { /* payment_cards 미존재 */ }

    // 과금 카운트: active + suspended 만 포함 (유료회원 기준)
    // withdrawn / archived / deleted 는 과금 제외
    const cntResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId}
        AND status IN ('active', 'suspended')
    `);
    const memberCount = Number((cntResult.rows[0] as any)?.cnt ?? 0);

    try {
      plans = (await db.execute(sql`
        SELECT * FROM subscription_plans ORDER BY price_per_month ASC
      `)).rows;
    } catch { /* subscription_plans 미존재 */ }

    try {
      const [rp] = (await db.execute(sql`
        SELECT COALESCE(SUM(file_size),0) AS used_bytes FROM photo_assets_meta WHERE pool_id = ${poolId}
      `)).rows as any[];
      const [rv] = (await db.execute(sql`
        SELECT COALESCE(SUM(file_size),0) AS used_bytes FROM video_assets_meta WHERE pool_id = ${poolId}
      `)).rows as any[];
      usedBytes = Number(rp?.used_bytes ?? 0) + Number(rv?.used_bytes ?? 0);
    } catch { /* 스토리지 조회 실패 */ }

    try {
      [storagePolicyRow] = (await db.execute(sql`
        SELECT quota_gb, extra_price_per_gb FROM storage_policy
        WHERE tier = ${sub?.tier ?? "free"} LIMIT 1
      `)).rows as any[];
    } catch { /* storage_policy 미존재 */ }

    const [poolRow] = (await superAdminDb.execute(sql`
      SELECT is_readonly, upload_blocked, readonly_reason, payment_failed_at,
             subscription_status, subscription_tier, first_payment_used
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];

    let daysUntilDeletion: number | null = null;
    if (poolRow?.payment_failed_at) {
      const failedAt = new Date(poolRow.payment_failed_at);
      const deletionAt = new Date(failedAt.getTime() + 14 * 86_400_000);
      daysUntilDeletion = Math.max(0, Math.ceil((deletionAt.getTime() - Date.now()) / 86_400_000));
    }

    // resolver로 구독 상태 계산 (source, startsAt, endsAt, trialEndsAt 포함)
    const resolved = await resolveSubscription(poolId);
    const { memberLimit, storageGb: storageQuotaGb, videoEnabled, source,
            startsAt, endsAt, trialEndsAt, effectiveReason } = resolved;

    const storageUsedGb = +(usedBytes / (1024 ** 3)).toFixed(3);
    const storageUsedPct = storageQuotaGb > 0 ? Math.round((storageUsedGb / storageQuotaGb) * 100) : 0;
    const firstPaymentUsed = !!poolRow?.first_payment_used;

    res.json({
      subscription: sub ?? null,
      card: card ?? null,
      member_count: memberCount,
      member_limit: memberLimit,
      plans,
      storage_used_gb: storageUsedGb,
      storage_quota_gb: storageQuotaGb,
      storage_used_pct: storageUsedPct,
      extra_price_per_gb: Number(storagePolicyRow?.extra_price_per_gb ?? 500),
      payment_provider: getPaymentProvider().name,
      first_payment_used: firstPaymentUsed,
      video_upload_allowed: videoEnabled,
      // 결제 실패 / 읽기전용 상태
      is_readonly: !!poolRow?.is_readonly,
      upload_blocked: !!poolRow?.upload_blocked,
      readonly_reason: poolRow?.readonly_reason ?? null,
      payment_failed_at: poolRow?.payment_failed_at ?? null,
      subscription_status: resolved.status,
      subscription_tier: resolved.planCode,
      current_plan: resolved.planCode,
      days_until_deletion: daysUntilDeletion,
      // resolver 확장 필드
      subscription_source: source,
      subscription_starts_at: startsAt,
      subscription_ends_at: endsAt,
      trial_ends_at: trialEndsAt,
      effective_reason: effectiveReason,
      plan_name: resolved.planName,
      white_label_enabled: resolved.whiteLabelEnabled,
      price_per_month: resolved.pricePerMonth,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 카드 등록 ─────────────────────────────────────────────────────────
router.post("/cards", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { card_number, expiry, birth_or_biz, password, card_nickname } = req.body;
  if (!card_number || !expiry) {
    res.status(400).json({ error: "카드번호와 유효기간을 입력해주세요." }); return;
  }
  const digits = card_number.replace(/[\s-]/g, "");
  if (!/^\d{15,16}$/.test(digits)) {
    res.status(400).json({ error: "카드번호 형식이 올바르지 않습니다." }); return;
  }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const pg = getPaymentProvider();
    const { billingKey, cardLast4, cardBrand } = await pg.issueBillingKey({
      cardNumber: digits, expiry, birthOrBiz: birth_or_biz, password,
    });

    // 기존 카드 비기본으로 변경
    await db.execute(sql`
      UPDATE payment_cards SET is_default = false WHERE swimming_pool_id = ${poolId}
    `);
    const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const [newCard] = (await db.execute(sql`
      INSERT INTO payment_cards (id, swimming_pool_id, card_last4, card_brand, billing_key, card_nickname, is_default)
      VALUES (${id}, ${poolId}, ${cardLast4}, ${cardBrand}, ${billingKey}, ${card_nickname ?? null}, true)
      RETURNING id, card_last4, card_brand, card_nickname, is_default, created_at
    `)).rows as any[];

    await db.execute(sql`
      INSERT INTO pool_subscriptions (swimming_pool_id, tier, card_id, status)
      VALUES (${poolId}, 'free', ${id}, 'active')
      ON CONFLICT (swimming_pool_id)
      DO UPDATE SET card_id = ${id}, status = 'active', updated_at = now()
    `);

    res.status(201).json(newCard);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: err?.message ?? "카드 등록 중 오류가 발생했습니다." });
  }
});

// ── 카드 삭제 ─────────────────────────────────────────────────────────
router.delete("/cards/:id", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [card] = (await db.execute(sql`
      SELECT billing_key FROM payment_cards
      WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!card) { res.status(404).json({ error: "카드를 찾을 수 없습니다." }); return; }

    try { await getPaymentProvider().deleteBillingKey(card.billing_key); } catch {}
    await db.execute(sql`
      DELETE FROM payment_cards WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
    `);
    await db.execute(sql`
      UPDATE pool_subscriptions SET card_id = NULL, updated_at = now()
      WHERE swimming_pool_id = ${poolId}
    `);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 구독 신청 / 플랜 변경 (스토어 결제 정책) ──────────────────────────
// - 업그레이드: 즉시 적용 (기존 플랜 종료 → 새 플랜 active)
// - 다운그레이드: next_billing_date 이후 예약 적용 (현재 플랜 유지)
// - 무료 전환: 결제 없이 즉시 처리
// - 일할 계산 없음 / 첫 결제 할인 없음
router.post("/subscribe", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { tier } = req.body;
  if (!tier) { res.status(400).json({ error: "구독 단계를 선택해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [newPlan] = (await db.execute(sql`
      SELECT * FROM subscription_plans WHERE tier = ${tier} LIMIT 1
    `)).rows as any[];
    if (!newPlan) { res.status(404).json({ error: "존재하지 않는 플랜입니다." }); return; }

    const [sub] = (await db.execute(sql`
      SELECT * FROM pool_subscriptions WHERE swimming_pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    const [curPlan] = (await db.execute(sql`
      SELECT price_per_month FROM subscription_plans WHERE tier = ${sub?.tier ?? "free"} LIMIT 1
    `)).rows as any[];

    const currentPrice = Number(curPlan?.price_per_month ?? 0);
    const newPrice     = Number(newPlan.price_per_month);

    // 동일 플랜 재신청 방지
    if (sub?.tier === tier && sub?.status === "active" && !sub?.pending_tier) {
      res.status(400).json({ error: "이미 동일한 플랜을 이용 중입니다." }); return;
    }

    const [card] = (await db.execute(sql`
      SELECT * FROM payment_cards WHERE swimming_pool_id = ${poolId} AND is_default = true LIMIT 1
    `)).rows as any[];

    if (newPrice > 0 && !card) {
      res.status(400).json({ error: "결제 카드를 먼저 등록해주세요." }); return;
    }

    const today      = new Date();
    const todayStr   = today.toISOString().split("T")[0];
    const nextBilling = addOneMonth(today);
    const isDowngrade = newPrice < currentPrice && currentPrice > 0;

    // ─ 다운그레이드: 현재 플랜 유지 + next_billing_date에 전환 예약 ─
    if (isDowngrade && sub?.next_billing_at) {
      await db.execute(sql`
        UPDATE pool_subscriptions
        SET pending_tier = ${tier}, downgrade_at = ${sub.next_billing_at}, updated_at = now()
        WHERE swimming_pool_id = ${poolId}
      `);
      const actorInfo = await getActorInfo(req.user!.userId);
      logEvent({
        pool_id: poolId, category: "구독", actor_id: req.user!.userId, actor_name: actorInfo.name,
        description: `플랜 다운그레이드 예약 — ${sub.tier} → ${tier} (${sub.next_billing_at} 적용)`,
        metadata: { from: sub.tier, to: tier, applies_at: sub.next_billing_at },
      }).catch(console.error);
      res.json({
        success: true, change_type: "downgrade",
        applies_at: sub.next_billing_at,
        message: `현재 플랜은 ${sub.next_billing_at}까지 유지되며, 이후 ${newPlan.name} 플랜으로 전환됩니다.`,
      });
      return;
    }

    // ─ 무료 플랜: 결제 없이 즉시 전환 ─
    if (newPrice === 0) {
      await db.execute(sql`
        INSERT INTO pool_subscriptions
          (swimming_pool_id, tier, card_id, status, current_period_start, next_billing_at)
        VALUES (${poolId}, ${tier}, ${card?.id ?? null}, 'active', ${todayStr}, NULL)
        ON CONFLICT (swimming_pool_id) DO UPDATE
          SET tier = ${tier}, status = 'active', pending_tier = NULL, downgrade_at = NULL,
              current_period_start = ${todayStr}, next_billing_at = NULL, updated_at = now()
      `);
      const actorInfo = await getActorInfo(req.user!.userId);
      logEvent({
        pool_id: poolId, category: "구독", actor_id: req.user!.userId, actor_name: actorInfo.name,
        description: `무료 플랜으로 전환`,
        metadata: { tier },
      }).catch(console.error);
      res.json({ success: true, change_type: "free", next_billing_at: null });
      return;
    }

    // ─ 업그레이드 또는 신규 유료 구독: 즉시 결제 후 적용 ─
    // 최초 결제 1회 한정 50% 할인 정책
    const [poolInfoRow] = (await superAdminDb.execute(sql`
      SELECT first_payment_used, name FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    const firstPaymentUsed = !!poolInfoRow?.first_payment_used;
    const poolName         = poolInfoRow?.name ?? poolId;
    const isFirstPayment   = !firstPaymentUsed && currentPrice === 0;

    const grossAmount    = newPrice;
    const introDiscount  = isFirstPayment ? Math.round(grossAmount * 0.5) : 0;
    const chargedAmount  = grossAmount - introDiscount;

    const isUpgrade = newPrice > currentPrice;
    const orderName = isFirstPayment
      ? `${newPlan.name} 첫 달 50% 할인`
      : isUpgrade
        ? `${sub?.tier ?? "무료"} → ${tier} 업그레이드`
        : `${newPlan.name} 구독`;
    const orderId = `ord_${isUpgrade ? "upg" : "sub"}_${Date.now()}`;

    const result = await getPaymentProvider().charge({
      billingKey: card.billing_key, amount: chargedAmount,
      orderName, orderId, poolId,
    });

    const planIdStr = (newPlan.plan_id && newPlan.plan_id !== "") ? newPlan.plan_id : tier;
    await recordPayment({
      poolId, poolName,
      amount: chargedAmount, status: result.success ? "success" : "failed",
      type: isUpgrade ? "upgrade" : "subscription",
      description: isFirstPayment
        ? `${newPlan.name} 첫 달 결제 (50% 할인 적용, ${grossAmount.toLocaleString()}원 → ${chargedAmount.toLocaleString()}원)`
        : isUpgrade
          ? `플랜 업그레이드 — ${sub?.tier ?? "무료"} → ${tier} (${chargedAmount.toLocaleString()}원)`
          : `${newPlan.name} 월 구독 결제 (${chargedAmount.toLocaleString()}원)`,
      periodStart: todayStr, periodEnd: nextBilling,
      planId: planIdStr, planName: newPlan.name,
      eventType: isFirstPayment ? "first_payment" : isUpgrade ? "upgrade" : "renewal",
      grossAmount, introDiscount,
    });

    if (!result.success) {
      // 결제 실패: 읽기모드 전환
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET subscription_status = 'payment_failed', is_readonly = true, upload_blocked = true,
            readonly_reason = 'payment_failed', payment_failed_at = now(), updated_at = now()
        WHERE id = ${poolId}
      `);
      res.status(402).json({ error: "결제 실패: " + result.errorMessage }); return;
    }

    // 결제 성공 → 즉시 구독 적용 (기존 플랜 종료 + 새 플랜 active)
    await db.execute(sql`
      INSERT INTO pool_subscriptions
        (swimming_pool_id, tier, card_id, status, current_period_start, next_billing_at, pending_tier, downgrade_at)
      VALUES (${poolId}, ${tier}, ${card.id}, 'active', ${todayStr}, ${nextBilling}, NULL, NULL)
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET tier = ${tier}, status = 'active', card_id = ${card.id},
            current_period_start = ${todayStr}, next_billing_at = ${nextBilling},
            pending_tier = NULL, downgrade_at = NULL, updated_at = now()
    `);

    // swimming_pools 구독 상태 동기화 + 최초 결제 사용 여부 기록 + 화이트라벨 자동 활성화
    await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'active', subscription_tier = ${tier},
          is_readonly = false, upload_blocked = false, readonly_reason = null,
          payment_failed_at = null,
          first_payment_used = CASE WHEN ${isFirstPayment} THEN TRUE ELSE first_payment_used END,
          white_label_enabled = true,
          hide_platform_name = true,
          updated_at = now()
      WHERE id = ${poolId}
    `);

    const actorInfo = await getActorInfo(req.user!.userId);
    logEvent({
      pool_id: poolId, category: isUpgrade ? "구독" : "결제",
      actor_id: req.user!.userId, actor_name: actorInfo.name,
      description: isFirstPayment
        ? `첫 구독 50% 할인 — ${newPlan.name} (${grossAmount.toLocaleString()}원 → ${chargedAmount.toLocaleString()}원)`
        : isUpgrade
          ? `플랜 업그레이드 — ${sub?.tier ?? "무료"} → ${tier} (${chargedAmount.toLocaleString()}원)`
          : `구독 시작 — ${newPlan.name} (${chargedAmount.toLocaleString()}원/월)`,
      metadata: { tier, plan_name: newPlan.name, price: chargedAmount, gross: grossAmount, discount: introDiscount },
    }).catch(console.error);

    res.json({
      success: true,
      change_type: isFirstPayment ? "first_payment" : isUpgrade ? "upgrade" : "new",
      next_billing_at: nextBilling,
      charged_amount: chargedAmount,
      gross_amount: grossAmount,
      intro_discount: introDiscount,
      first_payment_discount: isFirstPayment,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message ?? "구독 처리 중 오류가 발생했습니다." });
  }
});

// ── 추가 저장 용량 (전체 월 금액 결제 — 일할 계산 없음) ───────────────
router.post("/storage-addon", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const extra_gb = Number(req.body.extra_gb);
  if (!extra_gb || extra_gb <= 0) { res.status(400).json({ error: "추가할 용량(GB)을 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [card] = (await db.execute(sql`
      SELECT * FROM payment_cards WHERE swimming_pool_id = ${poolId} AND is_default = true LIMIT 1
    `)).rows as any[];
    if (!card) { res.status(400).json({ error: "결제 카드를 먼저 등록해주세요." }); return; }

    const [sub] = (await db.execute(sql`
      SELECT tier, next_billing_at FROM pool_subscriptions
      WHERE swimming_pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    const [policy] = (await db.execute(sql`
      SELECT extra_price_per_gb FROM storage_policy WHERE tier = ${sub?.tier ?? "free"} LIMIT 1
    `)).rows as any[];
    const pricePerGb    = Number(policy?.extra_price_per_gb ?? 500);
    const monthlyAmount = Math.round(pricePerGb * extra_gb);

    const today    = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const periodEnd = sub?.next_billing_at ?? addOneMonth(today);

    const orderId = `ord_stor_${Date.now()}`;
    const result = await getPaymentProvider().charge({
      billingKey: card.billing_key, amount: monthlyAmount,
      orderName: `추가 저장 용량 ${extra_gb}GB`,
      orderId, poolId,
    });

    await recordPayment({
      poolId, amount: monthlyAmount, status: result.success ? "success" : "failed",
      type: "storage_addon",
      description: `추가 저장 용량 ${extra_gb}GB (${monthlyAmount.toLocaleString()}원/월)`,
      periodStart: todayStr, periodEnd,
      planId: sub?.tier ?? "free",
    });

    if (!result.success) {
      res.status(402).json({ error: "결제 실패: " + result.errorMessage }); return;
    }

    await db.execute(sql`
      UPDATE pool_subscriptions
      SET extra_storage_gb = extra_storage_gb + ${extra_gb},
          extra_storage_price = extra_storage_price + ${monthlyAmount},
          updated_at = now()
      WHERE swimming_pool_id = ${poolId}
    `);

    const addonActor = await getActorInfo(req.user!.userId);
    logEvent({
      pool_id: poolId,
      category: "저장공간",
      actor_id: req.user!.userId,
      actor_name: addonActor.name,
      description: `추가 저장 용량 구매 — ${extra_gb}GB (${monthlyAmount.toLocaleString()}원)`,
      metadata: { extra_gb, monthly_amount: monthlyAmount },
    }).catch(console.error);

    res.json({ success: true, charge_amount: monthlyAmount, monthly_amount: monthlyAmount });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message ?? "추가 용량 구독 중 오류가 발생했습니다." });
  }
});

// ── 결제 내역 ────────────────────────────────────────────────────────
router.get("/history", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }
    const rows = (await superAdminDb.execute(sql`
      SELECT * FROM payment_logs
      WHERE swimming_pool_id = ${poolId}
      ORDER BY created_at DESC LIMIT 50
    `)).rows;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 구독 해지 ────────────────────────────────────────────────────────
router.post("/cancel", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const cancelActor = await getActorInfo(req.user!.userId);
    const poolId = cancelActor.pool_id;
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [sub] = (await db.execute(sql`
      SELECT tier FROM pool_subscriptions WHERE swimming_pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    await db.execute(sql`
      UPDATE pool_subscriptions SET status = 'cancelled', updated_at = now()
      WHERE swimming_pool_id = ${poolId}
    `);

    logEvent({
      pool_id: poolId,
      category: "해지",
      actor_id: req.user!.userId,
      actor_name: cancelActor.name,
      description: `구독 해지 신청 — ${sub?.tier ?? "현재"} 플랜 (기간 종료 후 해지)`,
      metadata: { tier: sub?.tier },
    }).catch(console.error);

    res.json({ success: true, message: "현재 구독 기간 종료 후 자동으로 해지됩니다." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 재결제 (결제 실패 후 복구) ────────────────────────────────────────
router.post("/retry", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [poolRow] = (await superAdminDb.execute(sql`
      SELECT subscription_status, subscription_tier FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];

    if (!["payment_failed", "pending_deletion"].includes(poolRow?.subscription_status)) {
      res.status(400).json({ error: "현재 재결제가 필요한 상태가 아닙니다." }); return;
    }

    const [card] = (await db.execute(sql`
      SELECT * FROM payment_cards WHERE swimming_pool_id = ${poolId} AND is_default = true LIMIT 1
    `)).rows as any[];
    if (!card) { res.status(400).json({ error: "등록된 결제 카드가 없습니다." }); return; }

    const [plan] = (await db.execute(sql`
      SELECT * FROM subscription_plans WHERE tier = ${poolRow.subscription_tier} LIMIT 1
    `)).rows as any[];
    if (!plan) { res.status(404).json({ error: "구독 플랜을 찾을 수 없습니다." }); return; }

    const orderId = `ord_retry_${Date.now()}`;
    const result = await getPaymentProvider().charge({
      billingKey: card.billing_key,
      amount: plan.price_per_month,
      orderName: `${plan.name} 재결제`,
      orderId,
      poolId,
    });

    const planIdStr = (plan.plan_id && plan.plan_id !== "") ? plan.plan_id : poolRow.subscription_tier;
    await recordPayment({
      poolId,
      amount: plan.price_per_month,
      status: result.success ? "success" : "failed",
      type: "retry",
      description: `${plan.name} 재결제`,
      planId: planIdStr,
      planName: plan.name,
      poolName: (await superAdminDb.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`)).rows[0]?.name as string | undefined,
      eventType: "retry",
    });

    if (!result.success) {
      res.status(402).json({ error: "재결제에 실패했습니다: " + result.errorMessage }); return;
    }

    // 결제 성공 → 정상 복구
    await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'active',
          is_readonly = false,
          upload_blocked = false,
          readonly_reason = null,
          payment_failed_at = null,
          updated_at = now()
      WHERE id = ${poolId}
    `);

    const todayStr = new Date().toISOString().split("T")[0];
    await db.execute(sql`
      INSERT INTO pool_subscriptions
        (swimming_pool_id, tier, card_id, status, current_period_start, next_billing_at)
      VALUES (${poolId}, ${poolRow.subscription_tier}, ${card.id}, 'active', ${todayStr}, ${addOneMonth()})
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET status = 'active', next_billing_at = ${addOneMonth()}, updated_at = now()
    `);

    logEvent({
      pool_id: poolId,
      category: "결제",
      actor_id: req.user!.userId,
      actor_name: "관리자",
      description: `재결제 성공 — ${plan.name}`,
      metadata: { tier: poolRow.subscription_tier, amount: plan.price_per_month },
    }).catch(console.error);

    res.json({ success: true, message: "재결제에 성공했습니다. 서비스가 복구되었습니다." });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message ?? "재결제 처리 중 오류가 발생했습니다." });
  }
});

// ── 스토어 환불 이벤트 수신 (앱스토어/플레이스토어 서버 알림) ───────────
// 스토어가 환불 처리 시 호출 → payment_status=refunded, 구독 상태 업데이트
router.post("/store-refund", async (req, res) => {
  const { pool_id, plan_id, amount, store_transaction_id } = req.body;
  if (!pool_id) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
  try {
    // 구독 상태를 cancelled로 변경 (CHECK: active|inactive|suspended|cancelled)
    await db.execute(sql`
      UPDATE pool_subscriptions
      SET status = 'cancelled', updated_at = now()
      WHERE swimming_pool_id = ${pool_id}
    `).catch(() => {}); // 구독 레코드 없어도 계속 처리
    // 수영장 읽기모드 전환
    await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'payment_failed',
          is_readonly = true, upload_blocked = true,
          readonly_reason = 'refund', payment_failed_at = now(), updated_at = now()
      WHERE id = ${pool_id}
    `);
    // 환불 payment_logs 기록 (음수 금액)
    const payId  = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const refundAmt = -Math.abs(Number(amount ?? 0));
    await superAdminDb.execute(sql`
      INSERT INTO payment_logs
        (id, swimming_pool_id, amount, status, method, type, description, paid_at)
      VALUES
        (${payId}, ${pool_id}, ${refundAmt}, 'refunded', 'store', 'refund',
         ${`스토어 환불 처리${store_transaction_id ? ` (${store_transaction_id})` : ""}`}, NOW())
    `);
    // revenue_logs에 환불 차감 기록 — refunded_amount 기록 & 정산 반영
    if (Math.abs(refundAmt) > 0) {
      const revId     = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const absAmt    = Math.abs(refundAmt);
      const storeFee  = Math.round(absAmt * 0.3);
      const netRev    = absAmt - storeFee;
      const [poolInfo] = (await superAdminDb.execute(sql`SELECT name FROM swimming_pools WHERE id = ${pool_id} LIMIT 1`)).rows as any[];
      await superAdminDb.execute(sql`
        INSERT INTO revenue_logs
          (id, pool_id, pool_name, plan_id, plan_name, event_type,
           gross_amount, intro_discount_amount, charged_amount,
           store_fee, net_revenue, refunded_amount, payment_provider, occurred_at)
        VALUES
          (${revId}, ${pool_id}, ${poolInfo?.name ?? null},
           ${plan_id ?? null}, NULL, 'refund',
           ${-absAmt}, 0, ${-absAmt},
           ${-storeFee}, ${-netRev}, ${absAmt}, 'store', NOW())
      `).catch(console.error);
    }
    logEvent({
      pool_id, category: "결제",
      actor_id: "store_webhook", actor_name: "스토어",
      description: `환불 처리 — ${Math.abs(refundAmt).toLocaleString()}원`,
      metadata: { plan_id, store_transaction_id, refund_amount: refundAmt },
    }).catch(console.error);
    res.json({ success: true, message: "환불 처리가 반영되었습니다." });
  } catch (err: any) {
    console.error("[store-refund]", err);
    res.status(500).json({ error: err?.message ?? "환불 처리 중 오류가 발생했습니다." });
  }
});

// ── 결제 실패 시뮬레이션 (super_admin 전용 테스트용) ──────────────────
router.post("/simulate-failure", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { pool_id } = req.body;
  if (!pool_id) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
  try {
    await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'payment_failed',
          is_readonly = true,
          upload_blocked = true,
          readonly_reason = 'payment_failed',
          payment_failed_at = now(),
          updated_at = now()
      WHERE id = ${pool_id}
    `);
    res.json({ success: true, message: "결제 실패 상태로 변경되었습니다." });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message ?? "서버 오류" });
  }
});

// ── 결제 실패 타임라인 + 다운그레이드 예약 처리 크론 ─────────────────
// 매 시간 실행
cron.schedule("0 * * * *", async () => {
  try {
    // 7일 경과 → pending_deletion (enum 값 안전 캐스팅)
    await superAdminDb.execute(sql.raw(`
      UPDATE swimming_pools
      SET subscription_status = 'pending_deletion',
          readonly_reason = 'pending_deletion',
          updated_at = now()
      WHERE subscription_status::text = 'payment_failed'
        AND payment_failed_at IS NOT NULL
        AND NOW() - payment_failed_at >= INTERVAL '7 days'
        AND NOW() - payment_failed_at < INTERVAL '14 days'
    `)).catch((e: any) => console.warn("[billing-cron] 7일 경과 처리 건너뜀:", e.message));

    // 14일 경과 → deleted
    await superAdminDb.execute(sql.raw(`
      UPDATE swimming_pools
      SET subscription_status = 'deleted',
          readonly_reason = 'deleted',
          updated_at = now()
      WHERE subscription_status::text IN ('payment_failed', 'pending_deletion')
        AND payment_failed_at IS NOT NULL
        AND NOW() - payment_failed_at >= INTERVAL '14 days'
    `)).catch((e: any) => console.warn("[billing-cron] 14일 경과 처리 건너뜀:", e.message));

    // 다운그레이드 예약 처리: downgrade_at이 오늘 이하인 레코드에 pending_tier 적용
    const pendingDowngrades = (await db.execute(sql`
      SELECT swimming_pool_id, pending_tier FROM pool_subscriptions
      WHERE pending_tier IS NOT NULL
        AND downgrade_at IS NOT NULL
        AND downgrade_at <= CURRENT_DATE
    `)).rows as any[];

    for (const row of pendingDowngrades) {
      const todayStr = new Date().toISOString().split("T")[0];
      await db.execute(sql`
        UPDATE pool_subscriptions
        SET tier = ${row.pending_tier}, status = 'active',
            pending_tier = NULL, downgrade_at = NULL,
            current_period_start = ${todayStr},
            next_billing_at = ${addOneMonth()},
            updated_at = now()
        WHERE swimming_pool_id = ${row.swimming_pool_id}
      `);
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET subscription_tier = ${row.pending_tier}, updated_at = now()
        WHERE id = ${row.swimming_pool_id}
      `);
      console.log(`[billing-cron] 다운그레이드 적용: ${row.swimming_pool_id} → ${row.pending_tier}`);
    }

    console.log("[billing-cron] 타임라인/다운그레이드 업데이트 완료");

    // ── pending 상태 자동 확정 (연기예정/퇴원예정 → 연기/퇴원) ──────────
    // 기준: pending_effective_month <= 현재 YYYY-MM 인 회원 전체 자동 전환
    // idempotent: pending 필드를 null로 초기화하므로 중복 실행 안전
    const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    try {
      const pendingStudents = (await db.execute(sql`
        SELECT id, pending_status_change, class_group_id
        FROM students
        WHERE pending_status_change IS NOT NULL
          AND pending_effective_mode = 'next_month'
          AND pending_effective_month IS NOT NULL
          AND pending_effective_month <= ${currentMonth}
      `)).rows as any[];

      if (pendingStudents.length > 0) {
        for (const s of pendingStudents) {
          const newStatus = s.pending_status_change as string;
          const fromPending = s.pending_status_change as string;
          // suspended: withdrawn_at 건드리지 않음
          // withdrawn: withdrawn_at = NOW() 추가
          if (newStatus === "withdrawn") {
            await db.execute(sql`
              UPDATE students
              SET
                status                  = ${newStatus},
                class_group_id          = NULL,
                assigned_class_ids      = '[]'::jsonb,
                schedule_labels         = NULL,
                archived_reason         = ${newStatus},
                pending_status_change   = NULL,
                pending_effective_mode  = NULL,
                pending_effective_month = NULL,
                withdrawn_at            = NOW(),
                updated_at              = NOW()
              WHERE id = ${s.id}
            `);
          } else {
            await db.execute(sql`
              UPDATE students
              SET
                status                  = ${newStatus},
                class_group_id          = NULL,
                assigned_class_ids      = '[]'::jsonb,
                schedule_labels         = NULL,
                archived_reason         = ${newStatus},
                pending_status_change   = NULL,
                pending_effective_mode  = NULL,
                pending_effective_month = NULL,
                updated_at              = NOW()
              WHERE id = ${s.id}
            `);
          }
          console.log(`[MONTHLY_STATUS_UPDATE] student: ${s.id} from: ${fromPending} → status 적용 완료`);
        }
        console.log(`[MONTHLY_STATUS_UPDATE] 월 전환 완료: ${pendingStudents.length}명 (월: ${currentMonth})`);
      }
    } catch (e: any) {
      console.warn("[pending-cron] pending 자동 확정 건너뜀:", e.message);
    }
  } catch (err) {
    console.error("[billing-cron] 크론 오류:", err);
  }
});

// ── 슈퍼관리자 매출정산 조회 ─────────────────────────────────────────
// GET /billing/revenue-logs — 전체 매출 기록 (슈퍼관리자 전용)
// ?start=YYYY-MM-DD&end=YYYY-MM-DD&limit=500
router.get("/revenue-logs", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensureBillingTables();
    const { start, end, limit = "500" } = req.query as { start?: string; end?: string; limit?: string };
    const rows = (await superAdminDb.execute(sql`
      SELECT
        rl.id,
        rl.pool_id,
        COALESCE(rl.pool_name, sp.name)  AS pool_name,
        rl.plan_id,
        COALESCE(rl.plan_name, pp.name)  AS plan_name,
        rl.event_type,
        COALESCE(rl.gross_amount, 0)                                                        AS gross_amount,
        COALESCE(rl.intro_discount_amount, 0)                                               AS intro_discount_amount,
        COALESCE(rl.charged_amount, 0)                                                      AS charged_amount,
        COALESCE(rl.refunded_amount, 0)                                                     AS refunded_amount,
        COALESCE(rl.store_fee, 0)                                                           AS store_fee,
        COALESCE(rl.net_revenue, 0)                                                         AS net_revenue,
        COALESCE(rl.payment_provider, 'store')                                             AS payment_provider,
        COALESCE(rl.occurred_at, rl.created_at)                                            AS occurred_at,
        rl.created_at
      FROM revenue_logs rl
      LEFT JOIN swimming_pools sp ON sp.id = rl.pool_id
      LEFT JOIN subscription_plans pp ON pp.tier = rl.plan_id
      WHERE (${start ?? null}::date IS NULL OR COALESCE(rl.occurred_at, rl.created_at) >= ${start ?? null}::date)
        AND (${end ?? null}::date IS NULL OR COALESCE(rl.occurred_at, rl.created_at) <= (${end ?? null}::date + INTERVAL '1 day'))
      ORDER BY COALESCE(rl.occurred_at, rl.created_at) DESC
      LIMIT ${parseInt(limit as string)}
    `)).rows;

    const totalGross     = rows.reduce((s: number, r: any) => s + Number(r.gross_amount ?? 0), 0);
    const totalCharged   = rows.reduce((s: number, r: any) => s + Number(r.charged_amount ?? 0), 0);
    const totalStoreFee  = rows.reduce((s: number, r: any) => s + Number(r.store_fee ?? 0), 0);
    const totalNetRevenue = rows.reduce((s: number, r: any) => s + Number(r.net_revenue ?? 0), 0);
    const totalRefunded  = rows.reduce((s: number, r: any) => s + Number(r.refunded_amount ?? 0), 0);
    const totalDiscount  = rows.reduce((s: number, r: any) => s + Number(r.intro_discount_amount ?? 0), 0);

    res.json({
      logs: rows,
      summary: {
        total_gross: totalGross,
        total_charged: totalCharged,
        total_discount: totalDiscount,
        total_store_fee: totalStoreFee,
        total_net_revenue: totalNetRevenue,
        total_refunded: totalRefunded,
        count: rows.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /billing/revenue-by-plan — 플랜별 매출 집계 (슈퍼관리자 전용)
router.get("/revenue-by-plan", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensureBillingTables();
    const rows = (await superAdminDb.execute(sql`
      SELECT
        rl.plan_id,
        pp.name AS plan_name,
        COUNT(*)::int AS payment_count,
        SUM(rl.charged_amount)::int AS total_amount,
        SUM(rl.store_fee)::int AS total_store_fee,
        SUM(rl.net_revenue)::int AS total_net_revenue
      FROM revenue_logs rl
      LEFT JOIN subscription_plans pp ON pp.tier = rl.plan_id
      GROUP BY rl.plan_id, pp.name
      ORDER BY SUM(rl.charged_amount) DESC
    `)).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /billing/revenue-by-pool — 수영장별 매출 집계 (슈퍼관리자 전용)
router.get("/revenue-by-pool", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensureBillingTables();
    const rows = (await superAdminDb.execute(sql`
      SELECT
        rl.pool_id,
        sp.name AS pool_name,
        COUNT(*)::int AS payment_count,
        SUM(rl.charged_amount)::int AS total_amount,
        SUM(rl.store_fee)::int AS total_store_fee,
        SUM(rl.net_revenue)::int AS total_net_revenue
      FROM revenue_logs rl
      LEFT JOIN swimming_pools sp ON sp.id = rl.pool_id
      GROUP BY rl.pool_id, sp.name
      ORDER BY SUM(rl.charged_amount) DESC
    `)).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
