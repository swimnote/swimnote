/**
 * ai-trace-service.ts — AI 호출 Trace/Cost 저장 (WP10)
 *
 * 저장 위치: event_logs (superAdminDb), category = "AI"
 *   - 기존 테이블 재사용 → 신규 migration 없음
 *   - pool_id, metadata JSONB 구조 활용
 *
 * 개인정보 보호 (스펙 §5):
 *   저장 금지: 학생 이름, 학부모 이름, 전화번호, 원문, prompt 전문, GPT 응답 전문
 *   저장 허용: pool_id, actor_id(내부 ID), request_id, token count, metadata
 *
 * 비용 계산: ai-pricing.ts의 calculateAiCost() 사용
 *   모델 미지원 시 cost 필드 null (임의 추정 금지)
 */

import { superAdminDb }             from "@workspace/db";
import { sql, type SQL }             from "drizzle-orm";
import { calculateAiCost }           from "../config/ai-pricing.js";

// ── Stage 상수 ────────────────────────────────────────────────────────────────
export type AiTraceStage =
  | "POOL_MODE"
  | "TEMPLATE_SEARCH"
  | "CURRICULUM_SEARCH"
  | "KNOWLEDGE_SEARCH"
  | "LLM_GENERATION"
  | "OUTPUT_VALIDATION"
  | "MATCH_TOKEN"
  | "UNKNOWN";

// ── 공통 컨텍스트 ─────────────────────────────────────────────────────────────
export interface AiTraceContext {
  request_id:        string;   // 클라이언트 제공 외부 ID
  internal_id:       string;   // 서버 내부 trace ID
  pool_id:           string;
  actor_id?:         string;   // teacher/parent user ID (내부 ID; 이름·전화 미포함)
  contract_version:  string;
  pipeline_version?: string | null;
  feature:           string;
  pool_mode?:        string | null;
  student_count?:    number;

  // CS-PA1: 공통 계측 확장 (metadata JSONB 활용 — DB column 추가 없음)
  /** 실제 인증 role (teacher/parent/pool_admin/super_admin 등). 알 수 없으면 null. */
  user_role?:        string | null;
  /** multi-stage 기능의 단계 구분 (예: PREANALYSIS, FINAL_ANALYSIS, RETRY). */
  sub_feature?:      string | null;
  /** AI 결과가 사용자에게 정상 반환됐으면 true, parse/validation 실패면 false. */
  result_generated?: boolean | null;
  /** AI provider 식별자 (openai | 기타). */
  provider?:         string;
  /** 캐시된 토큰 수 (provider가 제공 시에만). */
  cached_tokens?:    number | null;
  /** 호출 소스 앱 구분 (app | web | 기타). */
  source_app?:       string | null;
  /** Grounded 응답에 실제 전달된 검증 Knowledge ID 목록. 원문은 저장하지 않음. */
  retrieved_knowledge_ids?: string[];
  /** Knowledge ID별 검증 revision. */
  knowledge_revisions?: Record<string, number>;
  /** Retrieval이 적용한 테넌트 범위 설명. pool_id는 event_logs column에 저장됨. */
  retrieval_scope?: string | null;
}

// ── 성공 Trace ────────────────────────────────────────────────────────────────
export interface AiTraceSuccess extends AiTraceContext {
  status: "SUCCESS";
  generation_mode:           string;
  /** 실제 provider model 식별자. 외부 엔진 경유 시 null 허용. */
  model:                     string | null;
  latency_ms:                number;
  /** Provider 미제공 시 null (추정 금지). */
  input_tokens:              number | null;
  output_tokens:             number | null;
  total_tokens:              number | null;
  // Template
  template_candidate_count?: number;
  selected_template_id?:     string | null;
  // X-specific (non-X pool에서는 absent)
  x_template_status?:        string | null;
  active_template_set_id?:   string | null;
  // Curriculum
  curriculum_match_count?:   number;
  knowledge_hit_count?:      number;
}

// ── 실패 Trace ────────────────────────────────────────────────────────────────
export interface AiTraceFailed extends AiTraceContext {
  status:       "FAILED";
  error_stage:  AiTraceStage;
  error_code?:  string;
  latency_ms:   number;
  // 실패해도 usage가 발생했을 수 있음 (OUTPUT_VALIDATION 등)
  input_tokens?:  number;
  output_tokens?: number;
  total_tokens?:  number;
  model?:         string;
}

export type AiTraceParams = AiTraceSuccess | AiTraceFailed;

// ── metadata 빌더 (테스트 직접 검증 가능하도록 export) ────────────────────────
/**
 * AI trace params → event_logs.metadata JSONB 구조 반환.
 * 개인정보 보호 규칙 적용됨:
 *   - 이름·원문·prompt 전문·GPT 응답 전문 미포함
 *   - pool_id, actor_id(내부 ID), request_id, token count만 포함
 * Non-X pool에서는 x_template_status / active_template_set_id 키 자체 absent.
 */
export function buildTraceMetadata(params: AiTraceParams): Record<string, unknown> {
  // ── cost 계산 ──────────────────────────────────────────────────────────────
  let costData: {
    input_cost_usd:  number;
    output_cost_usd: number;
    total_cost_usd:  number;
    pricing_source:  string;
    pricing_version: string;
  } | null = null;

  const model  = "model" in params ? params.model : undefined;
  const input  = "input_tokens"  in params ? (params.input_tokens  ?? 0) : 0;
  const output = "output_tokens" in params ? (params.output_tokens ?? 0) : 0;

  if (model && (input > 0 || output > 0)) {
    const calc = calculateAiCost(input, output, model);
    if (calc) {
      costData = {
        input_cost_usd:  calc.input_cost_usd,
        output_cost_usd: calc.output_cost_usd,
        total_cost_usd:  calc.total_cost_usd,
        pricing_source:  calc.pricing_source,
        pricing_version: calc.pricing_version,
      };
    }
  }

  // ── 공통 필드 ────────────────────────────────────────────────────────────────
  const metadata: Record<string, unknown> = {
    request_id:       params.request_id,
    internal_id:      params.internal_id,
    status:           params.status,
    feature:          params.feature,
    contract_version: params.contract_version,
    pool_mode:        params.pool_mode ?? null,
    student_count:    params.student_count ?? null,
  };

  if (params.pipeline_version  != null) metadata.pipeline_version  = params.pipeline_version;

  // CS-PA1: 공통 계측 확장 필드 (metadata JSONB 활용)
  if (params.user_role         != null) metadata.user_role         = params.user_role;
  if (params.sub_feature       != null) metadata.sub_feature       = params.sub_feature;
  if (params.result_generated  != null) metadata.result_generated  = params.result_generated;
  if (params.provider          != null) metadata.provider          = params.provider;
  if (params.cached_tokens     != null) metadata.cached_tokens     = params.cached_tokens;
  if (params.source_app        != null) metadata.source_app        = params.source_app;
  if (params.retrieved_knowledge_ids != null) metadata.retrieved_knowledge_ids = params.retrieved_knowledge_ids;
  if (params.knowledge_revisions     != null) metadata.knowledge_revisions     = params.knowledge_revisions;
  if (params.retrieval_scope         != null) metadata.retrieval_scope         = params.retrieval_scope;

  if (params.status === "SUCCESS") {
    const s = params as AiTraceSuccess;
    metadata.generation_mode           = s.generation_mode;
    metadata.latency_ms                = s.latency_ms;
    metadata.template_candidate_count  = s.template_candidate_count ?? null;
    metadata.selected_template_id      = s.selected_template_id     ?? null;
    metadata.curriculum_match_count    = s.curriculum_match_count   ?? null;
    metadata.knowledge_hit_count       = s.knowledge_hit_count      ?? 0;
    // null 허용 (외부 엔진 경유 시): 값이 있는 경우만 저장
    if (s.model        != null) metadata.model         = s.model;
    if (s.input_tokens != null) metadata.input_tokens  = s.input_tokens;
    if (s.output_tokens!= null) metadata.output_tokens = s.output_tokens;
    if (s.total_tokens != null) metadata.total_tokens  = s.total_tokens;
    // X-specific: non-X pool에서는 키 자체 absent (undefined → Object.keys에서 제외)
    if (s.x_template_status      != null) metadata.x_template_status      = s.x_template_status;
    if (s.active_template_set_id != null) metadata.active_template_set_id = s.active_template_set_id;
    if (costData) metadata.cost = costData;
  } else {
    const f = params as AiTraceFailed;
    metadata.error_stage = f.error_stage;
    metadata.error_code  = f.error_code  ?? null;
    metadata.latency_ms  = f.latency_ms;
    if (f.model          != null) metadata.model         = f.model;
    if (f.input_tokens   != null) metadata.input_tokens  = f.input_tokens;
    if (f.output_tokens  != null) metadata.output_tokens = f.output_tokens;
    if (f.total_tokens   != null) metadata.total_tokens  = f.total_tokens;
    if (costData)                 metadata.cost           = costData;
  }

  return metadata;
}

// ── 저장 ─────────────────────────────────────────────────────────────────────
/**
 * AI trace를 event_logs에 저장합니다.
 *
 * 실패해도 throw하지 않음 — 호출부에서 .catch(err => console.error(...)) 처리.
 * 응답 지연 방지를 위해 호출부는 res.json() 이후에 호출할 것.
 */
export async function saveAiTrace(params: AiTraceParams): Promise<void> {
  const metadata    = buildTraceMetadata(params);
  const id          = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const description = `AI ${params.feature} — ${params.status}`;

  await superAdminDb.execute(sql`
    INSERT INTO event_logs
      (id, pool_id, category, actor_id, target, description, metadata)
    VALUES (
      ${id},
      ${params.pool_id},
      ${"AI"},
      ${params.actor_id ?? null},
      ${params.request_id},
      ${description},
      ${JSON.stringify(metadata)}::jsonb
    )
  `);
}

// ── 집계 쿼리 (super admin read API용) ───────────────────────────────────────

export interface AiTraceFilter {
  pool_id?:    string;
  feature?:    string;
  status?:     "SUCCESS" | "FAILED";
  from?:       string;   // ISO date string (inclusive)
  to?:         string;   // ISO date string (inclusive)
  limit?:      number;
  offset?:     number;
}

export interface AiTraceListResult {
  rows: AiTraceRow[];
  total: number;
}

export interface AiTraceRow {
  id:          string;
  pool_id:     string | null;
  actor_id:    string | null;
  request_id:  string | null;
  status:      string | null;
  feature:     string | null;
  pool_mode:   string | null;
  generation_mode:   string | null;
  model:       string | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  latency_ms:  number | null;
  error_stage: string | null;
  error_code:  string | null;
  created_at:  string;
}

/**
 * AI trace 목록 조회 (super_admin 전용).
 * drizzle sql 태그 기반 안전한 파라미터 바인딩 사용.
 */
export async function listAiTraces(filter: AiTraceFilter): Promise<AiTraceListResult> {
  const limit  = Math.min(filter.limit  ?? 50, 200);
  const offset = filter.offset ?? 0;

  // drizzle sql 태그로 동적 조건 구성 (SQL injection 안전)
  const conditions: SQL[] = [sql`category = 'AI'`];
  if (filter.pool_id) conditions.push(sql`pool_id = ${filter.pool_id}`);
  if (filter.feature) conditions.push(sql`metadata->>'feature' = ${filter.feature}`);
  if (filter.status)  conditions.push(sql`metadata->>'status'  = ${filter.status}`);
  if (filter.from)    conditions.push(sql`created_at >= ${filter.from}::timestamptz`);
  if (filter.to)      conditions.push(sql`created_at <= ${filter.to + "T23:59:59.999Z"}::timestamptz`);

  const whereClause = sql.join(conditions, sql` AND `);

  const countQuery = sql`SELECT COUNT(*) AS total FROM event_logs WHERE ${whereClause}`;
  const dataQuery  = sql`
    SELECT
      id,
      pool_id,
      actor_id,
      metadata->>'request_id'      AS request_id,
      metadata->>'status'          AS status,
      metadata->>'feature'         AS feature,
      metadata->>'pool_mode'       AS pool_mode,
      metadata->>'generation_mode' AS generation_mode,
      metadata->>'model'           AS model,
      (metadata->>'total_tokens')::int             AS total_tokens,
      (metadata->'cost'->>'total_cost_usd')::float AS total_cost_usd,
      (metadata->>'latency_ms')::int               AS latency_ms,
      metadata->>'error_stage'     AS error_stage,
      metadata->>'error_code'      AS error_code,
      created_at::text             AS created_at
    FROM event_logs
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [countRes, dataRes] = await Promise.all([
    superAdminDb.execute(countQuery),
    superAdminDb.execute(dataQuery),
  ]);

  const total = Number((countRes.rows[0] as any)?.total ?? 0);
  return {
    rows:  dataRes.rows as unknown as AiTraceRow[],
    total,
  };
}

/**
 * request_id 기준 trace 상세 조회.
 */
export async function getAiTraceByRequestId(
  requestId: string,
): Promise<{ found: false } | { found: true; row: Record<string, unknown>; metadata: Record<string, unknown> }> {
  const res = await superAdminDb.execute(sql`
    SELECT id, pool_id, actor_id, description, metadata, created_at::text AS created_at
    FROM event_logs
    WHERE category = 'AI'
      AND metadata->>'request_id' = ${requestId}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (res.rows.length === 0) return { found: false };

  const row = res.rows[0] as Record<string, unknown>;
  const metadata = typeof row.metadata === "object" && row.metadata !== null
    ? row.metadata as Record<string, unknown>
    : {};

  return { found: true, row, metadata };
}
