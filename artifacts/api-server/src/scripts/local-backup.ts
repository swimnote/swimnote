import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import fs from "fs";

async function main() {
  console.log("🔵 로컬 백업 시작:", new Date().toISOString());

  const r = await superAdminDb.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const tables = (r.rows as { tablename: string }[]).map(x => x.tablename);
  console.log(`테이블 수: ${tables.length}`);

  const data: Record<string, unknown[]> = {};
  let total = 0;
  for (const t of tables) {
    try {
      const rows = (await superAdminDb.execute(sql.raw(`SELECT * FROM "${t}"`))).rows;
      data[t] = rows;
      total += rows.length;
      console.log(`  ${t}: ${rows.length}행`);
    } catch (e: any) {
      data[t] = [];
      console.warn(`  [WARN] ${t}: 덤프 실패 — ${e.message}`);
    }
  }

  const meta = {
    created_at: new Date().toISOString(),
    commit: "a6f742d",
    tables: tables.length,
    total_rows: total,
    note: "배포 전 수동 백업",
  };

  const payload = JSON.stringify({ meta, data }, null, 2);
  const fname = `pre-deploy-backup-${new Date().toISOString().slice(0,19).replace(/[T:]/g,"-")}.json`;
  const outPath = `/home/runner/workspace/${fname}`;
  fs.writeFileSync(outPath, payload, "utf8");

  const sizeMB = (Buffer.byteLength(payload, "utf8") / 1024 / 1024).toFixed(2);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ 백업 완료");
  console.log(`  파일: ${fname}`);
  console.log(`  크기: ${sizeMB} MB`);
  console.log(`  테이블: ${tables.length}개, 행: ${total.toLocaleString()}`);
  console.log(`  student_class_history: ${data["student_class_history"]?.length ?? "NOT_FOUND"}행`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  process.exit(0);
}

main().catch(e => {
  console.error("❌ 백업 실패:", e);
  process.exit(1);
});
