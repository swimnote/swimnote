import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });

// 1. X-eligible 전체 pool 수 및 active 학생 수
const eligible = await p.query(`
  SELECT COUNT(DISTINCT sp.id) AS pool_count,
         COUNT(DISTINCT s.id)  AS student_count
  FROM swimming_pools sp
  JOIN x_pool_subscriptions xps ON xps.pool_id = sp.id AND xps.status IN ('ACTIVE','TRIAL')
  JOIN students s ON s.swimming_pool_id = sp.id AND s.status = 'active' AND s.deleted_at IS NULL
  WHERE sp.deleted_at IS NULL
`);
console.log("X-eligible:", eligible.rows[0]);

// 2. 이번달(2026-09) 자동 배치 잡 생성 여부
const sep = await p.query(`
  SELECT id, swimming_pool_id, status, total_count, completed_count, failed_count, created_at
  FROM growth_report_batch_jobs
  WHERE year = 2026 AND month = 9 AND job_type = 'MONTHLY_AUTO'
  ORDER BY created_at DESC LIMIT 5
`);
console.log("9월 배치잡:", JSON.stringify(sep.rows));

// 3. 전체 리포트 월별·상태별 현황
const summary = await p.query(`
  SELECT report_period, product_status, COUNT(*) 
  FROM growth_reports 
  WHERE deleted_at IS NULL
  GROUP BY report_period, product_status
  ORDER BY report_period DESC, product_status
`);
console.log("전체 현황:", JSON.stringify(summary.rows));

// 4. 최근 1시간 / 10분 처리 속도
const speed1h = await p.query(`
  SELECT COUNT(*) AS cnt FROM growth_reports
  WHERE updated_at >= NOW() - INTERVAL '1 hour'
    AND product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','QUESTION_AVAILABLE')
    AND deleted_at IS NULL
`);
const speed10m = await p.query(`
  SELECT COUNT(*) AS cnt FROM growth_reports
  WHERE updated_at >= NOW() - INTERVAL '10 minutes'
    AND product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','QUESTION_AVAILABLE')
    AND deleted_at IS NULL
`);
console.log("1시간 완료:", speed1h.rows[0].cnt, "/ 10분 완료:", speed10m.rows[0].cnt);

await p.end();
