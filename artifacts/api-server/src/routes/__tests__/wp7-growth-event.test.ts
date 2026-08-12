/**
 * wp7-growth-event.test.ts — WP7 Growth Event Persistence 단위 테스트
 *
 * 테스트 범위: insertGrowthEvents() (lib/growth-event-service.ts)
 *
 * 원칙:
 *   - 운영 DB 쓰기/읽기 없음 (tx mock).
 *   - match-token.ts verifyMatchToken mock.
 *   - 각 TC는 독립적으로 실행 가능.
 *
 * TC-A: match_status=PENDING_REVIEW + valid token + note 있음 → INSERT 1건
 * TC-B: match_status=PENDING_REVIEW + valid token + note 없음 → skip (NO_NOTE)
 * TC-C: match_status !== PENDING_REVIEW → skip (SKIP_STATUS)
 * TC-D: match_token 만료 (MatchTokenError EXPIRED) → skip + errors++ (TX 유지)
 * TC-E: match_token pool_id 불일치 (MatchTokenError TENANT_MISMATCH) → skip + errors++
 * TC-F: match_token 서명 오류 (MatchTokenError INVALID) → skip + errors++
 * TC-G: 복수 match — 일부 skip, 일부 insert → inserted/skipped/errors 정확도
 * TC-H: INSERT ON CONFLICT → rowCount=0 → skipped++
 * TC-I: match_token_id UNIQUE 위반 (pg error 23505) → skipped++
 * TC-J: DB INSERT 오류(not 23505) → throw (TX 롤백 예정)
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── vi.hoisted: mock handle ────────────────────────────────────────────────────
const mockVerifyMatchToken = vi.hoisted(() => vi.fn());

vi.mock('../../lib/match-token.js', () => {
  class MatchTokenError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = 'MatchTokenError';
    }
  }
  return {
    verifyMatchToken: mockVerifyMatchToken,
    MatchTokenError,
  };
});

import {
  insertGrowthEvents,
  type CurriculumMatchInput,
} from '../../lib/growth-event-service.js';
import { MatchTokenError } from '../../lib/match-token.js';

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const POOL_ID    = 'pool_test_123';
const DIARY_ID   = 'cd_test_diary_001';
const REQUEST_ID = 'req_test_001';

function makeMatch(overrides: Partial<CurriculumMatchInput> = {}): CurriculumMatchInput {
  return {
    student_ref:  'stu_001',
    candidate_id: 'cand_abc',
    match_token:  'hdr.pay.sig',
    match_status: 'PENDING_REVIEW',
    ...overrides,
  };
}

function makeTokenPayload(overrides: Record<string, unknown> = {}) {
  return {
    token_version:               '1',
    key_id:                      'default',
    token_id:                    'tid_mock1234567890abcdef12345678',
    issued_at:                   Date.now() / 1000 - 10,
    expires_at:                  Date.now() / 1000 + 86400,
    pool_id:                     POOL_ID,
    student_id:                  'stu_001',
    curriculum_version_id:       'cv_001',
    curriculum_item_id:          'ci_001',
    candidate_id:                'cand_abc',
    confidence:                  0.82,
    matching_algorithm_version:  'token_overlap_v1',
    confidence_config_version:   '1.0',
    request_id:                  REQUEST_ID,
    contract_version:            '1.3',
    ...overrides,
  };
}

/**
 * tx mock 생성.
 * rowCount로 ON CONFLICT 동작을 시뮬레이션.
 */
function makeTx(rowCount = 1) {
  return {
    execute: vi.fn().mockResolvedValue({ rowCount }),
  };
}

const SAVED_NOTES = [
  { id: 'csn_001', student_id: 'stu_001' },
  { id: 'csn_002', student_id: 'stu_002' },
];

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('WP7 insertGrowthEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── TC-A: 정상 INSERT ─────────────────────────────────────────────────────
  it('TC-A: PENDING_REVIEW + valid token + note 있음 → inserted=1', async () => {
    mockVerifyMatchToken.mockReturnValue(makeTokenPayload());
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
      requestId:         REQUEST_ID,
      contractVersion:   '1.3',
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(tx.execute).toHaveBeenCalledOnce();

    // INSERT에 PENDING_REVIEW 명시 확인
    const callArg = tx.execute.mock.calls[0][0];
    const sqlStr: string = callArg.sql ?? JSON.stringify(callArg);
    expect(sqlStr.toLowerCase()).toContain('pending_review');
  });

  // ── TC-B: student_note 없는 학생 → skip ──────────────────────────────────
  it('TC-B: valid token + 해당 student note 없음 → skipped=1', async () => {
    mockVerifyMatchToken.mockReturnValue(makeTokenPayload({ student_id: 'stu_UNKNOWN' }));
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch({ student_ref: 'stu_UNKNOWN' })],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  // ── TC-C: match_status !== PENDING_REVIEW → skip ─────────────────────────
  it('TC-C: match_status=AUTO_ACCEPTED → skipped=1, no INSERT', async () => {
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch({ match_status: 'AUTO_ACCEPTED' })],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
    expect(mockVerifyMatchToken).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  // ── TC-D: match_token 만료 → errors++, diary TX 유지 ─────────────────────
  it('TC-D: match_token EXPIRED → errors=1, TX 롤백 안 됨', async () => {
    mockVerifyMatchToken.mockImplementation(() => {
      throw new MatchTokenError('EXPIRED_MATCH_TOKEN', 'Token has expired.');
    });
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(1);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  // ── TC-E: match_token TENANT_MISMATCH → errors++ ─────────────────────────
  it('TC-E: match_token TENANT_MISMATCH → errors=1', async () => {
    mockVerifyMatchToken.mockImplementation(() => {
      throw new MatchTokenError('TENANT_MISMATCH', 'Token pool_id mismatch.');
    });
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
    });

    expect(result.errors).toBe(1);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  // ── TC-F: match_token 서명 오류 → errors++ ───────────────────────────────
  it('TC-F: match_token INVALID_MATCH_TOKEN → errors=1', async () => {
    mockVerifyMatchToken.mockImplementation(() => {
      throw new MatchTokenError('INVALID_MATCH_TOKEN', 'Signature verification failed.');
    });
    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
    });

    expect(result.errors).toBe(1);
    expect(tx.execute).not.toHaveBeenCalled();
  });

  // ── TC-G: 복수 match — 혼합 결과 ─────────────────────────────────────────
  it('TC-G: 3건 중 1건 insert, 1건 skip(status), 1건 error(expired) → 정확도', async () => {
    mockVerifyMatchToken
      .mockReturnValueOnce(makeTokenPayload({ student_id: 'stu_001' }))
      .mockImplementationOnce(() => {
        throw new MatchTokenError('EXPIRED_MATCH_TOKEN', 'expired');
      });

    const tx = makeTx(1);

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [
        makeMatch({ student_ref: 'stu_001' }),                        // → inserted
        makeMatch({ student_ref: 'stu_002', match_status: 'AUTO_ACCEPTED' }), // → skipped
        makeMatch({ student_ref: 'stu_002' }),                        // → error(expired)
      ],
    });

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(1);
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  // ── TC-H: ON CONFLICT → rowCount=0 → skipped++ ───────────────────────────
  it('TC-H: INSERT ON CONFLICT → rowCount=0 → skipped=1', async () => {
    mockVerifyMatchToken.mockReturnValue(makeTokenPayload());
    const tx = makeTx(0); // rowCount=0 = ON CONFLICT DO NOTHING

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
  });

  // ── TC-I: match_token_id UNIQUE 위반 (pg 23505) → skipped++ ──────────────
  it('TC-I: pg error 23505 (duplicate token_id) → skipped=1, TX 유지', async () => {
    mockVerifyMatchToken.mockReturnValue(makeTokenPayload());
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const tx = { execute: vi.fn().mockRejectedValue(pgError) };

    const result = await insertGrowthEvents({
      tx,
      poolId:            POOL_ID,
      diaryId:           DIARY_ID,
      savedNotes:        SAVED_NOTES,
      curriculumMatches: [makeMatch()],
    });

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.errors).toBe(0);
  });

  // ── TC-J: DB 오류 (not 23505) → throw ────────────────────────────────────
  it('TC-J: pg error not 23505 → throw (TX 롤백 예정)', async () => {
    mockVerifyMatchToken.mockReturnValue(makeTokenPayload());
    const dbError = Object.assign(new Error('connection error'), { code: '08006' });
    const tx = { execute: vi.fn().mockRejectedValue(dbError) };

    await expect(
      insertGrowthEvents({
        tx,
        poolId:            POOL_ID,
        diaryId:           DIARY_ID,
        savedNotes:        SAVED_NOTES,
        curriculumMatches: [makeMatch()],
      }),
    ).rejects.toThrow('connection error');
  });
});
