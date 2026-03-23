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
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getPaymentProvider } from "../payment/index.js";
import { logEvent } from "../lib/event-logger.js";

const router = Router();

// ── 테이블 보장 (서버 시작 시 1회 실행) ──────────────────────────────
async function ensureBillingTables() {
  // revenue_logs: 결제 발생 시 스토어 수수료·순수익 기록
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS revenue_logs (
      id             TEXT PRIMARY KEY,
      pool_id        TEXT NOT NULL,
      plan_id        TEXT NOT NULL,
      amount         INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'store',
      store_fee      INTEGER NOT NULL DEFAULT 0,
      net_revenue    INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // 다운그레이드 예약 컬럼 추가 (없으면 추가)
  await db.execute(sql`ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS pending_tier TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE pool_subscriptions ADD COLUMN IF NOT EXISTS downgrade_at DATE`).catch(() => {});
  // subscription_plans에 is_active 컬럼 추가
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});
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
  pgTransactionId?: string; planId?: string;
}): Promise<string> {
  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute(sql`
    INSERT INTO payment_logs
      (id, swimming_pool_id, amount, status, method, type, description,
       billing_period_start, billing_period_end, paid_at)
    VALUES
      (${id}, ${params.poolId}, ${params.amount}, ${params.status},
       'store', ${params.type}, ${params.description},
       ${params.periodStart ?? null}, ${params.periodEnd ?? null},
       ${params.status === "success" ? sql`now()` : null})
  `);
  // 성공 결제 → revenue_logs 기록 (스토어 수수료 30%)
  if (params.status === "success" && params.planId && params.amount > 0) {
    const revId = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const storeFee = Math.round(params.amount * 0.3);
    const netRevenue = params.amount - storeFee;
    await db.execute(sql`
      INSERT INTO revenue_logs (id, pool_id, plan_id, amount, payment_method, store_fee, net_revenue)
      VALUES (${revId}, ${params.poolId}, ${params.planId}, ${params.amount}, 'store', ${storeFee}, ${netRevenue})
    `).catch(console.error);
  }
  return id;
}

// ── 현재 구독 현황 ────────────────────────────────────────────────────
router.get("/status", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const [sub] = (await db.execute(sql`
      SELECT ps.*, sp.name AS plan_name, sp.price_per_month, sp.member_limit, sp.storage_gb
      FROM pool_subscriptions ps
      LEFT JOIN subscription_plans sp ON sp.tier = ps.tier
      WHERE ps.swimming_pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    const [card] = (await db.execute(sql`
      SELECT id, card_last4, card_brand, card_nickname, is_default, created_at
      FROM payment_cards WHERE swimming_pool_id = ${poolId}
      ORDER BY is_default DESC, created_at DESC LIMIT 1
    `)).rows as any[];

    // 과금 카운트: active + unregistered + pending + suspended + withdrawn 포함
    // archived(기록보존) / deleted(영구삭제) 는 과금 제외
    const cntResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId}
        AND status NOT IN ('archived', 'deleted')
    `);
    const memberCount = Number((cntResult.rows[0] as any)?.cnt ?? 0);

    const plans = (await db.execute(sql`
      SELECT * FROM subscription_plans ORDER BY price_per_month ASC
    `)).rows;

    const storageResult = await db.execute(sql`
      SELECT COALESCE(SUM(file_size_bytes),0) AS used_bytes
      FROM student_photos WHERE swimming_pool_id = ${poolId}
    `);
    const usedBytes = Number((storageResult.rows[0] as any)?.used_bytes ?? 0);

    const [storagePolicyRow] = (await db.execute(sql`
      SELECT quota_gb, extra_price_per_gb FROM storage_policy
      WHERE tier = ${sub?.tier ?? "free"} LIMIT 1
    `)).rows as any[];

    const [poolRow] = (await db.execute(sql`
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

    const currentPlan = plans.find((p: any) => p.tier === (sub?.tier ?? poolRow?.subscription_tier));
    const memberLimit = Number(currentPlan?.member_limit ?? 5);
    const storageQuotaGb = Number(currentPlan?.storage_gb ?? 0.1);
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
      // 결제 실패 / 읽기전용 상태
      is_readonly: !!poolRow?.is_readonly,
      upload_blocked: !!poolRow?.upload_blocked,
      readonly_reason: poolRow?.readonly_reason ?? null,
      payment_failed_at: poolRow?.payment_failed_at ?? null,
      subscription_status: poolRow?.subscription_status ?? null,
      days_until_deletion: daysUntilDeletion,
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

    // ─ 업그레이드 또는 신규 유료 구독: 전체 월 금액 결제 후 즉시 적용 ─
    const isUpgrade = newPrice > currentPrice;
    const orderId = `ord_${isUpgrade ? "upg" : "sub"}_${Date.now()}`;
    const result = await getPaymentProvider().charge({
      billingKey: card.billing_key, amount: newPrice,
      orderName: isUpgrade ? `${sub?.tier ?? "무료"} → ${tier} 업그레이드` : `${newPlan.name} 구독`,
      orderId, poolId,
    });

    await recordPayment({
      poolId, amount: newPrice, status: result.success ? "success" : "failed",
      type: isUpgrade ? "upgrade" : "subscription",
      description: isUpgrade
        ? `플랜 업그레이드 — ${sub?.tier ?? "무료"} → ${tier} (${newPrice.toLocaleString()}원)`
        : `${newPlan.name} 월 구독 결제 (${newPrice.toLocaleString()}원)`,
      periodStart: todayStr, periodEnd: nextBilling,
      planId: tier,
    });

    if (!result.success) {
      // 결제 실패: 읽기모드 전환
      await db.execute(sql`
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

    // swimming_pools 구독 상태 동기화
    await db.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'active', subscription_tier = ${tier},
          is_readonly = false, upload_blocked = false, readonly_reason = null,
          payment_failed_at = null, updated_at = now()
      WHERE id = ${poolId}
    `);

    const actorInfo = await getActorInfo(req.user!.userId);
    logEvent({
      pool_id: poolId, category: isUpgrade ? "구독" : "결제",
      actor_id: req.user!.userId, actor_name: actorInfo.name,
      description: isUpgrade
        ? `플랜 업그레이드 — ${sub?.tier ?? "무료"} → ${tier} (${newPrice.toLocaleString()}원)`
        : `구독 시작 — ${newPlan.name} (${newPrice.toLocaleString()}원/월)`,
      metadata: { tier, plan_name: newPlan.name, price: newPrice },
    }).catch(console.error);

    res.json({ success: true, change_type: isUpgrade ? "upgrade" : "new", next_billing_at: nextBilling });
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
    const rows = (await db.execute(sql`
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

    const [poolRow] = (await db.execute(sql`
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

    await recordPayment({
      poolId,
      amount: plan.price_per_month,
      status: result.success ? "success" : "failed",
      type: "retry",
      description: `${plan.name} 재결제`,
    });

    if (!result.success) {
      res.status(402).json({ error: "재결제에 실패했습니다: " + result.errorMessage }); return;
    }

    // 결제 성공 → 정상 복구
    await db.execute(sql`
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
    // 구독 상태를 refunded로 변경
    await db.execute(sql`
      UPDATE pool_subscriptions
      SET status = 'refunded', updated_at = now()
      WHERE swimming_pool_id = ${pool_id}
    `);
    // 수영장 읽기모드 전환
    await db.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'payment_failed',
          is_readonly = true, upload_blocked = true,
          readonly_reason = 'refund', payment_failed_at = now(), updated_at = now()
      WHERE id = ${pool_id}
    `);
    // 환불 payment_logs 기록 (음수 금액)
    const payId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const refundAmt = -Math.abs(Number(amount ?? 0));
    await db.execute(sql`
      INSERT INTO payment_logs
        (id, swimming_pool_id, amount, status, method, type, description, paid_at)
      VALUES
        (${payId}, ${pool_id}, ${refundAmt}, 'refunded', 'store', 'refund',
         ${`스토어 환불 처리${store_transaction_id ? ` (${store_transaction_id})` : ""}`}, NOW())
    `);
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
    await db.execute(sql`
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
    // 7일 경과 → pending_deletion
    await db.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'pending_deletion',
          readonly_reason = 'pending_deletion',
          updated_at = now()
      WHERE subscription_status = 'payment_failed'
        AND payment_failed_at IS NOT NULL
        AND NOW() - payment_failed_at >= INTERVAL '7 days'
        AND NOW() - payment_failed_at < INTERVAL '14 days'
    `);

    // 14일 경과 → deleted
    await db.execute(sql`
      UPDATE swimming_pools
      SET subscription_status = 'deleted',
          readonly_reason = 'deleted',
          updated_at = now()
      WHERE subscription_status IN ('payment_failed', 'pending_deletion')
        AND payment_failed_at IS NOT NULL
        AND NOW() - payment_failed_at >= INTERVAL '14 days'
    `);

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
      await db.execute(sql`
        UPDATE swimming_pools SET subscription_tier = ${row.pending_tier}, updated_at = now()
        WHERE id = ${row.swimming_pool_id}
      `);
      console.log(`[billing-cron] 다운그레이드 적용: ${row.swimming_pool_id} → ${row.pending_tier}`);
    }

    console.log("[billing-cron] 타임라인/다운그레이드 업데이트 완료");
  } catch (err) {
    console.error("[billing-cron] 크론 오류:", err);
  }
});

// ── 슈퍼관리자 매출정산 조회 ─────────────────────────────────────────
// GET /billing/revenue-logs — 전체 매출 기록 (슈퍼관리자 전용)
router.get("/revenue-logs", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensureBillingTables();
    const rows = (await db.execute(sql`
      SELECT
        rl.*,
        sp.name AS pool_name,
        pp.name AS plan_name
      FROM revenue_logs rl
      LEFT JOIN swimming_pools sp ON sp.id = rl.pool_id
      LEFT JOIN subscription_plans pp ON pp.tier = rl.plan_id
      ORDER BY rl.created_at DESC
      LIMIT 500
    `)).rows;

    const totalRevenue = rows.reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
    const totalStoreFee = rows.reduce((sum: number, r: any) => sum + Number(r.store_fee ?? 0), 0);
    const totalNetRevenue = rows.reduce((sum: number, r: any) => sum + Number(r.net_revenue ?? 0), 0);

    res.json({ logs: rows, summary: { total_revenue: totalRevenue, total_store_fee: totalStoreFee, total_net_revenue: totalNetRevenue } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /billing/revenue-by-plan — 플랜별 매출 집계 (슈퍼관리자 전용)
router.get("/revenue-by-plan", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensureBillingTables();
    const rows = (await db.execute(sql`
      SELECT
        rl.plan_id,
        pp.name AS plan_name,
        COUNT(*)::int AS payment_count,
        SUM(rl.amount)::int AS total_amount,
        SUM(rl.store_fee)::int AS total_store_fee,
        SUM(rl.net_revenue)::int AS total_net_revenue
      FROM revenue_logs rl
      LEFT JOIN subscription_plans pp ON pp.tier = rl.plan_id
      GROUP BY rl.plan_id, pp.name
      ORDER BY total_amount DESC
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
    const rows = (await db.execute(sql`
      SELECT
        rl.pool_id,
        sp.name AS pool_name,
        COUNT(*)::int AS payment_count,
        SUM(rl.amount)::int AS total_amount,
        SUM(rl.store_fee)::int AS total_store_fee,
        SUM(rl.net_revenue)::int AS total_net_revenue
      FROM revenue_logs rl
      LEFT JOIN swimming_pools sp ON sp.id = rl.pool_id
      GROUP BY rl.pool_id, sp.name
      ORDER BY total_amount DESC
    `)).rows;
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
