import { it, expect } from "vitest";
import { OFFICE_PAGES, officePage, isOfficeApiRequest, isAllowedOfficeImage, officeConfirmation, officePageAllowed, officeRoleRequest } from "./office-access.cts";
import { isAllowedAuthRequest } from "./security.cts";
it("all shared menu destinations are explicit and reject foreign or unknown pages", () => {
  expect(OFFICE_PAGES.map(([path]) => path)).toContain("/admin/diary/new");
  for (const [path] of OFFICE_PAGES) expect(officePage(path)?.[0]).toBe(path);
  for (const raw of ["https://evil.example/admin/settings", "/admin/unknown", "/admin/settings?token=secret"])
    expect(officePage(raw)).toBeUndefined();
});
it("ready existing reads and ordinary saves pass both renderer and native policies", () => {
  for (const [path, method] of [
    ["/students?pool_all=true", "GET"], ["/admin/archives?limit=100", "GET"],
    ["/diary-templates?include_inactive=true", "GET"], ["/photos/teacher-all?scope=group", "GET"],
    ["/attendance?class_group_id=class_1&date=2026-10-18", "GET"], ["/attendance", "POST"],
    ["/admin/members/bulk/commit", "POST"], ["/admin/members/bulk/commit", "OPTIONS"],
    ["/class-groups/class_1", "PATCH"], ["/class-groups/class_1", "OPTIONS"],
    ["/settlement/admin-teacher-detail?teacher_id=teacher_1&month=2026-10", "GET"],
    ["/parent-requests/request_1/messages", "GET"],
    ["/admin/makeups/pending", "GET"], ["/admin/makeups/eligible-classes", "GET"],
  ]) {
    expect(isOfficeApiRequest(path, method), path).toBe(true);
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api" + path, method, true), path).toBe(true);
  }
});
it("existing user-confirmed workflows are connected without permitting unrelated or side-effecting parent backfill APIs", () => {
  for (const [path, method] of [
    ["/notices", "POST"], ["/admin/growth-reports/bulk-send", "POST"],
    ["/settlement/finalize", "POST"], ["/admin/teacher-invites", "POST"],
    ["/class-groups/class_1", "DELETE"], ["/admin/archive-links/link_1", "DELETE"],
  ]) {
    expect(isOfficeApiRequest(path, method), path).toBe(true);
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api" + path, method, true)).toBe(true);
    expect(officeConfirmation(path, method), path).toBeTruthy();
  }
  for (const [path, method] of [
    ["/admin/parents", "GET"], ["/super/pools/pool_1", "DELETE"],
    ["/billing/subscribe", "POST"], ["/x-setup/ai-generate", "POST"],
  ]) expect(isOfficeApiRequest(path, method), path).toBe(false);
});
it("shares each newly wired concrete API with native policy, including preflight without broad prefixes", () => {
  for (const [path, method] of [
    ["/photos/group", "POST"], ["/photos/private", "POST"], ["/photos/photo_1", "DELETE"],
    ["/x-setup/upload/curriculum", "POST"], ["/admin/archive-link-candidates?archive_id=a_1&student_id=s_1", "GET"],
    ["/admin/archive-links", "POST"], ["/teacher/growth-reports", "GET"],
    ["/teacher/growth-reports/report_1/review", "GET"], ["/teacher/growth-reports/report_1/review", "POST"],
    ["/teacher/makeups/makeup_1/assign", "PATCH"], ["/teacher/makeups/makeup_1/extinguish", "POST"],
    ["/admin/makeups/makeup_1/status-override", "PATCH"],
    ["/parent-requests/request_1", "PATCH"], ["/parent-requests/request_1/messages", "POST"],
    ["/admin/students/student_1/info", "PATCH"], ["/students/student_1/assign", "PATCH"],
    ["/students/student_1", "PATCH"], ["/teachers/teacher_1", "PATCH"], ["/teachers/teacher_1", "DELETE"],
    ["/photos/private/student_1?limit=200", "GET"], ["/photos/note-attach", "POST"], ["/photos/diary-attach", "POST"],
    ["/diaries?class_group_id=class_1&lesson_date=2026-10-18", "GET"],
    ["/admin/parent-v2-pending?status=pending", "GET"], ["/admin/parent-v2-pending/request_1/approval-info", "GET"],
    ["/admin/parent-v2-pending/request_1/confirm", "POST"], ["/admin/parent-v2-pending/request_1", "PATCH"],
    ["/teachers", "POST"], ["/v1/teacher-diary/generate", "POST"],
    ["/diaries/student-notes/note_1", "PUT"],
  ]) {
    expect(isOfficeApiRequest(path, method), `${method} ${path}`).toBe(true);
    expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api" + path, method, true), path).toBe(true);
    if (method !== "GET") expect(isAllowedAuthRequest("https://swimnote-api.onrender.com/api" + path, "OPTIONS", true), path).toBe(true);
  }
  expect(officePageAllowed("/admin/teachers", "teacher")).toBe(false);
  expect(officePageAllowed("/admin/diary/new", "teacher")).toBe(true);
  expect(officeRoleRequest("/students/student_1", "PATCH", "teacher")).toBe(false);
});
it("only presigned first-party image host families are permitted", () => {
  expect(isAllowedOfficeImage("https://account.r2.cloudflarestorage.com/bucket/photo?signature=x")).toBe(true);
  for (const raw of ["http://account.r2.dev/a", "https://account.r2.dev.evil.example/a", "https://evil.example/a", "https://user:pass@account.r2.dev/a"])
    expect(isAllowedOfficeImage(raw)).toBe(false);
});
it("rejects path normalization aliases rather than bypassing request identity with traversal", () => {
  expect(officePage("/admin/unknown/../settings")).toBeUndefined();
  expect(isOfficeApiRequest("/unknown/../students", "POST")).toBe(false);
  expect(isOfficeApiRequest("/unknown/%2e%2e/students", "POST")).toBe(false);
});
