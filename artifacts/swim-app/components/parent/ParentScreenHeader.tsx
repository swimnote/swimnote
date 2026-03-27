/**
 * ParentScreenHeader — 학부모 전용 공통 헤더
 *
 * - 뒤로가기: router.back() — 글로벌 라우터 히스토리 기준 직전 화면 복귀
 * - 홈 버튼: router.replace("/(parent)/home") — 사용자가 명시적으로 눌렀을 때만
 * - 관리자/선생님 라우트와 절대 연결되지 않음
 */
import { ArrowLeft, Home } from "lucide-react-native";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  title: string;
  subtitle?: string;
  showHome?: boolean;
  showBack?: boolean;
  rightSlot?: React.ReactNode;
  onBack?: () => void;
}

export function ParentScreenHeader({
  title,
  subtitle,
  showHome = true,
  showBack = true,
  rightSlot,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);

  const handleBack = () => {
    if (onBack) { onBack(); return; }
    router.back();
  };

  const handleHome = () => {
    router.replace("/(parent)/home" as any);
  };

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {showBack ? (
        <Pressable onPress={handleBack} style={s.btn} hitSlop={10}>
          <ArrowLeft size={22} color={C.text} />
        </Pressable>
      ) : (
        <View style={s.placeholder} />
      )}

      <View style={s.titleBlock}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={s.right}>
        {rightSlot ?? null}
        {showHome ? (
          <Pressable onPress={handleHome} style={s.btn} hitSlop={10}>
            <Home size={20} color={C.textSecondary} />
          </Pressable>
        ) : (
          !rightSlot ? <View style={s.placeholder} /> : null
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: C.background,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  btn: {
    width: 38, height: 38,
    alignItems: "center", justifyContent: "center",
    borderRadius: 10, backgroundColor: "#FFFFFF",
  },
  placeholder: { width: 38, height: 38 },
  titleBlock: { flex: 1, alignItems: "center" },
  title: {
    fontSize: 17, fontFamily: "Pretendard-SemiBold",
    color: C.text, textAlign: "center",
  },
  subtitle: {
    fontSize: 12, fontFamily: "Pretendard-Regular",
    color: C.textSecondary, textAlign: "center", marginTop: 1,
  },
  right: {
    flexDirection: "row", alignItems: "center",
    gap: 6, minWidth: 38, justifyContent: "flex-end",
  },
});
