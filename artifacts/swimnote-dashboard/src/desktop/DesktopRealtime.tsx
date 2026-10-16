import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RealtimeProvider, useRealtime } from "../context/RealtimeContext";
import { queryClient } from "../lib/query-client";

function ConnectionStatus() {
  const { connected } = useRealtime();
  return <p role="status">
    {connected
      ? "실시간 연결 확인됨 — 연결 상태와 업무 데이터 재조회 완료는 별개입니다."
      : "실시간 연결 대기 또는 중단 — 업무 데이터가 최신이라고 판단하지 않습니다."}
  </p>;
}

/** F04 transport only. No F05 business screen or member-data request is mounted here. */
export function DesktopRealtime({ token, scopeKey, children }: {
  token: string | null; scopeKey: string; children: ReactNode;
}) {
  return <QueryClientProvider client={queryClient}>
    <RealtimeProvider token={token} scopeKey={scopeKey}>
      <ConnectionStatus />
      {children}
    </RealtimeProvider>
  </QueryClientProvider>;
}
