/**
 * pending.tsx — 학부모 가입 승인 대기 화면
 * 학부모가 수영장 가입 요청 후 관리자 승인을 기다리는 화면
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useParentJoinStore } from "@/store/parentJoinStore";

const APPROVED_STATUSES = new Set(["auto_approved", "approved"]);

export default function PendingScreen() {
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const currentParentRequestId = useParentJoinStore(s => s.currentParentRequestId);
  const requests               = useParentJoinStore(s => s.requests);

  const currentReq = currentParentRequestId
    ? requests.find(r => r.id === currentParentRequestId)
    : null;

  const isRejected = currentReq?.status === "rejected";

  function handleCheckStatus() {
    if (!currentReq) {
      Alert.alert("확인 불가", "요청 정보를 찾을 수 없습니다.");
      return;
    }
    if (APPROVED_STATUSES.has(currentReq.status)) {
      router.replace("/(parent)/home" as any);
    } else if (currentReq.status === "rejected") {
      Alert.alert("가입 거절", currentReq.rejectReason
        ? `거절 사유: ${currentReq.rejectReason}`
        : "수영장 관리자가 가입 요청을 거절했습니다. 수영장에 직접 문의해 주세요.");
    } else if (currentReq.status === "on_hold") {
      Alert.alert("검토 보류", "관리자가 추가 확인 중입니다. 잠시 후 다시 확인해 주세요.");
    } else {
      Alert.alert("대기 중", "아직 승인 대기 중입니다. 조금만 더 기다려 주세요.");
    }
  }

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
        <View style={[styles.iconBox, { backgroundColor: isRejected ? "#FEE2E2" : "#FEF3C7" }]}>
          <Feather name={isRejected ? "x-circle" : "clock"} size={40} color={isRejected ? "#DC2626" : "#F59E0B"} />
        </View>

        <Text style={[styles.title, { color: C.text }]}>
          {isRejected ? "가입이 거절되었습니다" : "수영장 승인을 기다려주세요"}
        </Text>

        <Text style={[styles.message, { color: C.textSecondary }]}>
          {isRejected
            ? `수영장 관리자가 가입 요청을 거절했습니다.\n다시 가입하거나 수영장에 직접 문의해 주세요.`
            : `가입 요청이 접수되었습니다.\n수영장 관리자가 요청을 검토한 후 승인합니다.\n\n자녀 정보가 학생 명부와 일치하는 경우\n`
          }
          {!isRejected && (
            <Text style={{ fontFamily: "Inter_600SemiBold", color: C.text }}>자동으로 즉시 승인</Text>
          )}
          {!isRejected && "됩니다."}
        </Text>

        {/* 안내 카드 */}
        {!isRejected && (
          <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <InfoRow icon="check-circle" color="#10B981" text="자녀 정보 일치 시 즉시 자동 승인" />
            <InfoRow icon="user-check"  color="#1A5CFF" text="관리자 수동 승인 시 SMS 알림 발송" />
            <InfoRow icon="clock"       color="#F59E0B" text="일반적으로 1~2 영업일 이내 처리" />
          </View>
        )}

        {/* 거절 사유 */}
        {isRejected && currentReq?.rejectReason && (
          <View style={[styles.infoCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
            <InfoRow icon="alert-circle" color="#DC2626" text={`거절 사유: ${currentReq.rejectReason}`} />
          </View>
        )}

        {/* 대기 안내 배너 */}
        <View style={[styles.waitBanner, { backgroundColor: isRejected ? "#FEF2F2" : C.tintLight }]}>
          <Feather name="info" size={14} color={isRejected ? "#DC2626" : C.tint} />
          <Text style={[styles.waitTxt, { color: isRejected ? "#DC2626" : C.tint }]}>
            {isRejected
              ? "문의: 수영장에 직접 연락해 주세요"
              : "승인 후 자동으로 홈 화면으로 이동합니다"}
          </Text>
        </View>

        {/* 승인 상태 확인 버튼 */}
        <Pressable
          style={({ pressed }) => [
            styles.refreshBtn,
            { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={handleCheckStatus}
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
