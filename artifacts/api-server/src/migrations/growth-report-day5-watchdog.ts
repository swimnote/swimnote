import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

/** Shared with monthly schema setup so a later replay cannot remove Day-5 support. */
export const monthlyOutboxScopeCheck = `
  (notification_type = 'GROWTH_REPORT_BATCH_READY'
    AND swimming_pool_id IS NOT NULL AND recipient_type = 'user' AND event_scope = 'pool')
  OR
  (notification_type IN ('GROWTH_REPORT_FIRST_PASS_FINISHED','GROWTH_REPORT_MONTHLY_PAUSED')
    AND swimming_pool_id IS NULL AND recipient_type = 'user'
    AND event_scope = 'report_month' AND event_key IS NOT NULL)
  OR
  (notification_type = 'GROWTH_REPORT_DAY5_DEADLINE_BLOCKED'
    AND swimming_pool_id IS NOT NULL AND recipient_type = 'user'
    AND event_scope = 'pool' AND event_key IS NOT NULL)
`;

/** Only extend the existing CHECK. No rows, columns, indexes or receipts change. */
export async function up(db: MigrationDb): Promise<void> {
  await db.execute(sql.raw(`
    ALTER TABLE growth_report_notification_outbox
      DROP CONSTRAINT IF EXISTS growth_report_notification_outbox_scope_chk,
      ADD CONSTRAINT growth_report_notification_outbox_scope_chk
        CHECK (${monthlyOutboxScopeCheck})
  `));
}
