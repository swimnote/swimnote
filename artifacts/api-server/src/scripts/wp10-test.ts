/**
 * WP10 테스트 스크립트 — Teacher Diary AI E2E 검증
 * 실제 회원 데이터 없이 테스트 계정(pool_review_test_2026)만 사용
 */
import { signToken } from '../lib/auth.js';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

const BASE = 'http://localhost:8080/api';

// 테스트 계정 (DB에서 확인됨)
const TEST_USER_ID  = 'user_teacher_review_2026';
const TEST_POOL_ID  = 'pool_review_test_2026';
const TEST_CLASS_ID = 'cg_review_test_001';
// 테스트 학생 (DB에서 확인됨)
const TEST_STUDENTS = [
  { ref: 'student_review_001', name: '테스트학생A' },
  { ref: 'student_review_002', name: '테스트학생B' },
];

const TEST_DATE = '2026-07-29';  // WP10 테스트 날짜

function log(label: string, val: unknown) {
  console.log(`[WP10] ${label}:`, JSON.stringify(val, null, 2));
}

async function run() {
  // ── 0. JWT 생성 ──────────────────────────────────────────────────────────
  const token = signToken({ userId: TEST_USER_ID, role: 'teacher', poolId: TEST_POOL_ID });
  log('TOKEN_LEN', token.length);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };

  // ── 1. auth/me 확인 ──────────────────────────────────────────────────────
  const meRes = await fetch(`${BASE}/auth/me`, { headers });
  log('auth/me status', meRes.status);
  if (!meRes.ok) {
    const body = await meRes.json();
    log('auth/me error', body);
    throw new Error('auth/me failed');
  }
  const me = await meRes.json();
  log('auth/me role', me.user?.role);
  log('auth/me poolId', me.user?.swimming_pool_id ? 'exists' : 'null');

  // ── 2. POST /ai/diary/generate ────────────────────────────────────────────
  const requestId = `wp10-test-${Date.now()}`;
  const generatePayload = {
    request_id:     requestId,
    schema_version: '1.0',
    feature:        'teacher_diary',
    locale:         'ko',
    input: {
      text: '오늘은 자유형 발차기와 호흡 연결을 연습했습니다. 첫 번째 학생은 호흡 타이밍을 연습했고, 두 번째 학생은 발차기 리듬을 연습했습니다.',
    },
    context: {
      pool_id:      TEST_POOL_ID,
      class_id:     TEST_CLASS_ID,
      lesson_date:  TEST_DATE,
      student_refs: TEST_STUDENTS.map(s => s.ref),
      students:     TEST_STUDENTS,
    },
  };

  const genStart = Date.now();
  const genRes = await fetch(`${BASE}/ai/diary/generate`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(generatePayload),
  });
  const genDuration = Date.now() - genStart;

  log('ai/diary/generate status', genRes.status);
  log('ai/diary/generate duration_ms', genDuration);

  if (!genRes.ok) {
    const body = await genRes.json();
    log('ai/diary/generate ERROR', { status: genRes.status, code: body?.error?.code, retryable: body?.error?.retryable });
    throw new Error(`ai/diary/generate failed: ${body?.error?.code}`);
  }

  const genBody = await genRes.json();
  log('ai/diary/generate response_keys', Object.keys(genBody));
  log('ai/diary/generate request_id_echoed', genBody.request_id === requestId);
  log('ai/diary/generate schema_version', genBody.schema_version);
  log('ai/diary/generate feature', genBody.feature);
  log('ai/diary/generate common_len', genBody.result?.common?.length ?? 0);
  log('ai/diary/generate students_count', genBody.result?.students?.length ?? 0);
  log('ai/diary/generate usage_keys', Object.keys(genBody.usage ?? {}));
  log('ai/diary/generate total_tokens', genBody.usage?.total_tokens);

  // common과 students 원문 미출력
  const commonLen = genBody.result?.common?.length ?? 0;
  const studentsOut = genBody.result?.students ?? [];

  // ── 3. 결과 편집 시뮬레이션 (앱에서 교사가 수정하는 것 시뮬레이션) ──────
  // WP9에서 verified: 실제 앱에서는 교사가 TextInput으로 수정
  // 여기서는 "[수정됨]" suffix 추가로 수정 반영 시뮬레이션
  const editedCommon   = (genBody.result?.common ?? '') + ' [WP10테스트]';
  const editedStudents = studentsOut.map((s: any) => ({
    student_id:   s.student_ref,
    note_content: (s.content ?? '') + ' [수정됨]',
  }));

  log('edited_common_len', editedCommon.length);
  log('edited_students_count', editedStudents.length);

  // ── 4. POST /diaries (Save) ───────────────────────────────────────────────
  const savePayload = {
    class_group_id: TEST_CLASS_ID,
    lesson_date:    TEST_DATE,
    common_content: editedCommon.trim(),
    student_notes:  editedStudents.map((s: any) => ({
      student_id:   s.student_id,
      note_content: s.note_content.trim(),
    })),
  };

  const saveStart = Date.now();
  const saveRes = await fetch(`${BASE}/diaries`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(savePayload),
  });
  const saveDuration = Date.now() - saveStart;

  log('diaries POST status', saveRes.status);
  log('diaries POST duration_ms', saveDuration);

  if (!saveRes.ok) {
    const body = await saveRes.json();
    log('diaries POST ERROR', { status: saveRes.status, error: body?.error });
    throw new Error(`POST /diaries failed: ${saveRes.status}`);
  }

  const saveBody = await saveRes.json();
  log('diaries POST response_keys', Object.keys(saveBody));

  const diaryId = saveBody.diary_id || saveBody.id;
  log('diaries POST diary_id exists', !!diaryId);

  // ── 5. GET /diaries 재조회 ────────────────────────────────────────────────
  const listRes = await fetch(
    `${BASE}/diaries?class_group_id=${TEST_CLASS_ID}&date=${TEST_DATE}`,
    { headers }
  );
  log('diaries GET status', listRes.status);

  if (!listRes.ok) {
    const body = await listRes.json();
    log('diaries GET ERROR', body);
    throw new Error(`GET /diaries failed`);
  }

  const listBody = await listRes.json();
  const diaries  = listBody.diaries ?? listBody ?? [];
  log('diaries GET count', Array.isArray(diaries) ? diaries.length : 'not array');

  // 저장된 일지 확인 (개인정보 없이)
  let savedDiary: any = null;
  if (Array.isArray(diaries)) {
    savedDiary = diaries.find((d: any) => d.id === diaryId || d.diary_id === diaryId);
    if (!savedDiary && diaries.length > 0) {
      // lesson_date 기준으로 찾기
      savedDiary = diaries.find((d: any) => d.lesson_date === TEST_DATE);
    }
  }

  log('saved_diary_found', !!savedDiary);
  log('saved_diary_common_len', savedDiary?.common_content?.length ?? 0);
  log('saved_diary_common_ends_with_marker', savedDiary?.common_content?.includes('[WP10테스트]') ?? false);
  log('saved_diary_student_notes_count', savedDiary?.student_notes?.length ?? 0);

  // student_notes 수정 반영 확인
  if (savedDiary?.student_notes) {
    for (const note of savedDiary.student_notes) {
      log('note_contains_edit_marker', note.note_content?.includes('[수정됨]') ?? false);
    }
  }

  // ── 6. 테스트 일지 삭제 (clean up) ───────────────────────────────────────
  if (diaryId) {
    const delRes = await fetch(`${BASE}/diaries/${diaryId}`, {
      method:  'DELETE',
      headers,
    });
    log('diaries DELETE status', delRes.status);
    log('cleanup_done', delRes.ok);
  }

  console.log('\n[WP10] ✅ 전체 E2E 완료');
  console.log(`[WP10] generate request_id: ${requestId}`);
  console.log(`[WP10] generate duration_ms: ${genDuration}`);
  console.log(`[WP10] save duration_ms: ${saveDuration}`);
  console.log(`[WP10] diary_id created: ${!!diaryId}`);
}

run().catch(e => {
  console.error('[WP10] FAIL:', e.message);
  process.exit(1);
});
