import { superAdminDb } from "@workspace/db";
import { sql } from 'drizzle-orm';

// 1. swimming_pool_id 보유 테이블 전체 목록
// 2. pool_id 보유 테이블 전체 목록
// 3. review_required 4개 테이블 컬럼 상세
async function main() {
  const spid = await superAdminDb.execute(sql.raw(`
    SELECT table_name FROM information_schema.columns
    WHERE column_name='swimming_pool_id' AND table_schema='public' ORDER BY table_name
  `));
  console.log("\n=== swimming_pool_id 보유 테이블 ===");
  console.log(spid.rows.map((r:any)=>r.table_name).join(", "));

  const pid = await superAdminDb.execute(sql.raw(`
    SELECT table_name FROM information_schema.columns
    WHERE column_name='pool_id' AND table_schema='public' ORDER BY table_name
  `));
  console.log("\n=== pool_id 보유 테이블 ===");
  console.log(pid.rows.map((r:any)=>r.table_name).join(", "));

  // review_required 4개 테이블 컬럼
  const reviewTables = ['manual_handover_makeups','parent_pool_requests','student_registration_requests','swim_diary'];
  for (const t of reviewTables) {
    const cols = await superAdminDb.execute(sql.raw(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name='${t}' AND table_schema='public'
      ORDER BY ordinal_position
    `));
    console.log(`\n[${t}]`);
    if (cols.rows.length === 0) { console.log("  (테이블 없음)"); continue; }
    cols.rows.forEach((c:any) => console.log(`  ${c.column_name} | ${c.data_type} | nullable:${c.is_nullable}`));
  }

  // parent_accounts, parent_students 컬럼
  for (const t of ['parent_accounts','parent_students']) {
    const cols = await superAdminDb.execute(sql.raw(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name='${t}' AND table_schema='public' ORDER BY ordinal_position
    `));
    console.log(`\n[${t}]`);
    if (cols.rows.length === 0) { console.log("  (테이블 없음)"); continue; }
    cols.rows.forEach((c:any) => console.log(`  ${c.column_name} | ${c.data_type}`));
  }

  // class_diary_student_notes 컬럼 재확인
  const dsn = await superAdminDb.execute(sql.raw(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='class_diary_student_notes' AND table_schema='public' ORDER BY ordinal_position
  `));
  console.log("\n[class_diary_student_notes]", dsn.rows.map((r:any)=>r.column_name).join(", "));

  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
