import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { initGrowthReportMonthlyIntegritySchema } from "../../migrations/growth-report-monthly-integrity.js";
import { up as initMonthlyAutomationSchema } from "../../migrations/growth-report-monthly-automation.js";
import { getGrowthReportAnalysisIdentityHash } from "../growth-report-analysis-identity.js";
import { listMonthlyAutomationExceptions } from "../growth-report-monthly-run.js";
import { reissueUnknownGrowthReports } from "../growth-report-unknown-reissue.js";

const enabled = process.env.GR_UNKNOWN_REISSUE_POSTGRES_TEST === "true";
const approvedDatabaseUrl = process.env.GR_REISSUE_ISOLATED_DB_URL;
const dbUrlIsExactlyApproved = (() => {
  if (!approvedDatabaseUrl) return false;
  try {
    const url = new URL(approvedDatabaseUrl);
    return url.hostname === "127.0.0.1" &&
      url.port === "56672" &&
      url.pathname === "/swimnote_reissue_test" &&
      url.username === "runner";
  } catch {
    return false;
  }
})();

const uuid = () => randomUUID();
const opaqueId = (prefix: string) => `${prefix}_${uuid().replaceAll("-", "")}`;

describe.skipIf(!enabled)("UNKNOWN reissue PostgreSQL functional safety", () => {
  let first: pg.Client;
  let second: pg.Client;
  let db: any;
  let secondDb: any;

  beforeAll(async () => {
    if (!dbUrlIsExactlyApproved) {
      throw new Error(
        "UNKNOWN reissue tests require only GR_REISSUE_ISOLATED_DB_URL at 127.0.0.1:56672/swimnote_reissue_test.",
      );
    }
    first = new pg.Client({ connectionString: approvedDatabaseUrl!, ssl: false });
    second = new pg.Client({ connectionString: approvedDatabaseUrl!, ssl: false });
    await first.connect();
    await second.connect();
    db = drizzle(first);
    secondDb = drizzle(second);
    await first.query(`
      DROP TABLE IF EXISTS growth_report_unknown_reissue_operations,
        growth_report_notification_outbox, growth_report_monthly_run_pools,
        growth_report_monthly_runs, growth_report_eligible_targets,
        growth_reports, growth_report_cycles, students,
        withdrawn_member_archives, audit_logs, users, swimming_pools CASCADE;
      DROP FUNCTION IF EXISTS next_audit_version(text,text);
      DROP TYPE IF EXISTS gr_product_status_enum CASCADE;
      DROP TYPE IF EXISTS gr_analysis_status_enum CASCADE;
      CREATE TYPE gr_product_status_enum AS ENUM
        ('OPEN','PREANALYZING','READY_FOR_ANALYSIS','ANALYZING','REGENERATING',
         'PARTIAL','FAILED','REVIEW_REQUIRED','READY_TO_SEND','APPROVED',
         'PUBLISHED','EXCLUDED','DISCARDED','DATA_ACCUMULATING');
      CREATE TYPE gr_analysis_status_enum AS ENUM
        ('COMPLETE','COMPLETE_WITH_QUESTIONS_AVAILABLE','COMPLETE_WITH_PARENT_EVIDENCE',
         'INCOMPLETE','FAILED','DATA_ACCUMULATING');
      CREATE TABLE growth_report_cycles (
        id text PRIMARY KEY, swimming_pool_id text NOT NULL, report_period text NOT NULL,
        analysis_from date, analysis_cutoff_at timestamptz,
        parent_input_open_at timestamptz, parent_input_close_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE growth_reports (
        id text PRIMARY KEY, student_id text NOT NULL, swimming_pool_id text NOT NULL,
        cycle_id text REFERENCES growth_report_cycles(id), report_period text NOT NULL,
        period_start date, period_end date, report_type text DEFAULT 'monthly',
        product_status gr_product_status_enum NOT NULL, deleted_at timestamptz,
        analysis_request_id uuid, analysis_request_payload jsonb,
        analysis_identity_hash text, analysis_response_payload jsonb, snapshot_hash text,
        snapshot_version integer, eligibility_version integer, attendance_count integer,
        source_event_count integer, analysis_retry_count integer DEFAULT 0,
        analysis_status gr_analysis_status_enum, analysis_claim_token text,
        analysis_lease_until timestamptz, analysis_next_attempt_at timestamptz,
        analysis_call_started_at timestamptz, analysis_uncertain_at timestamptz,
        analysis_error_code text, exclusion_code text,
        metric_states jsonb, metric_confidences jsonb, positive_growth_signals jsonb,
        success_conditions jsonb, support_levers jsonb, next_growth_targets jsonb,
        next_observation_targets jsonb, report_content jsonb, report_fact_package jsonb,
        sns_summary jsonb, monthly_final_disposition text, monthly_disposition_version integer,
        published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE students (
        id text PRIMARY KEY, swimming_pool_id text NOT NULL, name text NOT NULL,
        status text NOT NULL DEFAULT 'active', deleted_at timestamptz, withdrawn_at timestamptz
      );
      CREATE TABLE swimming_pools (
        id text PRIMARY KEY, x_paid_entitlement boolean DEFAULT false,
        x_manual_entitlement boolean DEFAULT false, x_force_disabled boolean DEFAULT false,
        approval_status text DEFAULT 'approved'
      );
      CREATE TABLE users (
        id text PRIMARY KEY, swimming_pool_id text NOT NULL, role text NOT NULL
      );
      CREATE TABLE withdrawn_member_archives (
        id text PRIMARY KEY, pool_id text, original_student_id text,
        withdrawn_at timestamptz, withdrawn_by_id text
      );
      CREATE TABLE audit_logs (
        entity_type text, entity_id text, entity_version integer, action text,
        actor_type text, actor_id text, pool_id text, before_data jsonb, after_data jsonb,
        reason text, request_id text, correlation_id text, ip_hash text
      );
      CREATE FUNCTION next_audit_version(text,text) RETURNS integer LANGUAGE sql AS $$
        SELECT COALESCE(MAX(entity_version),0)+1 FROM audit_logs
        WHERE entity_type=$1 AND entity_id=$2
      $$;
    `);
    await db.transaction((tx: any) => initGrowthReportMonthlyIntegritySchema(tx));
    await db.transaction((tx: any) => initMonthlyAutomationSchema(tx));
    const migration = readFileSync(
      new URL("../../../migrations/2026-10-02-growth-report-unknown-reissue.sql", import.meta.url),
      "utf8",
    );
    await first.query(migration);
  });

  afterAll(async () => {
    await first?.end();
    await second?.end();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function installEngineResponse(
    respond: (body: any) => unknown | Promise<unknown>,
    httpStatus = 200,
  ) {
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("PROFESSIONAL_ENGINE_API_SECRET", "opaque-local-test-secret");
    const mock = vi.fn(async (_url: string, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      const response = await respond(request);
      const stored = await first.query(
        `SELECT recovery_generation FROM growth_report_unknown_reissue_operations WHERE id=$1`,
        [request.recovery_operation_id],
      );
      const body = response && typeof response === "object" &&
        !("recovery_generation" in response)
        ? { ...response, recovery_generation: stored.rows[0]?.recovery_generation }
        : response;
      return { status: httpStatus, json: async () => body };
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  function unknownResponse(request: any) {
    return {
      status: "UNKNOWN",
      recovery_operation_id: request.recovery_operation_id,
      original_request_id: request.original_request_id,
      new_request_id: request.new_request_id,
      error_code: "ENGINE_REQUEST_OUTCOME_UNKNOWN",
    };
  }

  async function createLegacyUnknown(options: {
    nullLegacyMonthlyState?: boolean;
    nullOriginalPayload?: boolean;
  } = {}) {
    const reportId = opaqueId("gr");
    const studentId = opaqueId("student");
    const poolId = opaqueId("pool");
    const cycleId = opaqueId("cycle");
    const requestId = uuid();
    const reportPeriod = "2020-09";
    const snapshotHash = "a".repeat(64);
    const request = {
      contract_version: "3.0",
      request_id: requestId,
      report_id: reportId,
      context: {
        student_id: studentId,
        pool_id: poolId,
        report_period: reportPeriod,
        analysis_from: "2026-09-01",
        analysis_cutoff_at: "2026-10-01T00:00:00.000Z",
        timezone: "Asia/Seoul",
      },
      snapshot: {
        snapshot_version: "4",
        payload_hash: snapshotHash,
        created_at: "2026-10-01T00:00:00.000Z",
        diaries: [],
        growth_events: [],
        attendance: [],
        curriculum_state: null,
        longitudinal: {},
        parent_answers: [],
      },
      longitudinal: {},
      parent_answers: [],
    };
    const identityHash = getGrowthReportAnalysisIdentityHash(request, "FINAL_ANALYSIS");
    await first.query(
      `INSERT INTO growth_report_cycles
        (id, swimming_pool_id, report_period, eligible_total, eligibility_sealed_at,
         parent_input_open_at, parent_input_close_at)
       VALUES ($1,$2,$3,1,now()-interval '1 day',now()-interval '30 days',now()+interval '30 days')`,
      [cycleId, poolId, reportPeriod],
    );
    await first.query(
      `INSERT INTO students (id, swimming_pool_id, name) VALUES ($1,$2,'Legacy Student')`,
      [studentId, poolId],
    );
    await first.query(`INSERT INTO swimming_pools (id) VALUES ($1)`, [poolId]);
    await first.query(
      `INSERT INTO users (id, swimming_pool_id, role) VALUES ($1,$2,'pool_admin')`,
      [opaqueId("user"), poolId],
    );
    await first.query(
      `INSERT INTO growth_report_eligible_targets
        (cycle_id, student_id, eligibility_version, eligibility_evidence, source_provenance,
         first_pass_completed_at, first_pass_outcome)
       VALUES ($1,$2,4,'{}'::jsonb,'LEGACY_STORED_EVIDENCE',
         CASE WHEN $3::boolean THEN NULL ELSE now() END,
         CASE WHEN $3::boolean THEN NULL ELSE 'unknown' END)`,
      [cycleId, studentId, options.nullLegacyMonthlyState === true],
    );
    await first.query(
      `INSERT INTO growth_reports
        (id, student_id, swimming_pool_id, cycle_id, report_period, report_type,
         product_status, analysis_status, analysis_request_id, analysis_request_payload,
         analysis_identity_hash, analysis_response_payload, snapshot_hash, snapshot_version,
         eligibility_version, attendance_count, source_event_count, analysis_uncertain_at,
         analysis_call_started_at, report_content, report_fact_package, sns_summary)
         VALUES ($1,$2,$3,$4,$5,'monthly','ANALYZING','COMPLETE',$6,$7::jsonb,$8,
         $9::jsonb,$10,4,4,3,1,now()-interval '1 hour',
         now()-interval '1 hour','{"summary":"archived legacy presentation"}'::jsonb,
         '{"legacy_fact":"keep archived"}'::jsonb,'{"text":"legacy sns"}'::jsonb)`,
      [reportId, studentId, poolId, cycleId, reportPeriod, requestId,
        options.nullOriginalPayload === true ? null : JSON.stringify(request), identityHash,
        options.nullLegacyMonthlyState === true
          ? null : JSON.stringify({ analysis_status: "COMPLETE" }),
        snapshotHash],
    );
    return { reportId, studentId, poolId, cycleId, requestId, request, snapshotHash, reportPeriod };
  }

  async function approve(
    reportId: string,
    options: { nextGeneration?: boolean; expectedOperationId?: string } = {},
    connection = db,
    actorId = "local-super-admin",
  ) {
    return reissueUnknownGrowthReports(connection, {
      reportIds: [reportId],
      actorId,
      actorRole: "super_admin",
      reason: "Reviewed legacy UNKNOWN outcome",
      nextGeneration: options.nextGeneration,
      expectedOperationIds: options.expectedOperationId
        ? { [reportId]: options.expectedOperationId } : undefined,
      operatorAuthorization: "Bearer verified-local-operator",
    });
  }

  it("uses opaque TEXT identities, preserves legacy content for UNKNOWN, replays one operation, and increments only with explicit approval", async () => {
    const report = await createLegacyUnknown();
    const fetch = installEngineResponse(unknownResponse);
    const [firstResult] = await approve(report.reportId);
    expect(firstResult).toMatchObject({ state: "UNKNOWN", recovery_generation: 1 });
    const firstOperationId = firstResult?.recovery_operation_id as string;
    const firstNewRequestId = firstResult?.new_request_id as string;
    expect(firstOperationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstNewRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(sent.original_payload.report_id).toBe(report.reportId);
    expect(sent.original_payload.context.student_id).toBe(report.studentId);
    expect(sent.original_payload.context.pool_id).toBe(report.poolId);

    const stored = await first.query(
      `SELECT analysis_request_id, analysis_request_payload, analysis_uncertain_at,
              report_content, report_fact_package, sns_summary
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(stored.rows[0].analysis_request_id).toBe(firstNewRequestId);
    expect(stored.rows[0].analysis_uncertain_at).not.toBeNull();
    expect(stored.rows[0].report_content.summary).toContain("archived");
    expect(stored.rows[0].report_fact_package.legacy_fact).toBe("keep archived");
    const blockedCycle = await first.query(
      `SELECT ready_at FROM growth_report_cycles WHERE id=$1`,
      [report.cycleId],
    );
    expect(blockedCycle.rows[0].ready_at).toBeNull();

    const [otherOperatorReplay] = await approve(
      report.reportId, {}, db, "different-verified-operator",
    );
    expect(otherOperatorReplay).toMatchObject({
      state: "HOLD",
      error_code: "OPERATOR_IDENTITY_MISMATCH",
      recovery_operation_id: firstOperationId,
      new_request_id: firstNewRequestId,
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    const [replay] = await approve(report.reportId);
    expect(replay?.recovery_operation_id).toBe(firstOperationId);
    expect(replay?.new_request_id).toBe(firstNewRequestId);
    expect(replay?.recovery_generation).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      recovery_operation_id: firstOperationId,
      original_request_id: report.requestId,
      new_request_id: firstNewRequestId,
    });

    const [secondGeneration] = await approve(report.reportId, {
      nextGeneration: true,
      expectedOperationId: firstOperationId,
    });
    expect(secondGeneration).toMatchObject({ state: "UNKNOWN", recovery_generation: 2 });
    const history = await first.query(
      `SELECT recovery_generation, original_request_id, new_request_id
       FROM growth_report_unknown_reissue_operations
       WHERE report_id=$1 ORDER BY recovery_generation`,
      [report.reportId],
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows[1].original_request_id).toBe(firstNewRequestId);
    expect(history.rows[1].new_request_id).toBe(secondGeneration?.new_request_id);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not permit next-generation approval based only on an APP timeout", async () => {
    const report = await createLegacyUnknown();
    const fetch = vi.fn(async () => { throw new Error("simulated socket timeout"); });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("GROWTH_REPORT_ENGINE_URL", "https://engine.invalid");
    vi.stubEnv("PROFESSIONAL_ENGINE_API_SECRET", "opaque-local-test-secret");
    const [result] = await approve(report.reportId);
    expect(result?.state).toBe("UNKNOWN");
    const [attempt] = await approve(report.reportId, {
      nextGeneration: true,
      expectedOperationId: String(result?.recovery_operation_id),
    });
    expect(attempt?.state).toBe("HOLD");
    expect(attempt?.error_code).toBe("EXPLICIT_NEXT_GENERATION_APPROVAL_REQUIRED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a lineage-bound HTTP 502 UNKNOWN as ENGINE-confirmed and permits explicit next generation", async () => {
    const report = await createLegacyUnknown();
    const fetch = installEngineResponse(unknownResponse, 502);
    const [firstResult] = await approve(report.reportId);
    expect(firstResult).toMatchObject({
      state: "UNKNOWN",
      recovery_generation: 1,
    });
    const confirmed = await first.query(
      `SELECT engine_confirmed_unknown FROM growth_report_unknown_reissue_operations WHERE id=$1`,
      [firstResult?.recovery_operation_id],
    );
    expect(confirmed.rows[0].engine_confirmed_unknown).toBe(true);
    const [nextResult] = await approve(report.reportId, {
      nextGeneration: true,
      expectedOperationId: String(firstResult?.recovery_operation_id),
    });
    expect(nextResult).toMatchObject({
      state: "UNKNOWN",
      recovery_generation: 2,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps metadata-free HTTP 503 ambiguous for same-operation replay and preserves HTTP 409 engine codes", async () => {
    const ambiguous = await createLegacyUnknown();
    const fetch = installEngineResponse(() => ({
      status: "ERROR",
      error_code: "UPSTREAM_UNAVAILABLE",
    }), 503);
    const [firstResult] = await approve(ambiguous.reportId);
    expect(firstResult).toMatchObject({
      state: "UNKNOWN",
      error_code: "ENGINE_HTTP_503_AMBIGUOUS",
    });
    const operation = await first.query(
      `SELECT state, engine_confirmed_unknown FROM growth_report_unknown_reissue_operations
       WHERE report_id=$1`,
      [ambiguous.reportId],
    );
    expect(operation.rows[0]).toEqual({
      state: "UNKNOWN",
      engine_confirmed_unknown: false,
    });
    const [blockedNextGeneration] = await approve(ambiguous.reportId, {
      nextGeneration: true,
      expectedOperationId: String(firstResult?.recovery_operation_id),
    });
    expect(blockedNextGeneration?.state).toBe("HOLD");
    const [sameOperationReplay] = await approve(ambiguous.reportId);
    expect(sameOperationReplay).toMatchObject({
      state: "UNKNOWN",
      recovery_operation_id: firstResult?.recovery_operation_id,
      new_request_id: firstResult?.new_request_id,
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    const conflict = await createLegacyUnknown();
    installEngineResponse(() => ({
      status: "ERROR",
      error_code: "ENGINE_REISSUE_REQUEST_CONFLICT",
      analysis_retry_allowed: false,
    }), 409);
    const [conflictResult] = await approve(conflict.reportId);
    expect(conflictResult).toMatchObject({
      state: "CONFLICT",
      error_code: "ENGINE_REISSUE_REQUEST_CONFLICT",
    });
  });

  it("holds a legacy UNKNOWN with NULL original payload without dispatching ENGINE", async () => {
    const report = await createLegacyUnknown({ nullOriginalPayload: true });
    const fetch = installEngineResponse(request => unknownResponse(request));
    const [result] = await approve(report.reportId);
    expect(result).toMatchObject({
      state: "HOLD",
      error_code: "ORIGINAL_PAYLOAD_IDENTITY_INVALID",
      recovery_operation_id: null,
    });
    expect(fetch).not.toHaveBeenCalled();
    const operations = await first.query(
      `SELECT id FROM growth_report_unknown_reissue_operations WHERE report_id=$1`,
      [report.reportId],
    );
    expect(operations.rows).toHaveLength(0);
  });

  it("includes legacy UNKNOWN rows with NULL monthly outcomes in the UNKNOWN diagnostic filter", async () => {
    const report = await createLegacyUnknown({ nullLegacyMonthlyState: true });
    await first.query(
      `INSERT INTO growth_report_monthly_runs (report_period) VALUES ($1)
       ON CONFLICT (report_period) DO NOTHING`,
      [report.reportPeriod],
    );
    await first.query(
      `INSERT INTO growth_report_monthly_run_pools
        (report_period, swimming_pool_id, cycle_id, preparation_status)
       VALUES ($1,$2,$3,'sealed')`,
      [report.reportPeriod, report.poolId, report.cycleId],
    );
    const result = await listMonthlyAutomationExceptions(db, {
      reportPeriod: report.reportPeriod,
      poolId: report.poolId,
      category: "UNKNOWN",
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      first_pass_outcome: null,
      unknown_reissue_allowed: true,
    });
  });

  it("imports a matching COMPLETE result transactionally, clears archived presentation, and preserves monthly parent-window rules", async () => {
    const report = await createLegacyUnknown({ nullLegacyMonthlyState: true });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T17:00:00.000Z"));
    const fetch = installEngineResponse(request => {
      return {
        status: "COMPLETE",
        recovery_operation_id: request.recovery_operation_id,
        original_request_id: request.original_request_id,
        new_request_id: request.new_request_id,
        result: {
          request_id: request.new_request_id,
          report_id: report.reportId,
          analysis_status: "COMPLETE",
          questions: [],
          report_content: { summary: "new validated result" },
          sns_summary: { share_safe: true },
          fact_package: {
            grounded: true,
            report_context: {
              request_id: request.new_request_id,
              report_id: report.reportId,
              pool_id: report.poolId,
              student_id: report.studentId,
              report_period: report.reportPeriod,
            },
          },
          validation: { grounding: "PASS", growth_framing: "PASS" },
          trace: { payload_hash: request.expected_payload_hash },
        },
      };
    });
    const [result] = await approve(report.reportId);
    expect(result?.state).toBe("COMPLETE");
    expect(result?.terminal_outcome).toBe("COMPLETE");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [replayed] = await approve(report.reportId);
    expect(replayed).toMatchObject({
      state: "COMPLETE",
      recovery_operation_id: result?.recovery_operation_id,
      new_request_id: result?.new_request_id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const saved = await first.query(
      `SELECT product_status, analysis_uncertain_at, report_content,
              report_fact_package, sns_summary, analysis_request_id
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(saved.rows[0].product_status).toBe("REVIEW_REQUIRED");
    expect(saved.rows[0].analysis_uncertain_at).toBeNull();
    expect(saved.rows[0].report_content).toEqual({ summary: "new validated result" });
    expect(saved.rows[0].report_fact_package.grounding_result).toBe("PASS");
    expect(saved.rows[0].sns_summary.share_safe).toBe(true);
    const target = await first.query(
      `SELECT first_pass_outcome FROM growth_report_eligible_targets WHERE cycle_id=$1 AND student_id=$2`,
      [report.cycleId, report.studentId],
    );
    expect(target.rows[0].first_pass_outcome).toBe("generated");
    const readyCycle = await first.query(
      `SELECT ready_at FROM growth_report_cycles WHERE id=$1`,
      [report.cycleId],
    );
    expect(readyCycle.rows[0].ready_at).not.toBeNull();
    const readyIntents = await first.query(
      `SELECT recipient_type FROM growth_report_notification_outbox
       WHERE swimming_pool_id=$1 AND report_period=$2`,
      [report.poolId, report.reportPeriod],
    );
    expect(readyIntents.rows).toEqual([{ recipient_type: "user" }]);
    expect(readyIntents.rows).toHaveLength(1);
  });

  it("normalizes DATA_ACCUMULATING to the truthful monthly notice without requiring grounding PASS", async () => {
    const report = await createLegacyUnknown({ nullLegacyMonthlyState: true });
    installEngineResponse(request => ({
      status: "COMPLETE",
      recovery_operation_id: request.recovery_operation_id,
      original_request_id: request.original_request_id,
      new_request_id: request.new_request_id,
      result: {
        request_id: request.new_request_id,
        report_id: report.reportId,
        analysis_status: "DATA_ACCUMULATING",
        questions: [],
        report_content: { summary: "ENGINE returned accumulating" },
        sns_summary: null,
        fact_package: {
          report_context: {
            request_id: request.new_request_id,
            report_id: report.reportId,
            pool_id: report.poolId,
            student_id: report.studentId,
            report_period: report.reportPeriod,
          },
        },
        validation: { grounding: "FAIL", growth_framing: "FAIL" },
        trace: { payload_hash: request.expected_payload_hash },
      },
    }));
    const [result] = await approve(report.reportId);
    expect(result?.state).toBe("INSUFFICIENT_EVIDENCE");
    expect(result?.terminal_outcome).toBe("INSUFFICIENT_EVIDENCE");
    const saved = await first.query(
      `SELECT product_status, analysis_status, analysis_uncertain_at,
              monthly_final_disposition, report_content, report_fact_package, sns_summary
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(saved.rows[0]).toMatchObject({
      product_status: "REVIEW_REQUIRED",
      analysis_status: "DATA_ACCUMULATING",
      monthly_final_disposition: "INSUFFICIENT_EVIDENCE",
      report_fact_package: null,
      sns_summary: null,
    });
    expect(saved.rows[0].analysis_uncertain_at).toBeNull();
    expect(saved.rows[0].report_content).toMatchObject({
      student_name: "Legacy Student",
      composition_version: "APP_MONTHLY_NOTICE_V1",
    });
    const target = await first.query(
      `SELECT first_pass_outcome FROM growth_report_eligible_targets WHERE cycle_id=$1 AND student_id=$2`,
      [report.cycleId, report.studentId],
    );
    expect(target.rows[0].first_pass_outcome).toBe("insufficient_evidence");
  });

  it("moves retryable ENGINE errors through the real FAILED lifecycle and readiness outcome", async () => {
    const report = await createLegacyUnknown();
    const fetch = installEngineResponse(request => ({
      status: "ERROR",
      recovery_operation_id: request.recovery_operation_id,
      original_request_id: request.original_request_id,
      new_request_id: request.new_request_id,
      error_code: "SERVICE_UNAVAILABLE",
      retryable: true,
      detail: "Temporary ENGINE outage",
    }));
    const [result] = await approve(report.reportId);
    expect(result).toMatchObject({ state: "FAILED", retryable: true });
    const [replayed] = await approve(report.reportId);
    expect(replayed).toMatchObject({
      state: "FAILED",
      recovery_operation_id: result?.recovery_operation_id,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const saved = await first.query(
      `SELECT product_status, analysis_status, analysis_request_id,
              analysis_uncertain_at, report_content
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(saved.rows[0].product_status).toBe("FAILED");
    expect(saved.rows[0].analysis_status).toBe("FAILED");
    expect(saved.rows[0].analysis_request_id).toBe(result?.new_request_id);
    expect(saved.rows[0].analysis_uncertain_at).toBeNull();
    expect(saved.rows[0].report_content.summary).toContain("archived");
    const target = await first.query(
      `SELECT first_pass_outcome, first_pass_error_code
       FROM growth_report_eligible_targets WHERE cycle_id=$1 AND student_id=$2`,
      [report.cycleId, report.studentId],
    );
    expect(target.rows[0]).toMatchObject({
      first_pass_outcome: "failed",
      first_pass_error_code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects bad ENGINE identity envelopes without importing or clearing legacy content", async () => {
    const report = await createLegacyUnknown();
    installEngineResponse(request => ({
      status: "UNKNOWN",
      recovery_operation_id: uuid(),
      original_request_id: request.original_request_id,
      new_request_id: request.new_request_id,
    }));
    const [result] = await approve(report.reportId);
    expect(result?.state).toBe("CONFLICT");
    expect(result?.error_code).toBe("ENGINE_RECOVERY_ENVELOPE_MISMATCH");
    const saved = await first.query(
      `SELECT analysis_request_id, analysis_uncertain_at, report_content
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(saved.rows[0].analysis_request_id).toBe(report.requestId);
    expect(saved.rows[0].analysis_uncertain_at).not.toBeNull();
    expect(saved.rows[0].report_content.summary).toContain("archived");
  });

  it("fails closed on mismatched persisted report context and never imports its report body", async () => {
    const report = await createLegacyUnknown();
    installEngineResponse(request => ({
      status: "COMPLETE",
      recovery_operation_id: request.recovery_operation_id,
      original_request_id: request.original_request_id,
      new_request_id: request.new_request_id,
      result: {
        request_id: request.new_request_id,
        report_id: report.reportId,
        analysis_status: "COMPLETE",
        questions: [],
        report_content: { summary: "must not be imported" },
        sns_summary: { share_safe: true },
        fact_package: {
          report_context: {
            request_id: request.new_request_id,
            report_id: "gr_wrong_report",
            pool_id: report.poolId,
            student_id: report.studentId,
            report_period: report.reportPeriod,
          },
        },
        validation: { grounding: "PASS", growth_framing: "PASS" },
        trace: { payload_hash: request.expected_payload_hash },
      },
    }));
    const [result] = await approve(report.reportId);
    expect(result?.state).toBe("CONFLICT");
    expect(result?.error_code).toBe("ENGINE_RESULT_IDENTITY_MISMATCH");
    const saved = await first.query(
      `SELECT analysis_request_id, analysis_uncertain_at, report_content
       FROM growth_reports WHERE id=$1`,
      [report.reportId],
    );
    expect(saved.rows[0].analysis_request_id).toBe(report.requestId);
    expect(saved.rows[0].analysis_uncertain_at).not.toBeNull();
    expect(saved.rows[0].report_content.summary).toContain("archived");
  });

  it("does not dispatch resolved or unsealed legacy reports", async () => {
    const resolved = await createLegacyUnknown();
    await first.query(
      `UPDATE growth_reports SET product_status='REVIEW_REQUIRED', analysis_uncertain_at=NULL
       WHERE id=$1`,
      [resolved.reportId],
    );
    const unsealed = await createLegacyUnknown();
    await first.query(
      `UPDATE growth_report_cycles SET eligibility_sealed_at=NULL WHERE id=$1`,
      [unsealed.cycleId],
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const [resolvedResult] = await approve(resolved.reportId);
    const [unsealedResult] = await approve(unsealed.reportId);
    expect(resolvedResult?.state).toBe("HOLD");
    expect(unsealedResult?.state).toBe("HOLD");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serializes simultaneous approvals under the report lock and dispatch lease", async () => {
    const report = await createLegacyUnknown();
    let release!: (body: unknown) => void;
    const responseGate = new Promise<unknown>(resolve => { release = resolve; });
    const fetch = installEngineResponse(() => responseGate);
    const firstApproval = approve(report.reportId);
    for (let i = 0; i < 50 && fetch.mock.calls.length === 0; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    const [parallelResult] = await approve(report.reportId, {}, secondDb);
    expect(parallelResult?.state).toBe("PROCESSING");
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    release({ ...unknownResponse(request), recovery_generation: 1 });
    const [firstResult] = await firstApproval;
    expect(firstResult?.state).toBe("UNKNOWN");
  });
});