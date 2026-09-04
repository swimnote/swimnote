/**
 * pool-db-x-payment-init.ts — SWIMNOTE X 결제 기반 DB Migration (X02-B1)
 *
 * 목적:
 *   1. paid/manual entitlement source 분리 기반 컬럼 추가
 *   2. Super Admin force disable 기반 컬럼 추가
 *   3. X 가맹번호/할인 slot 이력 테이블 신규 생성
 *   4. RevenueCat transaction binding 필드 준비
 *   5. 36개월 할인 기간 기록 기반 필드 준비
 *
 * ──────────────────────────────────────────────────────────────────
 * 실행 정책:
 *   - 멱등성: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS 패턴
 *   - 실패 즉시 throw: .catch(() => {}) 금지
 *   - 기존 xmode_entitlement 값 변경 금지
 *   - DROP/RESET/TRUNCATE 금지
 *   - mode resolver 변경 금지 (X02-B2에서 처리)
 *
 * Migration Group 순서:
 *   Group P1: x_slot_seq (SEQUENCE) + x_subscription_slots (TABLE + INDEXES)
 *   Group P2: swimming_pools 신규 컬럼 4개
 *   Group P3: Legacy backfill (x_manual_entitlement ← xmode_entitlement)
 *
 * 의존성:
 *   Group P1 → Group P2 (x_slot_id FK 대상 테이블 먼저)
 *   Group P2 → Group P3 (컬럼 존재 후 backfill)
 *
 * 안전 원칙 (§0):
 *   x_paid_entitlement  = false  (전 row — 실제 X 유료 구매 없음)
 *   x_manual_entitlement = xmode_entitlement (legacy manual X pool 보존)
 *   x_force_disabled    = false  (전 row)
 *   기존 xmode_entitlement 수정 금지
 * ──────────────────────────────────────────────────────────────────
 *
 * ⚠️  Production 실행 전 반드시 별도 승인 필요.
 * ⚠️  AI ENGINE Neon DB에 적용 금지. APP Production DB 전용.
 */
import { sql } from "drizzle-orm";
import type { MigrationDb } from "../lib/migration-db.js";

type Db = MigrationDb;

// ─────────────────────────────────────────────────────────────────────────────
// Group P1: x_slot_seq SEQUENCE + x_subscription_slots TABLE + INDEXES
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupP1_SlotTable(db: Db): Promise<void> {
  // ── P1-A: PostgreSQL SEQUENCE for slot numbers ────────────────────────────
  //
  // START 1, INCREMENT 1, NO CYCLE: 번호 재사용 금지, 결번 허용.
  // rollback으로 nextval이 소비되어도 정상 (결번 허용 정책).
  // CREATE SEQUENCE IF NOT EXISTS: PG 9.5+ 지원.

  await db.execute(sql.raw(`
    CREATE SEQUENCE IF NOT EXISTS x_slot_seq
      START 1
      INCREMENT 1
      NO CYCLE;
  `));
  console.log("[X-payment-init] P1-A: x_slot_seq SEQUENCE OK");

  // ── P1-B: x_subscription_slots 테이블 ────────────────────────────────────
  //
  // pool_id: swimming_pools.id (TEXT) 참조 — 의도적 FK 생략
  //   이유: swimming_pools.x_slot_id (GROUP P2)가 역방향 FK를 가지므로
  //         양방향 FK는 DEFERRABLE 없이 DML이 복잡해짐. 코드에서 강제.
  //
  // id: BIGSERIAL (table-internal PK, swimming_pools.x_slot_id가 참조)
  // sequence_number: nextval('x_slot_seq') 기반, 가맹번호 순번
  // franchise_number: 'x-NNNN' 포맷 (reserve API에서 생성, 여기서는 schema만)
  // tier_key: CHECK (tier1|tier2|tier3|standard)
  // status: CHECK (RESERVED|PURCHASED|RELEASED)
  // RC binding fields: 모두 nullable — X02-C purchase sync에서 채움
  // discount_started_at / discount_ends_at: 36개월 할인 기간 기록용 — X02-C에서 채움

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS x_subscription_slots (
      id                          bigserial       PRIMARY KEY,

      pool_id                     text            NOT NULL,

      sequence_number             integer         NOT NULL,
      franchise_number            text            NOT NULL,

      tier_key                    text            NOT NULL
                                    CHECK (tier_key IN
                                      ('tier1', 'tier2', 'tier3', 'standard')),

      store_product_id            text            NOT NULL,

      status                      text            NOT NULL DEFAULT 'RESERVED'
                                    CHECK (status IN
                                      ('RESERVED', 'PURCHASED', 'RELEASED')),

      reserved_by_user_id         text,

      reserved_at                 timestamptz     NOT NULL DEFAULT now(),
      payment_deadline_at         timestamptz     NOT NULL,

      purchased_at                timestamptz,
      released_at                 timestamptz,
      released_reason             text,

      discount_started_at         timestamptz,
      discount_ends_at            timestamptz,

      -- RevenueCat transaction binding (X02-C purchase sync에서 채워짐)
      rc_app_user_id              text,
      rc_original_app_user_id     text,
      rc_original_transaction_id  text,
      rc_latest_transaction_id    text,
      rc_environment              text,

      created_at                  timestamptz     NOT NULL DEFAULT now(),
      updated_at                  timestamptz     NOT NULL DEFAULT now()
    );
  `));
  console.log("[X-payment-init] P1-B: x_subscription_slots TABLE OK");

  // ── P1-C: UNIQUE constraints ───────────────────────────────────────────────

  // sequence_number UNIQUE — 멱등: DO $$ pg_constraint 패턴
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'x_subscription_slots_sequence_number_key'
          AND conrelid = 'x_subscription_slots'::regclass
      ) THEN
        ALTER TABLE x_subscription_slots
          ADD CONSTRAINT x_subscription_slots_sequence_number_key
          UNIQUE (sequence_number);
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL; END $$;
  `));

  // franchise_number UNIQUE
  await db.execute(sql.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'x_subscription_slots_franchise_number_key'
          AND conrelid = 'x_subscription_slots'::regclass
      ) THEN
        ALTER TABLE x_subscription_slots
          ADD CONSTRAINT x_subscription_slots_franchise_number_key
          UNIQUE (franchise_number);
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL; END $$;
  `));
  console.log("[X-payment-init] P1-C: UNIQUE constraints OK");

  // ── P1-D: INDEXES ─────────────────────────────────────────────────────────

  // pool_id 조회 (pool의 모든 slot 이력)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_x_slots_pool_id
      ON x_subscription_slots(pool_id);
  `));

  // status 조회
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_x_slots_status
      ON x_subscription_slots(status);
  `));

  // RESERVED deadline 조회 (background worker: 만료 slot 처리)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_x_slots_reserved_deadline
      ON x_subscription_slots(payment_deadline_at)
      WHERE status = 'RESERVED';
  `));

  // RC transaction binding 조회 (webhook 원래 pool 역추적)
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_x_slots_rc_transaction
      ON x_subscription_slots(rc_original_transaction_id)
      WHERE rc_original_transaction_id IS NOT NULL;
  `));

  // ── P1-E: PARTIAL UNIQUE INDEX — pool당 RESERVED 1개 제한 ────────────────
  //
  // 동일 pool이 결제 버튼 연타로 여러 RESERVED slot 확보 방지.
  // status='RESERVED' 조건 하에서만 pool_id UNIQUE 강제.
  //
  // PURCHASED/RELEASED row는 제외 → 복수 이력 허용 (§13 정책).

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_x_slots_one_reserved_per_pool
      ON x_subscription_slots(pool_id)
      WHERE status = 'RESERVED';
  `));

  console.log("[X-payment-init] P1-D·E: INDEXES + partial unique OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group P2: swimming_pools 신규 컬럼 4개
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupP2_PoolColumns(db: Db): Promise<void> {
  // ── x_slot_id: 현재 활성 slot 참조 FK ────────────────────────────────────
  //
  // x_subscription_slots(id)를 참조. nullable (예약/구매 전 NULL).
  // x_subscription_slots가 P1에서 먼저 생성되므로 FK 안전.

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_slot_id bigint
        REFERENCES x_subscription_slots(id);
  `));
  console.log("[X-payment-init] P2-A: swimming_pools.x_slot_id OK");

  // ── x_paid_entitlement: RC webhook 관리 (X02-B2에서 활성화) ─────────────
  //
  // 현재: DEFAULT false, webhook이 아직 이 컬럼을 쓰지 않음.
  // X02-B2 완료 후: handleXEntitlementEvent가 이 컬럼을 업데이트.

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_paid_entitlement boolean NOT NULL DEFAULT false;
  `));
  console.log("[X-payment-init] P2-B: swimming_pools.x_paid_entitlement OK");

  // ── x_manual_entitlement: Super Admin 관리 (X02-B2에서 활성화) ──────────
  //
  // 현재: DEFAULT false, Super Admin PATCH가 아직 이 컬럼을 쓰지 않음.
  // X02-B2 완료 후: PATCH /super/operators/:id/xmode가 이 컬럼을 업데이트.
  // Legacy backfill은 Group P3에서 처리.

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_manual_entitlement boolean NOT NULL DEFAULT false;
  `));
  console.log("[X-payment-init] P2-C: swimming_pools.x_manual_entitlement OK");

  // ── x_force_disabled: Super Admin 운영 차단용 ────────────────────────────
  //
  // true: paid/manual entitlement가 모두 있더라도 X 서비스 차단.
  // effective = (paid OR manual) AND NOT force_disabled (X02-B2에서 mode resolver 반영).
  // 현재: mode resolver가 아직 이 컬럼을 참조하지 않음.

  await db.execute(sql.raw(`
    ALTER TABLE swimming_pools
      ADD COLUMN IF NOT EXISTS x_force_disabled boolean NOT NULL DEFAULT false;
  `));
  console.log("[X-payment-init] P2-D: swimming_pools.x_force_disabled OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Group P3: Legacy Backfill
// ─────────────────────────────────────────────────────────────────────────────

async function runGroupP3_LegacyBackfill(db: Db): Promise<void> {
  // ── P3: x_manual_entitlement ← xmode_entitlement (legacy manual pool 보존) ──
  //
  // 보안 원칙 (§0):
  //   현재까지 SWIMNOTE X RevenueCat 실제 유료 구매 없음.
  //   기존 xmode_entitlement=true pool은 Super Admin이 수동 부여한 것.
  //   따라서 → x_manual_entitlement = true로 보존.
  //
  // 멱등 guard: x_manual_entitlement=false AND xmode_entitlement=true AND x_paid_entitlement=false
  //   - 이미 backfill된 row (x_manual_entitlement=true): 조건 불일치 → 스킵 ✅
  //   - X02-B2 이후 paid pool (x_paid_entitlement=true): 조건 불일치 → 스킵 ✅
  //   - 서버 재시작마다 실행되어도 안전 ✅
  //
  // x_paid_entitlement: 전 row false 유지 (DEFAULT false, 별도 UPDATE 없음).
  // x_force_disabled: 전 row false 유지 (DEFAULT false, 별도 UPDATE 없음).
  // 기존 xmode_entitlement: 수정 금지.

  await db.execute(sql.raw(`
    UPDATE swimming_pools
    SET x_manual_entitlement = true
    WHERE xmode_entitlement = true
      AND x_paid_entitlement = false
      AND x_manual_entitlement = false;
  `));
  console.log("[X-payment-init] P3: legacy backfill (xmode_entitlement → x_manual_entitlement) OK");
}

// ─────────────────────────────────────────────────────────────────────────────
// Export: initXPaymentSchema
// ─────────────────────────────────────────────────────────────────────────────

export async function initXPaymentSchema(db: MigrationDb): Promise<void> {
  console.log("[SWIMNOTE X PAYMENT] X02-B1 Migration 시작...");

  // Group P1: SEQUENCE + x_subscription_slots
  try {
    await runGroupP1_SlotTable(db);
    console.log("[SWIMNOTE X PAYMENT] Group P1 완료: x_slot_seq + x_subscription_slots");
  } catch (err) {
    console.error("[SWIMNOTE X PAYMENT] Group P1 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group P2: swimming_pools 신규 컬럼
  try {
    await runGroupP2_PoolColumns(db);
    console.log("[SWIMNOTE X PAYMENT] Group P2 완료: swimming_pools 컬럼 4개");
  } catch (err) {
    console.error("[SWIMNOTE X PAYMENT] Group P2 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // Group P3: Legacy backfill
  try {
    await runGroupP3_LegacyBackfill(db);
    console.log("[SWIMNOTE X PAYMENT] Group P3 완료: legacy backfill");
  } catch (err) {
    console.error("[SWIMNOTE X PAYMENT] Group P3 실패 — 이후 Migration 중단:", err);
    throw err;
  }

  // ── Group P4: x_plan_key (Super Admin manual plan 기록용) ────────────────
  try {
    await db.execute(sql`
      ALTER TABLE swimming_pools
        ADD COLUMN IF NOT EXISTS x_plan_key TEXT;
    `);
    console.log("[SWIMNOTE X PAYMENT] Group P4 완료: swimming_pools.x_plan_key OK");
  } catch (err) {
    console.error("[SWIMNOTE X PAYMENT] Group P4 실패:", err);
    throw err;
  }

  console.log("[SWIMNOTE X PAYMENT] ✅ X02-B1 Migration 완료");
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback SQL (실행하지 말 것 — 별도 승인 후 수동 실행)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ROLLBACK_SQL — 참고용 주석 (실행 함수 아님)
 *
 * 역순 실행. 각 단계는 독립적으로 실행 가능.
 *
 * -- Group P3 Rollback (backfill 원상복구)
 * UPDATE swimming_pools SET x_manual_entitlement = false WHERE x_paid_entitlement = false;
 *
 * -- Group P2 Rollback
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS x_force_disabled;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS x_manual_entitlement;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS x_paid_entitlement;
 * ALTER TABLE swimming_pools DROP COLUMN IF EXISTS x_slot_id;
 *
 * -- Group P1 Rollback (x_subscription_slots rows가 0일 때만)
 * DROP TABLE IF EXISTS x_subscription_slots;
 * DROP SEQUENCE IF EXISTS x_slot_seq;
 */
