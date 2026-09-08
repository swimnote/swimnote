/**
 * useOnboarding.ts
 *
 * 온보딩 상태 관리 훅
 *
 * Core onboarding → SERVER-based (기기 변경해도 유지)
 * Feature guide   → AsyncStorage (기기/계정별 경량 관리)
 *
 * AsyncStorage key:
 *   @swimnote:guide:{userId}:{guide_id}:{version}
 *   (userId 포함 → 계정 전환 시 섞이지 않음)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import {
  GUIDE_VERSIONS,
  ONBOARDING_REQUIRED_VERSIONS,
  type CoreOnboardingKey,
  type GuideKey,
} from "@/constants/onboardingContent";

// ── Core Onboarding (server-based) ──────────────────────────────────────────

interface CoreState {
  loading: boolean;
  /** 이 core onboarding을 노출해야 하면 true */
  shouldShow: boolean;
}

/**
 * useCorOnboarding
 * 서버에서 완료 상태를 조회해 해당 role core onboarding 표시 여부를 결정.
 * 완료 시 `markComplete()`를 호출.
 */
export function useCoreOnboarding(
  token: string | null,
  key: CoreOnboardingKey
): CoreState & { markComplete: () => Promise<void> } {
  const [loading, setLoading] = useState(true);
  const [shouldShow, setShouldShow] = useState(false);
  const completedRef = useRef(false);
  const required = ONBOARDING_REQUIRED_VERSIONS[key];

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      try {
        const res = await apiRequest(token, "/onboarding/state");
        if (!res.ok || cancelled) { setLoading(false); return; }
        const data = await res.json();
        const entry = (data?.state ?? {})[key];
        const completedVersion = entry?.completed_version ?? 0;
        if (!cancelled) {
          setShouldShow(completedVersion < required);
        }
      } catch {
        // 네트워크 오류 시 노출하지 않음 (사용자 방해 최소화)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, key, required]);

  const markComplete = useCallback(async () => {
    if (!token || completedRef.current) return;
    completedRef.current = true;
    setShouldShow(false);
    try {
      await apiRequest(token, "/onboarding/complete", {
        method: "POST",
        body: JSON.stringify({ onboarding_key: key, completed_version: required }),
      });
    } catch {
      // 완료 기록 실패해도 local에서는 닫힘 유지
    }
  }, [token, key, required]);

  return { loading, shouldShow, markComplete };
}

// ── Feature Guide (AsyncStorage-based) ──────────────────────────────────────

interface GuideState {
  loading: boolean;
  /** 이 guide를 노출해야 하면 true */
  shouldShow: boolean;
}

/**
 * useFeatureGuide
 * AsyncStorage 기반 기능별 guide 표시 여부 관리.
 * userId 포함으로 계정 전환 시 섞이지 않음.
 */
export function useFeatureGuide(
  userId: string | null | undefined,
  guideKey: GuideKey
): GuideState & { markSeen: () => Promise<void> } {
  const [loading, setLoading] = useState(true);
  const [shouldShow, setShouldShow] = useState(false);
  const version = GUIDE_VERSIONS[guideKey];

  const storageKey = userId
    ? `@swimnote:guide:${userId}:${guideKey}:${version}`
    : null;

  useEffect(() => {
    if (!storageKey) { setLoading(false); return; }
    let cancelled = false;

    AsyncStorage.getItem(storageKey).then((val) => {
      if (!cancelled) {
        setShouldShow(val !== "seen");
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [storageKey]);

  const markSeen = useCallback(async () => {
    if (!storageKey) return;
    setShouldShow(false);
    await AsyncStorage.setItem(storageKey, "seen").catch(() => {});
  }, [storageKey]);

  return { loading, shouldShow, markSeen };
}

/**
 * clearUserGuides
 * 로그아웃 / 계정 전환 시 호출 가능 (선택적).
 * userId를 key에 포함하므로 다른 사용자와 섞이지 않아
 * 이 함수 호출 없이도 안전함.
 */
export async function clearUserGuides(userId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const userKeys = keys.filter((k) => k.startsWith(`@swimnote:guide:${userId}:`));
    if (userKeys.length > 0) await AsyncStorage.multiRemove(userKeys);
  } catch { /* noop */ }
}
