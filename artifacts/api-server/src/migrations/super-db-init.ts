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

  // restore_logs 테이블 — 복구 실행 이력
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS restore_logs (
        id              text        PRIMARY KEY,
        restore_type    text        NOT NULL CHECK (restore_type IN ('full', 'pool')),
        pool_id         text,
        backup_id       text        NOT NULL,
        restore_point   timestamptz NOT NULL,
        pre_backup_id   text,
        status          text        NOT NULL DEFAULT 'running'
                                    CHECK (status IN ('running', 'success', 'failed')),
        started_at      timestamptz NOT NULL DEFAULT now(),
        finished_at     timestamptz,
        error_message   text,
        triggered_by    text        NOT NULL DEFAULT 'system'
      );
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS restore_logs_type_idx   ON restore_logs (restore_type, started_at DESC);
      CREATE INDEX IF NOT EXISTS restore_logs_pool_idx   ON restore_logs (pool_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS restore_logs_status_idx ON restore_logs (status, started_at DESC);
    `)).catch(() => {});

    // warning 컬럼 추가 (기존 테이블에도 적용)
    await db.execute(sql.raw(`
      ALTER TABLE restore_logs ADD COLUMN IF NOT EXISTS warning_count   integer NOT NULL DEFAULT 0;
      ALTER TABLE restore_logs ADD COLUMN IF NOT EXISTS warning_details jsonb;
    `)).catch((e: any) => console.warn("[super-db-init] restore_logs warning 컬럼 추가 건너뜀:", e.message));

    console.log("[super-db-init] restore_logs 테이블 생성/확인 완료");
  } catch (e: any) {
    console.error("[super-db-init] ❌ restore_logs 생성 실패:", e.message);
  }

  // ── phone_verifications — SMS 인증 테이블 보완 ─────────────────────────────
  // 기존: id, phone, code, purpose, ref_id, expires_at, is_used, created_at
  // 추가: code_hash, attempt_count, request_ip, verified_at
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS phone_verifications (
        id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        phone         text        NOT NULL,
        code          text        NOT NULL DEFAULT '',
        code_hash     text,
        purpose       text        NOT NULL,
        ref_id        text,
        expires_at    timestamptz NOT NULL,
        is_used       boolean     NOT NULL DEFAULT false,
        attempt_count integer     NOT NULL DEFAULT 0,
        request_ip    text,
        verified_at   timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS pv_phone_purpose_idx ON phone_verifications (phone, purpose, created_at DESC);
      CREATE INDEX IF NOT EXISTS pv_phone_used_idx    ON phone_verifications (phone, purpose, is_used);
    `));
    await db.execute(sql.raw(`
      ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS code_hash     text;
      ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
      ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS request_ip    text;
      ALTER TABLE phone_verifications ADD COLUMN IF NOT EXISTS verified_at   timestamptz;
    `)).catch(() => {});
    console.log("[super-db-init] phone_verifications 테이블 보완 완료");
  } catch (e: any) {
    console.warn("[super-db-init] phone_verifications 보완 오류:", e.message);
  }

  console.log("[super-db-init] super DB 컬럼 보완 + backup_logs/restore_logs 초기화 완료");
}
