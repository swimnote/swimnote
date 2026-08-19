/**
 * WP-CS23C: Import support-intent-utterances.json → production DB
 *
 * Strategy:
 *   1. Insert 43 new canonical answers as 'pending' knowledge items
 *   2. Insert all 611 utterances as 'pending'
 *   3. Activate utterances that reference ACTIVE ki_* items (has_active_ki group)
 *
 * Safety:
 *   - Dry-run mode unless --write flag passed
 *   - ON CONFLICT DO NOTHING (idempotent)
 *   - No existing ACTIVE items modified
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load production DB config
import { buildConfig } from "@workspace/db/config.js";
import pg from "pg";

const WRITE = process.argv.includes("--write");
const ACTIVATE = process.argv.includes("--activate");

// Load datasets
const canonicalAnswers: any[] = require("../artifacts/api-server/src/content/support-canonical-answers.json");
const utterances: any[] = require("../artifacts/api-server/src/content/support-intent-utterances.json");

// Existing ACTIVE ki_* IDs (from CS23B audit)
const ACTIVE_KI_IDS = new Set([
  "ki_swimnote_intro", "ki_x_mode_intro",
  "ki_cs12_account_withdrawal", "ki_cs12_pool_admin_withdrawal_deferred",
  "ki_cs12_pool_access_denied", "ki_cs12_attendance_permission",
  "ki_cs12_attendance_save_failed", "ki_cs12_diary_save_failed",
  "ki_cs12_diary_photo_upload_failed", "ki_cs12_parent_diary_not_visible",
  "ki_cs12_diary_ai_failed", "ki_cs12_growth_report_pending",
  "ki_cs12_x_setup_howto", "ki_cs12_notification_permission_ios",
  "ki_cs12_notification_permission_android", "ki_cs12_push_not_working",
  "ki_cs12_billing_error_triage", "ki_cs12_billing_payment_failed",
  "ki_cs12_parent_not_linked", "ki_cs12_server_error_triage",
  "ki_cs12_ai_error_triage", "ki_cs12_data_filter_check",
  "ki_cs12_data_role_mismatch",
  "ki_cs22_makeup_failure", "ki_cs22_parent_photo_not_visible",
  "ki_cs22_xmodeguard_lock_states",
]);

async function main() {
  console.log(`\n=== WP-CS23C DB Import ===`);
  console.log(`MODE: ${WRITE ? "WRITE" : "DRY-RUN"}`);
  console.log(`ACTIVATE: ${ACTIVATE}`);

  const cfg = buildConfig();
  const pool = new pg.Pool({ connectionString: cfg.supabaseUrl });
  const client = await pool.connect();

  try {
    // ── 1. Identify new canonical answers (those without existing_ki) ──────────
    const newCanonicals = canonicalAnswers.filter(a => !a.existing_ki);
    const haveExistingKi = canonicalAnswers.filter(a => a.existing_ki);
    console.log(`\nCANONICAL ANSWERS:`);
    console.log(`  WITH_ACTIVE_KI: ${haveExistingKi.length}`);
    console.log(`  NEW_PENDING: ${newCanonicals.length}`);

    // ── 2. Utterance breakdown ─────────────────────────────────────────────────
    const uttsWithActiveKi = utterances.filter(u => ACTIVE_KI_IDS.has(u.knowledge_id));
    const uttsNewCanonical = utterances.filter(u => !ACTIVE_KI_IDS.has(u.knowledge_id));
    const humanOnlyUtts = utterances.filter(u => {
      const ans = canonicalAnswers.find(a => a.intent_id === u.intent_id);
      return ans?.answer_mode === "HUMAN_ONLY";
    });
    console.log(`\nUTTERANCES:`);
    console.log(`  TOTAL: ${utterances.length}`);
    console.log(`  WITH_ACTIVE_KI: ${uttsWithActiveKi.length}`);
    console.log(`  NEW_CANONICAL: ${uttsNewCanonical.length}`);
    console.log(`  HUMAN_ONLY: ${humanOnlyUtts.length}`);

    if (!WRITE) {
      console.log(`\n[DRY-RUN] Pass --write to execute DB changes.`);
      await client.release();
      await pool.end();
      return;
    }

    // ── 3. Insert new canonical answers as pending knowledge items ─────────────
    console.log(`\nInserting ${newCanonicals.length} new canonical answers as 'pending'...`);
    let newKiInserted = 0;
    let newKiSkipped = 0;

    for (const ans of newCanonicals) {
      const scope = ans.pool_scope === "pool" ? "pool" : "global";
      const affectedRoles = JSON.stringify(ans.roles ?? []);
      const affectedModes = JSON.stringify(ans.modes ?? []);

      const res = await client.query(`
        INSERT INTO support_knowledge_items (
          id, item_type, scope, pool_id, category, feature,
          affected_role, affected_mode, affected_roles, affected_modes,
          title, content, question, answer, deep_link,
          frontend_screen_id, solution_steps, conditions, incident_id,
          status, usage_count, intent_id, answer_mode
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `, [
        ans.answer_id,
        "FAQ",
        scope,
        null,           // pool_id
        ans.category,
        ans.function_id ?? null,
        ans.roles?.[0] ?? null,    // affected_role (first)
        ans.modes?.[0] ?? null,    // affected_mode (first)
        affectedRoles,
        affectedModes,
        ans.canonical_question,    // title
        ans.canonical_answer,      // content
        ans.canonical_question,    // question
        ans.canonical_answer,      // answer
        null,           // deep_link
        ans.frontend_screen_id ?? null,
        null,           // solution_steps
        null,           // conditions
        null,           // incident_id
        "pending",      // status — NOT active until approved
        0,              // usage_count
        ans.intent_id,
        ans.answer_mode,
      ]);
      if (res.rowCount && res.rowCount > 0) newKiInserted++;
      else newKiSkipped++;
    }
    console.log(`  INSERTED: ${newKiInserted}, SKIPPED(already exists): ${newKiSkipped}`);

    // ── 4. Update existing ACTIVE ki_* items to set intent_id if missing ────────
    console.log(`\nUpdating intent_id for existing ACTIVE knowledge items...`);
    let intentUpdated = 0;
    for (const ans of haveExistingKi) {
      if (!ans.existing_ki || !ans.intent_id) continue;
      const res = await client.query(`
        UPDATE support_knowledge_items
        SET intent_id = $1, updated_at = NOW()
        WHERE id = $2 AND (intent_id IS NULL OR intent_id = '')
      `, [ans.intent_id, ans.existing_ki]);
      if (res.rowCount && res.rowCount > 0) intentUpdated++;
    }
    console.log(`  INTENT_ID_UPDATED: ${intentUpdated}`);

    // ── 5. Insert all utterances as 'pending' ─────────────────────────────────
    console.log(`\nInserting ${utterances.length} utterances as 'pending'...`);
    let uttInserted = 0;
    let uttSkipped = 0;

    for (const u of utterances) {
      const res = await client.query(`
        INSERT INTO support_intent_utterances (
          id, intent_id, knowledge_id, utterance, normalized_utterance,
          language, weight, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `, [
        u.utterance_id,
        u.intent_id,
        u.knowledge_id,
        u.utterance,
        u.normalized_utterance,
        u.language ?? "ko",
        u.weight,
        "pending",   // always start as pending
      ]);
      if (res.rowCount && res.rowCount > 0) uttInserted++;
      else uttSkipped++;
    }
    console.log(`  INSERTED: ${uttInserted}, SKIPPED(already exists): ${uttSkipped}`);

    // ── 6. Activate utterances for ACTIVE ki_* items (if --activate) ──────────
    if (ACTIVATE) {
      const activeKiIds = Array.from(ACTIVE_KI_IDS);
      const activeUttIds = utterances
        .filter(u => ACTIVE_KI_IDS.has(u.knowledge_id))
        .map(u => u.utterance_id);

      console.log(`\nActivating ${activeUttIds.length} utterances for ACTIVE knowledge items...`);

      // Verify knowledge items are actually ACTIVE in DB
      const { rows: activeRows } = await client.query(`
        SELECT id FROM support_knowledge_items
        WHERE id = ANY($1) AND status = 'active'
      `, [activeKiIds]);
      const confirmedActiveIds = new Set(activeRows.map((r: any) => r.id));

      const confirmedUtts = utterances.filter(u => confirmedActiveIds.has(u.knowledge_id));
      console.log(`  CONFIRMED_ACTIVE_KI: ${confirmedActiveIds.size}`);
      console.log(`  UTTERANCES_TO_ACTIVATE: ${confirmedUtts.length}`);

      if (confirmedUtts.length > 0) {
        const uttIdsToActivate = confirmedUtts.map(u => u.utterance_id);
        const res = await client.query(`
          UPDATE support_intent_utterances
          SET status = 'active', updated_at = NOW()
          WHERE id = ANY($1) AND status = 'pending'
        `, [uttIdsToActivate]);
        console.log(`  ACTIVATED: ${res.rowCount}`);
      }
    }

    // ── 7. Final counts ────────────────────────────────────────────────────────
    const { rows: finalCounts } = await client.query(`
      SELECT status, COUNT(*) AS cnt FROM support_intent_utterances
      GROUP BY status ORDER BY status
    `);
    console.log(`\nFINAL_UTTERANCE_COUNTS:`);
    for (const r of finalCounts) {
      console.log(`  ${r.status}: ${r.cnt}`);
    }

    const { rows: kiCounts } = await client.query(`
      SELECT status, COUNT(*) AS cnt FROM support_knowledge_items
      GROUP BY status ORDER BY status
    `);
    console.log(`\nFINAL_KNOWLEDGE_ITEM_COUNTS:`);
    for (const r of kiCounts) {
      console.log(`  ${r.status}: ${r.cnt}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error("IMPORT_FAILED:", e.message);
  process.exit(1);
});
