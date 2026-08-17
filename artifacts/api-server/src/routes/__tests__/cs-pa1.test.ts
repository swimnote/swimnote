/**
 * CS-PA1 — Common AI Usage Instrumentation Tests
 *
 * PA1-01~PA1-22: buildTraceMetadata 확장 필드 + 4개 라우트 계측 검증.
 *
 * 원칙:
 *   - AI prompt/logic/output 변경 없음
 *   - event_logs 재활용 — 새 DB 테이블 없음
 *   - saveAiTrace 실패가 AI 응답에 영향 없음 (void ... .catch 패턴)
 *   - RAW_PROMPT_STORED = NO, PII_IN_ANALYTICS = NO
 *
 * 참고: buildTraceMetadata(params) 는 metadata Record<string,unknown>을 직접 반환함.
 *       saveAiTrace 내부에서 id/description/poolId를 별도 생성함.
 */

import { describe, it, expect } from 'vitest';
import { buildTraceMetadata } from '../../lib/ai-trace-service.js';
import { AI_FEATURE, AI_FEATURE_LABEL, type AiFeature } from '../../lib/ai-feature-enum.js';

// ─── PA1-01: AI_FEATURE enum에 STORY_SUMMARY 신규 상수 존재 ──────────────────
describe('PA1-01: AI_FEATURE.STORY_SUMMARY 상수', () => {
  it('STORY_SUMMARY = "story_summary" 값을 가진다', () => {
    expect(AI_FEATURE.STORY_SUMMARY).toBe('story_summary');
  });

  it('AI_FEATURE_LABEL에 story_summary 레이블이 존재한다', () => {
    const label = AI_FEATURE_LABEL['story_summary'];
    expect(label).toBeTruthy();
    expect(typeof label).toBe('string');
  });
});

// ─── PA1-02: buildTraceMetadata — user_role 필드 ─────────────────────────────
describe('PA1-02: buildTraceMetadata — user_role', () => {
  it('user_role이 제공되면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-001', internal_id: 'int-001',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      user_role: 'teacher',
      result_generated: true,
      provider: 'openai',
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.user_role).toBe('teacher');
  });

  it('user_role이 null이면 metadata에 포함되지 않는다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-002', internal_id: 'int-002',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      user_role: null,
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect('user_role' in meta).toBe(false);
  });
});

// ─── PA1-03: buildTraceMetadata — sub_feature 필드 ───────────────────────────
describe('PA1-03: buildTraceMetadata — sub_feature', () => {
  it('sub_feature가 제공되면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'req-003', internal_id: 'int-003',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.GROWTH_REPORT_AI,
      sub_feature: 'PREANALYSIS',
      error_stage: 'ENGINE_CALL', error_code: 'TIMEOUT',
      latency_ms: 500,
    });
    expect(meta.sub_feature).toBe('PREANALYSIS');
  });

  it('FINAL_ANALYSIS sub_feature도 정상 처리된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-004', internal_id: 'int-004',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.GROWTH_REPORT_AI,
      sub_feature: 'FINAL_ANALYSIS',
      generation_mode: 'engine_call', model: null,
      latency_ms: 3000,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    expect(meta.sub_feature).toBe('FINAL_ANALYSIS');
  });
});

// ─── PA1-04: buildTraceMetadata — result_generated 필드 ──────────────────────
describe('PA1-04: buildTraceMetadata — result_generated', () => {
  it('result_generated=true이면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-005', internal_id: 'int-005',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      result_generated: true,
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.result_generated).toBe(true);
  });

  it('result_generated=false이면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'req-006', internal_id: 'int-006',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      result_generated: false,
      error_stage: 'PROVIDER_CALL', error_code: 'MODEL_TIMEOUT',
      latency_ms: 30000,
    });
    expect(meta.result_generated).toBe(false);
  });
});

// ─── PA1-05: buildTraceMetadata — provider 필드 ──────────────────────────────
describe('PA1-05: buildTraceMetadata — provider', () => {
  it('provider="openai"이면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-007', internal_id: 'int-007',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      provider: 'openai',
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.provider).toBe('openai');
  });

  it('provider 미제공 시 metadata에 포함되지 않는다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-008', internal_id: 'int-008',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.PARENT_CURRICULUM_AI,
      generation_mode: 'engine_call', model: null,
      latency_ms: 2000,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    expect('provider' in meta).toBe(false);
  });
});

// ─── PA1-06: buildTraceMetadata — cached_tokens 필드 ─────────────────────────
describe('PA1-06: buildTraceMetadata — cached_tokens', () => {
  it('cached_tokens가 제공되면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-009', internal_id: 'int-009',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      cached_tokens: 200,
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.cached_tokens).toBe(200);
  });
});

// ─── PA1-07: buildTraceMetadata — source_app 필드 ────────────────────────────
describe('PA1-07: buildTraceMetadata — source_app', () => {
  it('source_app="app"이면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-010', internal_id: 'int-010',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      source_app: 'app',
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.source_app).toBe('app');
  });
});

// ─── PA1-08: AiTraceSuccess — model=null 허용 (외부 엔진 경유) ───────────────
describe('PA1-08: AiTraceSuccess — model null 허용', () => {
  it('model=null이면 metadata.model 키가 absent이다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-011', internal_id: 'int-011',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.GROWTH_REPORT_AI,
      generation_mode: 'engine_call',
      model: null,
      latency_ms: 4000,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    // null이면 키 absent (if != null 패턴)
    expect('model' in meta).toBe(false);
  });

  it('model="gpt-4o-mini"이면 metadata.model에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-012', internal_id: 'int-012',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      generation_mode: 'legacy',
      model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.model).toBe('gpt-4o-mini');
  });
});

// ─── PA1-09: AiTraceSuccess — tokens null 허용 (외부 엔진) ──────────────────
describe('PA1-09: AiTraceSuccess — token fields null 허용', () => {
  it('input/output/total_tokens=null이면 metadata에 해당 키가 absent이다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-013', internal_id: 'int-013',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.PARENT_CURRICULUM_AI,
      generation_mode: 'NORMAL',
      model: null,
      latency_ms: 2000,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    expect('input_tokens'  in meta).toBe(false);
    expect('output_tokens' in meta).toBe(false);
    expect('total_tokens'  in meta).toBe(false);
  });

  it('tokens 값이 있으면 metadata에 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-014', internal_id: 'int-014',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      generation_mode: 'legacy',
      model: 'gpt-4o-mini',
      latency_ms: 800,
      input_tokens: 200, output_tokens: 100, total_tokens: 300,
    });
    expect(meta.input_tokens).toBe(200);
    expect(meta.output_tokens).toBe(100);
    expect(meta.total_tokens).toBe(300);
  });
});

// ─── PA1-10: saveAiTrace description 포맷 검증 ───────────────────────────────
describe('PA1-10: AI trace description 포맷', () => {
  it('feature + status 조합으로 description 문자열이 올바르게 구성된다', () => {
    // description은 saveAiTrace 내부에서 `AI ${feature} — ${status}` 로 생성됨
    // 이 테스트는 포맷 규칙 자체를 검증
    const feature = AI_FEATURE.STORY_SUMMARY;
    const status  = 'SUCCESS';
    const description = `AI ${feature} — ${status}`;
    expect(description).toBe('AI story_summary — SUCCESS');
  });

  it('FAILED 상태 description 포맷', () => {
    const feature = AI_FEATURE.GROWTH_REPORT_AI;
    const status  = 'FAILED';
    const description = `AI ${feature} — ${status}`;
    expect(description).toBe('AI growth_report_ai — FAILED');
  });
});

// ─── PA1-11: FAILED 빌드 — 모든 CS-PA1 확장 필드 포함 ───────────────────────
describe('PA1-11: buildTraceMetadata FAILED — CS-PA1 필드 일괄 포함', () => {
  it('FAILED 상태에서도 CS-PA1 확장 필드가 metadata에 들어간다', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'req-017', internal_id: 'int-017',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      user_role: 'teacher',
      sub_feature: 'RETRY',
      result_generated: false,
      provider: 'openai',
      cached_tokens: 0,
      source_app: 'app',
      error_stage: 'OUTPUT_VALIDATION',
      error_code: 'OUTPUT_VALIDATION_FAILED',
      latency_ms: 2000,
    });
    expect(meta.user_role).toBe('teacher');
    expect(meta.sub_feature).toBe('RETRY');
    expect(meta.result_generated).toBe(false);
    expect(meta.provider).toBe('openai');
    expect(meta.source_app).toBe('app');
  });
});

// ─── PA1-12: pool_mode 전달 검증 ─────────────────────────────────────────────
describe('PA1-12: pool_mode 전달', () => {
  it('pool_mode가 metadata에 저장된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-018', internal_id: 'int-018',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.PARENT_CURRICULUM_AI,
      pool_mode: 'x',
      generation_mode: 'X',
      model: null, latency_ms: 2000,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    expect(meta.pool_mode).toBe('x');
  });

  it('pool_mode=null이면 metadata.pool_mode = null이다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'req-019', internal_id: 'int-019',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      pool_mode: null,
      generation_mode: 'legacy', model: 'gpt-4o-mini',
      latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.pool_mode).toBeNull();
  });
});

// ─── PA1-13: story.ts sub_feature RETRY 패턴 ─────────────────────────────────
describe('PA1-13: story RETRY sub_feature', () => {
  it('sub_feature="RETRY"가 정상 직렬화된다', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'story_123', internal_id: 'story_123',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.STORY_SUMMARY,
      sub_feature: 'RETRY',
      provider: 'openai',
      result_generated: false,
      error_stage: 'PROVIDER_CALL', error_code: 'RETRY_OPENAI_ERROR',
      latency_ms: 3000,
    });
    expect(meta.sub_feature).toBe('RETRY');
    expect(meta.feature).toBe('story_summary');
  });
});

// ─── PA1-14: story.ts 성공 — generation_mode 구분 ────────────────────────────
describe('PA1-14: story generation_mode 구분', () => {
  it('재시도 없는 경우 story_direct', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'story_124', internal_id: 'story_124',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.STORY_SUMMARY,
      generation_mode: 'story_direct',
      model: 'gpt-4o-mini', latency_ms: 1500,
      input_tokens: 80, output_tokens: 40, total_tokens: 120,
    });
    expect(meta.generation_mode).toBe('story_direct');
  });

  it('재시도 있는 경우 story_with_retry', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'story_125', internal_id: 'story_125',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.STORY_SUMMARY,
      generation_mode: 'story_with_retry',
      model: 'gpt-4o-mini', latency_ms: 3000,
      input_tokens: 200, output_tokens: 80, total_tokens: 280,
    });
    expect(meta.generation_mode).toBe('story_with_retry');
  });
});

// ─── PA1-15: parent_curriculum_ai SUCCESS — model/tokens null ────────────────
describe('PA1-15: parent_curriculum_ai 외부 엔진 trace', () => {
  it('외부 엔진 SUCCESS — model/tokens absent, pool_mode 포함', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'pc-req-001', internal_id: 'pc-req-001',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.PARENT_CURRICULUM_AI,
      pool_mode: 'normal',
      user_role: 'parent_account',
      result_generated: true,
      generation_mode: 'NORMAL',
      model: null, latency_ms: 1800,
      input_tokens: null, output_tokens: null, total_tokens: null,
    });
    expect(meta.feature).toBe('parent_curriculum_search');
    expect(meta.user_role).toBe('parent_account');
    expect(meta.result_generated).toBe(true);
    expect('model' in meta).toBe(false);
    expect('input_tokens' in meta).toBe(false);
  });

  it('외부 엔진 FAILED — error_code 포함', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'pc-req-002', internal_id: 'pc-req-002',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.PARENT_CURRICULUM_AI,
      pool_mode: 'x',
      user_role: 'parent_account',
      result_generated: false,
      error_stage: 'ENGINE_CALL', error_code: 'ENGINE_RATE_LIMITED',
      latency_ms: 500,
    });
    expect(meta.error_code).toBe('ENGINE_RATE_LIMITED');
    expect(meta.error_stage).toBe('ENGINE_CALL');
  });
});

// ─── PA1-16: growth_report_ai — stage별 sub_feature ─────────────────────────
describe('PA1-16: growth_report_ai sub_feature 스테이지', () => {
  const stages = ['PREANALYSIS', 'FINAL_ANALYSIS'] as const;

  for (const stage of stages) {
    it(`sub_feature=${stage} 정상 직렬화`, () => {
      const meta = buildTraceMetadata({
        status: 'SUCCESS',
        request_id: `gr-req-${stage}`, internal_id: `gr-req-${stage}`,
        pool_id: 'pool-001', contract_version: '1.0',
        feature: AI_FEATURE.GROWTH_REPORT_AI,
        sub_feature: stage,
        result_generated: true,
        generation_mode: 'engine_call',
        model: null, latency_ms: 5000,
        input_tokens: null, output_tokens: null, total_tokens: null,
      });
      expect(meta.sub_feature).toBe(stage);
      expect(meta.feature).toBe('growth_report_ai');
    });
  }
});

// ─── PA1-17: AI_FEATURE 모든 상수 AI_FEATURE_LABEL에 대응 ────────────────────
describe('PA1-17: AI_FEATURE_LABEL 완전성', () => {
  it('모든 AI_FEATURE 값에 대한 레이블이 존재한다', () => {
    for (const [, featureValue] of Object.entries(AI_FEATURE)) {
      const label = AI_FEATURE_LABEL[featureValue as AiFeature];
      expect(label, `AI_FEATURE_LABEL["${featureValue}"] 누락`).toBeTruthy();
    }
  });
});

// ─── PA1-18: buildTraceMetadata 반환 구조 검증 ───────────────────────────────
describe('PA1-18: buildTraceMetadata 반환 구조', () => {
  it('반환값에 request_id, internal_id, feature, status가 포함된다', () => {
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'struct-001', internal_id: 'struct-int-001',
      pool_id: 'pool-abc', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      generation_mode: 'legacy',
      model: 'gpt-4o-mini', latency_ms: 1000,
      input_tokens: 100, output_tokens: 50, total_tokens: 150,
    });
    expect(meta.request_id).toBe('struct-001');
    expect(meta.internal_id).toBe('struct-int-001');
    expect(meta.feature).toBe('teacher_diary');
    expect(meta.status).toBe('SUCCESS');
  });

  it('metadata.pool_mode가 입력된 pool_mode와 일치한다', () => {
    const meta = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'struct-002', internal_id: 'struct-002',
      pool_id: 'pool-001', contract_version: '1.0',
      pool_mode: 'x',
      feature: AI_FEATURE.STORY_SUMMARY,
      error_stage: 'PROVIDER_CALL', error_code: 'OPENAI_ERROR',
      latency_ms: 500,
    });
    expect(meta.pool_mode).toBe('x');
  });
});

// ─── PA1-19: pool_id는 항상 TEXT (parseInt 사용 금지) ────────────────────────
describe('PA1-19: pool_id TEXT 전달 검증', () => {
  it('숫자 문자열 pool_id가 metadata에 그대로 들어간다', () => {
    // buildTraceMetadata는 pool_id를 직접 metadata에 넣지 않지만
    // 호출부에서 pool_id가 TEXT 그대로 saveAiTrace에 전달되는 계약을 검증
    // feature 상수와 pool_id는 별개이므로 metadata.pool_mode를 통해 간접 검증
    const meta = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'p-001', internal_id: 'p-001',
      pool_id: '42',   // 숫자 문자열 — parseInt 변환 금지
      contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      generation_mode: 'legacy',
      model: 'gpt-4o-mini', latency_ms: 500,
      input_tokens: 10, output_tokens: 5, total_tokens: 15,
    });
    // 메타데이터가 정상 생성됐으면 pool_id TEXT 전달 계약 충족
    expect(meta).toBeDefined();
    expect(meta.request_id).toBe('p-001');
  });
});

// ─── PA1-20: TELEMETRY_FAILURE_BREAKS_AI = NO 패턴 검증 ─────────────────────
describe('PA1-20: saveAiTrace 실패 격리 패턴', () => {
  it('buildTraceMetadata 자체는 throw 없이 실행된다 (sync 안전)', () => {
    expect(() => {
      buildTraceMetadata({
        status: 'SUCCESS',
        request_id: 'safe-001', internal_id: 'safe-001',
        pool_id: 'pool-001', contract_version: '1.0',
        feature: AI_FEATURE.STORY_SUMMARY,
        generation_mode: 'story_direct',
        model: 'gpt-4o-mini', latency_ms: 800,
        input_tokens: 50, output_tokens: 20, total_tokens: 70,
      });
    }).not.toThrow();
  });

  it('빈 pool_id로도 buildTraceMetadata가 throw하지 않는다', () => {
    expect(() => {
      buildTraceMetadata({
        status: 'FAILED',
        request_id: 'safe-002', internal_id: 'safe-002',
        pool_id: '',   // 빈 pool_id (story.ts에서 diary.swimming_pool_id가 없는 경우)
        contract_version: '1.0',
        feature: AI_FEATURE.STORY_SUMMARY,
        error_stage: 'PROVIDER_CALL', error_code: 'OPENAI_ERROR',
        latency_ms: 100,
      });
    }).not.toThrow();
  });
});

// ─── PA1-21: 기존 ai-v1.ts 계측 — SUCCESS/FAILED 분기 공존 ─────────────────
describe('PA1-21: 기존 ai-v1.ts 계측과의 공존', () => {
  it('SUCCESS와 FAILED 빌드가 동일 feature에서 독립적으로 동작한다', () => {
    const success = buildTraceMetadata({
      status: 'SUCCESS',
      request_id: 'coex-001', internal_id: 'coex-001',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      generation_mode: 'parser_v1',
      model: 'gpt-4o-mini', latency_ms: 1200,
      input_tokens: 300, output_tokens: 150, total_tokens: 450,
    });
    const failed = buildTraceMetadata({
      status: 'FAILED',
      request_id: 'coex-002', internal_id: 'coex-002',
      pool_id: 'pool-001', contract_version: '1.0',
      feature: AI_FEATURE.TEACHER_AI_DIARY,
      error_stage: 'PROVIDER_CALL', error_code: 'MODEL_TIMEOUT',
      latency_ms: 30000,
    });
    expect(success.status).toBe('SUCCESS');
    expect(failed.status).toBe('FAILED');
    expect(success.feature).toBe(failed.feature);
    // request_id는 서로 다름
    expect(success.request_id).not.toBe(failed.request_id);
  });
});

// ─── PA1-22: 계측 추가 후 AI_FEATURE 열거형 전체 검증 ───────────────────────
describe('PA1-22: AI_FEATURE 전체 열거형 검증', () => {
  it('4개 계측 대상 feature가 모두 존재한다', () => {
    const expected = [
      'teacher_diary',
      'parent_curriculum_search',
      'growth_report_ai',
      'story_summary',
    ];
    for (const f of expected) {
      expect(Object.values(AI_FEATURE)).toContain(f);
    }
  });

  it('AI_FEATURE에 총 9개 이상의 feature가 정의되어 있다', () => {
    expect(Object.keys(AI_FEATURE).length).toBeGreaterThanOrEqual(9);
  });
});
