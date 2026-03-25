/**
 * roles-backfill.ts — pool_admin 계정 roles 배열 자동 보완 마이그레이션
 *
 * 목적: 기존 pool_admin 계정 중 roles 배열에 "teacher"가 없는 경우 자동 추가
 * - 신규 가입: auth.ts /register에서 이미 처리
 * - 기존 계정: 이 마이그레이션으로 1회 보완
 * - 멱등(idempotent): 이미 "teacher"가 있으면 변경하지 않음
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function backfillPoolAdminRoles(): Promise<void> {
  try {
    const result = await superAdminDb.execute(sql`
      UPDATE users
      SET roles = CASE
        WHEN roles IS NULL OR array_length(roles, 1) = 0 OR roles = '{}'::TEXT[]
          THEN ARRAY['pool_admin', 'teacher']::TEXT[]
        WHEN NOT ('teacher' = ANY(roles))
          THEN array_append(roles, 'teacher')
        ELSE roles
      END
      WHERE role::TEXT = 'pool_admin'
        AND (
          roles IS NULL
          OR roles = '{}'::TEXT[]
          OR array_length(roles, 1) = 0
          OR NOT ('teacher' = ANY(roles))
        )
      RETURNING id
    `);
    const updated = result.rows.length;
    if (updated > 0) {
      console.log(`[roles-backfill] pool_admin ${updated}개 계정에 teacher 역할 자동 추가 완료`);
    } else {
      console.log("[roles-backfill] 보완 필요한 계정 없음 (이미 정상)");
    }
  } catch (e: any) {
    // 컬럼 타입 불일치 등 환경 차이로 인한 오류는 무시 (서버 기동 차단 방지)
    console.warn("[roles-backfill] 마이그레이션 경고:", e?.message || e);
  }
}
