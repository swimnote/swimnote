import { sql } from "drizzle-orm";

export type GrowthReportNotificationOutboxDb = {
  execute(query: unknown): Promise<{ rows: unknown[] }>;
};

export type GrowthReportNotification = {
  type: "GROWTH_REPORT_PUBLISHED" | "GROWTH_REPORT_BATCH_READY";
  recipientId: string;
  recipientType: "parent_account" | "user";
  poolId: string;
  reportId?: string;
  reportPeriod: string;
  title: string;
  body: string;
  deepLink?: string;
  payload?: Record<string, unknown>;
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
    type: row.notification_type,
    recipientId: row.recipient_id,
    recipientType: row.recipient_type,
    poolId: row.swimming_pool_id,
    reportId: row.report_id ?? undefined,
    reportPeriod: row.report_period,
    title: row.title,
    body: row.body,
    deepLink: row.deep_link ?? undefined,
    payload: row.payload ?? {},
  };
}

async function deliverClaimedOutboxItem(
  db: GrowthReportNotificationOutboxDb,
  outboxId: string,
  leaseToken: string,
  item: GrowthReportNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  let dispatchStarted = false;
  try {
    // A deterministic notification id makes insert-before-push crash recovery
    // safe: retry keeps the already-persisted feed item and retries only push.
    const notificationId = `notif_${outboxId}`;
    await db.execute(sql`
      INSERT INTO notifications (
        id, recipient_id, recipient_type, pool_id, type, title, body,
        ref_id, ref_type, deep_link, is_read
      )
      VALUES (
        ${notificationId}, ${item.recipientId}, ${item.recipientType},
        ${item.poolId}, ${item.type}, ${item.title}, ${item.body},
        ${item.reportId ?? item.poolId},
        ${item.reportId ? "growth_report" : "pool"},
        ${item.deepLink ?? null}, false
      )
      ON CONFLICT DO NOTHING
    `);
    const dispatching = await db.execute(sql`
      UPDATE growth_report_notification_outbox
      SET status = 'DISPATCHING', dispatch_started_at = NOW(), updated_at = NOW()
      WHERE id = ${outboxId}
        AND status = 'CLAIMED'
        AND lease_token = ${leaseToken}
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
      WHERE id = ${outboxId}
        AND status = 'DISPATCHING'
        AND lease_token = ${leaseToken}
    `);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!dispatchStarted) {
      // No provider call was made. Even if the dispatch transition's response
      // was lost, this fenced worker knows it did not invoke the sender.
      await db.execute(sql`
        UPDATE growth_report_notification_outbox
        SET status = 'PENDING', next_attempt_at = NOW(),
            lease_until = NULL, lease_token = NULL,
            last_error = ${reason.slice(0, 500)}, updated_at = NOW()
        WHERE id = ${outboxId}
          AND status IN ('CLAIMED', 'DISPATCHING')
          AND lease_token = ${leaseToken}
      `);
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
      WHERE id = ${outboxId}
        AND status = 'DISPATCHING'
        AND lease_token = ${leaseToken}
    `);
    if (knownRejected) throw error;
    // Timeout/process failure after dispatch may mean provider acceptance.
    // UNCERTAIN must be reconciled; it is never blindly sent a second time.
    console.error("[growth-report-outbox] delivery outcome uncertain:", reason);
  }
}

function idempotencyPredicate(item: GrowthReportNotification) {
  if (item.type === "GROWTH_REPORT_BATCH_READY") {
    return sql`swimming_pool_id = ${item.poolId} AND report_period = ${item.reportPeriod} AND report_id IS NULL`;
  }
  return sql`report_id = ${item.reportId ?? null}`;
}

export async function enqueueGrowthReportNotification(
  db: GrowthReportNotificationOutboxDb,
  item: GrowthReportNotification,
  sendPush: GrowthReportPushSender,
): Promise<void> {
  const outboxId = `grnot_${item.type === "GROWTH_REPORT_PUBLISHED" ? "parent" : "admin"}_${item.reportId ?? item.poolId}_${item.reportPeriod}_${item.recipientId}`
    .replace(/[^a-zA-Z0-9_-]/g, "_");
  const idempotencyKey = idempotencyPredicate(item);

  await db.execute(sql`
    INSERT INTO growth_report_notification_outbox (
      id, notification_type, swimming_pool_id, report_period, report_id,
      recipient_id, recipient_type, title, body, deep_link, payload,
      status, next_attempt_at
    )
    VALUES (
      ${outboxId}, ${item.type}, ${item.poolId}, ${item.reportPeriod},
      ${item.reportId ?? null}, ${item.recipientId}, ${item.recipientType},
      ${item.title}, ${item.body}, ${item.deepLink ?? null},
      ${JSON.stringify(item.payload ?? {})}::jsonb, 'PENDING', NOW()
    )
    ON CONFLICT DO NOTHING
  `);

  const claimed = await db.execute(sql`
    UPDATE growth_report_notification_outbox
    SET status = 'CLAIMED',
        attempt_count = attempt_count + 1,
        lease_until = NOW() + INTERVAL '2 minutes',
        lease_token = gen_random_uuid()::text,
        updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM growth_report_notification_outbox
      WHERE notification_type = ${item.type}
        AND recipient_id = ${item.recipientId}
        AND ${idempotencyKey}
        AND (
          (status = 'PENDING' AND next_attempt_at <= NOW())
          OR (status = 'CLAIMED' AND lease_until < NOW())
        )
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, lease_token
  `);
  if (!claimed.rows.length) return;

  const leaseToken = (claimed.rows[0] as any).lease_token as string;
  await deliverClaimedOutboxItem(db, outboxId, leaseToken, item, sendPush);
}

/** Retry pending notifications and reclaim expired leases after worker restart. */
export async function retryPendingGrowthReportNotifications(
  db: GrowthReportNotificationOutboxDb,
  sendPush: GrowthReportPushSender,
  limit = 100,
): Promise<number> {
  const pending = await db.execute(sql`
    SELECT id
    FROM growth_report_notification_outbox
    WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
       OR (status = 'CLAIMED' AND lease_until < NOW())
    ORDER BY next_attempt_at ASC
    LIMIT ${limit}
  `);
  let delivered = 0;
  for (const candidate of pending.rows as Array<{ id: string }>) {
    const claimed = await db.execute(sql`
      UPDATE growth_report_notification_outbox
      SET status = 'CLAIMED', attempt_count = attempt_count + 1,
          lease_until = NOW() + INTERVAL '2 minutes',
          lease_token = gen_random_uuid()::text, updated_at = NOW()
      WHERE id = ${candidate.id}
        AND (
          (status = 'PENDING' AND next_attempt_at <= NOW())
          OR (status = 'CLAIMED' AND lease_until < NOW())
        )
      RETURNING *
    `);
    if (!claimed.rows.length) continue;
    const row = claimed.rows[0] as any;
    try {
      await deliverClaimedOutboxItem(db, row.id, row.lease_token, notificationFromRow(row), sendPush);
      delivered++;
    } catch (error) {
      // One provider failure must not block the remaining recipients.
      console.error("[growth-report-outbox] delivery retry failed:", error);
    }
  }
  return delivered;
}

/**
 * Recover a crash after the atomic PUBLISHED update but before the caller
 * persisted a parent-notification intent. Existing legacy feed rows without
 * an outbox receipt are recorded UNCERTAIN, never blindly pushed again.
 */
export async function recoverPublishedGrowthReportNotificationIntents(
  db: GrowthReportNotificationOutboxDb,
  sendPush: GrowthReportPushSender,
  limit = 200,
): Promise<number> {
  const missing = await db.execute(sql`
    SELECT gr.id AS report_id, gr.student_id, gr.swimming_pool_id AS pool_id,
      gr.report_period, link.parent_id,
      EXISTS (
        SELECT 1
        FROM notifications old_notification
        WHERE old_notification.type = 'GROWTH_REPORT_PUBLISHED'
          AND old_notification.ref_id = gr.id
          AND old_notification.recipient_id = link.parent_id
      ) AS legacy_notification_exists
    FROM growth_reports gr
    JOIN parent_students link
      ON link.student_id = gr.student_id AND link.status = 'approved'
    WHERE gr.product_status = 'PUBLISHED'
      AND gr.report_type = 'monthly'
      AND gr.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM growth_report_notification_outbox outbox
        WHERE outbox.notification_type = 'GROWTH_REPORT_PUBLISHED'
          AND outbox.report_id = gr.id
          AND outbox.recipient_id = link.parent_id
      )
    ORDER BY gr.published_at ASC NULLS LAST, gr.id, link.parent_id
    LIMIT ${limit}
  `);

  let recovered = 0;
  for (const row of missing.rows as Array<{
    report_id: string;
    student_id: string;
    pool_id: string;
    report_period: string;
    parent_id: string;
    legacy_notification_exists: boolean | string;
  }>) {
    const item: GrowthReportNotification = {
      type: "GROWTH_REPORT_PUBLISHED",
      recipientId: row.parent_id,
      recipientType: "parent_account",
      poolId: row.pool_id,
      reportId: row.report_id,
      reportPeriod: row.report_period,
      title: "지난달 성장리포트가 도착했습니다",
      body: "지난 한 달 동안의 성장 모습을 확인해보세요.",
      deepLink: `/parent/growth-report-detail?reportId=${row.report_id}`,
      payload: {
        screen: "growth_report_detail",
        growth_report_id: row.report_id,
        report_period: row.report_period,
        deep_link: `/parent/growth-report-detail?reportId=${row.report_id}`,
      },
    };
    const legacyNotificationExists =
      row.legacy_notification_exists === true || row.legacy_notification_exists === "t";
    try {
      if (legacyNotificationExists) {
        const outboxId = `grnot_parent_${row.report_id}_${row.report_period}_${row.parent_id}`
          .replace(/[^a-zA-Z0-9_-]/g, "_");
        await db.execute(sql`
          INSERT INTO growth_report_notification_outbox (
            id, notification_type, swimming_pool_id, report_period, report_id,
            recipient_id, recipient_type, title, body, deep_link, payload,
            status, last_error
          )
          VALUES (
            ${outboxId}, 'GROWTH_REPORT_PUBLISHED', ${row.pool_id}, ${row.report_period},
            ${row.report_id}, ${row.parent_id}, 'parent_account', ${item.title},
            ${item.body}, ${item.deepLink}, ${JSON.stringify(item.payload)}::jsonb,
            'UNCERTAIN', 'Legacy notification exists; provider outcome is unknown'
          )
          ON CONFLICT DO NOTHING
        `);
      } else {
        await enqueueGrowthReportNotification(db, item, sendPush);
      }
      recovered++;
    } catch (error) {
      console.error("[growth-report-outbox] publication-intent recovery failed:", error);
    }
  }
  return recovered;
}

/** Manual reconciliation requires an explicit provider/ops conclusion. */
export async function reconcileGrowthReportNotification(
  db: GrowthReportNotificationOutboxDb,
  params: {
    outboxId: string;
    outcome: "ACCEPTED" | "DEFINITIVELY_REJECTED" | "UNKNOWN";
    providerReceiptId?: string;
    note?: string;
  },
): Promise<boolean> {
  if (params.outcome === "UNKNOWN") return false;
  const result = params.outcome === "ACCEPTED"
    ? await db.execute(sql`
        UPDATE growth_report_notification_outbox
        SET status = 'DELIVERED', delivered_at = COALESCE(delivered_at, NOW()),
            provider_receipt_id = COALESCE(${params.providerReceiptId ?? null}, provider_receipt_id),
            lease_until = NULL, lease_token = NULL,
            last_error = ${params.note?.slice(0, 500) ?? 'Manually reconciled as accepted'},
            updated_at = NOW()
        WHERE id = ${params.outboxId}
          AND status IN ('DISPATCHING', 'UNCERTAIN')
        RETURNING id
      `)
    : await db.execute(sql`
        UPDATE growth_report_notification_outbox
        SET status = 'PENDING', next_attempt_at = NOW(), lease_until = NULL,
            lease_token = NULL,
            last_error = ${params.note?.slice(0, 500) ?? 'Manually confirmed not accepted'},
            updated_at = NOW()
        WHERE id = ${params.outboxId}
          AND status IN ('DISPATCHING', 'UNCERTAIN')
        RETURNING id
      `);
  return result.rows.length > 0;
}

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
    await enqueueGrowthReportNotification(db, {
      type: "GROWTH_REPORT_BATCH_READY",
      recipientId: admin.user_id,
      recipientType: "user",
      poolId: params.poolId,
      reportPeriod: params.reportPeriod,
      title,
      body: params.message,
      deepLink: "/admin/growth-reports/monthly-list",
      payload: params.readiness,
    }, sendPush);
  }
  return recipients.length;
}

export async function notifyGrowthReportParentsPublished(
  db: GrowthReportNotificationOutboxDb,
  params: { reportId: string; studentId: string; poolId: string; reportPeriod: string; actorId?: string },
  sendPush: GrowthReportPushSender,
): Promise<number> {
  const parents = await db.execute(sql`
    SELECT DISTINCT parent_id
    FROM parent_students
    WHERE student_id = ${params.studentId}
      AND status = 'approved'
  `);
  const recipients = parents.rows as Array<{ parent_id: string }>;
  const month = Number(params.reportPeriod.split("-")[1] ?? 1);
  const title = "지난달 성장리포트가 도착했습니다";
  const body = "지난 한 달 동안의 성장 모습을 확인해보세요.";
  const deepLink = `/parent/growth-report-detail?reportId=${params.reportId}`;
  for (const parent of recipients) {
    await enqueueGrowthReportNotification(db, {
      type: "GROWTH_REPORT_PUBLISHED",
      recipientId: parent.parent_id,
      recipientType: "parent_account",
      poolId: params.poolId,
      reportId: params.reportId,
      reportPeriod: params.reportPeriod,
      title,
      body,
      deepLink,
      payload: {
        screen: "growth_report_detail",
        growth_report_id: params.reportId,
        report_period: params.reportPeriod,
        deep_link: deepLink,
        report_month: month,
      },
    }, sendPush);
  }
  return recipients.length;
}