/**
 * 중복 학생 진단 스크립트
 * pnpm --filter @workspace/api-server exec tsx src/scripts/diagnose-duplicates.ts
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function checkCount(table: string, col: string, id: string): Promise<number> {
  try {
    const [r] = (await db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM ${table} WHERE ${col} = '${id}'`))).rows as any[];
    return parseInt(r?.cnt ?? "0", 10);
  } catch {
    return -1; // 컬럼 없음
  }
}

async function main() {
  const targets = ["전하빈", "박찬율"];

  for (const name of targets) {
    console.log("\n" + "=".repeat(60));
    console.log(`▶ 학생 이름: ${name}`);
    console.log("=".repeat(60));

    const students = (await db.execute(sql`
      SELECT
        s.id, s.name, s.status, s.swimming_pool_id,
        s.parent_user_id, s.parent_phone, s.parent_phone2, s.parent_phone3,
        s.class_group_id, s.created_at,
        sp.name AS pool_name
      FROM students s
      LEFT JOIN swimming_pools sp ON sp.id = s.swimming_pool_id
      WHERE s.name = ${name}
        AND s.status NOT IN ('archived','deleted')
      ORDER BY s.created_at ASC
    `)).rows as any[];

    console.log(`  ▸ 총 ${students.length}명의 학생 레코드 발견`);

    for (const s of students) {
      console.log(`\n  [student id=${s.id}]`);
      console.log(`    name     : ${s.name}`);
      console.log(`    status   : ${s.status}`);
      console.log(`    pool     : ${s.pool_name} (${s.swimming_pool_id})`);
      console.log(`    phone1   : ${s.parent_phone || "—"}`);
      console.log(`    phone2   : ${s.parent_phone2 || "—"}`);
      console.log(`    phone3   : ${s.parent_phone3 || "—"}`);
      console.log(`    parent_user_id: ${s.parent_user_id || "—"}`);
      console.log(`    class_group_id: ${s.class_group_id || "—"}`);
      console.log(`    created_at: ${s.created_at}`);

      // parent_students 연결 확인
      const psRows = (await db.execute(sql`
        SELECT ps.id, ps.parent_id, ps.status, pa.name AS parent_name, pa.phone AS parent_phone
        FROM parent_students ps
        LEFT JOIN parent_accounts pa ON pa.id = ps.parent_id
        WHERE ps.student_id = ${s.id}
      `)).rows as any[];
      console.log(`    parent_students (${psRows.length}개):`);
      psRows.forEach(r => console.log(`      → [${r.id}] parent=${r.parent_name}(${r.parent_phone}) status=${r.status}`));

      // 출결
      const attCnt = await checkCount("attendance", "student_id", s.id);
      console.log(`    attendance: ${attCnt < 0 ? "컬럼없음" : attCnt + "건"}`);

      // 일지 (swim_diary는 student_id 없음 — class_group_id 기반)
      const diaryCnt = await checkCount("swim_diary", "student_id", s.id);
      if (diaryCnt >= 0) {
        console.log(`    swim_diary: ${diaryCnt}건`);
      } else {
        console.log(`    swim_diary: (student_id 없음 — class 기반)`);
      }

      // 사진
      const photoCnt = await checkCount("student_photos", "student_id", s.id);
      console.log(`    student_photos: ${photoCnt < 0 ? "컬럼없음" : photoCnt + "건"}`);

      // 반 배정 이력
      const histCnt = await checkCount("student_class_history", "student_id", s.id);
      console.log(`    student_class_history: ${histCnt < 0 ? "컬럼없음" : histCnt + "건"}`);

      // 수업 요청
      const reqCnt = await checkCount("parent_student_requests", "student_id", s.id);
      console.log(`    parent_student_requests: ${reqCnt < 0 ? "컬럼없음" : reqCnt + "건"}`);

      // student_registration_requests
      const regCnt = await checkCount("student_registration_requests", "student_id", s.id);
      console.log(`    student_registration_requests: ${regCnt < 0 ? "컬럼없음" : regCnt + "건"}`);

      // v2 pending
      const pendingRows = (await db.execute(sql`
        SELECT id, parent_id, status, pending_reason FROM parent_v2_pending WHERE matched_student_id = ${s.id}
      `)).rows as any[];
      console.log(`    parent_v2_pending: ${pendingRows.length}건`);
    }
  }

  // parent_v2_pending 전체 현황
  console.log("\n" + "=".repeat(60));
  console.log("▶ parent_v2_pending 전체 현황 (status=pending)");
  console.log("=".repeat(60));
  const pending = (await db.execute(sql`
    SELECT pvp.id, pvp.parent_id, pvp.pool_id, pvp.child_name_raw, pvp.status,
           pvp.pending_reason, pvp.matched_student_id, pvp.created_at,
           pa.name AS parent_name, pa.phone AS parent_phone
    FROM parent_v2_pending pvp
    LEFT JOIN parent_accounts pa ON pa.id = pvp.parent_id
    ORDER BY pvp.created_at DESC
    LIMIT 20
  `)).rows as any[];
  if (pending.length === 0) {
    console.log("  (없음)");
  } else {
    pending.forEach(r => {
      console.log(`  [${r.id}] ${r.parent_name}(${r.parent_phone}) → 학생:"${r.child_name_raw}" status=${r.status} reason=${r.pending_reason || "—"}`);
    });
  }

  console.log("\n진단 완료.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
