// Test-only renderer: real OFFICE components, explicitly synthetic auth/transport, not product auth.
import React, { useState, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { DesktopRoutes } from "../../artifacts/swimnote-dashboard/src/desktop/DesktopApp";
import { OfficeActionProvider } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeActionProvider";
import { OfficeNavigationProvider } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeNavigation";
import { api } from "../../artifacts/swimnote-dashboard/src/lib/api-client";
import { setToken } from "../../artifacts/swimnote-dashboard/src/lib/token";
import { useOfficeActions } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeActionContext";
import { useOfficeNavigation } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeNavigation";
import "../../artifacts/swimnote-dashboard/src/index.css";
declare const __FIXTURE_SESSION__: string;
declare const __FIXTURE_SESSIONS__: Record<string, string>;
setToken(__FIXTURE_SESSION__);
const actor = { userId: "fixture_admin", poolId: "fixture_pool", role: "pool_admin" };
const transport = { mode: "server" as const,
  prepare: (body: unknown) => api.post<{ requestId: string }>("/office/requests", body),
  write: (body: unknown) => api.post<any>("/office/command", body),
  status: (id: string) => api.get<any>("/office/commands/" + encodeURIComponent(id)),
  interpret: (body: unknown) => api.post("/office/interpret", body),
};
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function Controls({ switchActor }: { switchActor: (id: string) => void }) {
  const actions = useOfficeActions(), navigation = useOfficeNavigation();
  useLayoutEffect(() => {
    (window as any).__officeFixture = { actions, navigation, switchActor,
      readMembers: () => api.get("/students?pool_all=true"),
      readReceipt: (id: string) => api.get("/office/commands/" + encodeURIComponent(id)) };
  });
  return null;
}
function FixtureApp() {
  const [currentActor, setActor] = useState(actor);
  const switchActor = (userId: string) => {
    if (!__FIXTURE_SESSIONS__[userId]) throw new Error("Synthetic principal only");
    setToken(__FIXTURE_SESSIONS__[userId]); qc.clear(); setActor({ ...actor, userId });
  };
  return <QueryClientProvider client={qc}><Router>
  <aside role="note">합성 전용 격리 검증 — 운영 인증·운영 데이터 미연결 · 실제 AI는 승인된 실행에서만 사용</aside>
  <OfficeNavigationProvider key={currentActor.userId}><OfficeActionProvider actor={currentActor} stage3={transport}>
    <Controls switchActor={switchActor} /><DesktopRoutes />
  </OfficeActionProvider></OfficeNavigationProvider>
</Router></QueryClientProvider>;
}
createRoot(document.getElementById("root")!).render(<FixtureApp />);
