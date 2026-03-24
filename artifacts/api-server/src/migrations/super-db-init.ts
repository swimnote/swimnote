/**
 * super-db-init.ts — super DB 컬럼 보완 DDL
 *
 * users 테이블에 schema에 없지만 routes에서 사용하는 컬럼 추가
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function initSuperDb(): Promise<void> {
  const db = superAdminDb;

  // users 테이블 — 누락 컬럼 보완
  await db.execute(sql.raw(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS position text;
  `)).catch((e: any) => console.warn("[super-db-init] users.position 추가 건너뜀:", e.message));

  // swimming_pools 테이블 — 영상 저장 제한 (T005)
  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS video_storage_limit_mb integer DEFAULT 0;
  `)).catch((e: any) => console.warn("[super-db-init] swimming_pools.video_storage_limit_mb 추가 건너뜀:", e.message));

  console.log("[super-db-init] super DB 컬럼 보완 완료");
}
