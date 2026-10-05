import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMonthlyFreeAutoPublication } from "../../jobs/growth-report-auto-publisher.js";
import { reconcileMonthlyCycle } from "../../jobs/growth-report-monthly-readiness.js";
import { sealMonthlyTargets } from "../../lib/growth-report-monthly-targets.js";
import { withdrawStudent } from "../../lib/withdraw-student-service.js";
import {
  KnownGrowthReportPushRejection,
  notifyGrowthReportAdminsReady,
  retryPendingGrowthReportNotifications,
} from "../growth-report-notification-outbox.js";
import { enqueueDay5DeadlineBlocked } from "../growth-report-day5-watchdog.js";
import { up as extendDay5Constraint } from "../../migrations/growth-report-day5-watchdog.js";

// Never let fixture incidents or first-pass bookkeeping reach an app DB/provider.
vi.mock("../../lib/incident-alerts.js", () => ({
  fireMonthlyGrowthReportIncident: vi.fn(),
}));
vi.mock("../../lib/growth-report-monthly-run.js", () => ({
  finishMonthlyFirstPass: vi.fn().mockResolvedValue(null),
}));
vi.mock("../notify.js", () => ({
  notifyMonthlyDay5Blocked: vi.fn().mockResolvedValue(0),
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
        analysis_from timestamptz,
        ready_at timestamptz,updated_at timestamptz DEFAULT NOW());
      CREATE TABLE growth_reports(id text PRIMARY KEY DEFAULT gen_random_uuid()::text,cycle_id text,student_id text,
        swimming_pool_id text,report_period text,product_status text,analysis_status text,
        report_type text DEFAULT 'monthly',parent_input_status text,snapshot_version int,
        period_start date,period_end date,analysis_request_id text,analysis_request_payload jsonb,
        analysis_response_payload jsonb,
        exclusion_code text,analysis_retry_count int DEFAULT 0,
        analysis_next_attempt_at timestamptz,analysis_claim_token text,
        analysis_lease_until timestamptz,analysis_call_started_at timestamptz,
        analysis_uncertain_at timestamptz,eligibility_version int DEFAULT 4,
        attendance_count int DEFAULT 3,source_event_count int DEFAULT 1,
        report_content jsonb,report_fact_package jsonb,sns_summary jsonb,
        monthly_final_disposition text,monthly_disposition_version int,
        deleted_at timestamptz,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW(),
        UNIQUE(cycle_id,student_id));
      CREATE TABLE growth_report_eligible_targets(cycle_id text,student_id text,
        first_pass_outcome text,first_pass_error_code text,confirmed_at timestamptz DEFAULT NOW(),
        eligibility_version int DEFAULT 4,source_provenance text DEFAULT 'LIVE_SEAL',
        eligibility_evidence jsonb DEFAULT '{"attendance_count":3,"source_event_count":1}',
        policy_excluded_at timestamptz,policy_exclusion_reason text,policy_evidence_ref text,
        PRIMARY KEY(cycle_id,student_id));
      CREATE TABLE withdrawn_member_archives(id text PRIMARY KEY,pool_id text,
        original_student_id text,withdrawn_at timestamptz,withdrawn_by_id text);
      CREATE TABLE students(id text PRIMARY KEY,swimming_pool_id text,status text,
        withdrawn_at timestamptz,deleted_at timestamptz);
      CREATE TABLE growth_report_notification_outbox(id text PRIMARY KEY,notification_type text,
        swimming_pool_id text,report_period text,recipient_id text,recipient_type text,
        title text,body text,deep_link text,payload jsonb,status text DEFAULT 'PENDING',
        next_attempt_at timestamptz DEFAULT NOW(),attempt_count int DEFAULT 0,
        lease_until timestamptz,lease_token text,dispatch_started_at timestamptz,
        delivered_at timestamptz,provider_receipt_id text,last_error text,
        updated_at timestamptz DEFAULT NOW(),event_scope text DEFAULT 'pool',event_key text,
        created_at timestamptz DEFAULT NOW(),
        UNIQUE(notification_type,swimming_pool_id,report_period,recipient_id));
      CREATE UNIQUE INDEX day5_event_recipient
        ON growth_report_notification_outbox(event_key,recipient_id) WHERE event_key IS NOT NULL;
      CREATE TABLE super_admin_notifications(id text PRIMARY KEY,type text,title text,body text,
        pool_id text,ref_id text,ref_type text,is_read boolean,idempotency_key text,created_at timestamptz);
      CREATE UNIQUE INDEX day5_inbox_key ON super_admin_notifications(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE TABLE notifications(id text PRIMARY KEY,recipient_id text,recipient_type text,
        pool_id text,type text,title text,body text,ref_id text,ref_type text,
        deep_link text,is_read boolean);
    `);
    await extendDay5Constraint(db);
    await extendDay5Constraint(db);
  });
  beforeEach(async () => {
    await connections.query(`TRUNCATE swimming_pools,users,growth_report_cycles,growth_reports,
      growth_report_eligible_targets,withdrawn_member_archives,students,
      growth_report_notification_outbox,notifications,super_admin_notifications`);
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

  const watchdogTick = (sender: any, now = issueAt) =>
    runMonthlyFreeAutoPublication(db, now, async params => {
      await notifyGrowthReportAdminsReady(db, params, sender);
    }, async params => { await enqueueDay5DeadlineBlocked(db, params); });

  it("117/119 sends Day-5 even with an earlier incident, and concurrent restart/replay is exactly once", async () => {
    const cycle = await fixture("pool-blocked", "2026-09", 119, 3);
    await connections.query(`UPDATE growth_reports SET product_status='PARTIAL',
      analysis_status='DATA_ACCUMULATING',report_content=NULL,report_fact_package=NULL,sns_summary=NULL
      WHERE id IN ($1,$2)`,[`${cycle}_student_0_report`,`${cycle}_student_1_report`]);
    await connections.query(`INSERT INTO super_admin_notifications
      (id,type,idempotency_key) VALUES('prior','GROWTH_REPORT_FIRST_PASS_FINISHED','prior-incident')`);
    const before = await reportsSnapshot();
    const sender = vi.fn().mockResolvedValue({ providerReceiptId: "day5-ticket" });
    await watchdogTick(sender, new Date(issueAt.getTime() - 1));
    expect((await connections.query("SELECT * FROM growth_report_notification_outbox")).rowCount).toBe(0);
    await Promise.all([watchdogTick(sender), watchdogTick(sender)]);
    await Promise.all([
      retryPendingGrowthReportNotifications(db,sender),
      retryPendingGrowthReportNotifications(db,sender),
    ]);
    await watchdogTick(sender);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0]).toMatchObject({
      type:"GROWTH_REPORT_DAY5_DEADLINE_BLOCKED",
      recipientId:"pool-blocked_super",
      payload:{eligible_total:119,resolved_total:117,remaining_count:2,unknown:2},
    });
    expect((await connections.query(`SELECT * FROM growth_report_notification_outbox
      WHERE notification_type='GROWTH_REPORT_DAY5_DEADLINE_BLOCKED' AND status='DELIVERED'`)).rowCount).toBe(1);
    expect((await connections.query(`SELECT * FROM super_admin_notifications
      WHERE type='GROWTH_REPORT_DAY5_DEADLINE_BLOCKED'`)).rowCount).toBe(1);
    expect(await reportsSnapshot()).toEqual(before);
    expect((await connections.query("SELECT * FROM notifications")).rowCount).toBe(0);
  });

  it("a pending Day-5 alert resolved before dispatch never sends BLOCKED; existing READY sends once", async () => {
    const cycle = await fixture("pool-recovered");
    await connections.query(`UPDATE growth_reports SET product_status='FAILED',analysis_status='FAILED'
      WHERE cycle_id=$1`,[cycle]);
    await enqueueDay5DeadlineBlocked(db,{poolId:"pool-recovered",reportPeriod:"2026-09",now:issueAt});
    await connections.query(`UPDATE growth_reports SET product_status='REVIEW_REQUIRED',analysis_status='COMPLETE'
      WHERE cycle_id=$1`,[cycle]);
    const sender = vi.fn().mockResolvedValue({ providerReceiptId:"ready-ticket" });
    await watchdogTick(sender);
    await retryPendingGrowthReportNotifications(db,sender);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0].type).toBe("GROWTH_REPORT_BATCH_READY");
    const row = (await connections.query(`SELECT last_error,next_attempt_at::text AS due
      FROM growth_report_notification_outbox
      WHERE notification_type='GROWTH_REPORT_DAY5_DEADLINE_BLOCKED'`)).rows[0];
    expect(row).toEqual({last_error:"DAY5_BLOCKER_RESOLVED_BEFORE_DISPATCH",due:"infinity"});
  });

  it("all sealed pools are checked despite disabled entitlement; one blocked pool never blocks another READY", async () => {
    await fixture("pool-failed-day5");
    await fixture("pool-ready-day5");
    await connections.query(`UPDATE swimming_pools SET x_paid_entitlement=false,
      x_force_disabled=true,approval_status='rejected' WHERE id='pool-failed-day5'`);
    await connections.query(`UPDATE growth_reports SET product_status='FAILED',analysis_status='FAILED'
      WHERE swimming_pool_id='pool-failed-day5'`);
    const sender = vi.fn().mockResolvedValue({providerReceiptId:"ticket"});
    await watchdogTick(sender);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender.mock.calls.filter(([item])=>item.type==="GROWTH_REPORT_BATCH_READY")).toHaveLength(1);
    expect(sender.mock.calls.filter(([item])=>item.type==="GROWTH_REPORT_DAY5_DEADLINE_BLOCKED")).toHaveLength(2);
    expect((await connections.query("SELECT * FROM growth_reports WHERE product_status='PUBLISHED'")).rowCount).toBe(0);
    expect((await connections.query("SELECT * FROM notifications WHERE recipient_type<>'user'")).rowCount).toBe(0);
  });

  it("a sealed empty pool is not silently skipped at the deadline", async () => {
    await fixture("pool-empty-day5", "2026-09", 0);
    const sender = vi.fn().mockResolvedValue({providerReceiptId:"empty-ticket"});
    await watchdogTick(sender);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0]).toMatchObject({
      type:"GROWTH_REPORT_DAY5_DEADLINE_BLOCKED",
      payload:{eligible_total:0,empty_target:true},
    });
  });

  it("canonical withdrawal SQL preserves sealed/PUBLISHED reports, deletes only ordinary temporary reports", async () => {
    const cycle = await fixture("pool-preserve");
    const student = `${cycle}_student_0`;
    const before = await reportsSnapshot();
    await connections.query(`INSERT INTO growth_reports(id,student_id,report_type,product_status)
      VALUES('published',$1,'monthly','PUBLISHED'),('temporary',$1,'monthly','PARTIAL'),
        ('custom',$1,'custom','PUBLISHED')`,[student]);
    const execute = async (query: any) => {
      const text = query.queryChunks.filter((c:any)=>Array.isArray(c?.value)).flatMap((c:any)=>c.value).join("");
      if (text.includes("DELETE FROM growth_reports")) return db.execute(query);
      if (text.includes("SELECT id, name, status, swimming_pool_id")) return {
        rows:[{id:student,name:"Fixture",status:"active",swimming_pool_id:"pool-preserve",class_group_id:null}],
      };
      if (text.includes("SELECT id FROM students")) return {rows:[{id:student}]};
      if (text.includes("FROM students s")) return {rows:[{name:"Fixture"}]};
      return {rows:[],rowCount:0};
    };
    await withdrawStudent({execute,transaction:(fn:any)=>fn({execute})},student,"pool-preserve",
      {userId:"pool-preserve_admin",role:"pool_admin"});
    const retained = (await connections.query("SELECT id FROM growth_reports ORDER BY id")).rows.map(r=>r.id);
    expect(retained).toEqual([`${student}_report`,"published"].sort());
    expect((await connections.query("SELECT to_jsonb(r) AS data FROM growth_reports r WHERE cycle_id=$1 ORDER BY id",[cycle])).rows).toEqual(before);
    expect((await connections.query("SELECT COUNT(*)::int AS n FROM growth_report_eligible_targets")).rows[0].n).toBe(1);
  });

  it("114 generated + 3 notices + 2 settled post-seal withdrawals resolves 119, never recreates excluded targets", async () => {
    const cycle = await fixture("pool-withdrawal","2026-09",119,3);
    const students = [0,1].map(i=>`${cycle}_student_${i}`);
    for (const student of students) {
      await connections.query(`INSERT INTO students VALUES($1,'pool-withdrawal','withdrawn',NOW()-INTERVAL '1 minute',NULL)`,[student]);
      await connections.query(`INSERT INTO withdrawn_member_archives
        SELECT $1,'pool-withdrawal',id,withdrawn_at,'pool-withdrawal_admin' FROM students WHERE id=$2`,[`withdraw_${student}`,student]);
      await connections.query(`UPDATE growth_report_eligible_targets SET confirmed_at=NOW()-INTERVAL '1 day',
        first_pass_outcome='identity_error',first_pass_error_code='MONTHLY_NOTICE_UNRESOLVED' WHERE student_id=$1`,[student]);
      await connections.query(`UPDATE growth_reports SET product_status='PARTIAL',analysis_status='DATA_ACCUMULATING',
        analysis_response_payload='{"analysis_status":"DATA_ACCUMULATING","fixture_evidence":"retain"}',
        report_fact_package=NULL,sns_summary=NULL WHERE student_id=$1`,[student]);
    }
    const nonWithdrawnBefore = (await connections.query("SELECT to_jsonb(r) AS data FROM growth_reports r WHERE student_id<>ALL($1) ORDER BY id",[students])).rows;
    const evidenceBefore = (await connections.query("SELECT student_id,analysis_response_payload,report_content FROM growth_reports WHERE student_id=ANY($1) ORDER BY student_id",[students])).rows;
    const beforeGate = await reconcileMonthlyCycle(db,{poolId:"pool-withdrawal",reportPeriod:"2026-09"},undefined,{recordReady:false});
    expect(beforeGate).toMatchObject({resolved_total:117,unknown:2,ready:false});
    const sender = vi.fn().mockResolvedValue({accepted:true,providerReceiptId:"fixture-only"});
    await Promise.all([tick(sender),tick(sender)]);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0].payload.readiness).toMatchObject({
      eligible_total:119,generated_total:114,insufficient_evidence_total:3,policy_excluded_total:2,
      resolved_total:119,remaining_count:0,unknown:0,ready:true,
    });
    expect((await connections.query("SELECT student_id,analysis_response_payload,report_content FROM growth_reports WHERE student_id=ANY($1) ORDER BY student_id",[students])).rows).toEqual(evidenceBefore);
    expect((await connections.query("SELECT to_jsonb(r) AS data FROM growth_reports r WHERE student_id<>ALL($1) ORDER BY id",[students])).rows).toEqual(nonWithdrawnBefore);
    expect((await connections.query("SELECT product_status FROM growth_reports WHERE student_id=ANY($1)",[students])).rows).toEqual([{product_status:"EXCLUDED"},{product_status:"EXCLUDED"}]);
    expect((await connections.query("SELECT COUNT(*)::int AS n FROM growth_report_eligible_targets WHERE cycle_id=$1",[cycle])).rows[0].n).toBe(119);
    await sealMonthlyTargets(db,{cycleId:cycle,poolId:"pool-withdrawal",reportPeriod:"2026-09"});
    expect((await connections.query("SELECT COUNT(*)::int AS n FROM growth_reports WHERE cycle_id=$1",[cycle])).rows[0].n).toBe(119);
    await tick(sender);
    await retryPendingGrowthReportNotifications(db,sender);
    expect(sender).toHaveBeenCalledOnce();
    expect((await connections.query("SELECT COUNT(*)::int AS n FROM growth_report_notification_outbox")).rows[0].n).toBe(1);
    // Even if an external repair accidentally removes an excluded report, preparation must not re-OPEN it.
    await connections.query("DELETE FROM growth_reports WHERE student_id=$1",[students[0]]);
    await sealMonthlyTargets(db,{cycleId:cycle,poolId:"pool-withdrawal",reportPeriod:"2026-09"});
    expect((await connections.query("SELECT COUNT(*)::int AS n FROM growth_reports WHERE student_id=$1",[students[0]])).rows[0].n).toBe(0);
    expect((await connections.query("SELECT * FROM growth_reports WHERE product_status='PUBLISHED'")).rowCount).toBe(0);
    expect((await connections.query("SELECT * FROM notifications WHERE recipient_type<>'user'")).rowCount).toBe(0);
  });

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