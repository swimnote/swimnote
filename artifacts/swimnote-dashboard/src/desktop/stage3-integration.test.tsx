// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopRoutes } from "./DesktopApp";
import { OfficeActionProvider } from "./OfficeActionProvider";
import { useOfficeActions } from "./OfficeActionContext";
import { OfficeNavigationProvider, useOfficeNavigation } from "./OfficeNavigation";
import { useDesktopTokenStorage } from "../lib/token";
import { api } from "../lib/api-client";
import { OfficeCommandService } from "../../../api-server/src/lib/office-command";
import { interpretOffice } from "../../../api-server/src/lib/office-interpret";
import type { OfficeStage3Transport } from "./office-stage3-transport";
import { EditModal } from "../pages/members/MembersPage";

vi.mock("../lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
let actor = { userId: "ui_admin", poolId: "pool_ui", role: "pool_admin" };
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ state: { status: "authenticated", user: { id: actor.userId, role: actor.role,
    swimming_pool_id: actor.poolId, poolName: "합성 UI 수영장" } }, logout: vi.fn() }),
}));
const { Pool } = createRequire(resolve(process.cwd(), "../../lib/db/package.json"))("pg");
let db: any, canonical: OfficeCommandService, qc: QueryClient;
let actions: NonNullable<ReturnType<typeof useOfficeActions>>, nav: NonNullable<ReturnType<typeof useOfficeNavigation>>;
let transport: OfficeStage3Transport;
const members = async () => {
  const { rows } = await db.query("SELECT s.*,md5(row_to_json(s)::text) AS office_revision FROM students s ORDER BY id");
  const groups = (await db.query("SELECT * FROM class_groups")).rows;
  return rows.map((s: any) => ({ ...s, assignedClasses: groups.filter((g: any) => s.assigned_class_ids.includes(g.id)) }));
};
function Probe() { actions = useOfficeActions()!; nav = useOfficeNavigation()!; return null; }
function mount(active = true) {
  window.history.replaceState(null, "", "/admin/members");
  const children = <><Probe /><DesktopRoutes /></>;
  return render(<QueryClientProvider client={qc}><Router><OfficeNavigationProvider>
    {active ? <OfficeActionProvider actor={actor} stage3={transport}>{children}</OfficeActionProvider>
      : <OfficeActionProvider actor={actor}>{children}</OfficeActionProvider>}
  </OfficeNavigationProvider></Router></QueryClientProvider>);
}
async function open(tab = "basic") {
  await act(async () => { await actions.execute({ action: "office.member.open", input: { memberId: "ui_one", view: "full", tab } }, "menu"); });
  await screen.findByRole("article", { name: "합성 동명 회원 상세" });
}
async function startEdit(value = "합성 입력 유지") {
  fireEvent.click(screen.getByRole("button", { name: "수정", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "이름", exact: true }), { target: { value } });
}
beforeAll(async () => {
  // Strictly loopback. The production DB module is never imported in this test.
  const config = { host: "127.0.0.1", port: 55439, database: "office_stage3_fixture", user: "office_fixture", max: 8 };
  const bootstrap = new Pool(config);
  expect((await bootstrap.query("SELECT current_database() AS name")).rows[0].name).toBe("office_stage3_fixture");
  await bootstrap.query("DROP SCHEMA IF EXISTS office_ui_fixture CASCADE; CREATE SCHEMA office_ui_fixture"); await bootstrap.end();
  db = new Pool({ ...config, options: "-c search_path=office_ui_fixture" });
  await db.query(`CREATE TABLE students (id text PRIMARY KEY,swimming_pool_id text,name text,phone text,birth_date text,birth_year text,
    parent_name text,memo text,status text DEFAULT 'active',class_group_id text,assigned_class_ids jsonb,
    schedule_labels text,weekly_count int DEFAULT 2,updated_at timestamptz DEFAULT now());
    CREATE TABLE class_groups (id text PRIMARY KEY,swimming_pool_id text,name text,schedule_days text,schedule_time text,
      capacity int,is_deleted boolean DEFAULT false,is_one_time boolean DEFAULT false);
    CREATE TABLE student_class_history(id text PRIMARY KEY,student_id text,class_group_id text,swimming_pool_id text,enrolled_at date,left_at date,created_at timestamptz DEFAULT now());
    CREATE TABLE pool_event_logs(id text PRIMARY KEY,pool_id text,event_type text,entity_type text,entity_id text,actor_id text,payload jsonb,source text);`);
  canonical = new OfficeCommandService(db);
});
beforeEach(async () => {
  actor = { userId: "ui_admin", poolId: "pool_ui", role: "pool_admin" };
  useDesktopTokenStorage();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await db.query(`TRUNCATE students,class_groups,student_class_history,pool_event_logs;
    INSERT INTO class_groups(id,swimming_pool_id,name,schedule_days,schedule_time,capacity) VALUES
      ('ui_a','pool_ui','합성 A','월수금','16:00',10),('ui_b','pool_ui','합성 B','화목','17:00',10),('ui_c','pool_ui','합성 C','토','10:00',10);
    INSERT INTO students(id,swimming_pool_id,name,class_group_id,assigned_class_ids) VALUES
      ('ui_one','pool_ui','합성 동명','ui_a','["ui_a","ui_b"]'),('ui_two','pool_ui','합성 동명','ui_a','["ui_a"]');
    INSERT INTO student_class_history(id,student_id,class_group_id,swimming_pool_id,enrolled_at) VALUES
      ('ui_h1','ui_one','ui_a','pool_ui','2026-01-01'),('ui_h2','ui_one','ui_b','pool_ui','2026-01-01'),('ui_h3','ui_two','ui_a','pool_ui','2026-01-01');`);
  transport = {
    mode: "fixture",
    write: vi.fn(c => canonical.execute(actor, c)),
    status: vi.fn(async id => { const r = await canonical.status(actor, id); if (!r) throw new Error("Unknown receipt"); return r; }),
    interpret: vi.fn(input => interpretOffice(async () => ({ kind: "clarify", question: "동명 회원을 먼저 선택하세요." }), input)),
  };
  vi.mocked(api.get).mockImplementation(async path => {
    if (path === "/students?pool_all=true") return await members() as never;
    if (path === "/class-groups") return (await db.query("SELECT * FROM class_groups")).rows as never;
    if (path.startsWith("/admin/growth-reports/students/")) return { success: true, reports: [] } as never;
    throw new Error("Unapproved UI fixture read: " + path);
  });
});
afterEach(() => { cleanup(); qc.clear(); vi.clearAllMocks(); Object.defineProperty(window, "officeDesktop", { configurable: true, value: undefined }); });
afterAll(async () => { if (db) await db.end(); });
it("search → exact ID selection → real input save → move one class → fresh result view, with no forced navigation", async () => {
  mount(); await screen.findByPlaceholderText("이름 또는 전화번호 검색");
  fireEvent.change(screen.getByPlaceholderText("이름 또는 전화번호 검색"), { target: { value: "합성 동명" } });
  expect(nav.view.search).toBe("합성 동명");
  await open(); await startEdit("합성 실제 SQL 수정");
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(actions.tasks[0]?.status).toBe("completed"));
  expect(nav.getDestination()).toMatchObject({ memberId: "ui_one", tab: "basic" });
  expect((await members()).find((s: any) => s.id === "ui_two").name).toBe("합성 동명");
  fireEvent.click(screen.getByRole("tab", { name: "수강반", exact: true }));
  fireEvent.change(await screen.findByLabelText("이동 전 반"), { target: { value: "ui_a" } });
  fireEvent.change(screen.getByLabelText("이동 후 반"), { target: { value: "ui_c" } });
  fireEvent.click(screen.getByRole("button", { name: "이동 내용 확인" }));
  expect(screen.getAllByText(/합성 B/).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "반 이동 실행" }));
  await waitFor(() => expect(actions.tasks.filter(t => t.status === "completed")).toHaveLength(2));
  expect((await members()).find((s: any) => s.id === "ui_one").assigned_class_ids).toEqual(["ui_c", "ui_b"]);
  const task = actions.tasks[1], result = task.results[0];
  expect(result.viewedAt).toBeUndefined();
  await act(async () => { await actions.openResult(task.id, result.id); });
  expect(actions.tasks[1].results[0].viewedAt).toBeTypeOf("number");
  expect(nav.getDestination()).toMatchObject({ memberId: "ui_one", tab: "classes" });
});
it("failed save and SSE/query refresh preserve actual draft; continue/discard navigation are distinct", async () => {
  transport.write = vi.fn(async () => { throw { status: 409, message: "합성 충돌" }; });
  mount(); await open(); await startEdit();
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  await screen.findAllByText("합성 충돌");
  await db.query("UPDATE students SET memo='외부 합성 갱신',updated_at=now() WHERE id='ui_one'");
  await act(async () => { await qc.invalidateQueries({ queryKey: ["students"] }); });
  expect((screen.getByRole("textbox", { name: "이름", exact: true }) as HTMLInputElement).value).toBe("합성 입력 유지");
  fireEvent.click(screen.getByRole("button", { name: "회원 목록으로", exact: true }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(nav.getDestination()).toMatchObject({ memberId: "ui_one" });
  fireEvent.click(screen.getByRole("button", { name: "회원 목록으로", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "버리고 이동" }));
  await waitFor(() => expect(nav.getDestination()).toEqual({ screen: "members" }));
  expect(transport.write).toHaveBeenCalledTimes(1);
});
it("save-and-leave waits for canonical save; native close uses the same three-way guard", async () => {
  let close: (() => void) | undefined;
  const confirmClose = vi.fn();
  Object.defineProperty(window, "officeDesktop", { configurable: true, value: { onCloseRequest: (fn: () => void) => { close = fn; return () => {}; }, confirmClose } });
  mount(); await open(); await startEdit("합성 닫기 저장");
  act(() => close!());
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(confirmClose).not.toHaveBeenCalled();
  act(() => close!());
  fireEvent.click(screen.getByRole("button", { name: "저장하고 이동" }));
  await waitFor(() => expect(confirmClose).toHaveBeenCalledTimes(1));
  expect((await members()).find((s: any) => s.id === "ui_one").name).toBe("합성 닫기 저장");
  Object.defineProperty(window, "officeDesktop", { configurable: true, value: undefined });
});
it("lost write response becomes unknown; state lookup confirms result without resending", async () => {
  transport.write = vi.fn(async c => { await canonical.execute(actor, c); throw new Error("fixture response lost"); });
  mount(); await open(); await startEdit("합성 유실 저장");
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(actions.tasks[0]?.status).toBe("unknown"));
  expect((screen.getByRole("textbox", { name: "이름", exact: true }) as HTMLInputElement).value).toBe("합성 유실 저장");
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  expect(transport.write).toHaveBeenCalledTimes(1);
  const requestId = actions.tasks[0].id.split(":write:")[1];
  await act(async () => { await actions.resolveWrite(requestId); });
  expect(actions.tasks[0].status).toBe("completed");
  expect(transport.write).toHaveBeenCalledTimes(1);
});
it("mock interpretation clarifies ambiguity, then confirmed AI proposal uses same canonical Action/SQL as menu", async () => {
  mount();
  await act(async () => { await actions.interpret("합성 동명을 옮겨줘"); });
  expect(actions.notice).toBe("동명 회원을 먼저 선택하세요."); expect(transport.write).not.toHaveBeenCalled();
  await open("notes");
  transport.interpret = vi.fn(input => interpretOffice(async () => ({ kind: "command", command: { action: "update", changes: { memo: "mock 모델 합성 메모" } } }), input));
  fireEvent.change(screen.getByRole("textbox", { name: "업무 입력" }), { target: { value: "메모 변경" } });
  fireEvent.click(screen.getByRole("button", { name: "전송", exact: true }));
  await waitFor(() => expect(actions.tasks[0]?.status).toBe("confirmation_required"));
  expect(actions.tasks[0].status).toBe("confirmation_required"); expect(transport.write).not.toHaveBeenCalled();
  await act(async () => { await actions.confirmProposal(actions.tasks[0].id); });
  expect(actions.tasks[0].status).toBe("completed");
  expect((await members()).find((s: any) => s.id === "ui_one").memo).toBe("mock 모델 합성 메모");
  expect(transport.interpret).toHaveBeenCalledWith({ text: "메모 변경", memberId: "ui_one" });
});
it("a dirty editor remains protected after moving to growth tab", async () => {
  mount(); await open(); await startEdit("탭 이동 보존");
  fireEvent.click(screen.getByRole("tab", { name: "성장리포트", exact: true }));
  await waitFor(() => expect(nav.getDestination()).toMatchObject({ tab: "growth" }));
  fireEvent.click(screen.getByRole("button", { name: "회원 목록으로", exact: true }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  fireEvent.click(screen.getByRole("tab", { name: "기본정보", exact: true }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "이름", exact: true }) as HTMLInputElement).value).toBe("탭 이동 보존"));
});
it("session/Pool switch quarantines late write responses and clears prior cards immediately", async () => {
  let finish!: (value: any) => void;
  transport.write = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const mounted = mount(); await open(); await startEdit();
  fireEvent.click(screen.getByRole("button", { name: "저장", exact: true }));
  await waitFor(() => expect(actions.tasks[0]?.status).toBe("running"));
  mounted.unmount();
  actor = { ...actor, poolId: "pool_changed" }; mount();
  await act(async () => { finish({ requestId: "old", memberId: "ui_one", revision: "0".repeat(32), action: "update", changes: [], assignedClassIds: [] }); });
  expect(actions.tasks).toEqual([]);
  expect((await members()).find((s: any) => s.id === "ui_one").name).toBe("합성 동명");
});
it("default production transport sends neither writes nor real AI", async () => {
  mount(false); await open();
  expect((screen.getByRole("button", { name: "수정", exact: true }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await actions.interpret("보내지 않는 합성 요청"); });
  expect(actions.stage3Enabled).toBe(false); expect(transport.write).not.toHaveBeenCalled(); expect(transport.interpret).not.toHaveBeenCalled();
});
it("opt-in Web ordinary edit reaches identical canonical service; legacy Web contract stays available", async () => {
  const s = (await members()).find((s: any) => s.id === "ui_one"), saved = vi.fn();
  vi.mocked(api.post).mockImplementation(async (path, body) => {
    expect(path).toBe("/office/command"); return await canonical.execute(actor, body) as never;
  });
  render(<QueryClientProvider client={qc}><EditModal student={{ ...s, office_stage3_enabled: true }}
    classGroups={[]} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>);
  fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "합성 Web 공통 저장" } });
  fireEvent.click(screen.getByRole("button", { name: /저장/ }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledTimes(1); expect(api.patch).not.toHaveBeenCalled();
  expect((await members()).find((x: any) => x.id === s.id).name).toBe("합성 Web 공통 저장");
});
it("opt-in Web single-membership move uses same canonical service and keeps other memberships", async () => {
  const s = (await members()).find((s: any) => s.id === "ui_one"), saved = vi.fn();
  vi.mocked(api.post).mockImplementation(async (path, body) => {
    expect(path).toBe("/office/command"); return await canonical.execute(actor, body) as never;
  });
  render(<QueryClientProvider client={qc}><EditModal student={{ ...s, office_stage3_enabled: true }}
    classGroups={(await db.query("SELECT * FROM class_groups ORDER BY id")).rows} onClose={vi.fn()} onSaved={saved} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("checkbox", { name: "합성 A" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "합성 C" }));
  fireEvent.click(screen.getByRole("button", { name: /저장/ }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.patch).not.toHaveBeenCalled();
  expect((await members()).find((x: any) => x.id === s.id).assigned_class_ids).toEqual(["ui_c", "ui_b"]);
});
