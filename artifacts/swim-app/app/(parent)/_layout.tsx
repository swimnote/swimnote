/**
 * 학부모 레이아웃 — Stack 기반 (탭바 없음)
 * 미승인 학부모(pending / rejected)는 홈 진입 차단 → 대기 화면 표시
 * join_status는 로그인 응답(unified-login)에서 받아 SessionContext에 저장
 */
import { Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentProvider } from "@/context/ParentContext";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

// 간편가입 도입으로 승인 차단 제거 — 모든 학부모 홈 진입 허용
const BLOCKED_STATUSES: string[] = [];

function ApprovalPendingScreen({ status }: { status: string }) {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const isRejected = status === "rejected";

  return (
    <View style={[g.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={g.content}>
        <View style={[g.iconBox, { backgroundColor: isRejected ? "#F9DEDA" : "#FFF1BF" }]}>
          <Feather name={isRejected ? "x-circle" : "clock"} size={40} color={isRejected ? "#D96C6C" : "#E4A93A"} />
        </View>

        <Text style={g.title}>
          {isRejected ? "가입이 거절되었습니다" : "수영장 승인을 기다려주세요"}
        </Text>

        <Text style={g.message}>
          {isRejected
            ? "수영장 관리자가 가입 요청을 거절했습니다.\n다시 가입하거나 수영장에 직접 문의해 주세요."
            : "가입 요청이 접수되었습니다.\n수영장 관리자가 요청을 검토한 후 승인합니다.\n\n자녀 정보가 학생 명부와 일치하는 경우 "}
          {!isRejected && (
            <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>자동으로 즉시 승인</Text>
          )}
          {!isRejected && "됩니다."}
        </Text>

        {!isRejected && (
          <View style={[g.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <InfoRow icon="check-circle" color="#2E9B6F" text="자녀 정보 일치 시 즉시 자동 승인" />
            <InfoRow icon="user-check"  color="#2EC4B6" text="관리자 수동 승인 시 알림 발송" />
            <InfoRow icon="clock"       color="#E4A93A" text="일반적으로 1~2 영업일 이내 처리" />
          </View>
        )}

        <View style={[g.waitBanner, { backgroundColor: C.tintLight }]}>
          <Feather name="info" size={14} color={C.tint} />
          <Text style={[g.waitTxt, { color: C.tint }]}>
            {isRejected
              ? "문의: 수영장에 직접 연락해 주세요"
              : "승인 후 자동으로 홈 화면으로 이동합니다"}
          </Text>
        </View>

        <Pressable onPress={logout}>
          <Text style={g.logoutText}>다른 계정으로 로그인</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InfoRow({ icon, color, text }: { icon: any; color: string; text: string }) {
  return (
    <View style={g.infoRow}>
      <Feather name={icon} size={14} color={color} />
      <Text style={[g.infoText, { color: C.textSecondary }]}>{text}</Text>
    </View>
  );
}

const g = StyleSheet.create({
  root:     { flex: 1, backgroundColor: C.background },
  content:  { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 20 },
  iconBox:  { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title:    { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center", color: C.text },
  message:  { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 23, color: C.textSecondary },
  infoCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  infoRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  waitBanner:{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  waitTxt:  { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  logoutText:{ fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});

function ParentStack() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="notices" />
      <Stack.Screen name="diary" />
      <Stack.Screen name="photos" />
      <Stack.Screen name="attendance-history" />
      <Stack.Screen name="program" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="more" />
      <Stack.Screen name="children" />
      <Stack.Screen name="parent-profile" />
      <Stack.Screen name="child-profile" />
      <Stack.Screen name="level" />
      <Stack.Screen name="attendance" />
      <Stack.Screen name="student-detail" />
      <Stack.Screen name="notice-detail" />
      <Stack.Screen name="swim-diary" />
      <Stack.Screen name="swim-info" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="shopping" />
      <Stack.Screen name="push-settings" />
      <Stack.Screen name="link-child" />
    </Stack>
  );
}

export default function ParentLayout() {
  const { kind, isLoading, parentJoinStatus } = useAuth();

  if (isLoading || kind !== "parent") return null;

  if (parentJoinStatus && BLOCKED_STATUSES.includes(parentJoinStatus)) {
    return <ApprovalPendingScreen status={parentJoinStatus} />;
  }

  return (
    <ParentProvider>
      <ParentStack />
    </ParentProvider>
  );
}
