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
  /**
   * 첫 번째 서버 mode 응답이 완료된 이후 true.
   * cold start 시 Normal 화면 flash 방지용 — true 이전에는 skeleton/loading 처리 권장.
   */
  modeInitialized: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const DEFAULT_VALUE: ModeContextValue = {
  mode: null,
  xmode_entitlement: false,
  xmode_config_status: null,
  status: "idle",
  error: null,
  refreshMode: async () => {},
  modeInitialized: false,
};

const ModeContext = createContext<ModeContextValue>(DEFAULT_VALUE);

// ─── 지원 역할 판별 ───────────────────────────────────────────────────────────
/**
 * WP3 자동 조회 허용: pool_admin / teacher / sub_admin / parent_account
 * 제외: super_admin / platform_admin / super_manager / 레거시 parent / 미확인 역할
 *
 * P0: sub_admin 추가 — 수영장이 X라면 sub_admin도 X mode 수신
 * - kind === "parent"  → JWT role = parent_account → 허용
 * - kind === "admin"   → activeRole 또는 adminUser.role 기준, pool_admin / teacher / sub_admin 허용
 */
function _isSupportedRole(
  kind: string | null,
  activeRole: string | null,
  adminUserRole: string | undefined,
): boolean {
  if (kind === "parent") {
    // 앱의 kind="parent"는 JWT role=parent_account에 대응
    return true;
  }
  if (kind === "admin") {
    const role = activeRole ?? adminUserRole ?? "";
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
const MODE_INITIALIZATION_GRACE_MS = 8_000;

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ModeProvider({ children }: { children: ReactNode }) {
  const { token, pool, isLoading, kind, adminUser, activeRole } = useAuth();
  const poolId = pool?.id ?? null;
  const supported = _isSupportedRole(kind, activeRole, adminUser?.role);

  const [state, setState] = useState<_ModeState>(IDLE_STATE);
  /** 첫 번째 mode 조회가 성공·실패·시간 초과 중 하나로 결정된 이후 true */
  const [modeInitialized, setModeInitialized] = useState(false);

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

    // P0 FIX A: loading 시작 시 이전 result 보존 (null 리셋 금지)
    // result: null 즉시 리셋 → mode = null → Normal flash 발생했던 원인
    setState(prev => ({ ...prev, status: "loading", error: null }));

    if (__DEV__) console.log("[XMODE] SERVER_FETCH_START", { poolId: p });

    // X mode 조회 실패가 홈 전체를 막지 않도록, 짧은 유예 시간 뒤에는
    // 안전한 error 상태로 진입시킨다. 늦게 도착한 정상 응답은 아래에서 그대로 반영된다.
    const initializationTimer = setTimeout(() => {
      if (seqRef.current !== seq) return;
      setState(prev => ({ status: "error", result: prev.result, error: "timeout" }));
      setModeInitialized(true);
      isRefreshingRef.current = false;
    }, MODE_INITIALIZATION_GRACE_MS);

    try {
      const res = await apiRequest(t, "/pools/x-mode", {
        method: "GET",
        cache: "no-store",
      });

      // Stale guard: 더 새로운 요청이 시작됐으면 이 응답을 버림
      if (seqRef.current !== seq) return;

      if (!res.ok) {
        let error = "server_error";
        // P0 FIX C: transient vs auth/not-found 구분
        // 401/403 = auth invalid → result 폐기 (다른 계정/권한 없음 확정)
        // 404     = pool_not_found → result 폐기 (pool 삭제 확정)
        // 5xx     = transient → 마지막 confirmed result 보존 (spec §6 D)
        let isTransient = false;
        if (res.status === 401) error = "unauthorized";
        else if (res.status === 403) error = "forbidden";
        else if (res.status === 404) error = "pool_not_found";
        else { isTransient = true; } // 5xx
        if (__DEV__) console.log("[XMODE] SERVER_" + (isTransient ? "TRANSIENT_ERROR" : "CONFIRMED"), { poolId: p, status: res.status, error, isTransient });
        setState(prev => ({ status: "error", result: isTransient ? prev.result : null, error }));
        setModeInitialized(true);
        return;
      }

      let data: PoolModeResult;
      try {
        data = await res.json();
      } catch {
        if (seqRef.current !== seq) return;
        // parse error는 transient로 처리 — 이전 result 보존
        setState(prev => ({ status: "error", result: prev.result, error: "parse_error" }));
        setModeInitialized(true);
        return;
      }

      if (seqRef.current !== seq) return;
      if (__DEV__) console.log("[XMODE] SERVER_CONFIRMED", { poolId: p, mode: data.mode, entitlement: data.xmode_entitlement });
      setState({ status: "ready", result: data, error: null });
      setModeInitialized(true);
    } catch (e: any) {
      if (seqRef.current !== seq) return;
      const msg: string = e?.message ?? "";
      const isTimeout = msg.includes("시간이 초과") || (e?.name === "AbortError");
      // P0 FIX C: transient network/timeout → 마지막 confirmed result 보존 (spec §6 D)
      // UNKNOWN != NORMAL: 네트워크 실패를 Normal entitlement 판정으로 취급하지 않음
      const errCode = isTimeout ? "timeout" : "network_error";
      if (__DEV__) console.log("[XMODE] SERVER_TRANSIENT_ERROR", { poolId: p, error: errCode });
      setState(prev => ({
        status: "error",
        result: prev.result,   // 이전 confirmed mode 보존
        error: errCode,
      }));
      setModeInitialized(true);
    } finally {
      clearTimeout(initializationTimer);
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

    if (!token || !poolId || !supported) {
      // 로그아웃 / pool 변경 / 미지원 역할: 이전 결과 폐기 → idle
      // (다른 계정·pool의 X cache가 누출되지 않도록 명시적 초기화)
      if (__DEV__) console.log("[XMODE] IDLE_RESET", { hasToken: !!token, hasPool: !!poolId, supported });
      setState(IDLE_STATE);
      return;
    }

    if (isLoading) {
      // P0 FIX B: auth 로딩 중 (token refresh 등) — result 보존, 재조회 대기
      // isLoading=false 시 이 useEffect가 다시 실행되어 refreshMode() 호출됨
      // 이전: IDLE_STATE 리셋 → mode=null → Normal flash 발생했던 원인
      if (__DEV__) console.log("[XMODE] AUTH_LOADING_WAIT", { poolId });
      return;
    }

    // 조건 충족: 재조회
    if (__DEV__) console.log("[XMODE] BOOT_START", { poolId, role: activeRole });
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
    modeInitialized,
  };

  return (
    <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}
