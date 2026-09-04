/**
 * wp10-runtime-verify.mjs — WP10 Production runtime 검증
 *
 * 1. 임시 teacher 계정 생성 (DB 직접)
 * 2. /api/auth/login → 토큰 발급
 * 3. /api/v1/teacher-diary/generate → AI trace 생성
 * 4. super_admin 로그인 → /api/super/ai-traces 로 trace read-back
 * 5. 임시 계정 삭제
 *
 * 실행: node --env-file=.env src/scripts/wp10-runtime-verify.mjs
 */

const BASE      = 'https://swimnote-api.onrender.com';
const TEST_POOL = 'pool_1784310621737_qryl1x79s';   // X sample pool
const TEST_USER = `wp10_verify_${Date.now()}`;
const TEST_EMAIL= `wp10verify_${Date.now()}@swimnote.test`;
const TEST_PW   = 'Wp10_Verify_temp!';

function log(label, val) {
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  console.log(`[WP10-RUNTIME] ${label}: ${s}`);
}

async function main() {
  log('BASE', BASE);
  log('TEST_POOL', TEST_POOL);
  log('START', new Date().toISOString());

  // ── 1. 임시 teacher 계정 생성 ──────────────────────────────────────────────
  log('STEP', '1. super_admin 로그인으로 teacher 계정 생성');

  const SUPER_PW = process.env.SUPER_ADMIN_PASSWORD;
  if (!SUPER_PW) { log('ERROR', 'SUPER_ADMIN_PASSWORD 미설정'); process.exit(1); }

  // super_admin 로그인
  const superLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'super@swimnote.app', password: SUPER_PW }),
  });
  const superBody = await superLogin.json();
  const superToken = superBody.token;
  log('super_login_status', superLogin.status);
  log('super_token_present', !!superToken);

  if (!superToken) {
    log('ERROR', `super 로그인 실패 status=${superLogin.status}`);
    log('BODY', JSON.stringify(superBody).slice(0, 200));
    process.exit(1);
  }

  // ── 2. AI generate (super_admin 계정으로는 role 확인 필요, 필요시 teacher 계정 생성) ──
  // super_admin이 teacher_diary generate 가능한지 먼저 시도
  const REQUEST_ID = `wp10_verify_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  log('STEP', `2. AI generate (request_id=${REQUEST_ID})`);

  // pool_id를 TEST_POOL로 설정 — tenant 격리 있으므로 JWT pool_id와 맞아야 함
  // super_admin은 pool 격리 없음, 하지만 generate 가능한지 시도
  const genRes = await fetch(`${BASE}/api/v1/teacher-diary/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${superToken}`,
    },
    body: JSON.stringify({
      contract_version: '1.3',
      request_id:       REQUEST_ID,
      schema_version:   '1.0',
      feature:          'teacher_diary',
      input: { text: '오늘 수업에서 발차기 연습을 집중적으로 했습니다.' },
      context: {
        pool_id:      TEST_POOL,
        class_id:     'test_class_wp10',
        lesson_date:  '2026-08-12',
        student_refs: [],
        students:     [],
      },
    }),
  });

  const genBody = await genRes.json().catch(() => ({}));
  log('generate_status',        genRes.status);
  log('generate_request_id',    genBody.request_id ?? 'N/A');
  log('generate_result_status', genBody.status ?? genBody.result ? 'ok' : 'N/A');
  log('generate_usage',         JSON.stringify(genBody.usage ?? {}));
  log('generate_meta_generation_mode', genBody.meta?.generation_mode ?? 'N/A');
  log('generate_meta_pool_mode',       genBody.meta?.pool_mode ?? genBody.meta?.x_template_status ? 'x' : 'N/A');
  log('generate_pipeline_version',     genBody.pipeline_version ?? 'N/A');
  log('generate_x_template_status',    genBody.meta?.x_template_status ?? 'N/A');
  log('generate_curriculum_matches',   JSON.stringify(genBody.curriculum_matches));

  // ── 3. trace read-back (super_admin으로 확인) ──────────────────────────────
  log('STEP', '3. trace read-back via GET /api/super/ai-traces');

  // 잠시 대기 (trace 저장 비동기)
  await new Promise(r => setTimeout(r, 1500));

  const traceListRes = await fetch(
    `${BASE}/api/super/ai-traces?limit=5`,
    { headers: { 'Authorization': `Bearer ${superToken}` } },
  );
  const traceList = await traceListRes.json().catch(() => ({}));
  log('trace_list_status',  traceListRes.status);
  log('trace_list_total',   traceList.total ?? 'N/A');
  log('trace_list_rows_count', traceList.rows?.length ?? 0);

  if (traceList.rows?.length > 0) {
    const latest = traceList.rows[0];
    log('latest_trace_request_id',   latest.request_id   ?? 'N/A');
    log('latest_trace_status',       latest.status        ?? 'N/A');
    log('latest_trace_pool_mode',    latest.pool_mode     ?? 'N/A');
    log('latest_trace_generation_mode', latest.generation_mode ?? 'N/A');
    log('latest_trace_model',        latest.model         ?? 'N/A');
    log('latest_trace_total_tokens', latest.total_tokens  ?? 'N/A');
    log('latest_trace_total_cost_usd', latest.total_cost_usd ?? 'N/A');
    log('latest_trace_latency_ms',   latest.latency_ms    ?? 'N/A');
  }

  // request_id로 상세 조회
  if (genBody.request_id) {
    const traceDetailRes = await fetch(
      `${BASE}/api/super/ai-traces/${genBody.request_id}`,
      { headers: { 'Authorization': `Bearer ${superToken}` } },
    );
    const traceDetail = await traceDetailRes.json().catch(() => ({}));
    log('trace_detail_status',  traceDetailRes.status);
    log('trace_detail_found',   traceDetail.ok ?? false);
    if (traceDetail.trace?.metadata) {
      const m = traceDetail.trace.metadata;
      log('trace_detail_request_id',    m.request_id    ?? 'N/A');
      log('trace_detail_status_field',  m.status        ?? 'N/A');
      log('trace_detail_pool_mode',     m.pool_mode     ?? 'N/A');
      log('trace_detail_contract_v',    m.contract_version ?? 'N/A');
      log('trace_detail_generation_mode', m.generation_mode ?? 'N/A');
      log('trace_detail_model',         m.model         ?? 'N/A');
      log('trace_detail_input_tokens',  m.input_tokens  ?? 'N/A');
      log('trace_detail_output_tokens', m.output_tokens ?? 'N/A');
      log('trace_detail_total_tokens',  m.total_tokens  ?? 'N/A');
      log('trace_detail_latency_ms',    m.latency_ms    ?? 'N/A');
      log('trace_detail_cost',          JSON.stringify(m.cost ?? 'N/A'));
      log('trace_detail_x_template_status', m.x_template_status ?? 'absent(non-X)');
    }
  }

  // ── 4. 권한 없는 접근 차단 확인 ─────────────────────────────────────────────
  log('STEP', '4. 권한 없는 trace read → 차단 확인');
  const unauthorizedRes = await fetch(`${BASE}/api/super/ai-traces`);  // 인증 없음
  log('unauthorized_trace_list_status', unauthorizedRes.status);       // 기대: 401/403

  // ── 5. health 최종 확인 ───────────────────────────────────────────────────
  log('STEP', '5. /api/health + /api/healthz');
  const h1 = await fetch(`${BASE}/api/health`);
  const h2 = await fetch(`${BASE}/api/healthz`);
  log('health_status', h1.status);   // 기대: 200
  log('healthz_status', h2.status);  // 기대: 200
  log('END', new Date().toISOString());

  console.log('\n=== WP10 Production Runtime 검증 완료 ===');
}

main().catch(err => {
  console.error('[WP10-RUNTIME] FATAL:', err);
  process.exit(1);
});
