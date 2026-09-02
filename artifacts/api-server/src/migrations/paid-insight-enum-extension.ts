/**
 * paid-insight-enum-extension.ts
 *
 * Additive migration: extends gr_answer_type_enum with SCALE and SHORT_TEXT.
 *
 * Context:
 *   - GR1 migration created gr_answer_type_enum with SINGLE_CHOICE, MULTI_CHOICE.
 *   - Paid Insight AI Engine also returns 'scale' and 'short_text' question types.
 *   - ALTER TYPE ADD VALUE is additive and non-destructive.
 *   - IF NOT EXISTS guard: safe to run multiple times.
 *
 * Production migration execution: PENDING APPROVAL
 *   Run initPaidInsightEnumExtension() once in production after approval.
 *
 * AI calls:  0
 * DB write:  YES (DDL only — additive)
 * Destructive: NO
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * initPaidInsightEnumExtension
 *
 * Adds SCALE and SHORT_TEXT to gr_answer_type_enum.
 * Safe to run multiple times (IF NOT EXISTS).
 *
 * NOTE: PostgreSQL ALTER TYPE ADD VALUE cannot run inside a transaction on older
 *       versions. This migration runs outside of a transaction context.
 *       On PostgreSQL ≥ 12, IF NOT EXISTS is supported.
 */
export async function initPaidInsightEnumExtension(): Promise<void> {
  const db = superAdminDb;

  // Add SCALE if not already present
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE gr_answer_type_enum ADD VALUE IF NOT EXISTS 'SCALE';
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[paid-insight-enum] gr_answer_type_enum SCALE OK");

  // Add SHORT_TEXT if not already present
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE gr_answer_type_enum ADD VALUE IF NOT EXISTS 'SHORT_TEXT';
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[paid-insight-enum] gr_answer_type_enum SHORT_TEXT OK");

  console.log("[paid-insight-enum] Enum extension complete");
}
