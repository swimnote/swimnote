import { useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RealtimeProvider, useRealtime } from "../context/RealtimeContext";
import { queryClient } from "../lib/query-client";

function ConnectionStatus({ onAccessLost }: { onAccessLost?: () => void }) {
  const { connected, accessDenied, syncStatus } = useRealtime();
  useEffect(() => { if (accessDenied) onAccessLost?.(); }, [accessDenied, onAccessLost]);
  return <div role="status" style={{ padding: "12px 24px" }}>
    <p>{connected
      ? "실시간 연결 확인됨 — 연결 상태와 업무 데이터 재조회 완료는 별개입니다."
      : "실시간 연결 대기 또는 중단 — 네트워크 복구 후 자동 재연결합니다."}</p>
    <p>SSE 재동기화 신호: {({
      idle: "대기", required: "재연결·재조회 필요", syncing: "재조회 처리 중",
      current: "연결 복구 신호 처리됨 (업무 조회 없음)", editing: "편집 보호 중", failed: "재조회 실패",
    })[syncStatus]}</p>
    <p>업무 조회 대상: 없음. 업무 데이터 재동기화 완료는 이번 화면에서 검증하지 않습니다.</p>
  </div>;
}

/** F04 transport only. No F05 business screen or member-data request is mounted here. */
export function DesktopRealtime({ token, scopeKey, children, onAccessLost }: {
  token: string | null; scopeKey: string; children: ReactNode; onAccessLost?: () => void;
}) {
  return <QueryClientProvider client={queryClient}>
    <RealtimeProvider token={token} scopeKey={scopeKey}>
      <ConnectionStatus onAccessLost={onAccessLost} />
      {children}
    </RealtimeProvider>
  </QueryClientProvider>;
}
