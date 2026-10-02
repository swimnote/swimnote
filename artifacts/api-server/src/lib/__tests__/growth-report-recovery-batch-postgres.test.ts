import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { up as migrateRecoveryBatches } from "../../migrations/growth-report-recovery-batches.js";
import {
  claimRecoveryBatchTargets,
  createRecoveryBatch,
  getRecoveryBatchStatus,
  listWaitingRecoveryBatchTargets,
  listRecoveryBatches,
  pauseRecoveryBatch,
  previewRecoveryBatch,
  refreshRecoveryBatchProgress,
  renewRecoveryBatchTarget,
  resumeRecoveryBatch,
  settleRecoveryBatchTarget,
} from "../growth-report-recovery-batch.js";
import type { RecoveryScope } from "../growth-report-recovery-batch.js";

const enabled = process.env.GR_BULK_RECOVERY_POSTGRES_TEST === "true";
const isolatedDatabaseUrl = process.env.GR_BULK_RECOVERY_ISOLATED_DB_URL;
const approvedLocalDatabase = (() => {
  if (!isolatedDatabaseUrl) return false;
  try {
    const url = new URL(isolatedDatabaseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.port === "56673" &&
      url.pathname === "/swimnote_bulk_recovery_test";
  } catch {
    return false;
  }
})();

type FixtureRow = {
  report_period?: string;
  report_id: string;
  swimming_pool_id: string;
  cycle_id: string;
  recovery_epoch: number;
  analysis_request_id: string;
  analysis_uncertain_at: string | null;
  unknown_reissue_allowed: boolean;
  unknown_reissue_next_approval_allowed: boolean;
  unknown_reissue_operation: { state: string; recovery_operation_id: string } | null;
  recovery_allowed: boolean;
  product_status: string;
  monthly_final_disposition: string | null;
  policy_excluded_at: string | null;
  exclusion_code: string | null;
};

const reportMonth = "2026-08";
const uuid = () => randomUUID();
const opaqueId = (prefix: string) => `${prefix}_${uuid().replaceAll("-", "")}`;

function eligibleFixture(reportId: string, poolId: string, index: number): FixtureRow {
  const unknown = index % 5 === 0;
  return {
    report_id: reportId,
    swimming_pool_id: poolId,
    cycle_id: `${poolId}_cycle`,
    recovery_epoch: 0,
    analysis_request_id: uuid(),
    analysis_uncertain_at: unknown ? new Date().toISOString() : null,
    unknown_reissue_allowed: unknown,
    unknown_reissue_next_approval_allowed: unknown,
    unknown_reissue_operation: unknown
      ? { state: "UNKNOWN", recovery_operation_id: uuid() }
      : null,
    recovery_allowed: !unknown,
    product_status: "FAILED",
    monthly_final_disposition: "FAILED",
    policy_excluded_at: null,
    exclusion_code: null,
  };
}

describe.skipIf(!enabled)("bulk recovery batch PostgreSQL safety", () => {
  let firstPool: pg.Pool;
  let secondPool: pg.Pool;
  let db: any;
  let secondDb: any;
  let connected = false;

  beforeAll(async () => {
    if (!approvedLocalDatabase) {
      throw new Error(
        "Bulk recovery PostgreSQL tests require only GR_BULK_RECOVERY_ISOLATED_DB_URL at localhost:56673/swimnote_bulk_recovery_test.",
      );
    }
    firstPool = new pg.Pool({ connectionString: isolatedDatabaseUrl, ssl: false, max: 4 });
    secondPool = new pg.Pool({ connectionString: isolatedDatabaseUrl, ssl: false, max: 4 });
    await Promise.all([firstPool.query("SELECT 1"), secondPool.query("SELECT 1")]);
    connected = true;
    db = drizzle(firstPool);
    secondDb = drizzle(secondPool);

    // Exercise the additive DDL explicitly. Cleanup is confined to the two
    // recovery tables in the explicitly approved disposable test database.
    await db.transaction((tx: any) => migrateRecoveryBatches(tx));
    await firstPool.query(
      "TRUNCATE TABLE growth_report_recovery_batch_targets, growth_report_recovery_batches",
    );
    await firstPool.query(`
      CREATE TABLE IF NOT EXISTS growth_report_monthly_runs (
        report_period text PRIMARY KEY,
        paused_at timestamptz
      )
    `);
  }, 60_000);

  afterAll(async () => {
    if (connected) {
      try {
        await firstPool.query(
          "TRUNCATE TABLE growth_report_recovery_batch_targets, growth_report_recovery_batches",
        );
      } finally {
        await Promise.all([firstPool.end(), secondPool.end()]);
      }
    }
  });

  it("persists paginated fixed cohorts, scope eligibility, approval replay, bounded fenced claims, and round lineage", async () => {
    const fixtures: FixtureRow[] = [];
    const onePool = opaqueId("pool_one");
    const seventeenPool = opaqueId("pool_seventeen");
    const largePool = opaqueId("pool_large");
    const roundPool = opaqueId("pool_round");

    fixtures.push(eligibleFixture(`${onePool}_report_0`, onePool, 0));
    for (let index = 0; index < 17; index++) {
      fixtures.push(eligibleFixture(`${seventeenPool}_report_${index}`, seventeenPool, index));
    }
    for (let index = 0; index < 1700; index++) {
      fixtures.push(eligibleFixture(`${largePool}_report_${index}`, largePool, index));
    }
    const frozenEpochRow = fixtures.find(row =>
      row.swimming_pool_id === largePool && row.report_id === `${largePool}_report_1`,
    )!;
    frozenEpochRow.recovery_epoch = 2;
    for (let index = 0; index < 17; index++) {
      fixtures.push(eligibleFixture(`${roundPool}_report_${index}`, roundPool, index === 0 ? 0 : 1));
    }

    const ineligible = eligibleFixture(`${largePool}_published`, largePool, 1);
    ineligible.product_status = "PUBLISHED";
    const completed = eligibleFixture(`${largePool}_complete`, largePool, 1);
    completed.product_status = "COMPLETE";
    const generated = eligibleFixture(`${largePool}_generated`, largePool, 1);
    generated.product_status = "GENERATED";
    const insufficient = eligibleFixture(`${largePool}_insufficient`, largePool, 1);
    insufficient.product_status = "INSUFFICIENT_EVIDENCE";
    const policyExcluded = eligibleFixture(`${largePool}_policy`, largePool, 1);
    policyExcluded.policy_excluded_at = new Date().toISOString();
    const excludedByCode = eligibleFixture(`${largePool}_exclusion_code`, largePool, 1);
    excludedByCode.exclusion_code = "POST_ELIGIBILITY_WITHDRAWAL";
    const wrongDisposition = eligibleFixture(`${largePool}_disposition`, largePool, 1);
    wrongDisposition.monthly_final_disposition = "GENERATED";
    const invalidIdentity = eligibleFixture(`${largePool}_no_identity`, largePool, 1);
    invalidIdentity.analysis_request_id = "";
    const ineligibleUnknown = eligibleFixture(`${largePool}_unknown_disallowed`, largePool, 0);
    ineligibleUnknown.unknown_reissue_allowed = false;
    fixtures.push(
      ineligible, completed, generated, insufficient, policyExcluded, excludedByCode,
      wrongDisposition, invalidIdentity, ineligibleUnknown,
    );

    const pageRequests: Array<{ limit?: number; offset?: number; poolId?: string }> = [];
    const deps = {
      listExceptions: async (
        _connection: unknown,
        params: { reportPeriod: string; poolId?: string; limit?: number; offset?: number },
      ) => {
        pageRequests.push({ limit: params.limit, offset: params.offset, poolId: params.poolId });
        const matching = fixtures.filter(row =>
          params.reportPeriod === (row.report_period ?? reportMonth) &&
          (!params.poolId || row.swimming_pool_id === params.poolId),
        );
        const offset = params.offset ?? 0;
        return { rows: matching.slice(offset, offset + (params.limit ?? 50)), total: matching.length };
      },
    };
    const scope = (poolId?: string): RecoveryScope => ({ reportMonth, poolId });

    const allMonthPreview = await previewRecoveryBatch(db, scope(), deps as any);
    expect(allMonthPreview.eligible_total).toBe(1735);
    expect(allMonthPreview.unknown_total + allMonthPreview.failed_total).toBe(1735);
    expect((await previewRecoveryBatch(db, scope(onePool), deps as any)).eligible_total).toBe(1);
    expect((await previewRecoveryBatch(db, scope(seventeenPool), deps as any)).eligible_total).toBe(17);
    expect((await previewRecoveryBatch(db, scope(largePool), deps as any)).eligible_total).toBe(1700);
    expect(pageRequests.some(page => page.limit === 200 && page.offset === 200)).toBe(true);
    expect(pageRequests.every(page => page.limit === 200)).toBe(true);

    const roundRows = fixtures.filter(row => row.swimming_pool_id === roundPool);
    const firstRoundApproval = {
      ...scope(roundPool), approvalId: uuid(), actorId: "isolated-super-operator",
      actorRole: "super_admin", reason: "reviewed recovery round one",
    };
    const firstRound = await createRecoveryBatch(db, firstRoundApproval, deps as any);
    const firstRoundTargets = await claimRecoveryBatchTargets(db, 17, 120);
    expect(firstRoundTargets).toHaveLength(17);
    expect(firstRoundTargets.every(target => target.batch_id === firstRound.batch.id)).toBe(true);
    const unknownTarget = firstRoundTargets.find(target => target.kind === "UNKNOWN")!;
    expect(firstRoundTargets.filter(target => target.kind === "UNKNOWN")).toHaveLength(1);
    const priorRequestId = unknownTarget.original_request_id;
    const priorOperationId = uuid();
    for (const target of firstRoundTargets.filter(target => target.id !== unknownTarget.id)) {
      expect(await settleRecoveryBatchTarget(db, target, "SUCCESS", "round one terminal success")).toBe(true);
    }
    expect(await settleRecoveryBatchTarget(db, unknownTarget, "UNKNOWN", "confirmed unknown", {
      recovery_operation_id: priorOperationId,
      new_request_id: uuid(),
    })).toBe(true);
    expect(await getRecoveryBatchStatus(db, firstRound.batch.id)).toMatchObject({
      success: 16,
      unknown: 1,
      completed: 17,
      remaining: 1,
      state: "COMPLETED",
    });
    const roundRow = roundRows.find(row => row.report_id === unknownTarget.report_id)!;
    for (const row of roundRows.filter(row => row.report_id !== unknownTarget.report_id)) {
      row.product_status = "REVIEW_REQUIRED";
    }
    roundRow.analysis_request_id = uuid();
    roundRow.analysis_uncertain_at = new Date().toISOString();
    roundRow.unknown_reissue_allowed = true;
    roundRow.unknown_reissue_next_approval_allowed = true;
    roundRow.unknown_reissue_operation = { state: "UNKNOWN", recovery_operation_id: priorOperationId };
    const secondRound = await createRecoveryBatch(db, {
      ...scope(roundPool), approvalId: uuid(), actorId: "isolated-super-operator",
      actorRole: "platform_admin", reason: "explicit next recovery generation",
    }, deps as any);
    expect(secondRound.batch.recovery_round).toBe(firstRound.batch.recovery_round + 1);
    expect(secondRound.batch.total).toBe(1);
    const secondRoundMembers = await db.execute(sql`
      SELECT report_id, original_request_id, expected_operation_id
      FROM growth_report_recovery_batch_targets WHERE batch_id=${secondRound.batch.id}
    `);
    expect(secondRoundMembers.rows).toHaveLength(1);
    expect(secondRoundMembers.rows[0]).toMatchObject({
      report_id: roundRow.report_id,
      original_request_id: roundRow.analysis_request_id,
      expected_operation_id: priorOperationId,
    });
    expect(secondRoundMembers.rows[0].original_request_id).not.toBe(priorRequestId);
    const secondRoundTarget = (await claimRecoveryBatchTargets(db, 1, 30))[0];
    expect(secondRoundTarget.batch_id).toBe(secondRound.batch.id);
    expect(await settleRecoveryBatchTarget(db, secondRoundTarget, "SUCCESS", "next generation complete")).toBe(true);

    const waitingPoolId = opaqueId("pool_waiting");
    const waitingBatch = await createRecoveryBatch(db, {
      ...scope(waitingPoolId), approvalId: uuid(), actorId: "isolated-super-operator",
      actorRole: "super_admin", reason: "atomically lease a waiting target",
    }, {
      listExceptions: async (_connection: unknown) => ({
        rows: [eligibleFixture(opaqueId("waiting_claim_report"), waitingPoolId, 1)],
        total: 1,
      }),
    } as any);
    const waitingTarget = (await claimRecoveryBatchTargets(db, 1, 30))[0];
    expect(waitingTarget.batch_id).toBe(waitingBatch.batch.id);
    expect(await settleRecoveryBatchTarget(db, waitingTarget, "WAITING", "ready for atomic waiting claim")).toBe(true);
    const waitingClaims = await Promise.all([
      listWaitingRecoveryBatchTargets(db, 1),
      listWaitingRecoveryBatchTargets(secondDb, 1),
    ]);
    const reclaimedWaiting = waitingClaims.flat();
    expect(reclaimedWaiting).toHaveLength(1);
    expect(reclaimedWaiting[0].id).toBe(waitingTarget.id);
    expect(reclaimedWaiting[0].claim_token).not.toBe(waitingTarget.claim_token);
    const claimedWaitingLease = await db.execute(sql`
      SELECT state, lease_until > now() AS has_fresh_lease
      FROM growth_report_recovery_batch_targets WHERE id=${waitingTarget.id}
    `);
    expect(claimedWaitingLease.rows[0]).toEqual({ state: "PROCESSING", has_fresh_lease: true });
    const waitingActiveCount = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM growth_report_recovery_batch_targets
      WHERE state IN ('PROCESSING','WAITING')
    `);
    expect(waitingActiveCount.rows[0].count).toBe(1);
    expect(await settleRecoveryBatchTarget(db, reclaimedWaiting[0], "SUCCESS", "waiting reclaim verified")).toBe(true);

    const aliasPoolId = opaqueId("pool_alias");
    const aliasRow = eligibleFixture(opaqueId("alias_report"), aliasPoolId, 1);
    fixtures.push(aliasRow);
    const approvalA = {
      ...scope(aliasPoolId), approvalId: uuid(), actorId: "alias-operator-a",
      actorRole: "super_admin", reason: "first exact-scope consent",
    };
    const approvalB = {
      ...scope(aliasPoolId), approvalId: uuid(), actorId: "alias-operator-b",
      actorRole: "platform_admin", reason: "second exact-scope consent",
    };
    const [concurrentApprovalA, concurrentApprovalB] = await Promise.all([
      createRecoveryBatch(db, approvalA, deps as any),
      createRecoveryBatch(secondDb, approvalB, deps as any),
    ]);
    expect(concurrentApprovalA.batch.id).toBe(concurrentApprovalB.batch.id);
    expect(new Set([concurrentApprovalA.batch.approval_id, concurrentApprovalB.batch.approval_id]).size).toBe(1);
    const aliasedBatchId = concurrentApprovalA.batch.id;
    const primaryApprovalId = concurrentApprovalA.batch.approval_id;
    const aliasApproval = approvalA.approvalId === primaryApprovalId ? approvalB : approvalA;
    const storedAliases = await db.execute(sql`
      SELECT approval_aliases FROM growth_report_recovery_batches WHERE id=${aliasedBatchId}
    `);
    const aliasConsent = storedAliases.rows[0].approval_aliases[aliasApproval.approvalId];
    expect(aliasConsent).toMatchObject({
      report_month: reportMonth,
      pool_id: aliasPoolId,
      actor_id: aliasApproval.actorId,
      reason: aliasApproval.reason,
    });
    const aliasTarget = (await claimRecoveryBatchTargets(db, 1, 30))[0];
    expect(aliasTarget.batch_id).toBe(aliasedBatchId);
    expect(await settleRecoveryBatchTarget(db, aliasTarget, "SUCCESS", "alias batch completed")).toBe(true);
    aliasRow.product_status = "REVIEW_REQUIRED";

    const aliasReplay = await createRecoveryBatch(secondDb, aliasApproval, deps as any);
    expect(aliasReplay).toMatchObject({
      replayed: true,
      batch: { id: aliasedBatchId, approval_id: primaryApprovalId, recovery_round: concurrentApprovalA.batch.recovery_round },
    });
    const persistedAliasMembership = await db.execute(sql`
      SELECT COUNT(*)::int AS targets, COUNT(DISTINCT batch.id)::int AS batches
      FROM growth_report_recovery_batches batch
      LEFT JOIN growth_report_recovery_batch_targets target ON target.batch_id=batch.id
      WHERE batch.id=${aliasedBatchId}
    `);
    expect(persistedAliasMembership.rows[0]).toEqual({ targets: 1, batches: 1 });
    const conflictingAliasApprovals = [
      { ...aliasApproval, poolId: opaqueId("different_pool") },
      { ...aliasApproval, reportMonth: "2026-09" },
      { ...aliasApproval, reason: `${aliasApproval.reason} changed` },
      { ...aliasApproval, actorId: `${aliasApproval.actorId}-changed` },
    ];
    for (const conflictingApproval of conflictingAliasApprovals) {
      await expect(createRecoveryBatch(db, conflictingApproval, deps as any))
        .rejects.toThrow("RECOVERY_APPROVAL_CONFLICT");
    }
    expect((await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM growth_report_recovery_batches
      WHERE report_month=${reportMonth} AND pool_id=${aliasPoolId}
    `)).rows[0].count).toBe(1);

    const allScopePoolId = opaqueId("pool_all_scope");
    const companionPoolId = opaqueId("pool_all_scope_companion");
    const allScopeMonth = "2026-09";
    for (const [poolId, index] of [[allScopePoolId, 1], [companionPoolId, 2]] as const) {
      const row = eligibleFixture(opaqueId("all_scope_report"), poolId, index);
      row.report_period = allScopeMonth;
      fixtures.push(row);
    }
    const allScopeBatch = await createRecoveryBatch(db, {
      reportMonth: allScopeMonth,
      approvalId: uuid(),
      actorId: "all-month-scope-operator",
      actorRole: "platform_admin",
      reason: "approve the complete report-month cohort",
    }, deps as any);
    expect(allScopeBatch.batch.pool_id).toBeNull();
    expect(allScopeBatch.batch.total).toBe(2);
    const allScopeClaims = await claimRecoveryBatchTargets(db, 2, 30);
    expect(allScopeClaims).toHaveLength(2);
    expect(allScopeClaims.every(target => target.batch_id === allScopeBatch.batch.id)).toBe(true);
    for (const target of allScopeClaims) {
      expect(await settleRecoveryBatchTarget(db, target, "SUCCESS", "all-month target completed")).toBe(true);
    }
    const visibleAllScopeProgress = (await listRecoveryBatches(db, {
      reportMonth: allScopeMonth, poolId: allScopePoolId,
    })).batches.find((batch: any) => batch.id === allScopeBatch.batch.id);
    expect(visibleAllScopeProgress).toMatchObject({
      pool_id: null, total: 2, completed: 2, success: 2, state: "COMPLETED",
    });

    const makeApproval = (poolId: string) => ({
      ...scope(poolId), approvalId: uuid(), actorId: "isolated-platform-operator",
      actorRole: "platform_admin", reason: "fixed server-derived eligible cohort",
    });
    const oneBatch = await createRecoveryBatch(db, makeApproval(onePool), deps as any);
    const seventeenApproval = makeApproval(seventeenPool);
    const seventeenBatch = await createRecoveryBatch(db, seventeenApproval, deps as any);
    const replay = await createRecoveryBatch(db, seventeenApproval, deps as any);
    expect(replay.replayed).toBe(true);
    expect(replay.batch.id).toBe(seventeenBatch.batch.id);
    const largeBatch = await createRecoveryBatch(db, makeApproval(largePool), deps as any);
    expect(oneBatch.batch.total).toBe(1);
    expect(seventeenBatch.batch.total).toBe(17);
    expect(largeBatch.batch.total).toBe(1700);
    frozenEpochRow.recovery_epoch = 3;
    const frozenEpochMembership = await db.execute(sql`
      SELECT original_recovery_epoch FROM growth_report_recovery_batch_targets
      WHERE batch_id=${largeBatch.batch.id} AND report_id=${frozenEpochRow.report_id}
    `);
    expect(frozenEpochMembership.rows[0].original_recovery_epoch).toBe(2);

    const largeMembershipCount = await db.execute(sql`
      SELECT COUNT(*)::int AS count, COUNT(DISTINCT report_id)::int AS unique_reports
      FROM growth_report_recovery_batch_targets WHERE batch_id=${largeBatch.batch.id}
    `);
    expect(largeMembershipCount.rows[0]).toEqual({ count: 1700, unique_reports: 1700 });
    const unknownLineage = await db.execute(sql`
      SELECT COUNT(*)::int AS count, COUNT(DISTINCT original_request_id)::int AS distinct_requests
      FROM growth_report_recovery_batch_targets
      WHERE batch_id=${largeBatch.batch.id} AND kind='UNKNOWN'
    `);
    expect(unknownLineage.rows[0].count).toBeGreaterThan(1);
    expect(unknownLineage.rows[0].distinct_requests).toBe(unknownLineage.rows[0].count);
    const addedLater = eligibleFixture(`${largePool}_added_later`, largePool, 2);
    fixtures.push(addedLater);
    expect((await previewRecoveryBatch(db, scope(largePool), deps as any)).eligible_total).toBe(1);
    const immutableMembership = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM growth_report_recovery_batch_targets
      WHERE batch_id=${largeBatch.batch.id}
    `);
    expect(immutableMembership.rows[0].count).toBe(1700);

    expect((await listRecoveryBatches(db, scope(seventeenPool))).batches.map((row: any) => row.id))
      .toContain(seventeenBatch.batch.id);
    expect((await getRecoveryBatchStatus(db, largeBatch.batch.id))?.total).toBe(1700);

    await pauseRecoveryBatch(db, seventeenBatch.batch.id, "operator pause check");
    expect((await getRecoveryBatchStatus(db, seventeenBatch.batch.id))?.state).toBe("PAUSED");
    const resumed = await resumeRecoveryBatch(
      db, seventeenBatch.batch.id, "isolated-platform-operator", "reviewed and resumed",
    );
    expect(resumed.batch.state).toBe("PENDING");

    const concurrentClaims = await Promise.all([
      claimRecoveryBatchTargets(db, 7, 30),
      claimRecoveryBatchTargets(secondDb, 7, 30),
    ]);
    const claimed = concurrentClaims.flat();
    expect(claimed.length).toBeLessThanOrEqual(7);
    expect(new Set(claimed.map(target => target.id)).size).toBe(claimed.length);
    const activeCount = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM growth_report_recovery_batch_targets
      WHERE state IN ('PROCESSING','WAITING')
    `);
    expect(activeCount.rows[0].count).toBeLessThanOrEqual(7);
    expect(claimed.length).toBe(7);

    const staleOwner = claimed[0];
    expect(await renewRecoveryBatchTarget(db, staleOwner, 60)).toBe(true);
    await firstPool.query(
      `UPDATE growth_report_recovery_batch_targets
       SET lease_until=now()-interval '1 second' WHERE id=ANY($1::text[])`,
      [claimed.map(target => target.id)],
    );
    const restartedClaims = await claimRecoveryBatchTargets(secondDb, 7, 30);
    const restarted = restartedClaims.find(target => target.id === staleOwner.id);
    expect(restarted).toBeTruthy();
    expect(restarted?.claim_token).not.toBe(staleOwner.claim_token);
    expect(await renewRecoveryBatchTarget(db, staleOwner, 60)).toBe(false);
    expect(await settleRecoveryBatchTarget(db, staleOwner, "SUCCESS", "stale fenced writer")).toBe(false);

    expect(await settleRecoveryBatchTarget(secondDb, restarted!, "SUCCESS", "durable terminal success", {
      recovery_operation_id: uuid(),
      new_request_id: uuid(),
    })).toBe(true);
    const failedTarget = restartedClaims.find(target => target.id !== restarted!.id)!;
    expect(await settleRecoveryBatchTarget(db, failedTarget, "FAILED", "durable terminal failure")).toBe(true);
    const durableTerminals = await db.execute(sql`
      SELECT id, state FROM growth_report_recovery_batch_targets
      WHERE id IN (${restarted!.id}, ${failedTarget.id}) ORDER BY state
    `);
    expect(durableTerminals.rows.map((row: any) => row.state).sort()).toEqual(["FAILED", "SUCCESS"]);

    const refreshed = await refreshRecoveryBatchProgress(db, restarted!.batch_id);
    expect(refreshed.total).toBe((await getRecoveryBatchStatus(db, restarted!.batch_id))?.total);
    expect(refreshed.completed).toBeGreaterThanOrEqual(1);
    expect(refreshed.success).toBeGreaterThanOrEqual(1);
    expect(await getRecoveryBatchStatus(db, restarted!.batch_id)).toMatchObject({
      id: restarted!.batch_id,
      completed: refreshed.completed,
      success: refreshed.success,
      failed: refreshed.failed,
    });
  }, 120_000);
});