/**
 * OTAUpdateModal — OTA 업데이트 안내·다운로드 모달
 *
 * - required=true  → "닫기" 버튼 없음, 업데이트 필수
 * - required=false → "나중에" 버튼으로 모달 닫기 가능 (OPTIONAL)
 * - 다운로드 중 닫기 불가
 * - 에러 상태에서 "다시 시도" 제공
 */
import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  BackHandler,
} from "react-native";
import { useEffect } from "react";
import { RefreshCw, AlertCircle } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
  /** true: 닫기 불가(REQUIRED), false: 나중에 가능(OPTIONAL) */
  required: boolean;
  isDownloading: boolean;
  isError: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}

export default function OTAUpdateModal({
  visible,
  required,
  isDownloading,
  isError,
  onUpdate,
  onDismiss,
  onRetry,
}: Props) {
  const canDismiss = !required && !isDownloading;

  // Android 뒤로가기: 다운로드 중이거나 required면 차단
  useEffect(() => {
    if (!visible || Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canDismiss) { onDismiss(); return true; }
      return true; // 차단
    });
    return () => sub.remove();
  }, [visible, canDismiss]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => { if (canDismiss) onDismiss(); }}
    >
      {/* 배경 — optional이면 탭으로 닫기 가능 */}
      <Pressable
        style={s.backdrop}
        onPress={() => { if (canDismiss) onDismiss(); }}
      >
        {/* 카드 내부 클릭이 backdrop 닫기로 전파되지 않도록 */}
        <Pressable style={s.sheet} onPress={() => {}}>
          {/* 아이콘 */}
          <View style={[s.iconWrap, isError && s.iconWrapError]}>
            {isError ? (
              <AlertCircle size={26} color="#FF6F0F" />
            ) : (
              <RefreshCw size={26} color="#1A5CFF" />
            )}
          </View>

          {/* 제목 */}
          <Text style={s.title}>
            {isError
              ? "업데이트 실패"
              : required
              ? "필수 업데이트"
              : "업데이트 가능"}
          </Text>

          {/* 본문 */}
          <Text style={s.body}>
            {isError
              ? "업데이트 다운로드에 실패했습니다.\n인터넷 연결을 확인한 후 다시 시도해 주세요."
              : required
              ? "안정적인 서비스 이용을 위해\n필수 업데이트를 진행해 주세요."
              : "새로운 업데이트가 준비됐습니다.\n지금 업데이트하면 바로 적용됩니다."}
          </Text>

          {/* 다운로드 중 진행 표시 */}
          {isDownloading && (
            <View style={s.progressRow}>
              <ActivityIndicator size="small" color="#1A5CFF" />
              <Text style={s.progressText}>업데이트 다운로드 중…</Text>
            </View>
          )}

          {/* 버튼 영역 */}
          <View style={s.btnRow}>
            {/* 나중에 (optional only) */}
            {canDismiss && !isError && (
              <Pressable
                style={({ pressed }) => [s.btnSecondary, pressed && s.pressed]}
                onPress={onDismiss}
              >
                <Text style={s.btnSecondaryText}>나중에</Text>
              </Pressable>
            )}

            {/* 주요 액션 버튼 */}
            <Pressable
              style={({ pressed }) => [
                s.btnPrimary,
                (!canDismiss && !isError) && s.btnPrimaryFull,
                required && !isError && s.btnPrimaryFull,
                isDownloading && s.btnDisabled,
                pressed && !isDownloading && s.pressed,
              ]}
              onPress={isError ? onRetry : onUpdate}
              disabled={isDownloading}
            >
              <Text style={s.btnPrimaryText}>
                {isError ? "다시 시도" : isDownloading ? "다운로드 중…" : "지금 업데이트"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 40,
    alignItems: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#1A5CFF18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  iconWrapError: {
    backgroundColor: "#FF6F0F18",
  },
  title: {
    fontSize: 18,
    fontFamily: "Pretendard-SemiBold",
    color: C.text,
    marginBottom: 10,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  progressText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: "#1A5CFF",
  },
  btnRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  btnSecondary: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: C.border ?? "#EBEBEB",
  },
  btnSecondaryText: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: C.textSecondary,
  },
  btnPrimary: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#1A5CFF",
  },
  btnPrimaryFull: {
    flex: 1,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnPrimaryText: {
    fontSize: 15,
    fontFamily: "Pretendard-SemiBold",
    color: "#FFFFFF",
  },
  pressed: {
    opacity: 0.75,
  },
});
