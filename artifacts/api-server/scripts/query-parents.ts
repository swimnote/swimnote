import { config } from "dotenv";
config({ path: new URL("../.env", import.meta.url).pathname });

import postgres from "postgres";
import jwt from "jsonwebtoken";

const db = postgres(process.env.SUPABASE_DATABASE_URL!, { ssl: "require" });

// 서정주·문희택 보호자 조회
const parents = await db`
  SELECT pa.id, pa.name, pa.phone, pa.swimming_pool_id, pa.created_at,
         pvp.child_name_raw, pvp.status AS pstatus, pvp.pool_id AS ppoolid
  FROM parent_accounts pa
  LEFT JOIN parent_v2_pending pvp ON pvp.parent_id = pa.id
  WHERE pa.name IN ('서정주','문희택')
`;
console.log("=PARENTS=", JSON.stringify(parents, null, 2));

// swimnote pool 전체 보호자
const poolParents = await db`
  SELECT pa.id, pa.name, pa.swimming_pool_id, pvp.child_name_raw, pvp.status,
         (SELECT count(*)::int FROM parent_students ps WHERE ps.parent_id=pa.id) sc
  FROM parent_accounts pa
  LEFT JOIN parent_v2_pending pvp ON pvp.parent_id = pa.id
  WHERE pa.swimming_pool_id = 'pool_1784865333802_mi7k4fsa4'
  ORDER BY pa.created_at DESC LIMIT 30
`;
console.log("=POOL_PARENTS=", JSON.stringify(poolParents));

// swimnote pool 학생
const students = await db`
  SELECT s.id, s.name, s.status, s.parent_user_id, cg.name as cls
  FROM students s LEFT JOIN class_groups cg ON cg.id=s.class_group_id
  WHERE s.swimming_pool_id='pool_1784865333802_mi7k4fsa4' AND s.deleted_at IS NULL
  ORDER BY s.name
`;
console.log("=STUDENTS=", JSON.stringify(students));

// JWT 토큰 생성 (pool_admin)
const tok = jwt.sign(
  { userId: "user_1784865333802_kchge1xsc", role: "pool_admin", poolId: "pool_1784865333802_mi7k4fsa4", tv: 1 },
  process.env.JWT_SECRET!,
  { expiresIn: "12h" }
);
console.log("=TOKEN=", tok);

await db.end();
