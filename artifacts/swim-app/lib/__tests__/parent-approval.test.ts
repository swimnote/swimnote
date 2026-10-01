import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildParentApprovalConfirmBody, canonicalLinkedStudentNames,
  parentAdminRequestEndpoint, parentApprovalCandidates, parentApprovalConfirmEndpoint,
  parentApprovalInfoEndpoint, parentApprovalNotificationRoute, responseMessage,
} from "../parentApprovalUtils";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const readArtifact = (artifactPath: string) => readFileSync(path.join(repositoryRoot, artifactPath), "utf8");
const approvalsSource = readArtifact("artifacts/swim-app/app/(admin)/approvals.tsx");
const approvalModalSource = readArtifact("artifacts/swim-app/components/admin/ParentApprovalInfoModal.tsx");
const rootLayoutSource = readArtifact("artifacts/swim-app/app/_layout.tsx");
const adminNotificationsSource = readArtifact("artifacts/swim-app/app/(admin)/notifications.tsx");
const parentHomeSource = readArtifact("artifacts/swim-app/app/(parent)/home.tsx");

function findFunction(source: string, name: string): ts.FunctionDeclaration {
  const sourceFile = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) throw new Error(`Could not find ${name}`);
  return found;
}

describe("parent V2 approvals", () => {
  it("keeps the roster selector while removing search and preserving member registration", () => {
    expect(approvalModalSource).toContain("info.child_name_raw");
    expect(approvalModalSource).toContain("parentApprovalCandidates(info)");
    expect(approvalModalSource).toContain("onPress={() => setSelectedStudentId(candidate.id)}");
    expect(approvalModalSource).not.toMatch(/TextInput|searchStudents|student-search|autofocus/i);
    expect(approvalsSource).not.toMatch(/searchStudents|student-search/i);
    expect(readArtifact("artifacts/swim-app/app/(admin)/members.tsx")).toContain("RegisterModal");
  });

  it("uses approval-info candidates and posts only the manager-selected student id", () => {
    expect(parentApprovalInfoEndpoint("pending-123"))
      .toBe("/admin/parent-v2-pending/pending-123/approval-info");
    expect(parentApprovalConfirmEndpoint("pending-123"))
      .toBe("/admin/parent-v2-pending/pending-123/confirm");
    expect(parentAdminRequestEndpoint).toBe("/parent/v2/pending/request-admin");
    expect(approvalsSource).toContain("apiRequest(token, parentApprovalInfoEndpoint(item.id))");
    expect(approvalsSource).toContain("parentApprovalConfirmEndpoint(item.id)");
    expect(approvalsSource).toContain('method: "POST"');
    expect(approvalsSource).toContain("buildParentApprovalConfirmBody(studentId)");
    expect(approvalsSource).not.toContain("approvalInfo.student.id");
    expect(approvalModalSource).toContain("onConfirm(selectedStudent.id)");
    expect(approvalsSource).toContain('item.status === "matched" || item.status === "approved"');
    expect(approvalsSource).toContain('if (statusFilter === "approved") return item.status === "matched"');
    expect(approvalsSource).not.toContain("/admin/students/");
  });

  it("keeps rejected retries on legacy PATCH while pending approvals use the new POST", () => {
    const confirmHandler = findFunction(approvalsSource, "handleParentConfirm").getText();
    const rejectedStart = confirmHandler.indexOf('if (item.status === "rejected")');
    const pendingPostStart = confirmHandler.indexOf("parentApprovalConfirmEndpoint(item.id)", rejectedStart);
    expect(rejectedStart).toBeGreaterThanOrEqual(0);
    expect(pendingPostStart).toBeGreaterThan(rejectedStart);

    const rejectedBranch = confirmHandler.slice(rejectedStart, pendingPostStart);
    expect(rejectedBranch).toContain("/admin/parent-v2-pending/${item.id}");
    expect(rejectedBranch).toContain('method: "PATCH"');
    expect(rejectedBranch).toContain('JSON.stringify({ action: "approve", student_id: studentId })');
    expect(rejectedBranch).toContain("d.success !== true");
    expect(rejectedBranch).toContain("d.linked_count");
    expect(rejectedBranch).toContain("responseMessage(d, fallbackMessage)");

    const pendingBranch = confirmHandler.slice(pendingPostStart);
    expect(pendingBranch).toContain('method: "POST"');
    expect(pendingBranch).toContain("buildParentApprovalConfirmBody(studentId)");
    expect(pendingBranch).toContain("d.data?.success !== true");
    expect(approvalsSource).toContain("const showActions = isPending || isRejected;");
  });

  it("sends no member edits and keeps canonical server names for success messaging", () => {
    expect(buildParentApprovalConfirmBody("student-1")).toEqual({ student_id: "student-1" });
    const rosterStudent = {
      id: "student-1", name: "Ari", parent_name: "Parent",
      parent_phone: "010-1", parent_phone2: "", parent_phone3: "010-3", parent_phone4: "",
    };
    expect(parentApprovalCandidates({ candidates: [rosterStudent], student: rosterStudent })).toEqual([rosterStudent]);
    expect(parentApprovalCandidates({ candidates: [], student: rosterStudent })).toEqual([rosterStudent]);
    expect(canonicalLinkedStudentNames([{ name: "Canonical Name" }, { name: " Other " }, { name: "" }]))
      .toEqual(["Canonical Name", "Other"]);
    expect(approvalsSource).toContain("canonicalLinkedStudentNames(d.data.students)");
    expect(approvalModalSource).not.toMatch(/EditField|TextInput|onChangeText|setParentPhone|setParentName/);
  });

  it("keeps the pending item and current modal selection on server errors", () => {
    const confirmHandler = findFunction(approvalsSource, "handleParentConfirm").getText();
    const errorBranchStart = confirmHandler.indexOf("if (!res.ok || d.data?.success !== true)");
    const errorBranchEnd = confirmHandler.indexOf("return;", errorBranchStart);
    const errorBranch = confirmHandler.slice(errorBranchStart, errorBranchEnd);
    expect(errorBranch).toContain("responseMessage(d");
    expect(errorBranch).not.toMatch(/setApprovalTarget\(null\)|setApprovalInfo\(null\)|setParentPending/);
    expect(approvalModalSource).toContain("info.phone_verified ?");
    expect(approvalModalSource).toContain("소유권 미확인");
    expect(approvalModalSource).toContain("phoneMatches(info.parent_phone, value)");
    expect(approvalModalSource).toContain("요청 번호와 불일치");
    expect(approvalModalSource).toContain("processing || !selectedStudent");
    expect(approvalModalSource).not.toMatch(/if\s*\(\s*!matches\s*\)/);
  });

  it("navigates a parent approval push to the parent tab and highlights its pending id", () => {
    expect(parentApprovalNotificationRoute({ screen: "approvals", tab: "parent", pendingId: "pending-123" }))
      .toBe("/(admin)/approvals?tab=parent&pendingId=pending-123");
    expect(parentApprovalNotificationRoute({
      notification: { request: { content: { data: { screen: "approvals", tab: "parent", pendingId: "pending-123" } } } },
    })).toBe("/(admin)/approvals?tab=parent&pendingId=pending-123");
    expect(parentApprovalNotificationRoute({ screen: "approvals", tab: "teacher", pendingId: "pending-123" }))
      .toBeNull();
    expect(rootLayoutSource).toContain("parentApprovalNotificationRoute(response)");
    expect(rootLayoutSource).toContain("router.push(parentApprovalRoute as any)");
    expect(approvalsSource).toContain('focused={notificationPendingId === item.id}');
    expect(adminNotificationsSource).toContain('notification.type !== "parent_link_admin_request"');
    expect(adminNotificationsSource).toContain('notification.ref_type === "parent_v2_pending"');
    expect(adminNotificationsSource).toContain("router.push(route as any)");
  });

  it("uses the same approvals UI source for Normal and X mode", () => {
    expect(approvalsSource).not.toMatch(/\b(isXMode|useMode|x_pending)\b/);
    expect(approvalModalSource).not.toMatch(/\b(isXMode|useMode|x_pending)\b/);
    expect(approvalsSource).toContain("ParentApprovalInfoModal");
  });

  it("uses a single empty-body request and server cooldown on the parent waiting screen", () => {
    expect(parentHomeSource).toContain("apiRequest(token, parentAdminRequestEndpoint");
    expect(parentHomeSource).toContain("body: JSON.stringify({})");
    expect(parentHomeSource).toContain("data.cooldown_seconds");
    expect(parentHomeSource).toContain("관리자에게 승인 요청하기");
    expect(parentHomeSource).toContain('requestCode === "pending_not_found"');
    expect(parentHomeSource).toContain('setV2Status("linked")');
    expect(responseMessage({ message: "서버 안내" }, "fallback")).toBe("서버 안내");
  });
});