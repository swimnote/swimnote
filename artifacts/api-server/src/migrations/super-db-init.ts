/**
 * super-db-init.ts — super DB 컬럼 보완 DDL
 *
 * users 테이블에 schema에 없지만 routes에서 사용하는 컬럼 추가
 * backup_logs 테이블 생성 (백업 상태 기록 시스템)
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

  // subscription_status enum — 결제실패/삭제대기/삭제 값 보완
  for (const val of ["payment_failed", "pending_deletion", "deleted"]) {
    await db.execute(sql.raw(`ALTER TYPE subscription_status ADD VALUE IF NOT EXISTS '${val}'`))
      .catch(() => {}); // 이미 존재하면 무시
  }

  // backup_logs 테이블 — 백업 상태 기록 시스템
  // target: 'pool' (pool 백업 DB) | 'super_protect' (보호백업 DB)
  // status: 'pending' | 'running' | 'success' | 'failed'
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS backup_logs (
        id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        target          text        NOT NULL CHECK (target IN ('pool', 'super_protect')),
        status          text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'running', 'success', 'failed')),
        backup_type     text        NOT NULL DEFAULT 'manual'
                                    CHECK (backup_type IN ('manual', 'auto')),
        started_at      timestamptz NOT NULL DEFAULT now(),
        finished_at     timestamptz,
        last_success_at timestamptz,
        error_message   text,
        size_bytes      bigint,
        row_count       integer,
        tables_count    integer,
        created_by      text        NOT NULL DEFAULT 'system',
        note            text
      );
    `));
    // backup_logs 인덱스
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS backup_logs_target_idx ON backup_logs (target, started_at DESC);
      CREATE INDEX IF NOT EXISTS backup_logs_status_idx ON backup_logs (status, started_at DESC);
    `)).catch(() => {});
    console.log("[super-db-init] backup_logs 테이블 생성/확인 완료");
  } catch (e: any) {
    console.error("[super-db-init] ❌ backup_logs 생성 실패:", e.message);
    // 실패해도 서버 기동은 계속 (backup-status API에서 오류로 표시됨)
  }

  console.log("[super-db-init] super DB 컬럼 보완 + backup_logs 초기화 완료");
}
