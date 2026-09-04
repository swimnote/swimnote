/**
 * growth-report-gr1-init.ts — GR1: Product Storage + Report Lifecycle Foundation
 *
 * 실행 정책:
 *   - 멱등성: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO $$ 패턴
 *   - Additive only: 기존 테이블/컬럼 삭제·rename 금지
 *   - 실패 즉시 throw: catch(() => {}) 금지
 *   - Production migration 실행 금지 (테스트 검증 완료 후 별도 승인)
 *
 * Migration Group 순서:
 *   Group GR1-A: ENUM 타입 (product_status, parent_input_status, cycle_status,
 *                             analysis_status, answer_type)
 *   Group GR1-B: growth_report_cycles 테이블
 *   Group GR1-C: growth_reports 컬럼 추가 (Additive — 기존 테이블 유지)
 *   Group GR1-D: growth_reports 인덱스
 *   Group GR1-E: growth_report_questions 테이블
 *   Group GR1-F: growth_report_answers 테이블
 *
 * 의존성:
 *   GR1-A → GR1-B (ENUM 먼저)
 *   GR1-A, GR1-B → GR1-C (ENUM + cycles 먼저)
 *   GR1-C → GR1-D (컬럼 추가 후 인덱스)
 *   GR1-C → GR1-E (report 테이블 먼저)
 *   GR1-E → GR1-F (questions 먼저)
 *
 * 주의:
 *   - growth_reports는 pool-db-x-init.ts Group 5b에서 이미 기본 생성됨.
 *     이 migration은 해당 테이블에 GR1 Product 컬럼을 additive하게 추가함.
 *   - initXModePart2Schema()가 먼저 실행되어야 growth_reports 테이블이 존재함.
 *     본 migration은 그 이후에 실행해야 함.
 */
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

type Db = typeof superAdminDb;

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-A: ENUM 타입
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupA_Enums(db: Db): Promise<void> {
  // gr_product_status_enum
  // 금지값: QUESTION_REQUIRED, CLOSED
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE gr_product_status_enum AS ENUM (
        'NOT_OPEN',
        'OPEN',
        'PREANALYZING',
        'QUESTION_AVAILABLE',
        'READY_FOR_ANALYSIS',
        'ANALYZING',
        'REVIEW_REQUIRED',
        'APPROVED',
        'PUBLISHED',
        'PARTIAL',
        'FAILED'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GR1-init] GR1-A-1: gr_product_status_enum OK");

  // gr_parent_input_status_enum
  // parent_input_status=CLOSED ≠ report 종료. 입력창만 닫힘.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE gr_parent_input_status_enum AS ENUM (
        'NONE',
        'AVAILABLE',
        'ANSWERED',
        'CLOSED'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GR1-init] GR1-A-2: gr_parent_input_status_enum OK");

  // gr_cycle_status_enum
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE gr_cycle_status_enum AS ENUM (
        'PENDING',
        'ACTIVE',
        'INPUT_CLOSED',
        'DONE'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GR1-init] GR1-A-3: gr_cycle_status_enum OK");

  // gr_analysis_status_enum — ENGINE에서 오는 상태 (product_status와 혼용 금지)
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE gr_analysis_status_enum AS ENUM (
        'COMPLETE',
        'COMPLETE_WITH_QUESTIONS_AVAILABLE',
        'COMPLETE_WITH_PARENT_EVIDENCE',
        'PARTIAL'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GR1-init] GR1-A-4: gr_analysis_status_enum OK");

  // gr_answer_type_enum — ENGINE question 저장용
  await db.execute(sql.raw(`
    DO $$ BEGIN
      CREATE TYPE gr_answer_type_enum AS ENUM (
        'SINGLE_CHOICE',
        'MULTI_CHOICE'
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GR1-init] GR1-A-5: gr_answer_type_enum OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-B: growth_report_cycles
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupB_Cycles(db: Db): Promise<void> {
  // growth_report_cycles — Pool 단위 월별 회차 관리
  //
  // report_period: "YYYY-MM" 형식 label (예: "2026-08")
  // analysis_from: nullable — 정책 미확정 (전월 25일 / 당월 1일 등 ENGINE Contract 확정 후 결정)
  // analysis_cutoff_at: 분석 데이터 상한선 (미래 데이터 제외 기준)
  // parent_input_open_at: 학부모 입력 창 열림 (예: 25일)
  // parent_input_close_at: 학부모 입력 창 닫힘 (예: 다음달 5일)
  // timezone: 기본값 'Asia/Seoul'
  // cycle_status: Pool-level cycle 상태 (report별 상태와 독립)
  // UNIQUE(swimming_pool_id, report_period): 동일 풀 + 동일 기간 중복 생성 방지
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_cycles (
      id                    text        PRIMARY KEY
                              DEFAULT ('grc_' || replace(gen_random_uuid()::text,'-','')),

      swimming_pool_id      text        NOT NULL,
      report_period         text        NOT NULL,

      analysis_from         timestamptz,
      analysis_cutoff_at    timestamptz NOT NULL,
      parent_input_open_at  timestamptz NOT NULL,
      parent_input_close_at timestamptz NOT NULL,

      timezone              text        NOT NULL DEFAULT 'Asia/Seoul',
      cycle_status          gr_cycle_status_enum NOT NULL DEFAULT 'PENDING',

      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_grc_cutoff_after_from
        CHECK (analysis_from IS NULL
               OR analysis_cutoff_at > analysis_from),

      CONSTRAINT chk_grc_input_window_order
        CHECK (parent_input_close_at > parent_input_open_at),

      CONSTRAINT chk_grc_report_period_format
        CHECK (report_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    );
  `));
  console.log("[GR1-init] GR1-B-1: growth_report_cycles OK");

  // UNIQUE: 동일 풀 + 동일 기간 중복 방지 (concurrency-safe)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_cycles_pool_period
      ON growth_report_cycles (swimming_pool_id, report_period);
  `));
  console.log("[GR1-init] GR1-B-2: uq_growth_report_cycles_pool_period OK");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_cycles_pool_status
      ON growth_report_cycles (swimming_pool_id, cycle_status);
  `));
  console.log("[GR1-init] GR1-B-3: idx_growth_report_cycles_pool_status OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-C: growth_reports 컬럼 추가 (Additive)
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupC_GrowthReportsColumns(db: Db): Promise<void> {
  // growth_reports 테이블은 pool-db-x-init.ts Group 5b에서 기본 생성됨.
  // 이 Group은 GR1 Product lifecycle 컬럼을 additive하게 추가함.
  // 기존 컬럼(period_start, period_end, content, summary_text 등)은 절대 변경하지 않음.

  const addCols: { col: string; definition: string }[] = [
    // cycle 연결
    { col: "cycle_id",             definition: "text" },
    { col: "report_period",        definition: "text" },

    // Product Lifecycle — ENUM (기본값 NOT_OPEN)
    { col: "product_status",       definition: "gr_product_status_enum NOT NULL DEFAULT 'NOT_OPEN'" },
    // Parent Input Lifecycle — ENUM (기본값 NONE)
    { col: "parent_input_status",  definition: "gr_parent_input_status_enum NOT NULL DEFAULT 'NONE'" },
    { col: "parent_input_closed_at", definition: "timestamptz" },
    // ENGINE analysis status — product_status와 혼용 금지
    { col: "analysis_status",      definition: "gr_analysis_status_enum" },
    // ENGINE 요청 추적
    { col: "analysis_request_id",  definition: "text" },

    // Snapshot 무결성
    { col: "snapshot_version",     definition: "integer NOT NULL DEFAULT 0" },
    { col: "snapshot_hash",        definition: "text" },

    // ENGINE metric 결과 (opaque JSONB — APP이 의미 재해석 금지)
    { col: "selected_metrics",     definition: "jsonb" },
    { col: "metric_states",        definition: "jsonb" },
    { col: "metric_confidences",   definition: "jsonb" },

    // ENGINE growth analysis 결과 (opaque JSONB — 그대로 저장)
    { col: "positive_growth_signals",  definition: "jsonb" },
    { col: "success_conditions",       definition: "jsonb" },
    { col: "support_levers",           definition: "jsonb" },
    { col: "next_growth_targets",      definition: "jsonb" },
    { col: "next_observation_targets", definition: "jsonb" },

    // Fact Package — ENGINE Snapshot Context 원본 (opaque JSONB, PII 비포함)
    { col: "report_fact_package",  definition: "jsonb" },

    // Structured Report Content (string 한 줄 금지, APP GPT 재요약 금지)
    // 기존 `content` jsonb 컬럼과 구분: report_content가 GR1 Product Content
    { col: "report_content",       definition: "jsonb" },

    // SNS Summary (headline, key_points[], share_safe, supporting_claim_ids[])
    // string 한 줄 축소 금지
    { col: "sns_summary",          definition: "jsonb" },

    // Teacher review
    { col: "teacher_reviewed_by",  definition: "text" },
    { col: "teacher_reviewed_at",  definition: "timestamptz" },

    // Publication
    { col: "published_at",         definition: "timestamptz" },

    // Longitudinal 편의 참조 (전체 history는 student_id 기준 query로 조회)
    { col: "previous_report_id",   definition: "text" },
  ];

  for (const { col, definition } of addCols) {
    await db.execute(sql.raw(`
      ALTER TABLE growth_reports
        ADD COLUMN IF NOT EXISTS ${col} ${definition};
    `));
  }
  console.log(`[GR1-init] GR1-C: growth_reports 컬럼 ${addCols.length}개 추가 OK`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-D: growth_reports 인덱스
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupD_GrowthReportsIndexes(db: Db): Promise<void> {
  // UNIQUE: 한 student + 한 cycle에 정상 report 중복 금지 (concurrency-safe)
  // partial: deleted_at IS NULL인 행만 (soft-delete 허용)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_reports_student_cycle
      ON growth_reports (student_id, cycle_id)
      WHERE cycle_id IS NOT NULL
        AND deleted_at IS NULL;
  `));
  console.log("[GR1-init] GR1-D-1: uq_growth_reports_student_cycle OK");

  // product_status별 조회 (scheduler, lifecycle service)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_product_status
      ON growth_reports (product_status, updated_at DESC)
      WHERE deleted_at IS NULL;
  `));
  console.log("[GR1-init] GR1-D-2: idx_growth_reports_product_status OK");

  // cycle_id별 조회 (GR2 scheduler)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_cycle
      ON growth_reports (cycle_id)
      WHERE cycle_id IS NOT NULL AND deleted_at IS NULL;
  `));
  console.log("[GR1-init] GR1-D-3: idx_growth_reports_cycle OK");

  // longitudinal history: student 전체 published reports
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_reports_student_published
      ON growth_reports (student_id, published_at DESC)
      WHERE product_status = 'PUBLISHED' AND deleted_at IS NULL;
  `));
  console.log("[GR1-init] GR1-D-4: idx_growth_reports_student_published OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-E: growth_report_questions
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupE_Questions(db: Db): Promise<void> {
  // growth_report_questions — ENGINE 질문 Contract 저장
  //
  // APP은 질문을 창작하지 않음. ENGINE 반환값 그대로 저장.
  // engine_question_id: ENGINE이 부여한 고유 ID
  // metric_id: ENGINE Metric ID (F001~F070 범위 — APP이 의미 해석 금지)
  // is_required: canonical = false (질문은 optional)
  // options: structured JSONB (array of {value, label})
  // reason_codes: ENGINE 질문 생성 이유 (structured JSONB)
  // parent_confirmable_behavior: ENGINE이 정의한 확인 가능 행동
  // question_stage: ENGINE 질문 단계
  // metric_definition_version / question_policy_version: ENGINE 버전 추적
  // UNIQUE(report_id, engine_question_id): 동일 ENGINE 질문 중복 저장 방지
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_questions (
      id                        text        PRIMARY KEY
                                  DEFAULT ('grq_' || replace(gen_random_uuid()::text,'-','')),

      report_id                 text        NOT NULL,
      engine_question_id        text        NOT NULL,
      metric_id                 text        NOT NULL,

      question_text             text        NOT NULL,
      answer_type               gr_answer_type_enum NOT NULL DEFAULT 'SINGLE_CHOICE',
      options                   jsonb       NOT NULL DEFAULT '[]'::jsonb,

      parent_confirmable_behavior text,
      question_stage            text,
      reason_codes              jsonb,

      sequence                  integer     NOT NULL DEFAULT 1,
      is_required               boolean     NOT NULL DEFAULT false,

      metric_definition_version text,
      question_policy_version   text,

      created_at                timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_grq_sequence CHECK (sequence >= 1),
      CONSTRAINT chk_grq_options_is_array
        CHECK (jsonb_typeof(options) = 'array')
    );
  `));
  console.log("[GR1-init] GR1-E-1: growth_report_questions OK");

  // UNIQUE: 동일 report에 동일 ENGINE 질문 중복 방지
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_questions_report_engine
      ON growth_report_questions (report_id, engine_question_id);
  `));
  console.log("[GR1-init] GR1-E-2: uq_growth_report_questions_report_engine OK");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_questions_report
      ON growth_report_questions (report_id, sequence);
  `));
  console.log("[GR1-init] GR1-E-3: idx_growth_report_questions_report OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GR1-F: growth_report_answers
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupF_Answers(db: Db): Promise<void> {
  // growth_report_answers — 학부모 답변 저장
  //
  // selected_values: structured JSONB array (string[])
  // APP은 답변 의미(AGREEMENT/CONTRADICTION 등)를 판단하지 않음 — ENGINE 책임.
  // UNIQUE(report_id, question_id, parent_account_id): 재답변 시 upsert
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS growth_report_answers (
      id                  text        PRIMARY KEY
                            DEFAULT ('gra_' || replace(gen_random_uuid()::text,'-','')),

      report_id           text        NOT NULL,
      question_id         text        NOT NULL,
      parent_account_id   text        NOT NULL,

      selected_values     jsonb       NOT NULL DEFAULT '[]'::jsonb,

      answered_at         timestamptz NOT NULL DEFAULT now(),
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT chk_gra_selected_values_is_array
        CHECK (jsonb_typeof(selected_values) = 'array')
    );
  `));
  console.log("[GR1-init] GR1-F-1: growth_report_answers OK");

  // UNIQUE: report + question + parent 조합당 현재 answer 1개 (upsert 허용)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_report_answers_report_question_parent
      ON growth_report_answers (report_id, question_id, parent_account_id);
  `));
  console.log("[GR1-init] GR1-F-2: uq_growth_report_answers_report_question_parent OK");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_answers_report
      ON growth_report_answers (report_id);
  `));
  console.log("[GR1-init] GR1-F-3: idx_growth_report_answers_report OK");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_growth_report_answers_parent
      ON growth_report_answers (parent_account_id, answered_at DESC);
  `));
  console.log("[GR1-init] GR1-F-4: idx_growth_report_answers_parent OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * initGrowthReportGR1Schema — GR1 Migration 진입점
 *
 * 전제:
 *   - initXModePart2Schema()가 먼저 실행되어 growth_reports 테이블이 존재해야 함.
 *
 * 실행:
 *   pool-db-init.ts 또는 별도 admin script에서 호출.
 *   Production에서는 별도 승인 후 실행.
 */
export async function initGrowthReportGR1Schema(): Promise<void> {
  const db = superAdminDb;

  const groups: { name: string; fn: (db: Db) => Promise<void> }[] = [
    { name: "GR1-A: ENUM 타입",              fn: runGroupA_Enums },
    { name: "GR1-B: growth_report_cycles",  fn: runGroupB_Cycles },
    { name: "GR1-C: growth_reports 컬럼 추가", fn: runGroupC_GrowthReportsColumns },
    { name: "GR1-D: growth_reports 인덱스",  fn: runGroupD_GrowthReportsIndexes },
    { name: "GR1-E: growth_report_questions", fn: runGroupE_Questions },
    { name: "GR1-F: growth_report_answers",  fn: runGroupF_Answers },
  ];

  for (const { name, fn } of groups) {
    try {
      await fn(db);
      console.log(`[GR1-init] ✅ ${name} 완료`);
    } catch (err) {
      console.error(`[GR1-init] ❌ ${name} 실패 — 이후 Migration 중단:`, err);
      throw err;
    }
  }

  console.log("[GR1-init] ✅ GR1 Migration 전체 완료 (Group A~F)");
}
