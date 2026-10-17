// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OfficeVideoPicker, validateOfficeVideo, VIDEO_MAX_BYTES } from "./OfficeVideoPicker";
import { attachOfficeDiaryVideos } from "./OfficeDiaryVideos";
import { OfficeTeacherGrowthReports } from "./OfficeTeacherGrowthReports";
import { OfficeDiaryComposer } from "./OfficeDiaryComposer";
const { get, post, postForm, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), postForm: vi.fn(), del: vi.fn() }));
vi.mock("../lib/api-client", () => ({ api: { get, post, postForm, delete: del } }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ state: { status: "authenticated", user: { id: "teacher_1", role: "teacher", swimming_pool_id: "pool_1" } } }) }));
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(window, "confirm").mockReturnValue(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (path: string) => { throw new Error(`Unexpected fixture GET ${path}`); });
  post.mockImplementation(async (path: string) => { throw new Error(`Unexpected fixture POST ${path}`); });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });
function mount(node: React.ReactNode) { return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); }
it.each([
  [0, "x.mp4", "video/mp4", false], [VIDEO_MAX_BYTES, "x.mov", "video/quicktime", true],
  [VIDEO_MAX_BYTES + 1, "x.mp4", "video/mp4", false], [1, "x.exe", "video/mp4", false],
  [1, "x.mp4", "image/png", false], [1, "x.webm", "", true],
])("validates only the existing original-video boundary (%s %s %s)", (size, name, type, valid) => {
  expect(validateOfficeVideo({ size: Number(size), name: String(name), type: String(type) }) === null).toBe(valid);
});
it("uploads the exact selected file as multipart, then verifies its ID from the original bare-array API", async () => {
  let uploaded = false;
  get.mockImplementation(async () => uploaded ? [{ id: "video_1", class_id: "class_1", student_id: null }] : []);
  postForm.mockImplementation(async () => { uploaded = true; return { success: true, video: { id: "video_1" } }; });
  const selected = vi.fn();
  mount(<OfficeVideoPicker classId="class_1" selected={[]} onChange={selected} />);
  const file = new File(["fixture-only"], "original.mov", { type: "video/quicktime" });
  fireEvent.change(screen.getByLabelText("영상 파일 선택"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "영상 원본 업로드" }));
  await waitFor(() => expect(selected).toHaveBeenCalledWith(["video_1"]));
  const [path, form] = postForm.mock.calls[0];
  expect(path).toBe("/videos/group"); expect(form.get("video")).toBe(file);
  expect(form.get("class_id")).toBe("class_1"); expect(form.has("student_id")).toBe(false);
  expect(postForm).toHaveBeenCalledOnce(); expect(post).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  expect(screen.getByText(/메타데이터 확인/)).toBeTruthy();
});
it("does not turn upload-acknowledged but missing readback into success or allow automatic resend", async () => {
  get.mockResolvedValue([]); postForm.mockResolvedValue({ success: true, video: { id: "video_missing" } });
  const selected = vi.fn();
  mount(<OfficeVideoPicker classId="class_1" selected={[]} onChange={selected} />);
  fireEvent.change(screen.getByLabelText("영상 파일 선택"), { target: { files: [new File(["fixture"], "x.mp4", { type: "video/mp4" })] } });
  fireEvent.click(screen.getByRole("button", { name: "영상 원본 업로드" }));
  await screen.findByText(/결과 불명: 목록/);
  expect((screen.getByRole("button", { name: "영상 원본 업로드" }) as HTMLButtonElement).disabled).toBe(true);
  expect(postForm).toHaveBeenCalledOnce(); expect(selected).not.toHaveBeenCalled();
});
it("verifies a private video against its canonical student note and reads the exact attachment back", async () => {
  get.mockImplementation(async (path: string) => {
    if (path === "/class-groups") return [{ id: "c1" }];
    if (path === "/diaries/d1") return { id: "d1", class_group_id: "c1", student_notes: [{ id: "n1", student_id: "s1" }] };
    if (path === "/videos/private/s1") return [{ id: "video_1", class_id: "c1", student_id: "s1" }];
    if (path === "/videos/diary/d1") return { videos: [{ id: "video_1", student_note_id: "n1" }], total: 1 };
    throw new Error(path);
  });
  post.mockResolvedValue({ updated: 1 });
  await expect(attachOfficeDiaryVideos({ diaryId: "d1", classId: "c1", studentId: "s1", noteId: "n1" }, ["video_1"])).resolves.toBe(1);
  expect(post).toHaveBeenCalledWith("/videos/note-attach", { note_id: "n1", video_ids: ["video_1"], sort_orders: [0] });
});
it("rejects a mismatched student note before a video attachment write", async () => {
  get.mockImplementation(async (path: string) => path === "/class-groups" ? [{ id: "c1" }] : { id: "d1", class_group_id: "c1", student_notes: [{ id: "n1", student_id: "other" }] });
  await expect(attachOfficeDiaryVideos({ diaryId: "d1", classId: "c1", studentId: "s1", noteId: "n1" }, ["video_1"])).rejects.toThrow("회원의 일지 노트");
  expect(post).not.toHaveBeenCalled();
});
it("does not count an updated response as a completed attachment without matching readback", async () => {
  get.mockImplementation(async (path: string) => path === "/class-groups" ? [{ id: "c1" }] : path === "/diaries/d1" ? { id: "d1", class_group_id: "c1", student_notes: [] } :
    path === "/videos/group/c1" ? [{ id: "video_1", class_id: "c1", student_id: null }] : { videos: [], total: 0 });
  post.mockResolvedValue({ updated: 1 });
  await expect(attachOfficeDiaryVideos({ diaryId: "d1", classId: "c1" }, ["video_1"])).rejects.toThrow("재조회 확인 0");
  expect(post).toHaveBeenCalledOnce();
});
it("rejects video attachment outside the current canonical class directory", async () => {
  get.mockResolvedValue([{ id: "other_class" }]);
  await expect(attachOfficeDiaryVideos({ diaryId: "d1", classId: "c1" }, ["video_1"])).rejects.toThrow("담당 반");
  expect(post).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledOnce();
});
it("filters published teacher history by period and member without review/reanalysis controls", async () => {
  get.mockResolvedValue({ success: true, reports: [
    { id: "published1", student_name: "가상회원 A", report_period: "2026-09", product_status: "PUBLISHED", published_at: "2026-10-01" },
    { id: "published2", student_name: "가상회원 B", report_period: "2026-08", product_status: "PUBLISHED", published_at: "2026-09-01" },
    { id: "pending", student_name: "검수회원", report_period: "2026-09", product_status: "REVIEW_REQUIRED", published_at: null },
  ] });
  mount(<OfficeTeacherGrowthReports publishedOnly />);
  await screen.findByText("가상회원 A"); expect(screen.queryByText("검수회원")).toBeNull();
  fireEvent.change(screen.getByLabelText("리포트 기간 필터"), { target: { value: "2026-09" } });
  expect(screen.queryByText("가상회원 B")).toBeNull();
  expect(screen.queryByRole("button", { name: "검수 승인" })).toBeNull();
  expect(screen.queryByRole("button", { name: "재분석 요청" })).toBeNull(); expect(post).not.toHaveBeenCalled();
});
it("keeps saved diary/photo success separate from failed video attachment and prevents a duplicate diary save", async () => {
  get.mockImplementation(async (path: string) => {
    if (path === "/class-groups") return [{ id: "c1", name: "가상 반" }];
    if (path === "/students") return [];
    if (path === "/photos/teacher-all?scope=group") return { photos: [{ id: "p1" }], total: 1 };
    if (path === "/videos/group/c1") return [{ id: "video_1", class_id: "c1", student_id: null }];
    if (path === "/diaries/d1") return { id: "d1", class_group_id: "c1", student_notes: [] };
    if (path === "/videos/diary/d1") return { videos: [], total: 0 };
    throw new Error(path);
  });
  post.mockImplementation(async (path: string) => path === "/diaries" ? { success: true, diary_id: "d1", student_notes: [] } :
    path === "/photos/diary-attach" ? { success: true, attached: 1, failed: 0 } : { updated: 0 });
  const saved = vi.fn(); mount(<OfficeDiaryComposer onSaved={saved} />);
  await screen.findByRole("option", { name: "가상 반" });
  fireEvent.change(screen.getByLabelText("반 선택"), { target: { value: "c1" } });
  fireEvent.change(screen.getByPlaceholderText("공통 수업 내용"), { target: { value: "fixture lesson" } });
  fireEvent.click(screen.getByRole("button", { name: /앨범에서 사진 선택/ }));
  fireEvent.click(await screen.findByLabelText("사진 선택"));
  fireEvent.click(screen.getByRole("button", { name: /반 영상 선택/ }));
  fireEvent.click(await screen.findByLabelText("영상 선택 video_1"));
  fireEvent.click(screen.getByRole("button", { name: "일지 저장" }));
  await screen.findByText(/일지 d1 저장.*반 영상 연결 실패/);
  expect(saved).not.toHaveBeenCalled();
  expect(post.mock.calls.filter(([path]) => path === "/diaries")).toHaveLength(1);
  expect((screen.getByRole("button", { name: "일지 저장" }) as HTMLButtonElement).disabled).toBe(true);
});
