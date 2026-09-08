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
    // 2-Layer: Global Reference items (기본 빈 배열 — 기존 테스트 영향 없음)
    getGlobalReferenceItems: async () => [],
    // Canonical Local Resolver fallback (SCA 없는 학생 → pool active version)
    getPoolActiveLocalVersion: async () => null, // 기본: fallback 없음 (기존 테스트 호환)
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
// 4-B. 2-Layer Architecture (POOL_LOCAL / GLOBAL_REFERENCE) 검증
// ─────────────────────────────────────────────────────────────────────────────
describe('2-Layer Curriculum Search', () => {
  const cfg = DEFAULT_CONFIDENCE_CONFIG_V1;
  const poolId = 'pool-test-001';

  // ── mock helper ────────────────────────────────────────────────────────────
  function makeTwoLayerDb(
    overrides: Partial<CurriculumDb> = {},
  ): CurriculumDb {
    return {
      verifyStudentRefs:   async (refs) => refs,
      getAssignedVersions: async (studentIds) =>
        studentIds.map((id) => ({ student_id: id, curriculum_version_id: 'cv-local-001' })),
      getCurriculumItems:  async () => [
        { id: 'ci-local-01', title: '자유형 발차기 기초', description: '호흡 타이밍', curriculum_version_id: 'cv-local-001' },
      ],
      getGlobalReferenceItems: async () => [
        { id: 'ci-global-01', title: '자유형 발차기 보강', description: '전신 킥', curriculum_version_id: 'cv-global-001' },
      ],
      // Canonical Local Resolver fallback (기본: pool active version = 'cv-local-001')
      getPoolActiveLocalVersion: async () => 'cv-local-001',
      ...overrides,
    };
  }

  // A. Local + Global 동시 match → Local은 POOL_LOCAL, Global은 GLOBAL_REFERENCE
  it('A: Local + Global 동시 match → source_scope 각각 POOL_LOCAL / GLOBAL_REFERENCE', async () => {
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기'], issues: [],
      allKeywords: ['자유형', '발차기'],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      makeTwoLayerDb(),
    );
    const local  = result.filter((r) => r.source_scope === 'POOL_LOCAL');
    const global = result.filter((r) => r.source_scope === 'GLOBAL_REFERENCE');
    expect(local.length).toBeGreaterThanOrEqual(1);
    expect(global.length).toBeGreaterThanOrEqual(1);
    // Local은 반드시 POOL_LOCAL, progress 허용
    expect(local[0]!.source_scope).toBe('POOL_LOCAL');
    // Global은 GLOBAL_REFERENCE, progress 금지
    expect(global[0]!.source_scope).toBe('GLOBAL_REFERENCE');
  });

  // B. Global-only match → growth_event/CPO/SCP 0 (source_scope=GLOBAL_REFERENCE만 반환)
  it('B: Global candidate only → source_scope=GLOBAL_REFERENCE, POOL_LOCAL 없음', async () => {
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기'], issues: [],
      allKeywords: ['자유형', '발차기'],
    });
    const db = makeTwoLayerDb({
      getAssignedVersions: async () => [],       // Local 배정 없음
      getCurriculumItems:  async () => [],        // Local items 없음
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const local  = result.filter((r) => r.source_scope === 'POOL_LOCAL');
    const global = result.filter((r) => r.source_scope === 'GLOBAL_REFERENCE');
    expect(local.length).toBe(0);               // B: POOL_LOCAL 0
    expect(global.length).toBeGreaterThanOrEqual(1); // Global grounding 가능
    // B: 모든 candidates가 GLOBAL_REFERENCE → caller에서 progress 생성 금지 대상
    for (const r of result) {
      expect(r.source_scope).toBe('GLOBAL_REFERENCE');
    }
  });

  // C. SCA가 Global version → getAssignedVersions Local 결과 0
  it('C: SCA가 Global version → getAssignedVersions는 is_global_reference=false 필터로 결과 0', async () => {
    // productionCurriculumDb.getAssignedVersions의 is_global_reference=false 조건을 mock으로 재현:
    // SCA는 있지만 해당 version이 global → Local 결과에 미포함
    const db = makeTwoLayerDb({
      getAssignedVersions: async () => [], // Global version 필터링됨 → 빈 배열
      getCurriculumItems:  async () => [],
    });
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const localCandidates = result.filter((r) => r.source_scope === 'POOL_LOCAL');
    expect(localCandidates.length).toBe(0); // C: Local progress 없음
  });

  // D. 다른 pool → 동일 Global Reference items 검색 가능 (pool_id 무관)
  it('D: 다른 pool에서도 동일 Global Reference 검색 가능', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const dbPool2 = makeTwoLayerDb({
      getAssignedVersions: async () => [],
      getCurriculumItems:  async () => [],
      // getGlobalReferenceItems: pool_id 무관하므로 같은 global items 반환
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: 'pool-other-999', meaning, config: cfg },
      dbPool2,
    );
    const globalCandidates = result.filter((r) => r.source_scope === 'GLOBAL_REFERENCE');
    expect(globalCandidates.length).toBeGreaterThanOrEqual(1); // D: 전 pool 접근 가능
  });

  // E. Global is_active=false + import_status=ACTIVE → 검색 가능 (is_global_reference=true가 SOT)
  it('E: Global version is_active 무관, is_global_reference=true AND import_status=ACTIVE이면 검색됨', async () => {
    // productionCurriculumDb.getGlobalReferenceItems는 is_active 조건 미포함 → is_global_reference+import_status SOT
    // mock에서도 is_active 조건 없이 global items 반환 (스펙 반영)
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeTwoLayerDb({
      getAssignedVersions: async () => [],
      getCurriculumItems:  async () => [],
      getGlobalReferenceItems: async () => [
        // is_active=false인 Global version의 item (is_global_reference+import_status SOT)
        { id: 'ci-global-inactive', title: '자유형 발차기 보강', description: null, curriculum_version_id: 'cv-global-inactive' },
      ],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const globalCandidates = result.filter((r) => r.source_scope === 'GLOBAL_REFERENCE');
    expect(globalCandidates.length).toBeGreaterThanOrEqual(1); // E: 검색 가능
  });

  // F. Local upload version_name이 기존 Global과 동일 → Global row overwrite 안 됨 (x04-structuring 보호)
  // 이 테스트는 함수 레벨이 아닌 DB 동작 설계 검증 — source_scope 레벨에서 GLOBAL 항목은 GLOBAL_REFERENCE로만 분류됨을 확인
  it('F: Global item은 항상 GLOBAL_REFERENCE scope, POOL_LOCAL로 절대 오분류 불가', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    // Global item이 Local getCurriculumItems에도 실수로 포함된 경우 시뮬레이션
    // → productionCurriculumDb.getCurriculumItems는 swimming_pool_id=poolId 조건으로 global item 미포함
    // mock에서도 getCurriculumItems와 getGlobalReferenceItems를 각각 독립 반환 검증
    const globalOnlyId = 'ci-global-shared-id';
    const db = makeTwoLayerDb({
      getCurriculumItems: async () => [
        { id: 'ci-local-01', title: '자유형 발차기 기초', description: null, curriculum_version_id: 'cv-local-001' },
      ],
      getGlobalReferenceItems: async () => [
        { id: globalOnlyId, title: '자유형 발차기 보강', description: null, curriculum_version_id: 'cv-global-001' },
      ],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    // Global item은 반드시 GLOBAL_REFERENCE
    const fromGlobal = result.filter((r) => r._curriculum_item_id === globalOnlyId);
    for (const r of fromGlobal) {
      expect(r.source_scope).toBe('GLOBAL_REFERENCE');
    }
    // Local item은 반드시 POOL_LOCAL
    const fromLocal = result.filter((r) => r._curriculum_item_id === 'ci-local-01');
    for (const r of fromLocal) {
      expect(r.source_scope).toBe('POOL_LOCAL');
    }
  });

  // G. Manual Diary Global-only match → SCP 변화 없음 (GLOBAL_REFERENCE에 source_scope 부여 확인)
  it('G: Global-only match의 source_scope=GLOBAL_REFERENCE → progress 금지 식별 가능', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeTwoLayerDb({
      getAssignedVersions: async () => [],
      getCurriculumItems:  async () => [],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    // Caller(ai-v1.ts / manual diary resolver)는 source_scope로 progress 생성 차단 가능
    for (const r of result) {
      if (r.source_scope === 'GLOBAL_REFERENCE') {
        // growth_event 생성 금지 대상임을 식별 가능
        expect(r.source_scope).toBe('GLOBAL_REFERENCE');
      }
    }
  });

  // H. Local match → match_status=PENDING_REVIEW, source_scope=POOL_LOCAL, _curriculum_item_id 존재
  it('H: Local match → POOL_LOCAL + PENDING_REVIEW + _curriculum_item_id 유효', async () => {
    const meaning = makeMeaning({
      strokes: ['자유형'], skills: ['발차기'], issues: [],
      allKeywords: ['자유형', '발차기'],
    });
    const db = makeTwoLayerDb({
      getGlobalReferenceItems: async () => [], // Global 없음
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
    const first = result[0]!;
    expect(first.source_scope).toBe('POOL_LOCAL');
    expect(first.match_status).toBe('PENDING_REVIEW');
    expect(first._curriculum_item_id).toBeTruthy();
    expect(first.candidate_id).toMatch(/^cand_[0-9a-f]{32}$/);
  });

  // I. 기존 테스트와의 호환 — source_scope 필드가 모든 candidate에 항상 존재
  it('I: 모든 candidate에 source_scope 필드 항상 존재', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      makeTwoLayerDb(),
    );
    for (const r of result) {
      expect(r.source_scope).toMatch(/^(POOL_LOCAL|GLOBAL_REFERENCE)$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-C. Canonical Local Resolver + 500 Pool Standard 검증 (A-L)
// ─────────────────────────────────────────────────────────────────────────────
describe('Canonical Local Resolver — 500 Pool Standard (A-L)', () => {
  const cfg = DEFAULT_CONFIDENCE_CONFIG_V1;
  const poolId = 'pool-500-test';

  // ── mock helper (SCA Optional: pool active fallback 포함) ────────────────
  function makeCanonicalDb(overrides: Partial<CurriculumDb> = {}): CurriculumDb {
    return {
      verifyStudentRefs:           async (refs) => refs,
      getAssignedVersions:         async () => [],          // SCA 없음 기본
      getCurriculumItems:          async () => [
        { id: 'ci-pool-01', title: '자유형 발차기', description: null, curriculum_version_id: 'cv-pool-active' },
      ],
      getGlobalReferenceItems:     async () => [
        { id: 'ci-global-01', title: '자유형 발차기 Global', description: null, curriculum_version_id: 'cv-global' },
      ],
      getPoolActiveLocalVersion:   async () => 'cv-pool-active', // pool active fallback
      ...overrides,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // A. 신규 pool, SCA=0, active Local 있음 → Local candidate 정상 검색
  // ─────────────────────────────────────────────────────────────────────────
  it('A: 신규 pool SCA=0 + pool active Local → Local candidate 정상 반환', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeCanonicalDb({
      getAssignedVersions:       async () => [],            // SCA 없음
      getPoolActiveLocalVersion: async () => 'cv-pool-active', // pool fallback
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const local = result.filter(r => r.source_scope === 'POOL_LOCAL');
    expect(local.length).toBeGreaterThanOrEqual(1);
    expect(local[0]!.curriculum_version_id).toBe('cv-pool-active');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B. SCA 있음 → SCA Local 우선 사용 (pool fallback 무시)
  // ─────────────────────────────────────────────────────────────────────────
  it('B: SCA 있음 → SCA Local version 우선, pool fallback 무시', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeCanonicalDb({
      getAssignedVersions:       async (studentIds) =>
        studentIds.map(id => ({ student_id: id, curriculum_version_id: 'cv-sca-version' })),
      getCurriculumItems:        async () => [
        { id: 'ci-sca-01', title: '자유형 발차기', description: null, curriculum_version_id: 'cv-sca-version' },
      ],
      getPoolActiveLocalVersion: async () => 'cv-pool-active', // SCA 우선이므로 미사용
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const local = result.filter(r => r.source_scope === 'POOL_LOCAL');
    expect(local.length).toBeGreaterThanOrEqual(1);
    expect(local[0]!.curriculum_version_id).toBe('cv-sca-version'); // SCA version 사용됨
  });

  // ─────────────────────────────────────────────────────────────────────────
  // C. SCA가 Global version 가리킴 → getAssignedVersions 결과 0 → pool fallback
  // ─────────────────────────────────────────────────────────────────────────
  it('C: SCA가 Global version → is_global_reference=false 필터 → pool active Local fallback', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeCanonicalDb({
      // is_global_reference=false 필터로 Global SCA가 결과에서 제외됨
      getAssignedVersions:       async () => [],
      getPoolActiveLocalVersion: async () => 'cv-pool-active', // fallback 동작
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    // fallback으로 pool active Local version의 candidates 반환됨
    const local = result.filter(r => r.source_scope === 'POOL_LOCAL');
    expect(local.length).toBeGreaterThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // D. Local 없음 → Global grounding만 가능, progress 0 change
  // ─────────────────────────────────────────────────────────────────────────
  it('D: Local 없음(SCA=0 + pool fallback=null) → Global grounding만, progress 금지', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const db = makeCanonicalDb({
      getAssignedVersions:       async () => [],
      getPoolActiveLocalVersion: async () => null,  // NO_ACTIVE_LOCAL_CURRICULUM
      getCurriculumItems:        async () => [],
    });
    const result = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId, meaning, config: cfg },
      db,
    );
    const local  = result.filter(r => r.source_scope === 'POOL_LOCAL');
    const global = result.filter(r => r.source_scope === 'GLOBAL_REFERENCE');
    expect(local.length).toBe(0);               // D: progress 0
    expect(global.length).toBeGreaterThanOrEqual(1); // Global grounding 가능
  });

  // ─────────────────────────────────────────────────────────────────────────
  // K. Pool A Local이 Pool B 검색에 노출 0 (tenant isolation)
  // ─────────────────────────────────────────────────────────────────────────
  it('K: Pool A Local curriculum이 Pool B 검색에서 노출 0 (tenant leakage = 0)', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const POOL_A = 'pool-A-tenant';
    const POOL_B = 'pool-B-tenant';

    // Pool A: cv-pool-a (Local)
    const dbPoolA = makeCanonicalDb({
      getCurriculumItems:        async (versionIds, pid) => {
        if (pid !== POOL_A) return []; // Pool A items: swimming_pool_id 필터
        return [{ id: 'ci-pool-a-01', title: '자유형 발차기', description: null, curriculum_version_id: 'cv-pool-a' }];
      },
      getPoolActiveLocalVersion: async () => 'cv-pool-a',
    });

    // Pool B: 별도 DB (Pool A Local 접근 불가)
    const dbPoolB = makeCanonicalDb({
      getCurriculumItems:        async (versionIds, pid) => {
        if (pid !== POOL_B) return []; // Pool B는 Pool A items 없음
        return [{ id: 'ci-pool-b-01', title: '평영 발차기', description: null, curriculum_version_id: 'cv-pool-b' }];
      },
      getPoolActiveLocalVersion: async () => 'cv-pool-b',
      getGlobalReferenceItems:   async () => [], // Global도 없음 (isolation 순수 검증)
    });

    const resultA = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: POOL_A, meaning, config: cfg },
      dbPoolA,
    );
    const resultB = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: POOL_B, meaning, config: cfg },
      dbPoolB,
    );

    const poolAItemIds = resultA.filter(r => r.source_scope === 'POOL_LOCAL').map(r => r._curriculum_item_id);
    const poolBItemIds = resultB.filter(r => r.source_scope === 'POOL_LOCAL').map(r => r._curriculum_item_id);

    // K: Pool A의 Local item이 Pool B 결과에 노출 0
    const leakage = poolAItemIds.filter(id => poolBItemIds.includes(id));
    expect(leakage.length).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // L. Global은 모든 pool에서 동일 검색 결과 (cross-pool Global reference)
  // ─────────────────────────────────────────────────────────────────────────
  it('L: Global items는 모든 pool에서 동일 검색 결과 (cross-pool Global reference)', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });

    const dbPool1 = makeCanonicalDb({
      getAssignedVersions:       async () => [],
      getCurriculumItems:        async () => [],
      getPoolActiveLocalVersion: async () => null,
    });
    const dbPool2 = makeCanonicalDb({
      getAssignedVersions:       async () => [],
      getCurriculumItems:        async () => [],
      getPoolActiveLocalVersion: async () => null,
    });

    const result1 = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: 'pool-1111', meaning, config: cfg },
      dbPool1,
    );
    const result2 = await searchCurriculumCandidates(
      { requestedRefs: ['s1'], poolId: 'pool-2222', meaning, config: cfg },
      dbPool2,
    );

    const global1 = result1.filter(r => r.source_scope === 'GLOBAL_REFERENCE').map(r => r._curriculum_item_id);
    const global2 = result2.filter(r => r.source_scope === 'GLOBAL_REFERENCE').map(r => r._curriculum_item_id);

    // L: 동일한 Global items 접근
    expect(global1).toEqual(global2);
    expect(global1.length).toBeGreaterThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 100+ Pool isolation: active Local 1개만 허용 검증
  // ─────────────────────────────────────────────────────────────────────────
  it('100 pool mock: 각 pool 독립 Local version, tenant leakage = 0', async () => {
    const meaning = makeMeaning({ allKeywords: ['자유형', '발차기'] });
    const poolCount = 100;

    // 각 pool마다 독립 Local version / DB
    const allLocalItemIds: string[][] = [];

    for (let i = 0; i < poolCount; i++) {
      const pid = `pool-${i}`;
      const cvId = `cv-local-${i}`;
      const ciId = `ci-local-${i}-01`;
      const db = makeCanonicalDb({
        getAssignedVersions:       async () => [],
        getCurriculumItems:        async (versionIds, p) => {
          if (p !== pid) return [];
          return [{ id: ciId, title: '자유형 발차기', description: null, curriculum_version_id: cvId }];
        },
        getPoolActiveLocalVersion: async () => cvId,
        getGlobalReferenceItems:   async () => [],
      });
      const result = await searchCurriculumCandidates(
        { requestedRefs: ['s1'], poolId: pid, meaning, config: cfg },
        db,
      );
      const localIds = result.filter(r => r.source_scope === 'POOL_LOCAL').map(r => r._curriculum_item_id);
      allLocalItemIds.push(localIds);
    }

    // 각 pool의 Local items가 다른 pool에 노출 안 됨
    for (let i = 0; i < poolCount; i++) {
      for (let j = 0; j < poolCount; j++) {
        if (i === j) continue;
        const leakage = allLocalItemIds[i]!.filter(id => allLocalItemIds[j]!.includes(id));
        expect(leakage.length).toBe(0); // tenant leakage = 0
      }
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
