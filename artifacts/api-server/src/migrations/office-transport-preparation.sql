-- NEW, additive preparation slice. Not applied by startup or by schema 2 deployment.
-- Requires a separate approval for this migration and the matching source commit.
BEGIN;
CREATE TABLE IF NOT EXISTS office_transport_records (
  id text PRIMARY KEY,
  pool_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('vehicle','stop','plan')),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS office_transport_pool_kind ON office_transport_records(pool_id,kind,id);
CREATE UNIQUE INDEX IF NOT EXISTS office_transport_active_plate ON office_transport_records(pool_id,(data->>'plate'))
  WHERE kind='vehicle' AND data->>'status'='active';
CREATE TABLE IF NOT EXISTS office_transport_snapshots (
  id text PRIMARY KEY,
  pool_id text NOT NULL,
  plan_id text NOT NULL REFERENCES office_transport_records(id),
  plan_revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pool_id,plan_id,plan_revision)
);
CREATE INDEX IF NOT EXISTS office_transport_snapshot_pool ON office_transport_snapshots(pool_id,approved_at DESC,id);
CREATE OR REPLACE FUNCTION office_transport_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved transport snapshots are append-only; create a new draft revision';
END $$;
CREATE TRIGGER office_transport_snapshot_no_mutation BEFORE UPDATE OR DELETE ON office_transport_snapshots
  FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
COMMIT;
