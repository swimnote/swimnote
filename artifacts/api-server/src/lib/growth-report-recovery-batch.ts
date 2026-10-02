import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { listMonthlyAutomationExceptions, resumeMonthlyAutomationRun } from "./growth-report-monthly-run.js";

type Db = { execute(query: any): Promise<{ rows: any[] }>; transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> };
export type RecoveryTargetState = "PENDING" | "PROCESSING" | "WAITING" | "SUCCESS" |
  "INSUFFICIENT_EVIDENCE" | "FAILED" | "UNKNOWN" | "CONFLICT" | "SKIPPED";
export interface RecoveryBatchTarget {
  id: string;
  batch_id: string;
  report_id: string;
  pool_id: string;
  cycle_id: string;
  kind: "FAILED" | "UNKNOWN";
  original_request_id: string;
  original_recovery_epoch: number;
  expected_operation_id: string | null;
  recovery_operation_id: string | null;
  new_request_id: string | null;
  claim_token: string;
  state: RecoveryTargetState;
  batch: { id: string; report_month: string; actor_id: string; actor_role: string; reason: string; created_at: string };
}
export interface RecoveryScope { reportMonth: string; poolId?: string }
export interface RecoveryApproval extends RecoveryScope {
  approvalId: string; actorId: string; actorRole: string; reason: string;
}
type Candidate = {
  report_id: string; pool_id: string; cycle_id: string; kind: "FAILED" | "UNKNOWN";
  original_request_id: string; original_recovery_epoch: number; expected_operation_id: string | null;
};
type Dependencies = { listExceptions: typeof listMonthlyAutomationExceptions };
const defaults: Dependencies = { listExceptions: listMonthlyAutomationExceptions };
const resolved = new Set(["GENERATED", "COMPLETE", "SUCCESS", "REVIEW_REQUIRED", "READY_TO_SEND",
  "APPROVED", "PUBLISHED", "EXCLUDED", "DISCARDED", "INSUFFICIENT_EVIDENCE"]);
const bool = (value: unknown) => value === true || value === "t";

function validateScope(scope: RecoveryScope) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.reportMonth) ||
      (scope.poolId !== undefined && (!scope.poolId.trim() || scope.poolId.length > 200))) {
    throw new Error("INVALID_RECOVERY_SCOPE");
  }
}

export async function recoveryBatchSchemaReady(db: Pick<Db, "execute">) {
  const result = await db.execute(sql`
    SELECT to_regclass('public.growth_report_recovery_batches') IS NOT NULL
      AND to_regclass('public.growth_report_recovery_batch_targets') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='growth_report_recovery_batches'
          AND column_name='approval_aliases')
      AND EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='growth_report_recovery_batch_targets'
          AND column_name='original_recovery_epoch') AS ready
  `);
  return bool(result.rows[0]?.ready);
}

/** Read-only existing server eligibility, across ALL pages, never client IDs. */
export async function collectRecoveryCohort(db: any, scope: RecoveryScope, deps: Dependencies = defaults): Promise<Candidate[]> {
  validateScope(scope);
  const active = await db.execute(sql`
    SELECT report_id FROM growth_report_recovery_batch_targets
    WHERE state IN ('PENDING','PROCESSING','WAITING')
  `);
  const occupied = new Set(active.rows.map((r: any) => r.report_id));
  const candidates = new Map<string, Candidate>();
  let offset = 0;
  for (;;) {
    const page = await deps.listExceptions(db, {
      reportPeriod: scope.reportMonth, poolId: scope.poolId, limit: 200, offset,
    });
    for (const row of page.rows) {
      if (!row.report_id || !row.analysis_request_id || !row.cycle_id ||
          (scope.poolId && row.swimming_pool_id !== scope.poolId) ||
          occupied.has(row.report_id) || row.policy_excluded_at || row.exclusion_code ||
          resolved.has(String(row.product_status).toUpperCase()) ||
          (row.monthly_final_disposition && row.monthly_final_disposition !== "FAILED")) continue;
      let kind: Candidate["kind"] | null = null;
      if (row.analysis_uncertain_at != null && row.unknown_reissue_allowed === true &&
          !["COMPLETE", "FAILED", "CONFLICT"].includes(row.unknown_reissue_operation?.state)) kind = "UNKNOWN";
      else if (row.analysis_uncertain_at == null && row.recovery_allowed === true) kind = "FAILED";
      if (!kind) continue;
      candidates.set(row.report_id, {
        report_id: row.report_id, pool_id: row.swimming_pool_id, cycle_id: row.cycle_id, kind,
        original_request_id: row.analysis_request_id,
        original_recovery_epoch: Number(row.recovery_epoch ?? 0),
        expected_operation_id: kind === "UNKNOWN" && row.unknown_reissue_next_approval_allowed === true
          ? row.unknown_reissue_operation?.recovery_operation_id ?? null : null,
      });
    }
    offset += page.rows.length;
    if (!page.rows.length || offset >= page.total) break;
  }
  return [...candidates.values()];
}

export async function previewRecoveryBatch(db: Db, scope: RecoveryScope, deps: Dependencies = defaults) {
  validateScope(scope);
  if (!await recoveryBatchSchemaReady(db)) throw new Error("RECOVERY_BATCH_SCHEMA_NOT_READY");
  return db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
    const cohort = await collectRecoveryCohort(tx, scope, deps);
    const rounds = await tx.execute(sql`
      SELECT COALESCE(MAX(recovery_round),0)::int + 1 AS next_round
      FROM growth_report_recovery_batches WHERE report_month = ${scope.reportMonth}
    `);
    return {
      report_month: scope.reportMonth, pool_id: scope.poolId ?? null,
      eligible_total: cohort.length, failed_total: cohort.filter(t => t.kind === "FAILED").length,
      unknown_total: cohort.filter(t => t.kind === "UNKNOWN").length, next_round: Number(rounds.rows[0].next_round),
    };
  });
}

/** Approval transaction stores only membership/consent. No dispatch or bearer. */
export async function createRecoveryBatch(db: Db, approval: RecoveryApproval, deps: Dependencies = defaults) {
  validateScope(approval);
  if (!/^[0-9a-f-]{36}$/i.test(approval.approvalId) || !approval.actorId ||
      !["super_admin", "platform_admin"].includes(approval.actorRole) ||
      !approval.reason.trim() || approval.reason.length > 500) throw new Error("INVALID_RECOVERY_APPROVAL");
  if (!await recoveryBatchSchemaReady(db)) throw new Error("RECOVERY_BATCH_SCHEMA_NOT_READY");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.transaction(async tx => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gr-recovery-approval:${approval.approvalId}`},0))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`gr-recovery:${approval.reportMonth}`},0))`);
        const replay = await tx.execute(sql`
          SELECT * FROM growth_report_recovery_batches
          WHERE approval_id = ${approval.approvalId} OR approval_aliases ? ${approval.approvalId}
        `);
        if (replay.rows[0]) {
          const previous = replay.rows[0];
          const consent = previous.approval_id === approval.approvalId ? previous :
            previous.approval_aliases[approval.approvalId];
          if (consent.report_month !== approval.reportMonth || consent.pool_id !== (approval.poolId ?? null) ||
              consent.actor_id !== approval.actorId || consent.reason !== approval.reason.trim()) {
            throw new Error("RECOVERY_APPROVAL_CONFLICT");
          }
          return { batch: previous, replayed: true };
        }
        const running = await tx.execute(sql`
          SELECT * FROM growth_report_recovery_batches
          WHERE report_month = ${approval.reportMonth} AND pool_id IS NOT DISTINCT FROM ${approval.poolId ?? null}
            AND state IN ('PENDING','RUNNING','PAUSED')
          ORDER BY created_at DESC LIMIT 1
        `);
        if (running.rows[0]) {
          // A concurrent second approval may be mapped to the active batch.
          // Persist that mapping: its timeout replay must never become round 2.
          const consent = {
            report_month: approval.reportMonth, pool_id: approval.poolId ?? null,
            actor_id: approval.actorId, reason: approval.reason.trim(),
          };
          const aliased = await tx.execute(sql`
            UPDATE growth_report_recovery_batches
            SET approval_aliases=approval_aliases ||
              jsonb_build_object(${approval.approvalId}::text,${JSON.stringify(consent)}::jsonb)
            WHERE id=${running.rows[0].id} RETURNING *
          `);
          return { batch: aliased.rows[0], replayed: true };
        }
        const cohort = await collectRecoveryCohort(tx, approval, deps);
        if (!cohort.length) throw new Error("NO_RECOVERABLE_TARGETS");
        const round = await tx.execute(sql`
          SELECT COALESCE(MAX(recovery_round),0)::int + 1 AS recovery_round
          FROM growth_report_recovery_batches WHERE report_month = ${approval.reportMonth}
        `);
        const id = `grrb_${randomUUID().replaceAll("-", "")}`;
        const inserted = await tx.execute(sql`
          INSERT INTO growth_report_recovery_batches
            (id,report_month,pool_id,recovery_round,approval_id,actor_id,actor_role,reason,total,remaining)
          VALUES (${id},${approval.reportMonth},${approval.poolId ?? null},${round.rows[0].recovery_round},
            ${approval.approvalId},${approval.actorId},${approval.actorRole},${approval.reason.trim()},${cohort.length},${cohort.length})
          RETURNING *
        `);
        for (let start = 0; start < cohort.length; start += 1000) {
          const values = cohort.slice(start, start + 1000).map(t => sql`(
            ${`grrt_${randomUUID().replaceAll("-", "")}`},${id},${t.report_id},${t.pool_id},${t.cycle_id},
            ${t.kind},${t.original_request_id},${t.original_recovery_epoch},${t.expected_operation_id})`);
          await tx.execute(sql`
            INSERT INTO growth_report_recovery_batch_targets
              (id,batch_id,report_id,pool_id,cycle_id,kind,original_request_id,original_recovery_epoch,expected_operation_id)
            VALUES ${sql.join(values, sql`, `)}
          `);
        }
        return { batch: inserted.rows[0], replayed: false };
      });
    } catch (error: any) {
      const code = error.code ?? error.cause?.code;
      if (!["40001", "40P01", "23505"].includes(code) || attempt === 3) throw error;
    }
  }
  throw new Error("RECOVERY_APPROVAL_CONFLICT");
}

export async function listRecoveryBatches(db: Db, scope: RecoveryScope) {
  validateScope(scope);
  if (!await recoveryBatchSchemaReady(db)) throw new Error("RECOVERY_BATCH_SCHEMA_NOT_READY");
  const result = await db.execute(sql`
    SELECT * FROM growth_report_recovery_batches WHERE report_month = ${scope.reportMonth}
      ${scope.poolId ? sql`AND (pool_id = ${scope.poolId} OR EXISTS (
        SELECT 1 FROM growth_report_recovery_batch_targets target
        WHERE target.batch_id=growth_report_recovery_batches.id AND target.pool_id=${scope.poolId}
      ))` : sql``}
    ORDER BY created_at DESC LIMIT 50
  `);
  return { batches: result.rows };
}

export async function getRecoveryBatchStatus(db: Db, id: string) {
  const result = await db.execute(sql`SELECT * FROM growth_report_recovery_batches WHERE id = ${id}`);
  return result.rows[0] ?? null;
}

const targetWithBatch = sql`
  target.*, json_build_object('id',batch.id,'report_month',batch.report_month,
    'actor_id',batch.actor_id,'actor_role',batch.actor_role,'reason',batch.reason,'created_at',batch.created_at) AS batch
`;

/** Global dispatch slots across instances; immutable memberships, fenced leases. */
export async function claimRecoveryBatchTargets(db: Db, concurrency: number, leaseSeconds: number): Promise<RecoveryBatchTarget[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error("INVALID_RECOVERY_WORKER_LIMIT");
  }
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('gr-recovery-dispatch',0))`);
    await tx.execute(sql`
      UPDATE growth_report_recovery_batch_targets target SET state='PENDING',claim_token=NULL,lease_until=NULL,updated_at=now()
      FROM growth_report_recovery_batches batch
      WHERE target.batch_id=batch.id AND batch.state IN ('PENDING','RUNNING','PAUSED')
        AND target.state='PROCESSING' AND target.lease_until <= now()
    `);
    const active = await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM growth_report_recovery_batch_targets WHERE state IN ('PROCESSING','WAITING')
    `);
    const slots = Math.max(0, concurrency - Number(active.rows[0].n));
    if (!slots) return [];
    const rows = await tx.execute(sql`
      SELECT ${targetWithBatch}
      FROM growth_report_recovery_batch_targets target
      JOIN growth_report_recovery_batches batch ON batch.id=target.batch_id
      WHERE target.state='PENDING' AND batch.state IN ('PENDING','RUNNING')
      ORDER BY batch.created_at,target.id LIMIT ${slots}
      FOR UPDATE OF target SKIP LOCKED
    `);
    const claimed: RecoveryBatchTarget[] = [];
    for (const row of rows.rows) {
      const token = randomUUID();
      await tx.execute(sql`
        UPDATE growth_report_recovery_batch_targets SET state='PROCESSING',claim_token=${token},
          lease_until=now()+${leaseSeconds}*interval '1 second',updated_at=now() WHERE id=${row.id}
      `);
      await tx.execute(sql`
        UPDATE growth_report_recovery_batches SET state='RUNNING',updated_at=now()
        WHERE id=${row.batch_id} AND state='PENDING'
      `);
      claimed.push({ ...row, state: "PROCESSING", claim_token: token });
    }
    return claimed;
  });
}

export async function renewRecoveryBatchTarget(db: Db, target: RecoveryBatchTarget, leaseSeconds: number) {
  const updated = await db.execute(sql`
    UPDATE growth_report_recovery_batch_targets SET lease_until=now()+${leaseSeconds}*interval '1 second'
    WHERE id=${target.id} AND claim_token=${target.claim_token} AND state='PROCESSING'
      AND lease_until > now() RETURNING id
  `);
  return updated.rows.length > 0;
}

export async function listWaitingRecoveryBatchTargets(db: Db, limit: number): Promise<RecoveryBatchTarget[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("INVALID_RECOVERY_WORKER_LIMIT");
  return db.transaction(async tx => {
    const rows = await tx.execute(sql`
      SELECT ${targetWithBatch} FROM growth_report_recovery_batch_targets target
      JOIN growth_report_recovery_batches batch ON batch.id=target.batch_id
      WHERE target.state='WAITING' ORDER BY target.updated_at LIMIT ${limit}
      FOR UPDATE OF target SKIP LOCKED
    `);
    const claimed: RecoveryBatchTarget[] = [];
    for (const row of rows.rows) {
      const token = randomUUID();
      await tx.execute(sql`
        UPDATE growth_report_recovery_batch_targets SET state='PROCESSING',claim_token=${token},
          lease_until=now()+interval '180 seconds',updated_at=now() WHERE id=${row.id}
      `);
      claimed.push({ ...row, state: "PROCESSING", claim_token: token });
    }
    return claimed;
  });
}

export async function refreshRecoveryBatchProgress(db: Db, id: string) {
  return db.transaction(async tx => {
    const batch = await tx.execute(sql`SELECT * FROM growth_report_recovery_batches WHERE id=${id} FOR UPDATE`);
    if (!batch.rows.length) return null;
    const metrics = await tx.execute(sql`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE state NOT IN ('PENDING','PROCESSING','WAITING'))::int AS completed,
        COUNT(*) FILTER (WHERE state='SUCCESS')::int AS success,
        COUNT(*) FILTER (WHERE state='INSUFFICIENT_EVIDENCE')::int AS insufficient_evidence,
        COUNT(*) FILTER (WHERE state='FAILED')::int AS failed,
        COUNT(*) FILTER (WHERE state='UNKNOWN')::int AS unknown,
        COUNT(*) FILTER (WHERE state='CONFLICT')::int AS conflict,
        COUNT(*) FILTER (WHERE state NOT IN ('SUCCESS','INSUFFICIENT_EVIDENCE','SKIPPED'))::int AS remaining
      FROM growth_report_recovery_batch_targets WHERE batch_id=${id}
    `);
    const m = metrics.rows[0];
    const state = m.completed === m.total ? "COMPLETED" : batch.rows[0].state;
    const updated = await tx.execute(sql`
      UPDATE growth_report_recovery_batches SET total=${m.total},completed=${m.completed},
        success=${m.success},insufficient_evidence=${m.insufficient_evidence},failed=${m.failed},
        unknown=${m.unknown},conflict=${m.conflict},remaining=${m.remaining},state=${state},
        completed_at=CASE WHEN ${state}='COMPLETED' THEN COALESCE(completed_at,now()) ELSE completed_at END,
        updated_at=now() WHERE id=${id} RETURNING *
    `);
    return updated.rows[0];
  });
}

export async function settleRecoveryBatchTarget(db: Db, target: RecoveryBatchTarget, state: RecoveryTargetState,
  detail?: string, lineage?: { recovery_operation_id?: string; new_request_id?: string }) {
  const updated = await db.execute(sql`
    UPDATE growth_report_recovery_batch_targets SET state=${state},detail=${detail?.slice(0,1000) ?? null},
      recovery_operation_id=COALESCE(${lineage?.recovery_operation_id ?? null},recovery_operation_id),
      new_request_id=COALESCE(${lineage?.new_request_id ?? null},new_request_id),
      lease_until=NULL,updated_at=now()
    WHERE id=${target.id} AND claim_token=${target.claim_token}
      AND (state='WAITING' OR (state='PROCESSING' AND lease_until > now())) RETURNING id
  `);
  if (!updated.rows.length) return false;
  await refreshRecoveryBatchProgress(db, target.batch_id);
  return true;
}

export async function pauseRecoveryBatch(db: Db, id: string, reason: string) {
  await db.execute(sql`
    UPDATE growth_report_recovery_batches SET state='PAUSED',pause_reason=${reason.slice(0,1000)},updated_at=now()
    WHERE id=${id} AND state IN ('PENDING','RUNNING')
  `);
}

export async function resumeRecoveryBatch(db: Db, id: string, actorId: string, reason: string) {
  const batch = await getRecoveryBatchStatus(db, id);
  if (!batch) throw new Error("RECOVERY_BATCH_NOT_FOUND");
  if (batch.state !== "PAUSED") return { batch };
  const run = await db.execute(sql`
    SELECT paused_at FROM growth_report_monthly_runs WHERE report_period=${batch.report_month}
  `);
  if (run.rows[0]?.paused_at && !await resumeMonthlyAutomationRun(db, {
    reportPeriod: batch.report_month, actorId, reason,
  })) throw new Error("RECOVERY_CIRCUIT_RESUME_NOT_ALLOWED");
  await db.execute(sql`
    UPDATE growth_report_recovery_batches SET state='PENDING',pause_reason=NULL,updated_at=now()
    WHERE id=${id} AND state='PAUSED'
  `);
  return { batch: await getRecoveryBatchStatus(db, id) };
}