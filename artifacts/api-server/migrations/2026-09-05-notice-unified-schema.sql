-- WP4: notices canonical extension + notice_dismissals
-- Additive only. No DROP, no TRUNCATE, no data loss.
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING patterns).

-- ── 1. Extend notices table (additive) ────────────────────────────────────────
ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS show_banner      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_push        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_roles     text[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_pools     text[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS starts_at        timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ends_at          timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deep_link        text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS target_plan_types text[] DEFAULT NULL;

-- ── 2. notice_dismissals (banner "다시 보지 않기") ────────────────────────────
-- Separate from notice_reads. Dismissal ≠ read.
CREATE TABLE IF NOT EXISTS notice_dismissals (
  id           text        NOT NULL DEFAULT gen_random_uuid()::text,
  notice_id    text        NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id      text        NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_notice_dismissals        PRIMARY KEY (id),
  CONSTRAINT notice_dismissal_uniq       UNIQUE  (notice_id, user_id)
);

-- ── 3. Indexes ─────────────────────────────────────────────────────────────────
-- dismissal lookup: "has this user dismissed this notice?"
CREATE INDEX IF NOT EXISTS idx_notice_dismissals_user_id
  ON notice_dismissals (user_id);

CREATE INDEX IF NOT EXISTS idx_notice_dismissals_notice_id
  ON notice_dismissals (notice_id);

-- banner candidate query index
CREATE INDEX IF NOT EXISTS idx_notices_show_banner
  ON notices (show_banner);
