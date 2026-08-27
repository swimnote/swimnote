/**
 * unit-econ-fix.ts — 수정 쿼리: Support AI 재집계 + Growth Report 상세
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function q(label: string, query: string) {
  try {
    const r = await superAdminDb.execute(sql.raw(query));
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e: any) {
    console.log(`\n=== ${label} === ERROR: ${e.message?.slice(0,300)}`);
  }
}

async function main() {
  await superAdminDb.execute(sql`SET default_transaction_read_only = on`);

  // Support AI 정확한 재집계 (NULL 제외)
  await q("SUPPORT_AI_FULL_RECHECK", `
    SELECT
      COUNT(*) as total_rows,
      COUNT(CASE WHEN (metadata->>'estimated_cost_usd') IS NOT NULL THEN 1 END) as rows_with_cost,
      COUNT(CASE WHEN (metadata->>'estimated_cost_usd')::numeric > 0 THEN 1 END) as rows_nonzero_cost,
      SUM((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as sum_usd,
      AVG((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as avg_usd,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as p50_usd,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as p90_usd,
      MIN((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as min_usd,
      MAX((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as max_usd
    FROM event_logs
    WHERE category='AI' AND metadata->>'feature'='support_ai'
  `);

  // Support AI 개별 로우 확인 (NULL 포함 여부)
  await q("SUPPORT_AI_COST_DISTRIBUTION", `
    SELECT
      metadata->>'status' as status,
      COUNT(*) as cnt,
      SUM((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as sum_usd,
      AVG((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as avg_usd
    FROM event_logs
    WHERE category='AI' AND metadata->>'feature'='support_ai'
    GROUP BY 1
    ORDER BY cnt DESC
  `);

  // Support AI token 상세
  await q("SUPPORT_AI_TOKENS", `
    SELECT
      AVG((metadata->>'input_tokens')::int)::int as avg_input,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (metadata->>'input_tokens')::int)::int as p50_input,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (metadata->>'input_tokens')::int)::int as p90_input,
      AVG((metadata->>'output_tokens')::int)::int as avg_output,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (metadata->>'output_tokens')::int)::int as p90_output
    FROM event_logs
    WHERE category='AI' AND metadata->>'feature'='support_ai'
      AND (metadata->>'input_tokens') IS NOT NULL
  `);

  // Growth Report AI 전체 event_logs 상세
  await q("GROWTH_AI_ALL_ROWS", `
    SELECT
      metadata->>'sub_feature' as sub_feature,
      metadata->>'status' as status,
      metadata->>'service' as service,
      COUNT(*) as cnt,
      COUNT(CASE WHEN (metadata->>'estimated_cost_usd') IS NOT NULL THEN 1 END) as rows_with_cost,
      SUM((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as sum_usd,
      AVG((metadata->>'actual_call_count')::int)::numeric(4,2) as avg_actual_calls
    FROM event_logs
    WHERE category='AI' AND metadata->>'feature'='growth_report_ai'
    GROUP BY 1,2,3
    ORDER BY cnt DESC
  `);

  // Diary AI 재집계 (최근 30일 실제 pool만, test 제외)
  await q("DIARY_AI_PROD_ONLY_30D", `
    SELECT
      pool_id,
      COUNT(*) as calls,
      AVG((metadata->>'input_tokens')::int)::int as avg_input,
      AVG((metadata->>'output_tokens')::int)::int as avg_output,
      AVG((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as avg_cost_usd,
      SUM((metadata->>'estimated_cost_usd')::numeric)::numeric(12,8) as sum_cost_usd,
      AVG((metadata->>'student_count')::int)::numeric(4,1) as avg_student_count
    FROM event_logs
    WHERE category='AI'
      AND metadata->>'feature'='teacher_diary'
      AND metadata->>'status'='SUCCESS'
      AND pool_id NOT LIKE 'pool-test%'
      AND created_at > NOW() - INTERVAL '30 days'
    GROUP BY pool_id
    ORDER BY calls DESC
  `);

  // R2 스토리지: 90일 신규 bytes 정확히
  await q("PHOTO_GROWTH_90D", `
    SELECT
      COUNT(*) as new_photos_90d,
      SUM(file_size) as new_bytes_90d,
      AVG(file_size)::bigint as avg_bytes,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY file_size)::bigint as p90_bytes
    FROM photo_assets_meta
    WHERE created_at > NOW() - INTERVAL '90 days'
  `);

  // Growth Report 수 — pool별 + 기간별 상세
  await q("GROWTH_REPORTS_DETAIL", `
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN product_status='PUBLISHED' THEN 1 END) as published,
      COUNT(CASE WHEN product_status='OPEN' THEN 1 END) as open_cnt,
      MIN(created_at) as oldest,
      MAX(created_at) as newest,
      COUNT(DISTINCT pool_id) as pool_count
    FROM growth_reports
  `);

  console.log("\n=== FIX COMPLETE ===");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
