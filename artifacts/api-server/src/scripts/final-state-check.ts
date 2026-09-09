import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const r = await pool.query(`
    SELECT user_id, user_kind, onboarding_key, completed_version
    FROM user_onboarding_state
    WHERE user_id IN ('user_1775118427405_ey2qbn6is','user_grt_t1_1787764517649','pa_1775118392274_ydbzn9505')
    ORDER BY user_id, onboarding_key`);
  console.log("FINAL_STATE:", JSON.stringify(r.rows));
  // notify.ts GROWTH_REPORT_PUBLISHED + push 경로 요약
  const nt = await pool.query(`SELECT COUNT(*) FROM notifications WHERE type='GROWTH_REPORT_PUBLISHED'`);
  console.log("GROWTH_NOTIF_TOTAL:", nt.rows[0].count);
  const pl = await pool.query(`SELECT COUNT(*) FROM push_logs WHERE type ILIKE '%growth%'`);
  console.log("GROWTH_PUSH_LOG_TOTAL:", pl.rows[0].count);
  await pool.end();
}
run().catch(e => { console.log("ERR:", e.message); pool.end(); });
