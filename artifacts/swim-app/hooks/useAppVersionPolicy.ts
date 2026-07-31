/**
 * useAppVersionPolicy — 서버에서 앱 버전 정책을 조회하고 강제 업데이트 여부를 판단
 *
 * - 서버 장애 시 앱 차단 금지: 캐시 폴백 → 캐시 없으면 허용
 * - semantic version 비교 (문자열 비교 아님)
 * - 5분 캐시 TTL
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { API_BASE } from "@/context/auth/SessionContext";

const CACHE_KEY = "@swimnote:app_version_policy_cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

export interface AppVersionPolicy {
  platform: string;
  minimum_supported_version: string;
  latest_version: string;
  force_update: boolean;
  store_url: string;
  message: string;
  ota_required: boolean;
  updated_at: string;
}

export interface AppVersionPolicyResult {
  policy: AppVersionPolicy | null;
  isForceUpdate: boolean;
  isLoading: boolean;
}

/** semantic version 비교: a < b → true */
function semverLt(a: string, b: string): boolean {
  const parse = (v: string) => v.split(".").map(n => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 < b3;
}

function checkForceUpdate(policy: AppVersionPolicy, currentVersion: string): boolean {
  if (!policy.force_update) return false;
  if (!policy.minimum_supported_version) return false;
  return semverLt(currentVersion, policy.minimum_supported_version);
}

export function useAppVersionPolicy(): AppVersionPolicyResult {
  const [policy, setPolicy] = useState<AppVersionPolicy | null>(null);
  const [isForceUpdate, setIsForceUpdate] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchPolicy();
  }, []);

  async function fetchPolicy() {
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const currentVersion = Constants.expoConfig?.version ?? "1.5.6";

    // 1. 캐시 먼저 적용 (빠른 초기 렌더)
    try {
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (data && Date.now() - timestamp < CACHE_TTL_MS) {
          setPolicy(data);
          setIsForceUpdate(checkForceUpdate(data, currentVersion));
          setIsLoading(false);
          // 백그라운드 갱신은 계속 진행
        }
      }
    } catch {}

    // 2. 서버 최신 정책 fetch
    try {
      const res = await fetch(
        `${API_BASE}/app-version-policy?platform=${platform}`,
        { cache: "no-store", signal: AbortSignal.timeout(6000) },
      );
      if (res.ok) {
        const data: AppVersionPolicy = await res.json();
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data, timestamp: Date.now() }),
        );
        setPolicy(data);
        setIsForceUpdate(checkForceUpdate(data, currentVersion));
      }
    } catch (err) {
      // 서버 오류 → 캐시값 유지, 또는 캐시도 없으면 허용 (isForceUpdate=false 유지)
      console.warn("[AppVersionPolicy] fetch 실패, 캐시 또는 허용:", err);
    } finally {
      setIsLoading(false);
    }
  }

  return { policy, isForceUpdate, isLoading };
}
