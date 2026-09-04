/**
 * phase16e-test.ts — Phase 16E/16F-Cont serializer matrix test
 *
 * Tests:
 *   A. text[] with values
 *   B. empty array []
 *   C. NULL
 *   D. regular string
 *   E. single quote string (O'Brien)
 *   F. comma-containing string
 *   G. JSON object
 *   H. boolean
 *   I. integer
 *   J. timestamp (Date object / ISO string returned by driver)
 *
 *   + jsonb array [] (16F-Cont: A4 fix)
 *   + jsonb array ['cg_1','cg_2'] (16F-Cont)
 *   + jsonb nested object {"nested":{"x":true}} (16F-Cont)
 *   + student row: assigned_class_ids=[], class_schedule=[] (16F-Cont)
 *   + student row: assigned_class_ids=["cg_x"], class_schedule=["월 15:00"] (16F-Cont)
 *
 *   + pool_credits lazy skip
 *   + non-lazy missing table → BACKUP_SCHEMA_MISSING
 *   + normal scalar row replication
 *   + null handling
 *   + json/jsonb handling
 *   + identifier validation
 *
 * Uses Backup DB only (POOL_DATABASE_URL). Temp table created/dropped per run.
 * Production DB: not touched.
 */

import { getBackupDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const db = getBackupDb();
if (!db) { console.error("POOL_DATABASE_URL not set"); process.exit(1); }

// ── Constants matching standby-sync.ts ───────────────────────────────────────
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LAZY_SYNC_TABLES = new Set(["pool_credits"]);

// ══════════════════════════════════════════════════════════════════
// serializeForPg — the serializer being tested / must match standby-sync.ts
//
// Phase 16E fix: drizzle's sql`${v}` expands JS arrays into multiple params
//   e.g. sql`${['a','b']}` → ($2, $3) — a "record" type, not text[]
// Phase 16F-Cont fix (A4): jsonb columns receive JS arrays too, but
//   PG array literal {a,b} is invalid JSON → 22P02 error.
//   Must pass pgType to distinguish jsonb vs text[].
// ══════════════════════════════════════════════════════════════════
function serializeForPg(v: unknown, pgType?: string): unknown {
  if (v === null || v === undefined) return null;

  if (Array.isArray(v)) {
    // jsonb / json 컬럼: JSON 배열 문자열로 전달 (PG jsonb input이 파싱)
    if (pgType === "jsonb" || pgType === "json") return JSON.stringify(v);
    // text[], int4[] 등 PG 네이티브 배열: 배열 리터럴 {a,b}
    const elems = v.map(e => {
      if (e === null || e === undefined) return "NULL";
      if (typeof e === "number" || typeof e === "boolean") return String(e);
      const s = String(e);
      const escaped = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    });
    return `{${elems.join(",")}}`;
  }

  if (v instanceof Date) {
    return v.toISOString();
  }

  if (typeof v === "object") {
    // jsonb / json non-array objects
    return JSON.stringify(v);
  }

  // boolean, number, bigint, string: pass as-is — pg/drizzle handle natively
  return v;
}

// ── Parameterized insert helper (mirrors replicateTable logic) ────────────────
// colTypes: Map<columnName, udt_name> — obtained from information_schema
async function insertRowsParameterized(
  tableName: string,
  rows: Record<string, unknown>[],
  colTypes?: Map<string, string>,
): Promise<void> {
  if (!IDENT_RE.test(tableName)) throw new Error(`Invalid table identifier: ${tableName}`);
  const cols = Object.keys(rows[0]);
  for (const c of cols) {
    if (!IDENT_RE.test(c)) throw new Error(`Invalid column identifier: ${c}`);
  }
  const colIdents = cols.map(c => `"${c}"`).join(", ");
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const rowSqls = chunk.map(row => {
      const vals = cols.map(col => serializeForPg(row[col], colTypes?.get(col)));
      return sql`(${sql.join(vals.map(v => sql`${v}`), sql.raw(", "))})`;
    });
    const valuesSql = sql.join(rowSqls, sql.raw(", "));
    await db!.execute(
      sql`INSERT INTO ${sql.raw(`"${tableName}"`)} (${sql.raw(colIdents)}) VALUES ${valuesSql} ON CONFLICT DO NOTHING`
    );
  }
}

// ── Drizzle-aware "relation does not exist" check ───────────────────────────
// DrizzleQueryError wraps the PG error in e.cause; check both layers.
function isPgRelationMissing(e: any): boolean {
  const check = (msg: string) => msg.toLowerCase().includes("does not exist");
  if (e.code === "42P01") return true;
  if (check(e.message ?? "")) return true;
  const cause = e.cause;
  if (!cause) return false;
  if (cause.code === "42P01") return true;
  if (check(cause.message ?? "")) return true;
  return false;
}

// ── lazy skip simulation ─────────────────────────────────────────────────────
async function simulateLazySkip(tableName: string): Promise<{ lazy_skip: boolean }> {
  const isLazy = LAZY_SYNC_TABLES.has(tableName);
  try {
    await db!.execute(sql.raw(`SELECT * FROM "${tableName}"`));
    return { lazy_skip: false };
  } catch (e: any) {
    if (isLazy && isPgRelationMissing(e)) return { lazy_skip: true };
    throw e;
  }
}

// ── BACKUP_SCHEMA_MISSING simulation ─────────────────────────────────────────
async function simulateBackupSchemaMissing(tableName: string): Promise<string> {
  try {
    await db!.execute(sql.raw(`TRUNCATE TABLE "${tableName}" CASCADE`));
    return "TRUNCATE_OK";
  } catch (e: any) {
    if (isPgRelationMissing(e)) return "BACKUP_SCHEMA_MISSING";
    return `OTHER_ERROR: ${e.message}`;
  }
}

// ── Test runner ──────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

async function main() {
  console.log("\n████████████████████████████████████████████");
  console.log("  PHASE 16E — SERIALIZER TEST MATRIX");
  console.log("████████████████████████████████████████████\n");

  const TABLE = "phase16e_test_tmp";
  const TS_ISO = "2026-05-15T12:34:56.789Z";
  const tsDate = new Date(TS_ISO);

  // ── Setup: create test table ───────────────────────────────────────────────
  await db!.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`));
  await db!.execute(sql.raw(`
    CREATE TABLE "${TABLE}" (
      id           text PRIMARY KEY,
      arr_col      text[],
      null_col     text,
      str_col      text,
      json_col     jsonb,
      jsonarr_col  jsonb,
      bool_col     boolean,
      int_col      integer,
      ts_col       timestamptz
    )
  `));
  // colTypes map mirrors what replicateTable fetches from information_schema
  const colTypes = new Map([
    ["id", "text"], ["arr_col", "_text"], ["null_col", "text"],
    ["str_col", "text"], ["json_col", "jsonb"], ["jsonarr_col", "jsonb"],
    ["bool_col", "bool"], ["int_col", "int4"], ["ts_col", "timestamptz"],
  ]);
  console.log(`Created temp table: ${TABLE}\n`);

  // ══════════════════════════════════════════════════
  //  TEST GROUP 1 — Serializer Matrix (A-J + jsonb arrays)
  // ══════════════════════════════════════════════════
  console.log("══ GROUP 1: Serializer Matrix (A–J + jsonb arrays) ══");

  const testRow: Record<string, unknown> = {
    id:          "test_1",
    arr_col:     ["pool_admin", "teacher"],          // A: text[] with values
    null_col:    null,                               // C: NULL
    str_col:     "O'Brien, comma",                  // E+F: single quote + comma
    json_col:    { a: 1, b: "x", nested: true },    // G: JSON object
    jsonarr_col: ["cg_1", "cg_2"],                  // K: jsonb array with values
    bool_col:    true,                               // H: boolean
    int_col:     42,                                 // I: integer
    ts_col:      tsDate,                             // J: Date object
  };
  await insertRowsParameterized(TABLE, [testRow], colTypes);

  // Empty array row
  const emptyArrRow: Record<string, unknown> = {
    id:          "test_empty_arr",
    arr_col:     [],       // B: empty text[] array
    null_col:    null,
    str_col:     "plain", // D: regular string
    json_col:    null,
    jsonarr_col: [],       // L: empty jsonb array
    bool_col:    false,
    int_col:     0,
    ts_col:      null,
  };
  await insertRowsParameterized(TABLE, [emptyArrRow], colTypes);

  // Nested jsonb object row
  const nestedRow: Record<string, unknown> = {
    id:          "test_nested",
    arr_col:     null,
    null_col:    null,
    str_col:     "nested",
    json_col:    { nested: { x: true } },          // G2: nested JSON object
    jsonarr_col: [],
    bool_col:    null,
    int_col:     null,
    ts_col:      null,
  };
  await insertRowsParameterized(TABLE, [nestedRow], colTypes);

  // Read back
  const readback = (await db!.execute(sql.raw(`SELECT * FROM "${TABLE}" ORDER BY id`))).rows as any[];
  const r1 = readback.find((r: any) => r.id === "test_1");
  const r2 = readback.find((r: any) => r.id === "test_empty_arr");
  const r3 = readback.find((r: any) => r.id === "test_nested");

  // A: text[] with values
  assert("A: text[] ['pool_admin','teacher']",
    Array.isArray(r1?.arr_col) && r1.arr_col[0] === "pool_admin" && r1.arr_col[1] === "teacher",
    `got: ${JSON.stringify(r1?.arr_col)}`
  );

  // B: empty text[] array
  assert("B: empty text[] []",
    Array.isArray(r2?.arr_col) && r2.arr_col.length === 0,
    `got: ${JSON.stringify(r2?.arr_col)}`
  );

  // C: NULL
  assert("C: NULL preserved",
    r1?.null_col === null,
    `got: ${r1?.null_col}`
  );

  // D: regular string
  assert("D: regular string 'plain'",
    r2?.str_col === "plain",
    `got: ${r2?.str_col}`
  );

  // E: single quote
  assert("E: string with single quote (O'Brien)",
    r1?.str_col?.includes("O'Brien"),
    `got: ${r1?.str_col}`
  );

  // F: comma in string
  assert("F: string with comma",
    r1?.str_col?.includes(","),
    `got: ${r1?.str_col}`
  );

  // G: JSON object
  assert("G: JSON object stored/retrieved",
    r1?.json_col !== null &&
    typeof r1?.json_col === "object" &&
    (r1?.json_col as any).a === 1 &&
    (r1?.json_col as any).b === "x",
    `got: ${JSON.stringify(r1?.json_col)}`
  );

  // G2: nested JSON object
  assert("G2: nested JSON object {nested:{x:true}}",
    r3?.json_col !== null &&
    typeof r3?.json_col === "object" &&
    (r3?.json_col as any).nested?.x === true,
    `got: ${JSON.stringify(r3?.json_col)}`
  );

  // H: boolean
  assert("H: boolean true",
    r1?.bool_col === true,
    `got: ${r1?.bool_col}`
  );

  // I: integer
  assert("I: integer 42",
    Number(r1?.int_col) === 42,
    `got: ${r1?.int_col}`
  );

  // J: timestamp
  const retrievedTs = r1?.ts_col ? new Date(r1.ts_col as string).getTime() : null;
  const expectedTs = tsDate.getTime();
  assert("J: timestamp roundtrip (±1000ms)",
    retrievedTs !== null && Math.abs(retrievedTs - expectedTs) < 1000,
    `got: ${r1?.ts_col}, expected: ${TS_ISO}`
  );

  // K: jsonb array ['cg_1','cg_2'] — A4 fix
  assert("K: jsonb array ['cg_1','cg_2'] (A4 fix)",
    Array.isArray(r1?.jsonarr_col) &&
    r1.jsonarr_col[0] === "cg_1" && r1.jsonarr_col[1] === "cg_2",
    `got: ${JSON.stringify(r1?.jsonarr_col)}`
  );

  // L: empty jsonb array []
  assert("L: empty jsonb array [] (A4 fix)",
    Array.isArray(r2?.jsonarr_col) && r2.jsonarr_col.length === 0,
    `got: ${JSON.stringify(r2?.jsonarr_col)}`
  );

  // ══════════════════════════════════════════════════
  //  TEST GROUP 2 — pool_credits lazy skip
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 2: pool_credits lazy skip ══");

  const lazyResult = await simulateLazySkip("pool_credits").catch((e: any) => ({ lazy_skip: false, err: e.message }));
  assert("pool_credits → LAZY_TABLE_NOT_CREATED graceful skip",
    (lazyResult as any).lazy_skip === true,
    `got: ${JSON.stringify(lazyResult)}`
  );

  // ══════════════════════════════════════════════════
  //  TEST GROUP 3 — non-lazy missing table → error
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 3: non-lazy missing table → BACKUP_SCHEMA_MISSING ══");

  const missingResult = await simulateBackupSchemaMissing("phase16e_nonexistent_xyz");
  assert("non-lazy missing table → BACKUP_SCHEMA_MISSING (not graceful skip)",
    missingResult === "BACKUP_SCHEMA_MISSING",
    `got: ${missingResult}`
  );

  // ══════════════════════════════════════════════════
  //  TEST GROUP 4 — identifier validation
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 4: Identifier validation ══");

  let invalidTableErr = "";
  try {
    await insertRowsParameterized("drop table users; --", [{ id: "x" }]);
  } catch (e: any) { invalidTableErr = e.message; }
  assert("Invalid table identifier rejected",
    invalidTableErr.includes("Invalid table identifier"),
    `got: ${invalidTableErr}`
  );

  let invalidColErr = "";
  try {
    await insertRowsParameterized(TABLE, [{ "bad-column-name": "y" }]);
  } catch (e: any) { invalidColErr = e.message; }
  assert("Invalid column identifier rejected",
    invalidColErr.includes("Invalid column identifier"),
    `got: ${invalidColErr}`
  );

  // ══════════════════════════════════════════════════
  //  TEST GROUP 5 — all-null row, jsonb null
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 5: null handling + jsonb ══");

  const nullRow: Record<string, unknown> = {
    id:          "test_nulls",
    arr_col:     null,
    null_col:    null,
    str_col:     null,
    json_col:    null,
    jsonarr_col: null,
    bool_col:    null,
    int_col:     null,
    ts_col:      null,
  };
  await insertRowsParameterized(TABLE, [nullRow], colTypes);
  const nullReadback = (await db!.execute(sql.raw(`SELECT * FROM "${TABLE}" WHERE id = 'test_nulls'`))).rows[0] as any;
  assert("All-null row: arr_col null",     nullReadback?.arr_col === null,     `got: ${nullReadback?.arr_col}`);
  assert("All-null row: json_col null",    nullReadback?.json_col === null,    `got: ${nullReadback?.json_col}`);
  assert("All-null row: jsonarr_col null", nullReadback?.jsonarr_col === null, `got: ${nullReadback?.jsonarr_col}`);
  assert("All-null row: bool_col null",    nullReadback?.bool_col === null,    `got: ${nullReadback?.bool_col}`);
  assert("All-null row: int_col null",     nullReadback?.int_col === null,     `got: ${nullReadback?.int_col}`);

  // ══════════════════════════════════════════════════
  //  TEST GROUP 6 — serializeForPg unit checks
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 6: serializeForPg unit checks ══");

  assert("serializeForPg(null) === null",            serializeForPg(null) === null);
  assert("serializeForPg(undefined) === null",       serializeForPg(undefined) === null);
  assert("serializeForPg(true) === true",            serializeForPg(true) === true);
  assert("serializeForPg(42) === 42",                serializeForPg(42) === 42);
  assert("serializeForPg('hello') === 'hello'",      serializeForPg("hello") === "hello");
  // text[] (no pgType): PG array literal
  assert("serializeForPg([]) → '{}'",               serializeForPg([]) === "{}");
  assert("serializeForPg(['a','b']) → '{\"a\",\"b\"}'",
    serializeForPg(["a", "b"]) === '{"a","b"}');
  assert("serializeForPg(['O\\'Brien']) passes through single quote",
    (serializeForPg(["O'Brien"]) as string).includes("O'Brien"));
  // jsonb: JSON array string
  assert("serializeForPg([], 'jsonb') → '[]'",
    serializeForPg([], "jsonb") === "[]");
  assert("serializeForPg(['cg_1','cg_2'], 'jsonb') → '[\"cg_1\",\"cg_2\"]'",
    serializeForPg(["cg_1", "cg_2"], "jsonb") === '["cg_1","cg_2"]');
  assert("serializeForPg(['월 15:00'], 'jsonb') → '[\"월 15:00\"]'",
    serializeForPg(["월 15:00"], "jsonb") === '["월 15:00"]');
  assert("serializeForPg({a:1}, 'jsonb') → '{\"a\":1}'",
    serializeForPg({ a: 1 }, "jsonb") === '{"a":1}');
  // Date
  assert("serializeForPg(Date) is ISO string",
    typeof serializeForPg(new Date("2026-01-01T00:00:00Z")) === "string" &&
    (serializeForPg(new Date("2026-01-01T00:00:00Z")) as string).startsWith("2026-01-01")
  );
  // non-array object
  assert("serializeForPg({a:1}) is JSON string",
    serializeForPg({ a: 1 }) === '{"a":1}');

  // ══════════════════════════════════════════════════
  //  TEST GROUP 7 — Student row structure (A4 real-world)
  // ══════════════════════════════════════════════════
  console.log("\n══ GROUP 7: Student row jsonb structure (A4 real-world) ══");

  const TABLE2 = "phase16e_student_tmp";
  await db!.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE2}"`));
  await db!.execute(sql.raw(`
    CREATE TABLE "${TABLE2}" (
      id                  text PRIMARY KEY,
      assigned_class_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
      class_schedule      jsonb NOT NULL DEFAULT '[]'::jsonb,
      status              text NOT NULL DEFAULT 'active'
    )
  `));
  const studentColTypes = new Map([
    ["id", "text"],
    ["assigned_class_ids", "jsonb"],
    ["class_schedule", "jsonb"],
    ["status", "text"],
  ]);

  // Case 1: empty jsonb arrays (most common)
  await insertRowsParameterized(TABLE2, [
    { id: "stu_empty", assigned_class_ids: [], class_schedule: [], status: "active" },
  ], studentColTypes);
  // Case 2: jsonb arrays with values
  await insertRowsParameterized(TABLE2, [
    { id: "stu_vals", assigned_class_ids: ["cg_x"], class_schedule: ["월 15:00"], status: "active" },
  ], studentColTypes);

  const stuRows = (await db!.execute(sql.raw(`SELECT * FROM "${TABLE2}" ORDER BY id`))).rows as any[];
  const stuEmpty = stuRows.find((r: any) => r.id === "stu_empty");
  const stuVals  = stuRows.find((r: any) => r.id === "stu_vals");

  assert("Student: assigned_class_ids=[] round-trip",
    Array.isArray(stuEmpty?.assigned_class_ids) && stuEmpty.assigned_class_ids.length === 0,
    `got: ${JSON.stringify(stuEmpty?.assigned_class_ids)}`
  );
  assert("Student: class_schedule=[] round-trip",
    Array.isArray(stuEmpty?.class_schedule) && stuEmpty.class_schedule.length === 0,
    `got: ${JSON.stringify(stuEmpty?.class_schedule)}`
  );
  assert("Student: assigned_class_ids=['cg_x'] round-trip",
    Array.isArray(stuVals?.assigned_class_ids) && stuVals.assigned_class_ids[0] === "cg_x",
    `got: ${JSON.stringify(stuVals?.assigned_class_ids)}`
  );
  assert("Student: class_schedule=['월 15:00'] round-trip",
    Array.isArray(stuVals?.class_schedule) && stuVals.class_schedule[0] === "월 15:00",
    `got: ${JSON.stringify(stuVals?.class_schedule)}`
  );

  await db!.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE2}"`));

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await db!.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`));
  console.log(`\nDropped temp tables: ${TABLE}, ${TABLE2}`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════════");
  console.log(`  RESULTS: ${pass} passed / ${fail} failed / ${pass + fail} total`);
  if (fail === 0) {
    console.log("  SERIALIZER_TEST_MATRIX ✅ ALL PASSED");
  } else {
    console.log("  SERIALIZER_TEST_MATRIX ❌ SOME FAILED");
    process.exit(1);
  }
  console.log("════════════════════════════════════════════\n");

  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
