/** Proposed server guard. Not imported by the running API; copied into the unapplied patch. */
export type MakeupScopeInput = { role: string; poolId: string | null; makeupId: unknown; classId?: unknown; teacherId?: unknown; allowExpired?: unknown };
export type MakeupScopeReads = {
  makeupAndStudentInPool: (id: string, pool: string) => Promise<boolean>;
  classAndTeacherInPool: (id: string, pool: string) => Promise<boolean>;
  teacherInPool: (id: string, pool: string) => Promise<boolean>;
};
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
export async function checkOfficeMakeupScope(input: MakeupScopeInput, reads: MakeupScopeReads): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  // Existing super_admin behavior is deliberately unchanged; routes retain requireAuth/requireRole.
  if (input.role === "super_admin") return { ok: true };
  if (input.role !== "pool_admin" || !input.poolId) return { ok: false, status: 403, error: "수영장 관리자 권한 필요" };
  if (!id(input.makeupId) || input.classId != null && !id(input.classId) || input.teacherId != null && !id(input.teacherId) ||
    input.allowExpired !== undefined && typeof input.allowExpired !== "boolean") return { ok: false, status: 400, error: "보강 대상/값 형식 오류" };
  if (!await reads.makeupAndStudentInPool(input.makeupId, input.poolId)) return { ok: false, status: 404, error: "수영장 내 보강·학생 없음" };
  if (input.classId != null && !await reads.classAndTeacherInPool(input.classId as string, input.poolId)) return { ok: false, status: 403, error: "같은 수영장의 반·담당선생님만 지정 가능" };
  if (input.teacherId != null && !await reads.teacherInPool(input.teacherId as string, input.poolId)) return { ok: false, status: 403, error: "같은 수영장의 선생님만 지정 가능" };
  return { ok: true };
}
