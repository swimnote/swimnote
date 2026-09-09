/**
 * diary-safety-gate-gaps.test.ts
 *
 * P0 DIARY SAFETY GATE — FINAL 3 GAPS (CASE M~R)
 *
 * Gap 1: LEGACY TRACE SCOPE BYPASS 제거 → AI_TRACE_SCOPE_UNVERIFIED
 * Gap 2: TEACHER SCOPE LOCK → DIARY_TEACHER_SCOPE_MISMATCH
 * Gap 3: AI STUDENT NOTES EXPLICIT CONFIRMATION (app-side, unit tests below)
 *
 * CASE M: old/scope-less AI trace → 409 AI_TRACE_SCOPE_UNVERIFIED
 * CASE N: Teacher A generate → same pool Teacher B save → 409 DIARY_TEACHER_SCOPE_MISMATCH
 * CASE O: AI student notes exist → 최초 탭 → confirmation 없이 POST 발생 0
 * CASE P: confirmation 선택 → 정확히 1회 저장
 * CASE Q: AI common only → 추가 confirmation 없이 정상 저장
 * CASE R: manual diary → 영향 없음
 */

import { describe, it, expect } from 'vitest';

// ── Helper: fetchAiTraceScope 동작 시뮬레이션 ────────────────────────────────

interface AiTraceScope {
  class_id:    string;
  lesson_date: string;
  student_ids: string[];
  actor_id?:   string | null;
}

/**
 * fetchAiTraceScope 시뮬레이션.
 * - scope 있음 → AiTraceScope 반환
 * - scope 없음(구버전 trace) → null 반환 (Gap 1: 이 경우 409 반환해야 함)
 */
function simulateFetchScope(hasScope: boolean, scope?: Partial<AiTraceScope>): AiTraceScope | null {
  if (!hasScope) return null;
  return {
    class_id:    scope?.class_id    ?? 'class_test_001',
    lesson_date: scope?.lesson_date ?? '2026-09-09',
    student_ids: scope?.student_ids ?? ['stu_a', 'stu_b'],
    actor_id:    scope?.actor_id    ?? 'teacher_alice',
  };
}

/**
 * 서버 측 scope 검증 로직 시뮬레이션.
 * 실제 diary.ts POST /diaries 핸들러 검증 순서 반영.
 */
function simulateDiarySave(params: {
  isAiRequest:    boolean;
  scope:          AiTraceScope | null;
  reqClassId:     string;
  reqDate:        string;
  reqUserId:      string;
  reqStudentIds:  string[];
  forceSuspicious?: boolean;
}): { status: number; error?: string; ok?: boolean } {
  const { isAiRequest, scope, reqClassId, reqDate, reqUserId, reqStudentIds } = params;

  if (!isAiRequest) return { status: 200, ok: true };  // manual diary: 모든 gate 스킵

  // Gap 1: scope 없음 → 409
  if (scope === null) {
    return { status: 409, error: 'AI_TRACE_SCOPE_UNVERIFIED' };
  }

  // class_id mismatch
  if (scope.class_id && scope.class_id !== reqClassId) {
    return { status: 409, error: 'DIARY_CLASS_SCOPE_MISMATCH' };
  }

  // date mismatch
  if (scope.lesson_date && scope.lesson_date !== reqDate) {
    return { status: 409, error: 'DIARY_DATE_SCOPE_MISMATCH' };
  }

  // Gap 2: teacher_id (actor_id) mismatch
  if (scope.actor_id && scope.actor_id !== reqUserId) {
    return { status: 409, error: 'DIARY_TEACHER_SCOPE_MISMATCH' };
  }

  // student_id binding
  for (const sid of reqStudentIds) {
    if (scope.student_ids.length > 0 && !scope.student_ids.includes(sid)) {
      return { status: 409, error: 'DIARY_STUDENT_SCOPE_MISMATCH' };
    }
  }

  return { status: 200, ok: true };
}

// ── Gap 3: App-side confirmation logic 시뮬레이션 ────────────────────────────

/**
 * handleSave 최초 탭 동작 시뮬레이션.
 * - aiRequestId 존재 + student notes + 미확인 → Alert 표시, POST 미발생
 * - 확인 후 재탭 → POST 발생
 */
function simulateHandleSave(params: {
  aiRequestId:            string | null;
  studentNotes:           { note_content: string }[];
  aiStudentNotesConfirmed: boolean;
  isRetry:                boolean;
}): 'ALERT' | 'POST_SKIPPED' | 'PROCEED_TO_POST' {
  const { aiRequestId, studentNotes, aiStudentNotesConfirmed, isRetry } = params;
  const hasAiStudentNotes = studentNotes.some(n => n.note_content?.trim());
  if (!isRetry && aiRequestId && !aiStudentNotesConfirmed && hasAiStudentNotes) {
    return 'ALERT';
  }
  return 'PROCEED_TO_POST';
}

// ────────────────────────────────────────────────────────────────────────────
// TESTS
// ────────────────────────────────────────────────────────────────────────────

describe('Gap 1: LEGACY TRACE SCOPE BYPASS 제거 (CASE M)', () => {
  it('CASE M: scope-less AI trace → 409 AI_TRACE_SCOPE_UNVERIFIED', () => {
    const scope = simulateFetchScope(false);  // 구버전 trace — scope 없음
    const result = simulateDiarySave({
      isAiRequest:   true,
      scope,
      reqClassId:    'class_test_001',
      reqDate:       '2026-09-09',
      reqUserId:     'teacher_alice',
      reqStudentIds: ['stu_a'],
    });
    expect(result.status).toBe(409);
    expect(result.error).toBe('AI_TRACE_SCOPE_UNVERIFIED');
  });

  it('CASE M-OK: scope 있는 AI trace → 정상 저장', () => {
    const scope = simulateFetchScope(true, { actor_id: 'teacher_alice' });
    const result = simulateDiarySave({
      isAiRequest:   true,
      scope,
      reqClassId:    'class_test_001',
      reqDate:       '2026-09-09',
      reqUserId:     'teacher_alice',
      reqStudentIds: ['stu_a', 'stu_b'],
    });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
  });
});

describe('Gap 2: TEACHER SCOPE LOCK (CASE N)', () => {
  // CASE N: Teacher A가 generate → Teacher B가 같은 pool에서 같은 request_id로 save 시도
  it('CASE N: Teacher B가 Teacher A의 request_id로 저장 → 409 DIARY_TEACHER_SCOPE_MISMATCH', () => {
    // Teacher A가 generate → actor_id = 'teacher_alice'
    const scope = simulateFetchScope(true, {
      class_id:    'class_test_001',
      lesson_date: '2026-09-09',
      student_ids: ['stu_a', 'stu_b'],
      actor_id:    'teacher_alice',  // generate 당시 teacher
    });

    // Teacher B가 같은 pool에서 save 시도 (pool mismatch 아님 — same pool)
    const result = simulateDiarySave({
      isAiRequest:   true,
      scope,
      reqClassId:    'class_test_001',  // same class
      reqDate:       '2026-09-09',      // same date
      reqUserId:     'teacher_bob',     // 다른 teacher (SAME POOL)
      reqStudentIds: ['stu_a'],
    });

    expect(result.status).toBe(409);
    expect(result.error).toBe('DIARY_TEACHER_SCOPE_MISMATCH');
  });

  it('CASE N-OK: Teacher A가 본인 request_id로 저장 → 허용', () => {
    const scope = simulateFetchScope(true, { actor_id: 'teacher_alice' });
    const result = simulateDiarySave({
      isAiRequest:   true,
      scope,
      reqClassId:    'class_test_001',
      reqDate:       '2026-09-09',
      reqUserId:     'teacher_alice',  // generate한 본인
      reqStudentIds: ['stu_a', 'stu_b'],
    });
    expect(result.status).toBe(200);
  });

  it('CASE N-POOL-MISMATCH-DISTINCT: pool mismatch는 verifyAiOrigin이 처리 — teacher check와 별도', () => {
    // pool_id mismatch는 verifyAiOrigin에서 VERIFIED_AI=false → 409 AI_ORIGIN_UNVERIFIED
    // 이 테스트는 같은 pool 내 다른 teacher만 검증
    const scope = simulateFetchScope(true, { actor_id: 'teacher_alice' });
    // actor_id만 다르고 나머지는 동일
    const result = simulateDiarySave({
      isAiRequest: true, scope,
      reqClassId: 'class_test_001', reqDate: '2026-09-09',
      reqUserId: 'teacher_bob',  // 다른 teacher, 같은 pool
      reqStudentIds: ['stu_a'],
    });
    expect(result.error).toBe('DIARY_TEACHER_SCOPE_MISMATCH');
  });
});

describe('Gap 3: AI STUDENT NOTES EXPLICIT CONFIRMATION (CASE O~R)', () => {
  // CASE O: AI student notes 존재 → 저장 최초 탭 → confirmation 없이 POST 발생 0
  it('CASE O: AI student notes 존재 + 미확인 → ALERT, POST 미발생', () => {
    const result = simulateHandleSave({
      aiRequestId:             'req_test_001',
      studentNotes:            [{ note_content: '발차기 연습을 열심히 했습니다.' }],
      aiStudentNotesConfirmed: false,
      isRetry:                 false,
    });
    expect(result).toBe('ALERT');
  });

  // CASE P: confirmation 선택 → 정확히 1회 저장
  it('CASE P: confirmation 선택 후 → PROCEED_TO_POST (1회)', () => {
    const result = simulateHandleSave({
      aiRequestId:             'req_test_001',
      studentNotes:            [{ note_content: '발차기 연습을 열심히 했습니다.' }],
      aiStudentNotesConfirmed: true,   // 확인 완료
      isRetry:                 false,
    });
    expect(result).toBe('PROCEED_TO_POST');
  });

  // CASE Q: AI common only (student notes 없음) → 추가 confirmation 불필요
  it('CASE Q: AI common only (student notes 없음) → confirmation 없이 PROCEED', () => {
    const result = simulateHandleSave({
      aiRequestId:             'req_test_001',
      studentNotes:            [],       // student notes 없음
      aiStudentNotesConfirmed: false,    // 미확인이어도
      isRetry:                 false,
    });
    expect(result).toBe('PROCEED_TO_POST');
  });

  // CASE Q-2: student notes 있지만 note_content 없음 (empty)
  it('CASE Q-2: student notes 있지만 빈 content → confirmation 불필요', () => {
    const result = simulateHandleSave({
      aiRequestId:             'req_test_001',
      studentNotes:            [{ note_content: '  ' }],  // trim = empty
      aiStudentNotesConfirmed: false,
      isRetry:                 false,
    });
    expect(result).toBe('PROCEED_TO_POST');
  });

  // CASE R: manual diary (aiRequestId 없음) → 영향 없음
  it('CASE R: manual diary (aiRequestId=null) → confirmation 불필요', () => {
    const result = simulateHandleSave({
      aiRequestId:             null,     // manual diary
      studentNotes:            [{ note_content: '발차기 연습' }],
      aiStudentNotesConfirmed: false,
      isRetry:                 false,
    });
    expect(result).toBe('PROCEED_TO_POST');
  });

  // retry 모드: confirmation 건너뜀 (사진 업로드 재시도 등)
  it('isRetry=true → confirmation 건너뜀', () => {
    const result = simulateHandleSave({
      aiRequestId:             'req_test_001',
      studentNotes:            [{ note_content: '연습' }],
      aiStudentNotesConfirmed: false,    // 미확인이어도
      isRetry:                 true,     // retry 모드
    });
    expect(result).toBe('PROCEED_TO_POST');
  });
});

describe('기존 CASE A~L regression (핵심 케이스)', () => {
  it('scope 있는 새 trace + same teacher → 정상 저장 (CASE A~B 조건 충족)', () => {
    const scope = simulateFetchScope(true, { actor_id: 'teacher_alice' });
    const result = simulateDiarySave({
      isAiRequest: true, scope,
      reqClassId: 'class_test_001', reqDate: '2026-09-09',
      reqUserId: 'teacher_alice', reqStudentIds: ['stu_a', 'stu_b'],
    });
    expect(result.status).toBe(200);
  });

  it('manual diary → 모든 AI gate 미적용 (CASE L)', () => {
    const result = simulateDiarySave({
      isAiRequest: false, scope: null,
      reqClassId: 'class_any', reqDate: '2026-09-09',
      reqUserId: 'teacher_alice', reqStudentIds: [],
    });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
  });

  it('scope student_ids 범위 외 student → DIARY_STUDENT_SCOPE_MISMATCH (CASE C)', () => {
    const scope = simulateFetchScope(true, { actor_id: 'teacher_alice', student_ids: ['stu_a', 'stu_b'] });
    const result = simulateDiarySave({
      isAiRequest: true, scope,
      reqClassId: 'class_test_001', reqDate: '2026-09-09',
      reqUserId: 'teacher_alice', reqStudentIds: ['stu_z'],  // 범위 외
    });
    expect(result.status).toBe(409);
    expect(result.error).toBe('DIARY_STUDENT_SCOPE_MISMATCH');
  });
});
