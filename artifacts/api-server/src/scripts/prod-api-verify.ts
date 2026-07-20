/**
 * 운영 서버 API 검증 스크립트
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/prod-api-verify.ts
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

const BASE = "https://swimnote-api.onrender.com/api";
const JWT_SECRET = process.env.JWT_SECRET!;

if (!JWT_SECRET) throw new Error("JWT_SECRET 환경변수 없음");

const results: { name: string; status: "PASS" | "FAIL" | "WARN"; code?: number; detail: string }[] = [];

function r(name: string, pass: boolean, detail: string, code?: number) {
  const status = pass ? "PASS" : "FAIL";
  results.push({ name, status, code, detail });
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}: ${detail}${code ? ` (HTTP ${code})` : ""}`);
}

async function callApi(path: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let body: any;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔵 운영 서버 API 검증 시작:", new Date().toISOString());
  console.log(`   서버: ${BASE}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // 1. Health check
  console.log("=== Step 1: Health Check ===");
  const hRes = await fetch(`${BASE}/health`);
  const hBody = await hRes.json() as any;
  r("health check HTTP 200", hRes.status === 200, JSON.stringify(hBody), hRes.status);
  r("health ok=true", hBody.ok === true, `ok=${hBody.ok}`);
  r("health uptime>0", (hBody.uptime ?? 0) > 0, `uptime=${hBody.uptime}s`);
  console.log(`   version: ${hBody.version}, timestamp: ${hBody.timestamp}`);

  // 2. 운영 pool + admin user 조회
  console.log("\n=== Step 2: 운영 Pool & Admin 조회 ===");
  const pools = (await superAdminDb.execute(sql.raw(
    `SELECT id, name FROM swimming_pools WHERE approval_status='approved' AND subscription_status='active' LIMIT 3`
  ))).rows as any[];
  if (pools.length === 0) { console.log("⚠️  활성 pool 없음"); process.exit(1); }

  const pool = pools[0];
  console.log(`  Pool: ${pool.name} (${pool.id})`);
  console.log(`  전체 활성 pool 수: ${pools.length}`);

  const adminUser = (await superAdminDb.execute(sql.raw(
    `SELECT id, email, role FROM users WHERE role='pool_admin' AND swimming_pool_id='${pool.id}' LIMIT 1`
  ))).rows[0] as any;
  if (!adminUser) { console.log("⚠️  pool_admin 없음"); process.exit(1); }
  console.log(`  Admin: ${adminUser.email} (${adminUser.id})`);

  // 3. JWT 발급
  const adminToken = jwt.sign(
    { userId: adminUser.id, role: "pool_admin", poolId: pool.id, tv: 1 },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  // 4. class_groups 조회
  console.log("\n=== Step 3: class-groups API ===");
  const cgRes = await callApi("/class-groups", adminToken);
  r("class-groups HTTP 200", cgRes.status === 200, `count=${Array.isArray(cgRes.body) ? cgRes.body.length : 'N/A'}`, cgRes.status);

  const classGroups = Array.isArray(cgRes.body) ? cgRes.body : [];
  const cg = classGroups[0];

  // 5. today-schedule
  console.log("\n=== Step 4: today-schedule API ===");
  const today = new Date().toISOString().slice(0, 10);
  const tsRes = await callApi(`/today-schedule?date=${today}`, adminToken);
  r("today-schedule HTTP 200", tsRes.status === 200, `success=${tsRes.body?.success}`, tsRes.status);
  const scheduleData = tsRes.body?.data ?? [];
  r("today-schedule 응답 배열", Array.isArray(scheduleData), `classes=${scheduleData.length}`);

  // 6. attendance/weekly
  console.log("\n=== Step 5: attendance/weekly API ===");
  const weekStart = today;
  const weeklyPath = `/attendance/weekly?start_date=${weekStart}${cg ? `&class_group_id=${cg.id}` : ""}`;
  const wRes = await callApi(weeklyPath, adminToken);
  r("attendance/weekly HTTP 200", wRes.status === 200, `success=${wRes.body?.success}`, wRes.status);
  const weeklyStudents = wRes.body?.data?.students ?? [];
  r("weekly 학생 중복 없음", (() => {
    const ids = weeklyStudents.map((s: any) => s.student_id);
    return ids.length === new Set(ids).size;
  })(), `students=${weeklyStudents.length}`);

  // 7. attendance/monthly-summary
  console.log("\n=== Step 6: attendance/monthly-summary API ===");
  const year = today.slice(0, 4);
  const month = today.slice(5, 7);
  const mRes = await callApi(`/attendance/monthly-summary?year=${year}&month=${month}`, adminToken);
  r("attendance/monthly-summary HTTP 200", mRes.status === 200, `success=${mRes.body?.success}`, mRes.status);
  const monthlyStudents = mRes.body?.data ?? [];
  r("monthly 학생 중복 없음", (() => {
    const keys = monthlyStudents.map((s: any) => `${s.student_id}__${s.class_group_id}`);
    return keys.length === new Set(keys).size;
  })(), `entries=${monthlyStudents.length}`);

  // 8. 학부모 계정으로 parent API 테스트
  console.log("\n=== Step 7: 학부모 API ===");
  // parent_accounts.id = JWT userId, role = "parent_account"
  const parentAccount = (await superAdminDb.execute(sql.raw(
    `SELECT pa.id, ps.student_id
     FROM parent_accounts pa
     JOIN parent_students ps ON ps.parent_id = pa.id
     WHERE pa.swimming_pool_id = '${pool.id}'
       AND ps.status = 'approved'
     LIMIT 1`
  ))).rows[0] as any;

  if (!parentAccount) {
    results.push({ name: "학부모 API", status: "WARN", detail: "운영 pool에 학부모 계정 없음 — 스킵" });
    console.log("⚠️  학부모 계정 없음 — 스킵");
  } else {
    const parentToken = jwt.sign(
      { userId: parentAccount.id, role: "parent_account", poolId: pool.id, tv: 1 },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    const paRes = await callApi(`/parent/students/${parentAccount.student_id}/attendance`, parentToken);
    r("학부모 출결 HTTP 200", paRes.status === 200, `records=${Array.isArray(paRes.body) ? paRes.body.length : 'N/A'}`, paRes.status);

    const pdRes = await callApi(`/parent/students/${parentAccount.student_id}/diary`, parentToken);
    r("학부모 일지 HTTP 200", pdRes.status === 200, `diaries=${Array.isArray(pdRes.body) ? pdRes.body.length : 'N/A'}`, pdRes.status);
  }

  // 9. student_class_history 기반 날짜 로직 검증 (운영 데이터 read-only)
  console.log("\n=== Step 8: 날짜 시스템 검증 (read-only) ===");

  // history 테이블 기본 무결성
  const histIntegrity = (await superAdminDb.execute(sql.raw(`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN enrolled_at IS NULL THEN 1 END) as null_enroll,
           COUNT(CASE WHEN left_at IS NOT NULL AND left_at <= enrolled_at THEN 1 END) as invalid_range
    FROM student_class_history
    WHERE swimming_pool_id = '${pool.id}'
  `))).rows[0] as any;
  r("history 레코드 존재", Number(histIntegrity.total) > 0, `total=${histIntegrity.total}`);
  r("enrolled_at NULL 없음", Number(histIntegrity.null_enroll) === 0, `null_count=${histIntegrity.null_enroll}`);
  r("left_at > enrolled_at (범위 유효)", Number(histIntegrity.invalid_range) === 0, `invalid=${histIntegrity.invalid_range}`);

  // enrolled_at::text 비교 타입 오류 검증 (운영 DB 실행)
  try {
    await superAdminDb.execute(sql.raw(`
      SELECT COUNT(*) FROM attendance a
      JOIN student_class_history sch
        ON sch.student_id = a.student_id
        AND sch.class_group_id = a.class_group_id
        AND sch.enrolled_at::text <= a.date
        AND (sch.left_at IS NULL OR sch.left_at::text > a.date)
      WHERE a.swimming_pool_id = '${pool.id}'
    `));
    r("enrolled_at::text JOIN 쿼리 실행 성공", true, "타입 캐스팅 정상");
  } catch (e: any) {
    r("enrolled_at::text JOIN 쿼리 실행 성공", false, e.message);
  }

  // 날짜 경계 검증: 특정 학생의 today-schedule 정합성
  const sampleStudent = (await superAdminDb.execute(sql.raw(`
    SELECT h.student_id, h.class_group_id, h.enrolled_at, h.left_at, s.name
    FROM student_class_history h
    JOIN students s ON s.id = h.student_id
    WHERE h.swimming_pool_id = '${pool.id}'
      AND h.enrolled_at <= '${today}'
      AND (h.left_at IS NULL OR h.left_at > '${today}')
      AND s.deleted_at IS NULL
    LIMIT 1
  `))).rows[0] as any;

  if (sampleStudent) {
    const enrolledStr = String(sampleStudent.enrolled_at).slice(0, 10);
    // today 조회에서 학생이 보여야 함
    const todaySchedule = tsRes.body?.data ?? [];
    const foundInSchedule = todaySchedule.some((cg: any) =>
      (cg.students ?? []).some((s: any) => s.student_id === sampleStudent.student_id)
    );
    r(`today 활성 학생 노출 (${sampleStudent.name})`, foundInSchedule || todaySchedule.length === 0,
      foundInSchedule ? "today-schedule에 존재" : `today 수업 없음(classes=${todaySchedule.length})`);
  }

  // 10. 최종 요약
  console.log("\n");
  console.log("════════════════════════════════════════════════");
  console.log("         최 종  검 증  결 과");
  console.log("════════════════════════════════════════════════");
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const warn = results.filter(r => r.status === "WARN").length;

  for (const res of results) {
    const icon = res.status === "PASS" ? "✅" : res.status === "WARN" ? "⚠️ " : "❌";
    console.log(`${icon}  ${res.name}: ${res.detail}`);
  }
  console.log("────────────────────────────────────────────────");
  console.log(`PASS: ${pass}  FAIL: ${fail}  WARN: ${warn}  전체: ${results.length}`);
  console.log("════════════════════════════════════════════════");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("❌ 검증 실패:", e);
  process.exit(1);
});
