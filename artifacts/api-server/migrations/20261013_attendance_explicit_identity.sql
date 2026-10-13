-- Approved explicit-only identity. No legacy row UPDATE/DELETE/normalization.
-- Recheck duplicates under the table lock before building the index.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE attendance IN SHARE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM attendance
    WHERE class_group_id IS NOT NULL AND session_type IS NOT NULL
    GROUP BY student_id, class_group_id, date, session_type HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HOLD: explicit attendance identity duplicates';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_explicit_identity_unique
  ON attendance (student_id, class_group_id, date, session_type)
  WHERE class_group_id IS NOT NULL AND session_type IS NOT NULL;
COMMIT;
