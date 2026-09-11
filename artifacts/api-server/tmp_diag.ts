import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.SUPABASE_DATABASE_URL });

// 1. 전체 상태 분포
const all = await p.query(`SELECT product_status, COUNT(*) FROM growth_reports WHERE deleted_at IS NULL GROUP BY product_status ORDER BY count DESC`);
console.log("전체 상태 분포:", JSON.stringify(all.rows));

// 2. FAILED 건들의 pool별 분포
const failed = await p.query(`SELECT swimming_pool_id, report_period, COUNT(*) FROM growth_reports WHERE product_status='FAILED' AND deleted_at IS NULL GROUP BY swimming_pool_id, report_period ORDER BY report_period DESC, count DESC`);
console.log("FAILED 분포:", JSON.stringify(failed.rows));

// 3. 배치 발급 스케줄 — 이번달 리포트가 자동생성 됐는지
const thisMonth = await p.query(`SELECT report_period, COUNT(*), MIN(created_at) as first_created FROM growth_reports WHERE report_period IN ('2026-07','2026-08') AND deleted_at IS NULL GROUP BY report_period ORDER BY report_period`);
console.log("월별 생성 현황:", JSON.stringify(thisMonth.rows));

// 4. 분석 완료 현황 (REVIEW_REQUIRED or READY_TO_SEND)
const done = await p.query(`SELECT product_status, report_period, COUNT(*) FROM growth_reports WHERE product_status IN ('REVIEW_REQUIRED','READY_TO_SEND','SENT') AND deleted_at IS NULL GROUP BY product_status, report_period ORDER BY report_period DESC`);
console.log("완료/발송 현황:", JSON.stringify(done.rows));

await p.end();
