/**
 * super-admin-notifications migration
 *
 * super_admin_notifications 테이블 — 슈퍼 어드민 전용 알림 저장소.
 *
 * 5종 이벤트:
 *   POOL_SIGNUP          — 수영장 신규 가입
 *   INQUIRY_RECEIVED     — 문의사항 접수 (target='super')
 *   X_TRIAL_STARTED      — X 무료체험 시작
 *   PAID_PLAN_ACTIVATED  — 유료 플랜 가입/결제 성공 (INITIAL_PURCHASE 확정 후)
 *   CURRICULUM_UPLOADED  — 커리큘럼 파일 업로드
 *
 * 중복 방지: idempotency_key UNIQUE INDEX
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runSuperAdminNotificationsMigration(): Promise<void> {
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS super_admin_notifications (
      id               TEXT        PRIMARY KEY,
      type             TEXT        NOT NULL,   -- POOL_SIGNUP | INQUIRY_RECEIVED | X_TRIAL_STARTED | PAID_PLAN_ACTIVATED | CURRICULUM_UPLOADED
      title            TEXT        NOT NULL,
      body             TEXT        NOT NULL DEFAULT '',
      pool_id          TEXT,
      ref_id           TEXT,                   -- inquiry id / pool id / event id 등 연관 식별자
      ref_type         TEXT,                   -- 'pool' | 'inquiry' | 'curriculum'
      is_read          BOOLEAN     NOT NULL DEFAULT FALSE,
      idempotency_key  TEXT,                   -- 중복 방지 (UNIQUE 아래)
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_super_admin_notif_created
      ON super_admin_notifications (created_at DESC)
  `);
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_super_admin_notif_is_read
      ON super_admin_notifications (is_read)
    WHERE is_read = FALSE
  `);
  await superAdminDb.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_super_admin_notif_idempotency
      ON super_admin_notifications (idempotency_key)
    WHERE idempotency_key IS NOT NULL
  `);
}
