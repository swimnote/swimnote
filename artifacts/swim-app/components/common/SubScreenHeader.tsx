/**
 * SubScreenHeader — 하위 화면 공통 헤더
 * - 왼쪽: 뒤로가기 버튼 (항상 표시)
 * - 가운데: 화면 제목
 * - 오른쪽: 홈 버튼 + rightSlot (동시에 표시 가능)
 *
 * 뒤로가기: navigation.goBack() — 바로 직전 화면으로
 * 홈 버튼: router.navigate("/(admin)/dashboard") — 관리자 홈으로 즉시 이동
 */
import { Feather } from "@expo/vector-icons";
import { router, useNavigation } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

interface SubScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  showHome?: boolean;
  rightSlot?: React.ReactNode;
  homePath?: string;
}

export function SubScreenHeader({
  title,
  subtitle,
  onBack,
  showHome = true,
  rightSlot,
  homePath = "/(admin)/dashboard",
}: SubScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        router.navigate(homePath as any);
      }
    }
  };

  const handleHome = () => {
    router.navigate(homePath as any);
  };

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <Pressable onPress={handleBack} style={s.btn} hitSlop={10}>
        <Feather name="arrow-left" size={22} color={C.text} />
      </Pressable>

      <View style={s.titleBlock}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>

      <View style={s.right}>
        {rightSlot ?? null}
        {showHome ? (
          <Pressable onPress={handleHome} style={s.btn} hitSlop={10}>
            <Feather name="home" size={20} color={C.textSecondary} />
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
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#F6F3F1",
  },
  placeholder: {
    width: 38,
    height: 38,
  },
  titleBlock: {
    flex: 1,
    alignItems: "center",
  },
  title: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    marginTop: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 38,
    justifyContent: "flex-end",
  },
});
