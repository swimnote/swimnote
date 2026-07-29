/**
 * 날짜별 today-schedule 버그 검증 (prod API 직접 호출)
 * 실행: pnpm --filter @workspace/api-server exec tsx src/scripts/date-bug-test.ts
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";

const BASE = "https://swimnote-api.onrender.com/api";
const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) throw new Error("JWT_SECRET 없음");

async function callApi(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  try { return await res.json(); } catch { return {}; }
}

async function main() {
  // 1. pool + teacher 조회
  const pools = (await superAdminDb.execute(sql.raw(
    `SELECT id, name FROM swimming_pools WHERE approval_status='approved' AND subscription_status='active' LIMIT 1`
  ))).rows as any[];
  if (!pools.length) { console.log("pool 없음"); return; }
  const pool = pools[0];
  console.log(`Pool: ${pool.name} (${pool.id})`);

  // 2. teacher 찾기
  const teacherRow = (await superAdminDb.execute(sql.raw(
    `SELECT DISTINCT u.id, u.email FROM users u
     JOIN class_groups cg ON cg.teacher_user_id = u.id
     WHERE cg.swimming_pool_id = '${pool.id}' AND cg.is_deleted = false LIMIT 1`
  ))).rows[0] as any;
  if (!teacherRow) { console.log("teacher 없음"); return; }
  console.log(`Teacher: ${teacherRow.email} (${teacherRow.id})`);

  const token = jwt.sign(
    { userId: teacherRow.id, role: "teacher", poolId: pool.id, tv: 1 },
    JWT_SECRET, { expiresIn: "1h" }
  );

  // 3. 최근 enrolled 학생 조회 (7/15 이후)
  console.log("\n=== 7/15 이후 history ===");
  const recentRows = (await superAdminDb.execute(sql.raw(`
    SELECT h.student_id, h.class_group_id, h.enrolled_at::text, h.left_at::text, s.name
    FROM student_class_history h
    JOIN students s ON s.id = h.student_id
    WHERE h.swimming_pool_id = '${pool.id}' AND h.enrolled_at >= '2026-07-15'
    ORDER BY h.enrolled_at DESC LIMIT 10
  `))).rows as any[];

  if (recentRows.length === 0) {
    console.log("  7/15 이후 enrolled 학생 없음");
  } else {
    for (const r of recentRows) {
      console.log(`  ${r.name}: enrolled=${r.enrolled_at}, left=${r.left_at ?? "null"}, class=${r.class_group_id.slice(-6)}`);
    }
  }

  // 4. 날짜별 today-schedule API 비교
  const testDates = ["2026-06-15", "2026-07-15", "2026-07-20"];
  console.log("\n=== 날짜별 today-schedule 비교 ===");
  const studentsByDate: Record<string, Set<string>> = {};

  for (const date of testDates) {
    const data = await callApi(`/today-schedule?date=${date}`, token);
    const classes = Array.isArray(data) ? data : (data?.data ?? []);
    const names = classes.flatMap((c: any) => (c.students ?? []).map((s: any) => `${s.name}(${c.name})`));
    studentsByDate[date] = new Set((classes.flatMap((c: any) => (c.students ?? []).map((s: any) => s.id))));
    console.log(`  ${date}: ${classes.length}개 수업, ${names.length}명 [${names.join(", ")}]`);
  }

  // 5. 6월에도 있고 7/20에도 있는 학생 (정상)
  const juneSet = studentsByDate["2026-06-15"];
  const julySet = studentsByDate["2026-07-20"];
  if (juneSet && julySet) {
    const overlap = [...juneSet].filter(id => julySet.has(id));
    console.log(`\n  6/15 & 7/20 모두 있는 학생: ${overlap.length}명`);
    
    // 이들의 enrolled_at 확인
    if (overlap.length > 0) {
      const checkRows = (await superAdminDb.execute(sql.raw(`
        SELECT h.student_id, h.enrolled_at::text, s.name
        FROM student_class_history h
        JOIN students s ON s.id = h.student_id
        WHERE h.student_id IN (${overlap.map(id => `'${id}'`).join(",")})
          AND h.swimming_pool_id = '${pool.id}'
        ORDER BY h.enrolled_at DESC
      `))).rows as any[];
      for (const r of checkRows) {
        const isOld = r.enrolled_at < "2026-07-15";
        console.log(`  ${r.name}: enrolled=${r.enrolled_at} ${isOld ? "(올바름 - 오래전 등록)" : "(⚠️  최근 등록 - 6월에 표시되면 버그!)"}`);
      }
    }
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
