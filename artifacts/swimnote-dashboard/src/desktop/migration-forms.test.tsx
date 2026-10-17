// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfficeDiaryComposer } from "./OfficeDiaryComposer";
import { OfficeTeacherGrowthReports } from "./OfficeTeacherGrowthReports";
import { StudentNoteEditor } from "../pages/diary/StudentNoteEditor";
const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock("../lib/api-client", () => ({ api: { get, post, put } }));
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ state: { status: "authenticated", user: { swimming_pool_id: "fixture_pool" } } }),
}));
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (path: string) => {
    if (path === "/class-groups") return [{ id: "fixture_class", name: "가상 반" }];
    if (path === "/students") return [{ id: "fixture_student", name: "가상회원", class_group_id: "fixture_class" }];
    if (path === "/photos/teacher-all?scope=group") return { photos: [{ id: "fixture_photo", presigned_url: "https://fixture.r2.dev/example" }], total: 1 };
    throw new Error(`Unexpected fixture read: ${path}`);
  });
  post.mockImplementation(async (path: string) => {
    if (path === "/diaries") return { success: true, diary_id: "fixture_diary", student_notes: [] };
    throw new Error(`Unexpected fixture write: ${path}`);
  });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });
function mount(node: React.ReactNode) { return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); }
async function fillDiary() {
  await screen.findByRole("option", { name: "가상 반" });
  fireEvent.change(screen.getByLabelText("반 선택"), { target: { value: "fixture_class" } });
  fireEvent.change(screen.getByPlaceholderText("공통 수업 내용"), { target: { value: "가상 수업 내용" } });
}
it("manual diary creation sends the existing DTO and completes only from the server response, with no AI call", async () => {
  const saved = vi.fn();
  mount(<OfficeDiaryComposer onSaved={saved} />);
  await fillDiary();
  fireEvent.click(screen.getByRole("button", { name: "일지 저장" }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("fixture_diary"));
  expect(post).toHaveBeenCalledWith("/diaries", expect.objectContaining({
    class_group_id: "fixture_class", common_content: "가상 수업 내용", student_notes: [],
  }));
  expect(post).toHaveBeenCalledTimes(1);
  expect(get.mock.calls.some(([path]) => path.includes("pool_all"))).toBe(false);
});
it("a partially attached saved diary remains on screen with a partial warning, not full-success navigation", async () => {
  const saved = vi.fn();
  post.mockImplementation(async (path: string) => path === "/diaries"
    ? { success: true, diary_id: "fixture_diary", student_notes: [] }
    : { success: true, requested: 1, attached: 0, failed: 1 });
  mount(<OfficeDiaryComposer onSaved={saved} />);
  await fillDiary();
  fireEvent.click(screen.getByRole("button", { name: /앨범에서 사진 선택/ }));
  fireEvent.click(await screen.findByLabelText("사진 선택"));
  fireEvent.click(screen.getByRole("button", { name: "일지 저장" }));
  await screen.findByText(/사진 연결 일부 실패/);
  expect(saved).not.toHaveBeenCalled();
  expect(post).toHaveBeenCalledWith("/photos/diary-attach", { diary_id: "fixture_diary", photo_ids: ["fixture_photo"], sort_orders: [0] });
});
it("teacher review saves APPROVE on the teacher API and displays the refetched server state", async () => {
  let approved = false;
  get.mockImplementation(async (path: string) => path === "/teacher/growth-reports"
    ? { success: true, reports: [{ id: "fixture_report", student_name: "가상회원", product_status: approved ? "APPROVED" : "REVIEW_REQUIRED", teacher_review_action: approved ? "APPROVE" : null }] }
    : { success: true, report_id: "fixture_report", product_status: approved ? "APPROVED" : "REVIEW_REQUIRED", student: { id: "fixture_student", name: "가상회원" }, report_content: "가상 리포트" });
  post.mockImplementation(async () => { approved = true; return { success: true }; });
  mount(<OfficeTeacherGrowthReports />);
  fireEvent.click(await screen.findByRole("button", { name: "열기" }));
  fireEvent.click(await screen.findByRole("button", { name: "검수 승인" }));
  await screen.findByText("APPROVE");
  expect(post).toHaveBeenCalledWith("/teacher/growth-reports/fixture_report/review", { action: "APPROVE" });
  expect(get.mock.calls.filter(([path]) => path === "/teacher/growth-reports").length).toBeGreaterThan(1);
  expect(get.mock.calls.some(([path]) => path.includes("/admin/growth-reports"))).toBe(false);
});
it("individual diary note editing uses the existing note ID and waits for a readback callback", async () => {
  put.mockResolvedValue({ success: true });
  const readback = vi.fn(async () => {});
  mount(<StudentNoteEditor noteId="fixture_note" content="가상 기존 내용" onSaved={readback} />);
  fireEvent.click(screen.getByRole("button", { name: "개별 내용 수정" }));
  fireEvent.change(screen.getByLabelText("회원별 일지 내용"), { target: { value: "가상 수정 내용" } });
  fireEvent.click(screen.getByRole("button", { name: "개별 내용 저장" }));
  await waitFor(() => expect(readback).toHaveBeenCalledOnce());
  expect(put).toHaveBeenCalledWith("/diaries/student-notes/fixture_note", { note_content: "가상 수정 내용" });
});
