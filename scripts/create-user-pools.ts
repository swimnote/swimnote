import { superAdminDb } from "../lib/db/src/index.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("super DB에 user_pools 테이블 생성 중...");

  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS user_pools (
      id          TEXT        PRIMARY KEY,
      user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pool_id     TEXT        NOT NULL REFERENCES swimming_pools(id) ON DELETE CASCADE,
      role        TEXT        NOT NULL DEFAULT 'pool_admin',
      is_primary  BOOLEAN     NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, pool_id)
    )
  `);

  console.log("user_pools 생성 완료!");

  // 인덱스 추가
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_user_pools_user_id ON user_pools(user_id)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_user_pools_pool_id ON user_pools(pool_id)
  `);
  console.log("인덱스 생성 완료");

  // 확인
  const r = await superAdminDb.execute(sql`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='user_pools'
  `);
  console.log("확인:", r.rows.length > 0 ? "user_pools 존재함 ✓" : "생성 실패!");
  process.exit(0);
}

main().catch((e) => { console.error("오류:", e.message); process.exit(1); });
