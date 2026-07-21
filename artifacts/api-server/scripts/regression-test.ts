/**
 * 회귀 테스트: 학부모 세션 유지 버그 수정 후 전체 인증 흐름 검증
 *
 * 시뮬레이션 대상:
 *  - 실제 로그인 API → 토큰 획득
 *  - GET /auth/me (loadStored() 앱 재실행 시 호출 흐름 완전 재현)
 *  - 학부모 홈 API, 사진 API, 일지 API 정상 동작
 *  - 관리자·선생님 세션 복원 회귀 없음
 */

const API = "http://localhost:8080/api";

interface TestResult {
  name: string;
  pass: boolean;
  status?: number;
  note?: string;
}
const results: TestResult[] = [];

function pass(name: string, status?: number, note?: string) {
  results.push({ name, pass: true, status, note });
  console.log(`  ✅ PASS  ${name}${note ? " — " + note : ""}`);
}
function fail(name: string, status?: number, note?: string) {
  results.push({ name, pass: false, status, note });
  console.log(`  ❌ FAIL  ${name}${note ? " — " + note : ""} (HTTP ${status})`);
}

async function get(url: string, token: string) {
  const res = await fetch(`${API}${url}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store" as any,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function post(url: string, data: Record<string, string>) {
  const res = await fetch(`${API}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ─── 1. 학부모 로그인 → 앱 종료 → 재실행 시뮬레이션 ──────────────────────
async function testParentFlow() {
  console.log("\n[1] 학부모 로그인 → 세션 복원 → 홈/사진/일지");

  // (a) 로그인 (앱 최초 로그인 시뮬레이션)
  const loginRes = await post("/auth/parent-login", { identifier: "demo_parent", password: "Demo2024!" });
  if (loginRes.status !== 200 || !loginRes.body.token) {
    fail("학부모 로그인", loginRes.status, loginRes.body.error || "토큰 없음");
    return null;
  }
  pass("학부모 로그인", 200);
  const token: string = loginRes.body.token;
  const storedParent = loginRes.body.parent;
  console.log(`     저장될 parent: ${JSON.stringify(storedParent).substring(0, 80)}`);

  // (b) 앱 재실행 — loadStored()가 정확히 이 호출을 함
  const meRes = await get("/auth/me", token);
  if (meRes.status !== 200) {
    fail("학부모 /auth/me (앱 재실행 시뮬레이션)", meRes.status, JSON.stringify(meRes.body).substring(0,80));
    return null;
  }
  // 필수 필드 확인
  const pa = meRes.body;
  const requiredFields = ["id", "name", "phone", "swimming_pool_id"];
  const missing = requiredFields.filter(f => !pa[f]);
  if (missing.length > 0) {
    fail("학부모 /auth/me 응답 구조", 200, `누락 필드: ${missing.join(", ")}`);
    return null;
  }
  pass("학부모 /auth/me (앱 재실행 시뮬레이션)", 200,
    `id=${pa.id.substring(0,16)} pool_name=${pa.pool_name}`);

  // (c) 홈 API
  const homeRes = await get("/parent/students", token);
  if (homeRes.status === 200 || homeRes.status === 404) {
    pass("학부모 홈 (학생 목록)", homeRes.status);
  } else {
    fail("학부모 홈 (학생 목록)", homeRes.status, JSON.stringify(homeRes.body).substring(0,60));
  }

  // (d) 사진 API
  const photosRes = await get("/photos/parent-recent?limit=5", token);
  if (photosRes.status === 200 || photosRes.status === 404) {
    pass("학부모 사진", photosRes.status);
  } else {
    fail("학부모 사진", photosRes.status, JSON.stringify(photosRes.body).substring(0,60));
  }

  // (e) 일지 API
  const diaryRes = await get("/parent/diary?limit=5", token);
  if (diaryRes.status === 200 || diaryRes.status === 404) {
    pass("학부모 일지", diaryRes.status);
  } else {
    fail("학부모 일지", diaryRes.status, JSON.stringify(diaryRes.body).substring(0,60));
  }

  return token;
}

// ─── 2. 관리자 로그인 → 앱 종료 → 재실행 시뮬레이션 ────────────────────────
async function testAdminFlow() {
  console.log("\n[2] 관리자 로그인 → 세션 복원");

  const loginRes = await post("/auth/unified-login", { identifier: "demo@swimnote.app", password: "Demo2024!" });
  if (loginRes.status !== 200) {
    fail("관리자 로그인", loginRes.status, loginRes.body.error);
    return;
  }
  // unified-login은 available_accounts를 반환하고 첫 계정을 사용
  const accounts: any[] = loginRes.body.available_accounts || [];
  const adminAccount = accounts.find((a: any) => a.kind === "admin");
  if (!adminAccount?.token) {
    fail("관리자 로그인 토큰 추출", undefined, "available_accounts에 admin 없음");
    return;
  }
  pass("관리자 로그인", 200, `role=${adminAccount.user?.role}`);
  const token = adminAccount.token;

  // 앱 재실행 — loadStored() 시뮬레이션
  const meRes = await get("/auth/me", token);
  if (meRes.status !== 200) {
    fail("관리자 /auth/me (앱 재실행)", meRes.status, JSON.stringify(meRes.body).substring(0,80));
    return;
  }
  const u = meRes.body;
  if (!u.id || !u.role || !Array.isArray(u.roles)) {
    fail("관리자 /auth/me 응답 구조", 200, `roles=${JSON.stringify(u.roles)}`);
    return;
  }
  pass("관리자 /auth/me (앱 재실행)", 200, `role=${u.role} roles=${JSON.stringify(u.roles)}`);
}

// ─── 3. 선생님 JWT 서명 → /auth/me → 세션 복원 시뮬레이션 ───────────────────
async function testTeacherFlow() {
  console.log("\n[3] 선생님 JWT → /auth/me → 세션 복원");

  // DB에서 활성 teacher 계정 조회
  const { superAdminDb } = await import("@workspace/db");
  const { usersTable } = await import("@workspace/db/schema");
  const { sql: drizzleSql } = await import("drizzle-orm");
  const { signToken } = await import("../src/lib/auth.js");

  const rows = await superAdminDb.execute(drizzleSql`
    SELECT id, role, swimming_pool_id FROM users
    WHERE role = 'teacher' AND is_activated = true
      AND (withdrawal_requested_at IS NULL)
    LIMIT 1
  `);
  const teacher = rows.rows[0] as any;
  if (!teacher) {
    fail("선생님 계정 조회", undefined, "teacher 계정 없음");
    return;
  }
  pass("선생님 계정 조회", undefined, `id=${teacher.id?.substring(0,16)}`);

  // loadStored()가 실행하는 정확한 흐름: 저장된 토큰으로 /auth/me 호출
  const token = signToken({ userId: teacher.id, role: teacher.role, poolId: teacher.swimming_pool_id ?? null });
  const meRes = await get("/auth/me", token);
  if (meRes.status !== 200) {
    fail("선생님 /auth/me (앱 재실행 시뮬레이션)", meRes.status, JSON.stringify(meRes.body).substring(0,80));
    return;
  }
  const u = meRes.body;
  if (!u.id || !u.role) {
    fail("선생님 /auth/me 응답 구조", 200, `id=${u.id} role=${u.role}`);
    return;
  }
  pass("선생님 /auth/me (앱 재실행 시뮬레이션)", 200, `role=${u.role}`);
}

// ─── 4. 잘못된 토큰 → 세션 삭제 (회귀 없음) ────────────────────────────────
async function testInvalidToken() {
  console.log("\n[4] 만료/잘못된 토큰 → 401 (세션 삭제 트리거)");

  const badToken = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4Iiwicm9sZSI6InBhcmVudF9hY2NvdW50IiwidHYiOjF9.bad_signature";
  const meRes = await get("/auth/me", badToken);
  if (meRes.status === 401) {
    pass("잘못된 JWT → 401 (세션 삭제 올바르게 트리거)", 401);
  } else {
    fail("잘못된 JWT → 401 기대", meRes.status);
  }

  const fakeParentToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJwYV92Ml9ub25leGlzdGVudCIsInJvbGUiOiJwYXJlbnRfYWNjb3VudCIsInBvb2xJZCI6bnVsbCwidHYiOjF9.fake";
  const fakeRes = await get("/auth/me", fakeParentToken);
  if (fakeRes.status === 401) {
    pass("위조된 학부모 JWT → 401 (서명 불일치)", 401);
  } else {
    fail("위조된 학부모 JWT → 401 기대", fakeRes.status);
  }
}

async function run() {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║      SwimNote 인증 회귀 테스트              ║");
  console.log("╚════════════════════════════════════════════╝");

  await testParentFlow();
  await testAdminFlow();
  await testTeacherFlow();
  await testInvalidToken();

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log("\n╔════════════════════════════════════════════╗");
  console.log(`║  결과: ${passed}/${total} PASS  ${failed > 0 ? failed + " FAIL" : "전체 통과 🎉"}        `);
  console.log("╚════════════════════════════════════════════╝");
  if (failed > 0) {
    console.log("\n실패 목록:");
    results.filter(r => !r.pass).forEach(r => console.log(`  ❌ ${r.name} (HTTP ${r.status}) ${r.note ?? ""}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
