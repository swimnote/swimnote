/**
 * gauge-01-progress-tables.ts — GAUGE-01: Curriculum Progress Gauge DB Foundation
 *
 * 실행 정책:
 *   - 멱등성: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
 *   - Additive only: 기존 테이블/컬럼 삭제·rename 금지
 *   - 실패 즉시 throw: catch(() => {}) 금지
 *   - Production migration 실행 금지 (사용자 승인 후 별도 실행)
 *   - startup auto-run 금지 (pool-db-init.ts 연결 금지)
 *
 * Migration Groups:
 *   GAUGE-01-A: curriculum_progress_observations (CPO)
 *   GAUGE-01-B: student_curriculum_progress (SCP)
 *
 * 의존성:
 *   GAUGE-01-A → curriculum_items, curriculum_versions (pool-db-x-init.ts Group 4~5)
 *   GAUGE-01-A → class_diaries (pool-db-init.ts Group 9) — lesson_session FK
 *   GAUGE-01-B → curriculum_versions (pool-db-x-init.ts Group 6-1) — active/prev version FK
 *
 * 핵심 설계 원칙 (V3 FINAL):
 *   1. CPO UNIQUE(lesson_session_id, student_id): session당 학생 관찰 1개
 *   2. observation_type ↔ is_gauge_eligible CHECK 일관성 강제
 *   3. SCP: active_confirmed_pct (version 내부) vs display_confirmed_pct (cross-version MAX)
 *      → display는 절대 감소 금지 (cross-version rank MAX 비교 금지)
 *   4. Evidence null → UNVERIFIED → is_gauge_eligible=false (fail-closed)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";

type Db = typeof superAdminDb;

// ─────────────────────────────────────────────────────────────────────────────
// Group GAUGE-01-A: curriculum_progress_observations (CPO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CPO — 학생의 실제 수업 세션당 커리큘럼 진도 관찰값.
 *
 * 핵심 구조:
 *   - UNIQUE(lesson_session_id, student_id): 수업 1회당 학생 관찰 1개
 *   - observation_type 6종: ACTUAL_TAUGHT / REVIEW / CORRECTION / FUTURE_PLAN / PAST_REFERENCE / UNVERIFIED
 *   - CHECK: eligible type ↔ is_gauge_eligible 일관성 강제
 *   - FK → curriculum_items, curriculum_versions ON DELETE RESTRICT
 *
 * 진도 게이지 eligible 조건 (is_gauge_eligible=true):
 *   ACTUAL_TAUGHT / REVIEW / CORRECTION
 *
 * 게이지 제외 (is_gauge_eligible=false):
 *   FUTURE_PLAN / PAST_REFERENCE / UNVERIFIED(null evidence = fail-closed)
 */
async function runGroupA_CurriculumProgressObservations(db: Db): Promise<void> {
  // ── CPO 테이블 생성 ──────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS curriculum_progress_observations (
      id                      text        PRIMARY KEY
                                DEFAULT ('cpo_' || replace(gen_random_uuid()::text,'-','')),

      -- 학생 / 풀 / 수업 세션 식별
      student_id              text        NOT NULL,
      swimming_pool_id        text        NOT NULL,
      lesson_session_id       text        NOT NULL,  -- class_diaries.id ('cd_xxx')
      last_diary_note_id      text,                  -- 가장 최근 갱신에 쓰인 csn_xxx (nullable: teacher_manual)

      -- 커리큘럼 위치 (관찰 당시 snapshot — 1-based ROW_NUMBER 기준)
      curriculum_version_id   text        NOT NULL,
      curriculum_item_id      text        NOT NULL,  -- MAX(rank) 기준 대표 item
      observed_progress_rank  integer     NOT NULL,  -- 1-based ROW_NUMBER() OVER (ORDER BY sort_order ASC)
      observed_total_count    integer     NOT NULL,  -- 관찰 당시 active item 총 수
      observed_progress_pct   numeric(5,2) NOT NULL, -- rank/total*100 (display cache)

      -- 증거 분류
      observation_type        text        NOT NULL,
      is_gauge_eligible       boolean     NOT NULL,
      evidence_source         text        NOT NULL,
      evidence_text_snippet   text,                  -- 분류 근거 문장 (최대 200자)
      mapping_confidence      numeric(4,3) NOT NULL,

      -- 무결성
      is_invalidated          boolean     NOT NULL DEFAULT false,
      invalidated_at          timestamptz,
      invalidated_reason      text,

      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now(),

      -- ── UNIQUE: 수업 세션당 학생 관찰 1개 (V3 핵심) ─────────────────────────
      CONSTRAINT uq_cpo_session_student
        UNIQUE (lesson_session_id, student_id),

      -- ── observation_type 허용값 ──────────────────────────────────────────────
      CONSTRAINT chk_cpo_observation_type
        CHECK (observation_type IN (
          'ACTUAL_TAUGHT', 'REVIEW', 'CORRECTION',
          'FUTURE_PLAN', 'PAST_REFERENCE', 'UNVERIFIED'
        )),

      -- ── eligible ↔ type 일관성 강제 (V3 핵심) ───────────────────────────────
      CONSTRAINT chk_cpo_eligible_type_consistency
        CHECK (
          (is_gauge_eligible = true  AND observation_type IN ('ACTUAL_TAUGHT', 'REVIEW', 'CORRECTION'))
          OR
          (is_gauge_eligible = false AND observation_type IN ('FUTURE_PLAN', 'PAST_REFERENCE', 'UNVERIFIED'))
        ),

      -- ── evidence_source 허용값 ────────────────────────────────────────────────
      CONSTRAINT chk_cpo_evidence_source
        CHECK (evidence_source IN ('teacher_ai', 'teacher_manual')),

      -- ── 진도 rank / pct 범위 ─────────────────────────────────────────────────
      CONSTRAINT chk_cpo_rank_positive
        CHECK (observed_progress_rank >= 1),

      CONSTRAINT chk_cpo_total_count_positive
        CHECK (observed_total_count >= 1),

      CONSTRAINT chk_cpo_pct_range
        CHECK (observed_progress_pct >= 0 AND observed_progress_pct <= 100),

      -- ── confidence 범위 ───────────────────────────────────────────────────────
      CONSTRAINT chk_cpo_confidence
        CHECK (mapping_confidence >= 0 AND mapping_confidence <= 1),

      -- ── evidence_text_snippet 길이 ────────────────────────────────────────────
      CONSTRAINT chk_cpo_snippet_len
        CHECK (evidence_text_snippet IS NULL OR length(evidence_text_snippet) <= 200),

      -- ── invalidated 일관성 ────────────────────────────────────────────────────
      CONSTRAINT chk_cpo_invalidated_consistency
        CHECK (
          (is_invalidated = false AND invalidated_at IS NULL)
          OR
          (is_invalidated = true  AND invalidated_at IS NOT NULL)
        ),

      -- ── invalidated_reason 허용값 ─────────────────────────────────────────────
      CONSTRAINT chk_cpo_invalidated_reason
        CHECK (
          invalidated_reason IS NULL
          OR invalidated_reason IN ('diary_edit', 'diary_delete', 'admin_reset')
        )
    );
  `));
  console.log("[GAUGE-01] GAUGE-01-A-1: curriculum_progress_observations 테이블 OK");

  // ── FK: curriculum_item_id → curriculum_items ON DELETE RESTRICT ──────────
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE curriculum_progress_observations
        ADD CONSTRAINT fk_cpo_curriculum_item
          FOREIGN KEY (curriculum_item_id)
          REFERENCES curriculum_items(id)
          ON DELETE RESTRICT;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GAUGE-01] GAUGE-01-A-2: FK curriculum_item_id → curriculum_items OK");

  // ── FK: curriculum_version_id → curriculum_versions ON DELETE RESTRICT ────
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE curriculum_progress_observations
        ADD CONSTRAINT fk_cpo_curriculum_version
          FOREIGN KEY (curriculum_version_id)
          REFERENCES curriculum_versions(id)
          ON DELETE RESTRICT;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GAUGE-01] GAUGE-01-A-3: FK curriculum_version_id → curriculum_versions OK");

  // ── FK: lesson_session_id → class_diaries ON DELETE RESTRICT ─────────────
  // class_diaries는 soft-delete(is_deleted flag) 방식이므로 RESTRICT가 안전.
  // hard-delete는 업무상 발생하지 않으며, 수업 세션 삭제 시 CPO를 먼저 정리해야 함.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE curriculum_progress_observations
        ADD CONSTRAINT fk_cpo_lesson_session
          FOREIGN KEY (lesson_session_id)
          REFERENCES class_diaries(id)
          ON DELETE RESTRICT;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GAUGE-01] GAUGE-01-A-4: FK lesson_session_id → class_diaries OK");

  // ── 인덱스 4개 ───────────────────────────────────────────────────────────────

  // 1. 유효 eligible CPO 조회 (confirmation engine 주 쿼리)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cpo_student_pool_eligible
      ON curriculum_progress_observations (student_id, swimming_pool_id)
      WHERE is_invalidated = false AND is_gauge_eligible = true;
  `));

  // 2. student rank DESC 스캔 (confirmation algorithm Step 3)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cpo_student_rank
      ON curriculum_progress_observations (student_id, observed_progress_rank DESC)
      WHERE is_invalidated = false AND is_gauge_eligible = true;
  `));

  // 3. session/student 조회 (EDIT/DELETE 재계산 경로 — is_invalidated 무관)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cpo_session_student
      ON curriculum_progress_observations (lesson_session_id, student_id);
  `));

  // 4. version별 student CPO (version 전환 시 격리 확인)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_cpo_version_student
      ON curriculum_progress_observations (curriculum_version_id, student_id)
      WHERE is_invalidated = false;
  `));

  console.log("[GAUGE-01] GAUGE-01-A-5~8: indexes 4개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group GAUGE-01-B: student_curriculum_progress (SCP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SCP — 학생의 최종 확정 진도 (학부모 게이지 표시용).
 *
 * 핵심 설계:
 *   active_* : 현재 active curriculum version 내부 좌표 (version 내부 비교 전용)
 *   display_confirmed_pct: cross-version monotonic percent
 *     = MAX(prev_display_confirmed_pct, active_confirmed_pct)
 *     → curriculum version 변경만으로 게이지 하락 금지
 *     → cross-version rank MAX 비교 금지 (rank는 version 내부 전용)
 *
 * 불변조건:
 *   display_confirmed_pct >= 0 always
 *   display_confirmed_pct는 reset endpoint 없이는 감소 불가
 */
async function runGroupB_StudentCurriculumProgress(db: Db): Promise<void> {
  // ── SCP 테이블 생성 ──────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS student_curriculum_progress (
      id                              text        PRIMARY KEY
                                        DEFAULT ('scp_' || replace(gen_random_uuid()::text,'-','')),

      student_id                      text        NOT NULL,
      swimming_pool_id                text        NOT NULL,

      -- ── Active version 내부 좌표 (version별 비교 전용) ────────────────────────
      -- 주의: cross-version에서 active_confirmed_rank MAX 비교 금지
      -- rank는 해당 version의 ROW_NUMBER() 기준이며 version이 바뀌면 의미가 달라짐
      active_curriculum_version_id    text        NOT NULL,
      active_confirmed_rank           integer     NOT NULL DEFAULT 0,
      active_confirmed_total          integer     NOT NULL DEFAULT 0,
      active_confirmed_pct            numeric(5,2) NOT NULL DEFAULT 0,
        -- = ROUND(active_confirmed_rank / active_confirmed_total * 100, 1)
        -- version 내부 비교만. cross-version MAX에는 사용 금지.

      -- ── 학부모 표시용 게이지 (cross-version monotonic) ──────────────────────
      -- display_confirmed_pct = MAX(이전_display_pct, active_confirmed_pct)
      -- 절대 감소 금지 (admin reset endpoint 별도 구현 전까지)
      display_confirmed_pct           numeric(5,2) NOT NULL DEFAULT 0,

      -- ── 확정 이력 ────────────────────────────────────────────────────────────
      confirmed_at                    timestamptz NOT NULL DEFAULT now(),
      display_updated_at              timestamptz NOT NULL DEFAULT now(),
      observation_session_count       integer     NOT NULL DEFAULT 0,
        -- 현재 active version 기준 유효 session 수 (게이지 신뢰도 표시용)

      -- ── Version 전환 이력 (PHASE 1~3 추적) ──────────────────────────────────
      prev_curriculum_version_id      text,       -- 직전 active version ID
      prev_display_pct                numeric(5,2), -- 전환 직전 display_confirmed_pct

      updated_at                      timestamptz NOT NULL DEFAULT now(),

      -- ── UNIQUE: student/pool당 1개 ───────────────────────────────────────────
      CONSTRAINT uq_scp_student_pool
        UNIQUE (student_id, swimming_pool_id),

      -- ── percent 범위 CHECK ────────────────────────────────────────────────────
      CONSTRAINT chk_scp_display_pct_range
        CHECK (display_confirmed_pct >= 0 AND display_confirmed_pct <= 100),

      CONSTRAINT chk_scp_active_pct_range
        CHECK (active_confirmed_pct >= 0 AND active_confirmed_pct <= 100),

      CONSTRAINT chk_scp_prev_pct_range
        CHECK (prev_display_pct IS NULL OR
               (prev_display_pct >= 0 AND prev_display_pct <= 100)),

      -- ── rank / total 비음수 ───────────────────────────────────────────────────
      CONSTRAINT chk_scp_rank_non_negative
        CHECK (active_confirmed_rank >= 0),

      CONSTRAINT chk_scp_total_non_negative
        CHECK (active_confirmed_total >= 0),

      CONSTRAINT chk_scp_session_count_non_negative
        CHECK (observation_session_count >= 0)
    );
  `));
  console.log("[GAUGE-01] GAUGE-01-B-1: student_curriculum_progress 테이블 OK");

  // ── FK: active_curriculum_version_id → curriculum_versions ON DELETE RESTRICT
  // SCP는 항상 유효한 active version을 가리켜야 함.
  // version 삭제 전 SCP 정리(active_version 교체) 필수 — RESTRICT로 강제.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE student_curriculum_progress
        ADD CONSTRAINT fk_scp_active_version
          FOREIGN KEY (active_curriculum_version_id)
          REFERENCES curriculum_versions(id)
          ON DELETE RESTRICT;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GAUGE-01] GAUGE-01-B-2: FK active_curriculum_version_id → curriculum_versions OK");

  // ── FK: prev_curriculum_version_id → curriculum_versions ON DELETE RESTRICT (nullable)
  // version 전환 이력 추적용. NULL = 최초 version (이전 없음). RESTRICT 유지.
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TABLE student_curriculum_progress
        ADD CONSTRAINT fk_scp_prev_version
          FOREIGN KEY (prev_curriculum_version_id)
          REFERENCES curriculum_versions(id)
          ON DELETE RESTRICT;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));
  console.log("[GAUGE-01] GAUGE-01-B-3: FK prev_curriculum_version_id → curriculum_versions (nullable) OK");

  // ── 인덱스 2개 ───────────────────────────────────────────────────────────────

  // 1. 게이지 조회 (parent home API 주 경로)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_scp_student_pool
      ON student_curriculum_progress (student_id, swimming_pool_id);
  `));

  // 2. version 전환 감지 (confirmation engine)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_scp_version
      ON student_curriculum_progress (active_curriculum_version_id);
  `));

  console.log("[GAUGE-01] GAUGE-01-B-4~5: indexes 2개 OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * initGauge01Schema — GAUGE-01 Migration 진입점
 *
 * 실행 전 전제:
 *   - pool-db-x-init.ts Group 4 (curriculum_versions, curriculum_items) 이미 존재해야 함.
 *   - pool-db-init.ts (class_diaries) 이미 존재해야 함.
 *
 * 실행:
 *   별도 admin script에서만 호출.
 *   Production에서는 사용자 승인 후 별도 실행.
 *   startup migration (pool-db-init.ts 등) 연결 금지.
 */
export async function initGauge01Schema(): Promise<void> {
  const db = superAdminDb;

  const groups: { name: string; fn: (db: Db) => Promise<void> }[] = [
    {
      name: "GAUGE-01-A: curriculum_progress_observations",
      fn: runGroupA_CurriculumProgressObservations,
    },
    {
      name: "GAUGE-01-B: student_curriculum_progress",
      fn: runGroupB_StudentCurriculumProgress,
    },
  ];

  for (const { name, fn } of groups) {
    try {
      await fn(db);
      console.log(`[GAUGE-01] ✅ ${name} 완료`);
    } catch (err) {
      console.error(`[GAUGE-01] ❌ ${name} 실패 — 이후 Migration 중단:`, err);
      throw err;
    }
  }

  console.log("[GAUGE-01] ✅ GAUGE-01 Migration 전체 완료 (Group A~B)");
}

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 지원 — SQL 문자열 추출 헬퍼 (production 코드에서 미사용)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 테스트에서 schema 구조 검증 시 사용.
 * 실제 DB를 열지 않고 DDL 문자열 분석만 수행.
 */
export const GAUGE01_SCHEMA_TOKENS = {
  CPO_TABLE_NAME: "curriculum_progress_observations",
  SCP_TABLE_NAME: "student_curriculum_progress",

  // CPO 핵심 UNIQUE
  CPO_UNIQUE: "uq_cpo_session_student",
  CPO_UNIQUE_COLS: "(lesson_session_id, student_id)",

  // CPO CHECK 제약
  CPO_CHECK_TYPE: "chk_cpo_observation_type",
  CPO_CHECK_ELIGIBLE: "chk_cpo_eligible_type_consistency",
  CPO_CHECK_INVALIDATED: "chk_cpo_invalidated_consistency",
  CPO_CHECK_PCT_RANGE: "chk_cpo_pct_range",

  // CPO FK
  CPO_FK_ITEM: "fk_cpo_curriculum_item",
  CPO_FK_VERSION: "fk_cpo_curriculum_version",
  CPO_FK_LESSON_SESSION: "fk_cpo_lesson_session",   // → class_diaries ON DELETE RESTRICT
  CPO_FK_RESTRICT: "ON DELETE RESTRICT",

  // SCP FK
  SCP_FK_ACTIVE_VERSION: "fk_scp_active_version",   // → curriculum_versions ON DELETE RESTRICT
  SCP_FK_PREV_VERSION: "fk_scp_prev_version",        // → curriculum_versions ON DELETE RESTRICT (nullable)

  // CPO 허용 observation_type 값
  CPO_ELIGIBLE_TYPES: ["ACTUAL_TAUGHT", "REVIEW", "CORRECTION"] as const,
  CPO_INELIGIBLE_TYPES: ["FUTURE_PLAN", "PAST_REFERENCE", "UNVERIFIED"] as const,

  // SCP
  SCP_UNIQUE: "uq_scp_student_pool",
  SCP_CHECK_DISPLAY: "chk_scp_display_pct_range",
  SCP_CHECK_ACTIVE: "chk_scp_active_pct_range",

  // CPO 인덱스
  CPO_IDX_ELIGIBLE: "idx_cpo_student_pool_eligible",
  CPO_IDX_RANK: "idx_cpo_student_rank",
  CPO_IDX_SESSION: "idx_cpo_session_student",
  CPO_IDX_VERSION: "idx_cpo_version_student",

  // SCP 인덱스
  SCP_IDX_POOL: "idx_scp_student_pool",
  SCP_IDX_VERSION: "idx_scp_version",
} as const;

/**
 * eligible_type_consistency 검증 순수 함수.
 * DB CHECK 제약과 동일한 로직 — 테스트 TC5에서 직접 호출.
 */
export function validateEligibleTypeConsistency(
  observationType: string,
  isGaugeEligible: boolean,
): { valid: boolean; reason?: string } {
  const eligibleTypes = new Set(["ACTUAL_TAUGHT", "REVIEW", "CORRECTION"]);
  const ineligibleTypes = new Set(["FUTURE_PLAN", "PAST_REFERENCE", "UNVERIFIED"]);

  if (isGaugeEligible) {
    if (!eligibleTypes.has(observationType)) {
      return {
        valid: false,
        reason: `observation_type='${observationType}' with is_gauge_eligible=true violates CHECK constraint`,
      };
    }
  } else {
    if (!ineligibleTypes.has(observationType)) {
      return {
        valid: false,
        reason: `observation_type='${observationType}' with is_gauge_eligible=false violates CHECK constraint`,
      };
    }
  }

  return { valid: true };
}

/**
 * percent 범위 검증 순수 함수.
 * DB CHECK 제약과 동일한 로직 — 테스트 TC6에서 직접 호출.
 */
export function validateProgressPct(pct: number): { valid: boolean; reason?: string } {
  if (pct < 0 || pct > 100) {
    return {
      valid: false,
      reason: `progress_pct=${pct} is out of range [0, 100]`,
    };
  }
  return { valid: true };
}

/**
 * display monotonic 규칙 검증 순수 함수.
 * SCP UPSERT 로직이 반드시 따라야 할 cross-version monotonic 규칙.
 * rank 비교 금지 — percent 비교만 허용.
 */
export function computeDisplayConfirmedPct(
  prevDisplayPct: number,
  newlyConfirmedActivePct: number,
): number {
  // cross-version rank MAX 비교 금지.
  // percent MAX만 허용.
  return Math.max(prevDisplayPct, newlyConfirmedActivePct);
}
