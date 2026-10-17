// Test-only renderer: real OFFICE components, explicitly synthetic auth/transport, not product auth.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { DesktopRoutes } from "../../artifacts/swimnote-dashboard/src/desktop/DesktopApp";
import { OfficeActionProvider } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeActionProvider";
import { OfficeNavigationProvider } from "../../artifacts/swimnote-dashboard/src/desktop/OfficeNavigation";
import { api } from "../../artifacts/swimnote-dashboard/src/lib/api-client";
import { setToken } from "../../artifacts/swimnote-dashboard/src/lib/token";
import "../../artifacts/swimnote-dashboard/src/index.css";
declare const __FIXTURE_SESSION__: string;
setToken(__FIXTURE_SESSION__);
const actor = { userId: "fixture_admin", poolId: "fixture_pool", role: "pool_admin" };
const transport = { mode: "fixture" as const,
  prepare: (body: unknown) => api.post<{ requestId: string }>("/office/requests", body),
  write: (body: unknown) => api.post<any>("/office/command", body),
  status: (id: string) => api.get<any>("/office/commands/" + encodeURIComponent(id)),
  interpret: async () => { throw new Error("Paid AI is not enabled in this harness"); },
};
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={qc}><Router>
  <aside role="note">합성 전용 격리 검증 — 운영 인증·운영 데이터·실제 AI 미연결</aside>
  <OfficeNavigationProvider><OfficeActionProvider actor={actor} stage3={transport}><DesktopRoutes /></OfficeActionProvider></OfficeNavigationProvider>
</Router></QueryClientProvider>);
