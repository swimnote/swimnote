/**
 * useOTAUpdate — expo-updates 기반 OTA 업데이트 체크·다운로드·재시작 훅
 *
 * 원칙:
 * - 인증 로드 완료 후에만 체크 시작 (enabled 플래그)
 * - 루프 방지: reload 직전 플래그 저장 → 재시작 후 1회 스킵
 * - 다운로드 실패는 앱 차단/로그아웃으로 이어지지 않음
 * - Updates.isEnabled 아닐 때 (dev) 조용히 스킵
 */
import { useEffect, useRef, useState } from "react";
import * as Updates from "expo-updates";
import AsyncStorage from "@react-native-async-storage/async-storage";

const OTA_RELOAD_FLAG = "@swimnote:ota_reload_triggered";

export interface OTAUpdateState {
  isAvailable: boolean;
  isDownloading: boolean;
  isError: boolean;
  applyUpdate: () => Promise<void>;
  dismiss: () => void;
  retry: () => void;
}

/**
 * @param enabled - true가 될 때 OTA 체크를 시작합니다.
 *   인증 로딩 완료 + 강제 업데이트 없음 조건에서 true 전달.
 */
export function useOTAUpdate(enabled: boolean): OTAUpdateState {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isError, setIsError] = useState(false);
  const checked = useRef(false);
  const reloading = useRef(false);

  useEffect(() => {
    if (!enabled || checked.current) return;
    checked.current = true;
    checkUpdate();
  }, [enabled]);

  async function checkUpdate() {
    if (!Updates.isEnabled) {
      // 개발 환경 (Expo Go / 로컬 Metro) — 조용히 스킵
      return;
    }

    // 루프 방지: 이전 실행에서 reload를 트리거했으면 이번 기동 1회 스킵
    try {
      const flag = await AsyncStorage.getItem(OTA_RELOAD_FLAG);
      if (flag === "1") {
        await AsyncStorage.removeItem(OTA_RELOAD_FLAG);
        console.log("[OTA] 방금 reload됨, 이번 체크 스킵");
        return;
      }
    } catch {}

    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setIsAvailable(true);
      }
    } catch (err) {
      // OTA 체크 실패 → 로그아웃 금지, 조용히 무시
      console.warn("[OTA] checkForUpdateAsync 실패:", err);
    }
  }

  async function applyUpdate() {
    if (isDownloading || reloading.current) return;
    setIsDownloading(true);
    setIsError(false);

    try {
      await Updates.fetchUpdateAsync();

      // reload 직전 루프 방지 플래그 저장
      try {
        await AsyncStorage.setItem(OTA_RELOAD_FLAG, "1");
      } catch {}

      reloading.current = true;
      await Updates.reloadAsync();
      // reloadAsync 이후 코드는 실행되지 않음 (앱 재시작)
    } catch (err) {
      console.warn("[OTA] fetch/reload 실패:", err);
      setIsDownloading(false);
      setIsError(true);
      reloading.current = false;
      // 플래그 롤백
      try { await AsyncStorage.removeItem(OTA_RELOAD_FLAG); } catch {}
    }
  }

  function dismiss() {
    setIsAvailable(false);
    setIsError(false);
  }

  function retry() {
    setIsError(false);
    applyUpdate();
  }

  return { isAvailable, isDownloading, isError, applyUpdate, dismiss, retry };
}
