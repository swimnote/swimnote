/**
 * billing.ts — 구독 결제 API
 *
 * 결제 처리는 payment/ 모듈에 위임 (Toss / PortOne / Mock 교체 가능)
 * PAYMENT_PROVIDER 환경변수로 프로바이더 선택 (기본: mock)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { getPaymentProvider } from "../payment/index.js";
import { logEvent } from "../lib/event-logger.js";

const router = Router();

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

function daysBetween(from: string | Date, to: string | Date): number {
  const a = new Date(from); const b = new Date(to);
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function prorateAmount(monthlyPrice: number, remainDays: number, totalDays: number): number {
  if (totalDays <= 0 || monthlyPrice <= 0) return 0;
  return Math.round(monthlyPrice * remainDays / totalDays);
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
}): Promise<string> {
  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute(sql`
    INSERT INTO payment_logs
      (id, swimming_pool_id, amount, status, method, type, description,
       billing_period_start, billing_period_end, paid_at)
    VALUES
      (${id}, ${params.poolId}, ${params.amount}, ${params.status},
       'card', ${params.type}, ${params.description},
       ${params.periodStart ?? null}, ${params.periodEnd ?? null},
       ${params.status === "success" ? sql`now()` : null})
  `);
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

    const cntResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students WHERE swimming_pool_id = ${poolId} AND status = 'active'
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

    res.json({
      subscription: sub ?? null,
      card: card ?? null,
      member_count: memberCount,
      plans,
      storage_used_gb: +(usedBytes / (1024 ** 3)).toFixed(3),
      storage_quota_gb: Number(storagePolicyRow?.quota_gb ?? 5),
      extra_price_per_gb: Number(storagePolicyRow?.extra_price_per_gb ?? 500),
      payment_provider: getPaymentProvider().name,
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

// ── 구독 신청 / 업그레이드 (일할 계산) ───────────────────────────────
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

    const [card] = (await db.execute(sql`
      SELECT * FROM payment_cards WHERE swimming_pool_id = ${poolId} AND is_default = true LIMIT 1
    `)).rows as any[];

    if (newPlan.price_per_month > 0 && !card) {
      res.status(400).json({ error: "결제 카드를 먼저 등록해주세요." }); return;
    }

    const today    = new Date();
    const todayStr = today.toISOString().split("T")[0];
    let proAmt = 0;
    let nextBilling = addOneMonth(today);

    // 기존 유료 구독 → 업그레이드 일할 계산
    if (sub?.tier && sub.tier !== "free" && sub.tier !== tier && sub.next_billing_at) {
      const [curPlan] = (await db.execute(sql`
        SELECT price_per_month FROM subscription_plans WHERE tier = ${sub.tier} LIMIT 1
      `)).rows as any[];
      const totalDays  = daysBetween(sub.current_period_start, sub.next_billing_at);
      const remainDays = daysBetween(today, sub.next_billing_at);
      const priceDiff  = newPlan.price_per_month - (curPlan?.price_per_month ?? 0);
      proAmt = prorateAmount(priceDiff, remainDays, totalDays);
      nextBilling = sub.next_billing_at; // 기존 결제 주기 유지

      if (proAmt > 0 && card) {
        const orderId = `ord_upg_${Date.now()}`;
        const result = await getPaymentProvider().charge({
          billingKey: card.billing_key, amount: proAmt,
          orderName: `${sub.tier} → ${tier} 업그레이드 일할 정산`,
          orderId, poolId,
        });
        await recordPayment({
          poolId, amount: proAmt, status: result.success ? "success" : "failed",
          type: "upgrade_prorate",
          description: `구독 업그레이드 일할 정산 (${remainDays}일 잔여)`,
          periodStart: todayStr, periodEnd: sub.next_billing_at,
        });
        if (!result.success) {
          res.status(402).json({ error: "일할 결제 실패: " + result.errorMessage }); return;
        }
      }
    } else if (newPlan.price_per_month > 0 && card) {
      // 신규 유료 구독 결제
      const orderId = `ord_sub_${Date.now()}`;
      const result = await getPaymentProvider().charge({
        billingKey: card.billing_key, amount: newPlan.price_per_month,
        orderName: `${newPlan.name} 구독`,
        orderId, poolId,
      });
      await recordPayment({
        poolId, amount: newPlan.price_per_month, status: result.success ? "success" : "failed",
        type: "subscription",
        description: `${newPlan.name} 월 구독 결제`,
        periodStart: todayStr, periodEnd: nextBilling,
      });
      if (!result.success) {
        res.status(402).json({ error: "구독 결제 실패: " + result.errorMessage }); return;
      }
    }

    await db.execute(sql`
      INSERT INTO pool_subscriptions
        (swimming_pool_id, tier, card_id, status, current_period_start, next_billing_at)
      VALUES (${poolId}, ${tier}, ${card?.id ?? null}, 'active', ${todayStr}, ${nextBilling})
      ON CONFLICT (swimming_pool_id) DO UPDATE
        SET tier = ${tier}, status = 'active',
            current_period_start = CASE WHEN pool_subscriptions.tier = ${tier}
              THEN pool_subscriptions.current_period_start ELSE ${todayStr} END,
            next_billing_at = ${nextBilling}, updated_at = now()
    `);

    const isUpgrade = sub?.tier && sub.tier !== "free" && sub.tier !== tier;
    const actorInfo = await getActorInfo(req.user!.userId);
    logEvent({
      pool_id: poolId,
      category: isUpgrade ? "구독" : "결제",
      actor_id: req.user!.userId,
      actor_name: actorInfo.name,
      description: isUpgrade
        ? `플랜 업그레이드 — ${sub.tier} → ${tier}`
        : `구독 시작 — ${newPlan.name} (${newPlan.price_per_month.toLocaleString()}원/월)`,
      metadata: { tier, plan_name: newPlan.name, price: newPlan.price_per_month, prorate_amount: proAmt },
    }).catch(console.error);

    res.json({ success: true, prorate_amount: proAmt, next_billing_at: nextBilling });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err?.message ?? "구독 처리 중 오류가 발생했습니다." });
  }
});

// ── 추가 저장 용량 (일할 계산) ───────────────────────────────────────
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
      SELECT tier, current_period_start, next_billing_at FROM pool_subscriptions
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
    const totalDays  = sub?.current_period_start ? daysBetween(sub.current_period_start, periodEnd) : 30;
    const remainDays = daysBetween(today, periodEnd);
    const chargeAmt  = prorateAmount(monthlyAmount, remainDays, totalDays);

    const orderId = `ord_stor_${Date.now()}`;
    const result = await getPaymentProvider().charge({
      billingKey: card.billing_key, amount: chargeAmt,
      orderName: `추가 저장 용량 ${extra_gb}GB`,
      orderId, poolId,
    });

    await recordPayment({
      poolId, amount: chargeAmt, status: result.success ? "success" : "failed",
      type: "storage_addon",
      description: `추가 저장 용량 ${extra_gb}GB 일할 정산 (${remainDays}일)`,
      periodStart: todayStr, periodEnd,
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
      description: `추가 저장 용량 구매 — ${extra_gb}GB (${chargeAmt.toLocaleString()}원 결제)`,
      metadata: { extra_gb, charge_amount: chargeAmt, monthly_amount: monthlyAmount },
    }).catch(console.error);

    res.json({ success: true, charge_amount: chargeAmt, monthly_amount: monthlyAmount });
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

export default router;
