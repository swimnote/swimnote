/**
 * (auth)/pool-deactivated.tsx — 구독 취소 후 비활성화 안내 화면
 *
 * 로그인 시 pool_deactivated 에러 발생 → 이 화면으로 이동
 * - 남은 데이터 보존 기간 표시
 * - 재구독 안내
 * - 90일 경과 → 영구 삭제 경고
 */
import React from "react";
import {
  Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, RotateCcw, Clock, Trash2, ChevronLeft } from "lucide-react-native";
import Colors from "@/constants/colors";

const C = Colors.light;
const PURPLE = "#7C3AED";
const RED    = "#DC2626";
const ORANGE = "#D97706";

export default function PoolDeactivatedScreen() {
  const insets = useSafeAreaInsets();
  const {
    days_until_deletion,
    deletion_scheduled_at,
    pool_name,
    is_teacher,
  } = useLocalSearchParams<{
    days_until_deletion?: string;
    deletion_scheduled_at?: string;
    pool_name?: string;
    is_teacher?: string;
  }>();

  const daysLeft = Number(days_until_deletion ?? 0);
  const isTeacher = is_teacher === "true";

  const deletionDateStr = deletion_scheduled_at
    ? new Date(deletion_scheduled_at).toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric",
      })
    : null;

  const urgency = daysLeft <= 7 ? "critical" : daysLeft <= 30 ? "warning" : "normal";
  const urgencyColor = urgency === "critical" ? RED : urgency === "warning" ? ORANGE : PURPLE;

  function handleResubscribe() {
    Linking.openURL("https://apps.apple.com/app/id6744847621").catch(() => {});
  }

  function handleBack() {
    router.replace("/");
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={handleBack}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>서비스 이용 중단 안내</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 상태 아이콘 */}
        <View style={s.iconWrap}>
          <View style={[s.iconCircle, { backgroundColor: urgencyColor + "18" }]}>
            <AlertTriangle size={48} color={urgencyColor} />
          </View>
          <Text style={[s.title, { color: urgencyColor }]}>구독이 취소되었습니다</Text>
          {pool_name && (
            <Text style={s.poolName}>{pool_name}</Text>
          )}
        </View>

        {/* 남은 기간 카드 */}
        <View style={[s.daysCard, { borderColor: urgencyColor + "40", backgroundColor: urgencyColor + "08" }]}>
          <Clock size={20} color={urgencyColor} />
          <View style={{ flex: 1 }}>
            <Text style={[s.daysNumber, { color: urgencyColor }]}>
              {daysLeft > 0 ? `${daysLeft}일` : "오늘까지"}
            </Text>
            <Text style={[s.daysLabel, { color: urgencyColor }]}>
              {daysLeft > 0 ? "데이터 보존 남은 기간" : "오늘 자정 이후 데이터가 영구 삭제됩니다"}
            </Text>
            {deletionDateStr && (
              <Text style={[s.daysDate, { color: urgencyColor }]}>
                영구 삭제 예정일: {deletionDateStr}
              </Text>
            )}
          </View>
        </View>

        {/* 재구독 혜택 안내 */}
        {!isTeacher && daysLeft > 0 && (
          <View style={s.restoreCard}>
            <View style={s.restoreHeader}>
              <RotateCcw size={18} color={PURPLE} />
              <Text style={s.restoreTitle}>재구독 시 즉시 복구됩니다</Text>
            </View>
            <View style={s.restoreItems}>
              {[
                "등록 회원 전체 데이터",
                "수업일지 및 출석 기록",
                "사진 및 영상 자료",
                "선생님 계정 및 설정",
              ].map((item, i) => (
                <View key={i} style={s.restoreItem}>
                  <View style={s.restoreBullet} />
                  <Text style={s.restoreItemText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 영구 삭제 경고 */}
        <View style={s.warningCard}>
          <Trash2 size={18} color={RED} />
          <View style={{ flex: 1 }}>
            <Text style={s.warningTitle}>주의 사항</Text>
            <Text style={s.warningText}>
              {daysLeft > 0
                ? `${deletionDateStr ?? `${daysLeft}일 후`}이 지나면 모든 데이터가 영구 삭제됩니다. 삭제 후에는 복구가 불가능합니다.`
                : "모든 데이터가 영구적으로 삭제됩니다. 복구가 불가능합니다."
              }
            </Text>
          </View>
        </View>

        {/* 선생님 안내 */}
        {isTeacher && (
          <View style={s.teacherCard}>
            <Text style={s.teacherText}>
              소속 수영장의 구독이 취소되었습니다.{"\n"}
              재이용을 원하시면 수영장 관리자에게 문의해주세요.
            </Text>
          </View>
        )}

        {/* 버튼 */}
        {!isTeacher && daysLeft > 0 && (
          <Pressable style={s.resubBtn} onPress={handleResubscribe}>
            <RotateCcw size={18} color="#fff" />
            <Text style={s.resubBtnText}>재구독하여 데이터 복구</Text>
          </Pressable>
        )}

        <Pressable style={s.backTextBtn} onPress={handleBack}>
          <Text style={s.backTextBtnText}>돌아가기</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },
  header:         { flexDirection: "row", alignItems: "center",
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
                    backgroundColor: C.card },
  backBtn:        { padding: 4 },
  headerTitle:    { flex: 1, fontSize: 17, fontFamily: "Pretendard-Regular",
                    color: C.text, textAlign: "center" },

  content:        { padding: 20, gap: 16 },

  iconWrap:       { alignItems: "center", gap: 12, paddingVertical: 16 },
  iconCircle:     { width: 96, height: 96, borderRadius: 48,
                    justifyContent: "center", alignItems: "center" },
  title:          { fontSize: 20, fontFamily: "Pretendard-Regular", textAlign: "center" },
  poolName:       { fontSize: 14, fontFamily: "Pretendard-Regular",
                    color: "#64748B", textAlign: "center" },

  daysCard:       { flexDirection: "row", alignItems: "flex-start", gap: 12,
                    borderRadius: 14, borderWidth: 1.5, padding: 16 },
  daysNumber:     { fontSize: 28, fontFamily: "Pretendard-Regular" },
  daysLabel:      { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  daysDate:       { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 4 },

  restoreCard:    { backgroundColor: "#F5F3FF", borderRadius: 14, padding: 16,
                    borderWidth: 1, borderColor: "#DDD6FE", gap: 10 },
  restoreHeader:  { flexDirection: "row", alignItems: "center", gap: 8 },
  restoreTitle:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: PURPLE },
  restoreItems:   { gap: 8 },
  restoreItem:    { flexDirection: "row", alignItems: "center", gap: 10 },
  restoreBullet:  { width: 6, height: 6, borderRadius: 3, backgroundColor: PURPLE },
  restoreItemText:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#4B5563" },

  warningCard:    { flexDirection: "row", alignItems: "flex-start", gap: 10,
                    backgroundColor: "#FEF2F2", borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: "#FECACA" },
  warningTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: RED, marginBottom: 4 },
  warningText:    { fontSize: 12, fontFamily: "Pretendard-Regular",
                    color: "#B91C1C", lineHeight: 18 },

  teacherCard:    { backgroundColor: "#F8FAFC", borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: "#E2E8F0" },
  teacherText:    { fontSize: 13, fontFamily: "Pretendard-Regular",
                    color: "#64748B", lineHeight: 20, textAlign: "center" },

  resubBtn:       { backgroundColor: PURPLE, borderRadius: 14, paddingVertical: 16,
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  resubBtnText:   { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#fff" },

  backTextBtn:    { alignItems: "center", paddingVertical: 8 },
  backTextBtnText:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
});
