import type { OfficeDesktopBridge, StorageError } from "../../desktop/contracts";
import { readAuthSession, SessionAccessError, type AuthUser } from "../lib/auth-session";
import { clearToken, setToken } from "../lib/token";
import { queryClient } from "../lib/query-client";

export type DesktopAuthState =
  | { status: "checking" }
  | { status: "login"; message?: string; denied?: boolean }
  | { status: "retry"; message: string }
  | { status: "authenticated"; user: AuthUser; remembered: boolean };

const storageMessage = (error?: StorageError) => {
  if (error === "expired") return "저장된 인증이 만료되었습니다. 다시 로그인해주세요.";
  if (error === "clear-failed") return "저장된 인증정보를 제거하지 못했습니다. 제거를 다시 시도해주세요.";
  if (error === "decrypt-failed") return "저장된 인증정보를 복구하지 못했습니다. 일반 로그인으로 다시 진행해주세요.";
  return "이 PC에서 안전한 로그인 유지를 사용할 수 없습니다. 로그인 유지를 끄고 일반 로그인으로 다시 진행해주세요.";
};

/** Desktop lifecycle adapter. Authentication itself stays in the renderer's canonical APIs. */
export class DesktopSessionController {
  private state: DesktopAuthState = { status: "checking" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private abort?: AbortController;
  private retryCandidate?: { token: string; remember: boolean };

  constructor(private bridge: OfficeDesktopBridge | undefined) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(state: DesktopAuthState) {
    this.state = state;
    this.listeners.forEach(listener => listener());
  }
  cancel = () => { this.generation++; this.abort?.abort(); };
  private resetMemory() { clearToken(); queryClient.clear(); }

  restore = async () => {
    this.cancel();
    const generation = this.generation;
    this.retryCandidate = undefined;
    this.resetMemory();
    this.update({ status: "checking" });
    if (!this.bridge) {
      this.update({ status: "login", message: "Desktop 보안 연결이 없어 인증을 시작할 수 없습니다." });
      return;
    }
    try {
      const result = await this.bridge.restoreSession();
      if (generation !== this.generation) return;
      if (!result.token) {
        this.update({ status: "login", message: result.error ? storageMessage(result.error) : undefined });
        return;
      }
      await this.accept(result.token, result.remembered);
    } catch {
      if (generation === this.generation) this.update({ status: "login", message: storageMessage("decrypt-failed") });
    }
  };

  prepareLogin = async () => {
    this.cancel();
    const generation = this.generation;
    this.retryCandidate = undefined;
    this.resetMemory();
    let cleared = false;
    try { cleared = (await this.bridge?.clearSession())?.ok === true; } catch { /* Surface below. */ }
    if (!cleared) {
      if (generation === this.generation) this.update({ status: "retry", message: storageMessage("clear-failed") });
      throw new Error("이전 인증정보를 정리하지 못했습니다.");
    }
    if (generation !== this.generation) throw new Error("취소된 인증입니다.");
    this.update({ status: "login" });
  };

  accept = async (token: string, remember: boolean) => {
    this.cancel();
    const generation = this.generation;
    this.abort = new AbortController();
    this.resetMemory();
    this.retryCandidate = { token, remember };
    this.update({ status: "checking" });
    try {
      if (!this.bridge) throw new Error("Desktop 보안 연결이 없습니다.");
      setToken(token); // Memory only; never persist before canonical identity/Pool/access revalidation.
      const user = await readAuthSession(true, this.abort.signal);
      if (generation !== this.generation) return;
      // General OFFICE is free. X controls paid AI, never identity/Pool access.
      let stored;
      try { stored = await this.bridge.commitSession({ token, remember }); }
      catch { stored = { ok: false, error: "write-failed" as const }; }
      if (generation !== this.generation) return;
      if (!stored.ok) {
        this.retryCandidate = undefined;
        this.resetMemory();
        let removed = false;
        try { removed = (await this.bridge.clearSession()).ok; } catch { /* Surface below. */ }
        if (generation !== this.generation) return;
        this.update(removed ? { status: "login", message: storageMessage(stored.error) } :
          { status: "retry", message: storageMessage("clear-failed") });
        return;
      }
      this.retryCandidate = undefined;
      this.update({ status: "authenticated", user, remembered: remember });
    } catch (error) {
      if (generation !== this.generation) return;
      this.resetMemory();
      const status = (error as { status?: number })?.status;
      if (error instanceof SessionAccessError || status === 401 || status === 403 || status === 404) {
        this.retryCandidate = undefined;
        let cleared = false;
        try { cleared = (await this.bridge?.clearSession())?.ok === true; } catch { /* Surface below. */ }
        if (generation !== this.generation) return;
        if (!cleared) {
          this.update({ status: "retry", message: storageMessage("clear-failed") });
          return;
        }
        this.update({
          status: "login",
          denied: error instanceof SessionAccessError || status === 403,
          message: error instanceof SessionAccessError ? error.message :
            status === 403 ? "인증 후 현재 접근 권한을 확인하지 못했습니다. 다시 로그인해주세요." :
              "인증이 만료되었거나 더 이상 유효하지 않습니다. 다시 로그인해주세요.",
        });
      } else {
        // Network, CORS, 5xx and unknown entitlement are NOT authentication success or expiry.
        this.update({ status: "retry", message: "서버 연결 또는 권한 확인에 실패했습니다. 저장된 인증은 삭제하지 않았으며 진입은 차단됩니다." });
      }
    }
  };

  retry = async () => {
    const candidate = this.retryCandidate;
    if (candidate) await this.accept(candidate.token, candidate.remember);
    else await this.restore();
  };

  logout = async () => {
    this.cancel();
    const generation = this.generation;
    this.retryCandidate = undefined;
    this.resetMemory();
    this.update({ status: "checking" });
    try {
      const result = await this.bridge?.clearSession();
      if (generation !== this.generation) return;
      this.update(result?.ok ? { status: "login" } : { status: "retry", message: storageMessage("clear-failed") });
    } catch {
      if (generation === this.generation) this.update({ status: "retry", message: storageMessage("clear-failed") });
    }
  };
}
