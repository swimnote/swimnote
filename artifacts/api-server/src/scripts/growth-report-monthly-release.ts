/**
 * Explicit, scoped release operations. No ENGINE/recovery trigger lives here.
 * Production writes require the operator acknowledgement on every invocation.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { initGrowthReportMonthlyIntegritySchema } from "../migrations/growth-report-monthly-integrity.js";
import { backfillLegacyMonthlyTargets } from "../lib/growth-report-monthly-targets.js";
import { reconcileMonthlyCycle } from "../jobs/growth-report-monthly-readiness.js";

const [command, poolId, reportPeriod, baselinePath = "/tmp/gr-monthly-release-baseline.json"] = process.argv.slice(2);
if (!["baseline", "migration", "backfill", "status", "verify"].includes(command ?? "") ||
    !poolId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(reportPeriod ?? "")) {
  throw new Error("Usage: growth-report-monthly-release <baseline|migration|backfill|status|verify> <pool> <YYYY-MM> [baselinePath]");
}
const mutates = command === "migration" || command === "backfill";
if (mutates && process.env.GR_MONTHLY_PRODUCTION_ACK !== "approved-monthly-release") {
  throw new Error("Production acknowledgement is required for this explicit write operation");
}
const rawUrl = process.env.SUPABASE_DATABASE_URL;
if (!rawUrl) throw new Error("Production DB is not configured");
const url = new URL(rawUrl);
const user = decodeURIComponent(url.username);
if (!`${url.hostname}/${user}`.includes("mrgkiussgbbmxfnkjgqy")) {
  throw new Error("Unexpected Production DB target");
}
const client = new pg.Client({
  host: url.hostname, port: Number(url.port || 5432), user,
  password: process.env.SUPABASE_DB_PASSWORD || decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""), ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});
const fingerprint = (row: Record<string, unknown>) => createHash("sha256")
  .update(JSON.stringify(row)).digest("hex");
async function storedReports() {
  return (await client.query(`
    SELECT id, product_status, analysis_request_id, analysis_request_payload,
      analysis_response_payload, snapshot_hash, report_content, report_fact_package, sns_summary,
      analysis_call_started_at
    FROM growth_reports
    WHERE swimming_pool_id=$1 AND report_period=$2
      AND deleted_at IS NULL AND product_status <> 'DISCARDED'
    ORDER BY id
  `, [poolId, reportPeriod])).rows;
}
function successFingerprint(row: Record<string, unknown>) {
  // Legitimate later withdrawal may alter product status, never content or
  // paid-call identity. Explicit dispatch boundary is tracked separately.
  const { product_status: _status, analysis_call_started_at: _boundary, ...preserved } = row;
  return fingerprint(preserved);
}

await client.connect();
const db: any = drizzle(client);
async function executeOperation(executor: any) {
  if (command === "baseline") {
    // Before migration the new boundary column does not exist.
    const rows = (await client.query(`
      SELECT id,product_status,analysis_request_id,analysis_request_payload,
        analysis_response_payload,snapshot_hash,report_content,report_fact_package,sns_summary
      FROM growth_reports WHERE swimming_pool_id=$1 AND report_period=$2
        AND deleted_at IS NULL AND product_status <> 'DISCARDED' ORDER BY id
    `, [poolId, reportPeriod])).rows;
    const successes = rows.filter(row => ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"].includes(row.product_status));
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.product_status] = (counts[row.product_status] ?? 0) + 1;
    await writeFile(baselinePath, JSON.stringify({
      captured_at: new Date().toISOString(), pool_id: poolId, report_period: reportPeriod, counts,
      successes: successes.map(row => ({ id: row.id, status: row.product_status, fingerprint: successFingerprint(row) })),
      failures: rows.filter(row => row.product_status === "FAILED").map(row => ({
        id: row.id, request_id: row.analysis_request_id, payload_fingerprint: fingerprint(row.analysis_request_payload),
      })),
    }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ operation: command, pool_id: poolId, report_period: reportPeriod, counts, success_count: successes.length }));
  } else if (command === "migration") {
    await db.transaction(async (tx: any) => {
      await tx.execute((await import("drizzle-orm")).sql.raw("SET LOCAL lock_timeout = '15s'"));
      await initGrowthReportMonthlyIntegritySchema(tx);
    });
    const check = await client.query(`
      SELECT to_regclass('growth_report_eligible_targets') AS target_table,
        (SELECT count(*)::int FROM information_schema.columns
         WHERE table_name='growth_report_cycles'
           AND column_name IN ('eligible_total','eligibility_sealed_at','ready_at')) AS cycle_fields,
        (SELECT count(*)::int FROM information_schema.columns
         WHERE table_name='growth_reports'
           AND column_name IN ('analysis_claim_token','analysis_lease_until',
             'analysis_next_attempt_at','analysis_call_started_at','analysis_uncertain_at')) AS report_fields
    `);
    console.log(JSON.stringify({ operation: command, result: check.rows[0] }));
  } else if (command === "backfill") {
    const manifest = await backfillLegacyMonthlyTargets(db, { poolId, reportPeriod });
    console.log(JSON.stringify({
      operation: command, cycle_id: manifest.cycleId, eligible_total: manifest.eligibleTotal,
      sources: [...new Set(manifest.targets.map(target => target.sourceProvenance))],
    }));
  } else if (command === "status") {
    // Reconciliation's read-only mode must not mark policy/READY or enqueue PUSH.
    const readiness = await reconcileMonthlyCycle(executor, { poolId, reportPeriod }, undefined, { recordReady: false });
    console.log(JSON.stringify({ operation: command, ...readiness }));
  } else {
    const saved = JSON.parse(await readFile(baselinePath, "utf8"));
    if (saved.pool_id !== poolId || saved.report_period !== reportPeriod) throw new Error("Baseline scope mismatch");
    const current = await storedReports();
    const currentById = new Map(current.map(row => [row.id, row]));
    const changedSuccesses = saved.successes.filter((prior: any) => {
      const row = currentById.get(prior.id);
      return !row || successFingerprint(row) !== prior.fingerprint || row.analysis_call_started_at !== null;
    });
    const identityChanges = saved.failures.filter((prior: any) => {
      const row = currentById.get(prior.id);
      return !row || row.analysis_request_id !== prior.request_id ||
        fingerprint(row.analysis_request_payload) !== prior.payload_fingerprint;
    });
    const failedRows = saved.failures.map((prior: any) => currentById.get(prior.id));
    console.log(JSON.stringify({
      operation: command, preserved_successes: saved.successes.length - changedSuccesses.length,
      changed_successes: changedSuccesses.length, changed_failure_identities: identityChanges.length,
      recovered_from_original_failed: failedRows.filter((row: any) =>
        row && ["REVIEW_REQUIRED", "READY_TO_SEND", "APPROVED", "PUBLISHED"].includes(row.product_status)).length,
      still_failed: failedRows.filter((row: any) => row?.product_status === "FAILED").length,
      unknown: (await client.query(`
        SELECT count(*)::int AS n FROM growth_reports
        WHERE swimming_pool_id=$1 AND report_period=$2 AND analysis_uncertain_at IS NOT NULL
          AND deleted_at IS NULL
      `, [poolId, reportPeriod])).rows[0].n,
    }));
    if (changedSuccesses.length || identityChanges.length) throw new Error("Release preservation verification failed");
  }
}
try {
  if (mutates) await executeOperation(db);
  else await db.transaction(async (tx: any) => {
    const { sql } = await import("drizzle-orm");
    await tx.execute(sql.raw("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"));
    const readOnly = await tx.execute(sql.raw("SHOW transaction_read_only"));
    if (readOnly.rows[0].transaction_read_only !== "on") throw new Error("Read-only boundary not established");
    await executeOperation(tx);
  });
} finally {
  await client.end();
}