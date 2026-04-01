/**
 * SubScreenHeader — 하위 화면 공통 헤더
 * - 왼쪽: 뒤로가기 버튼 (항상 표시)
 * - 가운데: 화면 제목
 * - 오른쪽: 홈 버튼 + rightSlot (동시에 표시 가능)
 *
 * 홈 버튼: homePath prop 명시 시 우선. 없으면 현재 로그인 역할 자동 감지.
 * → 보안: 역할 불일치 홈 이동 방지 (슈퍼→수영장관리자 홈 접근 차단)
 *
 * ⚠️ useAuth() 사용 (AuthContext 직접 참조 금지 — Provider 미주입으로 null 반환됨)
 */
import { ArrowLeft, Home } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

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

  // ✅ useAuth() 사용 — AuthContext 직접 참조 금지 (값 미주입으로 항상 null)
  const { kind, adminUser, parentAccount } = useAuth();
  const params = useLocalSearchParams<{ backTo?: string }>();

  // homePath prop이 있으면 그대로 사용, 없으면 현재 로그인 역할로 자동 결정
  const resolvedHome: string = (() => {
    if (homePath) return homePath;

    // 학부모 세션
    if (kind === "parent" && parentAccount) return ROLE_HOME_MAP["parent_account"];

    // 관리자 세션 — 실제 role 기반으로 결정 (저장된 activeRole 무시)
    if (kind === "admin" && adminUser?.role) {
      return ROLE_HOME_MAP[adminUser.role] ?? "/(super)/dashboard";
    }

    // 슈퍼 계열의 경우 절대 admin 홈으로 보내지 않도록 방어
    return "/";
  })();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    // backTo 파라미터가 있으면 해당 화면으로 명시적 이동 (Tabs 내비게이터 back 오동작 방지)
    if (params.backTo) {
      const isTeacher = kind === "admin" && adminUser?.role === "teacher";
      if (isTeacher) {
        router.navigate(("/(teacher)/" + params.backTo) as any);
      } else if (kind === "admin") {
        router.navigate(("/(admin)/" + params.backTo) as any);
      } else if (kind === "parent") {
        router.navigate(("/(parent)/" + params.backTo) as any);
      } else {
        router.navigate(("/(super)/" + params.backTo) as any);
      }
      return;
    }
    router.back();
  };

  const handleHome = () => {
    // router.replace 사용 — navigate/push 는 스택에 admin 화면이 쌓일 수 있음
    router.replace(resolvedHome as any);
  };

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <Pressable onPress={handleBack} style={s.btn} hitSlop={10}>
        <ArrowLeft size={22} color={C.text} />
      </Pressable>

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
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
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
    fontFamily: "Pretendard-Regular",
    color: C.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Pretendard-Regular",
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
