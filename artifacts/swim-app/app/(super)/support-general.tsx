/**
 * (super)/support-general.tsx — 슈퍼관리자: 일반 문의 목록
 */
import { ChevronRight, MessageCircle, RefreshCw } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;
const P = "#7C3AED";

interface Ticket {
  id: string;
  ticket_type: string;
  subject: string;
  requester_name: string;
  requester_type: string;
  status: string;
  consultation_requested: boolean;
  created_at: string;
}

const REQUESTER_LABELS: Record<string, { label: string; color: string }> = {
  teacher:  { label: "선생님", color: "#2EC4B6" },
  parent:   { label: "학부모", color: "#7C3AED" },
  operator: { label: "관리자", color: "#1D4ED8" },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  open:        { label: "대기중", color: "#D97706" },
  in_progress: { label: "처리중", color: "#0284C7" },
  resolved:    { label: "완료",   color: "#16A34A" },
  closed:      { label: "종료",   color: "#64748B" },
};

const FILTERS = [
  { key: "all",        label: "전체" },
  { key: "open",       label: "대기중" },
  { key: "in_progress",label: "처리중" },
  { key: "resolved",   label: "완료" },
];

function relDate(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export default function SupportGeneralScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [tickets,    setTickets]    = useState<Ticket[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState("all");

  const load = useCallback(async () => {
    try {
      const qs = filter !== "all" ? `?status=${filter}` : "";
      const res = await apiRequest(token, `/super/support-general${qs}`);
      if (res.ok) { const d = await res.json(); setTickets(d); }
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token, filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  function renderItem({ item }: { item: Ticket }) {
    const reqCfg    = REQUESTER_LABELS[item.requester_type] ?? { label: item.requester_type, color: "#64748B" };
    const statusCfg = STATUS_LABELS[item.status]             ?? { label: item.status, color: "#64748B" };

    return (
      <Pressable
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => router.push({ pathname: "/support-ticket-detail", params: { id: item.id } } as any)}
      >
        <View style={s.cardTop}>
          <View style={[s.reqBadge, { backgroundColor: reqCfg.color + "18" }]}>
            <Text style={[s.reqTxt, { color: reqCfg.color }]}>{reqCfg.label}</Text>
          </View>
          <Text style={[s.statusTxt, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          {item.consultation_requested && <Text style={s.consultTag}>📞 상담예약</Text>}
          <Text style={s.dateStr}>{relDate(item.created_at)}</Text>
        </View>
        <Text style={s.subject} numberOfLines={2}>{item.subject}</Text>
        <Text style={s.requesterName} numberOfLines={1}>{item.requester_name || "이름 없음"}</Text>
        <ChevronRight size={14} color="#CBD5E1" style={{ position: "absolute", right: 14, top: 14 }} />
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="일반 문의" homePath="/(super)/support-group" />

      {/* 필터 탭 */}
      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f.key}
            style={[s.filterTab, filter === f.key && s.filterTabActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.filterTxt, filter === f.key && s.filterTxtActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={P} /></View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={t => t.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <MessageCircle size={36} color="#E2E8F0" />
              <Text style={s.emptyTxt}>접수된 일반 문의가 없습니다</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: C.background },
  center:       { flex: 1, alignItems: "center", justifyContent: "center" },

  filterRow:    { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 10, gap: 8,
                  backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  filterTab:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: "#F1F5F9" },
  filterTabActive: { backgroundColor: P + "18" },
  filterTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  filterTxtActive: { color: P },

  card:         { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, gap: 4 },
  cardTop:      { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  reqBadge:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  reqTxt:       { fontSize: 10, fontFamily: "Pretendard-Regular" },
  statusTxt:    { fontSize: 11, fontFamily: "Pretendard-Regular" },
  consultTag:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: P },
  dateStr:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textMuted, marginLeft: "auto" },
  subject:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20, paddingRight: 20 },
  requesterName:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },

  empty:        { alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 80 },
  emptyTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
