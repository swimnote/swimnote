import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
const db = superAdminDb;

// Identify WP8 preflight test cases by known markers
// The preflight uses: pool_id with test prefix, or known patterns
const cases = (await db.execute(sql`
  SELECT id, ticket_id, pool_id, title, category, subject_type, subject_id, created_by_admin, ops_status, created_at
  FROM support_cases
  WHERE title IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 50
`)).rows;
console.log("NON_NULL_TITLE_CASES:", JSON.stringify(cases, null, 2));

// Check notes - all 70
const notes = (await db.execute(sql`
  SELECT id, support_case_id, pool_id, actor_id, event_type, note, created_at
  FROM support_case_notes
  ORDER BY created_at DESC
  LIMIT 80
`)).rows;
console.log("NOTES_SAMPLE:", JSON.stringify(notes.slice(0,5), null, 2));
console.log("NOTES_TOTAL:", notes.length);
console.log("NOTES_UNIQUE_CASE_IDS:", [...new Set(notes.map((n:any)=>n.support_case_id))].join(","));

// Check audit_logs for WP8 test entries
const audits = (await db.execute(sql`
  SELECT id, pool_id, actor_id, entity_type, action, created_at
  FROM audit_logs
  WHERE entity_type = 'SUPPORT_CASE'
  ORDER BY created_at DESC
  LIMIT 20
`)).rows;
console.log("AUDIT_SUPPORT_CASE:", JSON.stringify(audits.slice(0,3), null, 2));
console.log("AUDIT_SUPPORT_CASE_COUNT:", audits.length);
