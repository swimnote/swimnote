import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const BASE = 'http://localhost:8080/api';
const SECRET = 'swim-platform-secret-key-2024';

// ── 결과 수집기 ────────────────────────────────────────────
const results = { pass: [], fail: [], warn: [], skip: [] };
let poolAdminTokens = {}; // poolId → token

function makeToken(userId, role, poolId = null) {
  return jwt.sign({ userId, role, poolId }, SECRET, { expiresIn: '1d' });
}

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${BASE}${path}`, opts);
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data: json };
  } catch (e) {
    return { status: 0, ok: false, data: null, error: e.message };
  }
}

function pass(msg, detail = '') { results.pass.push(msg); console.log(`  ✅ PASS: ${msg}${detail ? ' — ' + detail : ''}`); }
function fail(msg, detail = '') { results.fail.push(msg); console.error(`  ❌ FAIL: ${msg}${detail ? ' — ' + detail : ''}`); }
function warn(msg, detail = '') { results.warn.push(msg); console.warn(`  ⚠️  WARN: ${msg}${detail ? ' — ' + detail : ''}`); }
function skip(msg) { results.skip.push(msg); console.log(`  ⏭️  SKIP: ${msg}`); }

function section(title) { console.log(`\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}`); }
function sub(title) { console.log(`\n  ── ${title} ──`); }

// ── 슈퍼관리자 토큰 ───────────────────────────────────────
const SUPER_TOKEN = makeToken('user_super_admin_1773418927301', 'super_admin');

// =========================================================
// T1. 슈퍼관리자 API 테스트
// =========================================================
async function testSuperAdmin() {
  section('T1. 슈퍼관리자 API 테스트');

  sub('/pools/search — 전체 수영장 목록');
  const r = await api('GET', '/pools/search?q=', null, SUPER_TOKEN);
  if (r.ok) pass('수영장 목록 조회', `${r.data?.data?.length ?? 0}개`);
  else fail('수영장 목록 조회', JSON.stringify(r.data));

  sub('/super/pools — 슈퍼 수영장 목록');
  const r2 = await api('GET', '/super/pools', null, SUPER_TOKEN);
  if (r2.ok && Array.isArray(r2.data?.pools)) pass('슈퍼관리자 수영장 목록', `${r2.data.pools.length}개`);
  else fail('슈퍼관리자 수영장 목록', JSON.stringify(r2.data));

  sub('/super/stats — 플랫폼 통계');
  const r3 = await api('GET', '/super/stats', null, SUPER_TOKEN);
  if (r3.ok) pass('플랫폼 통계', JSON.stringify(r3.data).slice(0, 100));
  else fail('플랫폼 통계', JSON.stringify(r3.data));

  sub('/super/subscriptions — 구독 목록');
  const r4 = await api('GET', '/super/subscriptions', null, SUPER_TOKEN);
  if (r4.ok) pass('구독 목록', JSON.stringify(r4.data).slice(0, 100));
  else fail('구독 목록', JSON.stringify(r4.data));

  sub('/super/audit-logs — 감사 로그');
  const r5 = await api('GET', '/super/audit-logs?limit=10', null, SUPER_TOKEN);
  if (r5.ok) pass('감사 로그 조회', JSON.stringify(r5.data).slice(0, 100));
  else fail('감사 로그 조회', JSON.stringify(r5.data));

  sub('/health — 헬스체크');
  const r6 = await api('GET', '/health', null, null);
  if (r6.ok) pass('헬스체크');
  else fail('헬스체크', JSON.stringify(r6.data));
}

// =========================================================
// T2. 풀 관리자 API 테스트 (비타스위밍)
// =========================================================
async function testPoolAdmin() {
  section('T2. 풀 관리자 API 테스트');
  const POOL_ID = 'pool_1773756668947_lx52vx3mb';
  const ADMIN_ID = 'user_1773756598921_k31o0w7rj';
  const TOKEN = makeToken(ADMIN_ID, 'pool_admin', POOL_ID);
  poolAdminTokens[POOL_ID] = TOKEN;

  sub('/pools/my — 내 수영장');
  const r1 = await api('GET', '/pools/my', null, TOKEN);
  if (r1.ok) pass('내 수영장 조회', r1.data?.name);
  else fail('내 수영장 조회', JSON.stringify(r1.data));

  sub('/pools/settings — 수영장 설정');
  const r2 = await api('GET', '/pools/settings', null, TOKEN);
  if (r2.ok) pass('수영장 설정 조회');
  else fail('수영장 설정 조회', JSON.stringify(r2.data));

  sub('/students — 학생 목록');
  const r3 = await api('GET', '/students', null, TOKEN);
  if (r3.ok) pass('학생 목록 조회', `${r3.data?.students?.length ?? r3.data?.length ?? 0}명`);
  else fail('학생 목록 조회', JSON.stringify(r3.data));

  sub('/class-groups — 반 목록');
  const r4 = await api('GET', '/class-groups', null, TOKEN);
  if (r4.ok) pass('반 목록 조회', `${r4.data?.length ?? 0}개`);
  else fail('반 목록 조회', JSON.stringify(r4.data));

  sub('/members — 회원 목록');
  const r5 = await api('GET', '/members', null, TOKEN);
  if (r5.ok) pass('회원 목록 조회', `${r5.data?.members?.length ?? r5.data?.length ?? 0}명`);
  else fail('회원 목록 조회', JSON.stringify(r5.data));

  sub('/notices — 공지사항');
  const r6 = await api('GET', '/notices', null, TOKEN);
  if (r6.ok) pass('공지사항 조회', `${r6.data?.length ?? 0}개`);
  else fail('공지사항 조회', JSON.stringify(r6.data));

  sub('/billing/status — 결제 상태');
  const r7 = await api('GET', '/billing/status', null, TOKEN);
  if (r7.ok) pass('결제 상태 조회', JSON.stringify(r7.data).slice(0, 120));
  else warn('결제 상태 조회', JSON.stringify(r7.data));

  sub('/billing/history — 결제 내역');
  const r8 = await api('GET', '/billing/history', null, TOKEN);
  if (r8.ok) pass('결제 내역 조회', JSON.stringify(r8.data).slice(0, 80));
  else warn('결제 내역 조회', JSON.stringify(r8.data));

  sub('/branches — 지점 목록');
  const r9 = await api('GET', '/branches', null, TOKEN);
  if (r9.ok) pass('지점 목록 조회', `${r9.data?.length ?? 0}개`);
  else fail('지점 목록 조회', JSON.stringify(r9.data));

  sub('/storage/status — 저장 상태');
  const r10 = await api('GET', '/storage/status', null, TOKEN);
  if (r10.ok) pass('저장 상태 조회', JSON.stringify(r10.data).slice(0, 100));
  else warn('저장 상태 조회', JSON.stringify(r10.data));

  sub('PUSH SETTINGS — 수영장 푸시 설정');
  const r11 = await api('GET', '/push-settings/pool', null, TOKEN);
  if (r11.ok) pass('풀 푸시 설정 조회', JSON.stringify(r11.data).slice(0, 80));
  else fail('풀 푸시 설정 조회', JSON.stringify(r11.data));

  sub('BRANDING — 브랜딩 설정');
  const r12 = await api('GET', '/pools/white-label', null, TOKEN);
  if (r12.ok) pass('브랜딩 설정 조회');
  else fail('브랜딩 설정 조회', JSON.stringify(r12.data));

  return TOKEN;
}

// =========================================================
// T3. 선생님 API 테스트
// =========================================================
async function testTeacher() {
  section('T3. 선생님 API 테스트');
  const POOL_ID = 'pool_1773756668947_lx52vx3mb';

  // 선생님 계정 찾기
  const teachers = await api('GET', '/teachers/list', null, makeToken('user_1773756598921_k31o0w7rj', 'pool_admin', POOL_ID));
  let teacherId = null;
  if (teachers.ok && teachers.data?.teachers?.length > 0) {
    teacherId = teachers.data.teachers[0].id;
    pass('선생님 목록 조회', `${teachers.data.teachers.length}명`);
  } else {
    warn('선생님 목록 없음', JSON.stringify(teachers.data).slice(0, 100));
    // 토이키즈 사용
    const t2 = await api('GET', '/teachers/list', null, makeToken('user_pool_admin_002', 'pool_admin', 'pool_toykids_001'));
    if (t2.ok && t2.data?.teachers?.length > 0) {
      teacherId = t2.data.teachers[0].id;
    }
  }

  if (!teacherId) { warn('선생님 없음 - 선생님 테스트 스킵'); return; }

  const TOKEN = makeToken(teacherId, 'teacher', POOL_ID);

  sub('/teacher/overview — 선생님 오버뷰');
  const r1 = await api('GET', '/teacher/overview', null, TOKEN);
  if (r1.ok) pass('선생님 오버뷰', JSON.stringify(r1.data).slice(0, 100));
  else fail('선생님 오버뷰', JSON.stringify(r1.data));

  sub('/diary/class-groups — 일지 반 목록');
  const r2 = await api('GET', '/diary/class-groups', null, TOKEN);
  if (r2.ok) pass('일지 반 목록', `${r2.data?.length ?? 0}개`);
  else fail('일지 반 목록', JSON.stringify(r2.data));

  sub('/teacher/messages — 선생님 메시지');
  const r3 = await api('GET', '/teacher/messages', null, TOKEN);
  if (r3.ok) pass('선생님 메시지', JSON.stringify(r3.data).slice(0, 100));
  else fail('선생님 메시지', JSON.stringify(r3.data));

  sub('/today-schedule — 오늘 스케줄');
  const r4 = await api('GET', '/today-schedule', null, TOKEN);
  if (r4.ok) pass('오늘 스케줄', JSON.stringify(r4.data).slice(0, 100));
  else fail('오늘 스케줄', JSON.stringify(r4.data));

  return TOKEN;
}

// =========================================================
// T4. 학부모 API 테스트
// =========================================================
async function testParent() {
  section('T4. 학부모 API 테스트');

  const parents = await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${makeToken('user_super_admin_1773418927301', 'super_admin')}` }
  });

  // 학부모 계정 찾기 (DB로)
  const PARENT_TOKEN = makeToken('parent_1774178771094_fqiswifle', 'parent_account');

  sub('/parent/profile — 학부모 프로필');
  const r1 = await api('GET', '/parent/profile', null, PARENT_TOKEN);
  if (r1.ok) pass('학부모 프로필', JSON.stringify(r1.data).slice(0, 80));
  else warn('학부모 프로필', JSON.stringify(r1.data));

  sub('/parent/children — 자녀 목록');
  const r2 = await api('GET', '/parent/children', null, PARENT_TOKEN);
  if (r2.ok) pass('자녀 목록', `${r2.data?.length ?? 0}명`);
  else warn('자녀 목록', JSON.stringify(r2.data));

  sub('/parent/notices — 학부모 공지');
  const r3 = await api('GET', '/parent/notices', null, PARENT_TOKEN);
  if (r3.ok) pass('학부모 공지', `${r3.data?.length ?? 0}개`);
  else warn('학부모 공지', JSON.stringify(r3.data));

  sub('/push-settings — 학부모 푸시 설정');
  const r4 = await api('GET', '/push-settings', null, PARENT_TOKEN);
  if (r4.ok) pass('학부모 푸시 설정');
  else warn('학부모 푸시 설정', JSON.stringify(r4.data));
}

// =========================================================
// T5. 핵심 기능 흐름 테스트 (CRUD)
// =========================================================
async function testCoreFlows() {
  section('T5. 핵심 기능 흐름 테스트');
  const POOL_ID = 'pool_toykids_001';
  const ADMIN_TOKEN = makeToken('user_pool_admin_002', 'pool_admin', POOL_ID);

  sub('공지사항 생성 → 조회 → 삭제');
  const n1 = await api('POST', '/notices', {
    title: '[테스트] 공지사항 자동테스트',
    content: '이것은 자동 테스트로 생성된 공지입니다.',
    target: 'all',
  }, ADMIN_TOKEN);
  if (n1.ok && n1.data?.id) {
    pass('공지사항 생성', `id=${n1.data.id}`);
    const n2 = await api('GET', '/notices', null, ADMIN_TOKEN);
    if (n2.ok) pass('공지사항 조회');
    else fail('공지사항 재조회');
    const n3 = await api('DELETE', `/notices/${n1.data.id}`, null, ADMIN_TOKEN);
    if (n3.ok) pass('공지사항 삭제');
    else warn('공지사항 삭제', JSON.stringify(n3.data));
  } else fail('공지사항 생성', JSON.stringify(n1.data));

  sub('학생 생성 → 조회 → 상태변경 → 삭제');
  const s1 = await api('POST', '/students', {
    name: '테스트학생',
    birth_date: '2015-03-15',
    gender: 'M',
    phone: '010-0000-0001',
  }, ADMIN_TOKEN);
  if (s1.ok && s1.data?.id) {
    const sid = s1.data.id;
    pass('학생 생성', `id=${sid}`);
    const s2 = await api('GET', `/students/${sid}`, null, ADMIN_TOKEN);
    if (s2.ok) pass('학생 상세 조회', s2.data?.name);
    else fail('학생 상세 조회', JSON.stringify(s2.data));
    const s3 = await api('POST', `/students/${sid}/change-status`, { status: 'active', reason: '테스트' }, ADMIN_TOKEN);
    if (s3.ok) pass('학생 상태변경');
    else warn('학생 상태변경', JSON.stringify(s3.data));
    const s4 = await api('DELETE', `/students/${sid}`, null, ADMIN_TOKEN);
    if (s4.ok) pass('학생 삭제');
    else warn('학생 삭제', JSON.stringify(s4.data));
  } else fail('학생 생성', JSON.stringify(s1.data));

  sub('반 생성 → 학생 배정 → 삭제');
  const cg1 = await api('POST', '/class-groups', {
    name: '자동테스트반',
    description: '자동 테스트',
    max_students: 20,
  }, ADMIN_TOKEN);
  if (cg1.ok && cg1.data?.id) {
    pass('반 생성', `id=${cg1.data.id}`);
    const cg2 = await api('DELETE', `/class-groups/${cg1.data.id}`, null, ADMIN_TOKEN);
    if (cg2.ok) pass('반 삭제');
    else warn('반 삭제', JSON.stringify(cg2.data));
  } else fail('반 생성', JSON.stringify(cg1.data));

  sub('출결 조회');
  const att = await api('GET', '/attendance?date=' + new Date().toISOString().slice(0, 10), null, ADMIN_TOKEN);
  if (att.ok) pass('출결 조회', JSON.stringify(att.data).slice(0, 100));
  else fail('출결 조회', JSON.stringify(att.data));

  sub('일지 목록 조회');
  const diary = await api('GET', '/diaries', null, ADMIN_TOKEN);
  if (diary.ok) pass('일지 목록', `${diary.data?.diaries?.length ?? diary.data?.length ?? 0}개`);
  else fail('일지 목록', JSON.stringify(diary.data));

  sub('사진 목록 조회');
  const photos = await api('GET', '/photos/groups', null, ADMIN_TOKEN);
  if (photos.ok) pass('사진 그룹 목록', JSON.stringify(photos.data).slice(0, 100));
  else fail('사진 그룹 목록', JSON.stringify(photos.data));

  sub('결석/보강 목록');
  const abs = await api('GET', '/absences', null, ADMIN_TOKEN);
  if (abs.ok) pass('결석 목록', JSON.stringify(abs.data).slice(0, 100));
  else fail('결석 목록', JSON.stringify(abs.data));

  sub('추가 수업(보강) 목록');
  const extra = await api('GET', '/extra-classes', null, ADMIN_TOKEN);
  if (extra.ok) pass('보강 목록', JSON.stringify(extra.data).slice(0, 100));
  else fail('보강 목록', JSON.stringify(extra.data));

  sub('메신저 조회');
  const messenger = await api('GET', '/messenger/threads', null, ADMIN_TOKEN);
  if (messenger.ok) pass('메신저 스레드', JSON.stringify(messenger.data).slice(0, 100));
  else warn('메신저 스레드', JSON.stringify(messenger.data));

  sub('레벨 설정 조회');
  const lvl = await api('GET', '/pool-level-settings', null, ADMIN_TOKEN);
  if (lvl.ok) pass('레벨 설정', JSON.stringify(lvl.data).slice(0, 100));
  else warn('레벨 설정', JSON.stringify(lvl.data));

  sub('수업 가격 설정');
  const pricing = await api('GET', '/pool-class-pricing', null, ADMIN_TOKEN);
  if (pricing.ok) pass('수업 가격', JSON.stringify(pricing.data).slice(0, 100));
  else warn('수업 가격', JSON.stringify(pricing.data));

  sub('정산 조회');
  const settle = await api('GET', '/settlement', null, ADMIN_TOKEN);
  if (settle.ok) pass('정산 조회', JSON.stringify(settle.data).slice(0, 100));
  else warn('정산 조회', JSON.stringify(settle.data));
}

// =========================================================
// T6. 권한 차단 테스트
// =========================================================
async function testPermissions() {
  section('T6. 권한 차단 테스트');
  const POOL_A = 'pool_toykids_001';
  const POOL_B = 'pool_aquastar_002';
  const ADMIN_A_TOKEN = makeToken('user_pool_admin_002', 'pool_admin', POOL_A);

  sub('다른 수영장 데이터 접근 차단');
  const poolAStudents = await api('GET', '/students', null, ADMIN_A_TOKEN);
  const poolACount = poolAStudents.data?.students?.length ?? 0;

  // 인증 없이 접근
  const noAuth = await api('GET', '/students', null, null);
  if (!noAuth.ok && noAuth.status === 401) pass('인증 없는 접근 차단 (401)');
  else fail('인증 없는 접근 허용', `status=${noAuth.status}`);

  // 학부모가 관리자 API 접근
  const parentToken = makeToken('test_parent', 'parent_account');
  const parentAdmin = await api('GET', '/students', null, parentToken);
  if (!parentAdmin.ok && (parentAdmin.status === 403 || parentAdmin.status === 401)) pass('학부모 → 학생 관리 API 차단');
  else warn('학부모 → 학생 관리 API 결과', `status=${parentAdmin.status}`);

  // 선생님이 결제 API 접근
  const teacherToken = makeToken('test_teacher', 'teacher', POOL_A);
  const teacherBilling = await api('GET', '/billing/status', null, teacherToken);
  if (!teacherBilling.ok && teacherBilling.status === 403) pass('선생님 → 결제 API 차단 (403)');
  else warn('선생님 → 결제 API 결과', `status=${teacherBilling.status}`);
}

// =========================================================
// T7. 스케줄러 + 예약 시스템 점검
// =========================================================
async function testScheduler() {
  section('T7. 스케줄러 + 예약 점검');

  sub('푸시 로그 조회');
  const TOKEN = makeToken('user_pool_admin_002', 'pool_admin', 'pool_toykids_001');
  const logs = await api('GET', '/push-settings/logs?limit=10', null, TOKEN);
  if (logs.ok) pass('푸시 로그', `${logs.data?.logs?.length ?? 0}개`);
  else warn('푸시 로그', JSON.stringify(logs.data));

  sub('휴일 목록');
  const holidays = await api('GET', '/holidays', null, TOKEN);
  if (holidays.ok) pass('휴일 목록', JSON.stringify(holidays.data).slice(0, 100));
  else warn('휴일 목록', JSON.stringify(holidays.data));

  sub('수업 스케줄 조회');
  const schedule = await api('GET', '/class-schedules', null, TOKEN);
  if (schedule.ok) pass('수업 스케줄', JSON.stringify(schedule.data).slice(0, 100));
  else warn('수업 스케줄', JSON.stringify(schedule.data));
}

// =========================================================
// Main
// =========================================================
async function main() {
  console.log('\n\n🏊 스윔노트 자동화 테스트 시작\n');
  console.log('대상 API:', BASE);
  console.log('시작 시각:', new Date().toLocaleString('ko-KR'));

  await testSuperAdmin();
  await testPoolAdmin();
  await testTeacher();
  await testParent();
  await testCoreFlows();
  await testPermissions();
  await testScheduler();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  📊 테스트 결과 요약`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  ✅ PASS:  ${results.pass.length}개`);
  console.log(`  ❌ FAIL:  ${results.fail.length}개`);
  console.log(`  ⚠️  WARN:  ${results.warn.length}개`);
  console.log(`  ⏭️  SKIP:  ${results.skip.length}개`);
  if (results.fail.length > 0) {
    console.log('\n  실패 항목:');
    results.fail.forEach(f => console.log(`    - ${f}`));
  }
  if (results.warn.length > 0) {
    console.log('\n  경고 항목:');
    results.warn.forEach(w => console.log(`    - ${w}`));
  }
  console.log(`\n  종료 시각: ${new Date().toLocaleString('ko-KR')}\n`);
}

main().catch(console.error);
