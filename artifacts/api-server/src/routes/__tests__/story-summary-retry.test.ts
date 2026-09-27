/**
 * story-summary-retry.test.ts
 *
 * POST /diaries/:diaryId/story-summary — server-side transient retry 검증
 *
 * 검증 목표:
 *   - 단일 HTTP request 내에서 OpenAI 1차 실패 → 2차 성공 시 HTTP 200 반환
 *   - 1차/2차 모두 실패 시 HTTP 500 (무한 retry 없음)
 *   - retry 조건: 429/5xx/network 허용, AbortError/400/401/403 금지
 *   - retry 시 동일 prompt payload 재사용
 *   - 1차 성공 시 1초 delay 없음
 *
 * 주의: DB/auth 의존성을 모두 mock 처리. OpenAI 클라이언트만 교체.
 *       retry delay는 _setRetryDelayMsForTest(0)으로 0ms 설정 (테스트 속도).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';

// ── 의존성 mock ───────────────────────────────────────────────────────────────

vi.mock('@workspace/db', () => {
  const mockExecute = vi.fn().mockResolvedValue({
    rows: [{
      id: 'diary_test_id',
      common_content: '오늘 배영 30바퀴를 진행했습니다.',
      class_group_id: 'cg_test',
      swimming_pool_id: 'pool_test',
      lesson_date: '2026-09-27',
    }],
  });
  const sqlTag = Object.assign(
    (_s: TemplateStringsArray, ..._v: unknown[]) => ({ sql: 'mocked', values: _v }),
    { join: (_parts: unknown[], _sep: unknown) => ({ sql: 'mocked_join' }) },
  );
  return {
    db:           { execute: mockExecute },
    superAdminDb: { execute: mockExecute },
    sql:          sqlTag,
  };
});

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (_s: TemplateStringsArray, ..._v: unknown[]) => ({ sql: 'mocked', values: _v }),
    { join: (_parts: unknown[], _sep: unknown) => ({ sql: 'mocked_join' }) },
  ),
}));

vi.mock('../../lib/ai-trace-service.js', () => ({
  saveAiTrace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../middlewares/auth.js', () => ({
  requireAuth: (req: Request & { user?: unknown }, _res: Response, next: NextFunction) => {
    (req as any).user = { userId: 'parent_test_id', role: 'super_admin' };
    next();
  },
}));

vi.mock('../../lib/ai-feature-enum.js', () => ({
  AI_FEATURE: { STORY_SUMMARY: 'story_summary' },
}));

vi.mock('../../config/ai-model-config.js', () => ({
  AI_MODEL: { STORY: 'gpt-4o-mini' },
}));

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────
function makeSuccess(content: string) {
  return {
    choices: [{ message: { content } }],
    usage:   { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
  };
}

function makeOpenAIError(status: number, code = 'err'): Error {
  const e: any = new Error(`OpenAI ${status}`);
  e.status = status;
  e.code   = code;
  e.type   = `error_${status}`;
  return e;
}

// ── App + 주입 함수 ───────────────────────────────────────────────────────────
let app: express.Application;
let setClient: (c: any) => void;
let setDelay:  (ms: number) => void;

beforeAll(async () => {
  const mod = await import('../../routes/story.js');
  setClient = mod._setOpenAIClientForTest;
  setDelay  = mod._setRetryDelayMsForTest;
  // 테스트에서는 retry 전 대기 없음
  setDelay(0);

  app = express();
  app.use(express.json());
  app.use('/api', mod.default);
});

afterAll(() => {
  // 정리: 싱글톤 초기화
  setClient(null);
  setDelay(1_000);
});

// ── isRetryableOpenAIError 단위 테스트 ───────────────────────────────────────
describe('isRetryableOpenAIError', () => {
  let isRetryable: (e: any) => boolean;

  beforeAll(async () => {
    const mod = await import('../../routes/story.js');
    isRetryable = mod.isRetryableOpenAIError;
  });

  it('AbortError → false', () => {
    const e: any = new Error('aborted'); e.name = 'AbortError';
    expect(isRetryable(e)).toBe(false);
  });
  it('empty_response → false', () => {
    expect(isRetryable(new Error('empty_response'))).toBe(false);
  });
  it('400 → false', () => expect(isRetryable(makeOpenAIError(400))).toBe(false));
  it('401 → false', () => expect(isRetryable(makeOpenAIError(401))).toBe(false));
  it('403 → false', () => expect(isRetryable(makeOpenAIError(403))).toBe(false));
  it('429 → true',  () => expect(isRetryable(makeOpenAIError(429))).toBe(true));
  it('500 → true',  () => expect(isRetryable(makeOpenAIError(500))).toBe(true));
  it('503 → true',  () => expect(isRetryable(makeOpenAIError(503))).toBe(true));
  it('network (status 없음) → true', () => {
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
  });
});

// ── 통합 테스트 ───────────────────────────────────────────────────────────────
describe('POST /api/diaries/:diaryId/story-summary', () => {
  const ENDPOINT = '/api/diaries/diary_test_id/story-summary';
  const BODY     = { max_lines: 4, max_chars: 90 };

  // ── Case A: 정상 — attempt=1 성공 ─────────────────────────────────────────
  it('Case A: 1차 성공 → HTTP 200, OpenAI 1회 호출', async () => {
    const mockCreate = vi.fn().mockResolvedValueOnce(
      makeSuccess('오늘 배영 수업 잘 마쳤습니다.'),
    );
    setClient({ chat: { completions: { create: mockCreate } } });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    expect(res.status).toBe(200);
    expect(typeof res.body.summary).toBe('string');
    expect(res.body.summary.length).toBeGreaterThan(0);
    expect(res.body.summary.length).toBeLessThanOrEqual(90);
    // OpenAI 정확히 1회
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ── Case B: Retry — 동일 request 내 attempt=1 실패(429) → attempt=2 성공 ──
  it('Case B (핵심): 단일 request 내 429 → retry → HTTP 200, OpenAI 2회', async () => {
    const RETRY_SUMMARY = '오늘 배영 롤링 연습에서 좋은 모습을 보였습니다.';
    const mockCreate = vi.fn()
      .mockRejectedValueOnce(makeOpenAIError(429, 'rate_limit_exceeded'))  // attempt 1 실패
      .mockResolvedValueOnce(makeSuccess(RETRY_SUMMARY));                  // attempt 2 성공

    setClient({ chat: { completions: { create: mockCreate } } });

    // 단일 HTTP 요청
    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    // 핵심: 한 번의 요청으로 200 반환
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe(RETRY_SUMMARY);
    expect(res.body.summary.length).toBeLessThanOrEqual(90);

    // 서버 내부에서 2회 호출 (attempt 1 + attempt 2)
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // 두 호출에 동일 prompt payload (messages[0].content 일치)
    const call1 = mockCreate.mock.calls[0][0];
    const call2 = mockCreate.mock.calls[1][0];
    expect(call1.messages[0].content).toBe(call2.messages[0].content);
    expect(call1.model).toBe(call2.model);
  });

  // ── Case C: Double Failure — 두 번 모두 실패 → HTTP 500, 3차 없음 ──────────
  it('Case C: 1차/2차 실패 → HTTP 500, OpenAI 2회만 호출 (무한 retry 없음)', async () => {
    const mockCreate = vi.fn()
      .mockRejectedValueOnce(makeOpenAIError(503, 'server_error'))
      .mockRejectedValueOnce(makeOpenAIError(503, 'server_error'));

    setClient({ chat: { completions: { create: mockCreate } } });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('summary_failed');
    // 정확히 2회 (3차 retry 없음)
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  // ── Case D: Non-retryable 400 → 1회만 호출 ────────────────────────────────
  it('Case D: 400 invalid → retry 없이 즉시 HTTP 500, OpenAI 1회', async () => {
    const mockCreate = vi.fn()
      .mockRejectedValueOnce(makeOpenAIError(400, 'invalid_request_error'));

    setClient({ chat: { completions: { create: mockCreate } } });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('summary_failed');
    // retry 없이 1회만
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ── Case E: AbortError → retry 없이 즉시 500 ─────────────────────────────
  it('Case E: AbortError(timeout) → retry 없이 즉시 HTTP 500, OpenAI 1회', async () => {
    const abortErr: any = new Error('aborted');
    abortErr.name = 'AbortError';
    const mockCreate = vi.fn().mockRejectedValueOnce(abortErr);

    setClient({ chat: { completions: { create: mockCreate } } });

    const res = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('summary_failed');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  // ── Case F: 1차 성공 시 1초 delay 발생 안 함 ─────────────────────────────
  it('Case F: 1차 성공 시 retry delay(setTimeout 1000ms) 호출 없음', async () => {
    const mockCreate = vi.fn().mockResolvedValueOnce(
      makeSuccess('배영 수업 잘 마쳤습니다.'),
    );
    setClient({ chat: { completions: { create: mockCreate } } });

    const origSetTimeout = global.setTimeout;
    const delays: number[] = [];
    const spy = vi.spyOn(global, 'setTimeout').mockImplementation(
      (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (ms !== undefined) delays.push(ms);
        return origSetTimeout(fn as (...a: unknown[]) => void, ms, ...args);
      },
    );

    await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer tok')
      .send(BODY);

    spy.mockRestore();

    // 1000ms delay 호출 없음 (25000ms AbortController timer만 존재)
    const retryDelays = delays.filter(ms => ms === 1_000);
    expect(retryDelays).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
