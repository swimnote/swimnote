import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
const db = superAdminDb;

const scRows = (await db.execute(sql`SELECT COUNT(*) AS c FROM support_cases`)).rows[0] as any;
const notesExists = (await db.execute(sql`SELECT 1 FROM information_schema.tables WHERE table_name='support_case_notes'`)).rows.length > 0;
const scnRows = notesExists ? (await db.execute(sql`SELECT COUNT(*) AS c FROM support_case_notes`)).rows[0] as any : {c:0};
console.log("support_cases_rows:", scRows.c);
console.log("support_case_notes_rows:", scnRows.c);

const opsDist = (await db.execute(sql`SELECT ops_status, COUNT(*) AS c FROM support_cases GROUP BY ops_status ORDER BY 1`)).rows;
console.log("ops_status_dist:", JSON.stringify(opsDist));

// Index check using separate queries
const wp8Idxs = ["sc_pool_status_idx","sc_pool_created_idx","sc_ticket_idx","sc_subject_idx","scn_case_id_idx","al_pool_created_idx","al_actor_created_idx","al_entity_idx"];
for (const idx of wp8Idxs) {
  const r = (await db.execute(sql.raw(`SELECT 1 FROM pg_indexes WHERE indexname='${idx}'`))).rows.length > 0;
  console.log(`IDX_${idx}:`, r ? "PRESENT" : "MISSING");
}

// Verify no unexpected data loss: check title/ops_status nulls on existing rows
const nullCheck = (await db.execute(sql`
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN title IS NULL THEN 1 ELSE 0 END) AS null_title,
         SUM(CASE WHEN ops_status IS NULL THEN 1 ELSE 0 END) AS null_ops_status,
         SUM(CASE WHEN ops_status = 'OPEN' THEN 1 ELSE 0 END) AS open_count
  FROM support_cases
`)).rows[0] as any;
console.log("null_title:", nullCheck.null_title, "/ null_ops_status:", nullCheck.null_ops_status, "/ open_count:", nullCheck.open_count, "/ total:", nullCheck.total);
