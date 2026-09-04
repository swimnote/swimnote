/**
 * staging-diff-check.ts — identify all indexes, columns, constraints in current state.
 * Run before and after 2nd manifest, compare output to find new objects.
 */
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const q = async (sql: string) => (await pool.query(sql)).rows;

// All indexes
const idxs = await q("SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname");
console.log("=== INDEXES ===");
for (const r of idxs as any[]) console.log(`  [idx] ${r.tablename}.${r.indexname}`);

// All columns with NOT NULL and defaults (to detect new columns)
const cols = await q(`
  SELECT table_name, column_name, column_default, is_nullable
  FROM information_schema.columns 
  WHERE table_schema='public' 
  ORDER BY table_name, column_name
`);
console.log(`\n=== COLUMNS (${cols.length}) ===`);
// Only print columns that are NOT NULL with defaults (unusual additions)
for (const r of cols as any[]) {
  if ((r as any).column_default !== null && (r as any).is_nullable === 'NO') {
    // potentially new columns
  }
}
// Print total per table for summary
const colsByTable: Record<string, number> = {};
for (const r of cols as any[]) {
  const t = (r as any).table_name;
  colsByTable[t] = (colsByTable[t] || 0) + 1;
}
// Print tables with more than expected cols (just list all for reference)
console.log(`  Total: ${cols.length}`);

// All constraints
const consts = await q(`
  SELECT tc.table_name, tc.constraint_name, tc.constraint_type
  FROM information_schema.table_constraints tc
  WHERE tc.constraint_schema='public'
  ORDER BY tc.table_name, tc.constraint_name
`);
console.log(`\n=== CONSTRAINTS (${consts.length}) ===`);
for (const r of consts as any[]) {
  if ((r as any).constraint_type === 'UNIQUE') {
    console.log(`  [unique] ${(r as any).table_name}.${(r as any).constraint_name}`);
  }
}

await pool.end();
