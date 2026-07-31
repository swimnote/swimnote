/**
 * 날짜 시스템 통합 테스트 스크립트
 * 실행: cd artifacts/api-server && npx tsx src/scripts/integration-test.ts
 */
import { superAdminDb as db } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

// ─── 기존 Supabase 풀 사용 ────────────────────────────────────────────────
const POOL_ID   = "pool_1775118427405_xs80lcdmo";
const ADMIN_UID = "user_1775118427405_ey2qbn6is";

const TS = Date.now();
const CG_A_ID = `cg_test_A_${TS}`;
const CG_B_ID = `cg_test_B_${TS}`;
const ST_ID   = `st_test_${TS}`;
const H1 = `h_test_1_${TS}`;
const H2 = `h_test_2_${TS}`;
const H3 = `h_test_3_${TS}`;

type Res = { test: string; pass: boolean; expected: string; actual: string };
const results: Res[] = [];

function r(test: string, pass: boolean, expected: string, actual: string) {
  results.push({ test, pass, expected, actual });
  console.log(`${pass ? "✅" : "❌"} ${test}${pass ? "" : `\n   expect: ${expected}  got: ${actual}`}`);
}

const JWT_SECRET = process.env.JWT_SECRET!;
function tok(poolId: string) {
  return jwt.sign({ userId: ADMIN_UID, role: "pool_admin", poolId, tv: 1 }, JWT_SECRET, { expiresIn: "1h" });
}

async function api(method: string, path: string, token: string, body?: object) {
  const res = await fetch(`http://localhost:8080/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

/**
 * today-schedule?date=... 응답에서 특정 cgId의 students 배열 반환
 * (API가 teacher_user_id 기반이므로 반이 없으면 [] 반환)
 */
async function getStudents(cgId: string, date: string, token: string): Promise<any[]> {
  const res = await api("GET", `/today-schedule?date=${date}`, token);
  const groups: any[] = Array.isArray(res.body) ? res.body : [];
  return groups.find((g: any) => g.id === cgId)?.students ?? [];
}

/** today-schedule?date=... 응답에서 특정 cgId의 student_count 반환 */
async function getCount(cgId: string, date: string, token: string): Promise<number> {
  const res = await api("GET", `/today-schedule?date=${date}`, token);
  const groups: any[] = Array.isArray(res.body) ? res.body : [];
  const g = groups.find((g: any) => g.id === cgId);
  return g?.student_count ?? 0;
}

function stIn(list: any[]): boolean {
  return list.some((s: any) => s.id === ST_ID || s.student_id === ST_ID);
}

// ─── 히스토리 재설정 ──────────────────────────────────────────────────────
async function setHist(entries: { id: string; cg: string; enr: string; lft: string | null }[]) {
  await db.execute(sql.raw(`DELETE FROM student_class_history WHERE student_id = '${ST_ID}'`));
  for (const e of entries) {
    await db.execute(sql.raw(`
      INSERT INTO student_class_history (id, student_id, class_group_id, swimming_pool_id, enrolled_at, left_at, created_at)
      VALUES ('${e.id}', '${ST_ID}', '${e.cg}', '${POOL_ID}', '${e.enr}', ${e.lft ? `'${e.lft}'` : "NULL"}, now())
    `));
  }
}

// ─── 셋업 ────────────────────────────────────────────────────────────────
async function setup() {
  console.log("\n=== 셋업 ===");
  // schedule_days에 모든 요일 포함 → 어떤 날짜에도 today-schedule에 표시됨
  // teacher_user_id = ADMIN_UID → 토큰 userId와 일치해야 today-schedule 응답에 포함됨
  await db.execute(sql.raw(`
    INSERT INTO class_groups (id, name, swimming_pool_id, schedule_days, schedule_time, teacher_user_id, is_deleted, created_at)
    VALUES ('${CG_A_ID}', 'TEST-A반', '${POOL_ID}', '["월","화","수","목","금","토","일"]', '06:00', '${ADMIN_UID}', false, now()),
           ('${CG_B_ID}', 'TEST-B반', '${POOL_ID}', '["월","화","수","목","금","토","일"]', '07:00', '${ADMIN_UID}', false, now())
    ON CONFLICT DO NOTHING
  `));
  await db.execute(sql.raw(`
    INSERT INTO students (id, name, swimming_pool_id, created_at)
    VALUES ('${ST_ID}', 'TEST학생', '${POOL_ID}', now())
    ON CONFLICT DO NOTHING
  `));
  console.log(`풀: ${POOL_ID}  반A: ${CG_A_ID}  학생: ${ST_ID}`);
}

// ─── 정리 ────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log("\n=== 정리 ===");
  await db.execute(sql.raw(`DELETE FROM student_class_history WHERE student_id = '${ST_ID}'`));
  await db.execute(sql.raw(`DELETE FROM attendance WHERE student_id = '${ST_ID}'`));
  await db.execute(sql.raw(`DELETE FROM class_diaries WHERE class_group_id IN ('${CG_A_ID}','${CG_B_ID}')`));
  await db.execute(sql.raw(`DELETE FROM students WHERE id = '${ST_ID}'`));
  await db.execute(sql.raw(`DELETE FROM class_groups WHERE id IN ('${CG_A_ID}','${CG_B_ID}')`));
  console.log("정리 완료");
}

// ─── 메인 ────────────────────────────────────────────────────────────────
async function main() {
  await setup();
  const T = tok(POOL_ID);

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 1: 신규 등록 (enrolled_at=2026-07-10) ===");
  await setHist([{ id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: null }]);

  const cnt09 = await getCount(CG_A_ID, "2026-07-09", T);
  const cnt10 = await getCount(CG_A_ID, "2026-07-10", T);
  r("TEST1-a: 7/9 반카드 인원=0 (등록 전)", cnt09 === 0, "0", String(cnt09));
  r("TEST1-b: 7/10 반카드 인원=1 (등록 당일)", cnt10 === 1, "1", String(cnt10));

  const st09 = await getStudents(CG_A_ID, "2026-07-09", T);
  const st10 = await getStudents(CG_A_ID, "2026-07-10", T);
  r("TEST1-c: 7/9 학생 미표시", !stIn(st09), "not found", String(st09.length));
  r("TEST1-d: 7/10 학생 표시", stIn(st10), "found", String(st10.length));

  const wk01 = await api("GET", `/attendance/weekly?start_date=2026-07-01&class_group_id=${CG_A_ID}`, T);
  r("TEST1-e: weekly 등록 전 주 미포함", !(wk01.body?.data ?? []).some((d: any) => d.student_id === ST_ID), "not found", "ok");

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 2: 반 이동 (A→B, 2026-07-15) ===");
  await setHist([
    { id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-15" },
    { id: H2, cg: CG_B_ID, enr: "2026-07-15", lft: null },
  ]);

  const stA10 = await getStudents(CG_A_ID, "2026-07-10", T);
  const stB10 = await getStudents(CG_B_ID, "2026-07-10", T);
  const stA20 = await getStudents(CG_A_ID, "2026-07-20", T);
  const stB20 = await getStudents(CG_B_ID, "2026-07-20", T);

  r("TEST2-a: 7/10 A반 표시", stIn(stA10), "found", String(stA10.length));
  r("TEST2-b: 7/10 B반 미표시", !stIn(stB10), "not found", String(stB10.length));
  r("TEST2-c: 7/20 A반 미표시", !stIn(stA20), "not found", String(stA20.length));
  r("TEST2-d: 7/20 B반 표시", stIn(stB20), "found", String(stB20.length));

  const wk13 = await api("GET", `/attendance/weekly?start_date=2026-07-13`, T);
  const wkData: any[] = wk13.body?.data ?? [];
  const stWkRows = wkData.filter((d: any) => d.student_id === ST_ID);
  const allDates = stWkRows.flatMap((d: any) => Object.keys(d.days ?? {}));
  r("TEST2-e: weekly 날짜 중복 없음", allDates.length === new Set(allDates).size, "unique", `total=${allDates.length} uniq=${new Set(allDates).size}`);

  const mo07 = await api("GET", `/attendance/monthly-summary?year=2026&month=07`, T);
  const moRows = (mo07.body?.data ?? []).filter((d: any) => d.student_id === ST_ID);
  r("TEST2-f: monthly 행 ≤ 2 (A+B)", moRows.length <= 2, "≤2", String(moRows.length));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 3: 연기 (left_at=2026-07-20) ===");
  await setHist([{ id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-20" }]);

  const st19 = await getStudents(CG_A_ID, "2026-07-19", T);
  const st20 = await getStudents(CG_A_ID, "2026-07-20", T);
  const cnt19 = await getCount(CG_A_ID, "2026-07-19", T);
  const cnt20 = await getCount(CG_A_ID, "2026-07-20", T);

  r("TEST3-a: 7/19 표시 (연기 전)", stIn(st19), "found", String(st19.length));
  r("TEST3-b: 7/20 미표시 (연기 시작)", !stIn(st20), "not found", String(st20.length));
  r("TEST3-c: 7/19 반카드=1", cnt19 === 1, "1", String(cnt19));
  r("TEST3-d: 7/20 반카드=0", cnt20 === 0, "0", String(cnt20));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 4: 복귀 (enrolled_at=2026-07-25) ===");
  await setHist([
    { id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-20" },
    { id: H3, cg: CG_A_ID, enr: "2026-07-25", lft: null },
  ]);

  const st24 = await getStudents(CG_A_ID, "2026-07-24", T);
  const st25 = await getStudents(CG_A_ID, "2026-07-25", T);
  r("TEST4-a: 7/24 미표시 (연기 중)", !stIn(st24), "not found", String(st24.length));
  r("TEST4-b: 7/25 표시 (복귀 당일)", stIn(st25), "found", String(st25.length));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 5: 퇴원 (left_at=2026-07-30) ===");
  await setHist([{ id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-30" }]);

  const st29 = await getStudents(CG_A_ID, "2026-07-29", T);
  const st30 = await getStudents(CG_A_ID, "2026-07-30", T);
  const cnt29 = await getCount(CG_A_ID, "2026-07-29", T);
  const cnt30 = await getCount(CG_A_ID, "2026-07-30", T);

  r("TEST5-a: 7/29 표시 (퇴원 전)", stIn(st29), "found", String(st29.length));
  r("TEST5-b: 7/30 미표시 (퇴원 당일)", !stIn(st30), "not found", String(st30.length));
  r("TEST5-c: 7/29 반카드=1", cnt29 === 1, "1", String(cnt29));
  r("TEST5-d: 7/30 반카드=0", cnt30 === 0, "0", String(cnt30));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 6: 반카드 인원 = 학생목록 인원 ===");
  await setHist([{ id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: null }]);

  const cardCnt = await getCount(CG_A_ID, "2026-07-20", T);
  const detailList = await getStudents(CG_A_ID, "2026-07-20", T);
  r("TEST6: 반카드=학생목록 인원", cardCnt === detailList.length, String(detailList.length), String(cardCnt));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 7: weekly 복합 시나리오 ===");
  await setHist([
    { id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-15" },
    { id: H2, cg: CG_B_ID, enr: "2026-07-15", lft: "2026-07-20" },
    { id: H3, cg: CG_B_ID, enr: "2026-07-28", lft: null },  // 7/28부터 복귀 (7/20~7/26 주간 미포함)
  ]);
  await db.execute(sql.raw(`DELETE FROM attendance WHERE student_id = '${ST_ID}'`));
  await db.execute(sql.raw(`
    INSERT INTO attendance (id, student_id, class_group_id, swimming_pool_id, date, status, created_at)
    VALUES ('att1_${TS}', '${ST_ID}', '${CG_A_ID}', '${POOL_ID}', '2026-07-10', 'present', now()),
           ('att2_${TS}', '${ST_ID}', '${CG_B_ID}', '${POOL_ID}', '2026-07-15', 'absent', now())
  `));

  const wk7a = await api("GET", `/attendance/weekly?start_date=2026-07-13`, T);
  const wk7aData: any[] = wk7a.body?.data ?? [];
  const stRows7a = wk7aData.filter((d: any) => d.student_id === ST_ID);
  const bRow = stRows7a.find((d: any) => d.class_group_id === CG_B_ID);
  r("TEST7-a: B반 7/15 출결 포함 (absent)", bRow?.days?.["2026-07-15"] === "absent", "absent", bRow?.days?.["2026-07-15"] ?? "none");

  const allD7 = stRows7a.flatMap((d: any) => Object.keys(d.days ?? {}));
  r("TEST7-b: weekly 날짜 중복 없음", allD7.length === new Set(allD7).size, "unique", `total=${allD7.length}`);

  const wk20 = await api("GET", `/attendance/weekly?start_date=2026-07-20&class_group_id=${CG_B_ID}`, T);
  r("TEST7-c: 연기 기간 weekly 미포함", !(wk20.body?.data ?? []).some((d: any) => d.student_id === ST_ID), "not found", "ok");

  const wk27 = await api("GET", `/attendance/weekly?start_date=2026-07-27&class_group_id=${CG_B_ID}`, T);
  r("TEST7-d: 복귀 후 weekly 포함", (wk27.body?.data ?? []).some((d: any) => d.student_id === ST_ID), "found", "ok");

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 8: monthly ===");
  const mo8 = await api("GET", `/attendance/monthly-summary?year=2026&month=07`, T);
  const mo8rows = (mo8.body?.data ?? []).filter((d: any) => d.student_id === ST_ID);
  const totalPres = mo8rows.reduce((a: number, d: any) => a + (d.present ?? 0), 0);
  const totalAbs  = mo8rows.reduce((a: number, d: any) => a + (d.absent ?? 0), 0);
  r("TEST8-a: monthly 출석 합계=1 (7/10만)", totalPres === 1, "1", String(totalPres));
  r("TEST8-b: monthly 결석 합계=1 (7/15만)", totalAbs === 1, "1", String(totalAbs));
  r("TEST8-c: monthly 행 ≤ 2 (A+B)", mo8rows.length <= 2, "≤2", String(mo8rows.length));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 9: 학부모 일지 — lesson_date JOIN SQL 검증 ===");
  await setHist([
    { id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: "2026-07-15" },
    { id: H2, cg: CG_B_ID, enr: "2026-07-15", lft: null },
  ]);
  const D1 = `diary1_${TS}`, D2 = `diary2_${TS}`, D3 = `diary3_${TS}`;
  // NOT NULL: class_group_id, teacher_id, teacher_name, swimming_pool_id, lesson_date, common_content
  await db.execute(sql.raw(`
    INSERT INTO class_diaries (id, class_group_id, swimming_pool_id, lesson_date, common_content, teacher_id, teacher_name, is_deleted, created_at)
    VALUES ('${D1}', '${CG_A_ID}', '${POOL_ID}', '2026-07-10', 'A반 내용', '${ADMIN_UID}', '선생님', false, now()),
           ('${D2}', '${CG_B_ID}', '${POOL_ID}', '2026-07-20', 'B반 내용', '${ADMIN_UID}', '선생님', false, now()),
           ('${D3}', '${CG_A_ID}', '${POOL_ID}', '2026-07-09', 'A반 등록전', '${ADMIN_UID}', '선생님', false, now())
  `));

  // lesson_date=text, enrolled_at/left_at=date → ::text 캐스팅으로 통일
  const d1q = await db.execute(sql.raw(`
    SELECT cd.id FROM class_diaries cd
    JOIN student_class_history sch ON sch.class_group_id=cd.class_group_id AND sch.student_id='${ST_ID}'
      AND sch.enrolled_at::text<=cd.lesson_date AND (sch.left_at IS NULL OR sch.left_at::text>cd.lesson_date)
    WHERE cd.id='${D1}' AND cd.is_deleted=false
  `));
  r("TEST9-a: A반 7/10 일지 조회됨 (이전 반)", d1q.rows.length === 1, "1", String(d1q.rows.length));

  const d2q = await db.execute(sql.raw(`
    SELECT cd.id FROM class_diaries cd
    JOIN student_class_history sch ON sch.class_group_id=cd.class_group_id AND sch.student_id='${ST_ID}'
      AND sch.enrolled_at::text<=cd.lesson_date AND (sch.left_at IS NULL OR sch.left_at::text>cd.lesson_date)
    WHERE cd.id='${D2}' AND cd.is_deleted=false
  `));
  r("TEST9-b: B반 7/20 일지 조회됨 (현재 반)", d2q.rows.length === 1, "1", String(d2q.rows.length));

  const d3q = await db.execute(sql.raw(`
    SELECT cd.id FROM class_diaries cd
    JOIN student_class_history sch ON sch.class_group_id=cd.class_group_id AND sch.student_id='${ST_ID}'
      AND sch.enrolled_at::text<=cd.lesson_date AND (sch.left_at IS NULL OR sch.left_at::text>cd.lesson_date)
    WHERE cd.id='${D3}' AND cd.is_deleted=false
  `));
  r("TEST9-c: 등록 전(7/9) 일지 미노출", d3q.rows.length === 0, "0", String(d3q.rows.length));

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 10: 학부모 출결 — history JOIN SQL 검증 ===");
  await db.execute(sql.raw(`DELETE FROM attendance WHERE student_id = '${ST_ID}'`));
  await db.execute(sql.raw(`
    INSERT INTO attendance (id, student_id, class_group_id, swimming_pool_id, date, status, created_at)
    VALUES ('att_a_${TS}', '${ST_ID}', '${CG_A_ID}', '${POOL_ID}', '2026-07-10', 'present', now()),
           ('att_b_${TS}', '${ST_ID}', '${CG_B_ID}', '${POOL_ID}', '2026-07-20', 'present', now())
  `));

  // enrolled_at(date) vs a.date(text) — ::text 캐스팅으로 타입 통일
  const attJoin = await db.execute(sql.raw(`
    SELECT a.id, a.date, a.class_group_id FROM attendance a
    JOIN student_class_history sch
      ON sch.student_id=a.student_id AND sch.class_group_id=a.class_group_id
      AND sch.enrolled_at::text<=a.date AND (sch.left_at IS NULL OR sch.left_at::text>a.date)
    WHERE a.student_id='${ST_ID}' AND a.class_group_id IS NOT NULL
    ORDER BY a.date
  `));
  r("TEST10-a: 출결 history JOIN = 2건", attJoin.rows.length === 2, "2", String(attJoin.rows.length));
  r("TEST10-b: A반 7/10 출결 포함", (attJoin.rows as any[]).some(a => String(a.date).includes("2026-07-10")), "7/10", "ok");
  r("TEST10-c: B반 7/20 출결 포함", (attJoin.rows as any[]).some(a => String(a.date).includes("2026-07-20")), "7/20", "ok");

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 11: 즉시 푸시 — history JOIN 쿼리 정합성 ===");
  await setHist([{ id: H1, cg: CG_A_ID, enr: "2026-07-10", lft: null }]);
  const pushQ = await db.execute(sql.raw(`
    SELECT COUNT(DISTINCT ps.parent_id) AS cnt
    FROM parent_students ps
    JOIN student_class_history sch ON sch.student_id=ps.student_id
      AND sch.class_group_id='${CG_A_ID}'
      AND sch.enrolled_at<='2026-07-10'
      AND (sch.left_at IS NULL OR sch.left_at>'2026-07-10')
    JOIN students s ON s.id=ps.student_id
    WHERE ps.status='approved' AND s.deleted_at IS NULL
  `));
  r("TEST11: 즉시 푸시 쿼리 실행 성공", true, "query ok", `cnt=${(pushQ.rows[0] as any)?.cnt}`);

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 12: 예약 푸시 — history JOIN 쿼리 정합성 ===");
  const pushQ2 = await db.execute(sql.raw(`
    SELECT COUNT(DISTINCT ps.parent_id) AS cnt
    FROM parent_students ps
    JOIN student_class_history sch ON sch.student_id=ps.student_id
      AND sch.class_group_id='${CG_A_ID}'
      AND sch.enrolled_at<='2026-07-20'
      AND (sch.left_at IS NULL OR sch.left_at>'2026-07-20')
    JOIN students s ON s.id=ps.student_id
    WHERE ps.status='approved' AND s.deleted_at IS NULL
  `));
  r("TEST12: 예약 푸시 쿼리 실행 성공", true, "query ok", `cnt=${(pushQ2.rows[0] as any)?.cnt}`);

  // ═══════════════════════════════════════════════════════
  console.log("\n=== TEST 13: 회귀 — 기존 API 정상 응답 ===");
  const h = await fetch("http://localhost:8080/api/health");
  r("TEST13-a: 헬스체크 200", h.status === 200, "200", String(h.status));

  const cgRes = await api("GET", `/class-groups`, T);
  r("TEST13-b: class-groups API 200", cgRes.status === 200, "200", String(cgRes.status));

  const wkRes = await api("GET", `/attendance/weekly-summary?start_date=2026-07-13`, T);
  r("TEST13-c: weekly-summary API 200", wkRes.status === 200, "200", String(wkRes.status));

  const moRes = await api("GET", `/attendance/monthly-summary?year=2026&month=07`, T);
  r("TEST13-d: monthly-summary API 200", moRes.status === 200, "200", String(moRes.status));

  const tsRes = await api("GET", `/today-schedule?date=2026-07-20`, T);
  r("TEST13-e: today-schedule API 200", tsRes.status === 200, "200", String(tsRes.status));

  // ─── 최종 보고 ─────────────────────────────────────────────────────────
  console.log("\n\n════════════════════════════════════════");
  console.log("         최 종  테 스 트  결 과");
  console.log("════════════════════════════════════════");
  let pass = 0, fail = 0;
  for (const res of results) {
    const mk = res.pass ? "✅" : "❌";
    console.log(`${mk}  ${res.test}`);
    if (!res.pass) console.log(`     기대: ${res.expected}  실제: ${res.actual}`);
    res.pass ? pass++ : fail++;
  }
  console.log(`\n────────────────────────────────────────`);
  console.log(`PASS: ${pass}  FAIL: ${fail}  전체: ${results.length}`);
  console.log(`════════════════════════════════════════\n`);

  await cleanup();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("테스트 오류:", e.cause?.message ?? e.message ?? e);
  await cleanup().catch(() => {});
  process.exit(1);
});
