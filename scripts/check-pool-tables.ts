import { db } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";

async function cols(table: string) {
  const r = await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = ${table} ORDER BY ordinal_position
  `);
  console.log(`${table}: ${r.rows.map((c: any) => c.column_name).join(", ")}`);
}

await cols("students");
await cols("class_groups");
await cols("attendance");
await cols("parent_accounts");
process.exit(0);
