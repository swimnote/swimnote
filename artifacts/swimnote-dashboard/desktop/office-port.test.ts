import { it, expect } from "vitest";
import { OFFICE_PAGES, officePage, isOfficeApiRequest, isAllowedOfficeImage } from "./office-access.cts";
import { isAllowedAuthRequest } from "./security.cts";
it("all shared menu destinations are explicit and reject foreign or unknown pages", () => {
  expect(OFFICE_PAGES.length).toBe(28);
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
it("real sending, financial execution, role changes, destructive actions and side-effecting parent backfill remain blocked", () => {
  for (const [path, method] of [
    ["/notices", "POST"], ["/admin/growth-reports/bulk-send", "POST"],
    ["/settlement/finalize", "POST"], ["/admin/teacher-invites", "POST"],
    ["/class-groups/class_1", "DELETE"], ["/admin/parents", "GET"],
    ["/billing/subscribe", "POST"], ["/x-setup/ai-generate", "POST"],
  ]) expect(isOfficeApiRequest(path, method), path).toBe(false);
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
