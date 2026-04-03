/**
 * (super)/feature-flags.tsx — 기능 플래그 관리
 * 롤백 지원 · 위험 플래그 경고 모달 · 변경 사유 필수 · 영향 범위 표시
 * /super/feature-flags API 실데이터 연결
 */
import { Check, Info, RotateCcw, Target, TriangleAlert, Users } from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useOperatorsStore } from "@/store/operatorsStore";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";
const DANGER = "#D96C6C";
const WARN = "#D97706";

const DANGER_FLAG_KEYS = new Set([
  'auto_deletion_policy',
  'readonly_auto_trigger',
  'upload_spike_detection',
  'new_subscription_policy',
  'support_center_v2',
  'new_upload_structure',
]);

const FLAG_IMPACT: Record<string, { scope: string; risk: string; riskColor: string }> = {
  auto_deletion_policy:    { scope: '전체 운영자 · 데이터 삭제 정책',     risk: '위험',  riskColor: DANGER },
  readonly_auto_trigger:   { scope: '전체 운영자 · 자동 읽기전용 전환',   risk: '위험',  riskColor: DANGER },
  upload_spike_detection:  { scope: '전체 운영자 · 업로드 감지 시스템',   risk: '주의',  riskColor: WARN },
  new_subscription_policy: { scope: '전체 구독·결제 흐름',                risk: '주의',  riskColor: WARN },
  support_center_v2:       { scope: '고객센터 v2 기능 전체',               risk: '주의',  riskColor: WARN },
  new_upload_structure:    { scope: '미디어 업로드 파이프라인',            risk: '주의',  riskColor: WARN },
  new_scheduler:           { scope: '수업 스케줄링 엔진',                  risk: '낮음',  riskColor: '#2EC4B6' },
};

const CAT_CFG: Record<string, { color: string; bg: string }> = {
  기능:     { color: "#7C3AED", bg: "#EEDDF5" },
  구독:     { color: "#2EC4B6", bg: "#ECFEFF" },
  데이터:   { color: DANGER,    bg: "#F9DEDA" },
  저장공간: { color: "#2EC4B6", bg: "#E6FFFA" },
  보안:     { color: "#991B1B", bg: "#F9DEDA" },
  general:  { color: "#64748B", bg: "#FFFFFF" },
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

function getCategory(key: string, apiCategory: string | null): string {
  if (apiCategory) return apiCategory;
  if (key.includes('subscription') || key.includes('grace')) return '구독';
  if (key.includes('media') || key.includes('upload')) return '저장공간';
  if (key.includes('delete') || key.includes('readonly')) return '데이터';
  if (key.includes('security')) return '보안';
  return '기능';
}

interface ApiFlag {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  global_enabled: boolean;
  override_count: number;
  updated_at: string | null;
  updated_by: string | null;
  reason?: string | null;
}

export default function FeatureFlagsScreen() {
  const { adminUser, token } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';

  const [flags, setFlags]         = useState<ApiFlag[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [prevStates, setPrevStates] = useState<Record<string, boolean>>({});

  const [overridePanel,setOverridePanel]= useState<ApiFlag | null>(null);
  const [reasonModal,  setReasonModal]  = useState<{ flag: ApiFlag; newEnabled: boolean } | null>(null);
  const [dangerModal,  setDangerModal]  = useState<{ flag: ApiFlag; newEnabled: boolean } | null>(null);
  const [rollbackModal,setRollbackModal]= useState<ApiFlag | null>(null);
  const [reason,       setReason]       = useState("");
  const [selOp,        setSelOp]        = useState<{ id: string; name: string } | null>(null);
  const [opOverrideEnabled, setOpOverrideEnabled] = useState(false);
  const [opReason,     setOpReason]     = useState("");
  const [opSearch,     setOpSearch]     = useState("");
  const [saving,       setSaving]       = useState(false);

  const operators = useOperatorsStore(s => s.operators);

  const fetchFlags = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/super/feature-flags");
      if (Array.isArray(res)) setFlags(res as ApiFlag[]);
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchFlags().finally(() => setLoading(false));
  }, [fetchFlags]);

  async function onRefresh() {
    setRefreshing(true);
    await fetchFlags();
    setRefreshing(false);
  }

  const grouped = useMemo(() => {
    const map: Record<string, ApiFlag[]> = {};
    flags.forEach(f => {
      const cat = getCategory(f.key, f.category);
      map[cat] = map[cat] ?? [];
      map[cat].push(f);
    });
    return map;
  }, [flags]);

  function handleToggleAttempt(flag: ApiFlag, newEnabled: boolean) {
    if (DANGER_FLAG_KEYS.has(flag.key)) {
      setDangerModal({ flag, newEnabled });
      setReason("");
    } else {
      setReasonModal({ flag, newEnabled });
      setReason("");
    }
  }

  async function confirmToggle(flag: ApiFlag, newEnabled: boolean) {
    if (!reason.trim() || !token || saving) return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/super/feature-flags/${flag.key}`, {
        method: "PATCH",
        body: JSON.stringify({ global_enabled: newEnabled }),
      });
      if (res?.ok !== false) {
        setPrevStates(prev => ({ ...prev, [flag.key]: flag.global_enabled }));
        setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, global_enabled: newEnabled } : f));
      }
    } finally {
      setSaving(false);
      setReasonModal(null);
      setDangerModal(null);
      setReason("");
    }
  }

  async function doRollback() {
    if (!rollbackModal || !reason.trim() || !token || saving) return;
    const prevState = prevStates[rollbackModal.key];
    if (typeof prevState !== "boolean") return;
    setSaving(true);
    try {
      const res = await apiRequest(token, `/super/feature-flags/${rollbackModal.key}`, {
        method: "PATCH",
        body: JSON.stringify({ global_enabled: prevState }),
      });
      if (res?.ok !== false) {
        setFlags(prev => prev.map(f => f.key === rollbackModal.key ? { ...f, global_enabled: prevState } : f));
        setPrevStates(prev => { const n = { ...prev }; delete n[rollbackModal.key]; return n; });
      }
    } finally {
      setSaving(false);
      setRollbackModal(null);
      setReason("");
    }
  }

  async function setOpFlagConfirm() {
    if (!selOp || !overridePanel || !opReason.trim() || !token || saving) return;
    setSaving(true);
    try {
      await apiRequest(token, `/super/feature-flags/${overridePanel.key}/overrides`, {
        method: "POST",
        body: JSON.stringify({ pool_id: selOp.id, enabled: opOverrideEnabled, reason: opReason }),
      });
      setFlags(prev => prev.map(f =>
        f.key === overridePanel.key ? { ...f, override_count: (f.override_count || 0) + 1 } : f
      ));
    } finally {
      setSaving(false);
      setSelOp(null); setOpReason(""); setOverridePanel(null);
    }
  }

  const filteredOps = useMemo(() =>
    operators.filter(op => op.name.includes(opSearch) || op.code.includes(opSearch))
  , [operators, opSearch]);

  const categoryOrder = ['데이터', '구독', '저장공간', '보안', '기능'];

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="기능 플래그" homePath="/(super)/protect-group" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={P} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="기능 플래그" homePath="/(super)/protect-group" />

      <ScrollView
        contentContainerStyle={{ padding: 14, gap: 16, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={onRefresh} />}
      >
        <View style={s.infoBanner}>
          <Info size={13} color="#2EC4B6" />
          <Text style={s.infoBannerTxt}>위험 플래그(🔴)는 변경 시 경고 확인 필수. 모든 변경은 사유 입력 후 감사 로그 기록됩니다. 롤백 버튼으로 이전 상태 복원 가능.</Text>
        </View>

        {categoryOrder.map(cat => {
          const catFlags = grouped[cat];
          if (!catFlags || catFlags.length === 0) return null;
          const cc = CAT_CFG[cat] ?? CAT_CFG.general;
          return (
            <View key={cat} style={s.catSection}>
              <View style={[s.catHeader, { backgroundColor: cc.bg }]}>
                <Text style={[s.catLabel, { color: cc.color }]}>{cat}</Text>
                <Text style={[s.catCount, { color: cc.color }]}>{catFlags.length}개</Text>
              </View>

              {catFlags.map(flag => {
                const isDanger  = DANGER_FLAG_KEYS.has(flag.key);
                const impact    = FLAG_IMPACT[flag.key];
                const rollable  = typeof prevStates[flag.key] === "boolean" && prevStates[flag.key] !== flag.global_enabled;

                return (
                  <View key={flag.key} style={[s.flagCard, isDanger && s.flagCardDanger]}>
                    <View style={s.flagTop}>
                      <View style={{ flex: 1 }}>
                        <View style={s.flagNameRow}>
                          {isDanger && <Text style={s.dangerIcon}>🔴</Text>}
                          <Text style={s.flagName}>{flag.name}</Text>
                          {flag.override_count > 0 && (
                            <View style={s.overrideBadge}>
                              <Text style={s.overrideTxt}>예외 {flag.override_count}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.flagKey}>{flag.key}</Text>
                        <Text style={s.flagDesc}>{flag.description ?? ""}</Text>
                      </View>
                      <Switch
                        value={flag.global_enabled}
                        onValueChange={v => handleToggleAttempt(flag, v)}
                        trackColor={{ false: "#E5E7EB", true: isDanger ? "#FCA5A5" : "#C4B5FD" }}
                        thumbColor={flag.global_enabled ? (isDanger ? DANGER : P) : "#64748B"}
                      />
                    </View>

                    {impact && (
                      <View style={s.impactRow}>
                        <Target size={10} color={impact.riskColor} />
                        <Text style={[s.impactScope, { color: impact.riskColor }]}>{impact.scope}</Text>
                        <View style={[s.riskBadge, { backgroundColor: impact.riskColor + "20" }]}>
                          <Text style={[s.riskBadgeTxt, { color: impact.riskColor }]}>위험도 {impact.risk}</Text>
                        </View>
                      </View>
                    )}

                    <View style={s.flagMeta}>
                      <Text style={s.flagMetaTxt}>{relStr(flag.updated_at)} · {flag.updated_by ?? "—"}</Text>
                      {flag.reason ? <Text style={s.flagReason} numberOfLines={1}>{flag.reason}</Text> : null}
                    </View>

                    {rollable && (
                      <View style={s.rollbackRow}>
                        <Text style={s.rollbackHint}>
                          이전 상태: {prevStates[flag.key] ? '활성' : '비활성'} → 현재: {flag.global_enabled ? '활성' : '비활성'}
                        </Text>
                        <Pressable style={s.rollbackBtn} onPress={() => { setRollbackModal(flag); setReason(""); }}>
                          <RotateCcw size={11} color={P} />
                          <Text style={s.rollbackBtnTxt}>롤백</Text>
                        </Pressable>
                      </View>
                    )}

                    <Pressable style={s.overrideBtn} onPress={() => { setOverridePanel(flag); setSelOp(null); setOpReason(""); setOpOverrideEnabled(flag.global_enabled); }}>
                      <Users size={11} color="#64748B" />
                      <Text style={s.overrideBtnTxt}>운영자별 예외 설정</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {reasonModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setReasonModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setReasonModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{reasonModal.flag.name} {reasonModal.newEnabled ? '활성화' : '비활성화'}</Text>
              <Text style={m.sub}>{reasonModal.flag.key}</Text>
              <Text style={m.label}>변경 사유 (필수)</Text>
              <TextInput style={m.reasonInput} value={reason} onChangeText={setReason}
                placeholder="변경 사유를 입력하세요" placeholderTextColor="#64748B"
                multiline autoFocus />
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setReasonModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.confirmBtn, { opacity: (reason.trim() && !saving) ? 1 : 0.4 }]}
                  disabled={!reason.trim() || saving} onPress={() => confirmToggle(reasonModal.flag, reasonModal.newEnabled)}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.confirmTxt}>확인</Text>}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {dangerModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setDangerModal(null)}>
          <Pressable style={m.backdrop} onPress={() => {}}>
            <View style={m.sheet}>
              <View style={m.handle} />
              <View style={m.dangerHeaderRow}>
                <Text style={m.dangerIcon}>🔴</Text>
                <Text style={[m.title, { color: DANGER }]}>위험 플래그 변경</Text>
              </View>
              <Text style={m.dangerDesc}>
                <Text style={{ fontFamily: "Pretendard-Regular" }}>{dangerModal.flag.name}</Text> 은(는) 전체 시스템에 영향을 미치는 위험 플래그입니다.{"\n"}
                {FLAG_IMPACT[dangerModal.flag.key]?.scope && `영향 범위: ${FLAG_IMPACT[dangerModal.flag.key].scope}\n`}
                변경 내용을 신중히 검토하고 사유를 기록하세요.
              </Text>
              <Text style={m.label}>변경 사유 (필수)</Text>
              <TextInput style={[m.reasonInput, { borderColor: DANGER }]}
                value={reason} onChangeText={setReason}
                placeholder="위험 플래그 변경 사유를 상세히 입력하세요"
                placeholderTextColor="#64748B" multiline autoFocus />
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setDangerModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.dangerBtn, { opacity: (reason.trim() && !saving) ? 1 : 0.4 }]}
                  disabled={!reason.trim() || saving} onPress={() => confirmToggle(dangerModal.flag, dangerModal.newEnabled)}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                    <>
                      <TriangleAlert size={14} color="#fff" />
                      <Text style={m.dangerBtnTxt}>{dangerModal.newEnabled ? '활성화' : '비활성화'} 확인</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Modal>
      )}

      {rollbackModal && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setRollbackModal(null)}>
          <Pressable style={m.backdrop} onPress={() => setRollbackModal(null)}>
            <Pressable style={m.sheet} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>플래그 롤백</Text>
              <Text style={m.sub}>{rollbackModal.name} ({rollbackModal.key})</Text>
              <View style={m.rollbackInfo}>
                <Text style={m.rollbackInfoTxt}>
                  현재: <Text style={{ fontFamily: "Pretendard-Regular" }}>{rollbackModal.global_enabled ? '활성' : '비활성'}</Text>
                  {"  →  "}
                  롤백 후: <Text style={{ fontFamily: "Pretendard-Regular", color: P }}>{prevStates[rollbackModal.key] ? '활성' : '비활성'}</Text>
                </Text>
              </View>
              <Text style={m.label}>롤백 사유 (필수)</Text>
              <TextInput style={m.reasonInput} value={reason} onChangeText={setReason}
                placeholder="롤백 사유를 입력하세요" placeholderTextColor="#64748B" autoFocus />
              <View style={m.btnRow}>
                <Pressable style={m.cancelBtn} onPress={() => setRollbackModal(null)}>
                  <Text style={m.cancelTxt}>취소</Text>
                </Pressable>
                <Pressable style={[m.rollbackExecBtn, { opacity: (reason.trim() && !saving) ? 1 : 0.4 }]}
                  disabled={!reason.trim() || saving} onPress={doRollback}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                    <>
                      <RotateCcw size={14} color="#fff" />
                      <Text style={m.confirmTxt}>롤백 실행</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {overridePanel && (
        <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={() => setOverridePanel(null)}>
          <Pressable style={m.backdrop} onPress={() => setOverridePanel(null)}>
            <Pressable style={[m.sheet, { maxHeight: "90%" }]} onPress={() => {}}>
              <View style={m.handle} />
              <Text style={m.title}>{overridePanel.name}</Text>
              <Text style={m.sub}>운영자별 예외 설정</Text>

              <TextInput style={m.searchInput} value={opSearch} onChangeText={setOpSearch}
                placeholder="운영자 검색" placeholderTextColor="#64748B" />

              <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                {filteredOps.slice(0, 12).map(op => (
                  <Pressable key={op.id} style={[m.opRow, selOp?.id === op.id && m.opRowActive]}
                    onPress={() => setSelOp({ id: op.id, name: op.name })}>
                    <Text style={[m.opRowTxt, selOp?.id === op.id && { color: P }]}>{op.name}</Text>
                    <Text style={m.opRowCode}>{op.code}</Text>
                    {selOp?.id === op.id && <Check size={14} color={P} />}
                  </Pressable>
                ))}
              </ScrollView>

              {selOp && (
                <>
                  <View style={m.toggleRow}>
                    <Text style={m.toggleLabel}>{selOp.name} — {overridePanel.name}</Text>
                    <Switch value={opOverrideEnabled} onValueChange={setOpOverrideEnabled}
                      trackColor={{ false: "#E5E7EB", true: "#C4B5FD" }}
                      thumbColor={opOverrideEnabled ? P : "#64748B"} />
                  </View>
                  <TextInput style={m.reasonInput} value={opReason} onChangeText={setOpReason}
                    placeholder="예외 설정 사유 (필수)" placeholderTextColor="#64748B" />
                  <View style={m.btnRow}>
                    <Pressable style={m.cancelBtn} onPress={() => setOverridePanel(null)}>
                      <Text style={m.cancelTxt}>취소</Text>
                    </Pressable>
                    <Pressable style={[m.confirmBtn, { opacity: (opReason.trim() && !saving) ? 1 : 0.4 }]}
                      disabled={!opReason.trim() || saving} onPress={setOpFlagConfirm}>
                      {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={m.confirmTxt}>적용</Text>}
                    </Pressable>
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.background },
  infoBanner:    { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#E0F2FE",
                   padding: 12, borderRadius: 12, borderWidth: 1, borderColor: "#BAE6FD" },
  infoBannerTxt: { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0369A1", lineHeight: 17 },
  catSection:    { gap: 8 },
  catHeader:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                   paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  catLabel:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  catCount:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  flagCard:      { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8,
                   shadowColor: "#0000001A", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  flagCardDanger:{ borderWidth: 1, borderColor: "#FCA5A5" },
  flagTop:       { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  flagNameRow:   { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  dangerIcon:    { fontSize: 12 },
  flagName:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  overrideBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#EEDDF5" },
  overrideTxt:   { fontSize: 10, fontFamily: "Pretendard-Regular", color: P },
  flagKey:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  flagDesc:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2, lineHeight: 17 },
  impactRow:     { flexDirection: "row", alignItems: "center", gap: 6 },
  impactScope:   { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular" },
  riskBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  riskBadgeTxt:  { fontSize: 10, fontFamily: "Pretendard-Regular" },
  flagMeta:      { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  flagMetaTxt:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  flagReason:    { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B",
                   fontStyle: "italic", backgroundColor: "#F1F5F9", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  rollbackRow:   { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EEDDF5",
                   paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9 },
  rollbackHint:  { flex: 1, fontSize: 11, fontFamily: "Pretendard-Regular", color: "#5B21B6" },
  rollbackBtn:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4,
                   borderRadius: 7, backgroundColor: "#fff", borderWidth: 1, borderColor: P },
  rollbackBtnTxt:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: P },
  overrideBtn:   { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start",
                   paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#FFFFFF" },
  overrideBtnTxt:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const m = StyleSheet.create({
  backdrop:      { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:         { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                   borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40, gap: 10 },
  handle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  title:         { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:           { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: -6 },
  label:         { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  reasonInput:   { backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10,
                   fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", minHeight: 60 },
  searchInput:   { backgroundColor: "#F1F5F9", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  btnRow:        { flexDirection: "row", gap: 8 },
  cancelBtn:     { flex: 1, padding: 13, borderRadius: 10, backgroundColor: "#FFFFFF", alignItems: "center" },
  cancelTxt:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#64748B" },
  confirmBtn:    { flex: 1, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center" },
  confirmTxt:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  dangerHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 8 },
  dangerIcon:    { fontSize: 18 },
  dangerDesc:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", lineHeight: 20 },
  dangerBtn:     { flex: 1, padding: 13, borderRadius: 10, backgroundColor: DANGER, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  dangerBtnTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  rollbackInfo:  { backgroundColor: "#EEDDF5", borderRadius: 8, padding: 10 },
  rollbackInfoTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#5B21B6" },
  rollbackExecBtn:{ flex: 1, padding: 13, borderRadius: 10, backgroundColor: P, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6 },
  opRow:         { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  opRowActive:   { backgroundColor: "#EEDDF5", borderRadius: 8 },
  opRowTxt:      { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  opRowCode:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  toggleRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  toggleLabel:   { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
});
