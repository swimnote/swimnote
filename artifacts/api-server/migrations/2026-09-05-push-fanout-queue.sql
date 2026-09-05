-- ============================================================
-- Migration: Push Fan-out Durable Queue (2026-09-05)
-- ============================================================
--
-- 목적:
--   1. push_fanout_jobs   — job-level durable queue (job_ref PRIMARY KEY = idempotency key)
--   2. push_fanout_deliveries — per-device delivery state (UNIQUE job_ref + push_token_id)
--
-- 완료조건:
--   - 동일 job_ref 재enqueue → job row 1개, delivery 중복 없음
--   - process restart 후 PENDING 잔여 delivery → worker 재처리
--   - SENT/PERMANENT_FAIL delivery → 재발송 없음
--
-- 실행 조건:
--   - Staging(lspmacdbyvpzysnrjsww)에서 검증 후 Production 수동 실행
--   - Runtime boot에서 자동 실행 금지
--
-- Rollback:
--   DROP TABLE IF EXISTS push_fanout_deliveries;
--   DROP TABLE IF EXISTS push_fanout_jobs;
-- ============================================================

BEGIN;

-- ── 1. push_fanout_jobs ──────────────────────────────────────────────────────
--   job_ref PRIMARY KEY = job-level idempotency source
--   status: PENDING | PROCESSING | COMPLETED | PARTIAL_FAILED | FAILED
CREATE TABLE IF NOT EXISTS push_fanout_jobs (
  job_ref        TEXT        PRIMARY KEY,
  job_type       TEXT        NOT NULL,             -- 'pool_parents' | 'all_users'
  target_ref     TEXT,                             -- poolId (pool_parents) | NULL (all_users)
  notif_type     TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  body_text      TEXT        NOT NULL,
  data_json      JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'PENDING',
  total_count    INTEGER     NOT NULL DEFAULT 0,
  sent_count     INTEGER     NOT NULL DEFAULT 0,
  failed_count   INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  worker_id      TEXT,
  locked_at      TIMESTAMPTZ,
  attempts       INTEGER     NOT NULL DEFAULT 0,
  error_summary  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Status index: worker polls PENDING jobs ordered by created_at
CREATE INDEX IF NOT EXISTS idx_push_fanout_jobs_status
  ON push_fanout_jobs (status, created_at);

-- ── 2. push_fanout_deliveries ────────────────────────────────────────────────
--   UNIQUE (job_ref, push_token_id) = delivery-level idempotency
--   push_token_id = push_tokens.id (existing table PK)
--   token_str     = denormalised Expo push token string for delivery
--   status: PENDING | SENT | FAILED | PERMANENT_FAIL
CREATE TABLE IF NOT EXISTS push_fanout_deliveries (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_ref        TEXT        NOT NULL REFERENCES push_fanout_jobs(job_ref) ON DELETE CASCADE,
  push_token_id  TEXT        NOT NULL,
  token_str      TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'PENDING',
  attempt_count  INTEGER     NOT NULL DEFAULT 0,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ,
  CONSTRAINT push_fanout_delivery_uniq UNIQUE (job_ref, push_token_id)
);

-- Job+status index: worker queries PENDING deliveries per job
CREATE INDEX IF NOT EXISTS idx_push_fanout_deliveries_job_status
  ON push_fanout_deliveries (job_ref, status);

COMMIT;
