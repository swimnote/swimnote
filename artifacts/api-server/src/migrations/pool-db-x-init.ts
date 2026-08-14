/**
 * pool-db-x-init.ts — SWIMNOTE X 모드 WP1 Migration
 *
 * 설계 기준: V3.3.4 (최종 정정 4개 항목 반영)
 *
 * ──────────────────────────────────────────────────────────────────
 * 실행 정책:
 *   - 멱등성: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO $$ 패턴
 *   - 실패 즉시 throw: .catch(() => {}) 금지. 어떤 Group이든 실패 시 이후 실행 중단.
 *   - ADD CONSTRAINT IF NOT EXISTS 미사용: DO $$ + pg_constraint 조회 패턴
 *   - 사전 검증 쿼리: M-E 1차(컬럼 추가 전) / 2차(CHECK 추가 전) 두 단계
 *
 * Migration Group 순서:
 *   Group 1: M-A (ENUM) → M-B (swimming_pools 컬럼)
 *   Group 2: M-C (global_template_sets) → M-D (인덱스) → M-E (diary_templates)
 *   Group 3: M-F (audit_entity_versions) → M-G (audit_logs)
 *   Group 4: M-H (parent_ai_daily_usage) → M-H2 (parent_ai_usage_reservations)
 *   Group 5: M-I (growth_events) → M-J (growth_reports)
 *
 * 의존성:
 *   M-A → M-B (ENUM 타입 먼저)
 *   M-A → M-I (growth_match_status_enum)
 *   M-C → M-D (테이블 후 인덱스)
 *   M-C → M-E-④ (FK 대상 테이블 먼저)
 *   M-F → M-G (audit_entity_versions → audit_logs에서 참조)
 *   M-H → M-H2 (parent_ai_daily_usage 먼저)
 * ──────────────────────────────────────────────────────────────────
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

type Db = typeof superAdminDb;

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: ENUM 타입 + swimming_pools X모드 컬럼
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup1_EnumAndPools(db: Db): Promise<void> {
  // ── M-A: ENUM 타입 생성 (패턴 A: DO $$ + EXCEPTION WHEN duplicate_object) ──
  //
  // CREATE TYPE IF NOT EXISTS는 PostgreSQL 9.6~16 모두 미지원.
  // DO $$ + EXCEPTION WHEN duplicate_object THEN NULL 패턴으로 멱등성 보장.

  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE xmode_config_status_enum AS ENUM
        ('NOT_CONFIGURED', 'CURRICULUM_PENDING', 'READY');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[X-init] M-A-1: xmode_config_status_enum OK");

  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE global_template_status_enum AS ENUM
        ('DRAFT', 'ACTIVE', 'ARCHIVED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[X-init] M-A-2: global_template_status_enum OK");

  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE growth_match_status_enum AS ENUM
        ('AUTO_ACCEPTED', 'PENDING_REVIEW',
         'TEACHER_ACCEPTED', 'TEACHER_REJECTED', 'DISCARDED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[X-init] M-A-3: growth_match_status_enum OK");

  // ── M-B: swimming_pools X모드 컬럼 추가 ──────────────────────────────────
  //
  // ENUM 타입이 M-A에서 생성된 이후에만 실행 가능.
  // ADD COLUMN IF NOT EXISTS는 PG 9.6+에서 지원됨.

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS xmode_entitlement
        boolean NOT NULL DEFAULT false;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS xmode_config_status
        xmode_config_status_enum NOT NULL DEFAULT 'NOT_CONFIGURED';
  `));

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS xmode_purchased_at
        timestamptz;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS xmode_subscription_end_at
        timestamptz;
  `));

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS xmode_payment_failed_at
        timestamptz;
  `));

  console.log("[X-init] M-B: swimming_pools xmode 컬럼 5개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: global_template_sets + 인덱스 + diary_templates 변경
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup2_GlobalTemplate(db: Db): Promise<void> {
  // ── M-C: global_template_sets 신규 테이블 ───────────────────────────────
  //
  // global_template_status_enum은 M-A에서 생성됨.
  // M-E의 FK가 이 테이블을 참조하므로 M-E 전에 반드시 실행.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS global_template_sets (
      id            text                        PRIMARY KEY
                      DEFAULT ('gts_' || replace(gen_random_uuid()::text,'-','')),
      version_name  text                        NOT NULL,
      status        global_template_status_enum NOT NULL DEFAULT 'DRAFT',
      created_at    timestamptz                 NOT NULL DEFAULT now(),
      activated_at  timestamptz,
      archived_at   timestamptz
    );
  `));
  console.log("[X-init] M-C: global_template_sets OK");

  // ── M-D: global_template_sets 인덱스 ────────────────────────────────────
  //
  // ① ACTIVE 유일성: ON ((1)) WHERE status='ACTIVE'
  //    — 전역에서 ACTIVE는 최대 1개. pool_id 컬럼 없음(전역 Set).
  //    — (1) 표현식 인덱스: ACTIVE 행 모두 색인값 1 공유 → UNIQUE 위반으로 2번째 ACTIVE 차단.
  //    — ADD CONSTRAINT IF NOT EXISTS 미지원이므로 DO $$ + pg_class 조회 패턴.
  //
  // ② version_name UNIQUE: CREATE UNIQUE INDEX IF NOT EXISTS 지원됨.

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'uniq_global_template_sets_one_active'
          AND n.nspname = 'public'
      ) THEN
        CREATE UNIQUE INDEX uniq_global_template_sets_one_active
          ON global_template_sets ((1))
          WHERE status = 'ACTIVE';
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_global_template_sets_version_name
      ON global_template_sets (version_name);
  `));

  console.log("[X-init] M-D: global_template_sets 인덱스 OK");

  // ── M-E: diary_templates 변경 ───────────────────────────────────────────
  //
  // [1차 사전 검증] M-E-1 실행 전
  // global_template_set_id는 아직 없으므로 scope + swimming_pool_id만 검사.
  // 결과가 1행 이상이면 throw → Group 2 전체 실패 → 서버 기동 중단.

  // 'x_global' 은 swimming_pool_id=NULL이 정상이므로 검증 대상에서 제외.
  // 위반 조건: (알 수 없는 scope) OR (global/teacher인데 swimming_pool_id=NULL)
  const preCheck = await db.execute(sql.raw(`
    SELECT id, scope, swimming_pool_id
    FROM diary_templates
    WHERE scope NOT IN ('global', 'teacher', 'x_global')
       OR (scope IN ('global', 'teacher') AND swimming_pool_id IS NULL);
  `));

  if ((preCheck.rowCount ?? 0) > 0) {
    const ids = (preCheck.rows as any[]).map((r) => r.id).join(", ");
    throw new Error(
      `[X-init] M-E 1차 검증 실패: 기존 diary_templates 데이터 정합성 오류. ` +
      `위반 id: [${ids}]. Migration 중단.`
    );
  }
  console.log("[X-init] M-E 1차 검증: 0 rows (정상)");

  // M-E-1: swimming_pool_id NOT NULL 해제
  // x_global scope 템플릿은 swimming_pool_id = NULL로 저장됨.
  // 기존 global/teacher 행은 swimming_pool_id가 있으므로 영향 없음.
  await db.execute(sql.raw(`
    ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id DROP NOT NULL;
  `));
  console.log("[X-init] M-E-1: swimming_pool_id DROP NOT NULL OK");

  // M-E-2: global_template_set_id 컬럼 추가
  await db.execute(sql.raw(`
    ALTER TABLE diary_templates
      ADD COLUMN IF NOT EXISTS global_template_set_id text;
  `));
  console.log("[X-init] M-E-2: global_template_set_id 컬럼 추가 OK");

  // [2차 사전 검증] M-E-2 완료 후, M-E-3 전
  // global_template_set_id 컬럼이 추가됐으므로 전체 정합성 검사 가능.
  // 기존 데이터는 모두 scope IN ('global','teacher') + swimming_pool_id NOT NULL이므로 통과.
  const postCheck = await db.execute(sql.raw(`
    SELECT id, scope, swimming_pool_id, global_template_set_id
    FROM diary_templates
    WHERE NOT (
      (
        scope = 'x_global'
        AND swimming_pool_id IS NULL
        AND global_template_set_id IS NOT NULL
      )
      OR
      (
        scope IN ('global', 'teacher')
        AND swimming_pool_id IS NOT NULL
        AND global_template_set_id IS NULL
      )
    );
  `));

  if ((postCheck.rowCount ?? 0) > 0) {
    const ids = (postCheck.rows as any[]).map((r) => r.id).join(", ");
    throw new Error(
      `[X-init] M-E 2차 검증 실패: diary_templates 정합성 오류. ` +
      `위반 id: [${ids}]. Migration 중단.`
    );
  }
  console.log("[X-init] M-E 2차 검증: 0 rows (정상)");

  // M-E-3: scope 정합성 CHECK 추가
  // 허용값: 'global' | 'teacher' | 'x_global' 이외 모두 거부.
  // ADD CONSTRAINT IF NOT EXISTS 미지원 → DO $$ + pg_constraint 조회 패턴.
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_diary_templates_scope_integrity'
          AND conrelid = 'diary_templates'::regclass
      ) THEN
        ALTER TABLE diary_templates
        ADD CONSTRAINT chk_diary_templates_scope_integrity
        CHECK (
          (
            scope = 'x_global'
            AND swimming_pool_id IS NULL
            AND global_template_set_id IS NOT NULL
          )
          OR
          (
            scope IN ('global', 'teacher')
            AND swimming_pool_id IS NOT NULL
            AND global_template_set_id IS NULL
          )
        );
      END IF;
    END $$;
  `));
  console.log("[X-init] M-E-3: scope 정합성 CHECK OK");

  // M-E-4: global_template_set_id FK
  // global_template_sets 테이블이 M-C에서 생성된 이후이므로 FK 추가 가능.
  // ON DELETE RESTRICT: 연결된 diary_templates가 있으면 global_template_set 삭제 차단.
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_diary_templates_global_set'
          AND conrelid = 'diary_templates'::regclass
      ) THEN
        ALTER TABLE diary_templates
        ADD CONSTRAINT fk_diary_templates_global_set
        FOREIGN KEY (global_template_set_id)
        REFERENCES global_template_sets (id)
        ON DELETE RESTRICT;
      END IF;
    END $$;
  `));
  console.log("[X-init] M-E-4: global_template_set_id FK OK");

  // M-E-5: x_global 검색 인덱스
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_diary_templates_xglobal
      ON diary_templates (global_template_set_id, is_active)
      WHERE scope = 'x_global';
  `));
  console.log("[X-init] M-E-5: idx_diary_templates_xglobal OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Audit 인프라
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup3_Audit(db: Db): Promise<void> {
  // ── M-F: audit_entity_versions 테이블 + next_audit_version 함수 ──────────
  //
  // (entity_type, entity_id) PK + ON CONFLICT DO UPDATE SET version = version + 1
  // → 동시 호출 시 PostgreSQL 단일 row lock으로 중복 version 발생 없음.
  //
  // audit_logs.entity_version은 이 테이블에서 원자적으로 발급받은 순번.
  // 실제 FK는 없음: audit_entity_versions = 현재 카운터, audit_logs = 이력 스냅샷.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS audit_entity_versions (
      entity_type  text    NOT NULL,
      entity_id    text    NOT NULL,
      version      bigint  NOT NULL DEFAULT 0,
      PRIMARY KEY (entity_type, entity_id)
    );
  `));
  console.log("[X-init] M-F-1: audit_entity_versions OK");

  // CREATE OR REPLACE FUNCTION: 이미 존재해도 교체되므로 멱등.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION next_audit_version(
      p_entity_type text,
      p_entity_id   text
    ) RETURNS bigint
    LANGUAGE plpgsql AS $$
    DECLARE v bigint;
    BEGIN
      INSERT INTO audit_entity_versions (entity_type, entity_id, version)
      VALUES (p_entity_type, p_entity_id, 1)
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET version = audit_entity_versions.version + 1
      RETURNING version INTO v;
      RETURN v;
    END;
    $$;
  `));
  console.log("[X-init] M-F-2: next_audit_version 함수 OK");

  // ── M-G: audit_logs 테이블 ────────────────────────────────────────────────
  //
  // actor_id: NULL 허용 (actor_type='system'인 자동 변경은 actor_id 없음).
  // CHECK (actor_type='system' → actor_id IS NULL, 나머지 → actor_id IS NOT NULL).
  // entity_version: audit_entity_versions에서 발급받은 순번 (FK 없음 — 설계 의도).

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id              text        PRIMARY KEY
                        DEFAULT ('al_' || replace(gen_random_uuid()::text,'-','')),
      entity_type     text        NOT NULL,
      entity_id       text        NOT NULL,
      entity_version  bigint      NOT NULL,
      action          text        NOT NULL,
      actor_type      text        NOT NULL,
      actor_id        text,
      pool_id         text,
      before_data     jsonb,
      after_data      jsonb,
      reason          text,
      request_id      text,
      correlation_id  text,
      ip_hash         text,
      created_at      timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_audit_logs_action
        CHECK (action IN ('create', 'update', 'delete')),

      CONSTRAINT chk_audit_logs_actor_type
        CHECK (actor_type IN
          ('super_admin', 'pool_admin', 'teacher', 'parent', 'system')),

      CONSTRAINT chk_audit_logs_actor_id_consistency
        CHECK (
          (actor_type = 'system' AND actor_id IS NULL)
          OR
          (actor_type <> 'system' AND actor_id IS NOT NULL)
        )
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
      ON audit_logs (entity_type, entity_id, entity_version);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
      ON audit_logs (actor_id, created_at DESC)
      WHERE actor_id IS NOT NULL;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_pool
      ON audit_logs (pool_id, created_at DESC)
      WHERE pool_id IS NOT NULL;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation
      ON audit_logs (correlation_id)
      WHERE correlation_id IS NOT NULL;
  `));

  console.log("[X-init] M-G: audit_logs + 인덱스 4개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Parent AI 사용량 추적
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup4_ParentAiUsage(db: Db): Promise<void> {
  // ── M-H: parent_ai_daily_usage ───────────────────────────────────────────
  //
  // 일(日) 단위. UNIQUE(parent_account_id, usage_date).
  // parent_ai_usage_reservations(M-H2)가 이 테이블의 집계를 참조하므로 먼저 생성.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_ai_daily_usage (
      id                    text            PRIMARY KEY
                              DEFAULT gen_random_uuid()::text,
      parent_account_id     text            NOT NULL,
      usage_date            date            NOT NULL,
      reserved_count        integer         NOT NULL DEFAULT 0,
      completed_count       integer         NOT NULL DEFAULT 0,
      failed_count          integer         NOT NULL DEFAULT 0,
      intent_blocked_count  integer         NOT NULL DEFAULT 0,
      prompt_tokens         integer         NOT NULL DEFAULT 0,
      completion_tokens     integer         NOT NULL DEFAULT 0,
      estimated_cost_krw    numeric(10,2)   NOT NULL DEFAULT 0,
      created_at            timestamptz     NOT NULL DEFAULT now(),
      updated_at            timestamptz     NOT NULL DEFAULT now(),
      UNIQUE (parent_account_id, usage_date)
    );
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_parent_ai_usage_date
      ON parent_ai_daily_usage (parent_account_id, usage_date DESC);
  `));
  console.log("[X-init] M-H: parent_ai_daily_usage OK");

  // ── M-H2: parent_ai_usage_reservations ──────────────────────────────────
  //
  // request_id PRIMARY KEY: 동일 request_id 중복 예약 원천 차단.
  // status: RESERVED → COMPLETED / FAILED / BLOCKED / EXPIRED
  // expires_at: 기본 10분 (API P99 응답 시간 여유 고려 — NV-16 확인 후 조정).

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_ai_usage_reservations (
      request_id          text            PRIMARY KEY,
      parent_account_id   text            NOT NULL,
      usage_date          date            NOT NULL,
      status              text            NOT NULL DEFAULT 'RESERVED',
      reserved_at         timestamptz     NOT NULL DEFAULT now(),
      completed_at        timestamptz,
      expires_at          timestamptz     NOT NULL
                            DEFAULT (now() + interval '10 minutes'),
      prompt_tokens       integer         NOT NULL DEFAULT 0,
      completion_tokens   integer         NOT NULL DEFAULT 0,
      estimated_cost_krw  numeric(10,2)   NOT NULL DEFAULT 0,
      error_code          text,
      created_at          timestamptz     NOT NULL DEFAULT now(),

      CONSTRAINT chk_reservation_status
        CHECK (status IN
          ('RESERVED', 'COMPLETED', 'FAILED', 'BLOCKED', 'EXPIRED')),

      CONSTRAINT chk_reservation_completed_at
        CHECK (
          (status IN ('COMPLETED', 'FAILED', 'BLOCKED', 'EXPIRED')
            AND completed_at IS NOT NULL)
          OR status = 'RESERVED'
        )
    );
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_par_reservations_parent_date
      ON parent_ai_usage_reservations (parent_account_id, usage_date);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_par_reservations_expired
      ON parent_ai_usage_reservations (status, expires_at)
      WHERE status = 'RESERVED';
  `));
  console.log("[X-init] M-H2: parent_ai_usage_reservations OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 5a: growth_events (PART 1)
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup5a_GrowthEvents(db: Db): Promise<void> {
  // ── M-I: growth_events ──────────────────────────────────────────────────
  //
  // growth_match_status_enum은 M-A에서 생성됨.
  // match_token_id UNIQUE (NULL 허용): one-time token 재사용 방지.
  // uq_growth_events_per_note Partial UNIQUE: 동일 일지·학생·커리큘럼·출처는 최대 1회.
  // is_invalidated: 일지 삭제 시 DELETE 대신 플래그 처리.
  // evidence_validation: TEXT CHECK ('PASS'|'FAIL'|'SKIPPED') — JSONB 아님.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_events (
      id                          text                     PRIMARY KEY
                                    DEFAULT ('ge_' || replace(gen_random_uuid()::text,'-','')),

      student_id                  text        NOT NULL,
      swimming_pool_id            text        NOT NULL,
      curriculum_item_id          text        NOT NULL,
      curriculum_version_id       text        NOT NULL,
      diary_note_id               text,
      source                      text        NOT NULL DEFAULT 'teacher_ai',
      match_token_id              text,

      growth_match_status         growth_match_status_enum NOT NULL DEFAULT 'AUTO_ACCEPTED',
      confidence                  numeric(4,3) NOT NULL,

      matching_algorithm_version  text,
      confidence_config_version   text,
      engine_version              text,
      prompt_version              text,
      knowledge_version           text,
      template_set_version        text,
      contract_version            text,

      evidence_source_type        text,
      evidence_sentence_index     integer,
      evidence_text               text,
      evidence_metadata           jsonb,
      evidence_validation         text,

      reviewed_by                 text,
      reviewed_at                 timestamptz,
      review_reason               text,

      is_invalidated              boolean     NOT NULL DEFAULT false,
      invalidated_at              timestamptz,

      request_id                  text,
      created_at                  timestamptz NOT NULL DEFAULT now(),
      updated_at                  timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_ge_confidence
        CHECK (confidence >= 0 AND confidence <= 1),

      CONSTRAINT chk_ge_evidence_sentence_index
        CHECK (evidence_sentence_index IS NULL
               OR evidence_sentence_index >= 0),

      CONSTRAINT chk_ge_evidence_text_len
        CHECK (evidence_text IS NULL
               OR length(evidence_text) <= 300),

      CONSTRAINT chk_ge_evidence_validation
        CHECK (evidence_validation IS NULL
               OR evidence_validation IN ('PASS', 'FAIL', 'SKIPPED')),

      CONSTRAINT chk_ge_source
        CHECK (source IN
          ('teacher_ai', 'teacher_manual', 'parent_ai', 'video_ai')),

      CONSTRAINT chk_ge_invalidated_consistency
        CHECK (
          (is_invalidated = false AND invalidated_at IS NULL)
          OR
          (is_invalidated = true  AND invalidated_at IS NOT NULL)
        )
    );
  `));

  // match_token_id UNIQUE (NULL 허용 — 구버전 앱 호환)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_match_token_id
      ON growth_events (match_token_id)
      WHERE match_token_id IS NOT NULL;
  `));

  // 동일 일지·학생·커리큘럼·출처 중복 방지 (유효 이벤트만)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_events_per_note
      ON growth_events (diary_note_id, student_id, curriculum_item_id, source)
      WHERE diary_note_id IS NOT NULL
        AND is_invalidated = false;
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_events_student
      ON growth_events (student_id, created_at DESC);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_events_pool
      ON growth_events (swimming_pool_id, created_at DESC);
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_events_pending
      ON growth_events (growth_match_status)
      WHERE growth_match_status = 'PENDING_REVIEW'
        AND is_invalidated = false;
  `));

  console.log("[X-init] M-I: growth_events + 인덱스 5개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 5b: growth_reports (PART 2 전용 — initXModePart2Schema에서만 호출)
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup5b_GrowthReports(db: Db): Promise<void> {
  // ── M-J: growth_reports ──────────────────────────────────────────────────
  //
  // 버전 컬럼 7개: 재다운로드 시 동일 버전이면 재분석 없이 cached 응답.
  // content JSONB: 분석 결과 원본 (PPT 생성 기반). WP18 전에는 NULL.
  // ppt_template_version: WP18에서 활성화. 지금은 NULL.
  // deleted_at: 소프트 딜리트.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_reports (
      id                      text        PRIMARY KEY
                                DEFAULT ('gr_' || replace(gen_random_uuid()::text,'-','')),

      student_id              text        NOT NULL,
      swimming_pool_id        text        NOT NULL,
      report_type             text        NOT NULL DEFAULT 'monthly',
      period_start            date        NOT NULL,
      period_end              date        NOT NULL,

      source_event_count      integer     NOT NULL DEFAULT 0,
      source_data_cutoff_at   timestamptz,

      curriculum_version_id   text,
      report_schema_version   text,
      report_template_version text,
      analysis_version        text,
      prompt_version          text,
      knowledge_version       text,
      ppt_template_version    text,

      content                 jsonb,
      summary_text            text,
      file_url                text,

      generated_at            timestamptz NOT NULL DEFAULT now(),
      generated_by            text,
      ai_version              text,
      confidence_config_ver   text,

      deleted_at              timestamptz,
      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_gr_report_type
        CHECK (report_type IN ('monthly', 'quarterly', 'annual', 'custom')),

      CONSTRAINT chk_gr_period
        CHECK (period_end >= period_start)
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_student
      ON growth_reports (student_id, period_start DESC)
      WHERE deleted_at IS NULL;
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_pool
      ON growth_reports (swimming_pool_id, created_at DESC)
      WHERE deleted_at IS NULL;
  `));

  console.log("[X-init] M-J: growth_reports + 인덱스 2개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Curriculum (PART 1)
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup6_Curriculum(db: Db): Promise<void> {
  // ── curriculum_versions ─────────────────────────────────────────────────
  //
  // swimming_pool별 커리큘럼 버전. is_active = true인 버전은 풀당 1개만 허용.
  // Partial UNIQUE: (swimming_pool_id) WHERE is_active = true

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_versions (
      id               text        PRIMARY KEY
                         DEFAULT ('cv_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id text        NOT NULL,
      version_name     text        NOT NULL,
      is_active        boolean     NOT NULL DEFAULT false,
      activated_at     timestamptz,
      archived_at      timestamptz,
      created_by       text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_curriculum_versions_name
      ON curriculum_versions (swimming_pool_id, version_name);
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'uniq_curriculum_versions_one_active'
          AND n.nspname = 'public'
      ) THEN
        CREATE UNIQUE INDEX uniq_curriculum_versions_one_active
          ON curriculum_versions (swimming_pool_id)
          WHERE is_active = true;
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_versions_pool
      ON curriculum_versions (swimming_pool_id, created_at DESC);
  `));

  console.log("[X-init] Group 6-1: curriculum_versions OK");

  // ── curriculum_items ─────────────────────────────────────────────────────
  //
  // 버전 내 항목. (curriculum_version_id, sort_order) UNIQUE.
  // ON DELETE RESTRICT: 버전 삭제 시 항목이 있으면 차단.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_items (
      id                    text        PRIMARY KEY
                              DEFAULT ('ci_' || replace(gen_random_uuid()::text,'-','')),
      curriculum_version_id text        NOT NULL
        REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
      swimming_pool_id      text        NOT NULL,
      sort_order            integer     NOT NULL DEFAULT 0,
      title                 text        NOT NULL,
      description           text,
      is_active             boolean     NOT NULL DEFAULT true,
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_curriculum_items_sort
      ON curriculum_items (curriculum_version_id, sort_order);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_items_version
      ON curriculum_items (curriculum_version_id, sort_order);
  `));

  console.log("[X-init] Group 6-2: curriculum_items OK");

  // ── student_curriculum_assignments ──────────────────────────────────────
  //
  // 학생별 커리큘럼 버전 배정. is_active=true는 (student_id, swimming_pool_id)당 1개.
  // curriculum_item_id 없음 — 진행도는 growth_events로 계산.
  // ON DELETE RESTRICT: 배정된 학생이 있으면 버전 삭제 차단.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS student_curriculum_assignments (
      id                    text        PRIMARY KEY
                              DEFAULT ('sca_' || replace(gen_random_uuid()::text,'-','')),
      student_id            text        NOT NULL,
      swimming_pool_id      text        NOT NULL,
      curriculum_version_id text        NOT NULL
        REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
      assigned_at           timestamptz NOT NULL DEFAULT now(),
      assigned_by           text,
      is_active             boolean     NOT NULL DEFAULT true,
      deactivated_at        timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'uniq_sca_one_active'
          AND n.nspname = 'public'
      ) THEN
        CREATE UNIQUE INDEX uniq_sca_one_active
          ON student_curriculum_assignments (student_id, swimming_pool_id)
          WHERE is_active = true;
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sca_student_pool
      ON student_curriculum_assignments (student_id, swimming_pool_id, is_active);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_sca_version
      ON student_curriculum_assignments (curriculum_version_id, is_active);
  `));

  console.log("[X-init] Group 6-3: student_curriculum_assignments OK");

  // ── curriculum_requests ──────────────────────────────────────────────────
  //
  // 수영장이 슈퍼어드민에게 커리큘럼 제작을 요청하는 테이블.
  // result_version_id: 승인 완료 후 연결된 curriculum_versions.id
  // ON DELETE RESTRICT: 결과 버전 삭제 시 요청 기록 보호.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_requests (
      id                text        PRIMARY KEY
                          DEFAULT ('cr_' || replace(gen_random_uuid()::text,'-','')),
      swimming_pool_id  text        NOT NULL,
      request_status    text        NOT NULL DEFAULT 'pending'
        CHECK (request_status IN
          ('pending','reviewing','approved','rejected','cancelled')),
      title             text        NOT NULL,
      description       text,
      requested_by      text        NOT NULL,
      reviewed_by       text,
      reviewed_at       timestamptz,
      review_note       text,
      result_version_id text
        REFERENCES curriculum_versions(id) ON DELETE RESTRICT,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_requests_pool
      ON curriculum_requests (swimming_pool_id, request_status, created_at DESC);
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_requests_status
      ON curriculum_requests (request_status, created_at DESC);
  `));

  console.log("[X-init] Group 6-4: curriculum_requests OK");

  // ── curriculum_request_files ─────────────────────────────────────────────
  //
  // 요청에 첨부된 파일 목록. ON DELETE CASCADE: 요청 삭제 시 파일 기록도 삭제.

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_request_files (
      id               text        PRIMARY KEY
                         DEFAULT ('crf_' || replace(gen_random_uuid()::text,'-','')),
      request_id       text        NOT NULL
        REFERENCES curriculum_requests(id) ON DELETE CASCADE,
      swimming_pool_id text        NOT NULL,
      file_key         text        NOT NULL,
      file_name        text        NOT NULL,
      file_size_bytes  bigint,
      mime_type        text,
      uploaded_by      text        NOT NULL,
      uploaded_at      timestamptz NOT NULL DEFAULT now()
    );
  `));

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_curriculum_request_files_req
      ON curriculum_request_files (request_id);
  `));

  console.log("[X-init] Group 6-5: curriculum_request_files OK");

  // ── growth_events Curriculum FK 2개 ─────────────────────────────────────
  //
  // curriculum_versions / curriculum_items 생성 완료 후 추가.
  // ON DELETE RESTRICT: curriculum_item 또는 curriculum_version 삭제 시 growth_events 보호.
  // growth_events.curriculum_item_id / curriculum_version_id 는 NOT NULL 유지.

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ge_curriculum_item'
          AND conrelid = 'growth_events'::regclass
      ) THEN
        ALTER TABLE growth_events
          ADD CONSTRAINT fk_ge_curriculum_item
          FOREIGN KEY (curriculum_item_id)
          REFERENCES curriculum_items(id)
          ON DELETE RESTRICT;
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ge_curriculum_version'
          AND conrelid = 'growth_events'::regclass
      ) THEN
        ALTER TABLE growth_events
          ADD CONSTRAINT fk_ge_curriculum_version
          FOREIGN KEY (curriculum_version_id)
          REFERENCES curriculum_versions(id)
          ON DELETE RESTRICT;
      END IF;
    END $$;
  `));

  console.log("[X-init] Group 6-6: growth_events FK 2개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Parent Curriculum Conversations + Messages (WP2B)
// ─────────────────────────────────────────────────────────────────────────────

async function runGroup7_CurriculumConversation(db: Db): Promise<void> {
  // ── M-W1: parent_curriculum_conversations ────────────────────────────────
  // parent × student = 1개 conversation (UNIQUE).
  // 같은 parent가 같은 student를 다시 열면 기존 conversation 재사용.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_curriculum_conversations (
      id                  text        PRIMARY KEY
                            DEFAULT gen_random_uuid()::text,
      parent_account_id   text        NOT NULL,
      student_id          text        NOT NULL,
      swimming_pool_id    text        NOT NULL,
      status              text        NOT NULL DEFAULT 'active',
      last_message_at     timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),
      UNIQUE (parent_account_id, student_id)
    );
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_pcc_parent_student
      ON parent_curriculum_conversations (parent_account_id, student_id);
  `));
  console.log("[X-init] Group 7-1: parent_curriculum_conversations OK");

  // ── M-W2: parent_curriculum_messages ─────────────────────────────────────
  // UNIQUE(request_id, role): 동일 request retry 시 중복 저장 방지.
  // metadata JSONB: intent / mode / curriculum_source (안전한 meta만).
  // Grounding trace 전체 저장 금지.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS parent_curriculum_messages (
      id                text        PRIMARY KEY
                          DEFAULT gen_random_uuid()::text,
      conversation_id   text        NOT NULL
                          REFERENCES parent_curriculum_conversations(id)
                          ON DELETE CASCADE,
      request_id        text        NOT NULL,
      role              text        NOT NULL,
      content           text        NOT NULL,
      metadata          jsonb,
      created_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT chk_pcm_role CHECK (role IN ('USER', 'ASSISTANT')),
      UNIQUE (request_id, role)
    );
  `));
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_pcm_conversation_created
      ON parent_curriculum_messages (conversation_id, created_at ASC);
  `));
  console.log("[X-init] Group 7-2: parent_curriculum_messages OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점: initXModeSchema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * initXModeSchema — PART 1 진입점
 *
 * SWIMNOTE X 모드 WP1 Migration 진입점.
 * pool-db-init.ts의 initPoolDb() 마지막 단계에서 호출됨.
 *
 * PART 1 실행 순서:
 *   Group 1: ENUM + swimming_pools
 *   Group 2: global_template_sets + diary_templates
 *   Group 3: Audit 인프라
 *   Group 5a: growth_events
 *   Group 6:  curriculum 5개 테이블 + growth_events FK 2개
 *
 * PART 2 (initXModePart2Schema):
 *   Group 4: parent_ai_daily_usage / parent_ai_usage_reservations
 *   Group 5b: growth_reports
 *   → 별도 승인 후 연결. 이번 WP에서 미호출.
 *
 * 실패 정책:
 *   - 각 Group 실패 시 throw → 호출 스택으로 전파 → 서버 기동 중단
 *   - 로그만 남기고 성공처럼 계속 진행하는 것을 금지
 *
 * 멱등성:
 *   - 모든 DDL은 IF NOT EXISTS / DO $$ + pg_constraint / CREATE OR REPLACE 사용
 *   - 재실행 시 이미 존재하는 객체는 건너뜀
 *
 * 주의: 이 함수는 서버 기동마다 실행됨.
 *   - 사전 검증(M-E)은 기존 데이터가 0행 이상이면 throw
 *   - x_global 행이 생긴 이후에는 검증 조건이 자연스럽게 통과됨
 */
export async function initXModeSchema(): Promise<void> {
  const db = superAdminDb;

  // Group 1: ENUM + swimming_pools
  try {
    await runGroup1_EnumAndPools(db);
    console.log("[SWIMNOTE X WP1] Group 1 완료: ENUM + swimming_pools");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 1 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 2: global_template_sets + 인덱스 + diary_templates
  try {
    await runGroup2_GlobalTemplate(db);
    console.log("[SWIMNOTE X WP1] Group 2 완료: global_template_sets + diary_templates");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 2 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 3: Audit 인프라
  try {
    await runGroup3_Audit(db);
    console.log("[SWIMNOTE X WP1] Group 3 완료: audit 인프라");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 3 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 5a: growth_events (Group 4 Parent AI는 PART 2로 분리됨)
  try {
    await runGroup5a_GrowthEvents(db);
    console.log("[SWIMNOTE X WP1] Group 5a 완료: growth_events");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 5a 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 6: curriculum 5개 테이블 + growth_events FK 2개
  try {
    await runGroup6_Curriculum(db);
    console.log("[SWIMNOTE X WP1] Group 6 완료: curriculum + growth_events FK");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 6 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 7: parent_curriculum_conversations + parent_curriculum_messages (WP2B)
  try {
    await runGroup7_CurriculumConversation(db);
    console.log("[SWIMNOTE X WP1] Group 7 완료: parent curriculum conversations + messages");
  } catch (err) {
    console.error("[SWIMNOTE X WP1] Group 7 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  console.log("[SWIMNOTE X WP1] ✅ PART 1 Migration 완료 (Group 1·2·3·5a·6·7)");
}

/**
 * initXModePart2Schema — PART 2 진입점
 *
 * SWIMNOTE X 모드 PART 2 Migration 진입점.
 * 이번 WP에서는 어디에도 연결하지 않음.
 * 별도 승인 후 pool-db-init.ts에서 호출 예정.
 *
 * PART 2 실행 순서:
 *   Group 4:  parent_ai_daily_usage + parent_ai_usage_reservations
 *   Group 5b: growth_reports
 *
 * 금지: pool-db-init.ts / index.ts / Worker / Route에서 호출 금지
 */
export async function initXModePart2Schema(): Promise<void> {
  const db = superAdminDb;

  // Group 4: Parent AI 사용량 추적
  try {
    await runGroup4_ParentAiUsage(db);
    console.log("[SWIMNOTE X PART2] Group 4 완료: parent AI usage");
  } catch (err) {
    console.error("[SWIMNOTE X PART2] Group 4 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group 5b: growth_reports
  try {
    await runGroup5b_GrowthReports(db);
    console.log("[SWIMNOTE X PART2] Group 5b 완료: growth_reports");
  } catch (err) {
    console.error("[SWIMNOTE X PART2] Group 5b 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  console.log("[SWIMNOTE X PART2] ✅ PART 2 Migration 완료 (Group 4·5b)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback SQL (실행하지 말 것 — 별도 승인 후 수동 실행)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ROLLBACK_SQL — 참고용 주석 (실행 함수 아님)
 *
 * 역순 실행. 각 단계는 독립적으로 실행 가능.
 * M-E Rollback 전제: scope='x_global' 행 = 0, swimming_pool_id IS NULL 행 = 0
 *
 * -- Group 5 Rollback
 * DROP TABLE IF EXISTS growth_reports;
 * DROP TABLE IF EXISTS growth_events;
 *
 * -- Group 4 Rollback
 * DROP TABLE IF EXISTS parent_ai_usage_reservations;
 * DROP TABLE IF EXISTS parent_ai_daily_usage;
 *
 * -- Group 3 Rollback
 * DROP TABLE IF EXISTS audit_logs;
 * DROP TABLE IF EXISTS audit_entity_versions;
 * DROP FUNCTION IF EXISTS next_audit_version(text, text);
 *
 * -- Group 2 Rollback (역순)
 * DROP INDEX IF EXISTS idx_diary_templates_xglobal;
 * ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS fk_diary_templates_global_set;
 * ALTER TABLE diary_templates DROP CONSTRAINT IF EXISTS chk_diary_templates_scope_integrity;
 * ALTER TABLE diary_templates DROP COLUMN IF EXISTS global_template_set_id;
 * ALTER TABLE diary_templates ALTER COLUMN swimming_pool_id SET NOT NULL;  -- x_global 행 없을 때만
 * DROP INDEX IF EXISTS uniq_global_template_sets_one_active;
 * DROP INDEX IF EXISTS uniq_global_template_sets_version_name;
 * DROP TABLE IF EXISTS global_template_sets;
 *
 * -- Group 1 Rollback
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_payment_failed_at;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_subscription_end_at;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_purchased_at;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_config_status;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS xmode_entitlement;
 * DROP TYPE IF EXISTS growth_match_status_enum;    -- growth_events 없을 때만
 * DROP TYPE IF EXISTS global_template_status_enum; -- global_template_sets 없을 때만
 * DROP TYPE IF EXISTS xmode_config_status_enum;    -- swimming_pools 컬럼 없을 때만
 */
