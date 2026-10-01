import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const readArtifact = (artifactPath: string) => readFileSync(path.join(repositoryRoot, artifactPath), "utf8");
const approvalsSource = readArtifact("artifacts/swim-app/app/(admin)/approvals.tsx");
const approvalModalSource = readArtifact("artifacts/swim-app/components/admin/ParentApprovalInfoModal.tsx");

describe("parent approval no-picker/no-search behavior", () => {
  it("resolves the student only from approval-info and never fetches/searches the student list", () => {
    expect(approvalsSource).toContain("parentApprovalInfoEndpoint(item.id)");
    expect(approvalsSource).toContain("approvalInfo?.student");
    expect(approvalsSource).not.toMatch(/StudentPickerModal|studentPicker|searchStudents|student-search/i);
    expect(approvalsSource).not.toContain('apiRequest(token, "/students")');
    expect(approvalsSource).not.toContain('apiRequest(token, "/admin/students")');
    expect(approvalModalSource).not.toMatch(/TextInput|searchStudents|student-search|학생 검색/i);
  });

  it("keeps member-registration navigation only for unresolved students, without guessing a student", () => {
    expect(approvalModalSource).toContain("info && !student");
    expect(approvalModalSource).toContain("신규 회원 등록 또는 회원정보 확인이 필요합니다.");
    expect(approvalModalSource).toContain("onOpenMembers");
    expect(approvalsSource).toContain('router.push("/(admin)/members?backTo=approvals"');
    expect(approvalsSource).not.toContain("studentPickerVisible");
    expect(approvalsSource).not.toContain("handleStudentSelected");
  });
});