/**
 * RealtimeContext — Dashboard SSE 실시간 동기화
 *
 * - 인증 상태에서 GET /admin/events/stream (Bearer JWT) 연결
 * - pool_events 수신 → React Query invalidate
 * - reconnect: 1s → 2s → 5s → 10s → 30s (backoff)
 * - 로그아웃 시 즉시 abort
 * - heartbeat 수신 시 no-op
 * - 개인정보 payload 없음: { type, entity_id } 만 수신
 */

import { createContext, useContext, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

// ── Query key mapping ─────────────────────────────────────────────────────────
const EVENT_QUERY_MAP: Record<string, string[][]> = {
  "member.changed": [
    ["students"],
    ["withdrawn-members"],
    ["dashboard-stats"],
  ],
  "class.changed": [
    ["class-groups"],
    ["students"],
    ["dashboard-stats"],
  ],
  "makeup.changed": [
    ["makeups"],
    ["dashboard-stats"],
  ],
  "growth_report.changed": [
    ["growth-reports-list"],
    ["growth-reports-pending"],
    ["growth-reports-published"],
    ["dashboard-stats"],
  ],
  "diary.changed": [
    ["diaries-admin"],
  ],
  "teacher.changed": [
    ["teacher-invites"],
  ],
  "curriculum.changed": [
    ["curriculum-levels"],
    ["curriculum-versions"],
    ["diary-templates"],
  ],
  "pool_settings.changed": [
    ["homepage-settings"],
    ["x-setup-status"],
  ],
};

// ── Context ───────────────────────────────────────────────────────────────────
interface RealtimeCtx {
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeCtx>({ connected: false });

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];

export function RealtimeProvider({ children, token }: { children: React.ReactNode; token: string | null }) {
  const qc = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const backoffIdx = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!token) {
      // Not logged in — abort any existing connection
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    let stopped = false;

    function clearReconnect() {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    }

    async function connect() {
      if (stopped || !mountedRef.current) return;
      clearReconnect();

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const BASE = api.getBaseUrl();
        const url = `${BASE}/admin/events/stream`;

        const resp = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: controller.signal,
        });

        if (resp.status === 401) {
          // Token invalid — stop reconnecting, let auth layer handle
          console.warn("[realtime] SSE 401 — stopping");
          return;
        }

        if (!resp.ok || !resp.body) {
          throw new Error(`SSE ${resp.status}`);
        }

        // Reset backoff on successful connection
        backoffIdx.current = 0;

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "ping") continue;
            try {
              const event: { type: string; entity_id?: string } = JSON.parse(raw);
              const keys = EVENT_QUERY_MAP[event.type];
              if (keys) {
                for (const key of keys) {
                  qc.invalidateQueries({ queryKey: key });
                }
              }
            } catch { /* ignore malformed */ }
          }
        }

        // Stream ended normally — reconnect
        if (!stopped) scheduleReconnect();

      } catch (e: any) {
        if (e?.name === "AbortError" || stopped) return;
        console.warn("[realtime] SSE error:", e?.message);
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (stopped || !mountedRef.current) return;
      const delay = BACKOFF_STEPS[Math.min(backoffIdx.current, BACKOFF_STEPS.length - 1)];
      backoffIdx.current = Math.min(backoffIdx.current + 1, BACKOFF_STEPS.length - 1);
      console.log(`[realtime] reconnect in ${delay}ms`);
      reconnectTimer.current = setTimeout(connect, delay);
    }

    // Handle browser online event for fast reconnect
    function onOnline() {
      clearReconnect();
      backoffIdx.current = 0;
      abortRef.current?.abort();
      connect();
    }
    window.addEventListener("online", onOnline);

    connect();

    return () => {
      stopped = true;
      clearReconnect();
      abortRef.current?.abort();
      abortRef.current = null;
      window.removeEventListener("online", onOnline);
    };
  }, [token, qc]);

  return (
    <RealtimeContext.Provider value={{ connected: !!token }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
