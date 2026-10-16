import { useEffect, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RealtimeProvider, useRealtime } from "../context/RealtimeContext";
import { queryClient } from "../lib/query-client";

function ConnectionStatus({ onAccessLost, businessRuntime }: { onAccessLost?: () => void; businessRuntime?: boolean }) {
  const { connected, accessDenied, syncStatus } = useRealtime();
  useEffect(() => { if (accessDenied) onAccessLost?.(); }, [accessDenied, onAccessLost]);
  return <details role="status" style={{ padding: "4px 16px", fontSize: 12, flexShrink: 0 }}>
    <summary>{connected ? "실시간 연결 확인됨" : "실시간 연결 대기 또는 중단"} · 연결 진단</summary>
    <p>{connected
      ? "실시간 연결 확인됨 — 연결 상태와 업무 데이터 재조회 완료는 별개입니다."
      : "실시간 연결 대기 또는 중단 — 네트워크 복구 후 자동 재연결합니다."}</p>
    <p>SSE 재동기화 신호: {({
      idle: "대기", required: "재연결·재조회 필요", syncing: "재조회 처리 중",
      current: businessRuntime ? "관련 업무 재조회 완료" : "연결 복구 신호 처리됨 (업무 조회 없음)", editing: "편집 보호 중", failed: "재조회 실패",
    })[syncStatus]}</p>
    <p>{businessRuntime ? "업무 조회 대상: Dashboard·회원목록·반·선택 회원의 발행 이력. 초기 조회 상태는 각 화면에서 확인합니다."
      : "업무 조회 대상: 없음. 업무 데이터 재동기화 완료는 이번 화면에서 검증하지 않습니다."}</p>
  </details>;
}

/** Shared F04 transport/coordinator; F05 mounts the existing business query consumers. */
export function DesktopRealtime({ token, scopeKey, children, onAccessLost, businessRuntime }: {
  token: string | null; scopeKey: string; children: ReactNode; onAccessLost?: () => void; businessRuntime?: boolean;
}) {
  return <QueryClientProvider client={queryClient}>
    <RealtimeProvider token={token} scopeKey={scopeKey}>
      <ConnectionStatus onAccessLost={onAccessLost} businessRuntime={businessRuntime} />
      {children}
    </RealtimeProvider>
  </QueryClientProvider>;
}
