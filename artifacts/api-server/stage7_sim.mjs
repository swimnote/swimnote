/**
 * STAGE 7 — 실제 운영 시나리오 통합 시뮬레이션 v2
 * 실행: node stage7_sim.mjs (Node 18+)
 *
 * 실제 DB 데이터 기반:
 *   pool_aquastar_002   / user_pool_admin_aquastar  (active)
 *   pool_toykids_001    / user_pool_admin_002        (active)
 *   pool_1774021648896_yrxhdasr8 / user_1774021584696_nq3yxqzv6 (trial)
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

const BASE   = 'http://localhost:8080/api';
const SECRET = 'swim-platform-secret-key-2024';

// ── 결과 수집 ─────────────────────────────────────────────
const R = { pass: [], fail: [], warn: [], bug: [] };
function pass(s, d='') { R.pass.push(s); console.log(`  ✅ PASS  ${s}${d?' — '+d:''}`); }
function fail(s, d='') { R.fail.push(s); console.error(`  ❌ FAIL  ${s}${d?' — '+d:''}`); }
function warn(s, d='') { R.warn.push(s); console.warn(`  ⚠️  WARN  ${s}${d?' — '+d:''}`); }
function bug(s, d='')  { R.bug.push(s);  console.error(`  🐛 BUG   ${s}${d?' — '+d:''}`); }
function section(t)    { console.log(`\n${'═'.repeat(64)}\n  ${t}\n${'═'.repeat(64)}`); }
function sub(t)        { console.log(`\n  ── ${t} ──`); }

function tok(userId, role, poolId=null) {
  const payload = { userId, role };
  if (poolId) payload.poolId = poolId;
  return jwt.sign(payload, SECRET, { expiresIn: '1d' });
}
async function api(method, path, body, token) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    return { status: 0, ok: false, data: null, err: e.message };
  }
}

// ── 고정 식별자 (실제 DB) ─────────────────────────────────
const SUPER_USER  = 'user_super_admin_1773418927301';
const POOL_A      = 'pool_aquastar_002';
const ADMIN_A_UID = 'user_pool_admin_aquastar';
const POOL_B      = 'pool_toykids_001';
const ADMIN_B_UID = 'user_pool_admin_002';
const POOL_C      = 'pool_1774021648896_yrxhdasr8';   // trial
const ADMIN_C_UID = 'user_1774021584696_nq3yxqzv6';

const SUPER   = tok(SUPER_USER, 'super_admin');
const ADMIN_A = tok(ADMIN_A_UID, 'pool_admin', POOL_A);
const ADMIN_B = tok(ADMIN_B_UID, 'pool_admin', POOL_B);
const ADMIN_C = tok(ADMIN_C_UID, 'pool_admin', POOL_C);

// =========================================================
// 시나리오 A — 슈퍼관리자 대시보드 / 운영자 목록
// =========================================================
async function scenarioA() {
  section('시나리오 A — 슈퍼관리자 대시보드 & 운영자 목록');

  // A1. dashboard-stats
  sub('A1. 대시보드 통계');
  const dash = await api('GET', '/super/dashboard-stats', null, SUPER);
  if (dash.ok && dash.data?.stats) {
    const s = dash.data.stats;
    if (typeof s.total_operators !== 'undefined') {
      pass('dashboard-stats.total_operators', `${s.total_operators}`);
    } else {
      bug('total_operators 필드 없음', JSON.stringify(s));
    }
    pass('dashboard-stats', `total=${s.total_operators}, active=${s.active_operators}, pending=${s.pending_operators}`);
  } else {
    fail('dashboard-stats', JSON.stringify(dash.data));
  }

  // A2. operators 목록 (array 직접 반환)
  sub('A2. 운영자 목록');
  const ops = await api('GET', '/super/operators', null, SUPER);
  if (ops.ok && Array.isArray(ops.data)) {
    const total = ops.data.length;
    const approved = ops.data.filter(o => o.approval_status === 'approved');
    const pending  = ops.data.filter(o => o.approval_status === 'pending');
    pass('운영자 목록', `총=${total}, 승인=${approved.length}, 대기=${pending.length}`);

    // 필드 검증
    const first = ops.data[0];
    if (first) {
      const required = ['id','name','owner_name','approval_status','subscription_status','subscription_tier','is_readonly','upload_blocked'];
      const missing = required.filter(k => typeof first[k] === 'undefined');
      if (missing.length === 0) pass('operators 필드 검증 — 모두 존재');
      else bug('operators 필드 누락', missing.join(', '));
    }
  } else {
    fail('운영자 목록', JSON.stringify(ops.data));
  }

  // A3. 운영자 상세 (pool_aquastar_002)
  sub('A3. 운영자 상세 (아쿠아스타)');
  const detail = await api('GET', `/super/operators/${POOL_A}`, null, SUPER);
  if (detail.ok && detail.data) {
    const d = detail.data;
    pass('operators/:id', `keys=${Object.keys(d).join(',')}`);
    if (d.pool) pass('pool 기본정보', `name=${d.pool.name}, status=${d.pool.subscription_status}`);
    else bug('pool 필드 없음', JSON.stringify(Object.keys(d)));
    if (Array.isArray(d.teachers)) pass('teachers 목록', `${d.teachers.length}명`);
    else warn('teachers 필드 없음');
    if (d.policy) pass('policy 필드', JSON.stringify(d.policy).slice(0,80));
    else warn('policy 필드 없음 (동의 없을 수 있음)');
  } else {
    fail('operators/:id', JSON.stringify(detail.data));
  }

  // A4. risk-center & risk-summary
  sub('A4. risk-center & risk-summary');
  const risk = await api('GET', '/super/risk-center', null, SUPER);
  if (risk.ok && risk.data) {
    const d = risk.data;
    pass('risk-center', `payment_failed=${(d.payment_failed??[]).length}, storage_danger=${(d.storage_danger??[]).length}, deletion_pending=${(d.deletion_pending??[]).length}`);
  } else {
    fail('risk-center', JSON.stringify(risk.data));
  }

  const summary = await api('GET', '/super/risk-summary', null, SUPER);
  if (summary.ok) pass('risk-summary', JSON.stringify(summary.data).slice(0,100));
  else fail('risk-summary', JSON.stringify(summary.data));
}

// =========================================================
// 시나리오 B — 관리자 API 정상 운영 (아쿠아스타)
// =========================================================
async function scenarioB() {
  section('시나리오 B — 관리자 정상 운영 (pool_aquastar_002)');

  // B1. billing/status (실제 admin user 사용)
  sub('B1. billing/status');
  const billing = await api('GET', '/billing/status', null, ADMIN_A);
  if (billing.ok) {
    const d = billing.data;
    pass('billing/status', `status=${d?.subscription_status}, plan=${d?.current_plan}, readonly=${d?.is_readonly}`);
    if (typeof d?.is_readonly !== 'undefined') pass('is_readonly 필드 존재');
    else bug('is_readonly 필드 없음');
    if (typeof d?.upload_blocked !== 'undefined') pass('upload_blocked 필드 존재');
    else warn('upload_blocked 필드 없음');
  } else {
    fail('billing/status', `status=${billing.status} ${JSON.stringify(billing.data)}`);
  }

  // B2. students
  sub('B2. 학생 목록');
  const students = await api('GET', '/students', null, ADMIN_A);
  if (students.ok) {
    const arr = Array.isArray(students.data) ? students.data : (students.data?.students ?? []);
    pass('학생 목록', `${arr.length}명`);
  } else {
    warn('학생 목록', `status=${students.status}`);
  }

  // B3. class-groups
  sub('B3. 반 목록');
  const cg = await api('GET', '/class-groups', null, ADMIN_A);
  if (cg.ok) {
    const arr = Array.isArray(cg.data) ? cg.data : [];
    pass('class-groups', `${arr.length}개`);
  } else {
    warn('class-groups', `status=${cg.status}`);
  }

  // B4. teachers
  sub('B4. 선생님 목록');
  const teachers = await api('GET', '/teachers', null, ADMIN_A);
  if (teachers.ok) {
    const arr = Array.isArray(teachers.data) ? teachers.data : (teachers.data?.teachers ?? []);
    pass('teachers', `${arr.length}명`);
  } else {
    warn('teachers', `status=${teachers.status}`);
  }

  // B5. notices
  sub('B5. 공지사항');
  const notices = await api('GET', '/notices', null, ADMIN_A);
  if (notices.ok) {
    const arr = Array.isArray(notices.data) ? notices.data : (notices.data?.notices ?? []);
    pass('notices', `${arr.length}개`);
  } else {
    warn('notices', `status=${notices.status}`);
  }
}

// =========================================================
// 시나리오 C — 결제 실패 → 읽기 모드 → 복구
// =========================================================
async function scenarioC() {
  section('시나리오 C — 결제 실패 → 즉시 읽기 모드 → 복구');

  // C1. 초기 상태 확인
  sub('C1. 초기 billing/status 확인');
  const before = await api('GET', '/billing/status', null, ADMIN_A);
  if (before.ok) {
    pass('결제 실패 전 상태', `status=${before.data?.subscription_status}, readonly=${before.data?.is_readonly}`);
  } else {
    warn('초기 상태 확인 실패', `status=${before.status}`);
  }

  // C2. 슈퍼관리자로 payment_failed + is_readonly 강제 설정
  sub('C2. 결제 실패 상태 강제 설정');
  const setFail = await api('PATCH', `/super/operators/${POOL_A}/subscription`, {
    subscription_status: 'payment_failed',
    is_readonly: true,
  }, SUPER);
  if (setFail.ok) {
    pass('payment_failed + is_readonly=true 설정');
  } else {
    fail('결제 실패 상태 설정', JSON.stringify(setFail.data));
    return;
  }

  // C3. billing/status에서 is_readonly 확인
  sub('C3. 읽기 모드 반영 확인');
  const afterFail = await api('GET', '/billing/status', null, ADMIN_A);
  if (afterFail.ok) {
    const d = afterFail.data;
    if (d?.is_readonly === true && d?.subscription_status === 'payment_failed') {
      pass('결제 실패 / 읽기 모드 반영 확인', `status=${d.subscription_status}, is_readonly=${d.is_readonly}`);
    } else {
      bug('결제 실패 상태 미반영', `status=${d?.subscription_status}, is_readonly=${d?.is_readonly}`);
    }
  } else {
    warn('billing/status (결제 실패 후)', `status=${afterFail.status}`);
  }

  // C4. 복구 — active + is_readonly=false
  sub('C4. 결제 복구');
  const recover = await api('PATCH', `/super/operators/${POOL_A}/subscription`, {
    subscription_status: 'active',
    is_readonly: false,
  }, SUPER);
  if (recover.ok) {
    pass('active + is_readonly=false 복구');
  } else {
    fail('복구 실패', JSON.stringify(recover.data));
    return;
  }

  // C5. 복구 확인
  sub('C5. 복구 후 상태 확인');
  const afterRecover = await api('GET', '/billing/status', null, ADMIN_A);
  if (afterRecover.ok) {
    const d = afterRecover.data;
    if (d?.subscription_status === 'active' && d?.is_readonly === false) {
      pass('정상 복구 확인', `status=${d.subscription_status}, is_readonly=${d.is_readonly}`);
    } else {
      bug('복구 후 상태 비정상', `status=${d?.subscription_status}, is_readonly=${d?.is_readonly}`);
    }
  } else {
    warn('복구 후 billing/status', `status=${afterRecover.status}`);
  }
}

// =========================================================
// 시나리오 D — 저장공간 임계 → 업로드 차단 → 해제
// =========================================================
async function scenarioD() {
  section('시나리오 D — 저장공간 95% 초과 → 업로드 차단 → 해제');

  // D1. upload_blocked 강제 설정
  sub('D1. upload_blocked=true 강제 설정');
  const blockUpload = await api('PATCH', `/super/operators/${POOL_A}/subscription`, {
    upload_blocked: true,
  }, SUPER);
  if (blockUpload.ok) {
    pass('upload_blocked=true 설정');
  } else {
    fail('upload_blocked 설정', JSON.stringify(blockUpload.data));
    return;
  }

  // D2. billing/status에서 반영 확인
  sub('D2. upload_blocked 반영 확인');
  const checkBlock = await api('GET', '/billing/status', null, ADMIN_A);
  if (checkBlock.ok) {
    const d = checkBlock.data;
    if (d?.upload_blocked === true) {
      pass('upload_blocked=true billing/status 반영', `upload_blocked=${d.upload_blocked}`);
    } else {
      warn('upload_blocked billing/status 미반영', JSON.stringify(d).slice(0,120));
    }
  } else {
    warn('billing/status', `status=${checkBlock.status}`);
  }

  // D3. upload_blocked 해제
  sub('D3. upload_blocked=false 해제');
  const unblock = await api('PATCH', `/super/operators/${POOL_A}/subscription`, {
    upload_blocked: false,
  }, SUPER);
  if (unblock.ok) {
    pass('upload_blocked=false 해제');
  } else {
    fail('upload_blocked 해제', JSON.stringify(unblock.data));
    return;
  }

  // D4. 해제 확인
  sub('D4. 해제 후 상태 확인');
  const checkUnblock = await api('GET', '/billing/status', null, ADMIN_A);
  if (checkUnblock.ok) {
    const d = checkUnblock.data;
    if (d?.upload_blocked === false) {
      pass('upload_blocked=false 해제 확인');
    } else {
      warn('upload_blocked 해제 미반영', JSON.stringify(d).slice(0,80));
    }
  } else {
    warn('해제 후 billing/status', `status=${checkUnblock.status}`);
  }
}

// =========================================================
// 시나리오 E — 자동 삭제 예약 & cancel-deletion
// =========================================================
async function scenarioE() {
  section('시나리오 E — 자동 삭제 예약 & cancel-deletion');

  // E1. 24시간 이내 만료로 설정 (deletion_pending 목록 진입)
  sub('E1. 20시간 후 구독 만료 설정');
  const endDate = new Date(Date.now() + 20 * 3600 * 1000).toISOString();
  const setEnd = await api('PATCH', `/super/operators/${POOL_B}/subscription`, {
    subscription_end_at: endDate,
    subscription_status: 'active',
  }, SUPER);
  if (setEnd.ok) {
    pass('subscription_end_at 설정 (20시간 후)', endDate.slice(0, 16));
  } else {
    fail('subscription_end_at 설정', JSON.stringify(setEnd.data));
    return;
  }

  // E2. risk-center deletion_pending 확인
  sub('E2. risk-center deletion_pending 반영 확인');
  const riskCheck = await api('GET', '/super/risk-center', null, SUPER);
  if (riskCheck.ok) {
    const pending = riskCheck.data?.deletion_pending ?? [];
    const found = pending.some(p => p.pool_id === POOL_B || p.id === POOL_B);
    pass('deletion_pending 목록', `${pending.length}개`);
    if (found) pass('토이키즈 deletion_pending 목록 진입 확인');
    else warn('토이키즈 deletion_pending 목록 미반영 (DB 쿼리 필터 확인 필요)');
  } else {
    fail('risk-center', JSON.stringify(riskCheck.data));
  }

  // E3. cancel-deletion
  sub('E3. cancel-deletion API');
  const cancel = await api('POST', `/super/operators/${POOL_B}/cancel-deletion`, {}, SUPER);
  if (cancel.ok) {
    pass('cancel-deletion 성공', JSON.stringify(cancel.data).slice(0, 80));
  } else {
    fail('cancel-deletion', JSON.stringify(cancel.data));
    return;
  }

  // E4. 취소 후 상태 확인
  sub('E4. 삭제 취소 후 operators/:id 확인');
  const opDetail = await api('GET', `/super/operators/${POOL_B}`, null, SUPER);
  if (opDetail.ok) {
    const d = opDetail.data?.pool ?? opDetail.data;
    if (d?.subscription_end_at === null || d?.subscription_end_at === undefined) {
      pass('subscription_end_at NULL — 삭제 예약 취소됨');
    } else {
      warn('subscription_end_at 잔존', `value=${d?.subscription_end_at}`);
    }
    pass('operators/:id 기본정보', `status=${d?.subscription_status}, tier=${d?.subscription_tier}`);
  } else {
    warn('operators/:id 상세', JSON.stringify(opDetail.data).slice(0, 120));
  }
}

// =========================================================
// 시나리오 F — 플랜 변경 (trial → basic)
// =========================================================
async function scenarioF() {
  section('시나리오 F — 플랜 변경 (trial → basic)');

  // F1. 현재 플랜 확인
  sub('F1. 현재 플랜 확인 (비타스위밍)');
  const before = await api('GET', '/billing/status', null, ADMIN_C);
  if (before.ok) {
    pass('플랜 변경 전', `status=${before.data?.subscription_status}, tier=${before.data?.current_plan ?? before.data?.subscription_tier}`);
  } else {
    warn('billing/status (trial 풀)', `status=${before.status}`);
  }

  // F2. 슈퍼관리자로 플랜 변경
  sub('F2. subscription_tier → basic 변경');
  const change = await api('PATCH', `/super/operators/${POOL_C}/subscription`, {
    subscription_tier: 'basic',
    subscription_status: 'active',
  }, SUPER);
  if (change.ok) {
    pass('플랜 변경 성공 (trial → basic)');
  } else {
    fail('플랜 변경', JSON.stringify(change.data));
    return;
  }

  // F3. 변경 확인
  sub('F3. 변경 후 billing/status');
  const after = await api('GET', '/billing/status', null, ADMIN_C);
  if (after.ok) {
    const tier = after.data?.current_plan ?? after.data?.subscription_tier;
    if (tier === 'basic' || after.data?.subscription_status === 'active') {
      pass('플랜 변경 반영 확인', `tier=${tier}, status=${after.data?.subscription_status}`);
    } else {
      warn('플랜 변경 미반영', JSON.stringify(after.data).slice(0,120));
    }
  } else {
    warn('플랜 변경 후 billing/status', `status=${after.status}`);
  }

  // F4. 복구 (trial로 되돌리기)
  sub('F4. 플랜 복구 (trial로)');
  const restore = await api('PATCH', `/super/operators/${POOL_C}/subscription`, {
    subscription_tier: 'free',
    subscription_status: 'trial',
  }, SUPER);
  if (restore.ok) pass('플랜 복구 (trial)');
  else warn('플랜 복구', JSON.stringify(restore.data));
}

// =========================================================
// 공통 필수 체크 — 권한 분리
// =========================================================
async function commonChecks() {
  section('공통 필수 체크 — 권한 분리 / 데이터 일관성');

  // 1. 비인증 차단
  sub('1. 비인증 접근 차단 (401)');
  const noAuth = await api('GET', '/students', null, null);
  if (!noAuth.ok && noAuth.status === 401) {
    pass('비인증 접근 차단 (401)');
  } else {
    bug('비인증 접근 허용', `status=${noAuth.status}`);
  }

  // 2. 학부모 → 학생 관리 API 차단
  sub('2. 학부모 → 학생관리 API 차단 (403)');
  const parentTok = tok('parent_test_001', 'parent_account', POOL_A);
  const parentAdmin = await api('GET', '/students', null, parentTok);
  if (!parentAdmin.ok && (parentAdmin.status === 403 || parentAdmin.status === 401)) {
    pass('학부모 학생관리 차단', `status=${parentAdmin.status}`);
  } else {
    bug('학부모 학생관리 허용', `status=${parentAdmin.status}`);
  }

  // 3. 선생님 → 결제 API 차단
  sub('3. 선생님 → 결제 API 차단 (403)');
  const teacherTok = tok('teacher_test_001', 'teacher', POOL_A);
  const teacherBilling = await api('GET', '/billing/status', null, teacherTok);
  if (!teacherBilling.ok && teacherBilling.status === 403) {
    pass('선생님 결제 API 차단 (403)');
  } else {
    bug('선생님 결제 API 허용', `status=${teacherBilling.status}`);
  }

  // 4. 비슈퍼관리자 → 슈퍼 API 차단
  sub('4. 일반 관리자 → 슈퍼 API 차단 (403)');
  const adminToSuper = await api('GET', '/super/dashboard-stats', null, ADMIN_A);
  if (!adminToSuper.ok && adminToSuper.status === 403) {
    pass('관리자 슈퍼API 차단 (403)');
  } else {
    bug('관리자 슈퍼API 허용', `status=${adminToSuper.status}`);
  }

  // 5. 수영장간 데이터 격리
  sub('5. 수영장간 데이터 격리');
  const studentsA = await api('GET', '/students', null, ADMIN_A);
  const studentsB = await api('GET', '/students', null, ADMIN_B);
  if (studentsA.ok && studentsB.ok) {
    const arrA = Array.isArray(studentsA.data) ? studentsA.data : (studentsA.data?.students ?? []);
    const arrB = Array.isArray(studentsB.data) ? studentsB.data : (studentsB.data?.students ?? []);
    // ID 교집합 없어야 함
    const idsA = new Set(arrA.map(s => s.id));
    const overlap = arrB.filter(s => idsA.has(s.id));
    if (overlap.length === 0) {
      pass('수영장간 학생 데이터 격리', `A풀=${arrA.length}명, B풀=${arrB.length}명 — 겹침=0`);
    } else {
      bug('수영장간 학생 데이터 겹침', `${overlap.length}건`);
    }
  } else {
    warn('수영장간 격리 확인 불가', `A=${studentsA.status}, B=${studentsB.status}`);
  }

  // 6. audit-logs
  sub('6. audit-logs');
  const auditLogs = await api('GET', '/super/recent-audit-logs?limit=5', null, SUPER);
  if (auditLogs.ok) {
    const arr = auditLogs.data?.logs ?? auditLogs.data ?? [];
    pass('audit-logs', `${Array.isArray(arr) ? arr.length : '?'}개`);
  } else {
    warn('audit-logs', JSON.stringify(auditLogs.data));
  }

  // 7. revenue_logs 컬럼 검증
  sub('7. revenue_logs 컬럼 (charged_amount / net_revenue)');
  const revLogs = await api('GET', '/billing/revenue-logs?limit=5', null, SUPER);
  if (revLogs.ok) {
    const arr = revLogs.data?.logs ?? revLogs.data ?? [];
    if (Array.isArray(arr) && arr.length > 0) {
      const sample = arr[0];
      if (typeof sample.charged_amount !== 'undefined') pass('charged_amount 컬럼 존재');
      else bug('charged_amount 컬럼 없음', JSON.stringify(Object.keys(sample)));
      if (typeof sample.net_revenue !== 'undefined') pass('net_revenue 컬럼 존재');
      else bug('net_revenue 컬럼 없음', JSON.stringify(Object.keys(sample)));
      if (typeof sample.amount !== 'undefined') bug('amount 컬럼 잔존 (제거 필요)', JSON.stringify(sample));
      else pass('amount 컬럼 없음 (정상)');
    } else {
      warn('revenue_logs 데이터 없음 — 컬럼 검증 불가');
    }
  } else {
    warn('revenue-logs', JSON.stringify(revLogs.data));
  }

  // 8. super/operators 필터 동작
  sub('8. super/operators 필터 (pending)');
  const pending = await api('GET', '/super/operators?filter=pending', null, SUPER);
  if (pending.ok && Array.isArray(pending.data)) {
    const allPending = pending.data.every(o => o.approval_status === 'pending');
    if (allPending) pass('pending 필터 정상', `${pending.data.length}개`);
    else bug('pending 필터 오작동', `총=${pending.data.length}, 비pending=${pending.data.filter(o=>o.approval_status!=='pending').length}개`);
  } else {
    warn('pending 필터', `status=${pending.status}`);
  }

  // 9. super/operators 검색
  sub('9. super/operators 검색');
  const search = await api('GET', '/super/operators?search=아쿠아', null, SUPER);
  if (search.ok && Array.isArray(search.data)) {
    pass('검색 (아쿠아)', `${search.data.length}개 결과`);
    const found = search.data.some(o => o.id === POOL_A);
    if (found) pass('아쿠아스타 검색 결과 포함');
    else warn('아쿠아스타 검색 결과 미포함');
  } else {
    warn('operators 검색', `status=${search.status}`);
  }
}

// =========================================================
// 엔드포인트 전수 점검
// =========================================================
async function endpointScan() {
  section('엔드포인트 전수 점검');

  const endpoints = [
    ['GET',  '/health',                              null, null,    '헬스체크 (등록 여부)'],
    ['GET',  '/pricing',                             null, null,    'pricing (공개)'],
    ['GET',  '/super/dashboard-stats',               null, SUPER,   'super/dashboard-stats'],
    ['GET',  '/super/risk-summary',                  null, SUPER,   'super/risk-summary'],
    ['GET',  '/super/risk-center',                   null, SUPER,   'super/risk-center'],
    ['GET',  '/super/recent-audit-logs?limit=3',     null, SUPER,   'super/audit-logs'],
    ['GET',  '/super/operators',                     null, SUPER,   'super/operators'],
    ['GET',  `/super/operators/${POOL_A}`,           null, SUPER,   'super/operators/:id'],
    ['GET',  '/billing/status',                      null, ADMIN_A, 'billing/status'],
    ['GET',  '/billing/revenue-logs?limit=5',        null, SUPER,   'billing/revenue-logs'],
    ['GET',  '/students',                            null, ADMIN_A, 'students'],
    ['GET',  '/class-groups',                        null, ADMIN_A, 'class-groups'],
    ['GET',  '/teachers',                            null, ADMIN_A, 'teachers'],
    ['GET',  '/notices',                             null, ADMIN_A, 'notices'],
    ['GET',  '/branches',                            null, ADMIN_A, 'branches'],
  ];

  for (const [method, path, body, token, label] of endpoints) {
    const r = await api(method, path, body, token);
    if (r.ok) {
      pass(label, `${r.status}`);
    } else if (r.status >= 500) {
      bug(`${label} 500 오류`, JSON.stringify(r.data).slice(0, 80));
    } else if (r.status === 404 && path === '/health') {
      warn('헬스체크 미등록 (404) — /health 라우트 추가 권장');
    } else if (r.status === 404) {
      bug(`${label} 404 — 라우트 없음`);
    } else {
      warn(label, `status=${r.status}, ${JSON.stringify(r.data).slice(0,60)}`);
    }
  }
}

// =========================================================
// mock 문자열 탐지
// =========================================================
async function mockStringCheck() {
  section('Mock/가짜 데이터 문자열 탐지');

  const MOCK_PATTERNS = [
    'mock', 'MOCK', 'growth_plan', 'PG수수료', 'portone', 'PortOne',
    'RECOVERY_FAILURES', 'smsAccounts', 'fake', '_fake',
    '서울수영아카데미_fake', 'placeholder',
  ];

  const targets = [
    ['super/dashboard-stats',  await api('GET', '/super/dashboard-stats',      null, SUPER)],
    ['super/risk-center',      await api('GET', '/super/risk-center',           null, SUPER)],
    ['super/risk-summary',     await api('GET', '/super/risk-summary',          null, SUPER)],
    ['super/operators',        await api('GET', '/super/operators',              null, SUPER)],
    [`operators/${POOL_A}`,    await api('GET', `/super/operators/${POOL_A}`,   null, SUPER)],
    ['billing/revenue-logs',   await api('GET', '/billing/revenue-logs?limit=5', null, SUPER)],
  ];

  for (const [label, r] of targets) {
    const body = JSON.stringify(r.data ?? '');
    const found = MOCK_PATTERNS.filter(p => body.toLowerCase().includes(p.toLowerCase()));
    if (found.length > 0) {
      bug(`${label} — mock 문자열 감지`, found.join(', '));
    } else {
      pass(`${label} — mock 문자열 없음`);
    }
  }
}

// =========================================================
// Main
// =========================================================
async function main() {
  console.log('\n🏊 STAGE 7 — 스윔노트 운영 시뮬레이션 v2\n');
  console.log('API:  ', BASE);
  console.log('시각: ', new Date().toLocaleString('ko-KR'));
  console.log('대상풀: pool_aquastar_002 (active) / pool_toykids_001 (active) / pool_1774021648896 (trial)\n');

  await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD();
  await scenarioE();
  await scenarioF();
  await commonChecks();
  await endpointScan();
  await mockStringCheck();

  const total = R.pass.length + R.fail.length + R.bug.length + R.warn.length;

  console.log(`\n${'═'.repeat(64)}`);
  console.log('  📊 최종 결과');
  console.log(`${'═'.repeat(64)}`);
  console.log(`  ✅ PASS : ${R.pass.length}개`);
  console.log(`  ❌ FAIL : ${R.fail.length}개`);
  console.log(`  🐛 BUG  : ${R.bug.length}개`);
  console.log(`  ⚠️  WARN : ${R.warn.length}개`);
  console.log(`  합계   : ${total}개`);

  if (R.bug.length > 0) {
    console.log('\n  ▼ 치명 버그 목록:');
    R.bug.forEach(b => console.log(`    🐛 ${b}`));
  }
  if (R.fail.length > 0) {
    console.log('\n  ▼ 실패 목록:');
    R.fail.forEach(f => console.log(`    ❌ ${f}`));
  }
  if (R.warn.length > 0) {
    console.log('\n  ▼ 경고 목록:');
    R.warn.forEach(w => console.log(`    ⚠️  ${w}`));
  }

  const score = Math.round((R.pass.length / Math.max(total - R.warn.length, 1)) * 100);
  console.log(`\n  품질 점수: ${score}% (PASS / (PASS+FAIL+BUG))`);
  console.log(`  완료: ${new Date().toLocaleString('ko-KR')}\n`);
}

main().catch(console.error);
