/**
 * AppUpdateButton — OTA 또는 스토어 업데이트를 수동으로 트리거하는 버튼
 *
 * 동작:
 *  1. OTA 업데이트 확인 → 있으면 즉시 다운로드 후 앱 재시작
 *  2. OTA 없으면 앱스토어 / 플레이스토어 열기
 */
import * as Updates from "expo-updates";
import React, { useState } from "react";
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Download, RefreshCw } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

const IOS_STORE_URL     = "https://apps.apple.com/kr/app/%EC%8A%A4%EC%9C%94%EB%85%B8%ED%8A%B8/id6761360360";
const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.swimnote.app";

interface Props {
  themeColor?: string;
}

type UpdateState = "idle" | "checking" | "downloading" | "done" | "no_update";

export default function AppUpdateButton({ themeColor = "#1A5CFF" }: Props) {
  const [state, setState] = useState<UpdateState>("idle");

  async function handlePress() {
    if (state === "checking" || state === "downloading") return;

    setState("checking");
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
          "이미 최신 버전입니다",
          "현재 앱이 최신 버전입니다. 스토어에서도 확인하시겠습니까?",
          [
            { text: "취소", style: "cancel", onPress: () => setState("idle") },
            {
              text: "스토어 열기",
              onPress: () => {
                setState("idle");
                const url = Platform.OS === "ios" ? IOS_STORE_URL : ANDROID_STORE_URL;
                Linking.openURL(url).catch(() => {});
              },
            },
          ]
        );
      }
    } catch (err: any) {
      setState("idle");
      const msg = err?.message ?? String(err);
      Alert.alert(
        "업데이트 확인 실패",
        `오류: ${msg}\n\n스토어에서 직접 확인하시겠습니까?`,
        [
          { text: "취소", style: "cancel" },
          {
            text: "스토어 열기",
            onPress: () => {
              const url = Platform.OS === "ios" ? IOS_STORE_URL : ANDROID_STORE_URL;
              Linking.openURL(url).catch(() => {});
            },
          },
        ]
      );
    }
  }

  const isLoading = state === "checking" || state === "downloading";

  const labelMap: Record<UpdateState, string> = {
    idle:        "최신 버전 업데이트",
    checking:    "확인 중...",
    downloading: "다운로드 중...",
    done:        "재시작 중...",
    no_update:   "최신 버전입니다",
  };

  const subMap: Record<UpdateState, string> = {
    idle:        "OTA 업데이트 확인 및 스토어 업그레이드",
    checking:    "업데이트를 확인하고 있습니다",
    downloading: "업데이트를 다운로드하고 있습니다",
    done:        "앱을 재시작합니다",
    no_update:   "현재 최신 버전이 설치되어 있습니다",
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
          : <Download size={18} color={themeColor} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.label, { color: themeColor }]}>{labelMap[state]}</Text>
        <Text style={s.sub}>{subMap[state]}</Text>
      </View>
      {!isLoading && <RefreshCw size={15} color={C.textMuted} />}
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
