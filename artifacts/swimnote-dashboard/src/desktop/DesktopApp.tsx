import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LoginForm } from "../pages/LoginPage";
import { Button } from "../components/ui/Button";
import { DesktopSessionController } from "./session-controller";
import { DesktopRealtime } from "./DesktopRealtime";
import { getToken } from "../lib/token";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { AuthProvider } from "../contexts/AuthContext";
import { DashboardLayout } from "../layouts/DashboardLayout";
import HomePage from "../pages/HomePage";
import MembersPage from "../pages/members/MembersPage";
import type { LoginPreferences } from "../../desktop/contracts";

declare const __OFFICE_VERIFICATION_ID__: string;

export function DesktopApp() {
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
      .then(info => { if (active) setBridgeStatus(`${info.stage} · ${info.platform} · ${info.packaged ? "packaged" : "development"} · ${info.version}`); })
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
    <div style={{ fontFamily: "'Segoe UI', 'Malgun Gothic', system-ui, sans-serif" }}>
      <div role="status" style={{ padding: "12px 24px", background: "#EEF2FF", color: "#243B6B", fontSize: 14 }}>
        SWIMNOTE OFFICE F05 · Dashboard·회원 조회 전용
        <div style={{ marginTop: 4, fontSize: 12 }}>
          {bridgeStatus} · 실제 renderer Origin: <output data-testid="renderer-origin">{window.location.origin}</output>
          <div>F05 조회 전용 · unsigned 내부 검증본 · 실제 Windows 수용 미완료.
            검증본 ID: {typeof __OFFICE_VERIFICATION_ID__ === "string" ? __OFFICE_VERIFICATION_ID__ : "개발 미지정"}
          </div>
        </div>
      </div>
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
            <p style={{ margin: 0, padding: "8px 24px" }}>
              서버 사용자·Pool·권한 재검증 완료 · Pool: {state.user.poolName} · 역할: {state.user.role} · X 응답: {state.user.xMode}
              {" · "}로그인 유지: {state.remembered ? "켜짐 — main 안전 저장 성공 응답 확인" : "꺼짐"}
            </p>
            <DesktopRoutes />
          </AuthProvider>
        </DesktopRealtime>
      )}
    </div>
  );
}

function DesktopRoutes() {
  const [, navigate] = useLocation();
  return <DashboardLayout>
    <div role="note" style={{ padding: "12px 32px" }}>
      현재 사용 가능: 홈 현황·회원목록·회원 상세 조회. 등록·수정·연기·퇴원 및 다른 업무 메뉴는 이 단계에서 사용할 수 없습니다.
    </div>
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
  </DashboardLayout>;
}
