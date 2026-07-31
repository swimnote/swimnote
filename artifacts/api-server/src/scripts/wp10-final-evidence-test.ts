/**
 * wp10-final-evidence-test.ts
 * WP10 최종 증거 재현 감사 스크립트
 *
 * 목적: production auth/login, auth/me 재현 + DB INSERT/SELECT/DELETE 증거 수집
 * 대상: https://swimnote.kr (production)
 * 비밀번호·JWT 원문 출력 금지
 */
import { superAdminDb } from '@workspace/db';
import { sql }          from 'drizzle-orm';
import { hashPassword } from '../lib/auth.js';

const BASE          = 'https://swimnote.kr';
const WP10_POOL_ID  = 'wp10_evid_pool_20260729';
const WP10_USER_ID  = 'wp10_evid_teacher_20260729';
const WP10_EMAIL    = 'wp10evidence@swimnote.test';
const WP10_PASSWORD = 'Wp10Evid_temp2026!';

function ts(): string {
  return new Date().toISOString();
}

function ev(label: string, val: unknown): void {
  const s = typeof val === 'string' ? val : JSON.stringify(val);
  process.stdout.write(`[EVIDENCE] ${label}: ${s}\n`);
}

async function dbSelect(id: string): Promise<{ exists: boolean; role?: string; created_at?: string }> {
  const rows = await superAdminDb.execute(
    sql`SELECT id, role, created_at FROM users WHERE id = ${id} LIMIT 1`
  );
  const r = (rows as any).rows ?? rows;
  if (!r || r.length === 0) return { exists: false };
  return { exists: true, role: r[0].role, created_at: r[0].created_at?.toISOString?.() ?? String(r[0].created_at) };
}

async function cleanup(): Promise<void> {
  await superAdminDb.execute(sql`DELETE FROM users           WHERE id = ${WP10_USER_ID}`);
  await superAdminDb.execute(sql`DELETE FROM swimming_pools  WHERE id = ${WP10_POOL_ID}`);
}

async function run(): Promise<void> {
  ev('SCRIPT_START_UTC',     ts());
  ev('BASE_URL',             BASE);
  ev('TEST_USER_ID',         WP10_USER_ID);
  ev('TEST_POOL_ID',         WP10_POOL_ID);
  ev('TEST_EMAIL',           WP10_EMAIL);

  // ── 전처리 cleanup (이전 실행 잔재 제거) ────────────────────────────────
  await cleanup();

  // ── A. INSERT 전 SELECT ─────────────────────────────────────────────────
  const beforeInsert = await dbSelect(WP10_USER_ID);
  ev('A_before_insert_record_exists', beforeInsert.exists);  // 기대: false

  if (beforeInsert.exists) {
    process.stderr.write(`[EVIDENCE] ERROR: test user already exists before INSERT\n`);
    process.exit(1);
  }

  // ── INSERT ──────────────────────────────────────────────────────────────
  ev('INSERT_START_UTC', ts());

  await superAdminDb.execute(sql`
    INSERT INTO swimming_pools (id, name, address, phone, owner_name, owner_email)
    VALUES (${WP10_POOL_ID}, 'WP10증거수영장', 'WP10주소', '000-0000-0000', 'WP10오너', ${WP10_EMAIL})
    ON CONFLICT DO NOTHING
  `);

  const pwHash = await hashPassword(WP10_PASSWORD);
  await superAdminDb.execute(sql`
    INSERT INTO users (
      id, email, password_hash, name, phone, role,
      swimming_pool_id, is_activated, is_admin_self_teacher, phone_verified
    ) VALUES (
      ${WP10_USER_ID}, ${WP10_EMAIL}, ${pwHash},
      'WP10증거강사', '010-8888-0000', 'teacher',
      ${WP10_POOL_ID}, true, false, false
    ) ON CONFLICT DO NOTHING
  `);

  ev('INSERT_END_UTC', ts());

  // ── A. INSERT 후 SELECT ─────────────────────────────────────────────────
  const afterInsert = await dbSelect(WP10_USER_ID);
  ev('A_after_insert_record_exists', afterInsert.exists);    // 기대: true
  ev('A_after_insert_test_user_id',  WP10_USER_ID);
  ev('A_after_insert_role',          afterInsert.role ?? 'null');
  ev('A_after_insert_created_at',    afterInsert.created_at ?? 'null');

  if (!afterInsert.exists) {
    process.stderr.write(`[EVIDENCE] ERROR: INSERT failed — record not found after insert\n`);
    process.exit(1);
  }

  // ── B. POST /api/auth/login ─────────────────────────────────────────────
  const loginUrl    = `${BASE}/api/auth/login`;
  const loginStart  = Date.now();
  const loginStartT = ts();

  ev('B_login_url',          loginUrl);
  ev('B_login_method',       'POST');
  ev('B_login_request_start', loginStartT);

  const loginRes = await fetch(loginUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: WP10_EMAIL, password: WP10_PASSWORD }),
  });

  const loginDurationMs = Date.now() - loginStart;
  const loginEndT       = ts();
  const loginCT         = loginRes.headers.get('content-type') ?? 'null';
  const loginBody       = await loginRes.json();

  ev('B_login_status',         loginRes.status);
  ev('B_login_content_type',   loginCT);
  ev('B_login_success',        loginBody.success ?? false);
  ev('B_login_duration_ms',    loginDurationMs);
  ev('B_login_request_end',    loginEndT);
  ev('B_login_token_present',  !!(loginBody.token));
  // 토큰 원문 출력하지 않음

  if (!loginRes.ok || !loginBody.token) {
    process.stderr.write(`[EVIDENCE] ERROR: auth/login failed status=${loginRes.status} success=${loginBody.success}\n`);
    await cleanup();
    process.exit(1);
  }

  const token = loginBody.token as string;

  // ── C. GET /api/auth/me ─────────────────────────────────────────────────
  const meUrl    = `${BASE}/api/auth/me`;
  const meStart  = Date.now();
  const meStartT = ts();

  ev('C_me_url',           meUrl);
  ev('C_me_method',        'GET');
  ev('C_me_request_start', meStartT);

  const meRes = await fetch(meUrl, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  const meDurationMs = Date.now() - meStart;
  const meEndT       = ts();
  const meCT         = meRes.headers.get('content-type') ?? 'null';
  const meBody       = await meRes.json();

  const returnedUserId = meBody?.user?.id ?? meBody?.id ?? 'null';
  const returnedRole   = meBody?.user?.role ?? meBody?.role ?? 'null';

  ev('C_me_status',        meRes.status);
  ev('C_me_content_type',  meCT);
  ev('C_me_duration_ms',   meDurationMs);
  ev('C_me_request_end',   meEndT);
  ev('C_me_returned_user_id_matches', returnedUserId === WP10_USER_ID);
  ev('C_me_returned_role',            returnedRole);
  // user_id 원문: 테스트 계정 ID는 개인정보가 아니므로 출력
  ev('C_me_returned_user_id',         returnedUserId);

  if (!meRes.ok) {
    process.stderr.write(`[EVIDENCE] ERROR: auth/me failed status=${meRes.status}\n`);
    await cleanup();
    process.exit(1);
  }

  // ── D. Cleanup ──────────────────────────────────────────────────────────
  ev('D_cleanup_start_utc', ts());
  await cleanup();
  ev('D_cleanup_end_utc', ts());

  // ── D. Cleanup 후 SELECT ────────────────────────────────────────────────
  const afterCleanup = await dbSelect(WP10_USER_ID);
  ev('D_after_cleanup_record_exists', afterCleanup.exists);  // 기대: false
  ev('D_cleanup_success',             !afterCleanup.exists);

  if (afterCleanup.exists) {
    process.stderr.write(`[EVIDENCE] ERROR: cleanup failed — record still exists\n`);
    process.exit(1);
  }

  ev('SCRIPT_END_UTC', ts());
  ev('ALL_CHECKS_PASSED', true);
  process.exit(0);
}

run().catch(e => {
  process.stderr.write(`[EVIDENCE] FATAL: ${e.message}\n`);
  process.exit(1);
});
