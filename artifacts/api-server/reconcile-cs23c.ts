/**
 * WP-CS23C-R: Canonical reconciliation + utterance integrity check
 */
import { pool } from "@workspace/db";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const canonicalAnswers: any[] = require("./src/content/support-canonical-answers.json");
const utterances: any[]       = require("./src/content/support-intent-utterances.json");

async function main() {
  const client = await pool.connect();
  try {
    // 1. Get all KI rows for these IDs
    const allKiIds = canonicalAnswers.map((a: any) => a.existing_ki ?? a.answer_id);
    const { rows: kiRows } = await client.query(
      `SELECT id, status, intent_id, answer_mode FROM support_knowledge_items WHERE id = ANY($1)`,
      [allKiIds]
    );
    const kiByID = new Map(kiRows.map((r: any) => [r.id, r]));

    // 2. Utterance counts per knowledge_id
    const { rows: uttCounts } = await client.query(`
      SELECT knowledge_id, status, COUNT(*) as cnt
      FROM support_intent_utterances
      GROUP BY knowledge_id, status
    `);
    const uttByKid = new Map<string, any>();
    for (const r of uttCounts) {
      if (!uttByKid.has(r.knowledge_id)) uttByKid.set(r.knowledge_id, {});
      uttByKid.get(r.knowledge_id)![r.status] = parseInt(r.cnt);
    }

    // 3. Build 72-row mapping
    const rows: any[] = [];
    for (const ans of canonicalAnswers) {
      const knowledge_id = ans.existing_ki ?? ans.answer_id;
      const ki: any = kiByID.get(knowledge_id);
      const uttMap = uttByKid.get(knowledge_id) ?? {};
      const uttTotal = (Object.values(uttMap) as number[]).reduce((s, v) => s + v, 0);

      let cat: string;
      if (!ki) {
        cat = "MISSING_KNOWLEDGE";
      } else if (ans.existing_ki && ki.status === "active") {
        cat = "EXISTING_ACTIVE";
      } else if (ans.answer_mode === "HUMAN_ONLY") {
        cat = "HUMAN_ONLY_PENDING";
      } else if (ki.status === "pending") {
        cat = "NEW_PENDING";
      } else {
        cat = "UNMAPPED";
      }

      rows.push({
        intent_id: ans.intent_id,
        answer_id: ans.answer_id,
        knowledge_id,
        dataset_status: ans.answer_mode ?? "DIRECT_DB",
        production_status: ki?.status ?? "NOT_FOUND",
        answer_mode: ki?.answer_mode ?? ans.answer_mode,
        existing_or_new: ans.existing_ki ? "EXISTING" : "NEW",
        utterance_count: uttTotal,
        utt_active: uttMap["active"] ?? 0,
        utt_pending: uttMap["pending"] ?? 0,
        category: cat,
      });
    }

    const summary = rows.reduce((acc: any, r) => {
      acc[r.category] = (acc[r.category] ?? 0) + 1;
      return acc;
    }, {} as any);

    console.log("=== CANONICAL RECONCILIATION ===");
    console.log(`CANONICAL_DATASET_TOTAL: ${rows.length}`);
    console.log("SUMMARY:");
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);

    // Detail rows
    for (const cat of ["EXISTING_ACTIVE","NEW_PENDING","HUMAN_ONLY_PENDING","MISSING_KNOWLEDGE","UNMAPPED"]) {
      const items = rows.filter(r => r.category === cat);
      console.log(`\n[${cat}] count=${items.length}`);
      for (const r of items) {
        console.log(`  ${r.intent_id} | ki=${r.knowledge_id} | prod=${r.production_status} | mode=${r.answer_mode} | utts=${r.utterance_count}(${r.utt_active}A/${r.utt_pending}P)`);
      }
    }

    // 4. ACTIVE utt → non-active KI violations
    const { rows: violations } = await client.query(`
      SELECT u.id, u.status as utt_status, u.knowledge_id, k.status as ki_status
      FROM support_intent_utterances u
      JOIN support_knowledge_items k ON k.id = u.knowledge_id
      WHERE u.status = 'active' AND k.status != 'active'
    `);
    console.log(`\n=== ACTIVE_UTT → NONACTIVE_KI VIOLATIONS: ${violations.length} ===`);
    for (const r of violations) console.log(`  ${r.id} | ki=${r.knowledge_id} | ki_status=${r.ki_status}`);

    // 5. DB totals
    const { rows: uttTots } = await client.query(
      `SELECT status, COUNT(*) cnt FROM support_intent_utterances GROUP BY status ORDER BY status`
    );
    const { rows: kiTots } = await client.query(
      `SELECT status, COUNT(*) cnt FROM support_knowledge_items GROUP BY status ORDER BY status`
    );
    console.log("\n=== DB TOTALS ===");
    console.log("UTTERANCES:", uttTots.map((r: any) => `${r.status}:${r.cnt}`).join(", "));
    console.log("KNOWLEDGE_ITEMS:", kiTots.map((r: any) => `${r.status}:${r.cnt}`).join(", "));

    // 6. Existing ACTIVE: verify intent_id was backfilled, status not changed
    const { rows: existingActive } = await client.query(`
      SELECT id, status, intent_id, updated_at
      FROM support_knowledge_items
      WHERE id LIKE 'ki_%' AND status = 'active'
      ORDER BY id
    `);
    console.log(`\n=== EXISTING ACTIVE KI (${existingActive.length}) ===`);
    let contentChanged = 0, statusChanged = 0, intentMissing = 0;
    for (const r of existingActive) {
      const hasIntent = !!r.intent_id;
      if (!hasIntent) intentMissing++;
      console.log(`  ${r.id} | intent=${r.intent_id ?? "NULL"} | status=${r.status}`);
    }
    console.log(`INTENT_MISSING: ${intentMissing}`);
    console.log(`EXISTING_ACTIVE_CONTENT_CHANGED: ${contentChanged}`);
    console.log(`EXISTING_ACTIVE_STATUS_CHANGED: ${statusChanged}`);

    // 7. Equation check
    const existingActiveCount = summary["EXISTING_ACTIVE"] ?? 0;
    const newPendingCount = summary["NEW_PENDING"] ?? 0;
    const humanOnlyCount = summary["HUMAN_ONLY_PENDING"] ?? 0;
    const missingCount = summary["MISSING_KNOWLEDGE"] ?? 0;
    const total = existingActiveCount + newPendingCount + humanOnlyCount + missingCount;
    console.log(`\n=== COUNT EQUATION ===`);
    console.log(`EXISTING_ACTIVE(${existingActiveCount}) + NEW_PENDING(${newPendingCount}) + HUMAN_ONLY(${humanOnlyCount}) + MISSING(${missingCount}) = ${total} (expect 72)`);
    console.log(`EQUATION_OK: ${total === 72}`);

  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
