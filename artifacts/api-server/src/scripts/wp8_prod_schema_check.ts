import pg from "pg";
const { Pool } = pg;

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) { console.log("NO_SUPABASE_URL"); process.exit(0); }

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
const client = await pool.connect();

try {
  // support_cases columns
  const cols = (await client.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'support_cases'
    ORDER BY ordinal_position
  `)).rows;
  console.log("SUPPORT_CASES_COLS:", JSON.stringify(cols.map((r:any) => r.column_name)));

  // WP8 new cols
  const wp8Cols = ["title","category","subject_type","subject_id","assigned_operator","resolution","ops_status","created_by_admin"];
  const presentCols = cols.map((r:any) => r.column_name);
  for (const c of wp8Cols) {
    console.log(`WP8_COL_${c}: ${presentCols.includes(c) ? "PRESENT" : "MISSING"}`);
  }

  // support_case_notes table
  const notes = (await client.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name='support_case_notes'
  `)).rows;
  console.log("support_case_notes:", notes.length > 0 ? "PRESENT" : "MISSING");

  // WP8 indexes
  const idxNames = ["sc_pool_status_idx","sc_pool_created_idx","sc_ticket_idx","sc_subject_idx","scn_case_id_idx","al_pool_created_idx","al_actor_created_idx","al_entity_idx"];
  const existingIdxRows = (await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE indexname = ANY($1)
  `, [idxNames])).rows.map((r:any) => r.indexname);
  for (const idx of idxNames) {
    console.log(`IDX_${idx}: ${existingIdxRows.includes(idx) ? "PRESENT" : "MISSING"}`);
  }

  // Row counts
  const sc_count = (await client.query(`SELECT COUNT(*) AS c FROM support_cases`)).rows[0].c;
  const scn_count = (await client.query(`SELECT COUNT(*) AS c FROM support_case_notes`)).rows[0].c;
  console.log(`support_cases_row_count: ${sc_count}`);
  console.log(`support_case_notes_row_count: ${scn_count}`);

  // ops_status distribution (READ-ONLY)
  const dist = (await client.query(`
    SELECT ops_status, COUNT(*) AS c FROM support_cases GROUP BY ops_status
  `)).rows;
  console.log("ops_status_dist:", JSON.stringify(dist));

} finally {
  client.release();
  await pool.end();
}
