/**
 * Analytics Logger — analytics_events 테이블에 사용자행동/광고측정 이벤트 기록
 *
 * event_logs (운영 감사 로그)와 분리된 전용 테이블.
 * PII 저장 금지. pool_id/creative_id 등 식별자만 허용.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AnalyticsEventType =
  | "LOGIN_SESSION_START"  // parent/teacher 로그인 성공 (세션 시작 proxy)
  | "AD_IMPRESSION"        // 광고 실제 렌더 후 앱이 보고
  | "AD_CLICK";            // 광고 클릭 (destination_url open)

export interface AnalyticsEventParams {
  event_type:       AnalyticsEventType;
  user_id?:         string | null;
  swimming_pool_id?: string | null;
  role?:            string | null;
  content_type?:    string | null;
  content_id?:      string | null;
  campaign_id?:     string | null;
  creative_id?:     string | null;
  placement?:       string | null;
  metadata?:        Record<string, unknown> | null;
}

export async function logAnalyticsEvent(params: AnalyticsEventParams): Promise<void> {
  const id = `ae_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

  await db.execute(sql`
    INSERT INTO analytics_events (
      id, event_type, user_id, swimming_pool_id, role,
      content_type, content_id, campaign_id, creative_id, placement,
      metadata, occurred_at
    ) VALUES (
      ${id},
      ${params.event_type},
      ${params.user_id ?? null},
      ${params.swimming_pool_id ?? null},
      ${params.role ?? null},
      ${params.content_type ?? null},
      ${params.content_id ?? null},
      ${params.campaign_id ?? null},
      ${params.creative_id ?? null},
      ${params.placement ?? null},
      ${metadata ? sql`${metadata}::jsonb` : sql`NULL`},
      NOW()
    )
  `);
}
