import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
const db = superAdminDb;

// Full inventory of all support_cases with non-null title (WP8 era)
const cases = (await db.execute(sql`
  SELECT id, ticket_id, pool_id, title, category, created_by_admin, ops_status,
         created_at::text AS created_at
  FROM support_cases
  WHERE title IS NOT NULL
  ORDER BY created_at
`)).rows;
console.log("TOTAL_TITLED_CASES:", cases.length);
for (const c of cases as any[]) {
  const marker = (c.pool_id?.startsWith('cc-gate-a-') || c.pool_id?.startsWith('cc-gate-b-')) ? "CONFIRMED_TEST" : "REAL_OR_UNKNOWN";
  console.log(`[${marker}] ${c.id} | pool=${c.pool_id} | title="${c.title}" | ${c.created_at}`);
}

// All notes: check unique pool patterns
const notesByCase = (await db.execute(sql`
  SELECT scn.id, scn.support_case_id, sc.pool_id, scn.actor_id, scn.event_type,
         scn.created_at::text AS created_at
  FROM support_case_notes scn
  LEFT JOIN support_cases sc ON sc.id = scn.support_case_id
  ORDER BY scn.created_at
`)).rows as any[];
const testNoteIds = notesByCase.filter((n: any) => n.pool_id?.startsWith('cc-gate-a-') || n.pool_id?.startsWith('cc-gate-b-'));
const unknownNoteIds = notesByCase.filter((n: any) => !n.pool_id?.startsWith('cc-gate-'));
console.log("CONFIRMED_TEST_NOTES:", testNoteIds.length);
console.log("REAL_OR_UNKNOWN_NOTES:", unknownNoteIds.length);
if (testNoteIds.length > 0) {
  console.log("CONFIRMED_TEST_NOTE_IDS:", testNoteIds.map((n:any)=>n.id).join(","));
}

// ops_status vs old state compatibility
const stateCheck = (await db.execute(sql`
  SELECT state, ops_status, COUNT(*) AS c
  FROM support_cases
  WHERE title IS NULL
  GROUP BY state, ops_status
  ORDER BY state, ops_status
`)).rows;
console.log("OLD_ROWS_STATE_vs_OPS_STATUS:", JSON.stringify(stateCheck));

// All test case IDs (cc-gate pool pattern)
const testCaseIds = (cases as any[]).filter((c: any) => c.pool_id?.startsWith('cc-gate-a-') || c.pool_id?.startsWith('cc-gate-b-'));
console.log("CONFIRMED_TEST_CASE_IDS:", testCaseIds.map((c:any)=>c.id).join(","));
