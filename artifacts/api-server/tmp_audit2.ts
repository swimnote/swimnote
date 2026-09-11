import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });

// x_pool_subscriptions 테이블 실제 이름 파악
const t = await p.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE '%pool%sub%' OR schemaname='public' AND tablename LIKE '%x_pool%'`);
console.log("pool sub 관련 테이블:", t.rows.map((r:any)=>r.tablename));

// 전체 리포트 현황 (월별+상태)
const s = await p.query(`
  SELECT report_period, product_status, COUNT(*) AS cnt
  FROM growth_reports WHERE deleted_at IS NULL
  GROUP BY report_period, product_status
  ORDER BY report_period DESC, product_status
`);
console.log("전체 리포트 현황:", JSON.stringify(s.rows));

// 최근 1시간 / 10분 완료 건수
const h = await p.query(`SELECT COUNT(*) AS cnt FROM growth_reports WHERE updated_at >= NOW()-INTERVAL '1 hour' AND product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','QUESTION_AVAILABLE') AND deleted_at IS NULL`);
const m = await p.query(`SELECT COUNT(*) AS cnt FROM growth_reports WHERE updated_at >= NOW()-INTERVAL '10 minutes' AND product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','QUESTION_AVAILABLE') AND deleted_at IS NULL`);
console.log("1시간 완료:", h.rows[0].cnt, " / 10분 완료:", m.rows[0].cnt);

// 9월 배치잡 존재 여부
const sep = await p.query(`SELECT id, status, total_count, completed_count, created_at FROM growth_report_batch_jobs WHERE year=2026 AND month=9 ORDER BY created_at DESC LIMIT 5`);
console.log("9월 배치잡:", JSON.stringify(sep.rows));

// x_subscription_slots로 eligible pool/학생 수 파악
const eligible = await p.query(`
  SELECT COUNT(DISTINCT xss.pool_id) AS pool_count
  FROM x_subscription_slots xss
  WHERE xss.status IN ('ACTIVE','TRIAL')
`);
console.log("X eligible pool(slots기준):", eligible.rows[0]);

await p.end();
