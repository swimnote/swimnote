import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { reconcileMonthlyCycle } from "../../jobs/growth-report-monthly-readiness.js";
import { initGrowthReportMonthlyIntegritySchema } from "../../migrations/growth-report-monthly-integrity.js";
import { up as initMonthlyAutomationSchema } from "../../migrations/growth-report-monthly-automation.js";
import { claimGrowthReportAnalysis, renewGrowthReportAnalysisClaim } from "../growth-report-analysis-claim.js";
import { recoverMonthlyTargets } from "../growth-report-monthly-recovery.js";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";
import {
  canDispatchMonthlyAnalysis,
  finishMonthlyFirstPass,
  getMonthlyAutomationSummary,
  listMonthlyAutomationExceptions,
  recordMonthlyFirstPassOutcome,
  recordMonthlyHttpAttempt,
  recordMonthlyPoolPreparation,
  registerMonthlyAutomationRun,
} from "../growth-report-monthly-run.js";

// Opt-in real PostgreSQL checks. Production is never an eligible test target.
const enabled = process.env.GR_MONTHLY_POSTGRES_TEST === "true";
const isolatedLocalUrl = process.env.GR_MONTHLY_ISOLATED_DB_URL;
const isApprovedLocalFixture = (() => {
  if (!isolatedLocalUrl) return false;
  const url = new URL(isolatedLocalUrl);
  return url.hostname === "127.0.0.1" && url.port === "55439" &&
    url.pathname === "/postgres" && url.username === "monthly_test";
})();
describe.skipIf(!enabled)("monthly processing PostgreSQL concurrency", () => {
  const poolId = `gr_test_${randomUUID().replaceAll("-", "")}`;
  const cycleId = `${poolId}_cycle`;
  const reportPeriod = "2026-07";
  const automationPoolId = `${poolId}_automation`;
  const automationCycleId = `${automationPoolId}_cycle`;
  const automationPoolId2 = `${automationPoolId}_equal`;
  const automationCycleId2 = `${automationPoolId2}_cycle`;
  const automationReportPeriod = "2026-10";
  let first: pg.Client;
  let second: pg.Client;
  let db: any;
  let otherDb: any;
  let connected = false;
  let secondConnected = false;

  beforeAll(async () => {
    const isolated = process.env.GR_MONTHLY_ISOLATED_DB_URL;
    const url = isolated || process.env.TEST_DATABASE_URL;
    const isolatedUrl = isolated ? new URL(isolated) : null;
    const isIsolated = !!isolatedUrl &&
      isolatedUrl.hostname === "127.0.0.1" &&
      (isolatedUrl.pathname === "/gr_monthly_validation" || isApprovedLocalFixture);
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
        DROP TABLE IF EXISTS growth_report_notification_outbox,
          growth_report_monthly_run_pools, growth_report_monthly_runs,
          growth_report_eligible_targets, growth_reports, growth_report_cycles,
          students, withdrawn_member_archives, audit_logs CASCADE;
        DROP FUNCTION IF EXISTS next_audit_version(text,text);
        DROP TYPE IF EXISTS gr_product_status_enum CASCADE;
        DROP TYPE IF EXISTS gr_analysis_status_enum CASCADE;
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
    if (isApprovedLocalFixture) {
      // Production uses this same atomic transaction wrapper. Exercise it
      // against disposable localhost PostgreSQL before approving rollout.
      await db.transaction(async (tx: any) => initMonthlyAutomationSchema(tx));
      await initMonthlyAutomationSchema(db);
    }
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
    if (isApprovedLocalFixture) {
      for (const [targetPoolId, targetCycleId] of [
        [automationPoolId, automationCycleId],
        [automationPoolId2, automationCycleId2],
      ]) {
        await first.query(`
          INSERT INTO growth_report_cycles
            (id,swimming_pool_id,report_period,analysis_from,analysis_cutoff_at,
             parent_input_open_at,parent_input_close_at,eligible_total,eligibility_sealed_at)
          VALUES ($1,$2,$3,'2026-10-01','2026-11-01','2026-11-01','2026-11-05',3,NOW())
        `, [targetCycleId, targetPoolId, automationReportPeriod]);
        await first.query(`
          INSERT INTO growth_report_eligible_targets
            (cycle_id,student_id,eligibility_version,eligibility_evidence,source_provenance)
          SELECT $1, $2 || '_student_' || target_index, 4, '{}'::jsonb, 'LIVE_SEAL'
          FROM generate_series(1,3) AS gs(target_index)
        `, [targetCycleId, targetPoolId]);
        for (let index = 1; index <= 3; index++) {
          const studentId = `${targetPoolId}_student_${index}`;
          const reportId = `${targetPoolId}_report_${index}`;
          const request = {
            contract_version: "1.0",
            request_id: `${reportId}_request`,
            report_id: reportId,
            context: { student_id: studentId, pool_id: targetPoolId, report_period: automationReportPeriod },
            snapshot: { payload_hash: `${reportId}_hash` },
          };
          await first.query(`
            INSERT INTO growth_reports
              (id,student_id,swimming_pool_id,cycle_id,report_period,period_start,period_end,
               product_status,analysis_status,analysis_request_id,analysis_request_payload,
              analysis_identity_hash,snapshot_hash,eligibility_version,attendance_count,
              source_event_count,analysis_response_payload)
            VALUES ($1,$2,$3,$4,$5,'2026-10-01','2026-10-31',$6::gr_product_status_enum,$7,
                    $8,$9::jsonb,$10,$11,4,3,1,$12::jsonb)
          `, [
            reportId, studentId, targetPoolId, targetCycleId, automationReportPeriod,
            targetPoolId === automationPoolId
              ? (index === 1 ? "OPEN" : index === 2 ? "FAILED" : "REVIEW_REQUIRED")
              : "REVIEW_REQUIRED",
            targetPoolId === automationPoolId && index === 2
              ? "FAILED"
              : targetPoolId === automationPoolId && index === 3
                ? "DATA_ACCUMULATING"
                : "COMPLETE",
            request.request_id, JSON.stringify(request),
            getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS"),
            request.snapshot.payload_hash,
            JSON.stringify(targetPoolId === automationPoolId && index === 3
              ? { request_id: request.request_id, analysis_status: "DATA_ACCUMULATING" }
              : null),
          ]);
        }
      }
      await first.query(`
        UPDATE growth_reports
        SET report_content='{"summary":"ready"}',
            report_fact_package='{"grounding_result":"PASS","growth_framing_result":"PASS"}',
            sns_summary='{"summary":"ready"}'
        WHERE swimming_pool_id=$1
      `, [automationPoolId2]);
    }
  }, 60_000);

  afterAll(async () => {
    if (connected) {
      if (isApprovedLocalFixture) {
        await first.query(
          "DELETE FROM growth_report_notification_outbox WHERE report_period=$1",
          [automationReportPeriod],
        );
        await first.query(
          "DELETE FROM growth_report_monthly_run_pools WHERE report_period=$1",
          [automationReportPeriod],
        );
        await first.query(
          "DELETE FROM growth_report_monthly_runs WHERE report_period=$1",
          [automationReportPeriod],
        );
        await first.query(
          "DELETE FROM growth_reports WHERE swimming_pool_id=$1",
          [automationPoolId],
        );
        await first.query(
          "DELETE FROM growth_reports WHERE swimming_pool_id=$1",
          [automationPoolId2],
        );
        await first.query(
          "DELETE FROM growth_report_eligible_targets WHERE cycle_id IN ($1,$2)",
          [automationCycleId, automationCycleId2],
        );
        await first.query(
          "DELETE FROM growth_report_cycles WHERE id IN ($1,$2)",
          [automationCycleId, automationCycleId2],
        );
      }
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

  it.skipIf(!isApprovedLocalFixture)(
    "applies monthly automation DDL twice and verifies manifest barrier, bounded recovery, and outbox lease fencing",
    async () => {
      const registered = await registerMonthlyAutomationRun(db, {
        reportPeriod: automationReportPeriod,
        poolIds: [automationPoolId, automationPoolId2],
        now: new Date("2026-11-01T00:00:00.000Z"),
      });
      expect(registered?.report_period).toBe(automationReportPeriod);
      expect(await registerMonthlyAutomationRun(otherDb, {
        reportPeriod: automationReportPeriod,
        poolIds: ["late-pool-must-not-join"],
        now: new Date("2026-11-02T00:00:00.000Z"),
      })).toMatchObject({ report_period: automationReportPeriod });
      expect(await recordMonthlyPoolPreparation(db, {
        reportPeriod: automationReportPeriod,
        poolId: automationPoolId,
        cycleId: automationCycleId,
      })).toBe(true);
      expect(await recordMonthlyPoolPreparation(db, {
        reportPeriod: automationReportPeriod,
        poolId: automationPoolId2,
        cycleId: automationCycleId2,
      })).toBe(true);
      const fixedPools = await first.query(
        "SELECT swimming_pool_id FROM growth_report_monthly_run_pools WHERE report_period=$1 ORDER BY swimming_pool_id",
        [automationReportPeriod],
      );
      expect(fixedPools.rows.map((row: any) => row.swimming_pool_id))
        .toEqual([automationPoolId, automationPoolId2].sort());

      const claimParams = {
        reportId: `${automationPoolId}_report_1`,
        expectedStatus: "OPEN",
        requireSealedMonthlyTarget: true,
        leaseMs: 60_000,
      };
      const claims = await Promise.all([
        claimGrowthReportAnalysis(db, claimParams),
        claimGrowthReportAnalysis(otherDb, claimParams),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(await canDispatchMonthlyAnalysis(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_1`,
        phase: "FIRST_PASS",
      })).toBe(true);
      expect(await recordMonthlyHttpAttempt(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_1`,
        phase: "FIRST_PASS",
      })).toBe(true);

      await first.query(`
        UPDATE growth_reports
        SET product_status='REVIEW_REQUIRED', analysis_status='COMPLETE',
            report_content='{"summary":"ready"}',
            report_fact_package='{"grounding_result":"PASS","growth_framing_result":"PASS"}',
            sns_summary='{"summary":"ready"}'
        WHERE id=$1
      `, [`${automationPoolId}_report_1`]);
      expect(await recordMonthlyFirstPassOutcome(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_1`,
        outcome: "generated",
      })).toBe("recorded");
      expect(await recordMonthlyFirstPassOutcome(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_2`,
        outcome: "failed",
        errorCode: "NETWORK_ERROR",
      })).toBe("recorded");
      expect(await finishMonthlyFirstPass(db, automationReportPeriod)).toBeNull();
      expect(await recordMonthlyFirstPassOutcome(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_3`,
        outcome: "identity_error",
        errorCode: "MONTHLY_NOTICE_UNRESOLVED",
        errorCategory: "DATA",
      })).toBe("recorded");
      for (let student = 1; student <= 3; student++) {
        expect(await recordMonthlyFirstPassOutcome(db, {
          cycleId: automationCycleId2,
          studentId: `${automationPoolId2}_student_${student}`,
          outcome: "generated",
        })).toBe("recorded");
      }

      const failed = await listMonthlyAutomationExceptions(db, {
        reportPeriod: automationReportPeriod,
      });
      expect(failed.total).toBe(2);
      expect(failed.rows.find(row => row.first_pass_error_code === "NETWORK_ERROR")
        ?.recovery_allowed).toBe(true);
      expect(failed.rows.find(row => row.first_pass_error_code === "MONTHLY_NOTICE_UNRESOLVED"))
        .toMatchObject({
          first_pass_outcome: "identity_error",
          first_pass_error_category: "DATA",
          recovery_allowed: false,
        });
      const firstPass = await finishMonthlyFirstPass(db, automationReportPeriod);
      expect(firstPass).toMatchObject({
        eligible_total: 6,
        generated_total: 4,
        unresolved_member_total: 2,
      });

      const outboxEventKey = `${automationReportPeriod}:FIRST_PASS:1`;
      const insertEvent = (id: string) => db.execute(sql`
        INSERT INTO growth_report_notification_outbox
          (id,notification_type,event_scope,event_key,swimming_pool_id,
           report_period,recipient_id,recipient_type,title,body)
        VALUES (${id},'GROWTH_REPORT_FIRST_PASS_FINISHED','report_month',
          ${outboxEventKey},NULL,${automationReportPeriod},'fixture-admin','user',
          'Summary','Counts only')
      `);
      await insertEvent(`${automationPoolId}_event_1`);
      await expect(insertEvent(`${automationPoolId}_event_2`))
        .rejects.toMatchObject({ cause: { code: "23505" } });

      expect((await getMonthlyAutomationSummary(db, automationReportPeriod))
        ?.unresolved_member_total).toBe(2);
      expect(await getMonthlyAutomationSummary(db, automationReportPeriod, { live: true }))
        .toMatchObject({ eligible_total: 6, generated_total: 4, unresolved_member_total: 2 });

      // Repeated explicit recovery approvals consume the bounded epoch limit;
      // a successful/recovered target is never dispatchable as a recovery.
      const priorRecoveryLimit = process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"];
      process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] = "3";
      try {
        for (let epoch = 1; epoch <= 3; epoch++) {
          if (epoch > 1) {
            await first.query(`
              UPDATE growth_reports SET product_status='FAILED',analysis_status='FAILED'
              WHERE id=$1
            `, [`${automationPoolId}_report_2`]);
          }
          const recovered = await recoverMonthlyTargets(db, {
            poolId: automationPoolId,
            reportPeriod: automationReportPeriod,
            actorId: "fixture-admin",
            reason: "fixture recovery round",
          });
          expect(recovered.reactivated, JSON.stringify(recovered)).toBe(1);
          expect(recovered.skipped_not_first_pass_failure).toBe(2);
          expect(await canDispatchMonthlyAnalysis(db, {
            cycleId: automationCycleId,
            studentId: `${automationPoolId}_student_2`,
            phase: "RECOVERY",
          })).toBe(true);
          expect(await recordMonthlyHttpAttempt(db, {
            cycleId: automationCycleId,
            studentId: `${automationPoolId}_student_2`,
            phase: "RECOVERY",
          })).toBe(true);
          const count = await first.query(`
            SELECT recovery_epoch,recovery_engine_requests,recovery_approved_at,
                   recovery_approved_by,recovery_approval_reason
            FROM growth_report_eligible_targets
            WHERE cycle_id=$1 AND student_id=$2
          `, [automationCycleId, `${automationPoolId}_student_2`]);
          expect(Number(count.rows[0].recovery_epoch)).toBe(epoch);
          expect(Number(count.rows[0].recovery_engine_requests)).toBe(epoch);
          expect(count.rows[0].recovery_approved_at).toBeNull();
          expect(count.rows[0].recovery_approved_by).toBe("fixture-admin");
          expect(count.rows[0].recovery_approval_reason).toBe("fixture recovery round");
          expect(await canDispatchMonthlyAnalysis(db, {
            cycleId: automationCycleId,
            studentId: `${automationPoolId}_student_2`,
            phase: "RECOVERY",
          })).toBe(false); // The approval is atomically consumed by this attempt.
        }
      } finally {
        if (priorRecoveryLimit === undefined) {
          delete process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"];
        } else {
          process.env["GROWTH_REPORT_MONTHLY_RECOVERY_MAX_EPOCHS"] = priorRecoveryLimit;
        }
      }
      expect(await canDispatchMonthlyAnalysis(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_2`,
        phase: "RECOVERY",
      })).toBe(false); // Final-round attempt has already consumed its approval.
      expect(await canDispatchMonthlyAnalysis(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_3`,
        phase: "RECOVERY",
      })).toBe(false); // The known DATA notice issue is accounted, never retried.
      expect(await recordMonthlyHttpAttempt(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_3`,
        phase: "RECOVERY",
      })).toBe(false);
      await first.query(`
        UPDATE growth_reports SET product_status='FAILED',analysis_status='FAILED'
        WHERE id=$1
      `, [`${automationPoolId}_report_2`]);
      expect(await canDispatchMonthlyAnalysis(db, {
        cycleId: automationCycleId,
        studentId: `${automationPoolId}_student_2`,
        phase: "RECOVERY",
      })).toBe(false); // A terminal failure needs a new approval, which is now exhausted.
      const exhausted = await recoverMonthlyTargets(db, {
        poolId: automationPoolId,
        reportPeriod: automationReportPeriod,
        actorId: "fixture-admin",
        reason: "fixture recovery limit check",
      });
      expect(exhausted.reactivated).toBe(0);
      expect(exhausted.blocked_recovery_limit).toBe(1);
      await first.query(`
        UPDATE growth_reports
        SET product_status='REVIEW_REQUIRED', analysis_status='COMPLETE',
            report_content='{"summary":"recovered"}',
            report_fact_package='{"grounding_result":"PASS","growth_framing_result":"PASS"}',
            sns_summary='{"summary":"recovered"}'
        WHERE id=$1
      `, [`${automationPoolId}_report_2`]);
      expect(await listMonthlyAutomationExceptions(db, {
        reportPeriod: automationReportPeriod,
      })).toMatchObject({
        total: 1,
        rows: [expect.objectContaining({
          first_pass_error_code: "MONTHLY_NOTICE_UNRESOLVED",
          first_pass_error_category: "DATA",
          recovery_allowed: false,
        })],
      });
      expect((await getMonthlyAutomationSummary(db, automationReportPeriod))
        ?.unresolved_member_total).toBe(2);
      expect(await getMonthlyAutomationSummary(db, automationReportPeriod, { live: true }))
        .toMatchObject({ eligible_total: 6, generated_total: 5, unresolved_member_total: 1 });

      const readyDedupe = (id: string) => db.execute(sql`
        INSERT INTO growth_report_notification_outbox
          (id,notification_type,swimming_pool_id,report_period,recipient_id,
           recipient_type,title,body)
        VALUES (${id},'GROWTH_REPORT_BATCH_READY',${automationPoolId},
          ${automationReportPeriod},'pool-admin','user','Ready','')
      `);
      await readyDedupe(`${automationPoolId}_ready_1`);
      await expect(readyDedupe(`${automationPoolId}_ready_2`))
        .rejects.toMatchObject({ cause: { code: "23505" } });

      const claimLease = (owner: string) => db.execute(sql`
        UPDATE growth_report_notification_outbox
        SET status='CLAIMED',attempt_count=attempt_count+1,
            lease_until=NOW()+INTERVAL '2 minutes',lease_token=${owner}
        WHERE id=${`${automationPoolId}_event_1`} AND status='PENDING'
        RETURNING lease_token
      `);
      const leased = await Promise.all([
        claimLease("fixture-lease-a"),
        otherDb.execute(sql`
          UPDATE growth_report_notification_outbox
          SET status='CLAIMED',attempt_count=attempt_count+1,
              lease_until=NOW()+INTERVAL '2 minutes',lease_token='fixture-lease-b'
          WHERE id=${`${automationPoolId}_event_1`} AND status='PENDING'
          RETURNING lease_token
        `),
      ]);
      expect(leased.reduce((sum: number, result: any) => sum + result.rows.length, 0)).toBe(1);
      await first.query(`
        UPDATE growth_report_notification_outbox SET lease_until=NOW()-INTERVAL '1 second'
        WHERE id=$1 AND status='CLAIMED'
      `, [`${automationPoolId}_event_1`]);
      const reclaimed = await otherDb.execute(sql`
        UPDATE growth_report_notification_outbox
        SET lease_until=NOW()+INTERVAL '2 minutes',lease_token='fixture-lease-new'
        WHERE id=${`${automationPoolId}_event_1`}
          AND status='CLAIMED' AND lease_until<NOW()
        RETURNING lease_token
      `);
      expect(reclaimed.rows[0]?.lease_token).toBe("fixture-lease-new");
      const staleDispatch = await first.query(`
        UPDATE growth_report_notification_outbox SET status='DISPATCHING'
        WHERE id=$1 AND status='CLAIMED' AND lease_token IN ('fixture-lease-a','fixture-lease-b')
        RETURNING id
      `, [`${automationPoolId}_event_1`]);
      expect(staleDispatch.rowCount).toBe(0);
    },
    60_000,
  );
});