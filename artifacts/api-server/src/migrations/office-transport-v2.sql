-- Separate operating approval required. No startup execution. Preserves V1 preparation records.
BEGIN;
ALTER TABLE parent_students ADD COLUMN IF NOT EXISTS transport_notify boolean NOT NULL DEFAULT false;
CREATE TABLE office_transport_memberships (
 id text PRIMARY KEY, pool_id text NOT NULL, principal_type text NOT NULL CHECK(principal_type IN ('users','parent_accounts')),
 principal_id text NOT NULL, name text NOT NULL, duty text NOT NULL CHECK(duty IN ('DRIVER','ESCORT')),
 status text NOT NULL CHECK(status IN ('INVITED','ACTIVE','REVOKED')),
 invite_hash text UNIQUE, expires_at timestamptz, accepted_at timestamptz, revoked_at timestamptz,
 invited_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX office_transport_member_live ON office_transport_memberships(pool_id,principal_type,principal_id,duty) WHERE status<>'REVOKED';
CREATE TABLE office_transport_runs (
 id text PRIMARY KEY, pool_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN ('DRAFT','APPROVED','PUBLISHED','ACTIVE','CLOSED')),
 plan jsonb NOT NULL, approved_hash text, pending_plan jsonb, pending_revision integer,
 pending_status text CHECK(pending_status IN ('DRAFT','APPROVED')), pending_hash text, created_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX office_transport_runs_pool ON office_transport_runs(pool_id,(plan->>'date'));
CREATE TABLE office_transport_run_versions (
 run_id text NOT NULL REFERENCES office_transport_runs(id), revision integer NOT NULL,
 pool_id text NOT NULL, plan jsonb NOT NULL, content_hash text NOT NULL, approved_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,revision)
);
CREATE TABLE office_transport_events (
 seq bigserial UNIQUE, request_id uuid PRIMARY KEY, run_id text NOT NULL REFERENCES office_transport_runs(id),
 pool_id text NOT NULL, revision integer NOT NULL, actor text NOT NULL,
 payload jsonb NOT NULL, device_at timestamptz NOT NULL, server_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX office_transport_events_run ON office_transport_events(run_id,seq);
CREATE TABLE office_transport_notification_intents (
 event_id uuid NOT NULL REFERENCES office_transport_events(request_id), parent_id text NOT NULL,
 student_id text NOT NULL, pool_id text NOT NULL, state text NOT NULL DEFAULT 'HELD_FOR_DISPATCH_APPROVAL',
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(event_id,parent_id,student_id)
);
CREATE TABLE office_transport_preferences (
 pool_id text NOT NULL, student_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 data jsonb NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(pool_id,student_id)
);
CREATE TABLE office_transport_vehicle_availability (
 pool_id text NOT NULL, vehicle_id text NOT NULL, revision integer NOT NULL DEFAULT 1,
 data jsonb NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(pool_id,vehicle_id)
);
-- No trigger/function replacement, reverse migration or schema-2 rerun.
CREATE TRIGGER office_transport_versions_immutable BEFORE UPDATE OR DELETE ON office_transport_run_versions
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
CREATE TRIGGER office_transport_events_immutable BEFORE UPDATE OR DELETE ON office_transport_events
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
COMMIT;
