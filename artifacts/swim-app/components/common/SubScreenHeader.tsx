/**
 * SubScreenHeader — 하위 화면 공통 헤더
 * - 왼쪽: 뒤로가기 버튼 (항상 표시)
 * - 가운데: 화면 제목
 * - 오른쪽: 홈 버튼 + rightSlot (동시에 표시 가능)
 *
 * 홈 버튼: homePath prop 명시 시 우선. 없으면 현재 로그인 역할 자동 감지.
 * → 보안: 역할 불일치 홈 이동 방지 (슈퍼→수영장관리자 홈 접근 차단)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useContext } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { AuthContext } from "@/context/AuthContext";

const C = Colors.light;

const ROLE_HOME_MAP: Record<string, string> = {
  super_admin:    "/(super)/dashboard",
  platform_admin: "/(super)/dashboard",
  super_manager:  "/(super)/dashboard",
  pool_admin:     "/(admin)/dashboard",
  sub_admin:      "/(admin)/dashboard",
  teacher:        "/(teacher)/today-schedule",
  parent:         "/(parent)/home",
  parent_account: "/(parent)/home",
};

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
  homePath,
}: SubScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);
  const auth = useContext(AuthContext);

  // homePath prop이 있으면 그대로 사용, 없으면 현재 로그인 역할로 자동 결정
  const resolvedHome = (() => {
    if (homePath) return homePath;
    if (!auth) return "/(admin)/dashboard";
    const { adminUser, parentAccount, sessionKind } = auth;
    if (sessionKind === "parent" && parentAccount) return ROLE_HOME_MAP["parent_account"];
    if (adminUser?.role) return ROLE_HOME_MAP[adminUser.role] ?? "/(admin)/dashboard";
    return "/(admin)/dashboard";
  })();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  const handleHome = () => {
    router.navigate(resolvedHome as any);
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
