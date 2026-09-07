/**
 * E2E 단일 report 분석 스크립트
 * Usage: tsx src/scripts/e2e-analyze-single.ts <reportId>
 */
import { superAdminDb } from "@workspace/db";
import { analyzeSingleReport } from "../jobs/growth-report-analysis-worker.js";

const reportId = process.argv[2];
if (!reportId) { console.error("Usage: tsx e2e-analyze-single.ts <reportId>"); process.exit(1); }

async function run() {
  console.log(`[E2E] Analyzing report: ${reportId}`);
  const start = Date.now();
  const result = await analyzeSingleReport(superAdminDb, reportId);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[E2E] elapsed=${elapsed}s`);
  console.log(`[E2E] result:`, JSON.stringify(result, null, 2));
  process.exit(result.product_status === 'REVIEW_REQUIRED' || result.product_status === 'READY_TO_SEND' || result.already_done ? 0 : 1);
}
run().catch(e => { console.error('[E2E] FATAL:', e.message); process.exit(1); });
