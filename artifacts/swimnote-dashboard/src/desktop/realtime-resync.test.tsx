// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RealtimeProvider, useRealtime } from "../context/RealtimeContext";
import { useRealtimeDraft } from "../context/useRealtimeDraft";
import { RealtimeSync } from "../context/realtime-sync";

vi.mock("@/lib/api-client", () => ({ api: { getBaseUrl: () => "https://api.fixture/api" } }));
let streams: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }>;
let fetcher: ReturnType<typeof vi.fn>;
let client: QueryClient;
let reads: ReturnType<typeof vi.fn<() => Promise<string>>>;
function Probe() {
  const data = useQuery({ queryKey: ["students"], queryFn: reads });
  const { syncStatus, connected } = useRealtime();
  const form = useRealtimeDraft(["students"], data.data ?? "");
  return <>
    <output data-testid="transport">{String(connected)}</output>
    <output data-testid="sync">{syncStatus}</output>
    <output data-testid="data">{data.data}</output>
    <input aria-label="draft" value={form.draft} onChange={e => form.setDraft(e.target.value)} />
    {form.remoteChanged && <p role="alert">원격 변경 확인 필요</p>}
    <button onClick={form.discardAndRefresh}>입력 버리고 재조회</button>
  </>;
}
function tree(token = "fixture-a", scope = "user-a:pool-a") {
  return <QueryClientProvider client={client}>
    <RealtimeProvider token={token} scopeKey={scope}><Probe /></RealtimeProvider>
  </QueryClientProvider>;
}
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(1); }); }
async function event(value: unknown) {
  await act(async () => streams[streams.length - 1]!.controller.enqueue(
    new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)));
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  reads = vi.fn(async () => "원래 값");
  streams = [];
  fetcher = vi.fn(async (_url, options) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    options.signal.addEventListener("abort", () => {
      try { controller.error(new DOMException("aborted", "AbortError")); } catch { /* already closed */ }
    });
    streams.push({ controller, signal: options.signal });
    return { ok: true, status: 200, body };
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("does not refetch redundantly on initial connect; reconnect waits for actual query completion", async () => {
  render(tree()); await flush();
  expect(reads).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("sync").textContent).toBe("idle");
  let resolve!: (s: string) => void;
  reads.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => streams[0].controller.close());
  await act(async () => vi.advanceTimersByTimeAsync(1000)); await flush();
  expect(screen.getByTestId("transport").textContent).toBe("true");
  expect(screen.getByTestId("sync").textContent).toBe("syncing");
  expect(reads).toHaveBeenCalledTimes(2);
  await act(async () => resolve("새 값")); await flush();
  expect(screen.getByTestId("sync").textContent).toBe("current");
  expect(screen.getByTestId("data").textContent).toBe("새 값");
});
it("preserves actual controlled draft and query data, marks conflict, and reloads only after explicit discard", async () => {
  render(tree()); await flush();
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "미저장 입력" } });
  reads.mockResolvedValue("원격 값");
  await event({ type: "member.changed" });
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("미저장 입력");
  expect(screen.getByRole("alert").textContent).toBe("원격 변경 확인 필요");
  expect(reads).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("sync").textContent).toBe("editing");
  fireEvent.click(screen.getByText("입력 버리고 재조회")); await flush(); await flush();
  expect(reads).toHaveBeenCalledTimes(2);
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("원격 값");
});
it("uses the same conflict protection on reconnect, not just on a received event", async () => {
  render(tree()); await flush();
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "보존 입력" } });
  await act(async () => streams[0].controller.close());
  await act(async () => vi.advanceTimersByTimeAsync(1000)); await flush();
  expect(reads).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("보존 입력");
});
it("coalesces duplicate resync requests into one actual read wave", async () => {
  render(tree()); await flush();
  const status = vi.fn(), sync = new RealtimeSync(client, status);
  await act(async () => {
    const a = sync.refresh([["students"], ["students"]]);
    const b = sync.refresh([["students"]]);
    expect(a).toBe(b); await a;
  });
  expect(reads).toHaveBeenCalledTimes(2);
  sync.dispose();
});
it("does not mark failed query refresh as current and supports explicit retry", async () => {
  render(tree()); await flush();
  reads.mockRejectedValueOnce(new Error("fixture network"));
  await event({ type: "resync.required" }); await flush();
  expect(screen.getByTestId("sync").textContent).toBe("failed");
  fireEvent.click(screen.getByText("다시 조회")); await flush(); await flush();
  expect(screen.getByTestId("sync").textContent).toBe("current");
});
it("does not declare freshness from a late resync after authority is lost", async () => {
  render(tree()); await flush();
  let resolve!: (s: string) => void;
  reads.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await event({ type: "resync.required" });
  expect(screen.getByTestId("sync").textContent).toBe("syncing");
  await event({ type: "session.invalid", reason: "revoked" });
  await act(async () => resolve("권한 상실 후 늦은 응답")); await flush();
  expect(screen.getByTestId("sync").textContent).toBe("required");
  expect(screen.getByTestId("data").textContent).toBe("원래 값");
});
it.each(["expired", "revoked"])("stops retrying control-frame %s without exposing session data", async reason => {
  render(tree()); await flush();
  await event({ type: "session.invalid", reason });
  fireEvent(window, new Event("online"));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("transport").textContent).toBe("false");
});
it("treats unavailable authority as transient and resyncs after recovery", async () => {
  render(tree()); await flush();
  await event({ type: "session.invalid", reason: "unavailable" });
  await act(async () => vi.advanceTimersByTimeAsync(1000)); await flush();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(reads).toHaveBeenCalledTimes(2);
});
it.each([
  ["fixture-b", "user-b:pool-b"],
  ["fixture-a", "user-a:pool-b"],
])("aborts old scope and ignores late query results after %s/%s", async (token, scope) => {
  let oldResponse!: (s: string) => void;
  reads.mockImplementationOnce(() => new Promise(r => { oldResponse = r; }));
  const view = render(tree()); await flush();
  reads.mockResolvedValue("새 계정 값");
  view.rerender(tree(token, scope)); await flush(); await flush();
  expect(streams[0].signal.aborted).toBe(true);
  await act(async () => oldResponse("이전 계정 값")); await flush();
  expect(client.getQueryData(["students"])).toBe("새 계정 값");
  expect(screen.getByTestId("data").textContent).toBe("새 계정 값");
});
it("clears user queries on logout and ignores a late result", async () => {
  let resolve!: (s: string) => void;
  reads.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const view = render(tree()); await flush();
  view.rerender(<QueryClientProvider client={client}>
    <RealtimeProvider token={null}><p>로그아웃</p></RealtimeProvider>
  </QueryClientProvider>);
  await act(async () => resolve("이전 계정 값")); await flush();
  expect(client.getQueryData(["students"])).toBeUndefined();
  expect(streams[0].signal.aborted).toBe(true);
});
it("survives StrictMode effect replay with one active stream and working resync", async () => {
  render(<StrictMode>{tree()}</StrictMode>); await flush(); await flush();
  expect(streams.filter(s => !s.signal.aborted)).toHaveLength(1);
  const count = reads.mock.calls.length;
  await event({ type: "member.changed" }); await flush();
  expect(reads.mock.calls.length).toBe(count + 1);
});
