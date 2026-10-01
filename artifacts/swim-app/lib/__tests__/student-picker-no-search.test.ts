import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../../..");
const readArtifact = (artifactPath: string) => readFileSync(path.join(repositoryRoot, artifactPath), "utf8");
const approvalsSource = readArtifact("artifacts/swim-app/app/(admin)/approvals.tsx");
const approvalModalSource = readArtifact("artifacts/swim-app/components/admin/ParentApprovalInfoModal.tsx");

describe("parent approval roster selection without search", () => {
  it("shows approval-info candidates in a scrollable roster without fetching or searching a list", () => {
    expect(approvalsSource).toContain("parentApprovalInfoEndpoint(item.id)");
    expect(approvalModalSource).toContain("parentApprovalCandidates(info)");
    expect(approvalModalSource).toContain("candidates.map(candidate");
    expect(approvalModalSource).toContain("onPress={() => setSelectedStudentId(candidate.id)}");
    expect(approvalModalSource).toContain("<ScrollView");
    expect(approvalModalSource).not.toMatch(/keyboardType|keyboardDismissMode|KeyboardAware/);
    expect(approvalsSource).not.toMatch(/StudentPickerModal|studentPicker|searchStudents|student-search/i);
    expect(approvalsSource).not.toContain('apiRequest(token, "/students")');
    expect(approvalsSource).not.toContain('apiRequest(token, "/admin/students")');
    expect(approvalModalSource).not.toMatch(/TextInput|searchStudents|student-search|학생 검색|autofocus/i);
  });

  it("requires an explicit tap and keeps roster student details read-only", () => {
    expect(approvalModalSource).toContain("useState<string | null>(null)");
    expect(approvalModalSource).toContain("const isSelected = selectedStudentId === candidate.id");
    expect(approvalModalSource).toContain("onConfirm(selectedStudent.id)");
    expect(approvalModalSource).toContain("processing || !selectedStudent");
    expect(approvalModalSource).not.toMatch(/useState\([^)]*info\.student|setSelectedStudentId\(info\.student/);
    expect(approvalModalSource).not.toMatch(/TextInput|EditField|onChangeText|setParentPhone|setParentName/);
  });

  it("keeps member navigation only when the approved pool roster has no candidates", () => {
    expect(approvalModalSource).toContain("candidates.length === 0");
    expect(approvalModalSource).toContain("선택 가능한 학생이 없습니다.");
    expect(approvalModalSource).toContain("onOpenMembers");
    expect(approvalsSource).toContain('router.push("/(admin)/members?backTo=approvals"');
  });
});