/**
 * ModeContext — SWIMNOTE X 전역 Mode·Capability 상태 Context (WP3 + WP6)
 *
 * 역할:
 *  - 로그인 후 현재 수영장 X모드 상태를 GET /pools/x-mode 로 조회
 *  - token / pool.id / 역할 변경 시 이전 결과 즉시 폐기 후 재조회
 *  - foreground 복귀, 수영장 전환, 수동 refreshMode() 호출 지원
 *  - 로그아웃 / pool null / 미지원 역할 시 idle 상태로 초기화
 *  - WP6: capabilities / hasCapability() — 기능별 X Capability 제공
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

// ─── WP6: X Capability 타입 ───────────────────────────────────────────────────

export type XCapabilityKey =
  | "x_mode"
  | "x_dashboard"
  | "ai_diary"
  | "ai_curriculum"
  | "growth_tracking"
  | "parent_ai"
  | "growth_report";

export interface XCapabilities {
  /** mode === "x" 여부 */
  x_mode:          boolean;
  /** X 브랜드 섹션·기본 화면 노출 권한 (성장 기능 활성화 권한이 아님) */
  x_dashboard:     boolean;
  /** AI 일지 V2 — false 고정 (AI Engine 연결 후 전환) */
  ai_diary:        boolean;
  /** AI 커리큘럼 — false 고정 */
  ai_curriculum:   boolean;
  /** 성장 추적 (Growth Event·성장판) — false 고정 */
  growth_tracking: boolean;
  /** 학부모 AI — false 고정 */
  parent_ai:       boolean;
  /** 성장 리포트 — false 고정 */
  growth_report:   boolean;
}

const EMPTY_X_CAPABILITIES: XCapabilities = {
  x_mode:          false,
  x_dashboard:     false,
  ai_diary:        false,
  ai_curriculum:   false,
  growth_tracking: false,
  parent_ai:       false,
  growth_report:   false,
};

/** capabilities 응답 런타임 검증 — fail-closed */
function _isValidCapabilities(v: unknown): v is XCapabilities {
  if (!v || typeof v !== "object") return false;
  const keys: XCapabilityKey[] = [
    "x_mode", "x_dashboard", "ai_diary", "ai_curriculum",
    "growth_tracking", "parent_ai", "growth_report",
  ];
  return keys.every((k) => typeof (v as any)[k] === "boolean");
}

// ─── Context 인터페이스 ────────────────────────────────────────────────────────

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
  // ── WP6 ──
  /** 기능별 Capability. status !== "ready" 또는 parse 실패 시 전부 false */
  capabilities: XCapabilities | null;
  /** capability_version 상수 ("capability_v1"). status !== "ready" 시 null */
  capability_version: string | null;
  /**
   * 특정 Capability 키가 활성화되어 있는지 확인.
   * capabilities가 null이거나 false이면 false 반환 (fail-closed).
   */
  hasCapability: (key: XCapabilityKey) => boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────
const DEFAULT_VALUE: ModeContextValue = {
  mode: null,
  xmode_entitlement: false,
  xmode_config_status: null,
  status: "idle",
  error: null,
  refreshMode: async () => {},
  capabilities: null,
  capability_version: null,
  hasCapability: () => false,
};

const ModeContext = createContext<ModeContextValue>(DEFAULT_VALUE);

// ─── 지원 역할 판별 ───────────────────────────────────────────────────────────
/**
 * WP3 자동 조회 허용: pool_admin / teacher / parent_account
 * 제외: sub_admin / super_admin / platform_admin / super_manager / 레거시 parent / 미확인 역할
 *
 * WP2 서버 GET /pools/x-mode 허용 역할과 1:1 일치시킴.
 * - kind === "parent"  → JWT role = parent_account → 허용
 * - kind === "admin"   → activeRole 또는 adminUser.role 기준, pool_admin / teacher만 허용
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
    return role === "pool_admin" || role === "teacher";
  }
  return false;
}

// ─── 내부 상태 타입 ───────────────────────────────────────────────────────────
interface _ModeState {
  status: ModeLoadState;
  result: PoolModeResult | null;
  error: string | null;
  capabilities: XCapabilities | null;
  capability_version: string | null;
}

const IDLE_STATE: _ModeState = {
  status: "idle",
  result: null,
  error: null,
  capabilities: null,
  capability_version: null,
};

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

    setState({ status: "loading", result: null, error: null, capabilities: null, capability_version: null });

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
        setState({ status: "error", result: null, error, capabilities: null, capability_version: null });
        return;
      }

      let rawData: any;
      try {
        rawData = await res.json();
      } catch {
        if (seqRef.current !== seq) return;
        setState({ status: "error", result: null, error: "parse_error", capabilities: null, capability_version: null });
        return;
      }

      if (seqRef.current !== seq) return;

      // PoolModeResult 추출
      const data: PoolModeResult = {
        pool_id:              rawData.pool_id,
        mode:                 rawData.mode,
        xmode_entitlement:    rawData.xmode_entitlement,
        xmode_config_status:  rawData.xmode_config_status,
      };

      // WP6: Capability 파싱 — runtime validation, fail-closed
      const rawCaps = rawData.capabilities;
      const capVersion = typeof rawData.capability_version === "string"
        ? rawData.capability_version
        : null;
      const capabilities: XCapabilities = _isValidCapabilities(rawCaps)
        ? rawCaps
        : { ...EMPTY_X_CAPABILITIES }; // malformed → 전부 false

      setState({ status: "ready", result: data, error: null, capabilities, capability_version: capVersion });
    } catch (e: any) {
      if (seqRef.current !== seq) return;
      const msg: string = e?.message ?? "";
      const isTimeout = msg.includes("시간이 초과") || (e?.name === "AbortError");
      setState({
        status: "error",
        result: null,
        error: isTimeout ? "timeout" : "network_error",
        capabilities: null,
        capability_version: null,
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

  // ─── WP6: hasCapability stable callback ──────────────────────────────────
  const hasCapability = useCallback(
    (key: XCapabilityKey): boolean => state.capabilities?.[key] === true,
    [state.capabilities],
  );

  // ─── Context 값 ──────────────────────────────────────────────────────────
  const value: ModeContextValue = {
    mode: state.result?.mode ?? null,
    xmode_entitlement: state.result?.xmode_entitlement ?? false,
    xmode_config_status: state.result?.xmode_config_status ?? null,
    status: state.status,
    error: state.error,
    refreshMode,
    // WP6
    capabilities: state.capabilities,
    capability_version: state.capability_version,
    hasCapability,
  };

  return (
    <ModeContext.Provider value={value}>{children}</ModeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useMode(): ModeContextValue {
  return useContext(ModeContext);
}
