/**
 * (super)/feature-flags.tsx — 기능 플래그 관리
 * featureFlagStore에서 9개 플래그 — API 호출 없음
 * 글로벌 토글 + 운영자별 예외 설정 모두 store에서 처리
 */
import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  FlatList, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useFeatureFlagStore } from "@/store/featureFlagStore";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import type { FeatureFlag } from "@/domain/types";

const P = "#7C3AED";

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  기능:     { color: "#7C3AED", bg: "#EDE9FE" },
  구독:     { color: "#0891B2", bg: "#ECFEFF" },
  데이터:   { color: "#DC2626", bg: "#FEE2E2" },
  저장공간: { color: "#059669", bg: "#D1FAE5" },
  보안:     { color: "#991B1B", bg: "#FEE2E2" },
  general:  { color: "#6B7280", bg: "#F3F4F6" },
};

function relStr(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const h = Math.floor(m / 60);
  if (m < 60) return `${m}분 전`;
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function FeatureFlagsScreen() {
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const [refreshing, setRefreshing] = useState(false);
  const [overridePanel, setOverridePanel] = useState<FeatureFlag | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [reasonModal, setReasonModal] = useState<{ flag: FeatureFlag; newEnabled: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [selOp, setSelOp] = useState<{ id: string; name: string } | null>(null);
  const [opOverrideEnabled, setOpOverrideEnabled] = useState(false);
  const [opReason, setOpReason] = useState("");
  const [opSearch, setOpSearch] = useState("");

  const globalFlags    = useFeatureFlagStore(s => s.getGlobalFlags());
  const allFlags       = useFeatureFlagStore(s => s.flags);
  const toggleFlagFn   = useFeatureFlagStore(s => s.toggleFlag);
  const setOpFlag      = useFeatureFlagStore(s => s.setOperatorFlag);
  const createLog      = useAuditLogStore(s => s.createLog);
  const operators      = useOperatorsStore(s => s.operators);

  // Group global flags by category
  const grouped = useMemo(() => {
    const map: Record<string, FeatureFlag[]> = {};
    globalFlags.forEach(f => {
      const cat = f.key.includes('subscription') || f.key.includes('grace') ? '구독'
        : f.key.includes('media') || f.key.includes('upload') ? '저장공간'
        : f.key.includes('delete') || f.key.includes('readonly') ? '데이터'
        : f.key.includes('security') ? '보안'
        : '기능';
      map[cat] = map[cat] ?? [];
      map[cat].push(f);
    });
    return map;
  }, [globalFlags]);

  // Get override count for a flag key
  function getOverrideCount(key: string): number {
    return allFlags.filter(f => f.scope === 'operator' && f.key === key).length;
  }

  // Get operator overrides for current panel
  const panelOverrides = useMemo(() => {
    if (!overridePanel) return [];
    return allFlags.filter(f => f.scope === 'operator' && f.key === overridePanel.key);
  }, [allFlags, overridePanel]);

  function requestToggle(flag: FeatureFlag) {
    setReasonModal({ flag, newEnabled: !flag.enabled });
    setReason("");
  }

  function confirmToggle() {
    if (!reasonModal) return;
    if (!reason.trim()) return;
    const updated = toggleFlagFn(reasonModal.flag.id, reasonModal.newEnabled, reason, actorName);
    if (updated) {
      createLog({
        category: '기능플래그',
        title: `${reasonModal.flag.name} ${reasonModal.newEnabled ? '활성화' : '비활성화'}`,
        actorName,
        impact: 'medium',
        detail: reason,
      });
    }
    setReasonModal(null);
    setReason("");
  }

  function addOperatorOverride() {
    if (!overridePanel || !selOp || !opReason.trim()) return;
    const result = setOpFlag({
      key: overridePanel.key,
      name: overridePanel.name,
      operatorId: selOp.id,
      operatorName: selOp.name,
      enabled: opOverrideEnabled,
      reason: opReason,
      actorName,
    });
    createLog({
      category: '기능플래그',
      title: `${overridePanel.name} 운영자 예외: ${selOp.name}`,
      operatorId: selOp.id,
      operatorName: selOp.name,
      actorName,
      impact: 'medium',
      detail: `${opOverrideEnabled ? '활성화' : '비활성화'} 예외 · ${opReason}`,
    });
    setAddModal(false); setSelOp(null); setOpReason(""); setOpOverrideEnabled(false);
  }

  const filteredOps = useMemo(() =>
    operators
      .filter(op => opSearch ? op.name.includes(opSearch) || op.representativeName.includes(opSearch) : true)
      .slice(0, 20),
    [operators, opSearch]
  );

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <SubScreenHeader title="기능 플래그" subtitle="플랫폼 기능 ON/OFF 관리" homePath="/(super)/dashboard" />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}>

        <View style={s.infoBox}>
          <Feather name="info" size={13} color="#4F46E5" />
          <Text style={s.infoTxt}>
            글로벌 ON/OFF는 전체 운영자에 적용됩니다. 토글 시 사유 입력이 필수입니다. 운영자별 예외는 "예외" 버튼에서 설정하세요.
          </Text>
        </View>

        <View style={s.countRow}>
          <Text style={s.countTxt}>
            총 <Text style={{ color: P, fontFamily: "Inter_700Bold" }}>{globalFlags.length}</Text>개 플래그
            · 활성 <Text style={{ color: "#059669", fontFamily: "Inter_700Bold" }}>{globalFlags.filter(f => f.enabled).length}</Text>개
          </Text>
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
              {catFlags.map(flag => {
                const overrideCount = getOverrideCount(flag.key);
                return (
                  <View key={flag.id} style={[s.flagCard, flag.enabled && s.flagCardActive]}>
                    <View style={s.flagMain}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text style={s.flagName}>{flag.name}</Text>
                          <View style={[s.catBadge, { backgroundColor: cfg.bg }]}>
                            <Text style={[s.catBadgeTxt, { color: cfg.color }]}>{cat}</Text>
                          </View>
                        </View>
                        <Text style={s.flagDesc}>{flag.description ?? ""}</Text>
                        <Text style={s.flagMeta}>
                          {flag.updatedBy ? `수정: ${flag.updatedBy} · ` : ""}{relStr(flag.updatedAt)}
                          {overrideCount > 0 ? ` · 예외 ${overrideCount}개` : ""}
                        </Text>
                        {flag.reason && (
                          <Text style={s.reasonTxt}>{flag.reason}</Text>
                        )}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Switch
                          value={flag.enabled}
                          onValueChange={() => requestToggle(flag)}
                          trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                          thumbColor={flag.enabled ? P : "#9CA3AF"}
                        />
                        <Text style={[s.statusTxt, { color: flag.enabled ? "#059669" : "#6B7280" }]}>
                          {flag.enabled ? "전체 활성" : "전체 비활성"}
                        </Text>
                      </View>
                    </View>
                    <View style={s.flagActions}>
                      <Pressable style={s.overrideBtn}
                        onPress={() => { setOverridePanel(flag); }}>
                        <Feather name="sliders" size={12} color="#4F46E5" />
                        <Text style={s.overrideBtnTxt}>운영자 예외 {overrideCount > 0 ? `(${overrideCount})` : ""}</Text>
                      </Pressable>
                      <View style={s.keyBadge}>
                        <Text style={s.keyTxt}>{flag.key}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* 토글 사유 입력 모달 */}
      <Modal visible={!!reasonModal} transparent animationType="fade" onRequestClose={() => setReasonModal(null)}>
        <Pressable style={s.overlay} onPress={() => setReasonModal(null)}>
          <Pressable style={s.reasonSheet} onPress={() => {}}>
            <Text style={s.addTitle}>
              {reasonModal?.flag.name} {reasonModal?.newEnabled ? "활성화" : "비활성화"}
            </Text>
            <Text style={s.addLabel}>사유 입력 (필수)</Text>
            <TextInput style={s.addInput} value={reason} onChangeText={setReason}
              placeholder="변경 사유를 입력하세요" multiline numberOfLines={2}
              placeholderTextColor="#9CA3AF" />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[s.actionBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setReasonModal(null)}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.actionBtn, { backgroundColor: P, opacity: !reason.trim() ? 0.5 : 1 }]}
                onPress={confirmToggle} disabled={!reason.trim()}>
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 운영자 예외 패널 */}
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
                onPress={() => { setAddModal(true); }}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={s.addOverrideBtnTxt}>예외 추가</Text>
              </Pressable>
            </View>

            {panelOverrides.length === 0 ? (
              <View style={s.emptyBox}>
                <Feather name="check-circle" size={32} color="#D1D5DB" />
                <Text style={s.emptyTxt}>운영자 예외 없음</Text>
                <Text style={s.emptySub}>모든 운영자에 글로벌 설정이 적용됩니다</Text>
              </View>
            ) : (
              <FlatList
                data={panelOverrides}
                keyExtractor={o => o.id}
                style={{ maxHeight: 400 }}
                renderItem={({ item }) => (
                  <View style={s.overrideRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.overridePoolName}>{item.operatorId ? (operators.find(o => o.id === item.operatorId)?.name ?? item.operatorId) : "—"}</Text>
                      <Text style={s.overridePoolSub}>{relStr(item.updatedAt)}</Text>
                      {item.reason && <Text style={s.overrideReason}>{item.reason}</Text>}
                    </View>
                    <View style={[s.enableBadge, { backgroundColor: item.enabled ? "#D1FAE5" : "#FEE2E2" }]}>
                      <Text style={[s.enableBadgeTxt, { color: item.enabled ? "#059669" : "#DC2626" }]}>
                        {item.enabled ? "활성화" : "비활성화"}
                      </Text>
                    </View>
                  </View>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* 운영자 예외 추가 모달 */}
      <Modal visible={addModal} transparent animationType="fade" onRequestClose={() => setAddModal(false)}>
        <Pressable style={s.overlay} onPress={() => setAddModal(false)}>
          <Pressable style={s.addSheet} onPress={() => {}}>
            <Text style={s.addTitle}>운영자 예외 추가 — {overridePanel?.name}</Text>

            <Text style={s.addLabel}>운영자 검색</Text>
            <TextInput style={s.addInput} value={opSearch} onChangeText={setOpSearch}
              placeholder="운영자명 검색" placeholderTextColor="#9CA3AF" />
            {selOp ? (
              <View style={s.selPoolRow}>
                <Text style={s.selPoolTxt}>{selOp.name}</Text>
                <Pressable onPress={() => setSelOp(null)}>
                  <Feather name="x" size={14} color="#DC2626" />
                </Pressable>
              </View>
            ) : filteredOps.length > 0 ? (
              <ScrollView style={s.opList}>
                {filteredOps.map(op => (
                  <Pressable key={op.id} style={s.opRow}
                    onPress={() => { setSelOp({ id: op.id, name: op.name }); setOpSearch(""); }}>
                    <Text style={s.opName}>{op.name}</Text>
                    <Text style={s.opOwner}>{op.representativeName}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            <View style={s.enableRow}>
              <Text style={s.addLabel}>예외 설정</Text>
              <Switch value={opOverrideEnabled} onValueChange={setOpOverrideEnabled}
                trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                thumbColor={opOverrideEnabled ? P : "#9CA3AF"} />
              <Text style={{ color: opOverrideEnabled ? "#059669" : "#DC2626", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {opOverrideEnabled ? "활성화 (글로벌 무시)" : "비활성화 (글로벌 무시)"}
              </Text>
            </View>

            <Text style={s.addLabel}>사유 (필수)</Text>
            <TextInput style={s.addInput} value={opReason} onChangeText={setOpReason}
              placeholder="예외 사유 (필수)" placeholderTextColor="#9CA3AF" />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[s.actionBtn, { backgroundColor: "#F3F4F6" }]}
                onPress={() => { setAddModal(false); setSelOp(null); setOpReason(""); }}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.actionBtn, { backgroundColor: P, opacity: (!selOp || !opReason.trim()) ? 0.5 : 1 }]}
                onPress={addOperatorOverride}
                disabled={!selOp || !opReason.trim()}>
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>추가</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F9FAFB" },
  infoBox:       { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: "#EEF2FF", margin: 14, marginBottom: 6, padding: 12, borderRadius: 10 },
  infoTxt:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#4F46E5", flex: 1, lineHeight: 18 },
  countRow:      { paddingHorizontal: 16, paddingBottom: 4 },
  countTxt:      { fontFamily: "Inter_400Regular", fontSize: 13, color: "#374151" },
  catSection:    { marginBottom: 4 },
  catHeader:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  catDot:        { width: 8, height: 8, borderRadius: 4 },
  catTitle:      { fontSize: 13, fontFamily: "Inter_700Bold" },
  catCount:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginLeft: "auto" },
  flagCard:      { backgroundColor: "#fff", marginHorizontal: 14, marginBottom: 8, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  flagCardActive:{ borderColor: "#C4B5FD" },
  flagMain:      { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  flagName:      { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
  flagDesc:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 4, lineHeight: 18 },
  flagMeta:      { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 4 },
  reasonTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", marginTop: 4, backgroundColor: "#FEF3C7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  catBadge:      { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  catBadgeTxt:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  statusTxt:     { fontSize: 11, fontFamily: "Inter_500Medium" },
  flagActions:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  overrideBtn:   { flexDirection: "row", gap: 5, alignItems: "center", backgroundColor: "#EEF2FF", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  overrideBtnTxt:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#4F46E5" },
  keyBadge:      { backgroundColor: "#1E293B", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  keyTxt:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "#94A3B8" },
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  panel:         { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "80%" },
  panelHandle:   { width: 40, height: 4, backgroundColor: "#D1D5DB", borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  panelHeader:   { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
  panelTitle:    { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  panelSub:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  addOverrideBtn:{ flexDirection: "row", gap: 5, backgroundColor: P, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignItems: "center" },
  addOverrideBtnTxt:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  emptyBox:      { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyTxt:      { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#D1D5DB" },
  emptySub:      { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  overrideRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  overridePoolName:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  overridePoolSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  overrideReason:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#D97706", marginTop: 4, backgroundColor: "#FEF3C7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  enableBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  enableBadgeTxt:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  reasonSheet:   { backgroundColor: "#fff", borderRadius: 20, padding: 20, margin: 16 },
  addSheet:      { backgroundColor: "#fff", borderRadius: 20, padding: 20, margin: 16, maxHeight: "85%" },
  addTitle:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 12 },
  addLabel:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6, marginTop: 10 },
  addInput:      { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827" },
  opList:        { maxHeight: 140, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, marginBottom: 4 },
  opRow:         { flexDirection: "row", alignItems: "center", padding: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  opName:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827", flex: 1 },
  opOwner:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },
  selPoolRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#D1FAE5", borderRadius: 8, padding: 10, marginTop: 4 },
  selPoolTxt:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#059669" },
  enableRow:     { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  actionBtn:     { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
});
