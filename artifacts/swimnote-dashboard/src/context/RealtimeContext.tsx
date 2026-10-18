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

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { RealtimeSync, type SyncStatus } from "./realtime-sync";

// ── Query key mapping ─────────────────────────────────────────────────────────
const EVENT_QUERY_MAP: Record<string, string[][]> = {
  "member.changed": [
    ["students"],
    ["withdrawn-members"],
    ["dashboard-stats"],
    ["member-gr-history"],
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
    ["member-gr-history"],
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
  "transport.changed": [
    ["transport-v2"],["transport-v2-detail"],["transport-planning"],["transport-operations"],["transport-reconciliation"],
  ],
  "pool_settings.changed": [
    ["homepage-settings"],
    ["x-setup-status"],
  ],
};

// ── Context ───────────────────────────────────────────────────────────────────
interface RealtimeCtx {
  connected: boolean;
  accessDenied: boolean;
  syncStatus: SyncStatus;
  coordinator: RealtimeSync | null;
}

const RealtimeContext = createContext<RealtimeCtx>({
  connected: false, accessDenied: false, syncStatus: "idle", coordinator: null,
});

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];

export function RealtimeProvider({ children, token, scopeKey = "" }: {
  children: React.ReactNode; token: string | null; scopeKey?: string;
}) {
  const qc = useQueryClient();
  const [transport, setTransport] = useState<RealtimeSync | null>(null);
  const [activeSession, setActiveSession] = useState<RealtimeSync | null>(null);
  const [denied, setDenied] = useState<RealtimeSync | null>(null);
  const [sync, setSync] = useState<{ owner: RealtimeSync; status: SyncStatus } | null>(null);
  const coordinator = useMemo(() => new RealtimeSync(qc, status =>
    setSync({ owner: coordinator, status })), [qc, token, scopeKey]);

  useEffect(() => {
    coordinator.activate();
    setActiveSession(coordinator);
    setSync({ owner: coordinator, status: "idle" });
    setTransport(null);
    if (!token) return () => coordinator.dispose();

    let stopped = false;
    let authRejected = false;
    let offline = navigator.onLine === false;
    let connectedOnce = false;
    let abort: AbortController | null = null;
    let backoffIdx = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const allKeys = Object.values(EVENT_QUERY_MAP).flat();

    function clearReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    async function connect() {
      if (stopped || authRejected || offline) return;
      clearReconnect();
      abort?.abort();
      setTransport(null);

      const controller = new AbortController();
      abort = controller;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

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
        if (stopped || controller.signal.aborted || abort !== controller) {
          await resp.body?.cancel().catch(() => {});
          return;
        }

        if (resp.status === 401 || resp.status === 403) {
          // Token invalid — stop reconnecting, let auth layer handle
          authRejected = true;
          setDenied(coordinator);
          setTransport(null);
          coordinator.required();
          await resp.body?.cancel().catch(() => {});
          return;
        }

        if (!resp.ok || !resp.body) {
          await resp.body?.cancel().catch(() => {});
          throw new Error(`SSE ${resp.status}`);
        }

        // Reset backoff on successful connection
        backoffIdx = 0;
        setTransport(coordinator);
        if (connectedOnce) void coordinator.refresh(allKeys);
        connectedOnce = true;

        reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (stopped || controller.signal.aborted || abort !== controller) return;
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
              if (event.type === "session.invalid") {
                const reason = (event as { reason?: string }).reason;
                authRejected = reason !== "unavailable";
                if (authRejected) setDenied(coordinator);
                setTransport(null);
                coordinator.required();
                controller.abort();
                if (!authRejected) scheduleReconnect();
                return;
              }
              if (event.type === "resync.required") {
                void coordinator.refresh(allKeys);
                continue;
              }
              const keys = EVENT_QUERY_MAP[event.type];
              if (keys) void coordinator.refresh(keys);
            } catch { /* ignore malformed */ }
          }
        }

        // Stream ended normally — reconnect
        if (!stopped) { setTransport(null); coordinator.required(); scheduleReconnect(); }

      } catch (e: any) {
        if (e?.name === "AbortError" || stopped || controller.signal.aborted || abort !== controller) return;
        setTransport(null);
        coordinator.required();
        scheduleReconnect();
      } finally {
        if (reader) {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
    }

    function scheduleReconnect() {
      if (stopped || authRejected || offline) return;
      clearReconnect();
      const delay = BACKOFF_STEPS[Math.min(backoffIdx, BACKOFF_STEPS.length - 1)];
      backoffIdx = Math.min(backoffIdx + 1, BACKOFF_STEPS.length - 1);
      reconnectTimer = setTimeout(connect, delay);
    }

    // Handle browser online event for fast reconnect
    function onOnline() {
      clearReconnect();
      offline = false;
      backoffIdx = 0;
      void connect();
    }
    function onOffline() {
      offline = true;
      clearReconnect();
      abort?.abort();
      setTransport(null);
      coordinator.required();
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    connect();

    return () => {
      stopped = true;
      clearReconnect();
      abort?.abort();
      coordinator.dispose();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [token, qc, coordinator]);

  const syncStatus = sync?.owner === coordinator ? sync.status : "idle";
  const messages: Partial<Record<SyncStatus, string>> = {
    required: "실시간 갱신이 중단되었습니다. 재연결 후 데이터를 다시 조회합니다.",
    syncing: "연결은 복구됐으며 데이터를 다시 조회하고 있습니다.",
    editing: "편집 입력은 유지했습니다. 원격 변경이 있어 갱신 확인이 필요합니다.",
    failed: "최신 데이터 조회에 실패했습니다. 입력은 유지되며 다시 조회가 필요합니다.",
  };
  return (
    <RealtimeContext.Provider value={{
      connected: !!token && transport === coordinator,
      accessDenied: denied === coordinator,
      syncStatus,
      coordinator,
    }}>
      {token && (denied === coordinator || messages[syncStatus]) && (
        <div role="status" aria-live="polite">
          {denied === coordinator
            ? "인증 또는 수영장 접근 권한을 다시 확인해 주세요. 실시간 전송이 중단됐습니다."
            : messages[syncStatus]}
          {denied !== coordinator && syncStatus === "failed" && (
            <button type="button" onClick={() => void coordinator.refresh(Object.values(EVENT_QUERY_MAP).flat())}>
              다시 조회
            </button>
          )}
        </div>
      )}
      {token && activeSession !== coordinator
        ? <p role="status">사용자·수영장 조회 상태를 전환하고 있습니다.</p>
        : children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
