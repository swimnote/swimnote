/**
 * notifications-actor-id migration
 *
 * notifications 테이블에 actor_id 컬럼과 인덱스를 추가합니다.
 *
 * 목적:
 *   LIKE 알림 발생자(parent_id)를 notifications row에 기록하여
 *   UNLIKE 시 해당 parent의 알림만 정확하게 삭제할 수 있게 합니다.
 *
 *   삭제 key: actor_id + type ('diary_like' | 'growth_report_like') + ref_id
 *
 * 적용 시점:
 *   2026-09-14 — Production DB에 직접 ALTER로 먼저 적용됨.
 *   이 파일은 새 환경 / 복구 / 향후 migration에서의 영속화용입니다.
 *
 * 멱등성:
 *   ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS → 안전하게 재실행 가능.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runNotificationsActorIdMigration(): Promise<void> {
  // 1. actor_id 컬럼 추가 (nullable — 기존 rows에 영향 없음)
  await superAdminDb.execute(sql`
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id TEXT
  `);

  // 2. UNLIKE 삭제용 인덱스 (actor_id + type + ref_id)
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_notifications_actor_type_ref
      ON notifications (actor_id, type, ref_id)
  `);
}
