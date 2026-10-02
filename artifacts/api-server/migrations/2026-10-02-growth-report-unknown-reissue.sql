CREATE TABLE IF NOT EXISTS growth_report_unknown_reissue_operations (
  id uuid PRIMARY KEY,
  report_id text NOT NULL,
  student_id text NOT NULL,
  swimming_pool_id text NOT NULL,
  report_period text NOT NULL,
  original_request_id uuid NOT NULL,
  new_request_id uuid NOT NULL,
  recovery_generation integer NOT NULL CHECK (recovery_generation > 0),
  expected_payload_hash text NOT NULL,
  original_payload jsonb NOT NULL,
  original_report_snapshot jsonb NOT NULL,
  original_uncertainty_snapshot jsonb NOT NULL,
  operator_subject text NOT NULL,
  operator_role text NOT NULL,
  approval_reason text NOT NULL,
  operator_reason text NOT NULL,
  approved_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN
    ('CREATED', 'PROCESSING', 'UNKNOWN', 'COMPLETE', 'FAILED', 'CONFLICT')),
  retryable boolean NOT NULL DEFAULT false,
  engine_confirmed_unknown boolean NOT NULL DEFAULT false,
  engine_response jsonb,
  error_code text,
  detail text,
  lease_until timestamptz,
  dispatch_token uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (original_request_id <> new_request_id),
  UNIQUE (original_request_id),
  UNIQUE (report_id, recovery_generation)
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_report_unknown_reissue_operation_id_uq
  ON growth_report_unknown_reissue_operations (id);
CREATE UNIQUE INDEX IF NOT EXISTS growth_report_unknown_reissue_new_request_id_uq
  ON growth_report_unknown_reissue_operations (new_request_id);
CREATE INDEX IF NOT EXISTS growth_report_unknown_reissue_report_created_idx
  ON growth_report_unknown_reissue_operations (report_id, created_at DESC);