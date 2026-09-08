/**
 * onboarding-state-table.ts — user_onboarding_state 신규 테이블 마이그레이션
 *
 * user_kind: 'user' | 'parent'  (id collision 방지)
 * UNIQUE: (user_id, user_kind, onboarding_key)
 *
 * 기존 데이터 영향 0.
 */

import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";

export async function runOnboardingStateMigration(): Promise<void> {
  console.log("[migration] user_onboarding_state 테이블 마이그레이션 시작...");

  await superAdminDb.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS user_onboarding_state (
      id                 BIGSERIAL PRIMARY KEY,
      user_id            TEXT        NOT NULL,
      user_kind          TEXT        NOT NULL CHECK (user_kind IN ('user', 'parent')),
      onboarding_key     TEXT        NOT NULL,
      completed_version  INTEGER     NOT NULL DEFAULT 1,
      completed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_user_onboarding_state
        UNIQUE (user_id, user_kind, onboarding_key)
    )
  `));

  await superAdminDb.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_onboarding_state_user
      ON user_onboarding_state (user_id, user_kind)
  `));

  console.log("[migration] user_onboarding_state 완료.");
}

// 직접 실행 시
if (process.argv[1]?.includes("onboarding-state-table")) {
  runOnboardingStateMigration()
    .then(() => { console.log("Done."); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
