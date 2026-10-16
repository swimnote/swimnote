import { useEffect, useState, useSyncExternalStore } from "react";
import { LoginForm } from "../pages/LoginPage";
import { Button } from "../components/ui/Button";
import { DesktopSessionController } from "./session-controller";

export function DesktopApp() {
  const bridge = window.officeDesktop;
  const [controller] = useState(() => new DesktopSessionController(bridge));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [remember, setRemember] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState("보안 연결 확인 중");
  useEffect(() => {
    let active = true;
    if (!bridge) setBridgeStatus("Desktop 보안 연결 없음 — 인증 차단");
    else bridge.getBootstrapInfo()
      .then(info => { if (active) setBridgeStatus(`${info.stage} · ${info.platform} · ${info.packaged ? "packaged" : "development"} · ${info.version}`); })
      .catch(() => { if (active) setBridgeStatus("Desktop 보안 연결 실패"); });
    void controller.restore();
    return () => { active = false; controller.cancel(); };
  }, [bridge, controller]);
  useEffect(() => {
    if (state.status === "login") setRemember(false);
  }, [state.status]);
  return (
    <div style={{ fontFamily: "'Segoe UI', 'Malgun Gothic', system-ui, sans-serif" }}>
      <div role="status" style={{ padding: "12px 24px", background: "#EEF2FF", color: "#243B6B", fontSize: 14 }}>
        SWIMNOTE OFFICE F03 · 인증 및 로그인 유지 검증
        <div style={{ marginTop: 4, fontSize: 12 }}>
          {bridgeStatus} · 실제 renderer Origin: <output data-testid="renderer-origin">{window.location.origin}</output>
        </div>
      </div>
      {state.status === "checking" && <p role="status" style={{ padding: 24 }}>인증 및 현재 접근 권한 확인 중…</p>}
      {state.status === "retry" && (
        <section style={{ padding: 24 }}>
          <p role="alert">{state.message}</p>
          <Button onClick={() => void controller.retry()}>다시 확인</Button>{" "}
          <Button onClick={() => void controller.logout()}>인증정보 삭제 후 로그인</Button>
        </section>
      )}
      {state.status === "login" && (
        <>
          {state.message && <p role="alert" style={{ padding: "12px 24px" }}>{state.message}</p>}
          <LoginForm
            desktop
            bootstrapOnly={!bridge}
            redirectAfterLogin={false}
            beforeCredentials={controller.prepareLogin}
            login={token => controller.accept(token, remember)}
            footer={
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 14 }}>
                <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
                이 PC에서 로그인 유지
              </label>
            }
          />
        </>
      )}
      {state.status === "authenticated" && (
        <section style={{ padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>인증 및 OFFICE 접근 권한 확인 완료</h1>
          <p>{state.user.poolName} · {state.user.name}</p>
          <p>로그인 유지: {state.remembered ? "켜짐" : "꺼짐 — 프로그램 종료 시 인증정보를 보존하지 않습니다."}</p>
          <p>F03 인증 확인 화면입니다. 업무 화면·실시간 연결은 이번 범위에 포함하지 않습니다.</p>
          <Button onClick={() => void controller.logout()}>로그아웃 / 다른 계정으로 로그인</Button>
        </section>
      )}
    </div>
  );
}
