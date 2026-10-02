import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMonthlyFreeAutoPublication } from "../../jobs/growth-report-auto-publisher.js";
import {
  KnownGrowthReportPushRejection,
  notifyGrowthReportAdminsReady,
  retryPendingGrowthReportNotifications,
} from "../growth-report-notification-outbox.js";

// Never let fixture incidents or first-pass bookkeeping reach an app DB/provider.
vi.mock("../../lib/incident-alerts.js", () => ({
  fireMonthlyGrowthReportIncident: vi.fn(),
}));
vi.mock("../../lib/growth-report-monthly-run.js", () => ({
  finishMonthlyFirstPass: vi.fn().mockResolvedValue(null),
}));

const enabled = process.env.GR_DAY5_POSTGRES_TEST === "true";
describe.skipIf(!enabled)("day-5 admin PUSH disposable PostgreSQL sequence", () => {
  const schema = `day5_${randomUUID().replaceAll("-", "")}`;
  let root: pg.Client;
  let connections: pg.Pool;
  let db: any;
  const issueAt = new Date("2026-10-04T17:00:00Z");
  const message = "이번 달 AI 성장리포트 발급이 완료되었습니다.\nSWIMNOTE에서 검수 후 학부모에게 발송해 주세요.";

  beforeAll(async () => {
    const url = new URL(process.env.GR_DAY5_ISOLATED_DB_URL ?? "invalid:");
    if (url.hostname !== "127.0.0.1" || url.port !== "55441" ||
      url.pathname !== "/postgres" || url.username !== "day5_test") {
      throw new Error("Only disposable localhost day5_test PostgreSQL is permitted");
    }
    root = new pg.Client({ connectionString: url.toString(), ssl: false });
    await root.connect();
    await root.query(`CREATE SCHEMA ${schema}`);
    connections = new pg.Pool({
      connectionString: url.toString(), ssl: false, max: 8,
      options: `-c search_path=${schema},public`,
    });
    db = drizzle(connections);
    await connections.query(`
      CREATE TABLE swimming_pools(id text PRIMARY KEY,x_paid_entitlement boolean DEFAULT true,
        x_manual_entitlement boolean DEFAULT false,x_force_disabled boolean DEFAULT false,
        approval_status text DEFAULT 'approved');
      CREATE TABLE users(id text PRIMARY KEY,swimming_pool_id text,role text);
      CREATE TABLE growth_report_cycles(id text PRIMARY KEY,swimming_pool_id text,
        report_period text,eligible_total int,eligibility_sealed_at timestamptz,
        ready_at timestamptz,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE growth_reports(id text PRIMARY KEY,cycle_id text,student_id text,
        swimming_pool_id text,report_period text,product_status text,analysis_status text,
        exclusion_code text,analysis_retry_count int DEFAULT 0,
        analysis_next_attempt_at timestamptz,analysis_claim_token text,
        analysis_lease_until timestamptz,analysis_call_started_at timestamptz,
        analysis_uncertain_at timestamptz,eligibility_version int DEFAULT 4,
        attendance_count int DEFAULT 3,source_event_count int DEFAULT 1,
        report_content jsonb,report_fact_package jsonb,sns_summary jsonb,
        monthly_final_disposition text,monthly_disposition_version int,
        deleted_at timestamptz,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW());
      CREATE TABLE growth_report_eligible_targets(cycle_id text,student_id text,
        first_pass_outcome text,confirmed_at timestamptz DEFAULT NOW(),
        policy_excluded_at timestamptz,policy_exclusion_reason text,policy_evidence_ref text,
        PRIMARY KEY(cycle_id,student_id));
      CREATE TABLE withdrawn_member_archives(id text PRIMARY KEY,pool_id text,
        original_student_id text,withdrawn_at timestamptz,withdrawn_by_id text);
      CREATE TABLE students(id text PRIMARY KEY,swimming_pool_id text,status text,
        withdrawn_at timestamptz,deleted_at timestamptz);
      CREATE TABLE growth_report_notification_outbox(id text PRIMARY KEY,notification_type text,
        swimming_pool_id text,report_period text,recipient_id text,recipient_type text,
        title text,body text,deep_link text,payload jsonb,status text,
        next_attempt_at timestamptz DEFAULT NOW(),attempt_count int DEFAULT 0,
        lease_until timestamptz,lease_token text,dispatch_started_at timestamptz,
        delivered_at timestamptz,provider_receipt_id text,last_error text,
        updated_at timestamptz DEFAULT NOW(),
        UNIQUE(notification_type,swimming_pool_id,report_period,recipient_id));
      CREATE TABLE notifications(id text PRIMARY KEY,recipient_id text,recipient_type text,
        pool_id text,type text,title text,body text,ref_id text,ref_type text,
        deep_link text,is_read boolean);
    `);
  });
  beforeEach(async () => {
    await connections.query(`TRUNCATE swimming_pools,users,growth_report_cycles,growth_reports,
      growth_report_eligible_targets,withdrawn_member_archives,students,
      growth_report_notification_outbox,notifications`);
  });
  afterAll(async () => {
    await connections?.end();
    if (root) {
      await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await root.end();
    }
  });
  async function fixture(poolId: string, month = "2026-09", count = 1, insufficient = 0) {
    const cycle = `${poolId}_${month}`;
    await connections.query("INSERT INTO swimming_pools(id) VALUES($1) ON CONFLICT DO NOTHING", [poolId]);
    await connections.query(`INSERT INTO users VALUES($1,$2,'pool_admin'),
      ($3,$2,'teacher'),($4,$2,'parent'),($5,NULL,'super_admin') ON CONFLICT DO NOTHING`,
      [`${poolId}_admin`,poolId,`${poolId}_teacher`,`${poolId}_parent`,`${poolId}_super`]);
    await connections.query(`INSERT INTO growth_report_cycles
      (id,swimming_pool_id,report_period,eligible_total,eligibility_sealed_at)
      VALUES($1,$2,$3,$4,NOW())`,[cycle,poolId,month,count]);
    for (let i = 0; i < count; i++) {
      const student = `${cycle}_student_${i}`;
      const isInsufficient = i >= count - insufficient;
      const content = isInsufficient ? {
        student_name: "Fixture",composition_version:"APP_MONTHLY_NOTICE_V1",sections:{},
        summary_text:"이번 달은 성장 판단에 필요한 충분한 변화 근거가 아직 축적되지 않았습니다.",
      } : { summary:"Fixture" };
      await connections.query(`INSERT INTO growth_reports
        (id,cycle_id,student_id,swimming_pool_id,report_period,product_status,analysis_status,
         report_content,report_fact_package,sns_summary,monthly_final_disposition,monthly_disposition_version)
        VALUES($1,$2,$3,$4,$5,'REVIEW_REQUIRED',$6,$7,$8,$9,$10,$11)`,
        [`${student}_report`,cycle,student,poolId,month,
          isInsufficient ? "DATA_ACCUMULATING":"COMPLETE",JSON.stringify(content),
          isInsufficient ? null:JSON.stringify({grounding_result:"PASS",growth_framing_result:"PASS"}),
          isInsufficient ? null:JSON.stringify({present:true}),
          isInsufficient ? "INSUFFICIENT_EVIDENCE":null,isInsufficient ? 1:null]);
      await connections.query(`INSERT INTO growth_report_eligible_targets
        (cycle_id,student_id,first_pass_outcome) VALUES($1,$2,$3)`,
        [cycle,student,isInsufficient ? "insufficient_evidence":"generated"]);
    }
    return cycle;
  }
  const tick = (sender: any, now = issueAt) =>
    runMonthlyFreeAutoPublication(db,now,async params => {
      await notifyGrowthReportAdminsReady(db,params,sender);
    });
  async function reportsSnapshot() {
    return (await connections.query("SELECT to_jsonb(r) AS data FROM growth_reports r ORDER BY id")).rows;
  }

  it("119/119: before-day-5 silence, concurrent ticks, admin-only one send and restart replay", async () => {
    const cycle = await fixture("pool-ready","2026-09",119,3);
    await connections.query("INSERT INTO users VALUES('unrelated_admin','other-pool','pool_admin')");
    const before = await reportsSnapshot();
    const sender = vi.fn().mockResolvedValue({providerReceiptId:"fixture-ticket",accepted:true});
    await tick(sender,new Date("2026-10-04T16:59:59Z"));
    expect(sender).not.toHaveBeenCalled();
    expect((await connections.query("SELECT * FROM growth_report_notification_outbox")).rowCount).toBe(0);
    expect((await connections.query("SELECT ready_at FROM growth_report_cycles WHERE id=$1",[cycle])).rows[0].ready_at).toBeNull();
    await Promise.all(Array.from({length:6},() => tick(sender)));
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      recipientId:"pool-ready_admin",recipientType:"user",poolId:"pool-ready",
      reportPeriod:"2026-09",body:message,
      payload:expect.objectContaining({readiness:expect.objectContaining({
        eligible_total:119,generated_total:116,insufficient_evidence_total:3,resolved_total:119,ready:true,
      })}),
    }));
    expect((await connections.query("SELECT status FROM growth_report_notification_outbox")).rows).toEqual([{status:"DELIVERED"}]);
    const restartedWorker = new pg.Client({
      connectionString: process.env.GR_DAY5_ISOLATED_DB_URL, ssl: false,
      options: `-c search_path=${schema},public`,
    });
    await restartedWorker.connect();
    try {
      await retryPendingGrowthReportNotifications(drizzle(restartedWorker) as any,sender);
    } finally { await restartedWorker.end(); }
    await tick(sender);
    expect(sender).toHaveBeenCalledOnce();
    expect(await reportsSnapshot()).toEqual(before);
    expect((await connections.query("SELECT * FROM notifications WHERE recipient_type<>'user'")).rowCount).toBe(0);
    expect((await connections.query("SELECT * FROM growth_reports WHERE product_status='PUBLISHED'")).rowCount).toBe(0);
  });

  it("reclaims pre-dispatch crashes, preserves READY on explicit rejection, never replays ambiguous sends", async () => {
    const cycle = await fixture("pool-crash");
    const before = await reportsSnapshot();
    const prepareOnly = vi.fn();
    await runMonthlyFreeAutoPublication(db,issueAt,prepareOnly);
    const sender = vi.fn().mockResolvedValue({accepted:true});
    await connections.query(`UPDATE growth_report_notification_outbox SET status='CLAIMED',
      lease_token='dead-worker',lease_until=NOW()-INTERVAL '1 minute'`);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender).toHaveBeenCalledOnce();
    await connections.query(`UPDATE growth_report_notification_outbox SET status='PENDING',next_attempt_at=NOW()`);
    const rejection = vi.fn().mockRejectedValue(new KnownGrowthReportPushRejection("fixture rejection"));
    await retryPendingGrowthReportNotifications(db,rejection);
    expect((await connections.query("SELECT status FROM growth_report_notification_outbox")).rows[0].status).toBe("PENDING");
    expect((await connections.query("SELECT ready_at FROM growth_report_cycles WHERE id=$1",[cycle])).rows[0].ready_at).not.toBeNull();
    await connections.query("UPDATE growth_report_notification_outbox SET next_attempt_at=NOW()");
    const uncertain = vi.fn().mockRejectedValue(new Error("fixture timeout after possible acceptance"));
    const errorLog = vi.spyOn(console,"error").mockImplementation(() => {});
    try {
      await retryPendingGrowthReportNotifications(db,uncertain);
    } finally { errorLog.mockRestore(); }
    expect((await connections.query("SELECT status FROM growth_report_notification_outbox")).rows[0].status).toBe("UNCERTAIN");
    await retryPendingGrowthReportNotifications(drizzle(connections) as any,uncertain);
    await tick(uncertain);
    expect(uncertain).toHaveBeenCalledOnce();
    await connections.query(`UPDATE growth_report_notification_outbox SET status='DISPATCHING',
      dispatch_started_at=NOW()-INTERVAL '6 minutes'`);
    await retryPendingGrowthReportNotifications(db,uncertain);
    expect(uncertain).toHaveBeenCalledOnce();
    expect(await reportsSnapshot()).toEqual(before);
  });

  it("isolates a failed pool and repeats independent per-pool/per-month issuance in November", async () => {
    await fixture("pool-failed");
    await fixture("pool-good");
    await connections.query("UPDATE growth_reports SET product_status='FAILED',analysis_status='FAILED' WHERE swimming_pool_id='pool-failed'");
    const sender = vi.fn().mockResolvedValue({accepted:true});
    await tick(sender);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0].poolId).toBe("pool-good");
    await fixture("pool-good","2026-10");
    await tick(sender,new Date("2026-11-04T16:59:59Z"));
    expect(sender).toHaveBeenCalledOnce();
    await tick(sender,new Date("2026-11-04T17:00:00Z"));
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1][0]).toMatchObject({poolId:"pool-good",reportPeriod:"2026-10",body:message});
    expect((await connections.query("SELECT * FROM growth_reports WHERE product_status='PUBLISHED'")).rowCount).toBe(0);
    expect((await connections.query("SELECT * FROM notifications WHERE recipient_type<>'user'")).rowCount).toBe(0);
  });
});