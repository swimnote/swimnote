import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const q = async (sql: string) => (await pool.query(sql)).rows;
const check = async (t: string) => {
  const r = await q(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}')`);
  const exists = (r[0] as any).exists;
  console.log(`  ${exists ? '✅' : '❌'} ${t}`);
  return exists;
};
const countAll = await q("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'");
console.log("Total tables:", (countAll[0] as any).count);
await check("push_logs");
await check("support_cases");
await check("support_case_notes");
await check("support_knowledge_items");

// Check if diagnose expected list has a bug
const pushLogsExists = await q("SELECT column_name FROM information_schema.columns WHERE table_name='push_logs' AND table_schema='public'");
console.log("push_logs columns:", pushLogsExists.map((r: any) => r.column_name).join(", ") || "TABLE DOES NOT EXIST");
const scExists = await q("SELECT column_name FROM information_schema.columns WHERE table_name='support_cases' AND table_schema='public' LIMIT 5");
console.log("support_cases columns (first 5):", scExists.map((r: any) => r.column_name).join(", ") || "TABLE DOES NOT EXIST");

await pool.end();
