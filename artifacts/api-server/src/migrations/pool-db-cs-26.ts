/**
 * WP-CS26 — autonomous support sequence metadata.
 *
 * The learning log keeps normalized queries only. This additive outcome field
 * records the final autonomous path without copying a message or callback PII.
 */

import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

let ran = false;

export async function runCs26Migration(db: MigrationDb): Promise<void> {
  if (ran) return;
  ran = true;

  await (db as any).execute(sql.raw(`
    ALTER TABLE support_query_log
      ADD COLUMN IF NOT EXISTS autonomous_outcome TEXT
  `));
  await (db as any).execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sql_autonomous_outcome
      ON support_query_log (autonomous_outcome)
  `));

  console.log("[cs26] migration complete — autonomous support outcome field ready");
}