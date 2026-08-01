/**
 * test-eval-purge.ts
 *
 * 평가 표현 강제 제거 검증
 *
 * 완료 기준:
 *   입력: "자유형 발차기 / 태웅이는 배영 예쁘게 하는 거 연습"
 *   공통: 평가 표현 0건
 *   학생별: 평가 표현 0건 (태웅 내용만 존재)
 */

import { purgeInventedEvaluations } from '../lib/diary-grounding.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? '';
const BASE_URL   = process.env.API_BASE_URL ?? 'http://localhost:8080';
const USER_ID    = 'user_1775118427405_ey2qbn6is';
const POOL_ID    = 'pool_1775118427405_xs80lcdmo';

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

// 평가 키워드 목록 (grounding.ts와 동일해야 함)
const EVAL_KW = [
  '향상', '발전', '성장', '개선', '기대', '기대됩니다', '기대돼',
  '잘하', '잘 하', '훌륭', '좋아지', '나아지', '늘었', '실력', '능력',
  '태도', '집중', '노력', '의욕', '적극',
  '적극적으로 참여', '집중해서 참여', '즐겁게 참여', '열심히 참여',
  '최선을 다해 참여', '진지하게 참여', '성실하게 참여',
  '인상적', '감동', '응원', '즐겁', '서로의 발전',
];

function hasInventedEval(text: string, inputText: string): string[] {
  return EVAL_KW.filter(kw => text.includes(kw) && !inputText.includes(kw));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIT TEST A: purgeInventedEvaluations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('UNIT TEST A: purgeInventedEvaluations');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const INPUT = '자유형 발차기\n태웅이는 배영 예쁘게 하는거 연습';

// 케이스 1: 버그 재현 — 실제로 보고된 출력
const BUGGY_COMMON = '자유형 발차기를 시작했습니다. 집중해서 참여하였고, 수업에 적극적인 태도를 보였습니다.';
const { purged: p1, removedSentenceCount: r1 } = purgeInventedEvaluations(BUGGY_COMMON, INPUT);
console.log(`\n  [케이스1] 버그 재현 입력: "${BUGGY_COMMON}"`);
console.log(`  정제 결과: "${p1}"`);
console.log(`  제거된 문장: ${r1}건`);
check('케이스1: 집중·적극·태도 문장 제거됨', r1 >= 1, `removed=${r1}`);
check('케이스1: purged에 평가 표현 없음', hasInventedEval(p1, INPUT).length === 0, hasInventedEval(p1, INPUT).join(',') || '없음');
check('케이스1: 자유형 발차기 문장 보존', p1.includes('자유형 발차기'), p1.slice(0, 40));

// 케이스 2: 응원·발전
const BUGGY2 = '오늘 자유형 발차기 연습을 진행했습니다. 수업을 통해 서로의 발전을 응원하며 즐거운 시간을 보냈습니다.';
const { purged: p2, removedSentenceCount: r2 } = purgeInventedEvaluations(BUGGY2, INPUT);
check('케이스2: 응원·발전 문장 제거됨', r2 >= 1, `removed=${r2}`);
check('케이스2: "자유형 발차기" 보존', p2.includes('자유형 발차기'), p2.slice(0, 40));

// 케이스 3: 교사가 '집중' 언급 → 허용
const INPUT_WITH_KW = '자유형 발차기 집중해서 연습';
const TEXT3 = '오늘 집중적으로 발차기 연습을 했습니다. 수업을 마쳤습니다.';
const { purged: p3, removedSentenceCount: r3 } = purgeInventedEvaluations(TEXT3, INPUT_WITH_KW);
check('케이스3: 원문에 집중 있으면 허용', r3 === 0, `removed=${r3}`);

// 케이스 4: 학생 content
const STUDENT_CONTENT = '태웅이는 배영을 예쁘게 하는 연습을 했습니다. 발전하는 모습이 인상적이었습니다.';
const { purged: p4, removedSentenceCount: r4 } = purgeInventedEvaluations(STUDENT_CONTENT, INPUT);
check('케이스4: 학생 content 평가 문장 제거', r4 >= 1, `removed=${r4}`);
check('케이스4: 태웅 핵심 내용 보존', p4.includes('태웅'), p4.slice(0, 40));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API TEST B: 실제 엔드포인트 호출
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('API TEST B: "자유형 발차기 / 태웅이는 배영 예쁘게 하는 거 연습"');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const payload = {
  request_id:       `test_eval_${Date.now()}`,
  contract_version: '1.0',
  schema_version:   '1.0',
  feature:          'teacher_diary',
  input: { text: INPUT },
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body:    JSON.stringify(payload),
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
      console.log(`  ${s.student_ref}: "${s.content}"`);
    }
    console.log();
    console.log(`  grounding: ${JSON.stringify(grounding)}`);

    const commonEvalKw   = hasInventedEval(common, INPUT);
    const studentContent = students[0]?.content ?? '';
    const studentEvalKw  = hasInventedEval(studentContent, INPUT);

    // 핵심 완료 기준
    check('common 평가 표현 0건', commonEvalKw.length === 0, commonEvalKw.join(',') || '없음');
    check('student 평가 표현 0건', studentEvalKw.length === 0, studentEvalKw.join(',') || '없음');
    check('common에 "태웅" 미포함 (leak 0)', !common.includes('태웅'), '없음');
    check('student에 태웅 내용 존재', students.length > 0 && studentContent.includes('태웅'), studentContent.slice(0, 40));
    check('common이 비어있지 않음', common.length > 0, `length=${common.length}`);
    check('student_to_common_leak_count=0', grounding.student_to_common_leak_count === 0, `count=${grounding.student_to_common_leak_count}`);
  }
} catch (e: any) {
  console.log(`  ❌ 요청 실패: ${e.message}`);
  process.exitCode = 1;
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('테스트 완료');
console.log('════════════════════════════════════════════════════════════\n');
