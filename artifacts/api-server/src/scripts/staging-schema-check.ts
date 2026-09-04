/**
 * staging-schema-check.ts — one-time schema inspection helper
 */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const q = async (sql: string) => (await pool.query(sql)).rows;

const classCols = await q("SELECT column_name FROM information_schema.columns WHERE table_name='class_groups' ORDER BY ordinal_position LIMIT 30");
console.log("class_groups cols:", classCols.map((r: any) => r.column_name).join(", "));

const studCols = await q("SELECT column_name FROM information_schema.columns WHERE table_name='students' ORDER BY ordinal_position LIMIT 20");
console.log("students cols:", studCols.map((r: any) => r.column_name).join(", "));

const cmCols = await q("SELECT column_name FROM information_schema.columns WHERE table_name='class_members' ORDER BY ordinal_position LIMIT 10");
console.log("class_members cols:", cmCols.map((r: any) => r.column_name).join(", "));

await pool.end();
