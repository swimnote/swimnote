/**
 * (super)/subscriptions.tsx — 구독 관리 (압축 리스트형)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface Pool {
  id: string; name: string; owner_name: string;
  subscription_status: string; subscription_start_at?: string | null;
  subscription_end_at?: string | null; credit_balance?: number | null;
  active_member_count?: number | null; subscription_tier?: any;
  usage_pct?: number; deletion_pending?: boolean;
}

const SUB_CFG: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: "체험 중",  color: P,         bg: "#EDE9FE" },
  active:    { label: "구독 중",  color: "#059669", bg: "#D1FAE5" },
  expired:   { label: "만료됨",   color: "#6B7280", bg: "#F3F4F6" },
  suspended: { label: "정지됨",   color: "#D97706", bg: "#FEF3C7" },
  cancelled: { label: "해지됨",   color: "#DC2626", bg: "#FEE2E2" },
};

const SUB_OPTIONS = ["trial", "active", "expired", "suspended", "cancelled"];

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
}

export default function SubscriptionsScreen() {
  const { token } = useAuth();
  const [pools,     setPools]     = useState<Pool[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [editModal, setEditModal] = useState<Pool | null>(null);
  const [newStatus, setNewStatus] = useState("active");
  const [startDate, setStartDate] = useState("");
  const [endDate,   setEndDate]   = useState("");
  const [note,      setNote]      = useState("");
  const [saving,    setSaving]    = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  async function fetchPools() {
    try {
      const res = await apiRequest(token, "/super/operators");
      if (res.ok) {
        const data = await res.json();
        setPools(Array.isArray(data) ? data : []);
      }
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchPools(); }, []);

  function openEdit(pool: Pool) {
    setEditModal(pool);
    setNewStatus(pool.subscription_status);
    setStartDate(pool.subscription_start_at ? pool.subscription_start_at.split("T")[0] : "");
    setEndDate(pool.subscription_end_at ? pool.subscription_end_at.split("T")[0] : "");
    setNote("");
  }

  async function handleSave() {
    if (!editModal) return;
    setSaving(true);
    try {
      await apiRequest(token, `/admin/pools/${editModal.id}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription_status: newStatus,
          subscription_start_at: startDate || null,
          subscription_end_at: endDate || null,
          note,
        }),
      });
      setPools(prev => prev.map(p => p.id === editModal.id
        ? { ...p, subscription_status: newStatus, subscription_start_at: startDate || null, subscription_end_at: endDate || null }
        : p));
      setEditModal(null);
    } finally { setSaving(false); }
  }

  const displayed = pools.filter(p =>
    filterStatus === "all" ? true : p.subscription_status === filterStatus
  );

  const counts: Record<string, number> = { all: pools.length };
  SUB_OPTIONS.forEach(k => { counts[k] = pools.filter(p => p.subscription_status === k).length; });

  const renderItem = ({ item }: { item: Pool }) => {
    const sc = SUB_CFG[item.subscription_status] ?? SUB_CFG.expired;
    const planLabel = item.subscription_tier?.label ?? "무료 이용";
    return (
      <Pressable style={s.row} onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
        <View style={s.rowLeft}>
          <View style={s.rowTop}>
            <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
            <View style={[s.badge, { backgroundColor: sc.bg }]}>
              <Text style={[s.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
            </View>
          </View>
          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{planLabel}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>다음결제 {fmtDate(item.subscription_end_at)}</Text>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.metaTxt}>{item.active_member_count ?? 0}명</Text>
            {(item.credit_balance ?? 0) > 0 && (
              <><Text style={s.metaDot}>·</Text>
              <Text style={[s.metaTxt, { color: P }]}>💳 {item.credit_balance}</Text></>
            )}
          </View>
        </View>
        <View style={s.rowActions}>
          <Pressable style={s.rowBtn}
            onPress={(e) => { e.stopPropagation(); openEdit(item); }}>
            <Feather name="edit-2" size={13} color={P} />
          </Pressable>
          <Feather name="chevron-right" size={16} color="#D1D5DB" />
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="구독 관리" homePath="/(super)/dashboard" />

      {/* 요약 수치 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.summaryBar} contentContainerStyle={s.summaryContent}>
        {[{ key: "all", label: "전체" }, ...SUB_OPTIONS.map(k => ({ key: k, label: SUB_CFG[k]?.label ?? k }))].map(item => {
          const sc = item.key === "all" ? { color: "#374151", bg: "#F3F4F6" } : (SUB_CFG[item.key] ?? { color: "#6B7280", bg: "#F3F4F6" });
          const isActive = filterStatus === item.key;
          return (
            <Pressable key={item.key}
              style={[s.summaryChip, { backgroundColor: isActive ? sc.color : sc.bg }]}
              onPress={() => setFilterStatus(item.key)}>
              <Text style={[s.summaryNum, { color: isActive ? "#fff" : sc.color }]}>{counts[item.key] ?? 0}</Text>
              <Text style={[s.summaryLabel, { color: isActive ? "rgba(255,255,255,0.8)" : "#6B7280" }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); fetchPools(); }} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="credit-card" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>운영자가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* 수정 모달 */}
      {editModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editModal.name} · 구독 변경</Text>

              <View style={m.section}>
                <Text style={m.label}>구독 상태</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {SUB_OPTIONS.map(opt => {
                    const sc = SUB_CFG[opt];
                    return (
                      <Pressable key={opt}
                        style={[m.optChip, newStatus === opt && { backgroundColor: sc.color, borderColor: sc.color }]}
                        onPress={() => setNewStatus(opt)}>
                        <Text style={[m.optChipTxt, newStatus === opt && { color: "#fff" }]}>{sc.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={m.section}>
                <Text style={m.label}>구독 시작일</Text>
                <TextInput style={m.input} value={startDate} onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>구독 종료일</Text>
                <TextInput style={m.input} value={endDate} onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.section}>
                <Text style={m.label}>메모</Text>
                <TextInput style={[m.input, { minHeight: 60 }]} value={note} onChangeText={setNote}
                  placeholder="변경 사유 (선택)" placeholderTextColor="#9CA3AF" multiline />
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={handleSave} disabled={saving}>
                  {saving ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={m.saveTxt}>저장</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  summaryBar:   { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  summaryContent:{ paddingHorizontal: 12, paddingVertical: 10, gap: 6, flexDirection: "row" },
  summaryChip:  { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, alignItems: "center" },
  summaryNum:   { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_500Medium", marginTop: 1 },
  row:          { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 16, paddingVertical: 13, backgroundColor: "#fff" },
  rowLeft:      { flex: 1, gap: 4 },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName:      { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  badge:        { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowMeta:      { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  metaTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  metaDot:      { fontSize: 10, color: "#D1D5DB" },
  rowActions:   { flexDirection: "row", alignItems: "center", gap: 6 },
  rowBtn:       { width: 32, height: 32, borderRadius: 8, backgroundColor: "#EDE9FE",
                  alignItems: "center", justifyContent: "center" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 12 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  section:   { gap: 6 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  optChip:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
               borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#fff" },
  optChipTxt:{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end", marginTop: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
