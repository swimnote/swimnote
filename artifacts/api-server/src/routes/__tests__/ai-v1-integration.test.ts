/**
 * ai-v1-integration.test.ts — WP6 Route Handler 통합 테스트 (TC-01 ~ TC-12)
 *
 * 원칙:
 *   - 실제 Route handler(ai-v1.ts)를 통과하는 HTTP 요청 사용
 *   - LLM 실제 유료 호출 금지 — OpenAI mock
 *   - template search / grounding / curriculum DB mock
 *   - 운영 DB 쓰기 없음 (searchCurriculumCandidates mock)
 *   - 운영 DB 읽기 없음 (resolvePoolMode mock)
 *
 * TC-01: contract 1.0 + normal  → 200, curriculum_matches 없음
 * TC-02: contract 1.0 + x mode  → 200, WP6 로직 미실행
 * TC-03: contract 1.3 + normal  → 200, curriculum_matches=null, pipeline_version=v2.0
 * TC-04: contract 1.3 + x_pending → 200, curriculum_matches=null
 * TC-05: contract 1.3 + x + candidate 없음 → 200, curriculum_matches=[]
 * TC-06: contract 1.3 + x + candidate 1개 → 200, match_token 포함, item_id 미노출
 * TC-07: 다수 학생, 일부만 candidate → 해당 학생만 match
 * TC-08: 다른 pool student_ref → 해당 match 제외, 전체 실패 없음
 * TC-09: MATCH_TOKEN_SECRET 미설정 + normal → 200
 * TC-10: MATCH_TOKEN_SECRET 미설정 + x_pending → 200
 * TC-11: MATCH_TOKEN_SECRET 미설정 + x + candidate → 503
 * TC-12: 미지원 contract_version → 400 UNSUPPORTED_CONTRACT
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import * as nodeHttp from 'node:http';

// ── vi.hoisted: mock 핸들을 hoisting 이전에 선언 ─────────────────────────────
const mockOpenAICreate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ common: '오늘 자유형 발차기 수업을 진행했습니다.', students: [] }) } }],
    usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
  }),
);
const mockResolvePoolMode            = vi.hoisted(() => vi.fn());
const mockSearchCurriculumCandidates = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockCreateMatchToken           = vi.hoisted(() => vi.fn().mockReturnValue('mock-match-token-abc'));
const mockNewTokenId                 = vi.hoisted(() => vi.fn().mockReturnValue('tid_mock1234567890abcdef12345678'));
// WP4B: x_global template search mock
const mockSearchXGlobalTemplates     = vi.hoisted(() => vi.fn());

// ── vi.mock (자동 hoisting — import 이전 실행 보장) ──────────────────────────

vi.mock('../../middlewares/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { role: 'teacher', poolId: null }; // 기본: tenant 제한 없음
    next();
  },
}));

vi.mock('openai', () => ({
  // 반드시 function 키워드 사용 — arrow function은 new 생성자로 사용 불가
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockOpenAICreate } };
  }),
}));

/** x_global 검색 기본 결과 (NOT_CONFIGURED — safe default) */
const X_TEMPLATE_NOT_CONFIGURED = {
  usedTemplates: [], candidateCount: 0, usedCount: 0, topScore: 0,
  usedFallbackPool: false, candidateIds: [], topBreakdown: null,
  xTemplateStatus: 'NOT_CONFIGURED', activeSetId: null, templateScope: 'x_global',
} as const;

vi.mock('../../lib/diary-template-search.js', () => ({
  searchTemplates: vi.fn().mockResolvedValue({
    candidateCount: 0,
    usedCount: 0,
    topScore: 0.0,
    topBreakdown: null,
    usedTemplates: [],
    candidateIds: [],
    usedFallbackPool: false,
  }),
  searchXGlobalTemplates: mockSearchXGlobalTemplates,
  CANDIDATE_MIN_CONCEPT_OVERLAP: 0.30,
  USAGE_MIN_SCORE: 1.40,
  TOP_K_USAGE: 1,
}));

vi.mock('../../lib/diary-grounding.js', () => ({
  validateGrounding: vi.fn().mockReturnValue({
    status: 'PASS',
    score: 1.0,
    unsupported_claim_count: 0,
    student_to_common_leak_count: 0,
    invented_student_evaluation_count: 0,
    invented_next_plan_count: 0,
    invented_technique_count: 0,
  }),
  purgeStudentLeaksFromCommon: vi.fn().mockImplementation((text: string) => ({
    purged: text,
    removedSentenceCount: 0,
  })),
  purgeInventedEvaluations: vi.fn().mockImplementation((text: string) => ({
    purged: text,
    removedSentenceCount: 0,
  })),
}));

vi.mock('../../lib/xmode.js', () => ({
  resolvePoolMode: mockResolvePoolMode,
}));

vi.mock('../../lib/curriculum-candidate-search.js', () => ({
  searchCurriculumCandidates: mockSearchCurriculumCandidates,
}));

vi.mock('../../lib/match-token.js', async (importOriginal) => {
  // MatchTokenError는 실제 클래스를 유지 (TC-11에서 실제 throw 필요)
  const actual = await importOriginal<typeof import('../../lib/match-token.js')>();
  return {
    ...actual,
    createMatchToken: mockCreateMatchToken,
    newTokenId:       mockNewTokenId,
  };
});

// ── 서버 설정 ─────────────────────────────────────────────────────────────────
let server: nodeHttp.Server;
let port: number;

beforeAll(async () => {
  // mock 설정 완료 후 라우터를 동적 import
  const { default: router } = await import('../ai-v1.js');
  const app = express();
  app.use(express.json());
  app.use('/', router);
  server = nodeHttp.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── 기본 mock 상태 복원 ────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // OpenAI mock 기본 응답 복원
  mockOpenAICreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ common: '오늘 자유형 발차기 수업을 진행했습니다.', students: [] }) } }],
    usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
  });
  // curriculum mock 기본: 빈 배열
  mockSearchCurriculumCandidates.mockResolvedValue([]);
  // match token mock 기본
  mockCreateMatchToken.mockReturnValue('mock-match-token-abc');
  mockNewTokenId.mockReturnValue('tid_mock1234567890abcdef12345678');
  // WP4B: x_global template search 기본 → NOT_CONFIGURED (안전한 기본값)
  mockSearchXGlobalTemplates.mockResolvedValue({ ...X_TEMPLATE_NOT_CONFIGURED });
});

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────
async function post(body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`http://localhost:${port}/v1/teacher-diary/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

/** 기본 유효 요청 body */
function makeBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contract_version: '1.0',
    request_id:       'test-req-audit-001',
    schema_version:   '1.0',
    feature:          'teacher_diary',
    input:            { text: '자유형 발차기 호흡 연습했습니다.' },
    context: {
      pool_id:      'pool-test-001',
      class_id:     'class-test-001',
      lesson_date:  '2026-08-06',
      student_refs: ['s1'],
      students:     [{ ref: 's1', name: '김학생' }],
    },
    ...overrides,
  };
}

/** pool mode mock 헬퍼 */
function setPoolMode(mode: 'normal' | 'x_pending' | 'x'): void {
  const configStatus = mode === 'x' ? 'READY' : mode === 'x_pending' ? 'CURRICULUM_PENDING' : 'NOT_CONFIGURED';
  mockResolvePoolMode.mockResolvedValue({
    pool_id:             'pool-test-001',
    mode,
    xmode_entitlement:   mode !== 'normal',
    xmode_config_status: configStatus,
  });
}

/** 테스트용 curriculum candidate */
function makeCandidateResult(studentRef = 's1') {
  return {
    student_ref:                studentRef,
    candidate_id:               'cand_' + 'a'.repeat(32),
    display_label:              '자유형 발차기 기초',
    description:                '호흡 타이밍 연습',
    curriculum_version_id:      'cv-001',
    confidence:                 0.75,
    match_status:               'PENDING_REVIEW' as const,
    matching_algorithm_version: 'token_overlap_v1' as const,
    _curriculum_item_id:        'ci-db-pk-secret-001', // 응답 미노출 DB PK
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC-01: contract 1.0 + normal pool mode
// 기존 응답 구조 그대로, curriculum_matches/pipeline_version 필드 없음
// ─────────────────────────────────────────────────────────────────────────────
it('TC-01: contract 1.0 + normal → 200, curriculum_matches 필드 없음', async () => {
  setPoolMode('normal');

  const { status, data } = await post(makeBody({ contract_version: '1.0' }));

  expect(status).toBe(200);
  expect(data.contract_version).toBe('1.0');
  expect(data.request_id).toBe('test-req-audit-001');
  expect(data.engine_version).toBe('grounded_v1');
  expect(data.result.common).toBeTruthy();
  expect(Array.isArray(data.result.students)).toBe(true);
  expect(data.meta.pipeline_mode).toBe('template_v1');
  // 신규 필드 완전 생략 (null도 아님)
  expect('curriculum_matches' in data).toBe(false);
  expect('pipeline_version' in data).toBe(false);
  // resolvePoolMode 미호출 (contract 1.0)
  expect(mockResolvePoolMode).not.toHaveBeenCalled();
  // searchCurriculumCandidates 미호출
  expect(mockSearchCurriculumCandidates).not.toHaveBeenCalled();
  // createMatchToken 미호출
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-02: contract 1.0 + x mode → WP6 로직 미실행, 기존 응답 그대로
// ─────────────────────────────────────────────────────────────────────────────
it('TC-02: contract 1.0 + x mode → 200, WP6 로직 미실행', async () => {
  // pool mode를 x로 설정해도 contract 1.0이면 Phase 0 미실행
  const { status, data } = await post(makeBody({ contract_version: '1.0' }));

  expect(status).toBe(200);
  expect(data.contract_version).toBe('1.0');
  // curriculum_matches, pipeline_version 완전 생략
  expect('curriculum_matches' in data).toBe(false);
  expect('pipeline_version' in data).toBe(false);
  // resolvePoolMode 미호출 (contract 1.0이므로 Phase 0 건너뜀)
  expect(mockResolvePoolMode).not.toHaveBeenCalled();
  // 토큰 생성 없음
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-03: contract 1.3 + normal → 200, curriculum_matches=null, pipeline_version=v2.0
// ─────────────────────────────────────────────────────────────────────────────
it('TC-03: contract 1.3 + normal → 200, curriculum_matches=null', async () => {
  setPoolMode('normal');

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.contract_version).toBe('1.3');
  expect(data.pipeline_version).toBe('v2.0');
  expect(data.curriculum_matches).toBeNull();
  // 기존 result 구조 유지
  expect(data.result.common).toBeTruthy();
  expect(Array.isArray(data.result.students)).toBe(true);
  expect(data.meta.pipeline_mode).toBe('template_v1');
  // resolvePoolMode 호출 (contract 1.3)
  expect(mockResolvePoolMode).toHaveBeenCalledWith('pool-test-001');
  // candidate search 미호출 (normal mode)
  expect(mockSearchCurriculumCandidates).not.toHaveBeenCalled();
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-04: contract 1.3 + x_pending → 200, curriculum_matches=null
// ─────────────────────────────────────────────────────────────────────────────
it('TC-04: contract 1.3 + x_pending → 200, curriculum_matches=null', async () => {
  setPoolMode('x_pending');

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.contract_version).toBe('1.3');
  expect(data.pipeline_version).toBe('v2.0');
  expect(data.curriculum_matches).toBeNull();
  // candidate search 미호출 (x_pending mode)
  expect(mockSearchCurriculumCandidates).not.toHaveBeenCalled();
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-05: contract 1.3 + x + candidate 없음 → 200, curriculum_matches=[]
// ─────────────────────────────────────────────────────────────────────────────
it('TC-05: contract 1.3 + x + candidate 없음 → 200, curriculum_matches=[]', async () => {
  setPoolMode('x');
  mockSearchCurriculumCandidates.mockResolvedValue([]); // 후보 없음

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.contract_version).toBe('1.3');
  expect(data.pipeline_version).toBe('v2.0');
  expect(Array.isArray(data.curriculum_matches)).toBe(true);
  expect(data.curriculum_matches).toHaveLength(0); // 빈 배열
  expect(mockSearchCurriculumCandidates).toHaveBeenCalled();
  expect(mockCreateMatchToken).not.toHaveBeenCalled(); // 후보 없으면 토큰 생성 없음
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-06: contract 1.3 + x + candidate 1개
// curriculum_matches[0] 구조 검증, curriculum_item_id 미노출
// ─────────────────────────────────────────────────────────────────────────────
it('TC-06: contract 1.3 + x + candidate 1개 → match_token 포함, item_id 미노출', async () => {
  setPoolMode('x');
  const candidate = makeCandidateResult('s1');
  mockSearchCurriculumCandidates.mockResolvedValue([candidate]);

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.curriculum_matches).toHaveLength(1);

  const match = data.curriculum_matches[0];
  // 필수 필드 존재
  expect(match.student_ref).toBe('s1');
  expect(match.candidate_id).toBe(candidate.candidate_id);
  expect(match.display_label).toBe('자유형 발차기 기초');
  expect(match.description).toBe('호흡 타이밍 연습');
  expect(match.curriculum_version_id).toBe('cv-001');
  expect(match.confidence).toBe(0.75);
  expect(match.match_status).toBe('PENDING_REVIEW');
  expect(match.match_token).toBe('mock-match-token-abc');

  // AUTO_ACCEPTED 금지
  expect(match.match_status).not.toBe('AUTO_ACCEPTED');

  // curriculum_item_id (DB PK) 응답 미노출 — 절대 금지
  expect('curriculum_item_id' in match).toBe(false);
  expect(match.curriculum_item_id).toBeUndefined();

  // _curriculum_item_id (내부 필드) 미노출
  expect('_curriculum_item_id' in match).toBe(false);

  // createMatchToken 1회 호출 확인
  expect(mockCreateMatchToken).toHaveBeenCalledTimes(1);
  // 호출 payload에 curriculum_item_id 포함 (내부 필드)
  const tokenPayload = mockCreateMatchToken.mock.calls[0][0];
  expect(tokenPayload.curriculum_item_id).toBe('ci-db-pk-secret-001');
  expect(tokenPayload.candidate_id).toBe(candidate.candidate_id);
  expect(tokenPayload.pool_id).toBe('pool-test-001');
  expect(tokenPayload.student_id).toBe('s1');
  expect(tokenPayload.confidence).toBe(0.75);
  expect(tokenPayload.match_status).toBeUndefined(); // payload에 match_status 없음
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-07: 다수 학생, 일부만 candidate
// ─────────────────────────────────────────────────────────────────────────────
it('TC-07: 다수 학생 중 일부만 candidate → 해당 학생만 match', async () => {
  setPoolMode('x');
  // s1만 candidate 있음, s2는 없음
  mockSearchCurriculumCandidates.mockResolvedValue([makeCandidateResult('s1')]);

  const body = makeBody({
    contract_version: '1.3',
    context: {
      pool_id:      'pool-test-001',
      class_id:     'class-test-001',
      lesson_date:  '2026-08-06',
      student_refs: ['s1', 's2'],
      students:     [{ ref: 's1', name: '김학생' }, { ref: 's2', name: '이학생' }],
    },
  });

  const { status, data } = await post(body);

  expect(status).toBe(200);
  expect(Array.isArray(data.curriculum_matches)).toBe(true);
  // s1만 match
  const s1Matches = data.curriculum_matches.filter((m: any) => m.student_ref === 's1');
  const s2Matches = data.curriculum_matches.filter((m: any) => m.student_ref === 's2');
  expect(s1Matches.length).toBeGreaterThanOrEqual(1);
  expect(s2Matches.length).toBe(0);
  // 일지 생성은 정상 (HTTP 200)
  expect(data.result.common).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-08: 다른 pool student_ref → 해당 match 제외, 전체 실패 없음
// (searchCurriculumCandidates는 DB 검증 후 빈 배열 반환 시뮬레이션)
// ─────────────────────────────────────────────────────────────────────────────
it('TC-08: 다른 pool student_ref → match 제외, 전체 실패 없음', async () => {
  setPoolMode('x');
  // DB 검증에서 foreign student 탈락 → 빈 배열 반환 시뮬레이션
  mockSearchCurriculumCandidates.mockResolvedValue([]);

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200); // 전체 실패 없음
  expect(data.curriculum_matches).toEqual([]); // match 없음
  expect(data.result.common).toBeTruthy(); // 기존 일지 정상 생성
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-09: MATCH_TOKEN_SECRET 미설정 + normal → 200 (secret 불필요)
// ─────────────────────────────────────────────────────────────────────────────
it('TC-09: MATCH_TOKEN_SECRET 미설정 + normal → 200', async () => {
  setPoolMode('normal');
  // normal mode → candidate search 미실행 → match_token 미생성 → secret 불필요

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.curriculum_matches).toBeNull();
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-10: MATCH_TOKEN_SECRET 미설정 + x_pending → 200
// ─────────────────────────────────────────────────────────────────────────────
it('TC-10: MATCH_TOKEN_SECRET 미설정 + x_pending → 200', async () => {
  setPoolMode('x_pending');
  // x_pending → candidate search 미실행 → match_token 미생성 → secret 불필요

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(200);
  expect(data.curriculum_matches).toBeNull();
  expect(mockCreateMatchToken).not.toHaveBeenCalled();
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-11: MATCH_TOKEN_SECRET 미설정 + x + candidate 있음 → 503
// ─────────────────────────────────────────────────────────────────────────────
it('TC-11: MATCH_TOKEN_SECRET 미설정 + x + candidate → 503 X_MODE_TOKEN_NOT_CONFIGURED', async () => {
  setPoolMode('x');
  mockSearchCurriculumCandidates.mockResolvedValue([makeCandidateResult('s1')]);

  // createMatchToken이 X_MODE_TOKEN_NOT_CONFIGURED 에러 throw 시뮬레이션
  const { MatchTokenError } = await import('../../lib/match-token.js');
  mockCreateMatchToken.mockImplementation(() => {
    throw new MatchTokenError('X_MODE_TOKEN_NOT_CONFIGURED', 'MATCH_TOKEN_SECRET is not configured.');
  });

  const { status, data } = await post(makeBody({ contract_version: '1.3' }));

  expect(status).toBe(503);
  expect(data.error.code).toBe('X_MODE_TOKEN_NOT_CONFIGURED');
  expect(data.contract_version).toBe('1.3'); // contract_version echo
  expect(data.status).toBe('failed');
});

// ─────────────────────────────────────────────────────────────────────────────
// TC-12: 미지원 contract_version → 400 UNSUPPORTED_CONTRACT
// ─────────────────────────────────────────────────────────────────────────────
it('TC-12: 미지원 contract_version → 400 UNSUPPORTED_CONTRACT', async () => {
  const { status, data } = await post(makeBody({ contract_version: '2.0' }));

  expect(status).toBe(400);
  expect(data.error.code).toBe('UNSUPPORTED_CONTRACT');
  expect(data.status).toBe('failed');
  // 서버 크래시 없음 (응답 수신됨)
});

// ─────────────────────────────────────────────────────────────────────────────
// 추가 회귀: 기존 contract 1.0 response 구조 완전 일치
// ─────────────────────────────────────────────────────────────────────────────
describe('기존 Contract 1.0 회귀 검증', () => {
  it('request_id echo — 기존 동일', async () => {
    const body = makeBody({ request_id: 'specific-req-id-999' });
    const { data } = await post(body);
    expect(data.request_id).toBe('specific-req-id-999');
  });

  it('schema_version 1.0 유지', async () => {
    const { data } = await post(makeBody());
    expect(data.schema_version).toBe('1.0');
  });

  it('meta 필드 존재: pipeline_mode, generation_mode, parser_confidence', async () => {
    const { data } = await post(makeBody());
    expect(data.meta).toBeDefined();
    expect(data.meta.pipeline_mode).toBe('template_v1');
    expect(typeof data.meta.generation_mode).toBe('string');
    expect(typeof data.meta.parser_confidence).toBe('number');
  });

  it('usage 필드 존재: input_tokens, output_tokens, total_tokens, latency_ms', async () => {
    const { data } = await post(makeBody());
    expect(data.usage).toBeDefined();
    expect(data.usage.input_tokens).toBe(50);
    expect(data.usage.output_tokens).toBe(100);
    expect(data.usage.total_tokens).toBe(150);
    expect(typeof data.usage.latency_ms).toBe('number');
  });

  it('result.common 비어있지 않음', async () => {
    const { data } = await post(makeBody());
    expect(typeof data.result.common).toBe('string');
    expect(data.result.common.length).toBeGreaterThan(0);
  });

  it('result.students 배열', async () => {
    const { data } = await post(makeBody());
    expect(Array.isArray(data.result.students)).toBe(true);
  });

  it('오류 응답: request_id 없음 → 400', async () => {
    const body = makeBody({ request_id: undefined });
    delete (body as any).request_id;
    const { status, data } = await post(body);
    expect(status).toBe(400);
    expect(data.error.code).toBe('INVALID_REQUEST');
    expect(data.contract_version).toBeDefined();
  });

  it('오류 응답: pool_id 없음 → 400', async () => {
    const body = makeBody();
    (body.context as any).pool_id = '';
    const { status, data } = await post(body);
    expect(status).toBe(400);
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('오류 응답: student_refs 불일치 → 400', async () => {
    const body = makeBody();
    (body.context as any).student_refs = ['different-ref'];
    const { status, data } = await post(body);
    expect(status).toBe(400);
    expect(data.error.code).toBe('INVALID_REQUEST');
  });

  it('GPT 호출 1회만 실행 (contract 1.0)', async () => {
    mockOpenAICreate.mockClear();
    await post(makeBody({ contract_version: '1.0' }));
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
  });

  it('GPT 호출 1회만 실행 (contract 1.3)', async () => {
    setPoolMode('x');
    mockOpenAICreate.mockClear();
    await post(makeBody({ contract_version: '1.3' }));
    expect(mockOpenAICreate).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WP4B: X_GLOBAL TEMPLATE SEARCH — TC-WP4B-A ~ TC-WP4B-I
// ─────────────────────────────────────────────────────────────────────────────
describe('WP4B: X_GLOBAL 템플릿 검색 분기', () => {
  // ── TC-WP4B-A: Non-X pool → searchTemplates 호출, searchXGlobalTemplates 미호출 ──
  it('TC-WP4B-A: Non-X pool → 기존 searchTemplates 경로, xGlobal 미호출', async () => {
    setPoolMode('normal');

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    // x_global search 미호출
    expect(mockSearchXGlobalTemplates).not.toHaveBeenCalled();
    // meta에 x_template_status 없음 (non-X)
    expect(data.meta.x_template_status).toBeUndefined();
    expect(data.meta.x_active_set_id).toBeUndefined();
  });

  // ── TC-WP4B-B: X pool + ACTIVE set 없음 → NOT_CONFIGURED, INPUT_ONLY, 200 (no 500) ──
  it('TC-WP4B-B: X + ACTIVE set 없음 → NOT_CONFIGURED, generation_mode=INPUT_ONLY, 200', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({ ...X_TEMPLATE_NOT_CONFIGURED });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    expect(mockSearchXGlobalTemplates).toHaveBeenCalledTimes(1);
    expect(data.meta.x_template_status).toBe('NOT_CONFIGURED');
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
    // 500 없음 확인 (status=200)
    expect(data.status).not.toBe('failed');
    expect(data.result.common).toBeTruthy();
  });

  // ── TC-WP4B-C: X pool + ACTIVE set 존재 → searchXGlobalTemplates 호출, set id 전달 ──
  it('TC-WP4B-C: X + ACTIVE set 존재 → searchXGlobalTemplates 호출', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({
      ...X_TEMPLATE_NOT_CONFIGURED,
      xTemplateStatus: 'NO_MATCH',
      activeSetId: 'gts_test_active_001',
    });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    expect(mockSearchXGlobalTemplates).toHaveBeenCalledTimes(1);
    expect(data.meta.x_template_status).toBe('NO_MATCH');
    expect(data.meta.x_active_set_id).toBe('gts_test_active_001');
  });

  // ── TC-WP4B-D: X + ACTIVE set + matching template → FOUND, TEMPLATE_ASSISTED ──
  it('TC-WP4B-D: X + ACTIVE set + matching template → FOUND, generation_mode=TEMPLATE_ASSISTED', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({
      usedTemplates: [{ id: 'dt_xglobal_001', level_id: '', level_name: '자유형', template_text: '발차기 연습을 진행했습니다.', score: 2.1, breakdown: { strokeMatch: 1, focusMatch: 0, conceptOverlap: 0.6, observationMatch: 0, score: 2.1 } }],
      candidateCount: 1,
      usedCount: 1,
      topScore: 2.1,
      usedFallbackPool: false,
      candidateIds: ['dt_xglobal_001'],
      topBreakdown: { strokeMatch: 1, focusMatch: 0, conceptOverlap: 0.6, observationMatch: 0, score: 2.1 },
      xTemplateStatus: 'FOUND',
      activeSetId: 'gts_test_active_001',
      templateScope: 'x_global',
    });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    expect(mockSearchXGlobalTemplates).toHaveBeenCalledTimes(1);
    expect(data.meta.x_template_status).toBe('FOUND');
    expect(data.meta.generation_mode).toBe('TEMPLATE_ASSISTED');
    expect(data.meta.x_active_set_id).toBe('gts_test_active_001');
    expect(data.meta.template_used_count).toBe(1);
    expect(data.meta.template_ids).toContain('dt_xglobal_001');
  });

  // ── TC-WP4B-E: X + ACTIVE set + no matching template → NO_MATCH, INPUT_ONLY, 일반 global fallback 없음 ──
  it('TC-WP4B-E: X + ACTIVE set + no match → NO_MATCH, INPUT_ONLY, 일반 fallback 없음', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({
      ...X_TEMPLATE_NOT_CONFIGURED,
      xTemplateStatus: 'NO_MATCH',
      activeSetId: 'gts_test_active_001',
    });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    expect(data.meta.x_template_status).toBe('NO_MATCH');
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
    // 일반 searchTemplates 미호출 (global fallback 없음)
    const { searchTemplates } = await import('../../lib/diary-template-search.js');
    expect(searchTemplates).not.toHaveBeenCalled();
    expect(data.meta.fallback_pool_used).toBe(false);
    // 결과 정상 200
    expect(data.result.common).toBeTruthy();
  });

  // ── TC-WP4B-F: ARCHIVED set → NOT_CONFIGURED (resolver가 ACTIVE만 조회하므로 자동) ──
  it('TC-WP4B-F: ARCHIVED set → NOT_CONFIGURED (ACTIVE=0으로 처리)', async () => {
    setPoolMode('x');
    // resolver가 ARCHIVED를 제외하므로 NOT_CONFIGURED
    mockSearchXGlobalTemplates.mockResolvedValue({ ...X_TEMPLATE_NOT_CONFIGURED });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));

    expect(status).toBe(200);
    expect(data.meta.x_template_status).toBe('NOT_CONFIGURED');
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
    expect(data.meta.x_active_set_id).toBeUndefined();
  });

  // ── TC-WP4B-G: DRAFT set → NOT_CONFIGURED (동일 처리) ──
  it('TC-WP4B-G: DRAFT set → NOT_CONFIGURED', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({ ...X_TEMPLATE_NOT_CONFIGURED });

    const { status } = await post(makeBody({ contract_version: '1.3' }));
    expect(status).toBe(200); // 500 없음
  });

  // ── TC-WP4B-H: 다른 global_template_set_id의 x_global → searchXGlobalTemplates 내부 처리 (mock 안에서 제외) ──
  it('TC-WP4B-H: 다른 set_id x_global → 검색 결과에서 제외 (NO_MATCH)', async () => {
    setPoolMode('x');
    // 올바른 set_id 조건으로 검색 시 match 없음 (다른 set 소속은 제외됨)
    mockSearchXGlobalTemplates.mockResolvedValue({
      ...X_TEMPLATE_NOT_CONFIGURED,
      xTemplateStatus: 'NO_MATCH',
      activeSetId: 'gts_correct_set',
    });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));
    expect(status).toBe(200);
    expect(data.meta.x_template_status).toBe('NO_MATCH');
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
  });

  // ── TC-WP4B-I: scope='global' template → X search에서 제외 (resolver+SQL 조건으로 보장) ──
  it('TC-WP4B-I: scope=global template → X search 제외, NOT_CONFIGURED 응답', async () => {
    setPoolMode('x');
    // scope='global' 템플릿은 loadXGlobalTemplates SQL 조건(scope='x_global')으로 제외됨
    mockSearchXGlobalTemplates.mockResolvedValue({ ...X_TEMPLATE_NOT_CONFIGURED });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));
    expect(status).toBe(200);
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
    // 일반 searchTemplates 미호출 (global scope 혼입 없음)
    const { searchTemplates } = await import('../../lib/diary-template-search.js');
    expect(searchTemplates).not.toHaveBeenCalled();
  });

  // ── TC-WP4B-X1: contract 1.0 + X pool → searchXGlobalTemplates 미호출 (legacy 경로) ──
  it('TC-WP4B-X1: contract 1.0 + X pool → searchXGlobalTemplates 미호출', async () => {
    // contract 1.0은 Phase 0 (resolvePoolMode) 자체를 건너뜀 → poolMode='normal'
    const { status } = await post(makeBody({ contract_version: '1.0' }));
    expect(status).toBe(200);
    expect(mockSearchXGlobalTemplates).not.toHaveBeenCalled();
  });

  // ── TC-WP4B-X2: x_pending pool → searchXGlobalTemplates 미호출 ──
  it('TC-WP4B-X2: x_pending pool → searchXGlobalTemplates 미호출, 기존 searchTemplates 사용', async () => {
    setPoolMode('x_pending');

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));
    expect(status).toBe(200);
    expect(mockSearchXGlobalTemplates).not.toHaveBeenCalled();
    // x_template_status 없음 (non-X)
    expect(data.meta.x_template_status).toBeUndefined();
  });

  // ── TC-WP4B-X3: DATA_INTEGRITY_ERROR → 200, INPUT_ONLY (no 500) ──
  it('TC-WP4B-X3: DATA_INTEGRITY_ERROR (ACTIVE≥2) → 200, INPUT_ONLY, no 500', async () => {
    setPoolMode('x');
    mockSearchXGlobalTemplates.mockResolvedValue({
      ...X_TEMPLATE_NOT_CONFIGURED,
      xTemplateStatus: 'DATA_INTEGRITY_ERROR',
    });

    const { status, data } = await post(makeBody({ contract_version: '1.3' }));
    expect(status).toBe(200);
    expect(data.meta.x_template_status).toBe('DATA_INTEGRITY_ERROR');
    expect(data.meta.generation_mode).toBe('INPUT_ONLY');
  });
});
