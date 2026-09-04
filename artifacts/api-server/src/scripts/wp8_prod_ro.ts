// READ-ONLY production schema check using @workspace/db buildConfig pattern
import { buildConfig } from "@workspace/db";
import pg from "pg";

const supaUrl = process.env.SUPABASE_DATABASE_URL;
if (!supaUrl) { console.log("ERROR: SUPABASE_DATABASE_URL not set"); process.exit(0); }

const pool = new pg.Pool({ connectionString: supaUrl, ssl: { rejectUnauthorized: false }, max: 1 });
const client = await pool.connect();
try {
  const cols = (await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='support_cases' ORDER BY ordinal_position`
  )).rows.map((r:any) => r.column_name as string);
  console.log("ALL_COLS:", cols.join(","));

  const wp8Needed = ["title","category","subject_type","subject_id","assigned_operator","resolution","ops_status","created_by_admin"];
  const present = wp8Needed.filter(c => cols.includes(c));
  const missing = wp8Needed.filter(c => !cols.includes(c));
  console.log("WP8_COLS_PRESENT:", present.join(",") || "NONE");
  console.log("WP8_COLS_MISSING:", missing.join(",") || "NONE");

  const notesExists = (await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name='support_case_notes'`
  )).rows.length > 0;
  console.log("support_case_notes:", notesExists ? "PRESENT" : "MISSING");

  const wp8Idxs = ["sc_pool_status_idx","sc_pool_created_idx","sc_ticket_idx","sc_subject_idx","scn_case_id_idx","al_pool_created_idx","al_actor_created_idx","al_entity_idx"];
  const existIdx = (await client.query(
    `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)`, [wp8Idxs]
  )).rows.map((r:any) => r.indexname as string);
  const missingIdx = wp8Idxs.filter(i => !existIdx.includes(i));
  console.log("WP8_IDX_PRESENT:", existIdx.join(",") || "NONE");
  console.log("WP8_IDX_MISSING:", missingIdx.join(",") || "NONE");

  const scRows = (await client.query(`SELECT COUNT(*) AS c FROM support_cases`)).rows[0].c;
  const scnRows = (await client.query(`SELECT COUNT(*) AS c FROM support_case_notes`)).rows[0].c;
  console.log("support_cases_rows:", scRows);
  console.log("support_case_notes_rows:", scnRows);

  const opsDist = (await client.query(
    `SELECT ops_status, COUNT(*) AS c FROM support_cases GROUP BY ops_status ORDER BY 1`
  )).rows;
  console.log("ops_status_dist:", JSON.stringify(opsDist));

  // Check if ops_status column has NOT NULL or DEFAULT (tells us if migration already ran in past)
  const opsColDetail = (await client.query(
    `SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name='support_cases' AND column_name='ops_status'`
  )).rows;
  console.log("ops_status_col_detail:", JSON.stringify(opsColDetail));

} finally {
  client.release();
  await pool.end();
}
