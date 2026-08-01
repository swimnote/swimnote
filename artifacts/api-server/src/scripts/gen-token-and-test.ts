/**
 * gen-token-and-test.ts — JWT 생성 + A/B/C 테스트 (Render production 서버 대상)
 */

import jwt from 'jsonwebtoken';
import https from 'https';

const RENDER_BASE = 'https://swimnote-api.onrender.com';
const JWT_SECRET  = process.env.JWT_SECRET!;

// ── pool/class ID (워크스페이스 DB에 swim_classes 없음 → 하드코딩) ────────────
// pool_id: integration-test.ts의 Supabase 풀 ID 사용
// class_id: ai-v1.ts는 빈 문자열 여부만 검사 (DB 조회 없음)
const poolId  = 'pool_1775118427405_xs80lcdmo';
const classId = 'class_test_v2_grounding';

const JWT_TOKEN = jwt.sign(
  { userId: 'test-user-v2', role: 'teacher', poolId, tv: 1 },
  JWT_SECRET,
  { expiresIn: '2h' },
);

const CANDIDATE_MIN_CONCEPT_OVERLAP_EXPECTED = 0.30;

console.log(`\npool_id:   ${poolId}`);
console.log(`class_id:  ${classId}`);
console.log(`token(50): ${JWT_TOKEN.slice(0, 50)}...`);

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function post(path: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, RENDER_BASE);
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: url.hostname,
        port:     443,
        path:     url.pathname,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization':  `Bearer ${JWT_TOKEN}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function makeReq(text: string, students: { ref: string; name: string }[] = []) {
  return {
    contract_version: '1.0',
    request_id:       `tv2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    schema_version:   '1.0',
    feature:          'teacher_diary',
    input:            { text },
    context: {
      pool_id:      poolId,
      class_id:     classId,
      lesson_date:  '2026-08-01',
      student_refs: students.map(s => s.ref),
      students,
    },
  };
}

function ok(label: string, pass: boolean, detail: string) {
  console.log(`  ${pass ? '✅' : '❌'} ${label} — ${detail}`);
  return pass;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — 입력: "자유형" (영법 단독)
// 검증: top_score <= 3.0, strokeMatch <= 1, grounding_validation 분리
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n━━━ TEST A: "자유형" ━━━');
{
  const res  = await post('/api/v1/teacher-diary/generate', makeReq('자유형'));
  // 에러 응답 확인
  if (res.status === 'failed') {
    console.error('  ❌ API ERROR:', JSON.stringify(res.error));
    process.exit(1);
  }
  const meta = res.meta ?? {};
  const gv   = meta.grounding_validation ?? {};
  const bd   = meta.top_breakdown;

  console.log(`  parser_confidence:        ${meta.parser_confidence}`);
  console.log(`  generation_mode:          ${meta.generation_mode}`);
  console.log(`  top_score:                ${meta.top_score}`);
  console.log(`  top_breakdown:            ${JSON.stringify(bd)}`);
  console.log(`  template_used_count:      ${meta.template_used_count}`);
  console.log(`  template_ids:             ${JSON.stringify(meta.template_ids)}`);
  console.log(`  grounding_validation:     ${JSON.stringify(gv)}`);
  console.log(`  common (80자):            ${(res.result?.common ?? '').slice(0, 80)}`);
  console.log(`  students 수:              ${(res.result?.students ?? []).length}`);

  console.log('\n  [검증]');
  ok('top_score <= 3.0 (정규화)',                     meta.top_score <= 3.0,                                    `top_score=${meta.top_score}`);
  ok('strokeMatch <= 1 (중복 합산 금지)',              !bd || bd.strokeMatch <= 1,                               `strokeMatch=${bd?.strokeMatch ?? 'n/a'}`);
  ok('conceptOverlap ∈ [0,1]',                        !bd || (bd.conceptOverlap >= 0 && bd.conceptOverlap <= 1), `conceptOverlap=${bd?.conceptOverlap ?? 'n/a'}`);
  ok('template_ids 최대 1개',                          (meta.template_ids ?? []).length <= 1,                    `len=${(meta.template_ids ?? []).length}`);
  ok('grounding.score ≠ parser_confidence(0.5)',       gv.score !== 0.5,                                         `grounding.score=${gv.score} vs parser=${meta.parser_confidence}`);
  ok('grounding unsupported_claim_count 필드 존재',    typeof gv.unsupported_claim_count === 'number',           `count=${gv.unsupported_claim_count}`);
  ok('grounding invented_technique_count 필드 존재',   typeof gv.invented_technique_count === 'number',          `count=${gv.invented_technique_count}`);

  // SCORE 구성 검증: 영법 단독이면 strokeMatch=1 이외 나머지 0
  // → score=1.0 < USAGE_MIN_SCORE=1.40 → INPUT_ONLY (conceptOverlap이 있으면 TEMPLATE_ASSISTED)
  if (meta.generation_mode === 'INPUT_ONLY') {
    console.log(`  ℹ️  영법 단독 → INPUT_ONLY (USAGE_MIN_SCORE=1.40 미달, top_score=${meta.top_score})`);
    ok('top_score < 1.40 또는 candidate=0으로 INPUT_ONLY 결정',
      meta.top_score < 1.40 || meta.template_candidate_count === 0,
      `top_score=${meta.top_score} candidates=${meta.template_candidate_count}`);
  } else {
    // TEMPLATE_ASSISTED: conceptOverlap >= 0.30 충족한 template 있음 (text에 '자유형' 포함)
    console.log(`  ℹ️  TEMPLATE_ASSISTED: conceptOverlap 충족 template 존재 (text에 '자유형' 포함)`);
    ok('top_score >= 1.40 (USAGE_MIN_SCORE 통과)',
      meta.top_score >= 1.40,
      `top_score=${meta.top_score}`);
    ok('top_breakdown.conceptOverlap >= 0.30',
      bd?.conceptOverlap >= 0.30,
      `conceptOverlap=${bd?.conceptOverlap}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — 입력: "태웅 자유형 발차기 무릎 많이 굽힘"
// 검증: student→common leak 0건, 태도/향상/계획 0건, strokeMatch=1 focusMatch=1
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n━━━ TEST B: "태웅 자유형 발차기 무릎 많이 굽힘" ━━━');
{
  const res  = await post('/api/v1/teacher-diary/generate',
    makeReq('태웅 자유형 발차기 무릎 많이 굽힘', [{ ref: 'student_taewung', name: '태웅' }]));
  const meta = res.meta ?? {};
  const gv   = meta.grounding_validation ?? {};
  const bd   = meta.top_breakdown;

  console.log(`  parser_confidence:        ${meta.parser_confidence}`);
  console.log(`  generation_mode:          ${meta.generation_mode}`);
  console.log(`  top_score:                ${meta.top_score}`);
  console.log(`  top_breakdown:            ${JSON.stringify(bd)}`);
  console.log(`  template_ids:             ${JSON.stringify(meta.template_ids)}`);
  console.log(`  grounding_validation:     ${JSON.stringify(gv)}`);
  console.log(`  common (80자):            ${(res.result?.common ?? '').slice(0, 80)}`);
  console.log(`  students:                 ${JSON.stringify(res.result?.students ?? [])}`);

  console.log('\n  [검증]');
  ok('top_score <= 3.0',                                         meta.top_score <= 3.0,                        `top_score=${meta.top_score}`);
  ok('top_breakdown.strokeMatch=1',                              bd?.strokeMatch === 1,                        `strokeMatch=${bd?.strokeMatch}`);
  ok('top_breakdown.focusMatch=1 (발차기)',                      bd?.focusMatch === 1,                         `focusMatch=${bd?.focusMatch}`);
  ok('top_breakdown.observationMatch=1 (무릎/굽힘)',             bd?.observationMatch === 1,                   `observationMatch=${bd?.observationMatch}`);
  ok('template_ids 최대 1개',                                    (meta.template_ids ?? []).length <= 1,        `len=${(meta.template_ids ?? []).length}`);
  ok('student_to_common_leak_count=0 (태웅→common 금지)',        gv.student_to_common_leak_count === 0,        `leak=${gv.student_to_common_leak_count}`);
  ok('invented_next_plan_count=0',                               gv.invented_next_plan_count === 0,            `next_plan=${gv.invented_next_plan_count}`);
  ok('invented_student_evaluation_count=0',                      gv.invented_student_evaluation_count === 0,   `evaluation=${gv.invented_student_evaluation_count}`);
  ok('태웅이 common에 미포함',                                   !(res.result?.common ?? '').includes('태웅'), `common=${(res.result?.common ?? '').slice(0, 60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST C — 입력: "자유형 발차기" (template candidate vs used 분리)
// 검증: candidate_ids vs template_ids 분리, template_ids 최대 1개, DB ID 형식
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n━━━ TEST C: "자유형 발차기" (template candidate vs used 분리) ━━━');
{
  const res  = await post('/api/v1/teacher-diary/generate', makeReq('자유형 발차기'));
  const meta = res.meta ?? {};
  const gv   = meta.grounding_validation ?? {};
  const bd   = meta.top_breakdown;
  const cids = meta.template_candidate_ids ?? [];
  const uids = meta.template_ids ?? [];

  console.log(`  parser_confidence:        ${meta.parser_confidence}`);
  console.log(`  generation_mode:          ${meta.generation_mode}`);
  console.log(`  top_score:                ${meta.top_score}`);
  console.log(`  top_breakdown:            ${JSON.stringify(bd)}`);
  console.log(`  template_candidate_count: ${meta.template_candidate_count}`);
  console.log(`  template_used_count:      ${meta.template_used_count}`);
  console.log(`  template_candidate_ids:   [${cids.length}개] first=${cids[0] ?? 'none'}`);
  console.log(`  template_ids:             ${JSON.stringify(uids)}`);
  console.log(`  grounding_validation:     ${JSON.stringify(gv)}`);
  console.log(`  common (80자):            ${(res.result?.common ?? '').slice(0, 80)}`);

  console.log('\n  [검증]');
  ok('top_score <= 3.0',                           meta.top_score <= 3.0,                              `top_score=${meta.top_score}`);
  ok('template_ids 최대 1개 (TOP_K_USAGE=1)',       uids.length <= 1,                                   `template_ids.length=${uids.length}`);
  ok('candidate_ids와 template_ids 별도 필드',      Array.isArray(cids) && Array.isArray(uids),         `candidates=${cids.length} used=${uids.length}`);
  if (uids.length > 0) {
    ok('used template_id가 candidate_ids에 포함',   cids.includes(uids[0]),                             `id=${uids[0]}`);
    ok('template_ids는 실제 DB ID (dt_ 형식)',       (uids[0] as string).startsWith('dt_'),              `id=${uids[0]}`);
  }
  ok('grounding_validation 전체 필드 존재', [
    'status','score','unsupported_claim_count',
    'student_to_common_leak_count','invented_student_evaluation_count',
    'invented_next_plan_count','invented_technique_count',
  ].every(f => f in gv), `missing=${['status','score','unsupported_claim_count','student_to_common_leak_count','invented_student_evaluation_count','invented_next_plan_count','invented_technique_count'].filter(f => !(f in gv)).join(',') || '없음'}`);
  ok('grounding.score ≠ parser_confidence',        gv.score !== meta.parser_confidence,                `grounding.score=${gv.score} parser=${meta.parser_confidence}`);
}

console.log('\n════ 테스트 완료 ════\n');
