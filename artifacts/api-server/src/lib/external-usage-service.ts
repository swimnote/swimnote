/**
 * external-usage-service.ts — AI01-06
 *
 * Provider-neutral usage recorder for non-AI external services (SMS, R2, …).
 *
 * 저장 위치: event_logs (superAdminDb), category = "EXTERNAL_USAGE"
 * AI trace(category="AI")와 분리되므로 기존 AI 집계 쿼리에 영향 없음.
 *
 * 새 DB 컬럼/테이블 없음. migration 없음.
 */

import { sql }           from "drizzle-orm";
import { superAdminDb }  from "@workspace/db";
import type { AiFeature } from "./ai-feature-enum.js";

// ── External category ─────────────────────────────────────────────────────────

/**
 * Non-AI 외부 서비스 category.
 * AI01-06: SMS  |  AI01-07: R2
 */
export const EXTERNAL_USAGE_CATEGORY = {
  SMS: "SMS",
  R2:  "R2",
} as const;

export type ExternalUsageCategory =
  (typeof EXTERNAL_USAGE_CATEGORY)[keyof typeof EXTERNAL_USAGE_CATEGORY];

/**
 * Feature field — AI feature 또는 External category.
 * AiFeature | string을 허용하는 열린 타입은 피함.
 */
export type UsageFeature = AiFeature | ExternalUsageCategory;

// ── Cost source ───────────────────────────────────────────────────────────────

export type ExternalCostSource = "CONFIGURED_UNIT_PRICE" | "UNKNOWN";

// ── TriggerType (AI service와 동일 값 재사용) ─────────────────────────────────
export type ExternalTriggerType = "USER_ACTION" | "SYSTEM_MAINTENANCE";

// ── Contract ──────────────────────────────────────────────────────────────────

export interface ExternalUsageParams {
  /** 서비스 provider 식별자 (예: "sens", "coolsms", "aligo", "r2") */
  provider: string;
  /** provider 내 서비스 작업 (예: "sms_send", "object_upload") */
  service: string;
  /** 기능/카테고리 (예: "SMS", "stt") */
  feature: UsageFeature;
  /** USER_ACTION | SYSTEM_MAINTENANCE */
  trigger_type: ExternalTriggerType;
  /** 수영장 ID (없으면 빈 문자열) */
  pool_id: string;
  /** 요청 추적 ID (없으면 undefined) */
  request_id?: string;
  /** 사용자/시스템 actor ID */
  actor_id?: string | null;

  /** 논리 요청 수 (일반적으로 1) */
  logical_request_count?: number;
  /**
   * 실제 HTTP 호출 수.
   * - 성공: 1
   * - 확인된 provider HTTP 응답(4xx/5xx 포함): 1
   * - HTTP 전송 여부 판별 불가(credentials/config/serialization 실패): absent(undefined)
   * optional — unknown 상태는 omit한다. 절대 모르지만 1로 기록하지 않음.
   */
  actual_call_count?: number;
  /** 재시도 수 (retry 없으면 0) */
  retry_count?: number;

  /** 성공 여부 */
  success: boolean;
  /** 실패 시 오류 유형 */
  error_type?: string;

  /** 실제 호출 latency (ms) */
  latency_ms: number;

  /**
   * 비용 추정 — 계약 단가 미확인 시 null.
   * 시장 평균가 임의 적용 금지.
   */
  estimated_cost_usd?: number | null;
  /** CONFIGURED_UNIT_PRICE | UNKNOWN */
  cost_source: ExternalCostSource;

  /** 서비스별 단위.
   * SMS: number (건수)
   * R2:  { bytes: number } (payload 크기)
   * 알 수 없으면 null/absent.
   */
  units?: number | Record<string, unknown> | null;
  /** 추가 메타데이터 */
  metadata?: Record<string, unknown>;
}

// ── Recorder ──────────────────────────────────────────────────────────────────

/**
 * provider-neutral external usage event를 event_logs에 저장합니다.
 *
 * Best-effort: 실패해도 throw하지 않음.
 * 호출부는 .catch(err => console.error(...)) 패턴으로 처리.
 * SMS/R2 등 본 동작 성공 여부와 완전히 독립.
 */
export async function saveExternalUsage(params: ExternalUsageParams): Promise<void> {
  const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const description = `${params.feature} ${params.service} — ${params.success ? "SUCCESS" : "FAILED"} (${params.provider})`;

  const metadata: Record<string, unknown> = {
    provider:              params.provider,
    service:               params.service,
    feature:               params.feature,
    trigger_type:          params.trigger_type,
    success:               params.success,
    latency_ms:            params.latency_ms,
    logical_request_count: params.logical_request_count ?? 1,
    ...(params.actual_call_count != null
      ? { actual_call_count: params.actual_call_count }
      : {}),
    retry_count:           params.retry_count ?? 0,
    cost_source:           params.cost_source,
    ...(params.estimated_cost_usd != null
      ? { estimated_cost_usd: params.estimated_cost_usd }
      : {}),
    ...(params.error_type != null
      ? { error_type: params.error_type }
      : {}),
    ...(params.units != null
      ? { units: params.units }
      : {}),
    ...(params.metadata
      ? { extra: params.metadata }
      : {}),
  };

  await superAdminDb.execute(sql`
    INSERT INTO event_logs
      (id, pool_id, category, actor_id, target, description, metadata)
    VALUES (
      ${id},
      ${params.pool_id},
      ${"EXTERNAL_USAGE"},
      ${params.actor_id ?? null},
      ${params.request_id ?? id},
      ${description},
      ${JSON.stringify(metadata)}::jsonb
    )
  `);
}
