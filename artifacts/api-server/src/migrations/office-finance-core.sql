-- MANUAL ONLY. Apply office-admin-core.sql first. No application startup DDL.
BEGIN;
ALTER TABLE office_operation_records DROP CONSTRAINT IF EXISTS office_operation_records_resource_check;
ALTER TABLE office_operation_records ADD CONSTRAINT office_operation_records_resource_check
  CHECK (resource IN ('contacts','products','contracts','sessions','enrollments','marketing','cards','imports',
    'ledger','templates','applications','support','policies','tablet-invitations'));
CREATE UNIQUE INDEX IF NOT EXISTS office_ledger_sequence_unique
  ON office_operation_records(pool_id, ((data->>'sequence')::bigint)) WHERE resource='ledger';
CREATE INDEX IF NOT EXISTS office_ledger_date
  ON office_operation_records(pool_id,(data->>'date')) WHERE resource='ledger';
CREATE UNIQUE INDEX IF NOT EXISTS office_ledger_import_source_unique
  ON office_operation_records(pool_id,(data->>'importSourceKey'))
  WHERE resource='ledger' AND data->>'importSourceKey' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS office_tablet_token_unique
  ON office_operation_records((data->>'tokenHash')) WHERE resource='tablet-invitations';
CREATE TABLE IF NOT EXISTS office_finance_schema (
  version integer PRIMARY KEY CHECK(version=2),
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS office_nfc_notifications (
  attendance_id text PRIMARY KEY,
  pool_id text NOT NULL REFERENCES swimming_pools(id),
  student_id text NOT NULL REFERENCES students(id),
  status text NOT NULL,
  attempted_at timestamptz
);
INSERT INTO office_finance_schema(version) VALUES(2) ON CONFLICT DO NOTHING;
-- Recovery is additive/feature-off. Do not drop the ledger or signed documents.
COMMIT;
