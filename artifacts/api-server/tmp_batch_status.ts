import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });
const POOL_ID = "pool_1780849364252_l9k44rbk3";

const job = await pool.query(`
  SELECT id, status, target_count, completed_count, failed_count,
         attempts, started_at, completed_at, updated_at
  FROM growth_report_batch_jobs
  WHERE swimming_pool_id=$1 AND year=2026 AND month=9 AND job_type='MONTHLY_AUTO'
`, [POOL_ID]);
console.log("배치잡:", JSON.stringify(job.rows[0], null, 2));

// 리포트 상태 현황
const reports = await pool.query(`
  SELECT product_status, COUNT(*) FROM growth_reports
  WHERE swimming_pool_id=$1 AND report_period='2026-08' AND deleted_at IS NULL
  GROUP BY product_status ORDER BY product_status
`, [POOL_ID]);
console.log("리포트 현황:", reports.rows);

// 현재 PREANALYZING / ANALYZING 중인 건 (진행 중)
const inProgress = await pool.query(`
  SELECT product_status, COUNT(*) FROM growth_reports
  WHERE swimming_pool_id=$1 AND report_period='2026-08' AND deleted_at IS NULL
    AND product_status NOT IN ('OPEN','REVIEW_REQUIRED','READY_TO_SEND','PUBLISHED','CANCELLED')
  GROUP BY product_status
`, [POOL_ID]);
console.log("진행중:", inProgress.rows);

await pool.end();
