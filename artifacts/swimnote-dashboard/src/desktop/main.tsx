import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { LoginForm } from "../pages/LoginPage";
import "../index.css";

function DesktopBootstrap() {
  const [bridgeStatus, setBridgeStatus] = useState("보안 연결 확인 중");
  useEffect(() => {
    const bridge = window.officeDesktop;
    if (!bridge) {
      setBridgeStatus("Desktop 보안 연결 없음 — 브라우저 미리보기");
      return;
    }
    bridge.getBootstrapInfo().then((info) => {
      setBridgeStatus(`${info.stage} · ${info.platform} · ${info.packaged ? "packaged" : "development"} · ${info.version}`);
    }).catch(() => setBridgeStatus("Desktop 보안 연결 실패 — 결과를 전달해주세요"));
  }, []);
  return (
    <div style={{ fontFamily: "'Segoe UI', 'Malgun Gothic', system-ui, sans-serif" }}>
      <div role="status" style={{ padding: "12px 24px", background: "#EEF2FF", color: "#243B6B", fontSize: 14 }}>
        SWIMNOTE OFFICE F02 내부 검증용 · 로그인 화면 표시만 가능합니다.
        실제 아이디·비밀번호·PIN을 입력하지 마세요. 운영 서버 연결은 차단되어 있습니다.
        <div style={{ marginTop: 4, fontSize: 12 }}>
          <span>{bridgeStatus}</span>
          {" · 실제 renderer Origin: "}
          <output data-testid="renderer-origin">{window.location.origin}</output>
        </div>
      </div>
      <LoginForm bootstrapOnly login={async () => { throw new Error("F03 authentication is not enabled"); }} />
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("OFFICE renderer root missing");
createRoot(root).render(<StrictMode><Router base="/admin"><DesktopBootstrap /></Router></StrictMode>);
