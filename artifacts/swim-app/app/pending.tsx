/**
 * pending.tsx — 승인 대기 화면 (pool_admin: 수영장 등록 대기 / parent: 가입 승인 대기)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useParentJoinStore } from "@/store/parentJoinStore";

const APPROVED_STATUSES = new Set(["auto_approved", "approved"]);

export default function PendingScreen() {
  const { logout, kind, pool, refreshPool } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const currentParentRequestId = useParentJoinStore(s => s.currentParentRequestId);
  const requests               = useParentJoinStore(s => s.requests);

  const currentReq = currentParentRequestId
    ? requests.find(r => r.id === currentParentRequestId)
    : null;

  const isParent = kind === "parent";
  const isRejected = isParent
    ? currentReq?.status === "rejected"
    : pool?.approval_status === "rejected";

  const [checking, setChecking] = useState(false);

  async function handleCheckStatus() {
    if (isParent) {
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
    } else {
      // pool_admin: refresh pool data and check approval_status
      setChecking(true);
      try {
        await refreshPool();
        // After refresh, _layout.tsx will redirect automatically if approved.
        // But we also check here for immediate feedback.
        if (pool?.approval_status === "approved") {
          router.replace("/(admin)/dashboard" as any);
        } else if (pool?.approval_status === "rejected") {
          Alert.alert("신청 반려", pool?.rejection_reason
            ? `반려 사유: ${pool.rejection_reason}`
            : "운영자 검토 결과 신청이 반려되었습니다. 내용을 수정하여 다시 신청해 주세요.");
        } else {
          Alert.alert("대기 중", "아직 검토 중입니다. 조금만 더 기다려 주세요.\n보통 1~2 영업일 이내에 처리됩니다.");
        }
      } catch {
        Alert.alert("오류", "상태를 확인하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        setChecking(false);
      }
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
        <View style={[styles.iconBox, { backgroundColor: isRejected ? "#F9DEDA" : "#FFF1BF" }]}>
          <Feather name={isRejected ? "x-circle" : "clock"} size={40} color={isRejected ? "#D96C6C" : "#E4A93A"} />
        </View>

        {isParent ? (
          <>
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
            {!isRejected && (
              <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
                <InfoRow icon="check-circle" color="#2E9B6F" text="자녀 정보 일치 시 즉시 자동 승인" />
                <InfoRow icon="user-check"  color="#1F8F86" text="관리자 수동 승인 시 SMS 알림 발송" />
                <InfoRow icon="clock"       color="#E4A93A" text="일반적으로 1~2 영업일 이내 처리" />
              </View>
            )}
            {isRejected && currentReq?.rejectReason && (
              <View style={[styles.infoCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                <InfoRow icon="alert-circle" color="#D96C6C" text={`거절 사유: ${currentReq.rejectReason}`} />
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: C.text }]}>
              {isRejected ? "신청이 반려되었습니다" : "수영장 등록 신청 중"}
            </Text>
            <Text style={[styles.message, { color: C.textSecondary }]}>
              {isRejected
                ? `운영자 검토 결과 신청이 반려되었습니다.\n내용을 수정하여 다시 신청해 주세요.`
                : `수영장 등록 신청이 접수되었습니다.\n플랫폼 운영자가 신청 내용을 검토한 후\n승인합니다.`
              }
            </Text>
            {!isRejected && (
              <View style={[styles.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
                <InfoRow icon="check-circle" color="#2E9B6F" text="신청 내용 검토 완료 시 즉시 이용 가능" />
                <InfoRow icon="mail"         color="#1F8F86" text="승인 후 이메일/앱 알림 발송" />
                <InfoRow icon="clock"        color="#E4A93A" text="일반적으로 1~2 영업일 이내 처리" />
              </View>
            )}
            {isRejected && pool?.rejection_reason && (
              <View style={[styles.infoCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                <InfoRow icon="alert-circle" color="#D96C6C" text={`반려 사유: ${pool.rejection_reason}`} />
              </View>
            )}
          </>
        )}

        <View style={[styles.waitBanner, { backgroundColor: isRejected ? "#FEF2F2" : C.tintLight }]}>
          <Feather name="info" size={14} color={isRejected ? "#D96C6C" : C.tint} />
          <Text style={[styles.waitTxt, { color: isRejected ? "#D96C6C" : C.tint }]}>
            {isRejected
              ? (isParent ? "문의: 수영장에 직접 연락해 주세요" : "문의: 플랫폼 운영팀에 연락해 주세요")
              : "승인 후 자동으로 홈 화면으로 이동합니다"}
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.refreshBtn,
            { backgroundColor: C.tintLight, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={handleCheckStatus}
          disabled={checking}
        >
          {checking
            ? <ActivityIndicator size="small" color={C.tint} />
            : <Feather name="refresh-cw" size={16} color={C.tint} />
          }
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
