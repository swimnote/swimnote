/**
 * (super)/storage.tsx — 저장공간 관리
 * storageStore — API 호출 없음
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useStorageStore } from "@/store/storageStore";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { StoragePolicy } from "@/domain/types";

const P = "#059669";

const TABS = [
  { key: "all",      label: "전체" },
  { key: "blocked95",label: "95%↑ 위험" },
  { key: "warning80",label: "80%↑ 경고" },
  { key: "spike",    label: "업로드 급증" },
  { key: "deletion", label: "삭제 예정" },
];

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtMb(mb: number): string {
  if (!mb || mb === 0) return "0 MB";
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function hoursLeft(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  return `${h}h 후 삭제`;
}

export default function StorageScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const policies        = useStorageStore(s => s.policies);
  const storageTab      = useStorageStore(s => s.storageTab);
  const setStorageTab   = useStorageStore(s => s.setStorageTab);
  const setStoragePolicy= useStorageStore(s => s.setStoragePolicy);
  const getByTab        = useStorageStore(s => s.getByTab);

  const scheduleAutoDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const createLog          = useAuditLogStore(s => s.createLog);

  const [refreshing,    setRefreshing]    = useState(false);
  const [editOp,        setEditOp]        = useState<StoragePolicy | null>(null);
  const [newStorageMb,  setNewStorageMb]  = useState("");
  const [saving,        setSaving]        = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const tab = storageTab;
  const filtered = getByTab();

  const counts = {
    all:       policies.length,
    blocked95: policies.filter(p => p.isBlocked95).length,
    warning80: policies.filter(p => p.isWarning80 && !p.isBlocked95).length,
    spike:     policies.filter(p => p.uploadSpikeFlag).length,
    deletion:  policies.filter(p => !!p.autoDeleteScheduledAt).length,
  };

  function handleSave() {
    if (!editOp) return;
    const mb = parseFloat(newStorageMb) * 1024; // input is GB → convert to MB
    if (isNaN(mb) || mb < 0) return;
    setSaving(true);
    setStoragePolicy(editOp.operatorId, { extraMb: Math.round(mb) });
    createLog({ category: '저장공간', title: `추가 용량 부여: ${editOp.operatorName} +${newStorageMb}GB`, detail: `+${newStorageMb}GB 추가`, actorName, impact: 'medium' });
    setSaving(false); setEditOp(null);
  }

  function deferDeletion(p: StoragePolicy) {
    setActionLoading(p.operatorId);
    const at = new Date(Date.now() + 48 * 3600000).toISOString();
    scheduleAutoDelete(p.operatorId, at);
    createLog({ category: '저장공간', title: `삭제 유예 48h: ${p.operatorName}`, detail: '48시간 유예 설정', actorName, impact: 'medium' });
    setTimeout(() => setActionLoading(null), 500);
  }

  const renderItem = ({ item: p }: { item: StoragePolicy }) => {
    const pct        = p.usedPercent;
    const isDanger   = p.isBlocked95;
    const isWarn     = p.isWarning80 && !isDanger;
    const barColor   = isDanger ? "#DC2626" : isWarn ? "#D97706" : "#059669";
    const isDeletion = !!p.autoDeleteScheduledAt;

    return (
      <View style={[s.row, isDanger && s.rowDanger, isWarn && s.rowWarn]}>
        <View style={s.rowMain}>
          <View style={s.rowTop}>
            <Pressable onPress={() => router.push(`/(super)/operator-detail?id=${p.operatorId}` as any)}>
              <Text style={s.opName}>{p.operatorName}</Text>
            </Pressable>
            {isDanger && (
              <View style={s.dangerTag}><Text style={s.dangerTagTxt}>업로드 차단</Text></View>
            )}
            {p.uploadSpikeFlag && (
              <View style={s.spikeTag}>
                <Feather name="trending-up" size={9} color="#D97706" />
                <Text style={s.spikeTxt}>급증</Text>
              </View>
            )}
          </View>

          <View style={s.barRow}>
            <View style={s.barBg}>
              <View style={[s.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: barColor }]} />
            </View>
            <Text style={[s.pctTxt, { color: barColor }]}>{pct.toFixed(0)}%</Text>
          </View>

          <View style={s.rowMeta}>
            <Text style={s.metaTxt}>{fmtMb(p.usedMb)} / {fmtMb(p.totalMb)}</Text>
            {isDeletion && (
              <><Text style={s.metaDot}>·</Text>
              <Text style={[s.metaTxt, { color: "#DC2626", fontFamily: "Inter_700Bold" }]}>{hoursLeft(p.autoDeleteScheduledAt)}</Text></>
            )}
          </View>
        </View>

        <View style={s.rowActions}>
          {isDeletion && (
            <Pressable style={[s.actionBtn, { backgroundColor: "#FEF3C7" }]}
              onPress={() => deferDeletion(p)} disabled={actionLoading === p.operatorId}>
              {actionLoading === p.operatorId
                ? <ActivityIndicator size="small" color="#D97706" />
                : <Text style={[s.actionTxt, { color: "#D97706" }]}>유예</Text>}
            </Pressable>
          )}
          <Pressable style={[s.actionBtn, { backgroundColor: "#D1FAE5" }]}
            onPress={() => { setEditOp(p); setNewStorageMb("0"); }}>
            <Text style={[s.actionTxt, { color: "#059669" }]}>용량↑</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="저장공간 관리" homePath="/(super)/dashboard"
        rightSlot={
          <Pressable onPress={() => router.push("/(super)/storage-policy" as any)}
            style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#F3F4F6",
                     alignItems: "center", justifyContent: "center" }}>
            <Feather name="settings" size={18} color="#6B7280" />
          </Pressable>
        } />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabContent}>
        {TABS.map(t => {
          const isActive = tab === t.key;
          const cnt = counts[t.key as keyof typeof counts] ?? 0;
          return (
            <Pressable key={t.key} style={[s.tab, isActive && s.tabActive]} onPress={() => setStorageTab(t.key)}>
              <Text style={[s.tabTxt, isActive && s.tabTxtActive]}>{t.label}</Text>
              {cnt > 0 && t.key !== "all" && (
                <View style={[s.tabBadge, isActive && { backgroundColor: P }]}>
                  <Text style={[s.tabBadgeTxt, isActive && { color: "#fff" }]}>{cnt}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {tab === "spike" && (
        <View style={s.spikeBanner}>
          <Feather name="trending-up" size={13} color="#D97706" />
          <Text style={s.spikeBannerTxt}>7일 내 업로드 급증 운영자입니다. 비정상 사용 여부를 확인하세요.</Text>
        </View>
      )}
      {tab === "blocked95" && (
        <View style={[s.spikeBanner, { backgroundColor: "#FEE2E2" }]}>
          <Feather name="alert-triangle" size={13} color="#DC2626" />
          <Text style={[s.spikeBannerTxt, { color: "#7F1D1D" }]}>95% 초과 운영자는 신규 업로드가 자동 차단됩니다.</Text>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={p => p.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}
        contentContainerStyle={{ paddingBottom: 80 }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: "#F3F4F6" }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="hard-drive" size={30} color="#D1D5DB" />
            <Text style={s.emptyTxt}>{TABS.find(t => t.key === tab)?.label} 운영자가 없습니다</Text>
          </View>
        }
      />

      {editOp && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditOp(null)}>
          <Pressable style={m.backdrop} onPress={() => setEditOp(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{editOp.operatorName}</Text>
              <Text style={m.sub}>현재 {editOp.usedPercent.toFixed(0)}% 사용 · {fmtMb(editOp.usedMb)} / {fmtMb(editOp.totalMb)}</Text>

              <View style={m.infoBar}>
                <View style={m.barBg}>
                  <View style={[m.barFill, {
                    width: `${Math.min(editOp.usedPercent, 100)}%` as any,
                    backgroundColor: editOp.isBlocked95 ? "#DC2626" : "#059669"
                  }]} />
                </View>
              </View>

              <View style={m.section}>
                <Text style={m.label}>추가 용량 (GB)</Text>
                <View style={m.qtyRow}>
                  {[0, 5, 10, 20, 50].map(v => (
                    <Pressable key={v} style={[m.qtyBtn, newStorageMb === v.toString() && m.qtyBtnActive]}
                      onPress={() => setNewStorageMb(v.toString())}>
                      <Text style={[m.qtyTxt, newStorageMb === v.toString() && { color: "#fff" }]}>{v}GB</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput style={m.input} value={newStorageMb} onChangeText={setNewStorageMb}
                  keyboardType="decimal-pad" placeholder="직접 입력 (GB)" placeholderTextColor="#9CA3AF" />
              </View>

              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setEditOp(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.saveBtn, { opacity: saving ? 0.6 : 1 }]} onPress={handleSave} disabled={saving}>
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
  safe:         { flex: 1, backgroundColor: "#F0FDF4" },
  tabBar:       { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", flexGrow: 0 },
  tabContent:   { paddingHorizontal: 12, paddingVertical: 6, gap: 4, flexDirection: "row" },
  tab:          { flexDirection: "row", alignItems: "center", gap: 5,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  tabActive:    { backgroundColor: "#D1FAE5" },
  tabTxt:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#6B7280" },
  tabTxtActive: { color: P, fontFamily: "Inter_700Bold" },
  tabBadge:     { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 7 },
  tabBadgeTxt:  { fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626" },
  spikeBanner:  { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF3C7",
                  paddingHorizontal: 14, paddingVertical: 9 },
  spikeBannerTxt:{ flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 16 },
  row:          { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "#fff" },
  rowDanger:    { borderLeftWidth: 3, borderLeftColor: "#DC2626" },
  rowWarn:      { borderLeftWidth: 3, borderLeftColor: "#D97706" },
  rowMain:      { flex: 1, gap: 4 },
  rowTop:       { flexDirection: "row", alignItems: "center", gap: 6 },
  opName:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  dangerTag:    { backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  dangerTagTxt: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#DC2626" },
  spikeTag:     { flexDirection: "row", alignItems: "center", gap: 3,
                  backgroundColor: "#FEF3C7", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5 },
  spikeTxt:     { fontSize: 9, fontFamily: "Inter_700Bold", color: "#D97706" },
  barRow:       { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:        { flex: 1, height: 5, borderRadius: 2.5, backgroundColor: "#F3F4F6", overflow: "hidden" },
  barFill:      { height: 5, borderRadius: 2.5 },
  pctTxt:       { fontSize: 12, fontFamily: "Inter_700Bold", width: 34, textAlign: "right" },
  rowMeta:      { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metaDot:      { fontSize: 10, color: "#D1D5DB" },
  rowActions:   { flexDirection: "row", gap: 6 },
  actionBtn:    { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 40, alignItems: "center" },
  actionTxt:    { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty:        { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTxt:     { fontSize: 14, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});

const m = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40,
               maxHeight: "70%", gap: 14 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: -8 },
  infoBar:   { backgroundColor: "#F3F4F6", borderRadius: 8, padding: 8 },
  barBg:     { height: 8, borderRadius: 4, backgroundColor: "#E5E7EB", overflow: "hidden" },
  barFill:   { height: 8, borderRadius: 4 },
  section:   { gap: 8 },
  label:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },
  qtyRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  qtyBtn:    { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
               borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  qtyBtnActive:{ backgroundColor: P, borderColor: P },
  qtyTxt:    { fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  input:     { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10, padding: 12,
               fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  btnRow:    { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F3F4F6" },
  cancelTxt: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#374151" },
  saveBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: P },
  saveTxt:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
