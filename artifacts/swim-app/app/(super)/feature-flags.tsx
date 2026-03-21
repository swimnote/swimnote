/**
 * (super)/feature-flags.tsx — 기능 플래그 관리
 * 전체 플랫폼 ON/OFF + 운영자별 예외 오버라이드
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface FeatureFlag {
  key: string; name: string; description: string; category: string;
  global_enabled: boolean; updated_at: string | null; updated_by: string | null;
  override_count: number;
}
interface Override {
  id: string; flag_key: string; pool_id: string; pool_name: string;
  owner_name: string; enabled: boolean; reason: string | null; created_at: string;
}
interface Operator { id: string; name: string; owner_name: string; }

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  기능:   { color: "#7C3AED", bg: "#EDE9FE" },
  구독:   { color: "#0891B2", bg: "#ECFEFF" },
  데이터: { color: "#DC2626", bg: "#FEE2E2" },
  저장공간: { color: "#059669", bg: "#D1FAE5" },
  general: { color: "#6B7280", bg: "#F3F4F6" },
};

function safeDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function relStr(iso: string | null | undefined) {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const h = Math.floor(m / 60);
  if (m < 60) return `${m}분 전`;
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function FeatureFlagsScreen() {
  const { token } = useAuth();
  const [flags,      setFlags]      = useState<FeatureFlag[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling,   setToggling]   = useState<string | null>(null);

  // 오버라이드 패널
  const [overridePanel, setOverridePanel] = useState<FeatureFlag | null>(null);
  const [overrides,     setOverrides]     = useState<Override[]>([]);
  const [oLoading,      setOLoading]      = useState(false);

  // 오버라이드 추가 모달
  const [addModal, setAddModal]   = useState(false);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [selPool,   setSelPool]   = useState<Operator | null>(null);
  const [oEnabled,  setOEnabled]  = useState(false);
  const [oReason,   setOReason]   = useState("");
  const [oSaving,   setOSaving]   = useState(false);
  const [opSearch,  setOpSearch]  = useState("");

  async function loadFlags() {
    try {
      const r = await apiRequest(token, "/super/feature-flags");
      if (r.ok) setFlags(await r.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { loadFlags(); }, []);

  async function toggleFlag(flag: FeatureFlag) {
    setToggling(flag.key);
    try {
      await apiRequest(token, `/super/feature-flags/${flag.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ global_enabled: !flag.global_enabled }),
      });
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, global_enabled: !f.global_enabled } : f));
    } catch {}
    finally { setToggling(null); }
  }

  async function openOverrides(flag: FeatureFlag) {
    setOverridePanel(flag);
    setOLoading(true);
    try {
      const r = await apiRequest(token, `/super/feature-flags/${flag.key}/overrides`);
      if (r.ok) setOverrides(await r.json());
    } catch {}
    finally { setOLoading(false); }
  }

  async function loadOperators() {
    try {
      const r = await apiRequest(token, "/super/operators");
      if (r.ok) setOperators(await r.json());
    } catch {}
  }

  async function addOverride() {
    if (!overridePanel || !selPool) return;
    setOSaving(true);
    try {
      await apiRequest(token, `/super/feature-flags/${overridePanel.key}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: selPool.id, enabled: oEnabled, reason: oReason || null }),
      });
      const r = await apiRequest(token, `/super/feature-flags/${overridePanel.key}/overrides`);
      if (r.ok) setOverrides(await r.json());
      setAddModal(false); setSelPool(null); setOReason(""); setOEnabled(false);
    } catch {}
    finally { setOSaving(false); }
  }

  async function deleteOverride(override: Override) {
    if (!overridePanel) return;
    try {
      await apiRequest(token, `/super/feature-flags/${overridePanel.key}/overrides/${override.pool_id}`, { method: "DELETE" });
      setOverrides(prev => prev.filter(o => o.pool_id !== override.pool_id));
    } catch {}
  }

  // 카테고리별 그룹
  const grouped = flags.reduce<Record<string, FeatureFlag[]>>((acc, f) => {
    const cat = f.category ?? "general";
    acc[cat] = acc[cat] ?? [];
    acc[cat].push(f);
    return acc;
  }, {});

  const filteredOps = operators.filter(op =>
    opSearch ? op.name.includes(opSearch) || op.owner_name.includes(opSearch) : true
  ).slice(0, 20);

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <SubScreenHeader title="기능 플래그" subtitle="플랫폼 기능 ON/OFF 관리" homePath="/(super)/dashboard" />

      {loading ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); loadFlags(); }} />}>

          <View style={s.infoBox}>
            <Feather name="info" size={13} color="#4F46E5" />
            <Text style={s.infoTxt}>글로벌 ON/OFF는 전체 운영자에 적용됩니다. 운영자별 예외는 "예외" 버튼에서 설정하세요.</Text>
          </View>

          {Object.entries(grouped).map(([cat, catFlags]) => {
            const cfg = CAT_CFG[cat] ?? CAT_CFG.general;
            return (
              <View key={cat} style={s.catSection}>
                <View style={s.catHeader}>
                  <View style={[s.catDot, { backgroundColor: cfg.color }]} />
                  <Text style={[s.catTitle, { color: cfg.color }]}>{cat}</Text>
                  <Text style={s.catCount}>{catFlags.length}개</Text>
                </View>
                {catFlags.map(flag => (
                  <View key={flag.key} style={s.flagCard}>
                    <View style={s.flagMain}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={s.flagName}>{flag.name}</Text>
                          <View style={[s.catBadge, { backgroundColor: cfg.bg }]}>
                            <Text style={[s.catBadgeTxt, { color: cfg.color }]}>{cat}</Text>
                          </View>
                        </View>
                        <Text style={s.flagDesc}>{flag.description ?? ""}</Text>
                        <Text style={s.flagMeta}>
                          {flag.updated_by ? `수정: ${flag.updated_by} · ` : ""}{relStr(flag.updated_at)}
                          {flag.override_count > 0 ? ` · 예외 ${flag.override_count}개` : ""}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        {toggling === flag.key ? (
                          <ActivityIndicator size="small" color={P} />
                        ) : (
                          <Switch
                            value={flag.global_enabled}
                            onValueChange={() => toggleFlag(flag)}
                            trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                            thumbColor={flag.global_enabled ? P : "#9CA3AF"}
                          />
                        )}
                        <Text style={[s.statusTxt, { color: flag.global_enabled ? "#059669" : "#6B7280" }]}>
                          {flag.global_enabled ? "전체 활성" : "전체 비활성"}
                        </Text>
                      </View>
                    </View>
                    <View style={s.flagActions}>
                      <Pressable style={s.overrideBtn} onPress={() => openOverrides(flag)}>
                        <Feather name="sliders" size={12} color="#4F46E5" />
                        <Text style={s.overrideBtnTxt}>운영자 예외 {flag.override_count > 0 ? `(${flag.override_count})` : ""}</Text>
                      </Pressable>
                      <View style={[s.keyBadge]}>
                        <Text style={s.keyTxt}>{flag.key}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 오버라이드 패널 */}
      <Modal visible={!!overridePanel} transparent animationType="slide" onRequestClose={() => setOverridePanel(null)}>
        <Pressable style={s.overlay} onPress={() => setOverridePanel(null)}>
          <Pressable style={s.panel} onPress={() => {}}>
            <View style={s.panelHandle} />
            <View style={s.panelHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.panelTitle}>{overridePanel?.name} — 운영자별 예외</Text>
                <Text style={s.panelSub}>글로벌 설정을 무시하는 운영자별 예외입니다</Text>
              </View>
              <Pressable style={s.addOverrideBtn}
                onPress={() => { loadOperators(); setAddModal(true); }}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={s.addOverrideBtnTxt}>예외 추가</Text>
              </Pressable>
            </View>

            {oLoading ? (
              <ActivityIndicator color={P} style={{ marginTop: 20 }} />
            ) : overrides.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="check-circle" size={32} color="#D1D5DB" />
                <Text style={s.emptyTxt}>운영자 예외 없음</Text>
                <Text style={s.emptySub}>모든 운영자에 글로벌 설정이 적용됩니다</Text>
              </View>
            ) : (
              <FlatList
                data={overrides}
                keyExtractor={o => o.pool_id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={s.overrideRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.overridePoolName}>{item.pool_name ?? item.pool_id}</Text>
                      <Text style={s.overridePoolSub}>{item.owner_name ?? ""} · {relStr(item.created_at)}</Text>
                      {item.reason && <Text style={s.overrideReason}>{item.reason}</Text>}
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <View style={[s.enableBadge, { backgroundColor: item.enabled ? "#D1FAE5" : "#FEE2E2" }]}>
                        <Text style={[s.enableBadgeTxt, { color: item.enabled ? "#059669" : "#DC2626" }]}>
                          {item.enabled ? "활성화" : "비활성화"}
                        </Text>
                      </View>
                      <Pressable onPress={() => deleteOverride(item)}>
                        <Feather name="trash-2" size={14} color="#DC2626" />
                      </Pressable>
                    </View>
                  </View>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 오버라이드 추가 모달 */}
      <Modal visible={addModal} transparent animationType="fade" onRequestClose={() => setAddModal(false)}>
        <Pressable style={s.overlay} onPress={() => setAddModal(false)}>
          <Pressable style={s.addSheet} onPress={() => {}}>
            <Text style={s.addTitle}>운영자 예외 추가 — {overridePanel?.name}</Text>

            <Text style={s.addLabel}>운영자 검색</Text>
            <TextInput style={s.addInput} value={opSearch} onChangeText={setOpSearch}
              placeholder="운영자명 검색" />
            {selPool && (
              <View style={s.selPoolRow}>
                <Text style={s.selPoolTxt}>{selPool.name}</Text>
                <Pressable onPress={() => setSelPool(null)}>
                  <Feather name="x" size={14} color="#DC2626" />
                </Pressable>
              </View>
            )}
            {!selPool && filteredOps.length > 0 && (
              <ScrollView style={s.opList}>
                {filteredOps.map(op => (
                  <Pressable key={op.id} style={s.opRow} onPress={() => { setSelPool(op); setOpSearch(""); }}>
                    <Text style={s.opName}>{op.name}</Text>
                    <Text style={s.opOwner}>{op.owner_name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <View style={s.enableRow}>
              <Text style={s.addLabel}>예외 설정</Text>
              <Switch value={oEnabled} onValueChange={setOEnabled}
                trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                thumbColor={oEnabled ? P : "#9CA3AF"} />
              <Text style={{ color: oEnabled ? "#059669" : "#DC2626", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {oEnabled ? "활성화 (글로벌 무시)" : "비활성화 (글로벌 무시)"}
              </Text>
            </View>

            <Text style={s.addLabel}>사유 (선택)</Text>
            <TextInput style={s.addInput} value={oReason} onChangeText={setOReason} placeholder="예외 사유" />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[s.rejectBtn2, { backgroundColor: "#F3F4F6" }]} onPress={() => setAddModal(false)}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable style={[s.rejectBtn2, { backgroundColor: P, opacity: (!selPool || oSaving) ? 0.5 : 1 }]}
                onPress={addOverride} disabled={!selPool || oSaving}>
                {oSaving ? <ActivityIndicator size="small" color="#fff" /> :
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>추가</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F9FAFB" },
  infoBox:    { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#EEF2FF",
                margin: 14, marginBottom: 8, padding: 12, borderRadius: 10 },
  infoTxt:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4F46E5", flex: 1, lineHeight: 18 },

  catSection: { marginBottom: 4 },
  catHeader:  { flexDirection: "row", alignItems: "center", gap: 6,
                paddingHorizontal: 16, paddingVertical: 8 },
  catDot:     { width: 8, height: 8, borderRadius: 4 },
  catTitle:   { fontSize: 13, fontFamily: "Inter_700Bold" },
  catCount:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },

  flagCard:   { backgroundColor: "#fff", marginHorizontal: 14, marginBottom: 8,
                borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  flagMain:   { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  flagName:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  flagDesc:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 4, lineHeight: 18 },
  flagMeta:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 4 },
  catBadge:   { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  catBadgeTxt:{ fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusTxt:  { fontSize: 11, fontFamily: "Inter_500Medium" },

  flagActions:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  overrideBtn:{ flexDirection: "row", gap: 5, alignItems: "center",
                backgroundColor: "#EEF2FF", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  overrideBtnTxt:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#4F46E5" },
  keyBadge:   { backgroundColor: "#1E293B", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  keyTxt:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#94A3B8" },

  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  panel:      { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                padding: 20, maxHeight: "80%" },
  panelHandle:{ width: 40, height: 4, backgroundColor: "#D1D5DB", borderRadius: 2,
                alignSelf: "center", marginBottom: 16 },
  panelHeader:{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  panelTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  panelSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  addOverrideBtn:{ flexDirection: "row", gap: 5, backgroundColor: P, borderRadius: 8,
                   paddingHorizontal: 10, paddingVertical: 7, alignItems: "center" },
  addOverrideBtnTxt:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },

  emptyBox:   { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#D1D5DB" },
  emptySub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },

  overrideRow:{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  overridePoolName:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  overridePoolSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  overrideReason:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", marginTop: 4,
                     backgroundColor: "#FEF3C7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  enableBadge:    { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  enableBadgeTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  addSheet:   { backgroundColor: "#fff", borderRadius: 20, padding: 20, margin: 16, maxHeight: "85%" },
  addTitle:   { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 16 },
  addLabel:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6, marginTop: 10 },
  addInput:   { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12,
                fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  opList:     { maxHeight: 140, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, marginBottom: 4 },
  opRow:      { flexDirection: "row", alignItems: "center", padding: 10,
                borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  opName:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827", flex: 1 },
  opOwner:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  selPoolRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                backgroundColor: "#D1FAE5", borderRadius: 8, padding: 10, marginTop: 4 },
  selPoolTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#059669" },
  enableRow:  { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  rejectBtn2: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
});
