/**
 * test-ai-v2-grounding.ts — V2 Normalized Scoring + Grounding Validation 테스트
 * 대상: https://swimnote-api.onrender.com (Render production)
 *
 * 검증:
 *   1. "자유형" top_score 계산식 (strokeMatch+focusMatch+conceptOverlap+observationMatch, max 3.0)
 *   2. grounding_validation: parser_confidence 미사용, GPT 출력 실제 분석
 *   3. TOP_K_USAGE=1 → template_ids 최대 1개
 *   4. candidate_ids vs used template_ids 분리
 */

import jwt from 'jsonwebtoken';
import https from 'https';

const RENDER_BASE = 'https://swimnote-api.onrender.com';
const JWT_SECRET  = process.env.JWT_SECRET!;

// integration-test.ts에서 사용하는 실제 pool/user ID
const POOL_ID   = 'pool_1775118427405_xs80lcdmo';
const USER_ID   = 'user_1775118427405_ey2qbn6is';
const CLASS_ID  = 'class_test_v2';

(async () => {
  const JWT_TOKEN = jwt.sign(
    { userId: USER_ID, role: 'pool_admin', poolId: POOL_ID, tv: 1 },
    JWT_SECRET,
    { expiresIn: '2h' },
  );

  console.log(`pool_id:   ${POOL_ID}`);
  console.log(`user_id:   ${USER_ID}`);
  console.log(`token(50): ${JWT_TOKEN.slice(0, 50)}...`);

  // ── HTTP helper ─────────────────────────────────────────────────────────────

  async function post(path: string, body: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request({
        hostname: 'swimnote-api.onrender.com',
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization':  `Bearer ${JWT_TOKEN}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function makeReq(text: string, students: { ref: string; name: string }[] = []) {
    return {
      contract_version: '1.0',
      request_id: `tv2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      schema_version: '1.0',
      feature: 'teacher_diary',
      input: { text },
      context: {
        pool_id:      POOL_ID,
        class_id:     CLASS_ID,
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
  // TEST A — "자유형" (영법 단독)
  // 예상: top_score <= 3.0, strokeMatch=1, focusMatch=0, conceptOverlap ∈ [0,1]
  //       영법 단독 score=1.0 < USAGE_MIN_SCORE=1.40 → INPUT_ONLY
  //       (conceptOverlap≥0.30 충족 시 TEMPLATE_ASSISTED, score=2.0)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('TEST A: "자유형" (영법 단독)');
  console.log('━'.repeat(60));

  const resA = await post('/api/v1/teacher-diary/generate', makeReq('자유형'));

  if (resA.status === 'failed') {
    console.error('  ❌ API ERROR:', JSON.stringify(resA.error));
  } else {
    const meta = resA.meta ?? {};
    const gv   = meta.grounding_validation ?? {};
    const bd   = meta.top_breakdown;
    const result = resA.result ?? {};

    console.log(`  parser_confidence:        ${meta.parser_confidence}`);
    console.log(`  generation_mode:          ${meta.generation_mode}`);
    console.log(`  top_score:                ${meta.top_score}`);
    console.log(`  top_breakdown:            ${JSON.stringify(bd)}`);
    console.log(`  template_candidate_count: ${meta.template_candidate_count}`);
    console.log(`  template_used_count:      ${meta.template_used_count}`);
    console.log(`  template_ids:             ${JSON.stringify(meta.template_ids)}`);
    console.log(`  grounding_validation:     ${JSON.stringify(gv)}`);
    console.log(`  common (80자):            "${(result.common ?? '').slice(0, 80)}"`);
    console.log(`  students 수:              ${(result.students ?? []).length}`);

    console.log('\n  [검증]');
    ok('top_score <= 3.0 (정규화 — 이전 10+ 버그 수정)',       meta.top_score <= 3.0,                                        `top_score=${meta.top_score}`);
    ok('strokeMatch <= 1 (중복 합산 금지)',                     !bd || bd.strokeMatch <= 1,                                   `strokeMatch=${bd?.strokeMatch}`);
    ok('conceptOverlap ∈ [0,1]',                               !bd || (bd.conceptOverlap >= 0 && bd.conceptOverlap <= 1),    `conceptOverlap=${bd?.conceptOverlap}`);
    ok('template_ids 최대 1개 (TOP_K_USAGE=1)',                  (meta.template_ids ?? []).length <= 1,                       `len=${(meta.template_ids ?? []).length}`);
    ok('grounding unsupported_claim_count 필드 존재',           typeof gv.unsupported_claim_count === 'number',               `count=${gv.unsupported_claim_count}`);
    ok('grounding invented_technique_count 필드 존재',          typeof gv.invented_technique_count === 'number',              `count=${gv.invented_technique_count}`);
    ok('grounding.score ≠ parser_confidence (분리 확인)',       gv.score !== meta.parser_confidence,                          `grounding.score=${gv.score} parser_confidence=${meta.parser_confidence}`);

    // 입력에 없는 기술 미생성 확인
    const commonText = result.common ?? '';
    const uninputTechniques = ['호흡', '자세', '턴', '스트로크'].filter(k => commonText.includes(k) && !'자유형'.includes(k));
    ok('입력 미언급 기술 common 미포함 (호흡/자세/턴/스트로크)',  uninputTechniques.length === 0,                               `found=${uninputTechniques.join(',') || '없음'}`);

    // generation_mode에 따른 검증
    if (meta.generation_mode === 'INPUT_ONLY') {
      console.log(`\n  ℹ️  영법 단독 → INPUT_ONLY (top_score=${meta.top_score} < USAGE_MIN_SCORE=1.40)`);
      ok('top_score < 1.40 (USAGE_MIN_SCORE 미달로 INPUT_ONLY)',  meta.top_score < 1.40 || meta.template_candidate_count === 0, `score=${meta.top_score}`);
    } else {
      console.log(`\n  ℹ️  TEMPLATE_ASSISTED (template_text에 '자유형' 포함, conceptOverlap >= 0.30)`);
      ok('top_score >= 1.40 (USAGE_MIN_SCORE 통과)',              meta.top_score >= 1.40,                                      `score=${meta.top_score}`);
      ok('conceptOverlap >= 0.30 (text 기반 후보 필터 통과)',     (bd?.conceptOverlap ?? 0) >= 0.30,                           `conceptOverlap=${bd?.conceptOverlap}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST B — "태웅 자유형 발차기 무릎 많이 굽힘"
  // 예상: strokeMatch=1, focusMatch=1, observationMatch=1, score>=1.40 → TEMPLATE_ASSISTED
  //       태웅 common 미포함, grounding leak_count=0, evaluation/next_plan=0
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('TEST B: "태웅 자유형 발차기 무릎 많이 굽힘"');
  console.log('━'.repeat(60));

  const resB = await post('/api/v1/teacher-diary/generate',
    makeReq('태웅 자유형 발차기 무릎 많이 굽힘', [{ ref: 's1', name: '태웅' }]));

  if (resB.status === 'failed') {
    console.error('  ❌ API ERROR:', JSON.stringify(resB.error));
  } else {
    const meta = resB.meta ?? {};
    const gv   = meta.grounding_validation ?? {};
    const bd   = meta.top_breakdown;
    const result = resB.result ?? {};

    console.log(`  parser_confidence:     ${meta.parser_confidence}`);
    console.log(`  generation_mode:       ${meta.generation_mode}`);
    console.log(`  top_score:             ${meta.top_score}`);
    console.log(`  top_breakdown:         ${JSON.stringify(bd)}`);
    console.log(`  template_ids:          ${JSON.stringify(meta.template_ids)}`);
    console.log(`  grounding_validation:  ${JSON.stringify(gv)}`);
    console.log(`  common (80자):         "${(result.common ?? '').slice(0, 80)}"`);
    console.log(`  students:              ${JSON.stringify(result.students ?? [])}`);

    console.log('\n  [검증]');
    ok('top_score <= 3.0',                                        meta.top_score <= 3.0,                                `score=${meta.top_score}`);
    ok('strokeMatch=1 (자유형)',                                   bd?.strokeMatch === 1,                                `strokeMatch=${bd?.strokeMatch}`);
    ok('focusMatch=1 (발차기)',                                    bd?.focusMatch === 1,                                 `focusMatch=${bd?.focusMatch}`);
    ok('observationMatch=1 (무릎/굽힘)',                           bd?.observationMatch === 1,                           `observationMatch=${bd?.observationMatch}`);
    ok('template_ids 최대 1개',                                    (meta.template_ids ?? []).length <= 1,                `len=${(meta.template_ids ?? []).length}`);
    ok('student_to_common_leak_count=0 (태웅→common 금지)',        gv.student_to_common_leak_count === 0,                `leak=${gv.student_to_common_leak_count}`);
    ok('invented_next_plan_count=0',                               gv.invented_next_plan_count === 0,                    `count=${gv.invented_next_plan_count}`);
    ok('invented_student_evaluation_count=0',                      gv.invented_student_evaluation_count === 0,           `count=${gv.invented_student_evaluation_count}`);
    ok('태웅 이름이 common에 미포함',                              !(result.common ?? '').includes('태웅'),              `common 확인`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST C — "자유형 발차기" (candidate vs used ID 분리)
  // 예상: template_ids 최대 1개, candidate_ids에 used ID 포함, dt_ 형식
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n' + '━'.repeat(60));
  console.log('TEST C: "자유형 발차기" (candidate vs used 분리)');
  console.log('━'.repeat(60));

  const resC = await post('/api/v1/teacher-diary/generate', makeReq('자유형 발차기'));

  if (resC.status === 'failed') {
    console.error('  ❌ API ERROR:', JSON.stringify(resC.error));
  } else {
    const meta = resC.meta ?? {};
    const gv   = meta.grounding_validation ?? {};
    const bd   = meta.top_breakdown;
    const cids = meta.template_candidate_ids ?? [];
    const uids = meta.template_ids ?? [];
    const result = resC.result ?? {};

    console.log(`  parser_confidence:        ${meta.parser_confidence}`);
    console.log(`  generation_mode:          ${meta.generation_mode}`);
    console.log(`  top_score:                ${meta.top_score}`);
    console.log(`  top_breakdown:            ${JSON.stringify(bd)}`);
    console.log(`  template_candidate_count: ${meta.template_candidate_count}`);
    console.log(`  template_used_count:      ${meta.template_used_count}`);
    console.log(`  candidate_ids (${cids.length}개):  ${cids.slice(0, 3).join(', ')}${cids.length > 3 ? ' ...' : ''}`);
    console.log(`  template_ids:             ${JSON.stringify(uids)}`);
    console.log(`  grounding_validation:     ${JSON.stringify(gv)}`);
    console.log(`  common (80자):            "${(result.common ?? '').slice(0, 80)}"`);

    console.log('\n  [검증]');
    ok('top_score <= 3.0',                                        meta.top_score <= 3.0,                               `score=${meta.top_score}`);
    ok('template_ids 최대 1개 (TOP_K_USAGE=1)',                   uids.length <= 1,                                    `len=${uids.length}`);
    ok('template_candidate_ids와 template_ids 별도 필드',         Array.isArray(cids) && Array.isArray(uids),          `cand=${cids.length} used=${uids.length}`);

    if (uids.length > 0) {
      ok('used ID가 candidate_ids에 포함',                        cids.includes(uids[0]),                              `id=${uids[0]}`);
      ok('template_ids는 실제 DB ID (dt_ 형식)',                  (uids[0] as string).startsWith('dt_'),               `id=${uids[0]}`);
    } else {
      console.log('  ℹ️  TEMPLATE_ASSISTED 아님 → template_ids=[] (USAGE_MIN_SCORE 미달 또는 candidate 없음)');
    }

    const reqFields = ['status', 'score', 'unsupported_claim_count', 'student_to_common_leak_count',
      'invented_student_evaluation_count', 'invented_next_plan_count', 'invented_technique_count'];
    ok('grounding_validation 전체 필드 존재',
      reqFields.every(f => f in gv),
      `missing=${reqFields.filter(f => !(f in gv)).join(',') || '없음'}`);
    ok('grounding.score ≠ parser_confidence (분리 확인)',
      gv.score !== meta.parser_confidence,
      `grounding.score=${gv.score} parser_confidence=${meta.parser_confidence}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('테스트 완료');
  console.log('═'.repeat(60) + '\n');
})();
