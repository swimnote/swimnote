import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { reconcileMonthlyCycle } from "../../jobs/growth-report-monthly-readiness.js";
import { initGrowthReportMonthlyIntegritySchema } from "../../migrations/growth-report-monthly-integrity.js";
import { claimGrowthReportAnalysis, renewGrowthReportAnalysisClaim } from "../growth-report-analysis-claim.js";
import { recoverMonthlyTargets } from "../growth-report-monthly-recovery.js";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";

// Opt-in real PostgreSQL checks. Production is never an eligible test target.
const enabled = process.env.GR_MONTHLY_POSTGRES_TEST === "true";
describe.skipIf(!enabled)("monthly processing PostgreSQL concurrency", () => {
  const poolId = `gr_test_${randomUUID().replaceAll("-", "")}`;
  const cycleId = `${poolId}_cycle`;
  const reportPeriod = "2026-07";
  let first: pg.Client;
  let second: pg.Client;
  let db: any;
  let otherDb: any;
  let connected = false;
  let secondConnected = false;

  beforeAll(async () => {
    const isolated = process.env.GR_MONTHLY_ISOLATED_DB_URL;
    const url = isolated || process.env.TEST_DATABASE_URL;
    const isIsolated = isolated &&
      new URL(isolated).hostname === "127.0.0.1" &&
      new URL(isolated).pathname === "/gr_monthly_validation";
    if (!url || (!isIsolated && !url.includes("cbpaxrvrqczqefjoykge")) ||
        url.includes("mrgkiussgbbmxfnkjgqy")) {
      throw new Error("Monthly PostgreSQL tests require the approved staging TEST_DATABASE_URL");
    }
    first = new pg.Client({ connectionString: url, ssl: isIsolated ? false : { rejectUnauthorized: false } });
    second = new pg.Client({ connectionString: url, ssl: isIsolated ? false : { rejectUnauthorized: false } });
    await first.connect(); connected = true;
    await second.connect(); secondConnected = true;
    db = drizzle(first); otherDb = drizzle(second);
    if (isIsolated) {
      // Minimal disposable reproduction of the Production columns/types used
      // by these SQL boundaries, not an application database replacement.
      await first.query(`
        CREATE TYPE gr_product_status_enum AS ENUM
          ('OPEN','PREANALYZING','READY_FOR_ANALYSIS','ANALYZING','REGENERATING',
           'FAILED','REVIEW_REQUIRED','READY_TO_SEND','APPROVED','PUBLISHED',
           'EXCLUDED','DISCARDED','DATA_ACCUMULATING');
        CREATE TYPE gr_analysis_status_enum AS ENUM
          ('COMPLETE','COMPLETE_WITH_QUESTIONS_AVAILABLE','COMPLETE_WITH_PARENT_EVIDENCE',
           'INCOMPLETE','FAILED','DATA_ACCUMULATING');
        CREATE TABLE growth_report_cycles (
          id text PRIMARY KEY, swimming_pool_id text, report_period text,
          analysis_from date, analysis_cutoff_at timestamptz,
          parent_input_open_at timestamptz, parent_input_close_at timestamptz,
          created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW()
        );
        CREATE TABLE growth_reports (
          id text PRIMARY KEY, student_id text, swimming_pool_id text,
          cycle_id text REFERENCES growth_report_cycles(id),
          report_period text, period_start date, period_end date, report_type text DEFAULT 'monthly',
          product_status gr_product_status_enum, deleted_at timestamptz,
          analysis_request_id text, analysis_request_payload jsonb,
          analysis_identity_hash text, analysis_response_payload jsonb, snapshot_hash text,
          eligibility_version integer, attendance_count integer, source_event_count integer,
          analysis_retry_count integer DEFAULT 0, analysis_status gr_analysis_status_enum,
          exclusion_code text,report_content jsonb,report_fact_package jsonb,sns_summary jsonb,
          created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW()
        );
        CREATE TABLE students (
          id text PRIMARY KEY,swimming_pool_id text,status text,deleted_at timestamptz,
          withdrawn_at timestamptz
        );
        CREATE TABLE withdrawn_member_archives (
          id text PRIMARY KEY,pool_id text,original_student_id text,
          withdrawn_at timestamptz,withdrawn_by_id text
        );
        CREATE TABLE audit_logs (
          entity_type text,entity_id text,entity_version integer,action text,
          actor_type text,actor_id text,pool_id text,before_data jsonb,after_data jsonb,
          reason text,request_id text,correlation_id text,ip_hash text
        );
        CREATE FUNCTION next_audit_version(text,text) RETURNS integer LANGUAGE sql AS $$
          SELECT COALESCE(MAX(entity_version),0)+1 FROM audit_logs
          WHERE entity_type=$1 AND entity_id=$2
        $$;
      `);
    }
    await db.transaction(async (tx: any) => initGrowthReportMonthlyIntegritySchema(tx));
    await first.query(`
      INSERT INTO growth_report_cycles
        (id,swimming_pool_id,report_period,analysis_from,analysis_cutoff_at,
         parent_input_open_at,parent_input_close_at,eligible_total,eligibility_sealed_at)
      VALUES ($1,$2,$3,'2026-07-01T00:00:00+09','2026-08-01T00:00:00+09',
              '2026-08-01T00:00:00+09','2026-08-05T00:00:00+09',4,NOW())
    `, [cycleId, poolId, reportPeriod]);
    for (const [index, status] of ["OPEN", "FAILED", "REVIEW_REQUIRED", "PUBLISHED"].entries()) {
      const studentId = `${poolId}_student_${index}`;
      const reportId = `${poolId}_report_${index}`;
      const request = {
        contract_version: "1.0", request_id: `${reportId}_request`, report_id: reportId,
        context: { student_id: studentId, pool_id: poolId, report_period: reportPeriod },
        snapshot: { payload_hash: `${reportId}_hash` },
      };
      await first.query(`
        INSERT INTO growth_reports
          (id,student_id,swimming_pool_id,cycle_id,report_period,period_start,period_end,
           product_status,analysis_request_id,analysis_request_payload,analysis_identity_hash,
           snapshot_hash,eligibility_version,attendance_count,source_event_count)
        VALUES ($1,$2,$3,$4,$5,'2026-07-01','2026-07-31',$6,$7,$8::jsonb,$9,$10,4,3,1)
      `, [reportId, studentId, poolId, cycleId, reportPeriod, status, request.request_id,
        JSON.stringify(request), getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
        request.snapshot.payload_hash]);
      await first.query(`
        INSERT INTO growth_report_eligible_targets
          (cycle_id,student_id,eligibility_version,eligibility_evidence,source_provenance)
        VALUES ($1,$2,4,'{}'::jsonb,'LIVE_SEAL')
      `, [cycleId, studentId]);
    }
  }, 60_000);

  afterAll(async () => {
    if (connected) {
      await first.query("DELETE FROM growth_reports WHERE swimming_pool_id=$1", [poolId]);
      await first.query("DELETE FROM growth_report_eligible_targets WHERE cycle_id=$1", [cycleId]);
      await first.query("DELETE FROM audit_logs WHERE entity_id=$1", [cycleId]);
      await first.query("DELETE FROM withdrawn_member_archives WHERE pool_id=$1", [poolId]);
      await first.query("DELETE FROM students WHERE swimming_pool_id=$1", [poolId]);
      await first.query("DELETE FROM growth_report_cycles WHERE id=$1", [cycleId]);
      await first.end();
    }
    if (secondConnected) await second.end();
  });

  it("two PostgreSQL sessions cannot both claim the same report", async () => {
    const params = {
      reportId: `${poolId}_report_0`, expectedStatus: "OPEN",
      requireSealedMonthlyTarget: true, leaseMs: 60_000,
    };
    const claims = await Promise.all([
      claimGrowthReportAnalysis(db, params),
      claimGrowthReportAnalysis(otherDb, params),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const owner = claims.find(Boolean)!;
    await first.query("UPDATE growth_reports SET analysis_lease_until=NOW()-INTERVAL '1 second' WHERE id=$1", [params.reportId]);
    const nextOwner = await claimGrowthReportAnalysis(otherDb, params);
    expect(nextOwner).toBeTruthy();
    expect(nextOwner).not.toBe(owner);
    expect(await renewGrowthReportAnalysisClaim(db, { reportId: params.reportId, claimToken: owner })).toBe(false);
    const rejected = await first.query(`
      UPDATE growth_reports SET analysis_response_payload='{}'::jsonb
      WHERE id=$1 AND analysis_claim_token=$2 AND analysis_lease_until>NOW() RETURNING id
    `, [params.reportId, owner]);
    expect(rejected.rowCount).toBe(0);
  });

  it("real scoped recovery preserves success/request identities and is repeat-safe", async () => {
    const before = await first.query(`
      SELECT id,product_status,analysis_request_id,analysis_request_payload
      FROM growth_reports WHERE swimming_pool_id=$1 ORDER BY id
    `, [poolId]);
    const scope = { poolId, reportPeriod, actorId: "monthly-staging-test" };
    const recovered = await recoverMonthlyTargets(db, scope);
    expect(recovered.reactivated).toBe(1);
    expect(recovered.skipped_success).toBe(2);
    expect((await recoverMonthlyTargets(otherDb, scope)).reactivated).toBe(0);
    const after = await first.query(`
      SELECT id,product_status,analysis_request_id,analysis_request_payload
      FROM growth_reports WHERE swimming_pool_id=$1 ORDER BY id
    `, [poolId]);
    expect(after.rows.map(row => [row.id, row.analysis_request_id, row.analysis_request_payload]))
      .toEqual(before.rows.map(row => [row.id, row.analysis_request_id, row.analysis_request_payload]));
    expect(after.rows.find(row => row.id.endsWith("_report_2")).product_status).toBe("REVIEW_REQUIRED");
    expect(after.rows.find(row => row.id.endsWith("_report_3")).product_status).toBe("PUBLISHED");
  });

  it("read-only reconciliation executes no locking or policy writes and counts UNKNOWN markers", async () => {
    const before = await db.transaction(async (tx: any) => {
      await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
      return reconcileMonthlyCycle(tx, { poolId, reportPeriod }, undefined, { recordReady: false });
    });
    await first.query("UPDATE growth_reports SET analysis_uncertain_at=NOW() WHERE id=$1", [`${poolId}_report_0`]);
    const after = await db.transaction(async (tx: any) => {
      await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
      return reconcileMonthlyCycle(tx, { poolId, reportPeriod }, undefined, { recordReady: false });
    });
    expect(after.unknown).toBe(before.unknown + 1);
    expect(after.eligible_total).toBe(4);
    expect(after.ready).toBe(false);
    await first.query("UPDATE growth_reports SET analysis_uncertain_at=NULL,analysis_claim_token=NULL,analysis_lease_until=NULL WHERE id=$1",
      [`${poolId}_report_0`]);
  });

  it("verified post-seal queued withdrawal uses real enum-compatible SQL", async () => {
    await first.query(`
      INSERT INTO students (id,swimming_pool_id,status)
      VALUES ($1,$2,'active')
    `, [`${poolId}_student_0`, poolId]);
    await first.query(`
      UPDATE students SET status='withdrawn',withdrawn_at=NOW()
      WHERE id=$1
    `, [`${poolId}_student_0`]);
    await first.query(`
      INSERT INTO withdrawn_member_archives
        (id,pool_id,original_student_id,withdrawn_at,withdrawn_by_id)
      SELECT $1,swimming_pool_id,id,withdrawn_at,'operator'
      FROM students WHERE id=$2
    `, [`${poolId}_withdrawal`, `${poolId}_student_0`]);
    const result = await reconcileMonthlyCycle(db, { poolId, reportPeriod });
    expect(result.policy_excluded_total).toBe(1);
    expect(result.ready).toBe(false);
    const actual = await first.query(`
      SELECT report.product_status,report.exclusion_code,target.policy_evidence_ref
      FROM growth_reports report JOIN growth_report_eligible_targets target
        ON target.cycle_id=report.cycle_id AND target.student_id=report.student_id
      WHERE report.id=$1
    `, [`${poolId}_report_0`]);
    expect(actual.rows[0]).toEqual({
      product_status: "EXCLUDED", exclusion_code: "POST_ELIGIBILITY_WITHDRAWAL",
      policy_evidence_ref: `${poolId}_withdrawal`,
    });

    // Model the canonical restore transition (withdrawn_at cleared), followed
    // by a suspension. The old immutable archive must no longer exclude this
    // still-queued report.
    await first.query(`
      UPDATE students SET status='active',withdrawn_at=NULL
      WHERE id=$1
    `, [`${poolId}_student_0`]);
    await first.query(`
      UPDATE students SET status='suspended'
      WHERE id=$1
    `, [`${poolId}_student_0`]);
    await first.query(`
      UPDATE growth_reports
      SET product_status='OPEN',analysis_status=NULL,analysis_retry_count=0,exclusion_code=NULL
      WHERE id=$1
    `, [`${poolId}_report_0`]);
    await first.query(`
      UPDATE growth_report_eligible_targets
      SET policy_excluded_at=NULL,policy_exclusion_reason=NULL,policy_evidence_ref=NULL
      WHERE cycle_id=$1 AND student_id=$2
    `, [cycleId, `${poolId}_student_0`]);

    const afterRestoreAndSuspend = await reconcileMonthlyCycle(db, { poolId, reportPeriod });
    expect(afterRestoreAndSuspend.policy_excluded_total).toBe(0);
    // The earlier scoped recovery also left report_1 queued; restoration
    // retains report_0 as a second pending identity instead of excluding it.
    expect(afterRestoreAndSuspend.queued).toBe(2);
    expect(afterRestoreAndSuspend.ready).toBe(false);
  });
});