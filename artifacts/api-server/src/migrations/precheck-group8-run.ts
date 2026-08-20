/**
 * READ-ONLY precheck for group8 migration.
 * Run: node_modules/.bin/tsx src/migrations/precheck-group8-run.ts
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1. row counts
  const counts = await superAdminDb.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM parent_curriculum_conversations) AS conv_count,
      (SELECT COUNT(*) FROM parent_curriculum_messages)      AS msg_count
  `);
  console.log("=== ROW COUNTS ===");
  console.log(JSON.stringify((counts as any).rows[0]));

  // 2. columns
  const cols = await superAdminDb.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'parent_curriculum_conversations'
    ORDER BY ordinal_position
  `);
  console.log("\n=== COLUMNS ===");
  console.log(JSON.stringify((cols as any).rows, null, 2));

  // 3. UNIQUE + PK constraints
  const constraints = await superAdminDb.execute(sql`
    SELECT c.conname, c.contype,
           array_agg(a.attname ORDER BY a.attnum) AS cols
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'parent_curriculum_conversations'::regclass
      AND c.contype IN ('u', 'p')
    GROUP BY c.conname, c.contype
  `);
  console.log("\n=== CONSTRAINTS (UNIQUE + PK) ===");
  console.log(JSON.stringify((constraints as any).rows, null, 2));

  // 4. indexes
  const indexes = await superAdminDb.execute(sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'parent_curriculum_conversations'
  `);
  console.log("\n=== INDEXES ===");
  console.log(JSON.stringify((indexes as any).rows, null, 2));

  // 5. FK on messages
  const fks = await superAdminDb.execute(sql`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name  AS foreign_table,
      ccu.column_name AS foreign_column,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema    = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name  = rc.constraint_name
     AND tc.table_schema     = rc.constraint_schema
    WHERE tc.table_name      = 'parent_curriculum_messages'
      AND tc.constraint_type = 'FOREIGN KEY'
  `);
  console.log("\n=== MESSAGES FK ===");
  console.log(JSON.stringify((fks as any).rows, null, 2));

  process.exit(0);
}

main().catch(e => { console.error("PRECHECK ERROR:", e.message); process.exit(1); });
