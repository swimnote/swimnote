/**
 * 보강 완료 후보 탐지 (makeup_sessions 기반)
 *
 * ─ findMakeupResultCandidate   : 단건 조회 (link-result 검증용)
 * ─ findMakeupResultCandidatesBatch : 배치 조회 (GET /teacher/parent-requests N+1 방지)
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { PROCESSED_RESULT_TYPES } from "../constants/processed-result-types.js";

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface MakeupResultCandidate {
  type: typeof PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT;
  resultId: string;
  assignedDate: string | null;
  classGroupId: string | null;
  classGroupName: string | null;
  teacherName: string | null;
}

export interface CandidateResult {
  candidateCount: number;   // 0 / 1 / 2+
  candidate: MakeupResultCandidate | null;  // candidateCount===1 일 때만 채워짐
}

// ── 단건 조회 ─────────────────────────────────────────────────────────────────

export async function findMakeupResultCandidate({
  poolId, studentId, requestId, requestCreatedAt,
}: {
  poolId: string;
  studentId: string;
  requestId: string;
  requestCreatedAt: string | Date;
}): Promise<CandidateResult> {
  const rows = (await db.execute(sql`
    SELECT
      ms.id,
      ms.assigned_date,
      ms.assigned_class_group_id,
      ms.assigned_class_group_name,
      ms.assigned_teacher_name
    FROM makeup_sessions ms
    WHERE ms.swimming_pool_id = ${poolId}
      AND ms.student_id       = ${studentId}
      AND ms.status           = 'assigned'
      AND ms.created_at      >= ${requestCreatedAt}
      AND NOT EXISTS (
        SELECT 1 FROM parent_student_requests psr2
        WHERE psr2.processed_result_id   = ms.id
          AND psr2.processed_result_type = ${PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT}
          AND psr2.id                   <> ${requestId}
          AND psr2.status               <> 'cancelled'
      )
  `)).rows as any[];

  const candidateCount = rows.length;
  if (candidateCount !== 1) return { candidateCount, candidate: null };

  const row = rows[0];
  return {
    candidateCount: 1,
    candidate: {
      type:           PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT,
      resultId:       row.id,
      assignedDate:   row.assigned_date   ?? null,
      classGroupId:   row.assigned_class_group_id   ?? null,
      classGroupName: row.assigned_class_group_name ?? null,
      teacherName:    row.assigned_teacher_name     ?? null,
    },
  };
}

// ── 배치 조회 (N+1 방지) ──────────────────────────────────────────────────────

interface PendingMakeupRequest {
  id: string;
  student_id: string;
  created_at: string;
}

/**
 * 여러 pending makeup 요청에 대한 후보를 한 번의 배치 쿼리로 조회.
 * 반환: Map<request_id, CandidateResult>
 */
export async function findMakeupResultCandidatesBatch({
  poolId, pendingMakeupRequests,
}: {
  poolId: string;
  pendingMakeupRequests: PendingMakeupRequest[];
}): Promise<Map<string, CandidateResult>> {
  const result = new Map<string, CandidateResult>();
  if (pendingMakeupRequests.length === 0) return result;

  // 해당 학생들의 assigned makeup_sessions 전체 조회 (이미 다른 요청에 연결된 것 제외)
  const studentIds = [...new Set(pendingMakeupRequests.map(r => r.student_id))];
  const idList = studentIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",");

  const sessions = (await db.execute(sql.raw(`
    SELECT
      ms.id,
      ms.student_id,
      ms.assigned_date,
      ms.assigned_class_group_id,
      ms.assigned_class_group_name,
      ms.assigned_teacher_name,
      ms.created_at::text AS session_created_at
    FROM makeup_sessions ms
    WHERE ms.swimming_pool_id = '${poolId.replace(/'/g, "''")}'
      AND ms.student_id IN (${idList})
      AND ms.status = 'assigned'
      AND NOT EXISTS (
        SELECT 1 FROM parent_student_requests psr2
        WHERE psr2.processed_result_id   = ms.id
          AND psr2.processed_result_type = '${PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT}'
          AND psr2.status               <> 'cancelled'
      )
  `))).rows as any[];

  // 학생별로 세션을 그룹핑
  const byStudent = new Map<string, any[]>();
  for (const s of sessions) {
    const arr = byStudent.get(s.student_id) ?? [];
    arr.push(s);
    byStudent.set(s.student_id, arr);
  }

  // 각 요청별 후보 계산
  for (const req of pendingMakeupRequests) {
    const reqCreated = new Date(req.created_at).getTime();
    const eligible = (byStudent.get(req.student_id) ?? []).filter(s => {
      const sCreated = new Date(s.session_created_at).getTime();
      return sCreated >= reqCreated;
    });

    const count = eligible.length;
    if (count !== 1) {
      result.set(req.id, { candidateCount: count, candidate: null });
    } else {
      const row = eligible[0];
      result.set(req.id, {
        candidateCount: 1,
        candidate: {
          type:           PROCESSED_RESULT_TYPES.MAKEUP_ASSIGNMENT,
          resultId:       row.id,
          assignedDate:   row.assigned_date            ?? null,
          classGroupId:   row.assigned_class_group_id  ?? null,
          classGroupName: row.assigned_class_group_name ?? null,
          teacherName:    row.assigned_teacher_name    ?? null,
        },
      });
    }
  }

  return result;
}
