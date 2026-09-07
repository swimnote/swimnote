/**
 * E2E 엔진 직접 디버그 스크립트
 * Usage: tsx src/scripts/e2e-debug-engine.ts
 */
import { superAdminDb } from "@workspace/db";
import { buildAnalysisSnapshot } from "../lib/growth-report-snapshot-builder.js";
import jwt from "jsonwebtoken";
import { sql } from "drizzle-orm";

const REPORT_ID     = "gr_e008a541350c488e9d998ad541b4da96";
const ENGINE_URL    = process.env.GROWTH_REPORT_ENGINE_URL!;
const ENGINE_SECRET = process.env.GROWTH_REPORT_ENGINE_SECRET!;
const POOL_ID       = "pool_1780849364252_l9k44rbk3";

async function fetchPending(db: any) {
  const rows = await db.execute(sql`
    SELECT gr.id, gr.student_id, gr.swimming_pool_id, gr.cycle_id, gr.report_period,
           gr.product_status, gr.analysis_request_id, gr.analysis_retry_count,
           gr.teacher_reviewed_by, gr.teacher_reviewed_at,
           gc.id AS cycle_db_id, gc.analysis_cutoff_at, gc.parent_input_open_at, gc.parent_input_close_at,
           gc.report_period AS cycle_report_period
    FROM growth_reports gr
    JOIN growth_report_cycles gc ON gc.id = gr.cycle_id
    WHERE gr.id = ${REPORT_ID}
  `);
  const r = (rows.rows as any[])[0];
  if (!r) throw new Error("report not found");
  const toIso = (v: any) =>
    v instanceof Date ? v.toISOString() : String(v ?? "");
  return {
    report: {
      id: r.id,
      student_id: r.student_id,
      swimming_pool_id: r.swimming_pool_id,
      cycle_id: r.cycle_id,
      report_period: r.report_period,
      product_status: r.product_status,
      analysis_request_id: r.analysis_request_id ?? null,
      analysis_retry_count: Number(r.analysis_retry_count ?? 0),
      teacher_reviewed_by: r.teacher_reviewed_by ?? null,
      teacher_reviewed_at: r.teacher_reviewed_at ?? null,
    },
    cycle: {
      id: r.cycle_db_id ?? r.cycle_id,
      analysis_from: null,
      analysis_cutoff_at: toIso(r.analysis_cutoff_at),
      parent_input_open_at: toIso(r.parent_input_open_at),
      parent_input_close_at: toIso(r.parent_input_close_at),
      report_period: r.cycle_report_period,
      timezone: "Asia/Seoul",
    },
    stage: "PREANALYSIS",
  };
}

async function run() {
  console.log("Fetching report + cycle data...");
  const pending = await fetchPending(superAdminDb);
  console.log("report status:", pending.report.product_status);

  console.log("Building analysis snapshot...");
  const { request, requestId } = await buildAnalysisSnapshot(superAdminDb, {
    report: pending.report,
    cycle: pending.cycle,
  });
  console.log("Snapshot built. requestId:", requestId);
  console.log("Snapshot context keys:", Object.keys((request as any).context ?? {}).join(", "));
  console.log("Snapshot students:", (request as any).students?.length ?? 0);
  if ((request as any).students?.[0]) {
    const s = (request as any).students[0];
    console.log("  student:", s.student_id ?? s.id);
    console.log("  diaries:", s.diaries?.length ?? 0);
    console.log("  growth_events:", s.growth_events?.length ?? 0);
    console.log("  attendance:", s.attendance?.length ?? 0);
  }

  console.log("\nCalling engine directly...");
  const serviceJwt = jwt.sign(
    { userId: "service:growth-report-worker", role: "platform_admin", poolId: POOL_ID, tv: 1 },
    ENGINE_SECRET,
    { algorithm: "HS256", expiresIn: "5m" },
  );

  const start = Date.now();
  const res = await fetch(`${ENGINE_URL}/api/v1/growth-report/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceJwt}`,
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(request),
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const body = await res.text();
  console.log(`Engine response: status=${res.status} elapsed=${elapsed}s`);
  console.log("Engine body (first 3000 chars):", body.slice(0, 3000));
}

run().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack?.split("\n").slice(0, 10).join("\n"));
  process.exit(1);
});
