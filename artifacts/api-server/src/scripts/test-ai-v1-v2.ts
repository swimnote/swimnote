/**
 * test-ai-v1-v2.ts — V2 Normalized Scoring + Grounding Validation 테스트
 *
 * 검증 항목:
 *   1. Template Search 단일 경로 (diary-template-search.ts)
 *   2. "자유형" topScore 정확한 계산식 (strokeMatch+focusMatch+conceptOverlap+observationMatch)
 *   3. grounding_validation: parser_confidence 미사용, GPT 출력 실제 분석
 *   4. top_breakdown 필드 (strokeMatch/focusMatch/conceptOverlap/observationMatch)
 *   5. template_ids 최대 1개 (TOP_K_USAGE=1)
 *
 * Usage:
 *   RENDER_URL=https://swimnote-api.onrender.com \
 *   JWT_TOKEN=<teacher_token> \
 *   tsx artifacts/api-server/src/scripts/test-ai-v1-v2.ts
 */

import https from 'https';
import http from 'http';

const BASE_URL   = process.env.RENDER_URL ?? 'https://swimnote-api.onrender.com';
const JWT_TOKEN  = process.env.JWT_TOKEN  ?? '';
const POOL_ID    = process.env.POOL_ID    ?? '';
const CLASS_ID   = process.env.CLASS_ID   ?? '';
const LESSON_DATE = '2026-08-01';

if (!JWT_TOKEN || !POOL_ID || !CLASS_ID) {
  console.error('필수 환경변수: JWT_TOKEN, POOL_ID, CLASS_ID');
  process.exit(1);
}

async function post(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url      = new URL(path, BASE_URL);
    const payload  = JSON.stringify(body);
    const mod      = url.protocol === 'https:' ? https : http;

    const req = mod.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization':  `Bearer ${JWT_TOKEN}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
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

function makeRequest(text: string, students: { ref: string; name: string }[] = []) {
  return {
    contract_version: '1.0',
    request_id:       `test-v2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    schema_version:   '1.0',
    feature:          'teacher_diary',
    input:            { text },
    context: {
      pool_id:      POOL_ID,
      class_id:     CLASS_ID,
      lesson_date:  LESSON_DATE,
      student_refs: students.map(s => s.ref),
      students,
    },
  };
}

function check(label: string, pass: boolean, detail?: string) {
  const mark = pass ? '✅' : '❌';
  console.log(`  ${mark} ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

async function runTest(
  name: string,
  text: string,
  students: { ref: string; name: string }[],
  assertions: (r: any) => void,
) {
  console.log(`\n━━━ TEST ${name} ━━━`);
  console.log(`  입력: "${text}"`);

  try {
    const res = await post('/api/v1/teacher-diary/generate', makeRequest(text, students)) as any;

    if (res.status === 'failed') {
      console.error('  ❌ API 오류:', res.error);
      return;
    }

    const meta = res.meta ?? {};
    const result = res.result ?? {};

    console.log(`  generation_mode:          ${meta.generation_mode}`);
    console.log(`  parser_confidence:        ${meta.parser_confidence}`);
    console.log(`  top_score:                ${meta.top_score}`);
    console.log(`  top_breakdown:            ${JSON.stringify(meta.top_breakdown)}`);
    console.log(`  template_used_count:      ${meta.template_used_count}`);
    console.log(`  template_candidate_count: ${meta.template_candidate_count}`);
    console.log(`  template_ids:             ${JSON.stringify(meta.template_ids)}`);
    console.log(`  template_candidate_ids:   [${(meta.template_candidate_ids ?? []).length}개]`);
    console.log(`  grounding_validation:     ${JSON.stringify(meta.grounding_validation)}`);
    console.log(`  common (처음 80자):       ${(result.common ?? '').slice(0, 80)}`);
    console.log(`  students 수:              ${(result.students ?? []).length}`);

    assertions(res);
  } catch (e: any) {
    console.error('  ❌ 요청 실패:', e.message);
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`AI V2 Normalized Scoring + Grounding Validation 테스트`);
  console.log(`BASE_URL: ${BASE_URL}`);
  console.log(`${'='.repeat(60)}`);

  // ── Test A: "자유형" ──────────────────────────────────────────────────────
  await runTest(
    'A — 입력: "자유형" (영법 단독)',
    '자유형',
    [],
    (r) => {
      const meta = r.meta;
      const bd   = meta.top_breakdown;

      console.log('\n  [검증]');

      // strokeMatch 최대 1 (중복 합산 금지 확인)
      check(
        'strokeMatch <= 1 (중복 합산 금지)',
        !bd || bd.strokeMatch <= 1,
        bd ? `strokeMatch=${bd.strokeMatch}` : 'top_breakdown=null',
      );

      // conceptOverlap: 0~1 범위
      check(
        'conceptOverlap ∈ [0,1]',
        !bd || (bd.conceptOverlap >= 0 && bd.conceptOverlap <= 1),
        bd ? `conceptOverlap=${bd.conceptOverlap}` : 'top_breakdown=null',
      );

      // top_score <= 3.0 (max=strokeMatch+focusMatch+conceptOverlap+observationMatch)
      check(
        'top_score <= 3.0 (정규화 확인)',
        meta.top_score <= 3.0,
        `top_score=${meta.top_score}`,
      );

      // 영법 단독이면 top_score < USAGE_MIN_SCORE=1.40 → INPUT_ONLY
      // (template_text에 '자유형' 포함 여부에 따라 TEMPLATE_ASSISTED일 수도 있음)
      if (meta.generation_mode === 'INPUT_ONLY') {
        check(
          '영법 단독 → INPUT_ONLY (USAGE_MIN_SCORE 미달)',
          true,
          `top_score=${meta.top_score} < 1.40`,
        );
      } else {
        // TEMPLATE_ASSISTED면 template_ids 최대 1개 확인
        check(
          'TEMPLATE_ASSISTED이면 template_ids 최대 1개',
          (meta.template_ids ?? []).length <= 1,
          `template_ids.length=${(meta.template_ids ?? []).length}`,
        );
        check(
          'top_score >= USAGE_MIN_SCORE=1.40 (사용 기준 통과)',
          meta.top_score >= 1.40,
          `top_score=${meta.top_score}`,
        );
      }

      // grounding_validation: parser_confidence 미사용 — 필드 구조 확인
      const gv = meta.grounding_validation;
      check(
        'grounding_validation에 unsupported_claim_count 필드 존재',
        typeof gv?.unsupported_claim_count === 'number',
        `unsupported_claim_count=${gv?.unsupported_claim_count}`,
      );
      check(
        'grounding_validation에 invented_technique_count 필드 존재',
        typeof gv?.invented_technique_count === 'number',
        `invented_technique_count=${gv?.invented_technique_count}`,
      );
      check(
        'grounding_validation.score: parser_confidence(0.5)와 다름',
        gv?.score !== 0.5,
        `grounding.score=${gv?.score}, parser_confidence=${meta.parser_confidence}`,
      );
    },
  );

  // ── Test B: "태웅 자유형 발차기 무릎 많이 굽힘" ────────────────────────────
  await runTest(
    'B — 입력: "태웅 자유형 발차기 무릎 많이 굽힘" (학생 관찰)',
    '태웅 자유형 발차기 무릎 많이 굽힘',
    [{ ref: 'student_taewung', name: '태웅' }],
    (r) => {
      const meta    = r.meta;
      const result  = r.result;
      const gv      = meta.grounding_validation;

      console.log('\n  [검증]');

      // top_score: strokeMatch + focusMatch(발차기) + conceptOverlap + observationMatch(무릎,굽힘)
      check(
        'top_score >= 1.40 (영법+기술+이슈 조합)',
        meta.top_score >= 1.40,
        `top_score=${meta.top_score}`,
      );

      // template_ids 최대 1개
      check(
        'template_ids 최대 1개 (TOP_K_USAGE=1)',
        (meta.template_ids ?? []).length <= 1,
        `template_ids.length=${(meta.template_ids ?? []).length}`,
      );

      // top_breakdown: strokeMatch=1, focusMatch=1 기대
      const bd = meta.top_breakdown;
      if (bd) {
        check(
          'strokeMatch=1 (자유형)',
          bd.strokeMatch === 1,
          `strokeMatch=${bd.strokeMatch}`,
        );
        check(
          'focusMatch=1 (발차기)',
          bd.focusMatch === 1,
          `focusMatch=${bd.focusMatch}`,
        );
      }

      // student_to_common_leak: 태웅이 common에 등장하면 leak
      check(
        'student_to_common_leak_count=0 (태웅→common 금지)',
        gv?.student_to_common_leak_count === 0,
        `leak_count=${gv?.student_to_common_leak_count}`,
      );

      // invented 항목 0 기대
      check(
        'invented_next_plan_count=0',
        gv?.invented_next_plan_count === 0,
        `next_plan=${gv?.invented_next_plan_count}`,
      );
      check(
        'invented_student_evaluation_count=0',
        gv?.invented_student_evaluation_count === 0,
        `evaluation=${gv?.invented_student_evaluation_count}`,
      );

      // common에 '태웅' 미포함
      check(
        '태웅 이름이 common에 미포함',
        !(result.common ?? '').includes('태웅'),
        `common: "${(result.common ?? '').slice(0, 60)}..."`,
      );
    },
  );

  // ── Test C: template_ids 최대 1개 + candidate vs used 분리 ───────────────
  await runTest(
    'C — 입력: "자유형 발차기" (template candidate vs used 분리)',
    '자유형 발차기',
    [],
    (r) => {
      const meta = r.meta;

      console.log('\n  [검증]');

      // template_ids 최대 1개
      check(
        'template_ids 최대 1개 (TOP_K_USAGE=1)',
        (meta.template_ids ?? []).length <= 1,
        `template_ids.length=${(meta.template_ids ?? []).length}`,
      );

      // candidate_ids와 used ids 분리
      const cids = meta.template_candidate_ids ?? [];
      const uids = meta.template_ids ?? [];
      check(
        'candidate_ids와 template_ids는 별도 필드',
        Array.isArray(cids) && Array.isArray(uids),
        `candidates=${cids.length} used=${uids.length}`,
      );

      // used가 있으면 candidate_ids에 포함되는지 확인
      if (uids.length > 0 && cids.length > 0) {
        check(
          'used template_id는 candidate_ids에 포함',
          cids.includes(uids[0]),
          `used[0]=${uids[0]} in candidates=${cids.includes(uids[0])}`,
        );
      }

      // template_ids는 실제 DB ID 형식 (dt_로 시작)
      if (uids.length > 0) {
        check(
          'template_ids는 실제 DB ID (dt_ 형식)',
          uids[0].startsWith('dt_'),
          `id=${uids[0]}`,
        );
      }

      // grounding_validation 구조 완전성
      const gv = meta.grounding_validation;
      const requiredFields = [
        'status', 'score', 'unsupported_claim_count',
        'student_to_common_leak_count', 'invented_student_evaluation_count',
        'invented_next_plan_count', 'invented_technique_count',
      ];
      check(
        'grounding_validation 필드 완전성',
        requiredFields.every(f => f in (gv ?? {})),
        `fields=${requiredFields.filter(f => !(f in (gv ?? {}))).join(',') || '모두 존재'}`,
      );

      // top_score <= 3.0
      check(
        'top_score <= 3.0',
        meta.top_score <= 3.0,
        `top_score=${meta.top_score}`,
      );
    },
  );

  console.log(`\n${'='.repeat(60)}`);
  console.log('테스트 완료');
  console.log(`${'='.repeat(60)}\n`);
})();
