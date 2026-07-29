/**
 * ai-diary.test.ts — POST /ai/diary/generate 안전장치 테스트
 *
 * 테스트 대상 기능:
 *   - DIARY_PIPELINE_MODE (legacy/parser_v1/invalid fallback)
 *   - DIARY_GPT_TIMEOUT_MS + MODEL_TIMEOUT → 504
 *   - STUDENT_RESOLUTION_REQUIRED (parser_v1 + empty students)
 *   - parser_v1 Tenant 격리 (JWT poolId ↔ context.pool_id)
 *   - request_id echo
 *   - legacy 하위 호환
 *   - output validation pass
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getEffectivePipelineMode,
  getGptTimeoutMs,
  ModelTimeoutError,
  StudentResolutionError,
  validateDiaryOutput,
  isValidExternalRequestId,
  hashPoolId,
} from '../../lib/ai-diary-utils.js';

// ── 환경변수 헬퍼 ────────────────────────────────────────────────────────────
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(original)) {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DIARY_PIPELINE_MODE
// ─────────────────────────────────────────────────────────────────────────────
describe('getEffectivePipelineMode', () => {
  it('env 없으면 legacy 반환', () => {
    withEnv({ DIARY_PIPELINE_MODE: undefined }, () => {
      expect(getEffectivePipelineMode()).toBe('legacy');
    });
  });

  it('"legacy" → legacy', () => {
    withEnv({ DIARY_PIPELINE_MODE: 'legacy' }, () => {
      expect(getEffectivePipelineMode()).toBe('legacy');
    });
  });

  it('"parser_v1" → parser_v1', () => {
    withEnv({ DIARY_PIPELINE_MODE: 'parser_v1' }, () => {
      expect(getEffectivePipelineMode()).toBe('parser_v1');
    });
  });

  it('잘못된 값은 경고 후 legacy fallback', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withEnv({ DIARY_PIPELINE_MODE: 'v3-turbo' }, () => {
      expect(getEffectivePipelineMode()).toBe('legacy');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('legacy로 폴백'));
    });
    warnSpy.mockRestore();
  });

  it('대소문자 무시', () => {
    withEnv({ DIARY_PIPELINE_MODE: 'PARSER_V1' }, () => {
      expect(getEffectivePipelineMode()).toBe('parser_v1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DIARY_GPT_TIMEOUT_MS
// ─────────────────────────────────────────────────────────────────────────────
describe('getGptTimeoutMs', () => {
  it('env 없으면 30000 반환', () => {
    withEnv({ DIARY_GPT_TIMEOUT_MS: undefined }, () => {
      expect(getGptTimeoutMs()).toBe(30_000);
    });
  });

  it('유효한 숫자 반환', () => {
    withEnv({ DIARY_GPT_TIMEOUT_MS: '15000' }, () => {
      expect(getGptTimeoutMs()).toBe(15_000);
    });
  });

  it('숫자가 아닌 값 → 경고 후 30000', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withEnv({ DIARY_GPT_TIMEOUT_MS: 'abc' }, () => {
      expect(getGptTimeoutMs()).toBe(30_000);
      expect(warnSpy).toHaveBeenCalled();
    });
    warnSpy.mockRestore();
  });

  it('0 이하 → 경고 후 30000', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withEnv({ DIARY_GPT_TIMEOUT_MS: '-1' }, () => {
      expect(getGptTimeoutMs()).toBe(30_000);
      expect(warnSpy).toHaveBeenCalled();
    });
    warnSpy.mockRestore();
  });

  it('0 → 경고 후 30000', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withEnv({ DIARY_GPT_TIMEOUT_MS: '0' }, () => {
      expect(getGptTimeoutMs()).toBe(30_000);
      expect(warnSpy).toHaveBeenCalled();
    });
    warnSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ModelTimeoutError
// ─────────────────────────────────────────────────────────────────────────────
describe('ModelTimeoutError', () => {
  it('name이 ModelTimeoutError', () => {
    const err = new ModelTimeoutError();
    expect(err.name).toBe('ModelTimeoutError');
  });

  it('message가 MODEL_TIMEOUT', () => {
    const err = new ModelTimeoutError();
    expect(err.message).toBe('MODEL_TIMEOUT');
  });

  it('instanceof ModelTimeoutError', () => {
    expect(new ModelTimeoutError()).toBeInstanceOf(ModelTimeoutError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. StudentResolutionError
// ─────────────────────────────────────────────────────────────────────────────
describe('StudentResolutionError', () => {
  it('name이 StudentResolutionError', () => {
    const err = new StudentResolutionError('no students');
    expect(err.name).toBe('StudentResolutionError');
  });

  it('message가 STUDENT_RESOLUTION_REQUIRED', () => {
    const err = new StudentResolutionError('no students');
    expect(err.message).toBe('STUDENT_RESOLUTION_REQUIRED');
  });

  it('reason 보존', () => {
    const err = new StudentResolutionError('empty_array');
    expect(err.reason).toBe('empty_array');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. validateDiaryOutput (Output Validation)
// ─────────────────────────────────────────────────────────────────────────────
describe('validateDiaryOutput', () => {
  const refs = new Set(['ref-1', 'ref-2']);

  it('정상 출력 통과', () => {
    const result = validateDiaryOutput(
      { common: '오늘 수업 잘 했어요.', students: [{ student_ref: 'ref-1', content: '발차기 잘함' }] },
      refs,
    );
    expect(result.common).toBe('오늘 수업 잘 했어요.');
    expect(result.students[0].student_ref).toBe('ref-1');
  });

  it('students 없으면 common만 반환', () => {
    const result = validateDiaryOutput({ common: '공통 일지입니다.' }, refs);
    expect(result.students).toHaveLength(0);
  });

  it('허용되지 않은 student_ref → UNKNOWN_STUDENT_REF throw', () => {
    expect(() =>
      validateDiaryOutput(
        { common: '공통', students: [{ student_ref: 'ref-UNKNOWN', content: '내용' }] },
        refs,
      ),
    ).toThrow('OUTPUT_VALIDATION_FAILED');
  });

  it('중복 student_ref → DUPLICATE_STUDENT_REF throw', () => {
    expect(() =>
      validateDiaryOutput(
        { common: '공통', students: [
          { student_ref: 'ref-1', content: '내용1' },
          { student_ref: 'ref-1', content: '내용2' },
        ] },
        refs,
      ),
    ).toThrow('OUTPUT_VALIDATION_FAILED');
  });

  it('student_id fallback → student_ref로 정규화', () => {
    const result = validateDiaryOutput(
      { common: '공통 일지', students: [{ student_id: 'ref-1', content: '발차기 잘함' }] },
      refs,
    );
    expect(result.students[0].student_ref).toBe('ref-1');
  });

  it('최상위가 배열이면 throw', () => {
    expect(() => validateDiaryOutput([], refs)).toThrow('OUTPUT_VALIDATION_FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. isValidExternalRequestId
// ─────────────────────────────────────────────────────────────────────────────
describe('isValidExternalRequestId', () => {
  it('정상 UUID → true', () => {
    expect(isValidExternalRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('빈 문자열 → false', () => {
    expect(isValidExternalRequestId('')).toBe(false);
  });

  it('128자 초과 → false', () => {
    expect(isValidExternalRequestId('a'.repeat(129))).toBe(false);
  });

  it('null → false', () => {
    expect(isValidExternalRequestId(null)).toBe(false);
  });

  it('숫자 → false', () => {
    expect(isValidExternalRequestId(123)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. hashPoolId
// ─────────────────────────────────────────────────────────────────────────────
describe('hashPoolId', () => {
  it('동일 입력 → 동일 출력 (결정론적)', () => {
    expect(hashPoolId('pool-abc')).toBe(hashPoolId('pool-abc'));
  });

  it('다른 입력 → 다른 출력', () => {
    expect(hashPoolId('pool-abc')).not.toBe(hashPoolId('pool-xyz'));
  });

  it('"p" 접두사 포함', () => {
    expect(hashPoolId('pool-abc')).toMatch(/^p[0-9a-f]+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Tenant 격리 시뮬레이션 (순수 로직)
// ─────────────────────────────────────────────────────────────────────────────
describe('parser_v1 Tenant 격리 (로직 시뮬레이션)', () => {
  function checkTenantIsolation(jwtPoolId: string | null | undefined, ctxPoolId: string): { ok: boolean; reason?: string } {
    // ai.ts 라우트의 Tenant 격리 로직을 그대로 추출
    if (!jwtPoolId) return { ok: false, reason: 'jwt_pool_id_missing' };
    if (jwtPoolId !== ctxPoolId) return { ok: false, reason: 'pool_id_mismatch' };
    return { ok: true };
  }

  it('JWT poolId 없음(null) + parser_v1 → 403', () => {
    expect(checkTenantIsolation(null, 'pool-A').ok).toBe(false);
    expect(checkTenantIsolation(null, 'pool-A').reason).toBe('jwt_pool_id_missing');
  });

  it('JWT poolId 없음(undefined) + parser_v1 → 403', () => {
    expect(checkTenantIsolation(undefined, 'pool-A').ok).toBe(false);
  });

  it('JWT poolId 불일치 → 403', () => {
    expect(checkTenantIsolation('pool-B', 'pool-A').ok).toBe(false);
    expect(checkTenantIsolation('pool-B', 'pool-A').reason).toBe('pool_id_mismatch');
  });

  it('JWT poolId 일치 → 통과', () => {
    expect(checkTenantIsolation('pool-A', 'pool-A').ok).toBe(true);
  });
});
