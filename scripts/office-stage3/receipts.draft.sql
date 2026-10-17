-- LOCAL DRAFT ONLY. Never imported by API startup. Apply only to a verified isolated DB.
-- Production schema/role/retention approval is separate.
CREATE TABLE office_command_receipts (
  request_id text PRIMARY KEY CHECK (request_id ~ '^os1_[0-9a-f-]{36}$'),
  pool_id text NOT NULL,
  actor_id text NOT NULL,
  member_id text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  action text NOT NULL CHECK (action IN ('update','move')),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  execute_before timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '5 minutes'),
  confirm_before timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
  completed_at timestamptz,
  -- Only IDs, revision, action and changed field names. No names/phones/memo/before/after.
  result jsonb,
  CHECK (execute_before > issued_at AND confirm_before > execute_before),
  CHECK ((completed_at IS NULL AND result IS NULL) OR
         (completed_at IS NOT NULL AND result IS NOT NULL))
);
CREATE INDEX office_command_receipts_expiry ON office_command_receipts(confirm_before);
REVOKE ALL ON office_command_receipts FROM PUBLIC;
-- No automatic cleanup registration or generic service-role GRANT.
-- After approval, the actual API role needs SELECT/INSERT/UPDATE; cleanup role needs DELETE.
-- Retention contract: keep until confirm_before. Missing rows ALWAYS fail closed for execution.
-- A separately approved cleanup may DELETE WHERE confirm_before < clock_timestamp().
