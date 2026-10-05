import { sql } from "drizzle-orm";
import {
  getMonthlyReportReadiness,
  type MonthlyReadinessDb,
  type MonthlyReportReadiness,
} from "../jobs/growth-report-monthly-readiness.js";

export type GrowthReportDay5BlockedNotification = {
  type: "GROWTH_REPORT_DAY5_DEADLINE_BLOCKED";
  recipientId: string;
  recipientType: "user";
  poolId: string;
  reportPeriod: string;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
  eventKey: string;
};

/** The existing deadline: issue-month day 5, 02:00 Asia/Seoul. */
export function day5DeadlineReached(reportPeriod: string, now = new Date()): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportPeriod)) return false;
  const [year, month] = reportPeriod.split("-").map(Number);
  return now.getTime() >= Date.UTC(year, month, 5, 2 - 9);
}

const counterKeys = [
  "eligible_total", "resolved_total", "remaining_count", "generated_total",
  "insufficient_evidence_total", "policy_excluded_total", "queued",
  "processing", "retry_pending", "failed", "unknown", "missing",
  "duplicate", "wrong_pool",
] as const;

/** Aggregate allowlist only: never copy a report, student, or exception text. */
function counters(readiness: MonthlyReportReadiness | undefined, eligible: number) {
  return Object.fromEntries(counterKeys.map(key => {
    const value = readiness?.[key];
    return [key, typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : key === "eligible_total" || key === "remaining_count" || key === "unknown"
        ? eligible : 0];
  })) as Record<typeof counterKeys[number], number>;
}

export async function enqueueDay5DeadlineBlocked(
  db: MonthlyReadinessDb,
  params: { poolId: string; reportPeriod: string; now?: Date },
): Promise<number> {
  if (!day5DeadlineReached(params.reportPeriod, params.now)) return 0;
  return db.transaction(async tx => {
    const cycle = (await tx.execute(sql`
      SELECT id, COALESCE(eligible_total, 0) AS eligible_total FROM growth_report_cycles
      WHERE swimming_pool_id = ${params.poolId}
        AND report_period = ${params.reportPeriod}
        AND eligibility_sealed_at IS NOT NULL
      FOR UPDATE
    `)).rows[0] as { id: string; eligible_total: number } | undefined;
    if (!cycle) return 0;

    // A failed reconciliation must still produce a durable deadline event.
    // A savepoint keeps SQL failures from poisoning the alert transaction.
    const scopedDb = { execute: (q: any) => tx.execute(q),
      transaction: async (fn: any) => fn(tx) } as MonthlyReadinessDb;
    let readiness: MonthlyReportReadiness | undefined;
    await tx.execute(sql`SAVEPOINT day5_readiness`);
    try {
      readiness = await getMonthlyReportReadiness(scopedDb, params);
      await tx.execute(sql`RELEASE SAVEPOINT day5_readiness`);
    } catch {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT day5_readiness`);
      await tx.execute(sql`RELEASE SAVEPOINT day5_readiness`);
    }
    if (readiness?.ready) return 0;

    const recipients = (await tx.execute(sql`
      SELECT DISTINCT id AS user_id FROM users
      WHERE role = 'super_admin' ORDER BY id
    `)).rows as Array<{ user_id: string }>;
    if (!recipients.length) throw new Error("DAY5_SUPER_ADMIN_RECIPIENT_MISSING");

    const totals = counters(readiness, Number(cycle.eligible_total));
    const eventKey = `growth_report_day5_${encodeURIComponent(params.poolId)}_${params.reportPeriod}_DAY5_DEADLINE_BLOCKED`;
    const title = "AI 성장리포트 발급 차단";
    const body = `${params.reportPeriod} 성장리포트 중 미완료 수영장이 있습니다.\n` +
      `수영장 ${params.poolId}\n` +
      (readiness?.empty_target
        ? "봉인된 발급대상이 없어 발급 준비가 완료되지 않았습니다.\n"
        : readiness
        ? `미완료 ${totals.remaining_count}명 / UNKNOWN ${totals.unknown}명.\n`
        : `집계 확인 불가: 봉인 대상 ${cycle.eligible_total}명의 완료 여부를 확인하지 못했습니다.\n`) +
      "SWIMNOTE에서 확인해 주세요.";
    const deepLink = `/super/ai?tab=monthly&report_period=${encodeURIComponent(params.reportPeriod)}` +
      `&pool_id=${encodeURIComponent(params.poolId)}`;
    const payload = {
      screen: "monthly", event_type: "DAY5_DEADLINE_BLOCKED",
      report_period: params.reportPeriod, pool_id: params.poolId,
      report_month: params.reportPeriod,
      deep_link: deepLink, ...totals,
      remaining: totals.remaining_count,
      counters_available: readiness !== undefined,
      empty_target: readiness?.empty_target ?? false,
      ...(readiness ? {} : { readiness_error: "RECONCILIATION_UNAVAILABLE" }),
    };
    await tx.execute(sql`
      INSERT INTO super_admin_notifications
        (id, type, title, body, pool_id, ref_id, ref_type, is_read, idempotency_key, created_at)
      VALUES (${`san_${eventKey}`}, 'GROWTH_REPORT_DAY5_DEADLINE_BLOCKED',
        ${title}, ${body}, ${params.poolId}, ${params.reportPeriod},
        'growth_report_monthly_run', FALSE, ${eventKey}, NOW())
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    `);
    let inserted = 0;
    for (const recipient of recipients) {
      const row = await tx.execute(sql`
        INSERT INTO growth_report_notification_outbox
          (id, notification_type, event_scope, event_key, swimming_pool_id,
           report_period, recipient_id, recipient_type, title, body, deep_link, payload)
        VALUES (${`grnot_super_${encodeURIComponent(eventKey)}_${encodeURIComponent(recipient.user_id)}`},
          'GROWTH_REPORT_DAY5_DEADLINE_BLOCKED', 'pool', ${eventKey}, ${params.poolId},
          ${params.reportPeriod}, ${recipient.user_id}, 'user', ${title}, ${body},
          ${deepLink}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT DO NOTHING RETURNING id
      `);
      inserted += row.rows.length;
    }
    return inserted;
  });
}

/** Fresh check at both claim and dispatch; recovery must not send a stale alert. */
export async function day5BlockedDispatchAllowed(
  db: MonthlyReadinessDb,
  item: GrowthReportDay5BlockedNotification,
): Promise<boolean> {
  if (!day5DeadlineReached(item.reportPeriod)) return false;
  try {
    const readiness = await getMonthlyReportReadiness(db, item);
    return readiness.snapshot_sealed && !readiness.ready;
  } catch {
    // A pool-specific broken reconciliation must not suppress its own alarm.
    // Never use this fallback for a cycle already marked READY.
    const cycle = (await db.execute(sql`
      SELECT id FROM growth_report_cycles
      WHERE swimming_pool_id = ${item.poolId} AND report_period = ${item.reportPeriod}
        AND eligibility_sealed_at IS NOT NULL
        AND ready_at IS NULL
    `)).rows[0];
    return cycle !== undefined;
  }
}
