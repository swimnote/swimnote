/**
 * wp-500pool-curriculum-scale.ts
 *
 * 500 Pool Curriculum Scale Architecture 마이그레이션 (additive only)
 *
 * 변경 내용:
 *   1. curriculum_versions.source_content_hash TEXT — import idempotency
 *   2. curriculum_versions.import_status TEXT — DRAFT/VALIDATED/ACTIVE (이미 존재하면 skip)
 *   3. curriculum_versions.is_global_reference BOOLEAN — (이미 존재하면 skip)
 *   4. INDEX idx_curriculum_versions_global_ref — Global Reference 검색 최적화
 *   5. INDEX idx_curriculum_versions_local_active — Local active version 검색 최적화
 *   6. x_curriculum_profiles status enum 확장 — ACTIVATED 추가
 *
 * 실행 방식: additive (DROP 없음, 기존 데이터 보존)
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export async function run500PoolCurriculumScaleMigration(
  db: NodePgDatabase<any>,
): Promise<void> {
  console.log("[500pool-curriculum-scale] 마이그레이션 시작...");

  // 1. curriculum_versions.source_content_hash 컬럼 추가
  await db.execute(sql`
    ALTER TABLE curriculum_versions
      ADD COLUMN IF NOT EXISTS source_content_hash TEXT
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 2. curriculum_versions.import_status 컬럼 추가 (이미 존재하면 skip)
  await db.execute(sql`
    ALTER TABLE curriculum_versions
      ADD COLUMN IF NOT EXISTS import_status TEXT DEFAULT 'DRAFT'
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 3. curriculum_versions.is_global_reference 컬럼 추가 (이미 존재하면 skip)
  await db.execute(sql`
    ALTER TABLE curriculum_versions
      ADD COLUMN IF NOT EXISTS is_global_reference BOOLEAN NOT NULL DEFAULT false
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 4. archived_at 컬럼 추가 (이미 존재하면 skip)
  await db.execute(sql`
    ALTER TABLE curriculum_versions
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 5. INDEX: Global Reference 검색 최적화
  //    getGlobalReferenceItems(): is_global_reference=true AND import_status='ACTIVE'
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_curriculum_versions_global_ref
      ON curriculum_versions (import_status)
      WHERE is_global_reference = true
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 6. INDEX: Local active version 검색 최적화
  //    getPoolActiveLocalVersion(): swimming_pool_id + is_active + import_status + is_global_reference=false
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_curriculum_versions_local_active
      ON curriculum_versions (swimming_pool_id, is_active)
      WHERE is_global_reference = false AND is_active = true
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 7. INDEX: content_hash 기반 idempotency 검색
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_curriculum_versions_content_hash
      ON curriculum_versions (swimming_pool_id, source_content_hash)
      WHERE is_global_reference = false AND source_content_hash IS NOT NULL
  `).catch((e: any) => {
    if (!e?.message?.includes("already exists")) throw e;
  });

  // 8. x_curriculum_profiles status 'ACTIVATED' 값 지원
  //    TEXT 컬럼이므로 별도 enum 수정 불필요 (CHECK constraint가 있으면 아래 추가)
  //    현재 CHECK constraint 없으면 자동 허용
  await db.execute(sql`
    DO $$
    BEGIN
      -- status 컬럼이 VARCHAR/TEXT면 ACTIVATED는 자동 허용 (enum 아님)
      -- 기존 CHECK constraint 있으면 DROP하고 재생성
      IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'x_curriculum_profiles'
          AND constraint_type = 'CHECK'
          AND constraint_name LIKE '%status%'
      ) THEN
        -- CHECK constraint 이름 확인 후 재설정은 제품별 운영자 수동 처리
        -- 자동 DROP은 위험 — 여기서는 경고만 출력
        RAISE NOTICE 'x_curriculum_profiles.status에 CHECK constraint가 있습니다. ACTIVATED 값 추가 필요 시 수동 처리하세요.';
      END IF;
    END;
    $$
  `).catch(() => { /* PL/pgSQL 미지원 환경 무시 */ });

  console.log("[500pool-curriculum-scale] 마이그레이션 완료");
}
