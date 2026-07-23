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
  // swimming_pools 테이블 — 수영장 홈페이지 컬럼
  await db.execute(sql.raw(`ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS homepage_slug text;`))
    .catch((e: any) => console.warn("[super-db-init] swimming_pools.homepage_slug 추가 건너뜀:", e.message));
  await db.execute(sql.raw(`ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS homepage_enabled boolean NOT NULL DEFAULT false;`))
    .catch((e: any) => console.warn("[super-db-init] swimming_pools.homepage_enabled 추가 건너뜀:", e.message));
  await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_swimming_pools_homepage_slug ON swimming_pools(homepage_slug) WHERE homepage_slug IS NOT NULL;`))
    .catch(() => {});
  // 홈페이지 샘플 데이터 — 토이키즈스윔클럽 (슬러그 미설정 풀에만 적용)
  try {
    const seedResult = await db.execute(sql.raw(`
      UPDATE swimming_pools SET
        homepage_slug    = '토이키즈스윔클럽',
        homepage_enabled = TRUE,
        introduction     = E'토이키즈스윔클럽은 아이들의 행복한 수영 경험을 위해 설립된 전문 수영 교육 센터입니다.\n\n경력 10년 이상의 전문 코치진이 아이 한 명 한 명에게 맞춤형 수업을 제공하며, 안전하고 즐거운 환경에서 수영의 기초부터 고급 기술까지 체계적으로 가르칩니다.\n\n🏊 소규모 클래스 운영 (레인당 최대 6명)\n🎯 레벨별 맞춤 커리큘럼\n🏅 대회 참가 지원 프로그램',
        tuition_info     = E'✅ 수강료 안내 (월 기준)\n\n• 유아반 (5~7세): 월 100,000원\n• 초등 기초반: 월 120,000원\n• 초등 심화반: 월 140,000원\n• 중·고등 일반반: 월 150,000원\n\n📌 형제 할인 10% 적용\n📌 3개월 선납 시 5% 추가 할인',
        level_test_info  = E'🎯 레벨 테스트 안내\n\n수강 등록 전 레벨 테스트를 통해 적합한 반을 배정합니다.\n\n• 유아반: 물 적응도 확인 (보호자 동반)\n• 초등 기초: 25m 자유형 완영 여부\n• 초등 심화: 4영법 50m 이상 완영\n• 중·고등: 영법별 기술 평가\n\n📅 레벨 테스트는 매월 첫째 주 토요일 오전 10시\n📞 사전 예약 필수',
        event_info       = E'🎉 현재 진행 중인 이벤트\n\n🌟 신규 등록 이벤트\n3월 신규 등록 시 첫 달 수강료 20% 할인\n(선착순 20명 한정)\n\n👨‍👩‍👧 가족 패키지\n가족 3인 이상 등록 시 전원 10% 할인\n\n🏅 대회 준비반 특별 모집\n전국 수영 대회를 목표로 하는 선수반 추가 모집 중',
        equipment_info   = E'🎽 준비물 안내\n\n✅ 필수 지참물\n• 수영복 (원피스 또는 레쉬가드)\n• 수영모\n• 물안경\n• 개인 수건\n• 물통\n\n💡 선택 지참물\n• 킥판 (저희 센터 대여 가능)\n• 오리발 (심화반 이상)\n\n🚫 주의사항\n• 면 재질 수영복 착용 불가\n• 귀걸이 등 장신구 착용 금지'
      WHERE name = '토이키즈스윔클럽'
        AND (homepage_slug IS NULL OR homepage_slug = '')
      RETURNING id, name, homepage_slug
    `));
    if (seedResult.rowCount) {
      console.log(`[super-db-init] 토이키즈스윔클럽 홈페이지 샘플 데이터 적용 완료 (${seedResult.rowCount}행)`);
    } else {
      const check = await db.execute(sql.raw(`SELECT id, name, homepage_slug, homepage_enabled FROM swimming_pools WHERE name = '토이키즈스윔클럽' LIMIT 1`));
      console.log("[super-db-init] 홈페이지 샘플 데이터 건너뜀 — 현재 상태:", JSON.stringify(check.rows[0] ?? "풀 없음"));
    }
  } catch (e: any) {
    console.warn("[super-db-init] 홈페이지 샘플 데이터 오류:", e.message);
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

  // ── users — Apple/Kakao 소셜 로그인 + 탈퇴 컬럼 보완 ───────────────────
  try {
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id VARCHAR;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS kakao_id text;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS withdrawal_requested_at TIMESTAMPTZ;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean DEFAULT false;`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN IF NOT EXISTS web_pin_hash text;`)).catch(() => {});
    console.log("[super-db-init] users 소셜 로그인/탈퇴 컬럼 보완 완료");
  } catch (e: any) {
    console.warn("[super-db-init] users 소셜 로그인/탈퇴 컬럼 보완 오류:", e.message);
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
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS parent_comment_id text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS student_id text`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE diary_messages ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'normal'`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS diary_messages_parent_comment_idx ON diary_messages (parent_comment_id) WHERE parent_comment_id IS NOT NULL`)).catch(() => {});
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
        reaction_type text        NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (diary_id, parent_id, reaction_type)
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS diary_reactions_diary_idx ON diary_reactions (diary_id);
    `)).catch(() => {});
    // 기존 잘못된 CHECK 제약 제거 ('thanks' 오타 → 코드에서 'thank' 사용)
    await db.execute(sql.raw(`ALTER TABLE diary_reactions DROP CONSTRAINT IF EXISTS diary_reactions_reaction_type_check`)).catch(() => {});
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

  // ── scheduler_locks — 분산 스케줄러 락 ────────────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS scheduler_locks (
        job_name   text PRIMARY KEY,
        locked_at  timestamptz NOT NULL DEFAULT NOW()
      );
    `));
    console.log("[super-db-init] scheduler_locks 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] scheduler_locks 오류:", e.message);
  }

  // ── scheduler_heartbeat — 스케줄러 실행 기록 ─────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
        job_name    text PRIMARY KEY,
        last_run_at timestamptz NOT NULL DEFAULT NOW(),
        result      jsonb
      );
    `));
    console.log("[super-db-init] scheduler_heartbeat 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] scheduler_heartbeat 오류:", e.message);
  }

  // ── ops_alerts — 슈퍼관리자 운영 알림 피드 ───────────────────────────────
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ops_alerts (
        id              text PRIMARY KEY,
        type            text NOT NULL,
        title           text NOT NULL,
        message         text NOT NULL,
        severity        text NOT NULL DEFAULT 'info',
        related_pool_id text,
        related_user_id text,
        dedupe_key      text UNIQUE,
        is_read         boolean NOT NULL DEFAULT false,
        created_at      timestamptz NOT NULL DEFAULT NOW()
      );
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_ops_alerts_created_at ON ops_alerts (created_at DESC);`)).catch(() => {});
    console.log("[super-db-init] ops_alerts 테이블 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] ops_alerts 오류:", e.message);
  }

  // ── 수평 확장 대비 인덱스 보완 ────────────────────────────────────────────
  try {
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_users_swimming_pool_id ON users (swimming_pool_id);`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_students_pool_status ON students (swimming_pool_id, status);`)).catch(() => {});
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_parent_accounts_swimming_pool_id ON parent_accounts (swimming_pool_id);`)).catch(() => {});
    console.log("[super-db-init] 수평 확장 인덱스 3개 준비 완료");
  } catch (e: any) {
    console.warn("[super-db-init] 인덱스 보완 오류:", e.message);
  }

  // ── 구독 취소 후 90일 유예 비활성화 컬럼 ────────────────────────────────
  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
  `)).catch((e: any) => console.warn("[super-db-init] swimming_pools.deactivated_at 추가 건너뜀:", e.message));
  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;
  `)).catch((e: any) => console.warn("[super-db-init] swimming_pools.deletion_scheduled_at 추가 건너뜀:", e.message));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_swimming_pools_deletion_scheduled ON swimming_pools (deletion_scheduled_at)
    WHERE deletion_scheduled_at IS NOT NULL;
  `)).catch(() => {});
  console.log("[super-db-init] 비활성화/삭제 예약 컬럼 준비 완료");

  console.log("[super-db-init] super DB 컬럼 보완 + backup_logs/restore_logs 초기화 완료");
}
