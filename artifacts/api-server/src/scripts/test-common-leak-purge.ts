/**
 * test-common-leak-purge.ts
 *
 * 버그 검증: 학생별 일지 내용이 공통 일지에 중복 삽입되는 문제 수정 확인
 *
 * 검증 항목:
 *   A. purgeStudentLeaksFromCommon 유닛 테스트
 *   B. 실제 API 호출: "자유형 발차기 / 태웅이는 배영 예쁘게 하는거 연습"
 *      → common에 '태웅' 포함 문장 0건
 *      → students에 '태웅' 내용 존재
 */

import { purgeStudentLeaksFromCommon } from '../lib/diary-grounding.js';

// ── 실행 환경 ─────────────────────────────────────────────────────────────────
const JWT_SECRET   = process.env.JWT_SECRET ?? '';
const BASE_URL     = process.env.API_BASE_URL ?? 'http://localhost:3456';
const USER_ID      = 'user_1775118427405_ey2qbn6is';
const POOL_ID      = 'pool_1775118427405_xs80lcdmo';

// ── JWT 생성 ─────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { userId: USER_ID, poolId: POOL_ID, role: 'pool_admin', tv: 1 },
  JWT_SECRET,
  { expiresIn: '1h' },
);

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); process.exitCode = 1; }
function check(label: string, cond: boolean, detail = '') {
  cond ? pass(`${label}${detail ? ' — ' + detail : ''}`)
       : fail(`${label}${detail ? ' — ' + detail : ''}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIT TEST: purgeStudentLeaksFromCommon
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('UNIT TEST A: purgeStudentLeaksFromCommon');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const SAMPLE_COMMON = [
  '오늘 수업에서는 자유형 발차기를 집중적으로 연습했습니다.',
  '학생들이 발차기를 통해 수영의 기본기를 다졌습니다.',
  '또한, 태웅이는 배영 자세를 예쁘게 만드는 연습을 하며 더욱 안정적인 수영을 위해 노력했습니다.',
  '수업을 통해 서로의 발전을 응원하며 즐거운 시간을 보냈습니다.',
].join(' ');

const { purged, removedSentenceCount } = purgeStudentLeaksFromCommon(
  SAMPLE_COMMON,
  ['서태웅'],
);

console.log(`\n  입력 common: "${SAMPLE_COMMON.slice(0, 60)}..."`);
console.log(`  정제 common: "${purged.slice(0, 80)}..."`);
console.log(`  제거된 문장: ${removedSentenceCount}건`);
console.log();

check('removedSentenceCount=1 (태웅이 문장 1개 제거)', removedSentenceCount === 1, `count=${removedSentenceCount}`);
check('purged에 "태웅" 미포함', !purged.includes('태웅'), purged.includes('태웅') ? '포함됨!' : '없음');
check('purged에 "자유형 발차기" 유지', purged.includes('자유형 발차기'), purged.slice(0,40));
check('purged에 "기본기" 유지', purged.includes('기본기'), '');

// 2자 이름 테스트
const { purged: p2, removedSentenceCount: r2 } = purgeStudentLeaksFromCommon(
  '오늘 킥보드 연습을 했습니다. 민준이는 매우 열심히 했습니다. 전체적으로 좋았습니다.',
  ['김민준'],
);
check('2자(민준) 이름 변형 제거', !p2.includes('민준'), `purged="${p2.slice(0,40)}"`);
check('2자 이름 — 나머지 문장 보존', p2.includes('전체적으로'), '');

// studentNames 빈 배열 테스트
const { purged: p3, removedSentenceCount: r3 } = purgeStudentLeaksFromCommon(
  '학생들이 열심히 했습니다.',
  [],
);
check('studentNames=[] → purge 없음', r3 === 0, `count=${r3}`);
check('studentNames=[] → 원문 보존', p3 === '학생들이 열심히 했습니다.', '');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API TEST B: 실제 엔드포인트 호출
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('API TEST B: "자유형 발차기 / 태웅이는 배영 예쁘게 하는거 연습"');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const payload = {
  request_id:       `test_leak_${Date.now()}`,
  contract_version: '1.0',
  schema_version:   '1.0',
  feature:          'teacher_diary',
  input: {
    text: '자유형 발차기\n태웅이는 배영 예쁘게 하는거 연습',
  },
  context: {
    pool_id:      POOL_ID,
    class_id:     'cls_test',
    lesson_date:  '2026-08-01',
    student_refs: ['s1'],
    students:     [{ ref: 's1', name: '서태웅' }],
  },
};

try {
  const res = await fetch(`${BASE_URL}/api/v1/teacher-diary/generate`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const body: any = await res.json();

  if (!res.ok) {
    console.log(`  ❌ HTTP ${res.status}: ${JSON.stringify(body).slice(0, 120)}`);
    process.exitCode = 1;
  } else {
    const common   = body.result?.common ?? '';
    const students = body.result?.students ?? [];
    const grounding = body.meta?.grounding_validation ?? {};

    console.log(`\n  [공통 일지] (${common.length}자)`);
    console.log(`  "${common}"`);
    console.log();
    console.log(`  [학생별 일지] ${students.length}명`);
    for (const s of students) {
      console.log(`  ${s.student_ref}: "${s.content?.slice(0, 80)}"`);
    }
    console.log();
    console.log(`  grounding: ${JSON.stringify(grounding)}`);

    // 핵심 검증
    const hasLeak = common.includes('태웅');
    check('common에 "태웅" 미포함 (핵심 버그 수정)', !hasLeak, hasLeak ? `포함됨: "${common.slice(0, 60)}"` : '없음');
    check('student_to_common_leak_count=0', grounding.student_to_common_leak_count === 0, `count=${grounding.student_to_common_leak_count}`);
    check('students에 태웅 내용 존재', students.length > 0 && students[0].content?.includes('태웅'), `students[0]="${students[0]?.content?.slice(0,40)}"`);
    check('common이 빈 문자열이 아님', common.length > 0, `length=${common.length}`);
  }
} catch (e: any) {
  console.log(`  ❌ 요청 실패: ${e.message}`);
  process.exitCode = 1;
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('테스트 완료');
console.log('════════════════════════════════════════════════════════════\n');
