/**
 * lib/x-entitlement.ts — SWIMNOTE X Entitlement 동기화 (WP2)
 *
 * RevenueCat webhook → xmode_entitlement 상태 관리
 *
 * 원칙:
 *  - 일반 구독(solo_*, center_*) 이벤트에 영향 없음
 *  - X product ID는 REVENUECAT_X_PRODUCT_IDS env (쉼표 구분)
 *  - xmode_config_status는 절대 수정하지 않음
 *  - CANCELLATION은 즉시 false 처리 금지 (paid period 유지)
 *  - BILLING_ISSUE는 payment_failed_at 기록, entitlement 유지
 *  - xmode_entitlement 변경 시에만 audit_logs 기록
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// ── X Product ID 설정 ──────────────────────────────────────────────────────
// env: REVENUECAT_X_PRODUCT_IDS=swimnote_x_monthly,swimnote_x_monthly:monthly
// 미설정 시 isXProduct() 항상 false → 일반 webhook 흐름 유지
function getXProductIds(): Set<string> {
  const raw = process.env.REVENUECAT_X_PRODUCT_IDS ?? "";
  if (!raw.trim()) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * RevenueCat product ID가 X 전용 상품인지 판정.
 * REVENUECAT_X_PRODUCT_IDS 미설정 시 항상 false.
 */
export function isXProduct(productId: string): boolean {
  if (!productId) return false;
  return getXProductIds().has(productId);
}

// ── 이벤트 파라미터 ────────────────────────────────────────────────────────
export interface XEntitlementEventParams {
  eventType: string;
  poolId: string;
  appUserId: string;
  productId: string;
  /** RevenueCat event.id (idempotency 추적용) */
  eventId: string | null;
  /** RevenueCat expiration_at 변환값 (YYYY-MM-DD) */
  expiresAt: string | null;
  isSandbox: boolean;
}

/**
 * X 상품 RevenueCat 이벤트 처리.
 *
 * 이벤트별 처리:
 *   INITIAL_PURCHASE / RENEWAL / UNCANCELLATION → entitlement=true
 *   CANCELLATION → subscription_end_at 갱신만, entitlement 불변
 *   EXPIRATION   → entitlement=false
 *   REFUND       → entitlement=false
 *   BILLING_ISSUE→ payment_failed_at 기록, entitlement 불변 (grace period 유지)
 *   기타          → log-only
 *
 * idempotency:
 *   - INITIAL_PURCHASE: xmode_purchased_at은 COALESCE로 최초값 보존
 *   - 상태 변경 없는 재전송: DB UPDATE는 실행되나 audit_log는 미생성
 */
export async function handleXEntitlementEvent(
  params: XEntitlementEventParams,
): Promise<void> {
  const { eventType, poolId, productId, eventId, expiresAt, isSandbox } =
    params;

  // ── 현재 상태 조회 ────────────────────────────────────────────────────────
  const [currentPool] = (
    await superAdminDb.execute(sql`
      SELECT xmode_entitlement, xmode_config_status, xmode_purchased_at,
             xmode_subscription_end_at
      FROM swimming_pools
      WHERE id = ${poolId}
      LIMIT 1
    `)
  ).rows as any[];

  if (!currentPool) {
    console.warn(`[x-entitlement] pool 없음: ${poolId}`);
    return;
  }

  const beforeEntitlement = Boolean(currentPool.xmode_entitlement);
  let afterEntitlement = beforeEntitlement;

  // ── 이벤트 분기 ───────────────────────────────────────────────────────────
  switch (eventType) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION": {
      afterEntitlement = true;
      // purchased_at: 이미 값이 있으면 덮어쓰지 않음 (COALESCE)
      // xmode_config_status: 절대 수정 안 함
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET xmode_entitlement        = true,
            xmode_subscription_end_at = ${expiresAt ?? null},
            xmode_payment_failed_at  = NULL,
            xmode_purchased_at       = COALESCE(xmode_purchased_at, NOW()),
            updated_at               = NOW()
        WHERE id = ${poolId}
      `);
      break;
    }

    case "CANCELLATION": {
      // 자동갱신 취소 — paid period 동안 entitlement 유지
      // subscription_end_at만 갱신하여 만료 시점 기록
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET xmode_subscription_end_at = ${expiresAt ?? null},
            updated_at                = NOW()
        WHERE id = ${poolId}
      `);
      // afterEntitlement = beforeEntitlement (변경 없음)
      break;
    }

    case "EXPIRATION": {
      afterEntitlement = false;
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET xmode_entitlement         = false,
            xmode_subscription_end_at = ${expiresAt ?? null},
            updated_at                = NOW()
        WHERE id = ${poolId}
      `);
      break;
    }

    case "REFUND": {
      afterEntitlement = false;
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET xmode_entitlement = false,
            updated_at        = NOW()
        WHERE id = ${poolId}
      `);
      break;
    }

    case "BILLING_ISSUE": {
      // grace period 동안 entitlement 유지
      // EXPIRATION 발생 시 false 처리
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET xmode_payment_failed_at = NOW(),
            updated_at              = NOW()
        WHERE id = ${poolId}
      `);
      // afterEntitlement = beforeEntitlement (변경 없음)
      break;
    }

    default:
      // TRANSFER 등 미지원 이벤트 — log-only 처리
      console.log(
        `[x-entitlement] 미지원 이벤트 타입: ${eventType} — log-only (pool=${poolId})`,
      );
      return;
  }

  // ── audit_log: xmode_entitlement 변경 시만 기록 ──────────────────────────
  if (afterEntitlement !== beforeEntitlement) {
    try {
      const versionRes = await superAdminDb.execute(sql`
        SELECT next_audit_version('swimming_pool_xmode', ${poolId}) AS v
      `);
      const version = (versionRes.rows[0] as any)?.v ?? 1;

      const beforeData = {
        xmode_entitlement: beforeEntitlement,
        xmode_config_status: currentPool.xmode_config_status,
        xmode_purchased_at: currentPool.xmode_purchased_at ?? null,
        xmode_subscription_end_at: currentPool.xmode_subscription_end_at ?? null,
      };
      const afterData = {
        xmode_entitlement: afterEntitlement,
        source: "revenuecat",
        event_type: eventType,
        product_id: productId,
        event_id: eventId ?? null,
        expires_at: expiresAt ?? null,
      };

      await superAdminDb.execute(sql`
        INSERT INTO audit_logs (
          entity_type, entity_id, entity_version,
          action, actor_type, actor_id, pool_id,
          before_data, after_data, reason,
          request_id, correlation_id, ip_hash
        ) VALUES (
          'swimming_pool_xmode', ${poolId}, ${version},
          'update', 'revenuecat', ${"rc:" + (eventId ?? "unknown")}, ${poolId},
          ${JSON.stringify(beforeData)}::jsonb,
          ${JSON.stringify(afterData)}::jsonb,
          ${"RC webhook: " + eventType + (isSandbox ? " (sandbox)" : "")},
          NULL, NULL, NULL
        )
      `);
    } catch (auditErr: any) {
      // audit 실패는 경고만, X entitlement 변경은 이미 완료
      console.error("[x-entitlement] audit_log 기록 실패:", auditErr.message);
    }
  }

  console.log(
    `[x-entitlement] ${eventType}: pool=${poolId}` +
      ` entitlement: ${beforeEntitlement} → ${afterEntitlement}` +
      (isSandbox ? " [sandbox]" : ""),
  );
}
