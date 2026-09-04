import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

// superAdminDb connects to SUPABASE_DATABASE_URL per prod-db-connection-method.md
const db = superAdminDb;

const cols = (await db.execute(sql`
  SELECT column_name, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'support_cases'
  ORDER BY ordinal_position
`)).rows;
const colNames = cols.map((r:any)=>r.column_name as string);
console.log("ALL_SUPPORT_CASES_COLS:", colNames.join(","));

const wp8Cols = ["title","category","subject_type","subject_id","assigned_operator","resolution","ops_status","created_by_admin"];
for (const c of wp8Cols) {
  const found = cols.find((r:any)=>r.column_name===c);
  console.log(`WP8_COL_${c}: ${found ? "PRESENT (default="+found.default+")" : "MISSING"}`);
}

const notesExists = (await db.execute(sql`
  SELECT 1 FROM information_schema.tables WHERE table_name='support_case_notes'
`)).rows.length > 0;
console.log("support_case_notes_table:", notesExists ? "PRESENT" : "MISSING");

const wp8Idxs = ["sc_pool_status_idx","sc_pool_created_idx","sc_ticket_idx","sc_subject_idx","scn_case_id_idx","al_pool_created_idx","al_actor_created_idx","al_entity_idx"];
const existIdx = (await db.execute(sql`
  SELECT indexname FROM pg_indexes WHERE indexname = ANY(${wp8Idxs})
`)).rows.map((r:any)=>r.indexname as string);
const missingIdx = wp8Idxs.filter(i=>!existIdx.includes(i));
console.log("WP8_IDX_PRESENT:", existIdx.join(",") || "NONE");
console.log("WP8_IDX_MISSING:", missingIdx.join(",") || "NONE");

const scRows = (await db.execute(sql`SELECT COUNT(*) AS c FROM support_cases`)).rows[0] as any;
const scnRows = notesExists ? (await db.execute(sql`SELECT COUNT(*) AS c FROM support_case_notes`)).rows[0] as any : {c:0};
console.log("support_cases_rows:", scRows.c);
console.log("support_case_notes_rows:", scnRows.c);

const opsDist = (await db.execute(sql`
  SELECT ops_status, COUNT(*) AS c FROM support_cases GROUP BY ops_status ORDER BY 1
`)).rows;
console.log("ops_status_dist:", JSON.stringify(opsDist));
