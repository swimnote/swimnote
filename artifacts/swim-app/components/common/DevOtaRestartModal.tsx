/**
 * DevOtaRestartModal
 *
 * 2.0.0 개발 전용 — OTA 다운로드 완료 직후 즉시 표시.
 * - 강제 재시작 금지: 사용자가 [앱 재시작] 버튼을 눌렀을 때만 reloadAsync() 실행
 * - 연타 방지: reloading ref lock
 * - 다운로드 전 표시 금지: 호출부(RootNav)가 fetchUpdateAsync() 성공 후에만 visible=true 설정
 *
 * 출시 전 비활성화 방법:
 *   _layout.tsx 내 DEV_OTA_RESTART_MODAL 상수를 false로 변경하거나
 *   이 컴포넌트의 렌더를 제거.
 */

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Updates from "expo-updates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  visible: boolean;
}

export function DevOtaRestartModal({ visible }: Props) {
  const insets = useSafeAreaInsets();
  const reloadingRef = useRef(false);
  const [isReloading, setIsReloading] = useState(false);

  async function handleRestart() {
    // 연타 방지 + reload 중 중복 실행 방지
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    setIsReloading(true);
    try {
      await Updates.reloadAsync();
      // reloadAsync() 이후 코드는 실행되지 않음 (앱이 재시작됨)
    } catch (err) {
      console.error("[DevOtaRestartModal] reloadAsync 실패:", err);
      reloadingRef.current = false;
      setIsReloading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // 백 버튼으로 닫기 금지 — 사용자가 직접 재시작 또는 무시
      onRequestClose={() => {}}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 32,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 20,
            padding: 28,
            width: "100%",
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
            elevation: 10,
          }}
        >
          {/* 아이콘 */}
          <View style={{ alignItems: "center", marginBottom: 16 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                backgroundColor: "#EFF6FF",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ fontSize: 26 }}>🔄</Text>
            </View>
            <Text
              style={{
                fontSize: 17,
                fontFamily: "Pretendard-SemiBold",
                color: C.textPrimary,
              }}
            >
              새 업데이트가 준비되었습니다
            </Text>
          </View>

          {/* 설명 */}
          <Text
            style={{
              fontSize: 14,
              fontFamily: "Pretendard-Regular",
              color: C.textSecondary,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 24,
            }}
          >
            새로운 버전이 다운로드되었습니다.{"\n"}
            [앱 재시작]을 눌러 지금 바로 적용하세요.
          </Text>

          {/* 재시작 버튼 */}
          <Pressable
            onPress={handleRestart}
            disabled={isReloading}
            style={({ pressed }) => ({
              backgroundColor: isReloading
                ? "#93C5FD"
                : pressed
                ? "#1D4ED8"
                : C.brandStrong,
              borderRadius: 12,
              height: 50,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
            })}
          >
            {isReloading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : null}
            <Text
              style={{
                fontSize: 15,
                fontFamily: "Pretendard-SemiBold",
                color: "#fff",
              }}
            >
              {isReloading ? "재시작 중..." : "앱 재시작"}
            </Text>
          </Pressable>

          {/* 나중에 안내 */}
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Pretendard-Regular",
              color: C.textMuted,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            재시작하지 않으면 다음 실행 시 자동 적용됩니다.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
