/**
 * AppUpdateButton — 스토어 + OTA 순서로 업데이트를 확인하는 버튼
 *
 * 동작 순서:
 *  1. /api/app-version 호출 → 서버가 선언한 latest_version과 설치 버전 비교
 *     - 스토어 새 버전 있음 → "새 버전이 있습니다" 알림 → 스토어 이동
 *  2. 스토어 버전이 최신일 때만 OTA 확인
 *     - OTA 있음 → 다운로드 → 재시작
 *     - OTA 없음 → "현재 최신 버전입니다"
 *  3. API 조회 실패 → "업데이트 정보를 확인할 수 없습니다" (최신 버전 아님으로 처리)
 */
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { API_BASE } from "@/context/AuthContext";

const C = Colors.light;

const IOS_STORE_URL     = "https://apps.apple.com/kr/app/%EC%8A%A4%EC%9C%94%EB%85%B8%ED%8A%B8/id6761360360";
const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.swimnote.app";

interface Props {
  themeColor?: string;
}

type UpdateState = "idle" | "checking" | "downloading" | "done" | "no_update" | "store_update" | "error";

/** semver 비교: a < b → -1, a === b → 0, a > b → 1 */
function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

export default function AppUpdateButton({ themeColor = "#1A5CFF" }: Props) {
  const [state, setState] = useState<UpdateState>("idle");

  async function handlePress() {
    if (state === "checking" || state === "downloading") return;
    setState("checking");

    // ─── 1단계: 서버에서 최신 스토어 버전 조회 ───
    let latestVersion: string | null = null;
    let storeUrl: string;
    try {
      const res = await fetch(`${API_BASE}/app-version`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const platform = Platform.OS === "ios" ? "ios" : "android";
      latestVersion = data[platform]?.latest_version ?? null;
      storeUrl = data.store_urls?.[platform]
        ?? (Platform.OS === "ios" ? IOS_STORE_URL : ANDROID_STORE_URL);
    } catch {
      setState("error");
      Alert.alert(
        "업데이트 확인 실패",
        "업데이트 정보를 확인할 수 없습니다.\n잠시 후 다시 시도해 주세요.",
        [{ text: "확인", onPress: () => setState("idle") }],
      );
      return;
    }

    // ─── 2단계: 설치 버전 읽기 ───
    // Constants.nativeAppVersion = 실제 설치된 네이티브 앱 버전 (CFBundleShortVersionString / versionName)
    const installedVersion: string =
      (Constants as any).nativeAppVersion
      ?? Constants.expoConfig?.version
      ?? "0.0.0";

    // ─── 3단계: 스토어 버전 비교 ───
    if (latestVersion && cmpSemver(installedVersion, latestVersion) < 0) {
      // 스토어에 새 버전 있음
      setState("store_update");
      Alert.alert(
        "새 버전이 있습니다",
        `현재 버전: ${installedVersion}\n최신 버전: ${latestVersion}\n\n더 안정적인 SWIMNOTE 사용을 위해 앱을 업데이트해 주세요.`,
        [
          { text: "나중에", style: "cancel", onPress: () => setState("idle") },
          {
            text: "업데이트하기",
            onPress: () => {
              setState("idle");
              Linking.openURL(storeUrl).catch(() => {});
            },
          },
        ],
      );
      return;
    }

    // ─── 4단계: 스토어 최신 → OTA 확인 ───
    if (!Updates.isEnabled) {
      // 개발 환경 등 OTA 비활성화
      setState("no_update");
      Alert.alert(
        "현재 최신 버전입니다",
        `${installedVersion} 버전을 사용하고 있습니다.`,
        [{ text: "확인", onPress: () => setState("idle") }],
      );
      return;
    }

    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setState("downloading");
        await Updates.fetchUpdateAsync();
        setState("done");
        await Updates.reloadAsync();
      } else {
        setState("no_update");
        Alert.alert(
          "현재 최신 버전입니다",
          `${installedVersion} 버전을 사용하고 있습니다.`,
          [{ text: "확인", onPress: () => setState("idle") }],
        );
      }
    } catch (err: any) {
      setState("idle");
      Alert.alert(
        "OTA 업데이트 확인 실패",
        `오류: ${err?.message ?? String(err)}\n\n스토어에서 직접 확인하시겠습니까?`,
        [
          { text: "취소", style: "cancel" },
          { text: "스토어 열기", onPress: () => Linking.openURL(storeUrl).catch(() => {}) },
        ],
      );
    }
  }

  const isLoading = state === "checking" || state === "downloading";

  const labelMap: Record<UpdateState, string> = {
    idle:         "업데이트 확인",
    checking:     "확인 중...",
    downloading:  "다운로드 중...",
    done:         "재시작 중...",
    no_update:    "최신 버전입니다",
    store_update: "새 버전 있음",
    error:        "확인 실패",
  };

  const subMap: Record<UpdateState, string> = {
    idle:         "스토어 및 OTA 업데이트 확인",
    checking:     "업데이트를 확인하고 있습니다",
    downloading:  "업데이트를 다운로드하고 있습니다",
    done:         "앱을 재시작합니다",
    no_update:    "현재 최신 버전이 설치되어 있습니다",
    store_update: "스토어에서 업데이트하세요",
    error:        "잠시 후 다시 시도해 주세요",
  };

  return (
    <Pressable
      style={({ pressed }) => [s.btn, { opacity: pressed && !isLoading ? 0.75 : 1 }]}
      onPress={handlePress}
      disabled={isLoading}
    >
      <View style={[s.iconBox, { backgroundColor: themeColor + "15" }]}>
        {isLoading
          ? <ActivityIndicator size="small" color={themeColor} />
          : <LucideIcon name="upload-cloud" size={18} color={themeColor} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.label, { color: themeColor }]}>{labelMap[state]}</Text>
        <Text style={s.sub}>{subMap[state]}</Text>
      </View>
      {!isLoading && <LucideIcon name="refresh-cw" size={15} color={C.textMuted} />}
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: "#00000010",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 15,
    fontFamily: "Pretendard-Regular",
  },
  sub: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    marginTop: 2,
  },
});
