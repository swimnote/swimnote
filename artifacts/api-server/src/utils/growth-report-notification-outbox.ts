import { sql } from "drizzle-orm";

export type GrowthReportNotificationOutboxDb = {
  execute(query: unknown): Promise<{ rows: unknown[] }>;
};

/** The monthly outbox is limited to the pool admins receiving a ready notice. */
export type GrowthReportNotification = {
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
  return {
    type: "GROWTH_REPORT_BATCH_READY",
    recipientId: row.recipient_id,
    recipientType: "user",
    poolId: row.swimming_pool_id,
    reportPeriod: row.report_period,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link,
    payload: row.payload ?? {},
  };
}

function outboxId(item: GrowthReportNotification): string {
  return `grnot_admin_${encodeURIComponent(item.poolId)}_${item.reportPeriod}_${encodeURIComponent(item.recipientId)}`;
}

async function deliverClaimedOutboxItem(
  db: GrowthReportNotificationOutboxDb,
  row: any,
  item: GrowthReportNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  let dispatchStarted = false;
  try {
    // A stable feed id makes a retry safe if the process stopped before push.
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
  item: GrowthReportNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  const id = outboxId(item);
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

  const row = await claimOutboxItem(db, id);
  if (!row) return;
  await deliverClaimedOutboxItem(db, row, item, sendPush);
}

/** Create idempotent admin-ready intents for this pool/period only. */
export async function notifyGrowthReportAdminsReady(
  db: GrowthReportNotificationOutboxDb,
  params: { poolId: string; reportPeriod: string; message: string; readiness?: Record<string, number> },
  sendPush: GrowthReportPushSender,
): Promise<number> {
  const admins = await db.execute(sql`
    SELECT DISTINCT id AS user_id
    FROM users
    WHERE swimming_pool_id = ${params.poolId}
      AND role = 'pool_admin'
  `);
  const recipients = admins.rows as Array<{ user_id: string }>;
  const title = "AI 성장리포트 발송 준비 완료";
  for (const admin of recipients) {
    const item: GrowthReportNotification = {
      type: "GROWTH_REPORT_BATCH_READY",
      recipientId: admin.user_id,
      recipientType: "user",
      poolId: params.poolId,
      reportPeriod: params.reportPeriod,
      title,
      body: params.message,
      deepLink: "/admin/growth-reports/monthly-list",
      payload: {
        screen: "growth_report_list",
        pool_id: params.poolId,
        ...(params.readiness ? { readiness: params.readiness } : {}),
      },
    };
    try {
      await enqueueAdminNotification(db, item, sendPush);
    } catch (error) {
      console.error("[growth-report-outbox] admin notification enqueue failed:", error);
    }
  }
  return recipients.length;
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
    WHERE notification_type = 'GROWTH_REPORT_BATCH_READY'
      AND status = 'DISPATCHING'
      AND dispatch_started_at < NOW() - INTERVAL '5 minutes'
  `);
  const pending = await db.execute(sql`
    SELECT id
    FROM growth_report_notification_outbox
    WHERE notification_type = 'GROWTH_REPORT_BATCH_READY'
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