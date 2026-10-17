import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LoginForm } from "../pages/LoginPage";
import { Button } from "../components/ui/Button";
import { DesktopSessionController } from "./session-controller";
import { DesktopRealtime } from "./DesktopRealtime";
import { getToken } from "../lib/token";
import { Redirect, Route, Switch } from "wouter";
import { AuthProvider } from "../contexts/AuthContext";
import { DashboardLayout } from "../layouts/DashboardLayout";
import HomePage from "../pages/HomePage";
import MembersPage from "../pages/members/MembersPage";
import type { LoginPreferences } from "../../desktop/contracts";
import { OfficeNavigationProvider, OfficeNavigationBar, useOfficeNavigate } from "./OfficeNavigation";
import { OfficeWorkspace } from "./OfficeWorkspace";
import { OfficeManagerProvider } from "./OfficeManagerContext";
import { OfficeActionProvider } from "./OfficeActionProvider";
import "./OfficeInteractions.css";

declare const __OFFICE_VERIFICATION_ID__: string;

export function DesktopApp() {
  const verificationId = typeof __OFFICE_VERIFICATION_ID__ === "string" ? __OFFICE_VERIFICATION_ID__ : "개발 미지정";
  const verificationStage = verificationId.startsWith("STAGE2-") ? "Stage 2 N01/N02" : "F05";
  const bridge = window.officeDesktop;
  const [controller] = useState(() => new DesktopSessionController(bridge));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [preferences, setPreferences] = useState<LoginPreferences>({ loginId: "", remember: false });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState("");
  const pendingLogin = useRef<LoginPreferences | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState("보안 연결 확인 중");
  useEffect(() => {
    let active = true;
    if (!bridge) setBridgeStatus("Desktop 보안 연결 없음 — 인증 차단");
    else bridge.getBootstrapInfo()
      .then(info => { if (active) setBridgeStatus(`Shell ${info.stage} · ${info.platform} · ${info.packaged ? "packaged" : "development"} · ${info.version}`); })
      .catch(() => { if (active) setBridgeStatus("Desktop 보안 연결 실패"); });
    void controller.restore();
    return () => { active = false; controller.cancel(); };
  }, [bridge, controller]);
  useEffect(() => {
    let active = true;
    if (bridge) void Promise.resolve().then(() => bridge.readLoginPreferences()).then(value => {
      if (active) setPreferences(value);
    }).catch(() => { if (active) setPreferencesError("로그인 편의 설정을 읽지 못했습니다. 기본값으로 진행합니다."); })
      .finally(() => { if (active) setPreferencesReady(true); });
    else setPreferencesReady(true);
    const invalid = () => { void controller.logout(); };
    window.addEventListener("office:session-invalid", invalid);
    return () => { active = false; window.removeEventListener("office:session-invalid", invalid); };
  }, [bridge, controller]);
  async function savePreferences(value: LoginPreferences) {
    setPreferences(value);
    try {
      if (!(await bridge?.saveLoginPreferences(value))?.ok) throw new Error();
      setPreferencesError("");
    } catch { setPreferencesError("로그인 편의 설정 저장에 실패했습니다. 이번 선택은 현재 실행에만 적용됩니다."); }
  }
  useEffect(() => {
    if (state.status === "login") pendingLogin.current = null;
    if (state.status === "authenticated" && pendingLogin.current) {
      const successful = pendingLogin.current;
      pendingLogin.current = null;
      void savePreferences(successful);
    }
  }, [state]);
  return (
    <div className="office-surface office-app" style={{ fontFamily: "'Segoe UI', 'Malgun Gothic', system-ui, sans-serif",
      ...(state.status === "authenticated" ? { height: "100dvh", display: "flex", flexDirection: "column" as const, overflow: "hidden" } : {}) }}>
      <header className="office-status-header">
        <span className="office-brand">SWIMNOTE OFFICE</span>
        <span className="office-status-compact">{state.status === "authenticated" ? `${state.user.poolName} · 조회 전용` : "인증 확인 · 조회 전용"}</span>
        <details className="office-diagnostics">
          <summary>검증본·인증 진단</summary>
          <div className="office-diagnostics-body">
          <p>SWIMNOTE OFFICE {verificationStage} · Dashboard·회원 조회 전용</p>
          {bridgeStatus} · 실제 renderer Origin: <output data-testid="renderer-origin">{window.location.origin}</output>
          <div>{verificationStage} 조회 전용 · unsigned 내부 검증본 · 해당 검증본 Windows UI 수용 미완료.
            검증본 ID: {verificationId}
          </div>
          {state.status === "authenticated" && <p>
            서버 사용자·Pool·권한 재검증 완료 · Pool: {state.user.poolName} · 역할: {state.user.role} · X 응답: {state.user.xMode}
            {" · "}로그인 유지: {state.remembered ? "켜짐 — main 안전 저장 성공 응답 확인" : "꺼짐"}.
            서버 권한 확인·안전 저장·SSE 연결·업무 재조회는 각각 별도 상태입니다.
          </p>}
          </div>
        </details>
      </header>
      {(!bridge || bridgeStatus === "Desktop 보안 연결 실패") && <p className="office-warning" role="alert">{bridgeStatus}</p>}
      {preferencesError && <p role="alert">{preferencesError}</p>}
      {state.status === "checking" && <p role="status" style={{ padding: 24 }}>인증 및 현재 접근 권한 확인 중…</p>}
      {state.status === "retry" && (
        <section style={{ padding: 24 }}>
          <p role="alert">{state.message}</p>
          <Button onClick={() => void controller.retry()}>다시 확인</Button>{" "}
          <Button onClick={() => void controller.logout()}>인증정보 삭제 후 로그인</Button>
        </section>
      )}
      {state.status === "login" && !preferencesReady && <p role="status">로그인 편의 설정 확인 중…</p>}
      {state.status === "login" && preferencesReady && (
        <>
          {state.message && <p role="alert" style={{ padding: "12px 24px" }}>{state.message}</p>}
          <LoginForm
            desktop
            bootstrapOnly={!bridge}
            redirectAfterLogin={false}
            beforeCredentials={controller.prepareLogin}
            initialLoginId={preferences.loginId}
            login={async token => {
              await controller.accept(token, preferences.remember);
              if (controller.getSnapshot().status !== "authenticated" || getToken() !== token) throw new Error("인증 또는 접근 권한 확인을 완료하지 못했습니다.");
            }}
            onLoginCandidate={loginId => { pendingLogin.current = { loginId, remember: preferences.remember }; }}
            footer={
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 14 }}>
                <input type="checkbox" checked={preferences.remember}
                  onChange={event => { void savePreferences({ ...preferences, remember: event.target.checked }); }} />
                이 PC에서 로그인 유지
              </label>
            }
          />
        </>
      )}
      {state.status === "authenticated" && (
        <DesktopRealtime key={`${state.user.id}:${state.user.swimming_pool_id ?? ""}`}
          businessRuntime token={getToken()} onAccessLost={controller.logout}
          scopeKey={`${state.user.id}:${state.user.swimming_pool_id ?? ""}`}>
          <AuthProvider desktopSession={controller}>
            <OfficeNavigationProvider key={`${state.user.id}:${state.user.swimming_pool_id ?? ""}:${state.user.role}:${state.user.xMode}`}>
              <OfficeActionProvider actor={{ userId: state.user.id, poolId: state.user.swimming_pool_id ?? "", role: state.user.role }}>
                <DesktopRoutes />
              </OfficeActionProvider>
            </OfficeNavigationProvider>
          </AuthProvider>
        </DesktopRealtime>
      )}
    </div>
  );
}

export function DesktopRoutes() {
  const navigate = useOfficeNavigate();
  return <OfficeManagerProvider><DashboardLayout fillAvailable>
    <OfficeWorkspace>
    <OfficeNavigationBar />
    <details className="office-capability" data-office-navigation>
      <summary>조회 전용 · 사용 범위</summary>
      <p role="note">홈 현황·회원목록·회원 상세만 조회할 수 있습니다. 등록·수정·연기·퇴원 및 다른 업무 메뉴는 아직 연결되지 않았습니다.</p>
    </details>
    <Switch>
      <Route path="/admin/login"><Redirect to="/admin" /></Route>
      <Route path="/admin" component={HomePage} />
      <Route path="/admin/members" component={MembersPage} />
      <Route>
        <section style={{ padding: 32 }}>
          <h1>현재 단계에서 지원하지 않는 메뉴입니다.</h1>
          <Button onClick={() => navigate("/admin")}>홈 현황으로 이동</Button>
          <Button onClick={() => navigate("/admin/members")}>회원목록 열기</Button>
        </section>
      </Route>
    </Switch>
    </OfficeWorkspace>
  </DashboardLayout></OfficeManagerProvider>;
}
