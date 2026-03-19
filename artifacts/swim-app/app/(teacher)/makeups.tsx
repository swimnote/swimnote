/**
 * (teacher)/makeups.tsx — 보강 관리
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";

const C = Colors.light;

interface MakeupRequest {
  id: string;
  student_name: string;
  class_name: string;
  original_date: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "completed";
  requested_at: string;
  makeup_date: string | null;
  makeup_class_name: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  approved: "승인",
  rejected: "거절",
  completed: "완료",
};
const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  pending:   { bg: "#FEF3C7", text: "#D97706" },
  approved:  { bg: "#D1FAE5", text: "#059669" },
  rejected:  { bg: "#FEE2E2", text: "#DC2626" },
  completed: { bg: "#EDE9FE", text: "#7C3AED" },
};

function fmtDate(s: string) {
  const d = new Date(s + "T00:00:00");
  const days = ["일","월","화","수","목","금","토"];
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

export default function MakeupsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [list, setList]         = useState<MakeupRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState<"pending" | "all">("pending");
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/teacher/makeup-requests");
      if (res.ok) setList(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const displayed = filter === "pending"
    ? list.filter(r => r.status === "pending")
    : list;

  async function handleApprove(id: string) {
    try {
      const res = await apiRequest(token, `/teacher/makeup-requests/${id}/approve`, { method: "POST" });
      if (res.ok) {
        setList(prev => prev.map(r => r.id === id ? { ...r, status: "approved" } : r));
      } else {
        const d = await res.json().catch(() => ({}));
        setConfirmMsg(d.error || "처리에 실패했습니다.");
      }
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
  }

  async function handleReject(id: string) {
    try {
      const res = await apiRequest(token, `/teacher/makeup-requests/${id}/reject`, { method: "POST" });
      if (res.ok) {
        setList(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" } : r));
      } else {
        const d = await res.json().catch(() => ({}));
        setConfirmMsg(d.error || "처리에 실패했습니다.");
      }
    } catch { setConfirmMsg("네트워크 오류가 발생했습니다."); }
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="보강 관리" homePath="/(teacher)/today-schedule" />

      {/* 필터 탭 */}
      <View style={s.filterRow}>
        {(["pending", "all"] as const).map(f => (
          <Pressable
            key={f}
            style={[s.filterBtn, filter === f && { backgroundColor: themeColor }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.filterTxt, filter === f && { color: "#fff" }]}>
              {f === "pending" ? "대기 중" : "전체"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />
          }
        >
          {displayed.length === 0 ? (
            <View style={s.empty}>
              <Feather name="refresh-cw" size={36} color={C.textMuted} />
              <Text style={s.emptyTxt}>
                {filter === "pending" ? "대기 중인 보강 요청이 없습니다" : "보강 요청 내역이 없습니다"}
              </Text>
            </View>
          ) : displayed.map(item => {
            const sc = STATUS_COLOR[item.status] ?? STATUS_COLOR.pending;
            const isPending = item.status === "pending";
            return (
              <View key={item.id} style={[s.card, { backgroundColor: C.card }]}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.studentName}>{item.student_name}</Text>
                    <Text style={s.className}>{item.class_name}</Text>
                  </View>
                  <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                    <Text style={[s.statusTxt, { color: sc.text }]}>{STATUS_LABEL[item.status]}</Text>
                  </View>
                </View>

                <View style={s.infoRow}>
                  <Feather name="calendar" size={13} color={C.textSecondary} />
                  <Text style={s.infoTxt}>결석일: {fmtDate(item.original_date)}</Text>
                </View>
                {item.reason ? (
                  <View style={s.infoRow}>
                    <Feather name="message-square" size={13} color={C.textSecondary} />
                    <Text style={s.infoTxt} numberOfLines={2}>{item.reason}</Text>
                  </View>
                ) : null}
                {item.makeup_date ? (
                  <View style={s.infoRow}>
                    <Feather name="check-circle" size={13} color="#059669" />
                    <Text style={[s.infoTxt, { color: "#059669" }]}>
                      보강일: {fmtDate(item.makeup_date)}
                      {item.makeup_class_name ? ` · ${item.makeup_class_name}` : ""}
                    </Text>
                  </View>
                ) : null}

                {isPending && (
                  <View style={s.btnRow}>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]}
                      onPress={() => handleApprove(item.id)}
                    >
                      <Feather name="check" size={14} color="#059669" />
                      <Text style={[s.actionTxt, { color: "#059669" }]}>승인</Text>
                    </Pressable>
                    <Pressable
                      style={[s.actionBtn, { backgroundColor: "#FEE2E2" }]}
                      onPress={() => handleReject(item.id)}
                    >
                      <Feather name="x" size={14} color="#DC2626" />
                      <Text style={[s.actionTxt, { color: "#DC2626" }]}>거절</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <ConfirmModal
        visible={!!confirmMsg}
        title="알림"
        message={confirmMsg ?? ""}
        confirmText="확인"
        onConfirm={() => setConfirmMsg(null)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F3F4F6" },
  filterRow:   { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  filterBtn:   { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F3F4F6" },
  filterTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  list:        { padding: 14, gap: 10, paddingBottom: 60 },
  empty:       { alignItems: "center", gap: 12, paddingVertical: 60 },
  emptyTxt:    { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  card:        { borderRadius: 16, padding: 14, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  cardTop:     { flexDirection: "row", alignItems: "flex-start" },
  studentName: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  className:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  infoRow:     { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  infoTxt:     { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, flex: 1 },
  btnRow:      { flexDirection: "row", gap: 8, marginTop: 4 },
  actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 10 },
  actionTxt:   { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
