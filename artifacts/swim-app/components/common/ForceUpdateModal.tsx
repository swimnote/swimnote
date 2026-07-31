/**
 * ForceUpdateModal — 강제 업데이트 안내 모달
 *
 * - 절대 닫을 수 없음: 배경 터치·스와이프·Android 뒤로가기 모두 차단
 * - "스토어로 이동" 버튼만 제공
 */
import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Linking,
  Platform,
  BackHandler,
} from "react-native";
import { useEffect } from "react";
import { Download } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  storeUrl?: string | null;
  message?: string | null;
}

export default function ForceUpdateModal({ visible, storeUrl, message }: Props) {
  const defaultUrl =
    Platform.OS === "ios"
      ? "https://apps.apple.com/kr/app/%EC%8A%A4%EC%9C%94%EB%85%B8%ED%8A%B8/id6761360360"
      : "https://play.google.com/store/apps/details?id=com.swimnote.app";

  // Android 뒤로가기 버튼 차단
  useEffect(() => {
    if (!visible || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [visible]);

  function openStore() {
    const url = storeUrl || defaultUrl;
    Linking.openURL(url).catch(() => {});
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android 뒤로가기 시 모달 닫기 시도를 무시
      onRequestClose={() => {}}
      // 배경 클릭으로 닫기 불가 — Modal 자체는 전체 화면이므로 별도 처리 불필요
    >
      <View style={s.backdrop}>
        <View style={s.card}>
          {/* 아이콘 */}
          <View style={s.iconWrap}>
            <Download size={28} color="#1A5CFF" />
          </View>

          {/* 제목 */}
          <Text style={s.title}>업데이트가 필요합니다</Text>

          {/* 안내 메시지 */}
          <Text style={s.body}>
            {message ||
              "현재 버전은 더 이상 지원되지 않습니다.\n최신 버전으로 업데이트한 후 이용해 주세요."}
          </Text>

          {/* 스토어 이동 버튼 */}
          <Pressable
            style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
            onPress={openStore}
          >
            <Text style={s.btnText}>
              {Platform.OS === "ios" ? "App Store에서 업데이트" : "Play Store에서 업데이트"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    width: "100%",
    backgroundColor: C.background,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "#1A5CFF18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  btn: {
    width: "100%",
    backgroundColor: "#1A5CFF",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnText: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: "#FFFFFF",
  },
});
