/**
 * gr-admin-review-columns.ts
 *
 * Additive migration: growth_reports 테이블에 관리자 검수 메타데이터 컬럼 추가
 *
 * admin_reviewed_at  — 관리자가 리포트 상세를 열람한 시각 (idempotent, 최초 1회만 기록)
 * admin_reviewed_by  — 열람한 관리자 userId
 *
 * 기존 teacher_reviewed_at/teacher_reviewed_by는 AI 생성 후 선생님 검토용으로
 * 별도 의미를 가지므로 재사용하지 않는다.
 *
 * 멱등 가능: IF NOT EXISTS 사용으로 재실행 안전.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runMigration(db = superAdminDb) {
  console.log("[gr-admin-review] migration 시작…");

  await db.execute(sql`
    ALTER TABLE growth_reports
      ADD COLUMN IF NOT EXISTS admin_reviewed_at  TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS admin_reviewed_by  TEXT        NULL
  `);

  console.log("[gr-admin-review] ✅ admin_reviewed_at, admin_reviewed_by 컬럼 추가 완료");
}

// 직접 실행 시
if (process.argv[1] && process.argv[1].endsWith("gr-admin-review-columns.ts")) {
  void runMigration().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
