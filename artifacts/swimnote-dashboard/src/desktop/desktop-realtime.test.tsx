// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DesktopRealtime } from "./DesktopRealtime";
vi.mock("@/lib/api-client", () => ({ api: { getBaseUrl: () => "https://api.fixture/api" } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("wires the Desktop boundary to bearer SSE without requesting business data and cleans up on logout", async () => {
  let signal!: AbortSignal;
  const fetcher = vi.fn(async (_url, init) => {
    signal = init.signal;
    const body = new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return { status: 200, ok: true, body };
  });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<DesktopRealtime token="fixture-only" scopeKey="fixture-user:fixture-pool">
    <p>인증 확인 완료</p>
  </DesktopRealtime>);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/실시간 연결 확인됨/)).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://api.fixture/api/admin/events/stream");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer fixture-only");
  view.unmount();
  expect(signal.aborted).toBe(true);
});
