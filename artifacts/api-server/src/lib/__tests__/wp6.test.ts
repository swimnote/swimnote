/**
 * wp6.test.ts — WP6 Curriculum AI Pipeline 단위 테스트
 *
 * 검증 대상:
 *   1. GrowthConfidenceConfig — validateConfidenceConfig
 *   2. computeCurriculumConfidence — token overlap 계산, threshold, match_status
 *   3. match-token — createMatchToken, verifyMatchToken, MatchTokenError, AUTO_ACCEPTED 금지
 *   4. searchCurriculumCandidates — mock DB 주입, student_ref 검증, 빈 배열 처리
 *
 * 핵심 불변 검증:
 *   - AUTO_ACCEPTED 값이 코드 어디에도 없음
 *   - JWT_SECRET fallback 없음
 *   - DB PK(_curriculum_item_id)가 응답 candidate_id로 노출 안 됨
 *   - MATCH_TOKEN_SECRET 미설정 시 X_MODE_TOKEN_NOT_CONFIGURED 에러
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_CONFIDENCE_CONFIG_V1,
  validateConfidenceConfig,
  type GrowthConfidenceConfigV1,
} from '../../config/growth-confidence-config.js';
import { computeCurriculumConfidence, MATCHING_ALGORITHM_VERSION } from '../curriculum-confidence.js';
import {
  createMatchToken,
  verifyMatchToken,
  newTokenId,
  MatchTokenError,
  type MatchTokenPayload,
} from '../match-token.js';
import {
  searchCurriculumCandidates,
  type CurriculumDb,
  type CurriculumCandidateResult,
} from '../curriculum-candidate-search.js';
import type { ExtractedMeaning } from '../diary-parser.js';

// ── 환경변수 헬퍼 ─────────────────────────────────────────────────────────────
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
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

async function withEnvAsync(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
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
    await fn();
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

// ── 고정 테스트 시크릿 (실제 MATCH_TOKEN_SECRET과 별개) ──────────────────────
const TEST_SECRET  = 'test-secret-for-wp6-unit-tests-only-not-production';
const TEST_KEY_ID  = 'v1';

// ── 기본 테스트용 payload ──────────────────────────────────────────────────────
function makePayload(overrides: Partial<MatchTokenPayload> = {}): MatchTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    token_version:               '1',
    key_id:                      TEST_KEY_ID,
    token_id:                    newTokenId(),
    issued_at:                   now,
    expires_at:                  now + 86400,
    pool_id:                     'pool-test-123',
    student_id:                  'student-abc',
    curriculum_version_id:       'cv-001',
    curriculum_item_id:          'ci-999', // 응답 미포함 DB PK
    candidate_id:                'cand_' + 'a'.repeat(32),
    confidence:                  0.75,
    matching_algorithm_version:  MATCHING_ALGORITHM_VERSION,
    confidence_config_version:   'growth_conf_v1',
    request_id:                  'req-test-001',
    contract_version:            '1.3',
    ...overrides,
  };
}

// ── 테스트 ExtractedMeaning ────────────────────────────────────────────────────
function makeMeaning(overrides: Partial<ExtractedMeaning> = {}): ExtractedMeaning {
  return {
    strokes:     ['자유형'],
    skills:      ['발차기', '호흡'],
    issues:      ['무릎'],
    allKeywords: ['자유형', '발차기', '호흡', '무릎'],
    confidence:  0.95,
    ...overrides,
  };
}

// ── mock CurriculumDb ─────────────────────────────────────────────────────────
function makeMockDb(overrides: Partial<CurriculumDb> = {}): CurriculumDb {
  return {
    verifyStudentRefs:  async (refs)        => refs, // 모두 검증 통과
    getAssignedVersions: async (studentIds) =>
      studentIds.map((id) => ({ student_id: id, curriculum_version_id: 'cv-001' })),
    getCurriculumItems:  async ()           => [
      { id: 'ci-001', title: '자유형 발차기 기초', description: '호흡 타이밍', curriculum_version_id: 'cv-001' },
      { id: 'ci-002', title: '접영 기초',          description: null,          curriculum_version_id: 'cv-001' },
    ],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GrowthConfidenceConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('GrowthConfidenceConfig', () => {
  it('DEFAULT_CONFIDENCE_CONFIG_V1.reviewThreshold = 0.50', () => {
    expect(DEFAULT_CONFIDENCE_CONFIG_V1.reviewThreshold).toBe(0.50);
  });

  it('DEFAULT_CONFIDENCE_CONFIG_V1.version = "growth_conf_v1"', () => {
    expect(DEFAULT_CONFIDENCE_CONFIG_V1.version).toBe('growth_conf_v1');
  });

  it('validateConfidenceConfig: 유효한 값 통과', () => {
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: 0.50 })).not.toThrow();
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: 0.0  })).not.toThrow();
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: 1.0  })).not.toThrow();
  });

  it('validateConfidenceConfig: NaN throw', () => {
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: NaN })).toThrow();
  });

  it('validateConfidenceConfig: 음수 throw', () => {
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: -0.1 })).toThrow();
  });

  it('validateConfidenceConfig: 1 초과 throw', () => {
    expect(() => validateConfidenceConfig({ version: 'growth_conf_v1', reviewThreshold: 1.01 })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeCurriculumConfidence
// ─────────────────────────────────────────────────────────────────────────────
describe('computeCurriculumConfidence', () => {
  const cfg = DEFAULT_CONFIDENCE_CONFIG_V1; // threshold = 0.50

  it('키워드 없는 meaning → null 반환', () => {
    const meaning = makeMeaning({ strokes: [], skills: [], issues: [], allKeywords: [] });
    const result = computeCurriculumConfidence(meaning, { title: '자유형', description: null }, cfg);
    expect(result).toBeNull();
  });

  it('모든 키워드 일치 → confidence = 1.0, PENDING_REVIEW', () => {
    const meaning = makeMeaning({ strokes: ['자유형'], skills: ['발차기'], issues: [], allKeywords: ['자유형', '발차기'] });
    const item = { title: '자유형 발차기', description: null };
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.match_status).toBe('PENDING_REVIEW');
    // AUTO_ACCEPTED 절대 금지
    expect(result!.match_status).not.toBe('AUTO_ACCEPTED');
  });

  it('키워드 절반 미만 일치 → null (threshold 0.50 미달)', () => {
    // 4개 키워드 중 1개만 일치 → score = 0.25 < 0.50
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기', '호흡'], issues: ['무릎'],
      allKeywords: ['자유형', '발차기', '호흡', '무릎'],
    });
    const item = { title: '접영 기초', description: null }; // 아무것도 일치 안 함
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result).toBeNull();
  });

  it('threshold 정확히 0.50 이상이면 포함', () => {
    // 2개 키워드 중 1개 일치 → score = 0.50 = threshold → 포함
    const meaning = makeMeaning({ strokes: ['자유형'], skills: ['발차기'], issues: [], allKeywords: ['자유형', '발차기'] });
    const item = { title: '자유형 호흡', description: null }; // '자유형' 일치
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeCloseTo(0.5, 4);
  });

  it('description 텍스트도 일치 검색에 사용', () => {
    const meaning = makeMeaning({ strokes: [], skills: ['발차기'], issues: [], allKeywords: ['발차기'] });
    const item = { title: '기초 수영', description: '발차기 연습 과정' };
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
  });

  it('대소문자 구분 없음 (한글은 case-insensitive 무관)', () => {
    const meaning = makeMeaning({ strokes: ['자유형'], skills: [], issues: [], allKeywords: ['자유형'] });
    const item = { title: '자유형 영법', description: null };
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result).not.toBeNull();
  });

  it('matching_algorithm_version = "token_overlap_v1"', () => {
    const meaning = makeMeaning({ strokes: ['자유형'], skills: [], issues: [], allKeywords: ['자유형'] });
    const item = { title: '자유형', description: null };
    const result = computeCurriculumConfidence(meaning, item, cfg);
    expect(result!.matching_algorithm_version).toBe('token_overlap_v1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. match-token
// ─────────────────────────────────────────────────────────────────────────────
describe('match-token', () => {
  describe('newTokenId', () => {
    it('"tid_" + 32자 hex = 36자 형식', () => {
      const id = newTokenId();
      expect(id).toMatch(/^tid_[0-9a-f]{32}$/);
      expect(id).toHaveLength(36);
    });

    it('요청마다 다른 값 생성', () => {
      const ids = new Set(Array.from({ length: 20 }, () => newTokenId()));
      expect(ids.size).toBe(20);
    });
  });

  describe('MATCH_TOKEN_SECRET 미설정 시 lazy fail', () => {
    it('createMatchToken: X_MODE_TOKEN_NOT_CONFIGURED 에러', () => {
      withEnv({ MATCH_TOKEN_SECRET: undefined, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        expect(() => createMatchToken(makePayload())).toThrowError(
          expect.objectContaining({ code: 'X_MODE_TOKEN_NOT_CONFIGURED' }),
        );
      });
    });

    it('verifyMatchToken: X_MODE_TOKEN_NOT_CONFIGURED 에러', () => {
      // 먼저 토큰 생성 (secret 설정 상태)
      let token = '';
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        token = createMatchToken(makePayload());
      });

      // secret 제거 후 검증 시도
      withEnv({ MATCH_TOKEN_SECRET: undefined, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        expect(() =>
          verifyMatchToken(token, {
            expectedPoolId:      'pool-test-123',
            expectedStudentId:   'student-abc',
            expectedCandidateId: 'cand_' + 'a'.repeat(32),
          }),
        ).toThrowError(expect.objectContaining({ code: 'X_MODE_TOKEN_NOT_CONFIGURED' }));
      });
    });

    it('JWT_SECRET를 fallback으로 사용하지 않음', () => {
      // MATCH_TOKEN_SECRET 미설정, JWT_SECRET 설정 → 여전히 fail
      withEnv({ MATCH_TOKEN_SECRET: undefined, JWT_SECRET: 'jwt-secret', MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        expect(() => createMatchToken(makePayload())).toThrowError(
          expect.objectContaining({ code: 'X_MODE_TOKEN_NOT_CONFIGURED' }),
        );
      });
    });
  });

  describe('createMatchToken + verifyMatchToken 정상 흐름', () => {
    it('생성 후 검증 성공', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload();
        const token = createMatchToken(payload);

        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3);
        expect(token.length).toBeLessThanOrEqual(2048);

        const verified = verifyMatchToken(token, {
          expectedPoolId:      payload.pool_id,
          expectedStudentId:   payload.student_id,
          expectedCandidateId: payload.candidate_id,
        });

        expect(verified.pool_id).toBe(payload.pool_id);
        expect(verified.student_id).toBe(payload.student_id);
        expect(verified.curriculum_item_id).toBe(payload.curriculum_item_id);
        expect(verified.candidate_id).toBe(payload.candidate_id);
        expect(verified.confidence).toBe(payload.confidence);
        expect(verified.token_version).toBe('1');
        // match_status는 MatchTokenPayload 타입에 없음 (응답용 필드, payload 미포함 설계)
      });
    });

    it('payload에 curriculum_item_id 포함 (내부 검증용)', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload({ curriculum_item_id: 'ci-secret-db-pk' });
        const token = createMatchToken(payload);
        const verified = verifyMatchToken(token, {
          expectedPoolId:           payload.pool_id,
          expectedStudentId:        payload.student_id,
          expectedCandidateId:      payload.candidate_id,
          expectedCurriculumItemId: 'ci-secret-db-pk',
        });
        expect(verified.curriculum_item_id).toBe('ci-secret-db-pk');
      });
    });

    it('잘못된 pool_id → TENANT_MISMATCH', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload();
        const token = createMatchToken(payload);
        expect(() =>
          verifyMatchToken(token, {
            expectedPoolId:      'wrong-pool',
            expectedStudentId:   payload.student_id,
            expectedCandidateId: payload.candidate_id,
          }),
        ).toThrowError(expect.objectContaining({ code: 'TENANT_MISMATCH' }));
      });
    });

    it('잘못된 student_id → STUDENT_MISMATCH', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload();
        const token = createMatchToken(payload);
        expect(() =>
          verifyMatchToken(token, {
            expectedPoolId:      payload.pool_id,
            expectedStudentId:   'wrong-student',
            expectedCandidateId: payload.candidate_id,
          }),
        ).toThrowError(expect.objectContaining({ code: 'STUDENT_MISMATCH' }));
      });
    });

    it('잘못된 candidate_id → CANDIDATE_ID_MISMATCH', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload();
        const token = createMatchToken(payload);
        expect(() =>
          verifyMatchToken(token, {
            expectedPoolId:      payload.pool_id,
            expectedStudentId:   payload.student_id,
            expectedCandidateId: 'cand_wrong',
          }),
        ).toThrowError(expect.objectContaining({ code: 'CANDIDATE_ID_MISMATCH' }));
      });
    });

    it('만료된 토큰 → EXPIRED_MATCH_TOKEN', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const now = Math.floor(Date.now() / 1000);
        const payload = makePayload({ issued_at: now - 90000, expires_at: now - 3600 });
        const token = createMatchToken(payload);
        expect(() =>
          verifyMatchToken(token, {
            expectedPoolId:      payload.pool_id,
            expectedStudentId:   payload.student_id,
            expectedCandidateId: payload.candidate_id,
          }),
        ).toThrowError(expect.objectContaining({ code: 'EXPIRED_MATCH_TOKEN' }));
      });
    });

    it('서명 변조 → INVALID_MATCH_TOKEN', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        const payload = makePayload();
        const token = createMatchToken(payload);
        const tampered = token.slice(0, -5) + 'XXXXX'; // 서명 마지막 5자 변조
        expect(() =>
          verifyMatchToken(tampered, {
            expectedPoolId:      payload.pool_id,
            expectedStudentId:   payload.student_id,
            expectedCandidateId: payload.candidate_id,
          }),
        ).toThrowError(expect.objectContaining({ code: expect.stringMatching(/INVALID_MATCH_TOKEN|MALFORMED_TOKEN/) }));
      });
    });

    it('잘못된 key_id → UNKNOWN_KEY_ID', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: 'v2' /* 다른 key_id */ }, () => {
        // v1 key_id로 생성
        const payload = makePayload({ key_id: 'v1' });

        // 직접 토큰 구성 (key_id 불일치 시나리오)
        // verifyMatchToken 내부에서 header.kid('v1') !== currentKeyId('v2') → UNKNOWN_KEY_ID
        // createMatchToken은 env의 MATCH_TOKEN_KEY_ID('v2')를 사용하므로
        // payload.key_id를 'v1'으로 설정해도 헤더에는 'v2'가 들어감
        // 따라서 이 시나리오는 key_id가 바뀐 환경에서 이전 토큰 검증 실패를 테스트해야 함
        // → v1 환경에서 생성 후 v2 환경에서 검증
        let tokenV1 = '';
        withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: 'v1' }, () => {
          tokenV1 = createMatchToken(makePayload());
        });
        // v2 환경에서 검증 → UNKNOWN_KEY_ID
        expect(() =>
          verifyMatchToken(tokenV1, {
            expectedPoolId:      'pool-test-123',
            expectedStudentId:   'student-abc',
            expectedCandidateId: 'cand_' + 'a'.repeat(32),
          }),
        ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_KEY_ID' }));
      });
    });

    it('빈 문자열 토큰 → MALFORMED_TOKEN', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        expect(() =>
          verifyMatchToken('', {
            expectedPoolId: 'p', expectedStudentId: 's', expectedCandidateId: 'c',
          }),
        ).toThrowError(expect.objectContaining({ code: 'MALFORMED_TOKEN' }));
      });
    });

    it('2048자 초과 토큰 → MALFORMED_TOKEN', () => {
      withEnv({ MATCH_TOKEN_SECRET: TEST_SECRET, MATCH_TOKEN_KEY_ID: TEST_KEY_ID }, () => {
        expect(() =>
          verifyMatchToken('a'.repeat(2049), {
            expectedPoolId: 'p', expectedStudentId: 's', expectedCandidateId: 'c',
          }),
        ).toThrowError(expect.objectContaining({ code: 'MALFORMED_TOKEN' }));
      });
    });

    it('MatchTokenError에 code 프로퍼티 존재', () => {
      const err = new MatchTokenError('TEST_CODE', 'test message');
      expect(err.code).toBe('TEST_CODE');
      expect(err instanceof Error).toBe(true);
      expect(err.name).toBe('MatchTokenError');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. searchCurriculumCandidates (mock DB 주입)
// ─────────────────────────────────────────────────────────────────────────────
describe('searchCurriculumCandidates', () => {
  const cfg = DEFAULT_CONFIDENCE_CONFIG_V1;
  const poolId = 'pool-test-001';

  it('requestedRefs 빈 배열 → [] 반환', async () => {
    const result = await searchCurriculumCandidates(
      { requestedRefs: [], poolId, meaning: makeMeaning(), config: cfg },
      makeMockDb(),
    );
    expect(result).toEqual([]);
  });

  it('DB 검증에서 모든 ref 탈락 → [] 반환', async () => {
    const db = makeMockDb({
      verifyStudentRefs: async () => [], // 모두 탈락
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1', 's2'], poolId, meaning: makeMeaning(), config: cfg },
      db,
    );
    expect(result).toEqual([]);
  });

  it('배정된 curriculum version 없음 → [] 반환', async () => {
    const db = makeMockDb({
      getAssignedVersions: async () => [], // 배정 없음
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning: makeMeaning(), config: cfg },
      db,
    );
    expect(result).toEqual([]);
  });

  it('curriculum items 없음 → [] 반환', async () => {
    const db = makeMockDb({
      getCurriculumItems: async () => [], // 아이템 없음
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning: makeMeaning(), config: cfg },
      db,
    );
    expect(result).toEqual([]);
  });

  it('threshold 이상 일치 → candidate_id가 "cand_"로 시작, match_status=PENDING_REVIEW', async () => {
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기'], issues: [],
      allKeywords: ['자유형', '발차기'],
    });
    // DB의 첫 번째 item: '자유형 발차기 기초' (title) + '호흡 타이밍' (desc)
    // → '자유형', '발차기' 모두 일치 → score = 1.0 ≥ 0.50
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['student-1'], poolId, meaning, config: cfg },
      makeMockDb(),
    );

    // 최소 1개 이상의 candidate
    expect(result.length).toBeGreaterThanOrEqual(1);

    const first = result[0]!;
    expect(first.candidate_id).toMatch(/^cand_[0-9a-f]{32}$/);
    expect(first.match_status).toBe('PENDING_REVIEW');
    // AUTO_ACCEPTED 절대 금지
    expect(first.match_status).not.toBe('AUTO_ACCEPTED');
    expect(first.student_ref).toBe('student-1');
    expect(first.display_label).toBe('자유형 발차기 기초');
    expect(first.curriculum_version_id).toBe('cv-001');
    expect(first._curriculum_item_id).toBe('ci-001');
    expect(first.matching_algorithm_version).toBe('token_overlap_v1');
  });

  it('_curriculum_item_id는 candidate_id와 다른 값 (DB PK 은닉)', async () => {
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['student-1'], poolId, meaning: makeMeaning(), config: cfg },
      makeMockDb(),
    );
    for (const r of result) {
      // candidate_id는 opaque ("cand_" + hex), _curriculum_item_id는 DB PK ("ci-xxx")
      expect(r.candidate_id).not.toBe(r._curriculum_item_id);
      expect(r.candidate_id).toMatch(/^cand_/);
    }
  });

  it('DB 오류 발생 → [] 반환 (전체 요청 실패 없음)', async () => {
    const db = makeMockDb({
      verifyStudentRefs: async () => { throw new Error('DB connection error'); },
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning: makeMeaning(), config: cfg },
      db,
    );
    expect(result).toEqual([]);
  });

  it('여러 학생 각각에 대해 candidate 생성', async () => {
    const db = makeMockDb({
      verifyStudentRefs:   async (refs) => refs,
      getAssignedVersions: async (studentIds) =>
        studentIds.map((id) => ({ student_id: id, curriculum_version_id: 'cv-001' })),
    });
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기'], issues: [],
      allKeywords: ['자유형', '발차기'],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1', 's2'], poolId, meaning, config: cfg },
      db,
    );
    const s1Refs = result.filter((r) => r.student_ref === 's1');
    const s2Refs = result.filter((r) => r.student_ref === 's2');
    expect(s1Refs.length).toBeGreaterThanOrEqual(1);
    expect(s2Refs.length).toBeGreaterThanOrEqual(1);
  });

  it('candidate_id는 요청마다 고유한 값 생성', async () => {
    const result1 = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning: makeMeaning(), config: cfg },
      makeMockDb(),
    );
    const result2 = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning: makeMeaning(), config: cfg },
      makeMockDb(),
    );
    // 같은 item이지만 candidate_id는 다름 (randomBytes)
    if (result1.length > 0 && result2.length > 0) {
      expect(result1[0]!.candidate_id).not.toBe(result2[0]!.candidate_id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 불변 검증: 코드 레벨 AUTO_ACCEPTED 미사용
// ─────────────────────────────────────────────────────────────────────────────
describe('불변 검증: AUTO_ACCEPTED 금지', () => {
  it('computeCurriculumConfidence 반환값에 AUTO_ACCEPTED 없음', () => {
    const meaning = makeMeaning();
    const item = { title: '자유형 발차기', description: null };
    const result = computeCurriculumConfidence(meaning, item, DEFAULT_CONFIDENCE_CONFIG_V1);
    if (result) {
      expect(result.match_status).not.toBe('AUTO_ACCEPTED');
    }
  });

  it('searchCurriculumCandidates 결과에 AUTO_ACCEPTED 없음', async () => {
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: 'pool-test', meaning: makeMeaning(), config: DEFAULT_CONFIDENCE_CONFIG_V1 },
      makeMockDb(),
    );
    for (const r of result) {
      expect(r.match_status).not.toBe('AUTO_ACCEPTED');
    }
  });
});
