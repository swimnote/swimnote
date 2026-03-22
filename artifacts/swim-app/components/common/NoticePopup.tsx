/**
 * components/common/NoticePopup.tsx — 공지 팝업
 * 앱 실행 후 최신 공지를 강제 확인 팝업으로 표시.
 * - "확인": 팝업 닫기 (다음 실행 시 또 보임)
 * - "다시 보지 않기": dismissForever → 이 공지ID는 다시 표시 안 함
 * - 팝업이 열린 상태에서는 배경 터치로 닫기 불가 (강제 확인 구조)
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNoticeStore, type NoticeTarget } from "@/store/noticeStore";
import { useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

const TARGET_CFG: Record<NoticeTarget, { label: string; color: string; bg: string }> = {
  all:     { label: "전체 공지",   color: "#4F46E5", bg: "#EEF2FF" },
  admin:   { label: "관리자 공지", color: P,         bg: "#EDE9FE" },
  teacher: { label: "선생님 공지", color: "#059669", bg: "#D1FAE5" },
  parent:  { label: "학부모 공지", color: "#0891B2", bg: "#E0F2FE" },
};

export function NoticePopup() {
  const { kind, adminUser, parentAccount } = useAuth();
  const getLatestForRole  = useNoticeStore(s => s.getLatestForRole);
  const dismissForever    = useNoticeStore(s => s.dismissForever);
  const [visible, setVisible] = useState(false);
  const [noticeId, setNoticeId] = useState<string | null>(null);

  // 현재 역할 계산
  function getRole(): string {
    if (kind === "parent") return "parent";
    if (kind === "admin" && adminUser) {
      const role = adminUser.roles?.[0] ?? adminUser.role;
      return role ?? "pool_admin";
    }
    return "";
  }

  useEffect(() => {
    const role = getRole();
    if (!role) return;
    const notice = getLatestForRole(role);
    if (notice) {
      setNoticeId(notice.id);
      setVisible(true);
    }
  }, [kind, adminUser?.role, parentAccount]);

  const notice = noticeId ? useNoticeStore.getState().notices.find(n => n.id === noticeId) : null;

  if (!notice) return null;

  const cfg = TARGET_CFG[notice.target];

  function handleConfirm() {
    setVisible(false);
  }

  function handleDismiss() {
    if (noticeId) dismissForever(noticeId);
    setVisible(false);
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* 배경 터치 불가: no onPress */}
      <View style={s.overlay}>
        <View style={s.card}>
          {/* 대상 배지 */}
          <View style={[s.targetBadge, { backgroundColor: cfg.bg }]}>
            <Feather name="bell" size={12} color={cfg.color} />
            <Text style={[s.targetTxt, { color: cfg.color }]}>{cfg.label}</Text>
          </View>

          {/* 제목 */}
          <Text style={s.title}>{notice.title}</Text>

          {/* 내용 */}
          <ScrollView style={s.contentScroll} showsVerticalScrollIndicator={false}>
            <Text style={s.content}>{notice.content}</Text>
          </ScrollView>

          {/* 날짜 */}
          <Text style={s.date}>
            {new Date(notice.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}
          </Text>

          {/* 강제 확인 안내 */}
          {notice.forcedAck && (
            <View style={s.forceBanner}>
              <Feather name="alert-circle" size={11} color="#DC2626" />
              <Text style={s.forceTxt}>이 공지는 반드시 확인 후 진행해야 합니다.</Text>
            </View>
          )}

          {/* 버튼 */}
          <View style={s.btnRow}>
            <Pressable style={s.dismissBtn} onPress={handleDismiss}>
              <Text style={s.dismissTxt}>다시 보지 않기</Text>
            </Pressable>
            <Pressable style={s.confirmBtn} onPress={handleConfirm}>
              <Text style={s.confirmTxt}>확인</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
                   padding: 24 },
  card:          { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 400,
                   maxHeight: "80%" },
  targetBadge:   { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
                   paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 12 },
  targetTxt:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  title:         { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 12 },
  contentScroll: { maxHeight: 200, marginBottom: 12 },
  content:       { fontSize: 14, fontFamily: "Inter_400Regular", color: "#374151", lineHeight: 22 },
  date:          { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginBottom: 10 },
  forceBanner:   { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2",
                   borderRadius: 8, padding: 8, marginBottom: 14 },
  forceTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#DC2626", flex: 1 },
  btnRow:        { flexDirection: "row", gap: 8 },
  dismissBtn:    { flex: 1, padding: 13, borderRadius: 12, backgroundColor: "#F3F4F6", alignItems: "center" },
  dismissTxt:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#6B7280" },
  confirmBtn:    { flex: 1, padding: 13, borderRadius: 12, backgroundColor: P, alignItems: "center" },
  confirmTxt:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
