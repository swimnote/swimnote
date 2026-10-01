import { sql } from "drizzle-orm";
import {
  getMonthlyReportReadiness,
  type MonthlyReadinessDb,
} from "../jobs/growth-report-monthly-readiness.js";

export type GrowthReportNotificationOutboxDb = MonthlyReadinessDb;
type GrowthReportNotificationOutboxExecutor =
  Pick<GrowthReportNotificationOutboxDb, "execute">;

/** The monthly outbox is limited to the pool admins receiving a ready notice. */
export type GrowthReportReadyNotification = {
  type: "GROWTH_REPORT_BATCH_READY";
  recipientId: string;
  recipientType: "user";
  poolId: string;
  reportPeriod: string;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
};

export type MonthlySuperAdminEventType =
  | "FIRST_PASS_FINISHED"
  | "PAUSED";

export type GrowthReportMonthlySuperAdminNotification = {
  type: "GROWTH_REPORT_FIRST_PASS_FINISHED" | "GROWTH_REPORT_MONTHLY_PAUSED";
  recipientId: string;
  recipientType: "user";
  poolId: null;
  reportPeriod: string;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
  eventKey: string;
};

export type GrowthReportNotification =
  | GrowthReportReadyNotification
  | GrowthReportMonthlySuperAdminNotification;

export type GrowthReportPushSender = (
  item: GrowthReportNotification,
) => Promise<void | { providerReceiptId?: string; accepted?: boolean }>;

/** Use only when the provider explicitly confirms that the send was rejected. */
export class KnownGrowthReportPushRejection extends Error {
  readonly definitivelyNotAccepted = true;
}

export class UncertainGrowthReportPushError extends Error {
  constructor(
    message: string,
    readonly providerReceiptId?: string,
  ) {
    super(message);
  }
}

function notificationFromRow(row: any): GrowthReportNotification {
  const payload = row.payload ?? {};
  if (row.notification_type === "GROWTH_REPORT_BATCH_READY") {
    return {
      type: "GROWTH_REPORT_BATCH_READY",
      recipientId: row.recipient_id,
      recipientType: "user",
      poolId: row.swimming_pool_id,
      reportPeriod: row.report_period,
      title: row.title,
      body: row.body,
      deepLink: row.deep_link,
      payload,
    };
  }

  if (
    row.notification_type !== "GROWTH_REPORT_FIRST_PASS_FINISHED" &&
    row.notification_type !== "GROWTH_REPORT_MONTHLY_PAUSED"
  ) {
    throw new Error(`Unsupported monthly growth-report event: ${String(row.notification_type)}`);
  }

  const deepLink = row.deep_link ??
    `/super/ai?tab=monthly&report_period=${encodeURIComponent(row.report_period)}`;
  return {
    type: row.notification_type,
    recipientId: row.recipient_id,
    recipientType: "user",
    poolId: null,
    reportPeriod: row.report_period,
    title: row.title,
    body: row.body,
    deepLink,
    payload: {
      ...payload,
      deep_link: payload.deep_link ?? deepLink,
    },
    eventKey: row.event_key,
  };
}

function outboxId(item: GrowthReportReadyNotification): string {
  return `grnot_admin_${encodeURIComponent(item.poolId)}_${item.reportPeriod}_${encodeURIComponent(item.recipientId)}`;
}

function isReady(readiness: Awaited<ReturnType<typeof getMonthlyReportReadiness>>): boolean {
  return readiness.ready && !readiness.empty_target;
}

function isMonthlySuperAdminNotification(
  item: GrowthReportNotification,
): item is GrowthReportMonthlySuperAdminNotification {
  return item.type !== "GROWTH_REPORT_BATCH_READY";
}

function reportPeriodIsValid(reportPeriod: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(reportPeriod);
}

function numberFrom(
  value: Record<string, unknown>,
  ...keys: string[]
): number {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.max(0, Math.trunc(candidate));
    }
  }
  return 0;
}

function safeErrorCounts(summary: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {
    provider: 0,
    unknown: 0,
    data: 0,
    reconciliation: 0,
    other: 0,
  };
  const raw = summary.error_categories ?? summary.errorCategories ?? summary.errorCounts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return counts;

  const aliases: Record<string, keyof typeof counts> = {
    PROVIDER: "provider",
    PROVIDER_ERROR: "provider",
    ENGINE: "provider",
    ENGINE_ERROR: "provider",
    API: "provider",
    NETWORK: "provider",
    TIMEOUT: "provider",
    UNKNOWN: "unknown",
    ENGINE_REQUEST_UNKNOWN: "unknown",
    DATA: "data",
    DATA_ERROR: "data",
    DATA_ACCUMULATING: "data",
    RECONCILIATION: "reconciliation",
    MISSING: "reconciliation",
    DUPLICATE: "reconciliation",
    WRONG_POOL: "reconciliation",
    IDENTITY: "reconciliation",
    PREPARATION: "reconciliation",
    CIRCUIT: "other",
    OTHER: "other",
  };
  for (const [rawKey, rawCount] of Object.entries(raw as Record<string, unknown>)) {
    const category = aliases[rawKey.toUpperCase()];
    if (category && typeof rawCount === "number" && Number.isFinite(rawCount)) {
      counts[category] += Math.max(0, Math.trunc(rawCount));
    }
  }
  return counts;
}

function sanitizeFirstPassSummary(summaryValue: unknown): {
  summary: Record<string, number | Record<string, number>>;
  hasUnresolved: boolean;
} {
  const source = summaryValue && typeof summaryValue === "object" && !Array.isArray(summaryValue)
    ? summaryValue as Record<string, unknown>
    : {};
  const poolTotal = numberFrom(source, "pool_total");
  const processedPoolTotal = numberFrom(source, "processed_pool_total");
  const eligibleTotal = numberFrom(source, "eligible_total");
  const generatedTotal = numberFrom(source, "generated_total");
  const insufficientEvidenceTotal = numberFrom(source, "insufficient_evidence_total");
  const policyExcludedTotal = numberFrom(source, "policy_excluded_total");
  const unresolvedPoolTotal = numberFrom(source, "unresolved_pool_total");
  const unresolvedMemberTotal = numberFrom(source, "unresolved_member_total");
  const errorCounts = safeErrorCounts(source);
  const hasUnresolved = unresolvedPoolTotal > 0 || unresolvedMemberTotal > 0 ||
    Object.values(errorCounts).some(count => count > 0);
  return {
    summary: {
      pool_total: poolTotal,
      processed_pool_total: processedPoolTotal,
      eligible_total: eligibleTotal,
      generated_total: generatedTotal,
      insufficient_evidence_total: insufficientEvidenceTotal,
      policy_excluded_total: policyExcludedTotal,
      unresolved_pool_total: unresolvedPoolTotal,
      unresolved_member_total: unresolvedMemberTotal,
      error_categories: errorCounts,
    },
    hasUnresolved,
  };
}

async function monthlyEventDispatchAllowed(
  db: GrowthReportNotificationOutboxExecutor,
  item: GrowthReportMonthlySuperAdminNotification,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT first_pass_completed_at, pause_epoch
    FROM growth_report_monthly_runs
    WHERE report_period = ${item.reportPeriod}
    LIMIT 1
  `);
  const run = result.rows[0] as {
    first_pass_completed_at?: unknown;
    pause_epoch?: number | string | null;
  } | undefined;
  if (!run) return false;
  if (item.type === "GROWTH_REPORT_FIRST_PASS_FINISHED") {
    return run.first_pass_completed_at != null;
  }
  const eventPauseEpoch = Number(item.payload.pause_epoch);
  return Number.isInteger(eventPauseEpoch) &&
    eventPauseEpoch > 0 &&
    Number(run.pause_epoch ?? 0) >= eventPauseEpoch;
}

async function releaseClaimForReadinessRetry(
  db: GrowthReportNotificationOutboxDb,
  row: any,
  status: "CLAIMED" | "DISPATCHING",
): Promise<void> {
  await db.execute(sql`
    UPDATE growth_report_notification_outbox
    SET status = 'PENDING', next_attempt_at = NOW() + INTERVAL '1 minute',
        lease_until = NULL, lease_token = NULL, updated_at = NOW()
    WHERE id = ${row.id}
      AND status = ${status}
      AND lease_token = ${row.lease_token}
  `);
}

async function deliverClaimedOutboxItem(
  db: GrowthReportNotificationOutboxDb,
  row: any,
  item: GrowthReportNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  let dispatchStarted = false;
  try {
    if (isMonthlySuperAdminNotification(item)) {
      if (!await monthlyEventDispatchAllowed(db, item)) {
        await releaseClaimForReadinessRetry(db, row, "CLAIMED");
        return;
      }
    } else {
      // Even an old durable intent is not dispatchable if the underlying sealed
      // target gate is no longer complete.
      const initialGate = await getMonthlyReportReadiness(db, {
        poolId: item.poolId,
        reportPeriod: item.reportPeriod,
      });
      if (!isReady(initialGate)) {
        await releaseClaimForReadinessRetry(db, row, "CLAIMED");
        return;
      }
    }

    if (!isMonthlySuperAdminNotification(item)) {
      // The existing pool-admin stable feed id is retained unchanged.
      await db.execute(sql`
        INSERT INTO notifications (
          id, recipient_id, recipient_type, pool_id, type, title, body,
          ref_id, ref_type, deep_link, is_read
        )
        VALUES (
          ${`notif_${row.id}`}, ${item.recipientId}, 'user', ${item.poolId},
          'GROWTH_REPORT_BATCH_READY', ${item.title}, ${item.body},
          ${item.poolId}, 'pool', ${item.deepLink}, false
        )
        ON CONFLICT DO NOTHING
      `);
    }

    const dispatching = await db.execute(sql`
      UPDATE growth_report_notification_outbox
      SET status = 'DISPATCHING', dispatch_started_at = NOW(), updated_at = NOW()
      WHERE id = ${row.id}
        AND status = 'CLAIMED'
        AND lease_token = ${row.lease_token}
        AND lease_until > NOW()
      RETURNING id
    `);
    if (!dispatching.rows.length) return;

    if (isMonthlySuperAdminNotification(item)) {
      if (!await monthlyEventDispatchAllowed(db, item)) {
        await releaseClaimForReadinessRetry(db, row, "DISPATCHING");
        return;
      }
    } else {
      const dispatchGate = await getMonthlyReportReadiness(db, {
        poolId: item.poolId,
        reportPeriod: item.reportPeriod,
      });
      if (!isReady(dispatchGate)) {
        await releaseClaimForReadinessRetry(db, row, "DISPATCHING");
        return;
      }
    }
    dispatchStarted = true;
    const acknowledgement = await sendPush(item);
    if (acknowledgement && typeof acknowledgement === "object" && acknowledgement.accepted === false) {
      throw new KnownGrowthReportPushRejection("Push provider explicitly rejected the notification");
    }
    const receiptId = acknowledgement && typeof acknowledgement === "object"
      ? acknowledgement.providerReceiptId ?? null
      : null;
    await db.execute(sql`
      UPDATE growth_report_notification_outbox
      SET status = 'DELIVERED', delivered_at = NOW(), lease_until = NULL,
          lease_token = NULL, provider_receipt_id = ${receiptId},
          last_error = NULL, updated_at = NOW()
      WHERE id = ${row.id}
        AND status = 'DISPATCHING'
        AND lease_token = ${row.lease_token}
    `);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!dispatchStarted) {
      await db.execute(sql`
        UPDATE growth_report_notification_outbox
        SET status = 'PENDING', next_attempt_at = NOW(),
            lease_until = NULL, lease_token = NULL,
            last_error = ${reason.slice(0, 500)}, updated_at = NOW()
        WHERE id = ${row.id}
          AND status IN ('CLAIMED', 'DISPATCHING')
          AND lease_token = ${row.lease_token}
      `);
      console.error("[growth-report-outbox] admin notification preparation failed:", reason);
      return;
    }

    const knownRejected = error instanceof KnownGrowthReportPushRejection ||
      (typeof error === "object" && error !== null &&
        (error as { definitivelyNotAccepted?: boolean }).definitivelyNotAccepted === true);
    const providerReceiptId = typeof error === "object" && error !== null &&
      typeof (error as { providerReceiptId?: unknown }).providerReceiptId === "string"
      ? (error as { providerReceiptId: string }).providerReceiptId
      : null;
    await db.execute(sql`
      UPDATE growth_report_notification_outbox
      SET status = ${knownRejected ? "PENDING" : "UNCERTAIN"},
          lease_until = NULL, lease_token = NULL,
          provider_receipt_id = COALESCE(${providerReceiptId}, provider_receipt_id),
          next_attempt_at = CASE WHEN ${knownRejected} THEN NOW() + LEAST(
            INTERVAL '1 hour',
            INTERVAL '30 seconds' * power(2, LEAST(attempt_count - 1, 7))
          ) ELSE next_attempt_at END,
          last_error = ${reason.slice(0, 500)}, updated_at = NOW()
      WHERE id = ${row.id}
        AND status = 'DISPATCHING'
        AND lease_token = ${row.lease_token}
    `);
    if (!knownRejected) {
      // Provider acceptance is ambiguous; never send the same admin notice again.
      console.error("[growth-report-outbox] admin delivery outcome uncertain:", reason);
    }
  }
}

async function claimOutboxItem(
  db: GrowthReportNotificationOutboxDb,
  id: string,
): Promise<any | undefined> {
  const claimed = await db.execute(sql`
    UPDATE growth_report_notification_outbox
    SET status = 'CLAIMED', attempt_count = attempt_count + 1,
        lease_until = NOW() + INTERVAL '2 minutes',
        lease_token = gen_random_uuid()::text, updated_at = NOW()
    WHERE id = ${id}
      AND (
        (status = 'PENDING' AND next_attempt_at <= NOW())
        OR (status = 'CLAIMED' AND lease_until < NOW())
      )
    RETURNING *
  `);
  return claimed.rows[0];
}

async function enqueueAdminNotification(
  db: GrowthReportNotificationOutboxDb,
  item: GrowthReportReadyNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  const id = outboxId(item);
  await insertAdminIntent(db, id, item);

  const row = await claimOutboxItem(db, id);
  if (!row) return;
  await deliverClaimedOutboxItem(db, row, item, sendPush);
}

async function insertAdminIntent(
  db: GrowthReportNotificationOutboxExecutor,
  id: string,
  item: GrowthReportReadyNotification,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO growth_report_notification_outbox (
      id, notification_type, swimming_pool_id, report_period, recipient_id,
      recipient_type, title, body, deep_link, payload, status, next_attempt_at
    )
    VALUES (
      ${id}, 'GROWTH_REPORT_BATCH_READY', ${item.poolId}, ${item.reportPeriod},
      ${item.recipientId}, 'user', ${item.title}, ${item.body}, ${item.deepLink},
      ${JSON.stringify(item.payload)}::jsonb, 'PENDING', NOW()
    )
    ON CONFLICT DO NOTHING
  `);
}

function superAdminEventKey(
  reportPeriod: string,
  eventType: MonthlySuperAdminEventType,
  pauseEpoch?: number,
): string {
  return eventType === "PAUSED"
    ? `growth_report_monthly_${reportPeriod}_PAUSED_${pauseEpoch}`
    : `growth_report_monthly_${reportPeriod}_FIRST_PASS_FINISHED`;
}

/**
 * Persist a PII-free global monthly event and one durable PUSH intent for
 * every super-admin. This intentionally does not send PUSH inline: callers
 * can use the shared retry dispatcher after the event and inbox rows commit.
 */
export async function enqueueMonthlySuperAdminEvent(
  db: GrowthReportNotificationOutboxDb,
  params: {
    reportPeriod: string;
    eventType: MonthlySuperAdminEventType;
    /** Compatibility hint only; FIRST_PASS uses the persisted immutable snapshot. */
    summary?: unknown;
    pauseEpoch?: number;
  },
): Promise<number> {
  if (!reportPeriodIsValid(params.reportPeriod)) {
    throw new Error("Invalid monthly growth-report period");
  }
  if (params.eventType === "PAUSED" &&
      (!Number.isSafeInteger(params.pauseEpoch) || Number(params.pauseEpoch) < 1)) {
    throw new Error("A positive pauseEpoch is required for a circuit-pause event");
  }

  const run = (await db.execute(sql`
    SELECT first_pass_completed_at, summary_payload, pause_epoch, paused_at
    FROM growth_report_monthly_runs
    WHERE report_period = ${params.reportPeriod}
    LIMIT 1
  `)).rows[0] as {
    first_pass_completed_at?: unknown;
    summary_payload?: unknown;
    pause_epoch?: number | string | null;
    paused_at?: unknown;
  } | undefined;
  if (!run) return 0;

  if (params.eventType === "FIRST_PASS_FINISHED" && run.first_pass_completed_at == null) {
    return 0;
  }
  if (params.eventType === "PAUSED" &&
      (run.paused_at == null || Number(run.pause_epoch) !== params.pauseEpoch)) {
    return 0;
  }

  const firstPass = params.eventType === "FIRST_PASS_FINISHED";
  // The run's completion snapshot is immutable; never build this notice from
  // live counters that may have changed during recovery.
  if (firstPass && run.summary_payload == null) return 0;
  const safe = firstPass ? sanitizeFirstPassSummary(run.summary_payload) : undefined;
  if (firstPass && !safe?.hasUnresolved) return 0;

  const eventKey = superAdminEventKey(
    params.reportPeriod,
    params.eventType,
    params.pauseEpoch,
  );
  const notificationType = firstPass
    ? "GROWTH_REPORT_FIRST_PASS_FINISHED"
    : "GROWTH_REPORT_MONTHLY_PAUSED";
  const title = firstPass
    ? "AI 성장리포트 1차 발행 예외"
    : "AI 성장리포트 자동화 일시중지";
  const aggregateBody = safe?.summary ?? {};
  const categories = aggregateBody["error_categories"] as Record<string, number> | undefined;
  const categoryText = categories
    ? Object.entries(categories)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => `${category} ${count}`)
      .join(", ")
    : "";
  const deepLink = `/super/ai?tab=monthly&report_period=${params.reportPeriod}`;
  const body = firstPass
    ? `[AI 성장리포트 1차 발행 결과]\n` +
      `전체 ${aggregateBody["pool_total"]}개 수영장 / 처리 ${aggregateBody["processed_pool_total"]}개\n` +
      `발급대상 ${aggregateBody["eligible_total"]}명 / 정상완료 ${aggregateBody["generated_total"]}명\n` +
      `근거부족 ${aggregateBody["insufficient_evidence_total"]}명 / 정책제외 ${aggregateBody["policy_excluded_total"]}명\n` +
      `미완료 ${aggregateBody["unresolved_pool_total"]}개 수영장 / ${aggregateBody["unresolved_member_total"]}명\n` +
      (categoryText ? `주요 원인: ${categoryText}\n` : "") +
      `원인 확인: ${deepLink}`
    : `공통 provider/API 장애로 월간 AI 성장리포트 분석을 일시 중지했습니다. ` +
      `원인을 확인한 뒤 기존 manifest에서 재개해 주세요.\n상세 확인: ${deepLink}`;
  const payload: Record<string, unknown> = {
    screen: "monthly",
    report_period: params.reportPeriod,
    event_type: params.eventType,
    deep_link: deepLink,
    ...(firstPass ? safe?.summary ?? {} : { pause_epoch: params.pauseEpoch }),
  };

  // One stable inbox event for the global super-admin feed. This insert does
  // not send PUSH; each recipient's separate outbox lease owns its PUSH.
  await db.execute(sql`
    INSERT INTO super_admin_notifications (
      id, type, title, body, pool_id, ref_id, ref_type, is_read, idempotency_key, created_at
    )
    VALUES (
      ${`san_${eventKey}`}, ${notificationType}, ${title}, ${body},
      NULL, ${params.reportPeriod}, 'growth_report_monthly_run',
      FALSE, ${eventKey}, NOW()
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING
  `);

  const recipients = await db.execute(sql`
    SELECT DISTINCT id AS user_id
    FROM users
    WHERE role = 'super_admin'
    ORDER BY id
  `);
  let inserted = 0;
  for (const recipient of recipients.rows as Array<{ user_id: string }>) {
    if (!recipient.user_id) continue;
    const id = `grnot_super_${encodeURIComponent(eventKey)}_${encodeURIComponent(recipient.user_id)}`;
    const result = await db.execute(sql`
      INSERT INTO growth_report_notification_outbox (
        id, notification_type, event_scope, event_key,
        swimming_pool_id, report_period, recipient_id, recipient_type,
        title, body, deep_link, payload, status, next_attempt_at
      )
      VALUES (
        ${id}, ${notificationType}, 'report_month', ${eventKey},
        NULL, ${params.reportPeriod}, ${recipient.user_id}, 'user',
        ${title}, ${body}, ${deepLink}, ${JSON.stringify(payload)}::jsonb,
        'PENDING', NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (result.rows.length) inserted++;
  }
  return inserted;
}

async function adminNotificationItems(
  db: GrowthReportNotificationOutboxExecutor,
  params: {
    poolId: string;
    reportPeriod: string;
    message: string;
    readiness?: Record<string, number | boolean>;
  },
): Promise<GrowthReportReadyNotification[]> {
  const admins = await db.execute(sql`
    SELECT DISTINCT id AS user_id
    FROM users
    WHERE swimming_pool_id = ${params.poolId}
      AND role = 'pool_admin'
  `);
  return (admins.rows as Array<{ user_id: string }>).map<GrowthReportReadyNotification>(admin => ({
    type: "GROWTH_REPORT_BATCH_READY",
    recipientId: admin.user_id,
    recipientType: "user",
    poolId: params.poolId,
    reportPeriod: params.reportPeriod,
    title: "AI 성장리포트 발송 준비 완료",
    body: params.message,
    deepLink: "/admin/growth-reports/monthly-list",
    payload: {
      screen: "growth_report_list",
      pool_id: params.poolId,
      ...(params.readiness ? { readiness: params.readiness } : {}),
    },
  }));
}

/**
 * Called from the cycle-lock transaction only after the sealed 100% gate
 * passes. Persisting these intents alongside ready_at closes the crash window
 * between recording readiness and creating durable delivery work.
 */
export async function insertGrowthReportAdminReadyIntents(
  db: GrowthReportNotificationOutboxExecutor,
  params: {
    poolId: string;
    reportPeriod: string;
    message: string;
    readiness?: Record<string, number | boolean>;
  },
): Promise<number> {
  const items = await adminNotificationItems(db, params);
  for (const item of items) await insertAdminIntent(db, outboxId(item), item);
  return items.length;
}

/** Create idempotent admin-ready intents for this pool/period only. */
export async function notifyGrowthReportAdminsReady(
  db: GrowthReportNotificationOutboxDb,
  params: {
    poolId: string;
    reportPeriod: string;
    message: string;
    readiness?: Record<string, number | boolean>;
  },
  sendPush: GrowthReportPushSender,
): Promise<number> {
  const gate = await getMonthlyReportReadiness(db, {
    poolId: params.poolId,
    reportPeriod: params.reportPeriod,
  });
  if (!isReady(gate)) return 0;

  const items = await adminNotificationItems(db, params);
  for (const item of items) {
    try {
      await enqueueAdminNotification(db, item, sendPush);
    } catch (error) {
      console.error("[growth-report-outbox] admin notification enqueue failed:", error);
    }
  }
  return items.length;
}

/** Retry explicit failures and reclaim pre-dispatch claims; ambiguous sends stay uncertain. */
export async function retryPendingGrowthReportNotifications(
  db: GrowthReportNotificationOutboxDb,
  sendPush: GrowthReportPushSender,
  limit = 100,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(200, limit));
  await db.execute(sql`
    UPDATE growth_report_notification_outbox
    SET status = 'UNCERTAIN', lease_until = NULL, lease_token = NULL,
        last_error = COALESCE(last_error, 'Dispatch lease expired; provider outcome is unknown'),
        updated_at = NOW()
    WHERE notification_type IN (
      'GROWTH_REPORT_BATCH_READY',
      'GROWTH_REPORT_FIRST_PASS_FINISHED',
      'GROWTH_REPORT_MONTHLY_PAUSED'
    )
      AND status = 'DISPATCHING'
      AND dispatch_started_at < NOW() - INTERVAL '5 minutes'
  `);
  const pending = await db.execute(sql`
    SELECT id
    FROM growth_report_notification_outbox
    WHERE notification_type IN (
      'GROWTH_REPORT_BATCH_READY',
      'GROWTH_REPORT_FIRST_PASS_FINISHED',
      'GROWTH_REPORT_MONTHLY_PAUSED'
    )
      AND (
        (status = 'PENDING' AND next_attempt_at <= NOW())
        OR (status = 'CLAIMED' AND lease_until < NOW())
      )
    ORDER BY next_attempt_at ASC
    LIMIT ${boundedLimit}
  `);
  let delivered = 0;
  for (const candidate of pending.rows as Array<{ id: string }>) {
    const row = await claimOutboxItem(db, candidate.id);
    if (!row) continue;
    try {
      await deliverClaimedOutboxItem(db, row, notificationFromRow(row), sendPush);
      delivered++;
    } catch (error) {
      console.error("[growth-report-outbox] admin delivery retry failed:", error);
    }
  }
  return delivered;
}