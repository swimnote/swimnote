/**
 * BrandContext.tsx
 * 수영장 브랜딩 컨텍스트
 *
 * 로그인 후 수영장별 테마 색상·로고·표시명을 앱 전체에 제공한다.
 * 앱스토어 이름: "스윔노트" (고정)
 * 앱 내 표시:    "수영장명" + "Powered by 스윔노트"
 *
 * ※ themeColor는 디자인 시스템 토큰(민트)으로 고정됩니다.
 *   풀별 커스텀 색상은 poolBrandColor에 보존되며 브랜딩 설정에서만 사용합니다.
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";

export const APP_PLATFORM_NAME = "스윔노트";
export const DEFAULT_THEME_COLOR = "#2EC4B6";
export const SUPER_ADMIN_COLOR   = "#7C3AED";

export interface BrandState {
  /** 수영장 표시 이름 (로그인 전 null) */
  poolName: string | null;
  /** 브랜드 주색상 (기본 #1A5CFF) */
  themeColor: string;
  /** 로고 URL (없으면 null) */
  logoUrl: string | null;
  /** 로고 이모지 (로고 없을 때 대체 표시) */
  logoEmoji: string | null;
  /** 헤더 표시 문자열: "수영장명" */
  headerTitle: string;
  /** 풀 서브타이틀: "Powered by 스윔노트" */
  headerSubtitle: string;
}

interface BrandContextType extends BrandState {
  /** 브랜드 정보 일괄 업데이트 */
  setBrand: (partial: Partial<BrandState>) => void;
  /** 로그아웃 시 초기화 */
  resetBrand: () => void;
  /** 테마 색상 단독 변경 */
  setThemeColor: (color: string) => void;
}

const DEFAULT_STATE: BrandState = {
  poolName: null,
  themeColor: DEFAULT_THEME_COLOR,
  logoUrl: null,
  logoEmoji: null,
  headerTitle: APP_PLATFORM_NAME,
  headerSubtitle: "",
};

const BrandContext = createContext<BrandContextType | null>(null);

const STORAGE_KEY = "brand_state";

export function BrandProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrandState>(DEFAULT_STATE);

  // 앱 재시작 시 캐시 복구
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v) {
        try {
          const cached: Partial<BrandState> = JSON.parse(v);
          setState((s) => computeState({ ...s, ...cached }));
        } catch {}
      }
    });
  }, []);

  const setBrand = useCallback((partial: Partial<BrandState>) => {
    setState((prev) => {
      const next = computeState({ ...prev, ...partial });
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const setThemeColor = useCallback((color: string) => {
    setBrand({ themeColor: color });
  }, [setBrand]);

  const resetBrand = useCallback(() => {
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    setState(DEFAULT_STATE);
  }, []);

  return (
    <BrandContext.Provider value={{ ...state, setBrand, resetBrand, setThemeColor }}>
      {children}
    </BrandContext.Provider>
  );
}

/** headerTitle / headerSubtitle 자동 계산 + themeColor 디자인 시스템 고정 */
function computeState(s: BrandState): BrandState {
  const poolName    = s.poolName?.trim() || null;
  const headerTitle = poolName ?? APP_PLATFORM_NAME;
  const headerSubtitle = poolName ? `Powered by ${APP_PLATFORM_NAME}` : "";
  return { ...s, headerTitle, headerSubtitle, themeColor: Colors.light.tint };
}

export function useBrand(): BrandContextType {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand must be used within BrandProvider");
  return ctx;
}
