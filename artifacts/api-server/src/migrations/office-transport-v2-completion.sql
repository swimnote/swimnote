-- Apply only after approved V1 + V2 migrations, never at startup. Additive; no existing OFFICE schema replay.
BEGIN;
CREATE TABLE office_transport_settings(
 pool_id text PRIMARY KEY, revision integer NOT NULL DEFAULT 1, data jsonb NOT NULL, updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE office_transport_observations(
 id uuid PRIMARY KEY, pool_id text NOT NULL, run_id text NOT NULL REFERENCES office_transport_runs(id),
 actor text NOT NULL, revision integer NOT NULL, command jsonb NOT NULL, plan jsonb NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE office_transport_resolutions(
 id uuid PRIMARY KEY, observation_id uuid NOT NULL UNIQUE REFERENCES office_transport_observations(id),
 pool_id text NOT NULL, decision text NOT NULL CHECK(decision IN ('LINK_EXISTING','RETAIN_OBSERVATION','ADOPT_ORIGINAL')),
 reason text NOT NULL, event_id uuid REFERENCES office_transport_events(request_id), resolved_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE office_transport_operations(
 id uuid PRIMARY KEY, pool_id text NOT NULL, vehicle_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('FUEL','MAINTENANCE','INSURANCE','INSPECTION')),
 data jsonb NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX office_transport_operations_pool_vehicle ON office_transport_operations(pool_id,vehicle_id);
CREATE TABLE office_transport_certifications(
 id uuid PRIMARY KEY, pool_id text NOT NULL, run_id text NOT NULL REFERENCES office_transport_runs(id),
 revision integer NOT NULL, content_hash text NOT NULL, signature text NOT NULL, reason text NOT NULL,
 signed_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,revision));
CREATE TABLE office_transport_join_invites(
 id uuid PRIMARY KEY, pool_id text NOT NULL, token_hash text NOT NULL UNIQUE, phone_hash text NOT NULL,
 duty text NOT NULL CHECK(duty IN ('DRIVER','ESCORT')), expires_at timestamptz NOT NULL, accepted_by text,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE office_transport_model_calls(
 request_id uuid PRIMARY KEY,pool_id text NOT NULL,actor text NOT NULL,input_hash text NOT NULL,
 approval_reference text NOT NULL,model text NOT NULL,max_tokens integer NOT NULL,
 state text NOT NULL CHECK(state IN ('SENDING','COMPLETED','FAILED_NO_RETRY')),result jsonb,error text,
 created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE office_transport_notification_intents ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE office_transport_notification_intents ADD COLUMN last_error text;
ALTER TABLE office_transport_notification_intents ADD COLUMN attempted_at timestamptz;
ALTER TABLE office_transport_notification_intents ADD COLUMN dispatch_key text;
CREATE UNIQUE INDEX office_transport_dispatch_key ON office_transport_notification_intents(dispatch_key);
CREATE TRIGGER office_transport_observations_immutable BEFORE UPDATE OR DELETE ON office_transport_observations
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
CREATE TRIGGER office_transport_resolutions_immutable BEFORE UPDATE OR DELETE ON office_transport_resolutions
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
CREATE TRIGGER office_transport_operations_immutable BEFORE UPDATE OR DELETE ON office_transport_operations
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
CREATE TRIGGER office_transport_certifications_immutable BEFORE UPDATE OR DELETE ON office_transport_certifications
 FOR EACH ROW EXECUTE FUNCTION office_transport_snapshot_immutable();
COMMIT;
