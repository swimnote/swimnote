/**
 * Canonical attendance dates are validated YYYY-MM-DD text, unlike the DATE
 * columns in student_class_history. Keep text comparisons and bound parameters;
 * do not cast legacy attendance rows or change their storage contract.
 * Export the exact statements so read-only SQL planning checks use route SQL.
 */
export const COURSE_ATTENDANCE_SQL = `
  SELECT a.id,a.student_id,a.class_group_id,a.date::text,a.status,
    COALESCE(ms.original_class_group_id,a.class_group_id) AS entitlement_class,
    COALESCE(ms.absence_date,a.date::text) AS entitlement_date
  FROM attendance a LEFT JOIN makeup_sessions ms ON ms.completed_attendance_id=a.id
    AND ms.swimming_pool_id=a.swimming_pool_id AND ms.cancelled_at IS NULL
  WHERE a.swimming_pool_id=$1 AND a.status IN ('present','late') AND a.date<=$2::text`;

export function historicalContractAttendanceSql(shortening: boolean): string {
  return `SELECT 1 FROM attendance a WHERE a.swimming_pool_id=$1 AND a.student_id=$2
    AND a.status IN ('present','late') AND a.date${shortening ? ">" : ">="}$3::text
    AND EXISTS(SELECT 1 FROM office_operation_records en WHERE en.pool_id=$1 AND en.resource='enrollments'
      AND en.data->>'contractId'=$4 AND en.data->>'classId'=a.class_group_id) LIMIT 1`;
}

export const POST_REFERENCE_ATTENDANCE_SQL =
  "SELECT DISTINCT student_id FROM attendance WHERE swimming_pool_id=$1 AND date>$2::text";
