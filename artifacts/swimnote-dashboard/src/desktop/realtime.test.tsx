// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RealtimeProvider, useRealtime } from "../context/RealtimeContext";

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => client,
}));
const client = { invalidateQueries };
vi.mock("@/lib/api-client", () => ({ api: { getBaseUrl: () => "https://api.fixture/api" } }));
let fetcher: ReturnType<typeof vi.fn>;
let streams: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }>;
function Probe() {
  const { connected } = useRealtime();
  return <><output>{connected ? "connected" : "disconnected"}</output><input aria-label="draft" defaultValue="" /></>;
}
function tree(token: string | null) {
  return <RealtimeProvider token={token}><Probe /></RealtimeProvider>;
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  vi.useFakeTimers();
  invalidateQueries.mockClear();
  streams = [];
  fetcher = vi.fn(async (_url, options) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    options.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    streams.push({ controller, signal: options.signal });
    return { ok: true, status: 200, body };
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("uses canonical bearer SSE, reports actual transport and preserves an edited input", async () => {
  render(tree("fixture-token")); await flush();
  expect(fetcher).toHaveBeenCalledWith("https://api.fixture/api/admin/events/stream",
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer fixture-token" }) }));
  expect(screen.getByText("connected")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "미저장 입력" } });
  await act(async () => streams[0].controller.enqueue(
    new TextEncoder().encode('data: {"type":"member.changed"}\n\ndata: ping\n\n')));
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["students"] });
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("미저장 입력");
});
it("does not claim a connection while the handshake is pending", async () => {
  fetcher.mockReturnValue(new Promise(() => {}));
  render(tree("fixture-token")); await flush();
  expect(screen.getByText("disconnected")).toBeTruthy();
});
it("ignores a stale handshake after a replacement connection starts", async () => {
  let resolve!: (response: unknown) => void;
  fetcher.mockReturnValueOnce(new Promise(value => { resolve = value; }));
  render(tree("fixture-token")); await flush();
  fireEvent(window, new Event("online")); await flush();
  expect(screen.getByText("connected")).toBeTruthy();
  await act(async () => resolve({ status: 401, ok: false }));
  expect(screen.getByText("connected")).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([401, 403])("stops reconnecting on %s, including online events", async status => {
  fetcher.mockResolvedValue({ status, ok: false });
  render(tree("fixture-token")); await flush();
  fireEvent(window, new Event("online"));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText("disconnected")).toBeTruthy();
});
it("reconnects after EOF and server failure, and recovers online without duplicate streams", async () => {
  render(tree("fixture-token")); await flush();
  await act(async () => streams[0].controller.close());
  expect(screen.getByText("disconnected")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  fireEvent(window, new Event("online")); await flush();
  expect(streams[1].signal.aborted).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("retries a network or server error without claiming connection", async () => {
  fetcher.mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce({ status: 500, ok: false });
  render(tree("fixture-token")); await flush();
  expect(screen.getByText("disconnected")).toBeTruthy();
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(screen.getByText("connected")).toBeTruthy();
});
it("aborts old accounts and cancels reconnects on logout and unmount", async () => {
  const view = render(tree("account-a")); await flush();
  view.rerender(tree("account-b")); await flush();
  expect(streams[0].signal.aborted).toBe(true);
  view.rerender(tree(null)); await flush();
  expect(streams[1].signal.aborted).toBe(true);
  expect(screen.getByText("disconnected")).toBeTruthy();
  fireEvent(window, new Event("online"));
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.rerender(tree("account-c")); await flush();
  await act(async () => streams[2].controller.close());
  view.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(fetcher).toHaveBeenCalledTimes(3);
});
