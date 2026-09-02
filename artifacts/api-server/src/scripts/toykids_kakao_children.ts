import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

const POOL_ID = "pool_1780849364252_l9k44rbk3";

async function main() {
  const res = await superAdminDb.execute(sql`
    SELECT
      pa.id,
      LEFT(pa.name,1)||'*'||RIGHT(pa.name,1) AS name_masked,
      SUBSTRING(pa.phone,1,3)||'-****-'||RIGHT(pa.phone,4) AS phone_masked,
      CASE WHEN pa.login_id IS NOT NULL THEN 'Y' ELSE 'N' END AS has_login_id,
      CASE WHEN pa.pin_hash IS NOT NULL THEN 'Y' ELSE 'N' END AS has_pin,
      COUNT(ps.id) FILTER (WHERE ps.status='approved') AS approved_children,
      COUNT(ps.id) FILTER (WHERE ps.status='pending') AS pending_children,
      COUNT(ps.id) AS total_links
    FROM parent_accounts pa
    LEFT JOIN parent_students ps ON ps.parent_id = pa.id
    WHERE pa.swimming_pool_id = ${POOL_ID}
      AND pa.kakao_id IS NOT NULL
    GROUP BY pa.id, pa.name, pa.phone, pa.login_id, pa.pin_hash
    ORDER BY pa.created_at
  `);
  console.log("=== Kakao-linked parents child data ===");
  for (const r of res.rows as any[]) {
    console.log(`id=${r.id} name=${r.name_masked} phone=${r.phone_masked} login_id=${r.has_login_id} pin=${r.has_pin} approved=${r.approved_children} pending=${r.pending_children} total=${r.total_links}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
