export interface ParentApprovalStudent {
  id: string;
  name: string;
  parent_name: string | null;
  parent_phone: string | null;
  parent_phone2: string | null;
  parent_phone3: string | null;
  parent_phone4: string | null;
}

export interface ParentApprovalInfo {
  pending_id: string;
  parent_name: string;
  child_name_raw: string | null;
  parent_phone: string;
  phone_verified: boolean;
  candidates: ParentApprovalStudent[];
  /** Compatibility candidate only; it must never be auto-selected. */
  student?: ParentApprovalStudent | null;
  resolution: string | null;
  reason: string | null;
}

export function parentApprovalInfoEndpoint(pendingId: string): string {
  return `/admin/parent-v2-pending/${encodeURIComponent(pendingId)}/approval-info`;
}

export function parentApprovalConfirmEndpoint(pendingId: string): string {
  return `/admin/parent-v2-pending/${encodeURIComponent(pendingId)}/confirm`;
}

export const parentAdminRequestEndpoint = "/parent/v2/pending/request-admin";

export function buildParentApprovalConfirmBody(studentId: string) {
  return { student_id: studentId };
}

export function parentApprovalCandidates(info: Pick<ParentApprovalInfo, "candidates" | "student">): ParentApprovalStudent[] {
  const candidates = new Map<string, ParentApprovalStudent>();
  for (const candidate of Array.isArray(info.candidates) ? info.candidates : []) {
    if (candidate && typeof candidate.id === "string" && candidate.id && !candidates.has(candidate.id)) {
      candidates.set(candidate.id, candidate);
    }
  }
  const preselectionCandidate = info.student;
  if (
    preselectionCandidate
    && typeof preselectionCandidate.id === "string"
    && preselectionCandidate.id
    && !candidates.has(preselectionCandidate.id)
  ) {
    candidates.set(preselectionCandidate.id, preselectionCandidate);
  }
  return [...candidates.values()];
}

export function responseMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const value = body as { message?: unknown; error?: unknown };
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.error === "string" && value.error.trim()) return value.error;
  }
  return fallback;
}

export function canonicalLinkedStudentNames(students: Array<{ name?: unknown }> | null | undefined): string[] {
  return (students ?? [])
    .map(student => typeof student.name === "string" ? student.name.trim() : "")
    .filter(Boolean);
}

export function phoneMatches(requestPhone: string, rosterPhone: string): boolean {
  const requestDigits = requestPhone.replace(/\D/g, "");
  const rosterDigits = rosterPhone.replace(/\D/g, "");
  return !!requestDigits && requestDigits === rosterDigits;
}

function findParentApprovalPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || depth > 5) return null;
  const record = value as Record<string, unknown>;
  if (record.screen === "approvals" && record.tab === "parent") return record;
  for (const key of ["data", "payload", "content", "request", "notification"]) {
    const nested = findParentApprovalPayload(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function parentApprovalNotificationRoute(data: unknown): string | null {
  const payload = findParentApprovalPayload(data);
  if (!payload) return null;
  const pendingId = typeof payload.pendingId === "string"
    ? payload.pendingId
    : typeof payload.pending_id === "string" ? payload.pending_id : "";
  if (!pendingId) return null;
  return `/(admin)/approvals?tab=parent&pendingId=${encodeURIComponent(pendingId)}`;
}