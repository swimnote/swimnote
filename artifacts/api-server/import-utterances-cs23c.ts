/**
 * WP-CS23C: Import utterances to production DB
 * Usage: pnpm --filter @workspace/api-server exec tsx import-utterances-cs23c.ts [--write] [--activate]
 *
 * Uses @workspace/db's pool (already connected to SUPABASE_DATABASE_URL).
 */
import { pool } from "@workspace/db";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WRITE    = process.argv.includes("--write");
const ACTIVATE = process.argv.includes("--activate");

const canonicalAnswers: any[] = require("./src/content/support-canonical-answers.json");
const utterances: any[]       = require("./src/content/support-intent-utterances.json");

// Existing ACTIVE ki_* IDs confirmed in production
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
  const client = await pool.connect();
  try {
    console.log(`\n=== WP-CS23C DB Import ===`);
    console.log(`MODE: ${WRITE ? "WRITE" : "DRY-RUN"}`);
    console.log(`ACTIVATE: ${ACTIVATE}`);

    const newCanonicals    = canonicalAnswers.filter(a => !a.existing_ki);
    const haveActiveKi     = canonicalAnswers.filter(a => a.existing_ki);
    const uttsWithActiveKi = utterances.filter(u => ACTIVE_KI_IDS.has(u.knowledge_id));
    const uttsNewCanon     = utterances.filter(u => !ACTIVE_KI_IDS.has(u.knowledge_id));

    console.log(`\nPLAN:`);
    console.log(`  NEW_CANONICAL_TO_INSERT_PENDING: ${newCanonicals.length}`);
    console.log(`  INTENT_ID_UPDATES_ON_ACTIVE_KI:  ${haveActiveKi.length}`);
    console.log(`  UTTERANCES_TOTAL:                ${utterances.length}`);
    console.log(`  UTTERANCES_WITH_ACTIVE_KI:       ${uttsWithActiveKi.length}`);
    console.log(`  UTTERANCES_NEW_CANONICAL:        ${uttsNewCanon.length}`);

    if (!WRITE) {
      console.log(`\n[DRY-RUN] No changes made. Pass --write to execute.`);
      return;
    }

    // ── 1. Insert new canonical answers as 'pending' knowledge items ───────────
    console.log(`\n[1] Inserting ${newCanonicals.length} new canonical answers as pending...`);
    let kiInserted = 0, kiSkipped = 0;
    for (const ans of newCanonicals) {
      const scope  = ans.pool_scope === "pool" ? "pool" : "global";
      // Pass arrays as JS arrays (not JSON strings) — pg driver handles TEXT[] serialization
      const roles  = ans.roles ?? [];
      const modes  = ans.modes ?? [];
      const res = await client.query(
        `INSERT INTO support_knowledge_items (
          id, item_type, scope, pool_id, category, feature,
          affected_role, affected_mode, affected_roles, affected_modes,
          title, content, question, answer, deep_link,
          frontend_screen_id, solution_steps, conditions, incident_id,
          status, usage_count, intent_id, answer_mode
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
        ON CONFLICT (id) DO NOTHING`,
        [
          ans.answer_id, "FAQ", scope, null,
          ans.category ?? null,
          ans.function_id ?? null,
          ans.roles?.[0] ?? null,
          ans.modes?.[0] ?? null,
          roles, modes,
          ans.canonical_question ?? null,
          ans.canonical_answer ?? null,
          ans.canonical_question ?? null,
          ans.canonical_answer ?? null,
          null,
          ans.frontend_screen_id ?? null,
          null, null, null,
          "pending", 0,
          ans.intent_id ?? null,
          ans.answer_mode ?? "DIRECT_DB",
        ]
      );
      if ((res.rowCount ?? 0) > 0) kiInserted++; else kiSkipped++;
    }
    console.log(`  INSERTED: ${kiInserted}, ALREADY_EXISTS: ${kiSkipped}`);

    // ── 2. Update intent_id on existing ACTIVE ki_* items ─────────────────────
    console.log(`\n[2] Updating intent_id for existing ACTIVE knowledge items...`);
    let intentUpdated = 0;
    for (const ans of haveActiveKi) {
      if (!ans.existing_ki || !ans.intent_id) continue;
      const res = await client.query(
        `UPDATE support_knowledge_items
         SET intent_id = $1, updated_at = NOW()
         WHERE id = $2 AND (intent_id IS NULL OR intent_id = '')`,
        [ans.intent_id, ans.existing_ki]
      );
      if ((res.rowCount ?? 0) > 0) intentUpdated++;
    }
    console.log(`  INTENT_ID_UPDATED: ${intentUpdated}`);

    // ── 3. Insert all utterances as 'pending' ──────────────────────────────────
    console.log(`\n[3] Inserting ${utterances.length} utterances as pending...`);
    let uttInserted = 0, uttSkipped = 0;
    for (const u of utterances) {
      const res = await client.query(
        `INSERT INTO support_intent_utterances (
          id, intent_id, knowledge_id, utterance, normalized_utterance,
          language, weight, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING`,
        [
          u.utterance_id, u.intent_id, u.knowledge_id,
          u.utterance, u.normalized_utterance,
          "ko", u.weight, "pending",
        ]
      );
      if ((res.rowCount ?? 0) > 0) uttInserted++; else uttSkipped++;
    }
    console.log(`  INSERTED: ${uttInserted}, ALREADY_EXISTS: ${uttSkipped}`);

    // ── 4. Activate utterances for ACTIVE ki_* items ───────────────────────────
    if (ACTIVATE) {
      console.log(`\n[4] Activating utterances for ACTIVE knowledge items...`);
      const activeKiIdList = Array.from(ACTIVE_KI_IDS);
      const { rows: activeKiRows } = await client.query(
        `SELECT id FROM support_knowledge_items WHERE id = ANY($1) AND status = 'active'`,
        [activeKiIdList]
      );
      const confirmedActiveIds = new Set(activeKiRows.map((r: any) => r.id));
      const toActivate = utterances.filter(u => confirmedActiveIds.has(u.knowledge_id));
      console.log(`  CONFIRMED_ACTIVE_KI: ${confirmedActiveIds.size}`);
      console.log(`  UTTERANCES_TO_ACTIVATE: ${toActivate.length}`);

      let activated = 0;
      for (let i = 0; i < toActivate.length; i += 50) {
        const batch = toActivate.slice(i, i + 50).map(u => u.utterance_id);
        const res = await client.query(
          `UPDATE support_intent_utterances
           SET status = 'active', updated_at = NOW()
           WHERE id = ANY($1) AND status = 'pending'`,
          [batch]
        );
        activated += res.rowCount ?? 0;
      }
      console.log(`  ACTIVATED: ${activated}`);
    }

    // ── 5. Final summary ───────────────────────────────────────────────────────
    const { rows: uttCounts } = await client.query(
      `SELECT status, COUNT(*) AS cnt FROM support_intent_utterances GROUP BY status ORDER BY status`
    );
    const { rows: kiCounts } = await client.query(
      `SELECT status, COUNT(*) AS cnt FROM support_knowledge_items GROUP BY status ORDER BY status`
    );
    console.log(`\nFINAL_UTTERANCE_COUNTS:`);
    for (const r of uttCounts) console.log(`  ${r.status}: ${r.cnt}`);
    console.log(`\nFINAL_KNOWLEDGE_ITEM_COUNTS:`);
    for (const r of kiCounts) console.log(`  ${r.status}: ${r.cnt}`);

  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error("IMPORT_FAILED:", e.message);
    process.exit(1);
  });
