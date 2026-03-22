/**
 * pending.tsx — 학부모 가입 승인 대기 화면
 * 학부모가 수영장 가입 요청 후 관리자 승인을 기다리는 화면
 */
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

export default function PendingScreen() {
  const { logout, parentAccount } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: C.background,
          paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0),
          paddingBottom: insets.bottom + 34,
        },
      ]}
    >
      <View style={styles.content}>
        {/* 상태 아이콘 */}
        <View style={[styles.iconBox, { backgroundColor: "#FEF3C7" }]}>
          <Feather name="clock" size={40} color="#F59E0B" />
        </View>

        <Text style={[styles.title, { color: C.text }]}>수영장 승인을 기다려주세요</Text>

        <Text style={[styles.message, { color: C.textSecondary }]}>
          가입 요청이 접수되었습니다.{"\n"}
          수영장 관리자가 요청을 검토한 후 승인합니다.{"\n\n"}
          자녀 정보가 학생 명부와 일치하는 경우{"\n"}
          <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>자동으로 즉시 승인</Text>됩니다.
        </Text>

        {/* 안내 카드 */}
        <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <InfoRow icon="check-circle" color="#10B981" text="자녀 정보 일치 시 즉시 자동 승인" />
          <InfoRow icon="user-check"  color="#1A5CFF" text="관리자 수동 승인 시 SMS 알림 발송" />
          <InfoRow icon="clock"       color="#F59E0B" text="일반적으로 1~2 영업일 이내 처리" />
        </View>

        {/* 대기 안내 배너 */}
        <View style={[styles.waitBanner, { backgroundColor: C.tintLight }]}>
          <Feather name="info" size={14} color={C.tint} />
          <Text style={[styles.waitTxt, { color: C.tint }]}>
            승인 후 자동으로 홈 화면으로 이동합니다
          </Text>
        </View>

        {/* 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.refreshBtn,
            { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={() => {
            /* mock: 상태 재확인 */
          }}
        >
          <Feather name="refresh-cw" size={16} color={C.tint} />
          <Text style={[styles.refreshText, { color: C.tint }]}>승인 상태 확인</Text>
        </Pressable>

        <Pressable onPress={logout}>
          <Text style={[styles.logoutText, { color: C.textMuted }]}>다른 계정으로 로그인</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InfoRow({ icon, color, text }: { icon: any; color: string; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={14} color={color} />
      <Text style={[styles.infoText, { color: Colors.light.textSecondary }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  content:      { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 20 },
  iconBox:      { width: 96, height: 96, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  title:        { fontSize: 22, fontFamily: "Inter_700Bold", textAlign: "center" },
  message:      { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 23 },
  infoCard:     { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  infoRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  infoText:     { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  waitBanner:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  waitTxt:      { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  refreshBtn:   { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
  refreshText:  { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  logoutText:   { fontSize: 13, fontFamily: "Inter_400Regular" },
});
