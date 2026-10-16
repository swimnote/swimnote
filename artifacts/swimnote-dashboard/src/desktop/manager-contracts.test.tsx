// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { OfficeCommandDock } from "./OfficeCommandDock";
import { OfficeManagerProvider, useOfficeManager } from "./OfficeManagerContext";
import { OfficeTaskCard, OfficeTaskSummary } from "./OfficeTaskCard";
import { confirmResultRead, taskPresentation, unreadResults, type OfficeTask, type ResultReadEvidence, type TaskStatus } from "./OfficeTaskContract";
import { OfficeNavigationProvider, OfficeNavigationBar, useOfficeNavigation } from "./OfficeNavigation";
import { addLocalFiles, MAX_FILE_BYTES } from "./local-attachments";
import "./OfficeInteractions.css";

const task = (status: TaskStatus = "completed"): OfficeTask => ({
  id: "synthetic-only", scope: "user-a:pool-a", request: "합성 검증 요청", targetLabel: "가상회원",
  status, summary: "합성 결과 요약", completedAt: 100, incomplete: "2명 중 1명 미완료",
  failureReason: "합성 실패 사유", changes: [{ field: "전화", before: "이전 값", after: "새 값" }],
  preview: { targets: ["가상 대상"], messages: ["검증 메시지"], attachments: ["fixture.pdf"] },
  results: ["r1", "r2"].map(id => ({ id, label: id, target: { screen: "members", memberId: id }, kind: "screen", storage: "not_stored", expectedRevision: "v2" })),
});
const evidence: ResultReadEvidence = {
  scope: "user-a:pool-a", resultId: "r1", target: { screen: "members", memberId: "r1" },
  entered: true, outcome: "success", source: "network", queryStartedAt: 110, receivedAt: 120, revision: "v2",
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(["ready", "confirmation_required", "running", "completed", "partial", "failed", "unknown"] as TaskStatus[])(
  "synthetic task %s has honest status/preview, no automatic navigation", status => {
    const onOpen = vi.fn(), onConfirm = vi.fn(), model = task(status);
    render(<div className="office-surface"><OfficeTaskCard task={model} onOpenResult={onOpen} onConfirm={onConfirm} /></div>);
    expect(screen.getByText(taskPresentation(model).label)).toBeTruthy();
    expect(screen.getByText("검증 메시지", { exact: false })).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
    if (status === "partial") expect(screen.getByText("2명 중 1명 미완료")).toBeTruthy();
    if (status === "failed") expect(screen.getByText("합성 실패 사유")).toBeTruthy();
    if (status === "confirmation_required") {
      fireEvent.click(screen.getByRole("button", { name: "실행 확인" }));
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onOpen).not.toHaveBeenCalled();
    }
    expect(screen.getByText("이전 값")).toBeTruthy();
  });

it.each([
  { entered: false }, { outcome: "failed" }, { outcome: "forbidden" }, { outcome: "missing" },
  { source: "cache" }, { queryStartedAt: 99 }, { receivedAt: 109 }, { scope: "user-b:pool-a" },
  { scope: "user-a:pool-b" }, { resultId: "missing" }, { revision: "old" },
  { target: { screen: "members", memberId: "other" } }, { receivedAt: NaN },
] as Partial<ResultReadEvidence>[])("does not mark viewed for insufficient evidence %j", patch => {
  const model = task();
  expect(confirmResultRead(model, { ...evidence, ...patch })).toBe(model);
});

it("tracks result read state separately from completion/approval and per result", () => {
  const original = task();
  const viewed = confirmResultRead(original, evidence);
  expect(original.results[0].viewedAt).toBeUndefined();
  expect(viewed.results[0].viewedAt).toBe(120);
  expect(viewed.results[1].viewedAt).toBeUndefined();
  expect(viewed.status).toBe("completed");
  expect(unreadResults(viewed)).toBe(1);
  const all = confirmResultRead(viewed, { ...evidence, resultId: "r2", target: { screen: "members", memberId: "r2" } });
  expect(taskPresentation(all)).toEqual({ label: "완료 · 열람함", tone: "neutral" });
  render(<OfficeTaskSummary tasks={[viewed]} />);
  expect(screen.getByLabelText("미열람 결과").textContent).toBe("미열람 1");
  expect(confirmResultRead(task("unknown"), evidence).status).toBe("unknown");
});

function ResultNavigationFixture() {
  const nav = useOfficeNavigation()!;
  return <><OfficeNavigationBar />
    <output data-testid="destination">{JSON.stringify(nav.destination)}</output>
    <OfficeTaskCard task={task()} onOpenResult={result => nav.open(result.target, { directReturn: true })} />
  </>;
}
it("result OPEN uses one N01 history and Back returns directly to previous Home, without marking read", () => {
  window.history.replaceState({}, "", "/admin");
  render(<Router><OfficeNavigationProvider><ResultNavigationFixture /></OfficeNavigationProvider></Router>);
  expect((screen.getByLabelText("앱 내 뒤로") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "결과 보기: r1" }));
  fireEvent.click(screen.getByRole("button", { name: "결과 보기: r1" }));
  expect(screen.getByTestId("destination").textContent).toContain("r1");
  expect(screen.getByText("완료 · 미열람")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("앱 내 뒤로"));
  expect(screen.getByTestId("destination").textContent).toBe('{"screen":"home"}');
  expect((screen.getByLabelText("앱 내 뒤로") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("앱 내 앞으로"));
  expect(screen.getByTestId("destination").textContent).toContain("r1");
});

function ManagerFixture() {
  const manager = useOfficeManager()!;
  return <><button onClick={manager.activate}>매니저 진입</button><OfficeCommandDock available={900} /></>;
}
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
});
it("resize/collapse/large restore keep the same input, local files and preferred height", () => {
  const disk = vi.spyOn(Storage.prototype, "setItem");
  const view = render(<OfficeManagerProvider><ManagerFixture /></OfficeManagerProvider>);
  const input = screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "유지할 초안" } });
  const file = new File(["local"], "fixture.pdf", { type: "application/pdf" });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  const separator = screen.getByRole("separator");
  fireEvent.keyDown(separator, { key: "ArrowDown" });
  const h = separator.getAttribute("aria-valuenow");
  fireEvent.click(screen.getByRole("button", { name: "크게 보기" }));
  expect(Number(separator.getAttribute("aria-valuenow"))).toBeGreaterThan(Number(h));
  fireEvent.click(screen.getByRole("button", { name: "원래 크기" }));
  expect(separator.getAttribute("aria-valuenow")).toBe(h);
  fireEvent.click(screen.getByRole("button", { name: "접기", exact: true }));
  expect(screen.queryByRole("log")).toBeNull();
  expect(input.isConnected).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "매니저 진입" }));
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe(h);
  expect(screen.getByRole("textbox", { name: "업무 입력" })).toBe(input);
  expect(input.value).toBe("유지할 초안");
  expect(screen.getByText("fixture.pdf")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "fixture.pdf 제거" }));
  expect(screen.queryByText("fixture.pdf")).toBeNull();
  expect(disk).not.toHaveBeenCalled();
});
it("blocks all send paths, preserves Shift Enter and IME behavior, supports drop and clipboard images", () => {
  const view = render(<OfficeManagerProvider><ManagerFixture /></OfficeManagerProvider>);
  const input = screen.getByRole("textbox", { name: "업무 입력" });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
  fireEvent.compositionStart(input);
  expect(fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true })).toBe(true);
  fireEvent.compositionEnd(input);
  expect(fireEvent.submit(input.closest("form")!)).toBe(false);
  expect((screen.getByRole("button", { name: "전송" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.drop(input.closest("form")!, { dataTransfer: { files: [new File(["x"], "drop.txt", { type: "text/plain" })] } });
  fireEvent.paste(input, { clipboardData: { files: [new File(["x"], "paste.png", { type: "image/png" })] } });
  expect(screen.getByText("drop.txt")).toBeTruthy();
  expect(screen.getByText("paste.png")).toBeTruthy();
  expect(view.container.querySelectorAll('input[type="file"]')).toHaveLength(1);
});
it("clears draft and File references on account/Pool scope unmount", () => {
  const view = render(<OfficeManagerProvider key="a"><ManagerFixture /></OfficeManagerProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "업무 입력" }), { target: { value: "PRIVATE DRAFT" } });
  fireEvent.drop(screen.getByRole("textbox", { name: "업무 입력" }).closest("form")!, {
    dataTransfer: { files: [new File(["x"], "private.txt", { type: "text/plain" })] },
  });
  view.rerender(<OfficeManagerProvider key="b"><ManagerFixture /></OfficeManagerProvider>);
  expect((screen.getByRole("textbox", { name: "업무 입력" }) as HTMLTextAreaElement).value).toBe("");
  expect(screen.queryByText("private.txt")).toBeNull();
});
it("validates extension/MIME and file/count/total limits without reading files or creating URLs", () => {
  const files = ["run.exe", "macro.xlsm", "macro.docm", "a.pdf"].map(name => new File(["x"], name, { type: "application/x-msdownload" }));
  expect(addLocalFiles([], files).next).toHaveLength(0);
  expect(addLocalFiles([], files).errors).toHaveLength(4);
  const big = new File(["x"], "big.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: MAX_FILE_BYTES + 1 });
  expect(addLocalFiles([], [big]).errors).toHaveLength(1);
  const six = Array.from({ length: 6 }, (_, i) => new File(["x"], `${i}.txt`, { type: "text/plain" }));
  expect(addLocalFiles([], six).next).toHaveLength(5);
  const tens = ["a", "b", "c"].map(n => { const f = new File(["x"], `${n}.pdf`, { type: "application/pdf" }); Object.defineProperty(f, "size", { value: MAX_FILE_BYTES }); return f; });
  expect(addLocalFiles([], tens).next).toHaveLength(2);
});
