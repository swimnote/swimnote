/**
 * ModeContext — SWIMNOTE X 전역 Mode 상태 Context (WP3)
 *
 * 역할:
 *  - 로그인 후 현재 수영장 X모드 상태를 GET /pools/x-mode 로 조회
 *  - token / pool.id / 역할 변경 시 이전 결과 즉시 폐기 후 재조회
 *  - foreground 복귀, 수영장 전환, 수동 refreshMode() 호출 지원
 *  - 로그아웃 / pool null / 미지원 역할 시 idle 상태로 초기화
 *
 * 제외:
 *  - X 화면 분기, X 메뉴·로고·색상 (WP4)
 *  - super_admin / platform_admin / super_manager 자동 조회
 *  - RevenueCat 연동
 *  - 폴링 (주기 호출 없음)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth, apiRequest } from "@/context/AuthContext";

// ─── 공개 타입 ────────────────────────────────────────────────────────────────
export type XModeStatus =
  | "NOT_CONFIGURED"
  | "CURRICULUM_PENDING"
  | "READY";

export type PoolMode = "normal" | "x_pending" | "x";

export interface PoolModeResult {
  pool_id: string;
  mode: PoolMode;
  xmode_entitlement: boolean;
  xmode_config_status: XModeStatus;
}

export type ModeLoadState = "idle" | "loading" | "ready" | "error";

export interface ModeContextValue {
  /** 서버 판정값. idle/loading/error 시 null — UI 안전 기본값과 구분할 것 */
  mode: PoolMode | null;
  /** 서버 미확정(null result) 시 false */
  xmode_entitlement: boolean;
  /** 서버 미확정 시 null */
  xmode_config_status: XModeStatus | null;
  status: ModeLoadState;
  /** "unauthorized" | "forbidden" | "pool_not_found" | "server_error"
   *  | "timeout" | "network_error" | "parse_error" */
  error: string | null;
  /** 명시적 재조회 (foreground 복귀, WP4 등). 동시 호출 자동 차단. */
  refreshMode: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const DEFAULT_VALUE: ModeContextValue = {
  mode: null,
  xmode_entitlement: false,
  xmode_config_status: null,
  status: "idle",
  error: null,
  refreshMode: async () => {},
};

const ModeContext = createContext<ModeContextValue>(DEFAULT_VALUE);

// ─── 지원 역할 판별 ───────────────────────────────────────────────────────────
/** WP3에서 자동 조회하는 역할: pool_admin / sub_admin / teacher / parent_account */
const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

function _isSupportedRole(
  kind: string | null,
  activeRole: string | null,
  adminUserRole: string | undefined,
): boolean {
  if (kind === "parent") return true;
  if (kind === "admin") {
    const role = activeRole ?? adminUserRole ?? "";
    if (SUPER_ROLES.has(role)) return false;
    return role === "pool_admin" || role === "teacher" || role === "sub_admin";
  }
  return false;
}

// ─── 내부 상태 타입 ───────────────────────────────────────────────────────────
interface _ModeState {
  status: ModeLoadState;
  result: PoolModeResult | null;
  error: string | null;
}

const IDLE_STATE: _ModeState = { status: "idle", result: null, error: null };

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ModeProvider({ children }: { children: ReactNode }) {
  const { token, pool, isLoading, kind, adminUser, activeRole } = useAuth();
  const poolId = pool?.id ?? null;
  const supported = _isSupportedRole(kind, activeRole, adminUser?.role);

  const [state, setState] = useState<_ModeState>(IDLE_STATE);

  // 최신 값을 비동기 콜백에서 읽기 위한 Ref
  const tokenRef = useRef(token);
  const poolIdRef = useRef(poolId);
  const isLoadingRef = useRef(isLoading);
  const supportedRef = useRef(supported);

  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { poolIdRef.current = poolId; }, [poolId]);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);
  useEffect(() => { supportedRef.current = supported; }, [supported]);

  /** in-flight 잠금: 동시 중복 호출 방지 (useRef → 비동기 closure에서 안전) */
  const isRefreshingRef = useRef(false);
  /** sequence 카운터: stale 응답 폐기용. 새 요청마다 증가. */
  const seqRef = useRef(0);

  // ─── 핵심 fetch 함수 (안정적 — 내부는 모두 ref로 접근) ───────────────────
  const refreshMode = useCallback(async () => {
    // 이미 요청 중이면 중복 호출 차단
    if (isRefreshingRef.current) return;

    const t = tokenRef.current;
    const p = poolIdRef.current;

    // 조회 조건 미충족: 조용히 종료
    if (!t || !p || isLoadingRef.current || !supportedRef.current) return;

    isRefreshingRef.current = true;
    const seq = ++seqRef.current;

    setState({ status: "loading", result: null, error: null });

    try {
      const res = await apiRequest(t, "/pools/x-mode", {
        method: "GET",
        cache: "no-store",
      });

      // Stale guard: 더 새로운 요청이 시작됐으면 이 응답을 버림
      if (seqRef.current !== seq) return;

      if (!res.ok) {
        let error = "server_error";
        if (res.status === 401) error = "unauthorized";
        else if (res.status === 403) error = "forbidden";
        else if (res.status === 404) error = "pool_not_found";
        setState({ status: "error", result: null, error });
        return;
      }

      let data: PoolModeResult;
      try {
        data = await res.json();
      } catch {
        if (seqRef.current !== seq) return;
        setState({ status: "error", result: null, error: "parse_error" });
        return;
      }

      if (seqRef.current !== seq) return;
      setState({ status: "ready", result: data, error: null });
    } catch (e: any) {
      if (seqRef.current !== seq) return;
      const msg: string = e?.message ?? "";
      const isTimeout = msg.includes("시간이 초과") || (e?.name === "AbortError");
      setState({
        status: "error",
        result: null,
        error: isTimeout ? "timeout" : "network_error",
      });
    } finally {
      // 이 요청이 여전히 현재 요청인 경우에만 lock 해제
      if (seqRef.current === seq) {
        isRefreshingRef.current = false;
      }
    }
  }, []); // 안정적 참조 — 내부는 모두 ref로 읽음

  // ─── 자동 트리거: token / poolId / isLoading / supported 변화 감지 ─────────
  useEffect(() => {
    // 진행 중인 요청이 있으면 stale 처리
    seqRef.current++;
    isRefreshingRef.current = false;

    if (!token || !poolId || isLoading || !supported) {
      // 조건 미충족: 이전 결과 즉시 폐기 → idle
      setState(IDLE_STATE);
      return;
    }

    // 조건 충족: 재조회
    refreshMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, poolId, isLoading, supported]);
  // refreshMode 의도적 제외: 안정적 useCallback이지만 포함 시 finally 블록의
  // isRefreshingRef 해제와 상호작용하여 불필요한 재실행 가능성이 있음

  // ─── Context 값 ──────────────────────────────────────────────────────────
  const value: ModeContextValue = {
    mode: state.result?.mode ?? null,
    xmode_entitlement: state.result?.xmode_entitlement ?? false,
    xmode_config_status: state.result?.xmode_config_status ?? null,
    status: state.status,
    error: state.error,
    refreshMode,
  };

  return (
    <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}
