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

  // swimming_pools 테이블 — 구독 소스 (manual | revenuecat | free_default)
  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS subscription_source text;
  `)).catch((e: any) => console.warn("[super-db-init] swimming_pools.subscription_source 추가 건너뜀:", e.message));

  // swimming_pools 테이블 — 구독 구조 단순화 (구독 플랜명/용량/관리자 FK)
  for (const stmt of [
    // 구독 플랜 표시명/용량 필드
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS subscription_plan_name text`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS storage_mb integer NOT NULL DEFAULT 512`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS display_storage text NOT NULL DEFAULT '500MB'`,
    // 관리자 사용자 ID (users.id FK) — pools-summary 직접 JOIN용
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS admin_user_id text`,
  ]) {
    await db.execute(sql.raw(stmt))
      .catch((e: any) => console.warn(`[super-db-init] swimming_pools 컬럼 추가 건너뜀: ${e.message}`));
  }

  // admin_user_id 역방향 backfill — users.swimming_pool_id 기준으로 채우기
  await db.execute(sql.raw(`
    UPDATE swimming_pools p
    SET admin_user_id = (
      SELECT id FROM users u
      WHERE u.swimming_pool_id = p.id AND u.role IN ('pool_admin','super_admin')
      ORDER BY u.created_at ASC
      LIMIT 1
    )
    WHERE p.admin_user_id IS NULL
  `)).catch((e: any) => console.warn("[super-db-init] admin_user_id backfill 건너뜀:", e.message));
  console.log("[super-db-init] swimming_pools 구독 플랜/관리자 FK 컬럼 보완 완료");

  // super_admin 계정 확보 — username='1111' 계정을 super_admin으로 승격
  // (해당 계정이 없으면 skip, 이미 super_admin이면 skip)
  await db.execute(sql.raw(`
    UPDATE users SET role = 'super_admin'
    WHERE (username = '1111' OR phone = '1111')
      AND role != 'super_admin'
  `)).catch(() => {});
  console.log("[super-db-init] super_admin 계정 확보 완료 (username=1111)");

  // swimming_pools 테이블 — 수영정보 5개 콘텐츠 컬럼
  for (const col of ["introduction", "tuition_info", "level_test_info", "event_info", "equipment_info"]) {
    await db.execute(sql.raw(`ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS ${col} text;`))
      .catch((e: any) => console.warn(`[super-db-init] swimming_pools.${col} 추가 건너뜀:`, e.message));
  }
  console.log("[super-db-init] swimming_pools 수영정보 컬럼 보완 완료");

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

  // ── parent_accounts — Apple/Kakao 소셜 로그인 컬럼 보완 ──────────────────
  try {
    // apple_id: Apple Sign In 고유 식별자
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS apple_id VARCHAR;`)).catch(() => {});
    // kakao_id / kakao_profile_image: 카카오 소셜 로그인
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS kakao_id text;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS kakao_profile_image text;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS nickname text;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS gender text;`)).catch(() => {});
    // swimming_pool_id: Apple Sign In 신규 계정은 수영장 연결 대기 상태 (NULL 허용)
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ALTER COLUMN swimming_pool_id DROP NOT NULL;`)).catch(() => {});
    // phone: Apple Sign In 신규 계정은 전화번호 없음 (NULL 허용)
    await db.execute(sql.raw(`ALTER TABLE parent_accounts ALTER COLUMN phone DROP NOT NULL;`)).catch(() => {});
    console.log("[super-db-init] parent_accounts 소셜 로그인 컬럼 보완 완료");
  } catch (e: any) {
    console.warn("[super-db-init] parent_accounts 보완 오류:", e.message);
  }

  // ── payment_logs — 결제 내역 ───────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS payment_logs (
        id                   text        PRIMARY KEY,
        swimming_pool_id     text        NOT NULL,
        amount               integer     NOT NULL DEFAULT 0,
        status               text        NOT NULL,
        method               text,
        type                 text,
        description          text,
        billing_period_start text,
        billing_period_end   text,
        paid_at              timestamptz,
        created_at           timestamptz NOT NULL DEFAULT now()
      );
    `));
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS type text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS method text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS description text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS billing_period_start text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS billing_period_end text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE payment_logs ADD COLUMN IF NOT EXISTS paid_at timestamptz`)).catch(() => {});
    console.log("[super-db-init] payment_logs 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] payment_logs 오류:", e.message);
  }

  // ── revenue_logs — 수익 기록 ───────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS revenue_logs (
        id                    text        PRIMARY KEY,
        pool_id               text        NOT NULL,
        pool_name             text,
        plan_id               text,
        plan_name             text,
        event_type            text,
        gross_amount          integer     NOT NULL DEFAULT 0,
        intro_discount_amount integer     NOT NULL DEFAULT 0,
        charged_amount        integer     NOT NULL DEFAULT 0,
        store_fee             integer     NOT NULL DEFAULT 0,
        net_revenue           integer     NOT NULL DEFAULT 0,
        payment_provider      text,
        occurred_at           timestamptz,
        created_at            timestamptz NOT NULL DEFAULT now()
      );
    `));
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS store_fee integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS payment_provider text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS occurred_at timestamptz`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS gross_amount integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS intro_discount_amount integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS charged_amount integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS net_revenue integer NOT NULL DEFAULT 0`)).catch(() => {});
    console.log("[super-db-init] revenue_logs 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] revenue_logs 오류:", e.message);
  }

  // parent_content_reads — 학부모 사진/일지 읽음 시점 추적
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS parent_content_reads (
        id           text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        parent_id    text        NOT NULL,
        student_id   text        NOT NULL,
        content_type text        NOT NULL,
        last_read_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (parent_id, student_id, content_type)
      )
    `));
    console.log("[super-db-init] parent_content_reads 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] parent_content_reads 오류:", e.message);
  }

  // parent_accounts — is_active 컬럼 + swimming_pool_id nullable 보완
  // (pool-db-init 실패 시 백업으로 여기서도 실행)
  await db.execute(sql.raw(`ALTER TABLE parent_accounts ALTER COLUMN swimming_pool_id DROP NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE parent_accounts ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`)).catch(() => {});

  // platform_banners — 슈퍼관리자 전용 플랫폼 광고 배너
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS platform_banners (
        id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        banner_type   text        NOT NULL DEFAULT 'slider',
        title         text        NOT NULL,
        description   text,
        image_url     text,
        image_key     text,
        link_url      text,
        link_label    text,
        color_theme   text        NOT NULL DEFAULT 'teal',
        target        text        NOT NULL DEFAULT 'all',
        status        text        NOT NULL DEFAULT 'inactive',
        display_start timestamptz NOT NULL DEFAULT now(),
        display_end   timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
        sort_order    integer     NOT NULL DEFAULT 0,
        created_by    text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `));
    // 컬럼 추가 (기존 테이블에 누락된 컬럼 보완)
    await db.execute(sql.raw(`ALTER TABLE platform_banners ADD COLUMN IF NOT EXISTS banner_type text NOT NULL DEFAULT 'slider'`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE platform_banners ADD COLUMN IF NOT EXISTS image_key text`)).catch(() => {});
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS platform_banners_status_idx ON platform_banners (status, display_start, display_end);
    `)).catch(() => {});
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS platform_banners_type_idx ON platform_banners (banner_type, status);
    `)).catch(() => {});
    console.log("[super-db-init] platform_banners 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] platform_banners 오류:", e.message);
  }

  // ── diary_messages — 학부모↔선생님 쪽지 ────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS diary_messages (
        id          text        PRIMARY KEY DEFAULT ('dm_' || gen_random_uuid()::text),
        diary_id    text        NOT NULL,
        sender_id   text        NOT NULL,
        sender_name text        NOT NULL,
        sender_role text        NOT NULL CHECK (sender_role IN ('parent', 'teacher', 'pool_admin')),
        content     text        NOT NULL,
        is_deleted  boolean     NOT NULL DEFAULT false,
        deleted_at  timestamptz,
        read_at     timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS diary_messages_diary_idx ON diary_messages (diary_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS diary_messages_sender_idx ON diary_messages (sender_id, created_at DESC);
    `)).catch(() => {});
    // 기존 테이블에 누락 컬럼 보완
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS read_at timestamptz`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS image_url text`)).catch(() => {});
    console.log("[super-db-init] diary_messages 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] diary_messages 오류:", e.message);
  }

  // ── diary_reactions — 학부모 일지 반응(좋아요/감사) ─────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS diary_reactions (
        id            text        PRIMARY KEY DEFAULT ('dr_' || gen_random_uuid()::text),
        diary_id      text        NOT NULL,
        parent_id     text        NOT NULL,
        reaction_type text        NOT NULL CHECK (reaction_type IN ('like', 'thanks')),
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (diary_id, parent_id, reaction_type)
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS diary_reactions_diary_idx ON diary_reactions (diary_id);
    `)).catch(() => {});
    console.log("[super-db-init] diary_reactions 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] diary_reactions 오류:", e.message);
  }

  // ── monthly_settlements — 선생님 월별 정산 ────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS monthly_settlements (
        id                          text        PRIMARY KEY,
        pool_id                     text        NOT NULL,
        teacher_user_id             text        NOT NULL,
        teacher_name                text        NOT NULL DEFAULT '',
        settlement_month            text        NOT NULL,
        total_revenue               integer     NOT NULL DEFAULT 0,
        total_sessions              integer     NOT NULL DEFAULT 0,
        total_makeup_sessions       integer     NOT NULL DEFAULT 0,
        total_trial_sessions        integer     NOT NULL DEFAULT 0,
        total_temp_transfer_sessions integer   NOT NULL DEFAULT 0,
        extra_manual_amount         integer     NOT NULL DEFAULT 0,
        extra_manual_memo           text,
        student_details             jsonb       NOT NULL DEFAULT '[]',
        status                      text        NOT NULL DEFAULT 'draft',
        withdrawn_count             integer     NOT NULL DEFAULT 0,
        postpone_count              integer     NOT NULL DEFAULT 0,
        updated_at                  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (pool_id, teacher_user_id, settlement_month)
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS monthly_settlements_pool_idx ON monthly_settlements (pool_id, settlement_month DESC);
    `)).catch(() => {});
    // 기존 테이블에 누락 컬럼 보완
    await db.execute(sql.raw(`ALTER TABLE monthly_settlements ADD COLUMN IF NOT EXISTS total_temp_transfer_sessions integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE monthly_settlements ADD COLUMN IF NOT EXISTS withdrawn_count integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE monthly_settlements ADD COLUMN IF NOT EXISTS postpone_count integer NOT NULL DEFAULT 0`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE monthly_settlements ADD COLUMN IF NOT EXISTS teacher_name text NOT NULL DEFAULT ''`)).catch(() => {});
    console.log("[super-db-init] monthly_settlements 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] monthly_settlements 오류:", e.message);
  }

  console.log("[super-db-init] super DB 컬럼 보완 + backup_logs/restore_logs 초기화 완료");
}
