-- Manual, additive migration. Never executed by API startup.
-- Production application requires separate approval.
BEGIN;
CREATE TABLE IF NOT EXISTS office_operation_records (
  id text PRIMARY KEY,
  pool_id text NOT NULL,
  resource text NOT NULL CHECK (resource IN
    ('contacts','products','contracts','sessions','enrollments','marketing','cards','imports')),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_operations_pool_resource
  ON office_operation_records(pool_id, resource, updated_at DESC, id);
CREATE UNIQUE INDEX IF NOT EXISTS office_active_card_unique
  ON office_operation_records(pool_id, (data->>'cardUid'))
  WHERE resource='cards' AND data->>'status'='active';
CREATE TABLE IF NOT EXISTS office_operation_versions (
  record_id text NOT NULL REFERENCES office_operation_records(id),
  revision integer NOT NULL,
  pool_id text NOT NULL,
  actor_id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(record_id, revision)
);
CREATE TABLE IF NOT EXISTS office_operation_receipts (
  pool_id text NOT NULL,
  request_id uuid NOT NULL,
  actor_id text NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(pool_id, request_id)
);
COMMIT;
