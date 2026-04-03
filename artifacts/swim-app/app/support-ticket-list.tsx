/**
 * support-ticket-list.tsx — 내 문의 목록
 */
import { ChevronLeft, ChevronRight, MessageCircle, Plus } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const P = "#7C3AED";

interface Ticket {
  id: string;
  ticket_type: string;
  subject: string;
  status: string;
  consultation_requested: boolean;
  created_at: string;
  updated_at: string;
}

const TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  general:   { label: "일반",  color: "#0284C7", bg: "#E0F2FE" },
  emergency: { label: "긴급",  color: "#DC2626", bg: "#FEF2F2" },
  security:  { label: "보안",  color: "#7C3AED", bg: "#EEDDF5" },
  refund:    { label: "환불",  color: "#D97706", bg: "#FFF7ED" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:        { label: "대기중",  color: "#D97706" },
  in_progress: { label: "처리중",  color: "#0284C7" },
  resolved:    { label: "해결됨",  color: "#16A34A" },
  closed:      { label: "종료",    color: "#64748B" },
};

function relDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const HOME_MAP: Record<string, string> = {
  pool_admin:     "/(admin)/dashboard",
  sub_admin:      "/(admin)/dashboard",
  teacher:        "/(teacher)/today-schedule",
  parent:         "/(parent)/home",
  parent_account: "/(parent)/home",
};

export default function SupportTicketListScreen() {
  const { token, kind, adminUser } = useAuth();
  const insets = useSafeAreaInsets();

  function goHome() {
    if (kind === "admin" && adminUser?.role) {
      router.replace((HOME_MAP[adminUser.role] ?? "/(admin)/dashboard") as any);
    } else if (kind === "parent") {
      router.replace("/(parent)/home" as any);
    } else {
      router.replace("/(super)/dashboard" as any);
    }
  }

  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/support/my-tickets");
      if (res.ok) { const d = await res.json(); setTickets(d); }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const isAdmin = kind === "admin" &&
    (adminUser?.role === "pool_admin" || adminUser?.role === "sub_admin");

  function goWrite() {
    if (isAdmin) {
      router.push({ pathname: "/support-ticket-write", params: { showTypeSelect: "true" } } as any);
    } else {
      router.push({ pathname: "/support-ticket-write", params: { type: "general" } } as any);
    }
  }

  function renderItem({ item }: { item: Ticket }) {
    const typeCfg = TYPE_LABELS[item.ticket_type] ?? { label: item.ticket_type, color: "#64748B", bg: "#F8FAFC" };
    const statusCfg = STATUS_LABELS[item.status] ?? { label: item.status, color: "#64748B" };

    return (
      <Pressable
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => router.push({ pathname: "/support-ticket-detail", params: { id: item.id } } as any)}
      >
        <View style={s.cardTop}>
          <View style={[s.typeBadge, { backgroundColor: typeCfg.bg }]}>
            <Text style={[s.typeTxt, { color: typeCfg.color }]}>{typeCfg.label}</Text>
          </View>
          <Text style={[s.statusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
        </View>
        <Text style={s.subject} numberOfLines={2}>{item.subject}</Text>
        <View style={s.cardBottom}>
          <Text style={s.dateStr}>{relDate(item.created_at)}</Text>
          {item.consultation_requested && (
            <Text style={s.consultBadge}>📞 상담예약</Text>
          )}
        </View>
        <ChevronRight size={14} color={C.textMuted} style={{ position: "absolute", right: 14, top: "50%" }} />
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <Pressable onPress={goHome} style={s.backBtn}>
          <ChevronLeft size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>내 문의 내역</Text>
        <Pressable style={s.addBtn} onPress={goWrite}>
          <Plus size={20} color={P} />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={P} />
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={t => t.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <MessageCircle size={40} color="#E2E8F0" />
              <Text style={s.emptyTxt}>아직 문의 내역이 없습니다</Text>
              <Pressable style={s.emptyBtn} onPress={goWrite}>
                <Text style={s.emptyBtnTxt}>문의하기</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.background },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12,
                 backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  addBtn:      { width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  cardTop:     { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  typeBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular" },
  statusTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
  subject:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  cardBottom:  { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  dateStr:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  consultBadge:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: "#7C3AED" },

  empty:       { alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  emptyTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyBtn:    { backgroundColor: P, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});
