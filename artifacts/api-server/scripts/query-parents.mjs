import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env manually
const envPath = join(dirname(fileURLToPath(import.meta.url)), "../.env");
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { default: postgres } = await import("postgres");
const sql = postgres(process.env.SUPABASE_DATABASE_URL, { ssl: "require" });

const rows = await sql`
  SELECT pa.id, pa.name, pa.phone, pa.swimming_pool_id, pa.created_at,
         pvp.child_name_raw, pvp.status AS pstatus
  FROM parent_accounts pa
  LEFT JOIN parent_v2_pending pvp ON pvp.parent_id = pa.id
  WHERE pa.name IN ('서정주','문희택')
`;
console.log("=PARENTS=", JSON.stringify(rows));

const pool = await sql`
  SELECT pa.id, pa.name, pa.swimming_pool_id, pvp.child_name_raw, pvp.status,
         (SELECT count(*)::int FROM parent_students ps WHERE ps.parent_id=pa.id) sc
  FROM parent_accounts pa
  LEFT JOIN parent_v2_pending pvp ON pvp.parent_id = pa.id
  WHERE pa.swimming_pool_id = 'pool_1784865333802_mi7k4fsa4'
  ORDER BY pa.created_at DESC LIMIT 30
`;
console.log("=POOL=", JSON.stringify(pool));

const stus = await sql`
  SELECT s.id, s.name, s.status, s.parent_user_id, cg.name as cls
  FROM students s LEFT JOIN class_groups cg ON cg.id=s.class_group_id
  WHERE s.swimming_pool_id='pool_1784865333802_mi7k4fsa4' AND s.deleted_at IS NULL
  ORDER BY s.name
`;
console.log("=STUDENTS=", JSON.stringify(stus));

await sql.end();
