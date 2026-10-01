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
  parent_phone: string;
  phone_verified: boolean;
  student: ParentApprovalStudent | null;
  resolution: string | null;
  reason: string | null;
}

export interface ParentApprovalConfirmFields {
  name: string;
  parent_name: string;
  parent_phone: string;
  parent_phone2: string;
  parent_phone3: string;
  parent_phone4: string;
}

export function parentApprovalInfoEndpoint(pendingId: string): string {
  return `/admin/parent-v2-pending/${encodeURIComponent(pendingId)}/approval-info`;
}

export function parentApprovalConfirmEndpoint(pendingId: string): string {
  return `/admin/parent-v2-pending/${encodeURIComponent(pendingId)}/confirm`;
}

export const parentAdminRequestEndpoint = "/parent/v2/pending/request-admin";

export function buildParentApprovalConfirmBody(
  studentId: string,
  fields: ParentApprovalConfirmFields,
) {
  return {
    student_id: studentId,
    name: fields.name,
    parent_name: fields.parent_name,
    parent_phone: fields.parent_phone,
    parent_phone2: fields.parent_phone2,
    parent_phone3: fields.parent_phone3,
    parent_phone4: fields.parent_phone4,
  };
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