/**
 * wp10-ai-trace.test.ts — WP10 AI Trace & Cost 단위 테스트
 *
 * 테스트 범위:
 *   A. SUCCESS trace 구조 (request_id 일치)
 *   B. X + NOT_CONFIGURED/INPUT_ONLY → x_template_status 기록, usage 정확
 *   C. X + template path fixture → selected template/meta 기록
 *   D. NON-X → X-specific meta absent
 *   E. LLM failure → FAILED trace, error_stage 확인
 *   F. token usage → input/output/total 정확
 *   G. retry/new request → request_id별 별도 trace
 *   H. 민감 원문이 trace에 저장되지 않음
 *   I. calculateAiCost — gpt-4o-mini 정확 계산, cost 필드 포함
 *   J. calculateAiCost — 미지원 모델 → null (임의 추정 금지)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock (saveAiTrace의 execute 호출 확인용) ───────────────────────────────
vi.mock('@workspace/db', () => ({
  superAdminDb: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import { superAdminDb }                    from '@workspace/db';
import { buildTraceMetadata, saveAiTrace } from '../../lib/ai-trace-service.js';
import { calculateAiCost }                 from '../../config/ai-pricing.js';

// ─────────────────────────────────────────────────────────────────────────────
// calculateAiCost 단위 테스트
// ─────────────────────────────────────────────────────────────────────────────

describe('WP10 — calculateAiCost', () => {
  // TC-I: gpt-4o-mini 정확한 비용 계산
  it('I. gpt-4o-mini 1000 input + 500 output → USD 정확', () => {
    const result = calculateAiCost(1000, 500, 'gpt-4o-mini');
    expect(result).not.toBeNull();
    // input: 1000 × $0.00000015 = $0.00015
    // output:  500 × $0.00000060 = $0.00030
    expect(result!.input_cost_usd).toBeCloseTo(0.00015, 8);
    expect(result!.output_cost_usd).toBeCloseTo(0.00030, 8);
    expect(result!.total_cost_usd).toBeCloseTo(0.00045, 8);
    expect(result!.model).toBe('gpt-4o-mini');
    expect(result!.pricing_source).toBe('openai_official');
  });

  // TC-I: token 0 → cost $0.0
  it('I. token=0 → cost $0.0', () => {
    const result = calculateAiCost(0, 0, 'gpt-4o-mini');
    expect(result).not.toBeNull();
    expect(result!.total_cost_usd).toBe(0);
    expect(result!.input_cost_usd).toBe(0);
    expect(result!.output_cost_usd).toBe(0);
  });

  // TC-J: 미지원 모델 → null
  it('J. 미지원 모델 → null (임의 추정 금지)', () => {
    expect(calculateAiCost(1000, 500, 'gpt-4-turbo')).toBeNull();
    expect(calculateAiCost(1000, 500, 'claude-3')).toBeNull();
    expect(calculateAiCost(1000, 500, '')).toBeNull();
  });

  // TC-F: total_tokens = input + output
  it('F. total_tokens = input_tokens + output_tokens', () => {
    const result = calculateAiCost(300, 700, 'gpt-4o-mini')!;
    expect(result.total_tokens).toBe(1000);
    expect(result.input_tokens).toBe(300);
    expect(result.output_tokens).toBe(700);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildTraceMetadata 단위 테스트 (DB 불필요)
// ─────────────────────────────────────────────────────────────────────────────

describe('WP10 — buildTraceMetadata', () => {
  const BASE_SUCCESS = {
    status:           'SUCCESS' as const,
    request_id:       'req-test-001',
    internal_id:      'int-abc',
    pool_id:          'pool_test_001',
    actor_id:         'user-teacher-1',
    contract_version: '1.3',
    pipeline_version: 'v2.0',
    feature:          'teacher_diary',
    pool_mode:        'normal',
    student_count:    3,
    generation_mode:  'TEMPLATE_ASSISTED',
    model:            'gpt-4o-mini',
    latency_ms:       1200,
    input_tokens:     800,
    output_tokens:    300,
    total_tokens:     1100,
  } as const;

  // TC-A: SUCCESS trace 구조 / request_id 일치
  it('A. SUCCESS → metadata.request_id 일치, status=SUCCESS', () => {
    const meta = buildTraceMetadata(BASE_SUCCESS);
    expect(meta.request_id).toBe('req-test-001');
    expect(meta.status).toBe('SUCCESS');
    expect(meta.pool_mode).toBe('normal');
    expect(meta.feature).toBe('teacher_diary');
    expect(meta.contract_version).toBe('1.3');
  });

  it('CS26. grounded support trace includes verified evidence IDs, revisions, and tenant scope', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      feature: 'support_ai',
      sub_feature: 'SUPPORT_GPT_SECOND_STAGE',
      user_role: 'parent_account',
      retrieved_knowledge_ids: ['ki_photo_visibility', 'ki_incident_photo'],
      knowledge_revisions: { ki_photo_visibility: 3, ki_incident_photo: 1 },
      retrieval_scope: 'global_or_current_pool:pool_test_001',
    });
    expect(meta.user_role).toBe('parent_account');
    expect(meta.pool_mode).toBe('normal');
    expect(meta.retrieved_knowledge_ids).toEqual(['ki_photo_visibility', 'ki_incident_photo']);
    expect(meta.knowledge_revisions).toEqual({ ki_photo_visibility: 3, ki_incident_photo: 1 });
    expect(meta.retrieval_scope).toBe('global_or_current_pool:pool_test_001');
  });

  // TC-B: X + NOT_CONFIGURED → x_template_status 기록, usage 포함
  it('B. X+NOT_CONFIGURED → x_template_status 기록 + usage 정확', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      pool_mode:         'x',
      generation_mode:   'INPUT_ONLY',
      input_tokens:      500,
      output_tokens:     200,
      total_tokens:      700,
      x_template_status: 'NO_ACTIVE_SET',
    });
    expect(meta.x_template_status).toBe('NO_ACTIVE_SET');
    expect(meta.total_tokens).toBe(700);
    expect(meta.input_tokens).toBe(500);
    expect(meta.output_tokens).toBe(200);
    expect(meta.generation_mode).toBe('INPUT_ONLY');
  });

  // TC-C: X + template found → selected_template_id, active_template_set_id 기록
  it('C. X+template found → selected_template_id / active_template_set_id 포함', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      pool_mode:                'x',
      template_candidate_count: 8,
      selected_template_id:     'x_tmpl_99',
      x_template_status:        'FOUND',
      active_template_set_id:   'active_set_001',
      curriculum_match_count:   2,
    });
    expect(meta.selected_template_id).toBe('x_tmpl_99');
    expect(meta.active_template_set_id).toBe('active_set_001');
    expect(meta.x_template_status).toBe('FOUND');
    expect(meta.curriculum_match_count).toBe(2);
  });

  // TC-D: NON-X → X-specific keys absent
  it('D. NON-X pool → x_template_status / active_template_set_id 키 자체 absent', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      contract_version: '1.0',
      pool_mode:        'normal',
      // x_template_status, active_template_set_id 전달하지 않음
    });
    expect('x_template_status'      in meta).toBe(false);
    expect('active_template_set_id' in meta).toBe(false);
  });

  // TC-E: LLM failure → FAILED / error_stage=LLM_GENERATION
  it('E. LLM failure → status=FAILED / error_stage=LLM_GENERATION', () => {
    const meta = buildTraceMetadata({
      status:           'FAILED',
      request_id:       'req-timeout-001',
      internal_id:      'int-to',
      pool_id:          'pool_test_001',
      contract_version: '1.3',
      feature:          'teacher_diary',
      pool_mode:        'x',
      error_stage:      'LLM_GENERATION',
      error_code:       'MODEL_TIMEOUT',
      latency_ms:       30000,
      model:            'gpt-4o-mini',
    });
    expect(meta.status).toBe('FAILED');
    expect(meta.error_stage).toBe('LLM_GENERATION');
    expect(meta.error_code).toBe('MODEL_TIMEOUT');
  });

  // TC-F: token usage → input/output/total 정확
  it('F. token usage — input/output/total 정확히 기록', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      input_tokens:  300,
      output_tokens: 700,
      total_tokens:  1000,
    });
    expect(meta.input_tokens).toBe(300);
    expect(meta.output_tokens).toBe(700);
    expect(meta.total_tokens).toBe(1000);
  });

  // TC-G: 두 번 호출 → request_id별 별도 metadata
  it('G. 두 번 빌드 → request_id별 별도 (독립성)', () => {
    const meta1 = buildTraceMetadata({ ...BASE_SUCCESS, request_id: 'req-g-001' });
    const meta2 = buildTraceMetadata({ ...BASE_SUCCESS, request_id: 'req-g-002' });
    expect(meta1.request_id).toBe('req-g-001');
    expect(meta2.request_id).toBe('req-g-002');
    expect(meta1.request_id).not.toBe(meta2.request_id);
  });

  // TC-H: 민감 원문이 metadata에 없음
  it('H. metadata에 이름·원문·prompt·phone 없음 / request_id·tokens는 포함', () => {
    const meta = buildTraceMetadata(BASE_SUCCESS);
    // 금지 필드: 키 자체 없어야 함
    expect('student_name' in meta).toBe(false);
    expect('teacher_text' in meta).toBe(false);
    expect('gpt_prompt'   in meta).toBe(false);
    expect('gpt_response' in meta).toBe(false);
    expect('phone'        in meta).toBe(false);
    // 허용 필드: 포함
    expect(meta.request_id).toBe('req-test-001');
    expect(meta.total_tokens).toBe(1100);
  });

  // TC-I (cost): 토큰 있으면 cost 필드 자동 계산
  it('I. token 있으면 cost.total_cost_usd 자동 포함 + pricing_source', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      input_tokens:  1000,
      output_tokens: 500,
      total_tokens:  1500,
    });
    const cost = meta.cost as Record<string, unknown> | undefined;
    expect(cost).toBeDefined();
    expect(typeof cost?.total_cost_usd).toBe('number');
    // 1000×0.00000015 + 500×0.00000060 = 0.00015 + 0.00030 = 0.00045
    expect(cost?.total_cost_usd as number).toBeCloseTo(0.00045, 8);
    expect(cost?.pricing_source).toBe('openai_official');
  });

  // TC-I: token=0이면 cost 필드 없음
  it('I. token=0 → cost 필드 없음 (0 토큰 추정 금지)', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      input_tokens:  0,
      output_tokens: 0,
      total_tokens:  0,
    });
    // token=0이면 calculateAiCost 조건 불충족 → cost 필드 없음
    expect('cost' in meta).toBe(false);
  });

  // ── AI01-01 TCs ──────────────────────────────────────────────────────────────

  // TC1: 기존 payload만 전달 → backward compat 유지
  it('AI01-01 TC1. 기존 payload → 신규 필드 없어도 metadata 정상 생성', () => {
    const meta = buildTraceMetadata(BASE_SUCCESS);
    expect(meta.request_id).toBe('req-test-001');
    expect(meta.status).toBe('SUCCESS');
    // 신규 필드는 전달 안 했으므로 absent
    expect('trigger_type'          in meta).toBe(false);
    expect('service'               in meta).toBe(false);
    expect('cost_source'           in meta).toBe(false);
    expect('retry_count'           in meta).toBe(false);
    expect('audio_seconds'         in meta).toBe(false);
    expect('logical_request_count' in meta).toBe(false);
    expect('actual_call_count'     in meta).toBe(false);
  });

  // TC2: 신규 필드 전체 전달 → metadata에 정확히 존재
  it('AI01-01 TC2. 신규 필드 전체 → metadata에 정확히 존재', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      trigger_type:          'SYSTEM_MAINTENANCE',
      service:               'gpt',
      cost_source:           'TOKEN_PRICING',
      retry_count:           2,
      audio_seconds:         30.5,
      logical_request_count: 1,
      actual_call_count:     3,
    });
    expect(meta.trigger_type).toBe('SYSTEM_MAINTENANCE');
    expect(meta.service).toBe('gpt');
    expect(meta.cost_source).toBe('TOKEN_PRICING');
    expect(meta.retry_count).toBe(2);
    expect(meta.audio_seconds).toBe(30.5);
    expect(meta.logical_request_count).toBe(1);
    expect(meta.actual_call_count).toBe(3);
  });

  // TC3: legacy cached_tokens → cached_input_tokens로 normalize
  it('AI01-01 TC3. cached_tokens(legacy) → cached_input_tokens로 normalize', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      cached_tokens: 150,
    });
    expect(meta.cached_input_tokens).toBe(150);
    expect(meta.cached_tokens).toBe(150);  // legacy 필드도 유지
  });

  // TC4: cached_input_tokens 신규 값 우선 적용
  it('AI01-01 TC4. cached_input_tokens 신규 값 → 우선 적용', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      cached_input_tokens: 200,
      cached_tokens:       150,  // legacy도 같이 전달 시 신규 우선
    });
    expect(meta.cached_input_tokens).toBe(200);
  });

  // TC5: 기존 cost/status/error metadata 신규 변경으로 깨지지 않음
  it('AI01-01 TC5. 기존 cost/status/error metadata 불변', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      trigger_type: 'USER_ACTION',
      service:      'gpt',
      input_tokens:  1000,
      output_tokens: 500,
      total_tokens:  1500,
    });
    expect(meta.status).toBe('SUCCESS');
    expect(meta.feature).toBe('teacher_diary');
    expect(meta.generation_mode).toBe('TEMPLATE_ASSISTED');
    const cost = meta.cost as Record<string, unknown> | undefined;
    expect(cost).toBeDefined();
    expect(typeof cost?.total_cost_usd).toBe('number');
  });

  // TC6: 음수 usage 값 → 저장 거부 (metadata에 absent)
  it('AI01-01 TC6. 음수 usage 값 → metadata에 저장 안 됨', () => {
    const meta = buildTraceMetadata({
      ...BASE_SUCCESS,
      retry_count:           -1,
      audio_seconds:         -5,
      logical_request_count: -1,
      actual_call_count:     -3,
    });
    expect('retry_count'           in meta).toBe(false);
    expect('audio_seconds'         in meta).toBe(false);
    expect('logical_request_count' in meta).toBe(false);
    expect('actual_call_count'     in meta).toBe(false);
  });

  // FAILED 경로에서 usage 있으면 cost 포함
  it('E+I. FAILED + usage 있으면 cost도 포함', () => {
    const meta = buildTraceMetadata({
      status:           'FAILED',
      request_id:       'req-fail-cost',
      internal_id:      'int-fc',
      pool_id:          'pool_fc',
      contract_version: '1.3',
      feature:          'teacher_diary',
      error_stage:      'OUTPUT_VALIDATION',
      error_code:       'OUTPUT_VALIDATION_FAILED',
      latency_ms:       2000,
      model:            'gpt-4o-mini',
      input_tokens:     600,
      output_tokens:    200,
      total_tokens:     800,
    });
    expect(meta.status).toBe('FAILED');
    expect(meta.input_tokens).toBe(600);
    const cost = meta.cost as Record<string, unknown> | undefined;
    expect(cost).toBeDefined();
    expect(cost?.pricing_source).toBe('openai_official');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// saveAiTrace (DB 호출 확인)
// ─────────────────────────────────────────────────────────────────────────────

describe('WP10 — saveAiTrace (DB execute 호출)', () => {
  beforeEach(() => {
    vi.mocked(superAdminDb.execute).mockClear();
    vi.mocked(superAdminDb.execute).mockResolvedValue({ rows: [] } as any);
  });

  it('saveAiTrace → execute 1회 호출', async () => {
    await saveAiTrace({
      status:           'SUCCESS',
      request_id:       'req-db-001',
      internal_id:      'int-db',
      pool_id:          'pool_db',
      contract_version: '1.0',
      feature:          'teacher_diary',
      generation_mode:  'TEMPLATE_ASSISTED',
      model:            'gpt-4o-mini',
      latency_ms:       900,
      input_tokens:     400,
      output_tokens:    150,
      total_tokens:     550,
    });
    expect(superAdminDb.execute).toHaveBeenCalledTimes(1);
  });

  it('두 번 호출 → execute 2회 (별도 INSERT)', async () => {
    const base = {
      status: 'SUCCESS' as const,
      internal_id: 'int-db2', pool_id: 'pool_db2',
      contract_version: '1.0', feature: 'teacher_diary',
      generation_mode: 'INPUT_ONLY', model: 'gpt-4o-mini',
      latency_ms: 500, input_tokens: 200, output_tokens: 80, total_tokens: 280,
    };
    await saveAiTrace({ ...base, request_id: 'req-db2-001' });
    await saveAiTrace({ ...base, request_id: 'req-db2-002' });
    expect(superAdminDb.execute).toHaveBeenCalledTimes(2);
  });

  // TC-I: super_admin 권한 없는 접근은 route 레벨에서 차단 (requireRole)
  // → 라우터 테스트는 통합 테스트 영역; 여기서는 서비스 레벨 확인
  it('I(권한): listAiTraces는 DB execute 호출 (권한은 라우터 레벨에서 차단)', async () => {
    vi.mocked(superAdminDb.execute)
      .mockResolvedValueOnce({ rows: [{ total: '3' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const { listAiTraces } = await import('../../lib/ai-trace-service.js');
    const result = await listAiTraces({ pool_id: 'pool_test' });
    expect(superAdminDb.execute).toHaveBeenCalledTimes(2); // count + data
    expect(result.total).toBe(3);
  });
});
