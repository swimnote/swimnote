/**
 * (super)/storage.tsx — 저장공간 관리 (사용량 순 정렬)
 * 95% 초과 운영자 우선 노출 · 용량 변경 빠른 액션
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface StorageItem {
  id: string;
  name: string;
  owner_name: string;
  used_storage_bytes: number;
  total_storage_gb: number;
  base_storage_gb: number;
  extra_storage_gb: number;
  usage_pct: number;
  upload_blocked: boolean;
}

function fmtBytes(b: number) {
  if (!b) return "0 B";
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export default function StorageScreen() {
  const { token } = useAuth();
  const [items,     setItems]     = useState<StorageItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [editItem,  setEditItem]  = useState<StorageItem | null>(null);
  const [extraGB,   setExtraGB]   = useState("");
  const [saving,    setSaving]    = useState(false);
  const [filterMode,setFilterMode]= useState<"all" | "danger" | "warn">("all");

  async function fetchItems() {
    try {
      const res = await apiRequest(token, "/super/storage-list");
      if (res.ok) setItems(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchItems(); }, []);

  async function saveStorage() {
    if (!editItem) return;
    setSaving(true);
    try {
      await apiRequest(token, `/super/storage/${editItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_storage_gb: parseFloat(extraGB) || 0 }),
      });
      setEditItem(null); setExtraGB("");
      fetchItems();
    } finally { setSaving(false); }
  }

  const dangerCount = items.filter(i => i.usage_pct >= 95).length;
  const warnCount   = items.filter(i => i.usage_pct >= 80 && i.usage_pct < 95).length;

  const displayed = items.filter(i => {
    if (filterMode === "danger") return i.usage_pct >= 95;
    if (filterMode === "warn")   return i.usage_pct >= 80;
    return true;
  });

  const renderItem = ({ item }: { item: StorageItem }) => {
    const alert = item.usage_pct >= 95;
    const warn  = item.usage_pct >= 80;
    const barColor = alert ? "#DC2626" : warn ? "#F59E0B" : "#10B981";

    return (
      <View style={[s.row, alert && s.rowAlert]}>
        <View style={s.rowLeft}>
          <View style={s.rowTop}>
            <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
            {alert && (
              <View style={s.alertTag}>
                <Feather name="alert-triangle" size={10} color="#DC2626" />
                <Text style={s.alertTagTxt}>위험</Text>
              </View>
            )}
            {item.upload_blocked && (
              <View style={[s.alertTag, { backgroundColor: "#F3F4F6" }]}>
                <Feather name="slash" size={10} color="#6B7280" />
                <Text style={[s.alertTagTxt, { color: "#6B7280" }]}>차단</Text>
              </View>
            )}
          </View>

          <View style={s.barRow}>
            <View style={s.barBg}>
              <View style={[s.barFill, { width: `${Math.min(item.usage_pct, 100)}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={[s.pct, alert && { color: "#DC2626" }]}>{item.usage_pct}%</Text>
          </View>

          <View style={s.metaRow}>
            <Text style={s.metaTxt}>{fmtBytes(item.used_storage_bytes)}</Text>
            <Text style={s.metaDot}>/</Text>
            <Text style={s.metaTxt}>{item.total_storage_gb} GB</Text>
            {(item.extra_storage_gb ?? 0) > 0 && (
              <><Text style={s.metaDot}>·</Text>
              <Text style={[s.metaTxt, { color: P }]}>+{item.extra_storage_gb}GB 추가</Text></>
            )}
          </View>
        </View>

        <View style={s.rowActions}>
          <Pressable style={s.rowBtn}
            onPress={() => { setEditItem(item); setExtraGB(String(item.extra_storage_gb || 0)); }}>
            <Feather name="plus-circle" size={16} color={P} />
          </Pressable>
          <Pressable style={[s.rowBtn, { backgroundColor: "#F3F4F6" }]}
            onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
            <Feather name="eye" size={14} color="#374151" />
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="저장공간 관리" homePath="/(super)/dashboard" />

      {/* 요약 바 */}
      <View style={s.summaryBar}>
        {[
          { key: "all",    label: "전체",     count: items.length,  color: "#374151", bg: "#F3F4F6" },
          { key: "danger", label: "95% 초과", count: dangerCount,   color: "#DC2626", bg: "#FEE2E2" },
          { key: "warn",   label: "80% 초과", count: warnCount,     color: "#D97706", bg: "#FEF3C7" },
        ].map(item => (
          <Pressable key={item.key}
            style={[s.summaryChip, filterMode === item.key && { backgroundColor: item.color }]}
            onPress={() => setFilterMode(item.key as any)}>
            <Text style={[s.summaryNum, filterMode === item.key && { color: "#fff" }]}>{item.count}</Text>
            <Text style={[s.summaryLabel, filterMode === item.key && { color: "rgba(255,255,255,0.8)" }]}>{item.label}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Pressable style={s.policyBtn} onPress={() => router.push("/(super)/storage-policy" as any)}>
          <Feather name="settings" size={14} color={P} />
          <Text style={s.policyBtnTxt}>정책 설정</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); fetchItems(); }} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="hard-drive" size={32} color="#D1D5DB" />
              <Text style={s.emptyTxt}>운영자가 없습니다</Text>
            </View>
          }
        />
      )}

      {/* 용량 변경 모달 */}
      {editItem && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditItem(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditItem(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>추가 용량 설정</Text>
              <Text style={m.subtitle}>{editItem.name} · 현재 {editItem.total_storage_gb} GB</Text>

              <View style={m.inputGroup}>
                <Text style={m.inputLabel}>추가 용량 (GB)</Text>
                <TextInput style={m.input} value={extraGB} onChangeText={setExtraGB}
                  keyboardType="decimal-pad" placeholder="예: 10"
                  placeholderTextColor="#9CA3AF" />
                <Text style={m.inputHint}>
                  설정 후 총 {(editItem.base_storage_gb || 5) + (parseFloat(extraGB) || 0)} GB
                </Text>
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditItem(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]}
                  onPress={saveStorage} disabled={saving}>
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
  summaryBar:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12,
                  paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  summaryChip:  { alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#F3F4F6" },
  summaryNum:   { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  summaryLabel: { fontSize: 9, fontFamily: "Inter_500Medium", color: "#6B7280" },
  policyBtn:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                  paddingVertical: 6, borderRadius: 8, backgroundColor: "#EDE9FE" },
  policyBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: P },
  row:          { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 13, backgroundColor: "#fff" },
  rowAlert:     { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  rowLeft:      { flex: 1, gap: 5 },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName:      { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  alertTag:     { flexDirection: "row", alignItems: "center", gap: 3,
                  backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  alertTagTxt:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#DC2626" },
  barRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  barBg:        { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#F3F4F6", overflow: "hidden" },
  barFill:      { height: 6, borderRadius: 3 },
  pct:          { fontSize: 12, fontFamily: "Inter_700Bold", color: "#374151", width: 36, textAlign: "right" },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  metaDot:      { fontSize: 10, color: "#D1D5DB" },
  rowActions:   { flexDirection: "row", gap: 6 },
  rowBtn:       { width: 34, height: 34, borderRadius: 9, backgroundColor: "#EDE9FE",
                  alignItems: "center", justifyContent: "center" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:      { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 44, gap: 16 },
  handle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:      { fontSize: 18, fontFamily: "Inter_700Bold", color: "#111827" },
  subtitle:   { fontSize: 13, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: -8 },
  inputGroup: { gap: 6 },
  inputLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  input:      { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  inputHint:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  btnRow:     { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn:  { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:    { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
