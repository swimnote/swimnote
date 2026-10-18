/** One read model over existing business records. No new ledger or stored analytics.
 * Counts and selected page are produced by ONE statement / PostgreSQL snapshot.
 */
export const ACTIVITY_KINDS = ["members","registrations","renewals","attendance","makeups"] as const;
export type ActivityKind = typeof ACTIVITY_KINDS[number];
export const ACTIVITY_REPORT_SQL = `
WITH source AS (
  SELECT 'members'::text AS kind,s.id,s.id AS student_id,s.name,NULL::text AS date,
    s.status::text AS status,'현재 회원(기간 무관)'::text AS label
  FROM students s WHERE s.swimming_pool_id=$1 AND s.status NOT IN ('withdrawn','archived','deleted')
  UNION ALL
  SELECT CASE WHEN r.data->>'previousContractId' IS NOT NULL THEN 'renewals' ELSE 'registrations' END,
    r.id::text,r.data->>'studentId',COALESCE(s.name,r.data->>'studentId'),
    r.data->>'startDate',r.data->>'status','계약 시작일 기준'
  FROM office_operation_records r LEFT JOIN students s ON s.id=r.data->>'studentId' AND s.swimming_pool_id=$1
  WHERE r.pool_id=$1 AND r.resource='contracts' AND r.data->>'status'='active'
    AND r.data->>'startDate'>=$2 AND r.data->>'startDate'<=$3
  UNION ALL
  SELECT 'attendance',a.id,a.student_id,COALESCE(s.name,a.student_id),a.date,a.status::text,'출결 기록일 기준'
  FROM attendance a LEFT JOIN students s ON s.id=a.student_id AND s.swimming_pool_id=$1
  WHERE a.swimming_pool_id=$1 AND a.date>=$2 AND a.date<=$3
  UNION ALL
  SELECT 'makeups',m.id,m.student_id,COALESCE(s.name,m.student_id),m.absence_date,m.status,'보강 원 결석일 기준'
  FROM makeup_sessions m LEFT JOIN students s ON s.id=m.student_id AND s.swimming_pool_id=$1
  WHERE m.swimming_pool_id=$1 AND m.absence_date>=$2 AND m.absence_date<=$3
), filtered AS (
  SELECT * FROM source WHERE ($8='' OR student_id=$8)
    AND ($4='' OR name ILIKE '%'||$4||'%' OR id ILIKE '%'||$4||'%')
), page AS (
  SELECT * FROM filtered WHERE kind=$5 ORDER BY date DESC NULLS LAST,name,id LIMIT $7 OFFSET $6
)
SELECT COALESCE((SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,COUNT(*)::int AS n FROM filtered GROUP BY kind) c),'{}'::jsonb) AS counts,
  (SELECT COUNT(*)::int FROM filtered WHERE kind=$5) AS total,
  COALESCE((SELECT jsonb_agg(p ORDER BY date DESC NULLS LAST,name,id) FROM page p),'[]'::jsonb) AS items
`;
