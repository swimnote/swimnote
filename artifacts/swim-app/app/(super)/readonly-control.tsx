/**
 * (super)/readonly-control.tsx — 읽기전용 제어
 * 3단계: 플랫폼 전체 / 운영자별 / 기능별
 * /super/readonly-control API 실데이터 연결
 */
import { Activity, Globe, ToggleLeft, TriangleAlert, Unlock, Users } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface OperatorReadonly {
  id: string;
  name: string;
  owner_name: string | null;
  is_readonly: boolean;
  readonly_reason: string | null;
  subscription_status: string | null;
}

interface FeatureReadonly {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  global_enabled: boolean;
}

interface ReadonlyLog {
  id: string;
  scope: string;
  target_id: string | null;
  target_name: string | null;
  feature_key: string | null;
  enabled: boolean;
  reason: string | null;
  actor_name: string;
  created_at: string;
}

interface ReadonlyData {
  platform_readonly: boolean;
  operators_readonly: OperatorReadonly[];
  feature_readonly: FeatureReadonly[];
  recent_logs: ReadonlyLog[];
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function PlatformSection({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (reason: string) => Promise<void>;
}) {
  const [showModal, setShowModal] = useState(false);
  const [inputReason, setInputReason] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <View style={[ps.card, enabled && ps.cardActive]}>
      <View style={ps.top}>
        <View style={[ps.iconBox, { backgroundColor: enabled ? "#F9DEDA" : "#FFFFFF" }]}>
          <Globe size={20} color={enabled ? "#D96C6C" : "#64748B"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ps.title}>플랫폼 전체 읽기전용</Text>
          <Text style={ps.sub}>모든 운영자의 쓰기 기능을 일시 중단합니다</Text>
        </View>
        <View style={[ps.badge, { backgroundColor: enabled ? "#F9DEDA" : "#E6FFFA" }]}>
          <Text style={[ps.badgeTxt, { color: enabled ? "#D96C6C" : "#2EC4B6" }]}>
            {enabled ? "활성화 중" : "정상 운영"}
          </Text>
        </View>
      </View>

      {enabled && (
        <View style={ps.warningBanner}>
          <TriangleAlert size={14} color="#D96C6C" />
          <Text style={ps.warningTxt}>플랫폼 전체가 읽기전용 상태입니다. 모든 운영자의 데이터 입력이 차단됩니다.</Text>
        </View>
      )}

      <Pressable
        style={[ps.btn, enabled ? { backgroundColor: "#E6FFFA" } : { backgroundColor: "#F9DEDA" }]}
        onPress={() => { setInputReason(""); setShowModal(true); }}>
        <LucideIcon name={enabled ? "unlock" : "lock"} size={14} color={enabled ? "#2EC4B6" : "#D96C6C"} />
        <Text style={[ps.btnTxt, { color: enabled ? "#2EC4B6" : "#D96C6C" }]}>
          {enabled ? "읽기전용 해제" : "읽기전용 활성화"}
        </Text>
      </Pressable>

      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <Pressable style={pm.overlay} onPress={() => setShowModal(false)}>
          <Pressable style={pm.sheet} onPress={() => {}}>
            <Text style={pm.title}>{enabled ? "읽기전용 해제" : "플랫폼 전체 읽기전용 활성화"}</Text>
            {!enabled && (
              <View style={pm.warningBox}>
                <TriangleAlert size={16} color="#D97706" />
                <Text style={pm.warningTxt}>모든 운영자의 쓰기 기능이 즉시 차단됩니다.</Text>
              </View>
            )}
            <Text style={pm.label}>사유 입력 (필수)</Text>
            <TextInput
              style={pm.input}
              value={inputReason}
              onChangeText={setInputReason}
              placeholder="변경 사유를 입력하세요"
              multiline numberOfLines={3}
              textAlignVertical="top"
              placeholderTextColor="#64748B"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[pm.actionBtn, { flex: 1, backgroundColor: "#FFFFFF" }]}
                onPress={() => { setShowModal(false); setInputReason(""); }}>
                <Text style={{ color: "#0F172A", fontFamily: "Pretendard-Regular" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[pm.actionBtn, { flex: 1, backgroundColor: enabled ? "#2EC4B6" : "#D96C6C" },
                  (!inputReason.trim() || saving) && { opacity: 0.4 }]}
                onPress={async () => {
                  if (!inputReason.trim() || saving) return;
                  setSaving(true);
                  await onToggle(inputReason);
                  setSaving(false);
                  setShowModal(false);
                  setInputReason("");
                }}
                disabled={!inputReason.trim() || saving}>
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: "#fff", fontFamily: "Pretendard-Regular" }}>확인</Text>
                }
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const ps = StyleSheet.create({
  card:          { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  cardActive:    { borderColor: "#D96C6C", borderWidth: 2, backgroundColor: "#FFF5F5" },
  top:           { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  iconBox:       { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title:         { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:           { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  badge:         { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTxt:      { fontSize: 11, fontFamily: "Pretendard-Regular" },
  warningBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#F9DEDA", borderRadius: 8, padding: 10, marginBottom: 8 },
  warningTxt:    { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#991B1B", lineHeight: 18 },
  btn:           { borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 12 },
  btnTxt:        { fontSize: 13, fontFamily: "Pretendard-Regular" },
});

const pm = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title:      { fontSize: 16, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 12 },
  warningBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF1BF", borderRadius: 8, padding: 10, marginBottom: 12 },
  warningTxt: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#92400E" },
  label:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 6 },
  input:      { backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A", height: 80 },
  actionBtn:  { borderRadius: 8, padding: 12, alignItems: "center" },
});

export default function ReadonlyControlScreen() {
  const { adminUser, token } = useAuth();
  const [data, setData]       = useState<ReadonlyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/super/readonly-control");
      if (!res.ok) { setError("데이터를 불러오지 못했습니다"); return; }
      const d = await res.json();
      if (d?.error) { setError(d.error); return; }
      setData(d as ReadonlyData);
      setError(null);
    } catch {
      setError("데이터를 불러오지 못했습니다");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  async function onRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  async function togglePlatform(reason: string) {
    if (!token || !data) return;
    const newEnabled = !data.platform_readonly;
    try {
      const res = await apiRequest(token, "/super/readonly-control", {
        method: "POST",
        body: JSON.stringify({ scope: "platform", enabled: newEnabled, reason }),
      });
      if (res.ok) {
        setData(prev => prev ? { ...prev, platform_readonly: newEnabled } : prev);
        await fetchData();
      } else {
        const d = await res.json().catch(() => ({}));
        Alert.alert("오류", d?.error ?? "변경에 실패했습니다");
      }
    } catch {
      Alert.alert("오류", "네트워크 오류가 발생했습니다");
    }
  }

  async function releaseOperator(op: OperatorReadonly) {
    Alert.alert(
      "읽기전용 해제",
      `'${op.name}'의 읽기전용을 해제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제",
          onPress: async () => {
            if (!token) return;
            try {
              const res = await apiRequest(token, "/super/readonly-control", {
                method: "POST",
                body: JSON.stringify({ scope: "operator", target_id: op.id, enabled: false, reason: "수동 해제" }),
              });
              if (res.ok) { await fetchData(); }
              else {
                const d = await res.json().catch(() => ({}));
                Alert.alert("오류", d?.error ?? "해제에 실패했습니다");
              }
            } catch {
              Alert.alert("오류", "네트워크 오류가 발생했습니다");
            }
          },
        },
      ]
    );
  }

  const SCOPE_INFO = [
    { scope: "플랫폼 전체", color: "#D96C6C", bg: "#F9DEDA", icon: "globe" as const, desc: "모든 운영자에 동시 적용. 긴급 상황 시 사용." },
    { scope: "운영자별",    color: "#D97706", bg: "#FFF1BF", icon: "users" as const, desc: "특정 운영자의 쓰기 기능만 차단. 개별 조치 시 사용." },
    { scope: "기능별",      color: "#2EC4B6", bg: "#E6FFFA", icon: "toggle-left" as const, desc: "기능 플래그와 연동. 특정 기능 읽기전용 전환." },
  ];

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <SubScreenHeader title="읽기전용 제어" subtitle="3단계 읽기전용 제어 시스템" homePath="/(super)/protect-group" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={P} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="읽기전용 제어" subtitle="3단계 읽기전용 제어 시스템" homePath="/(super)/protect-group" />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P} onRefresh={onRefresh} />}>

        {error && (
          <View style={{ backgroundColor: "#F9DEDA", padding: 12, borderRadius: 10 }}>
            <Text style={{ color: "#D96C6C", fontSize: 13, fontFamily: "Pretendard-Regular" }}>{error}</Text>
          </View>
        )}

        <View style={s.scopeRow}>
          {SCOPE_INFO.map(info => (
            <View key={info.scope} style={[s.scopeCard, { borderTopColor: info.color, borderTopWidth: 3 }]}>
              <View style={[s.scopeIcon, { backgroundColor: info.bg }]}>
                <LucideIcon name={info.icon} size={14} color={info.color} />
              </View>
              <Text style={s.scopeLabel}>{info.scope}</Text>
              <Text style={s.scopeDesc}>{info.desc}</Text>
            </View>
          ))}
        </View>

        <PlatformSection
          enabled={data?.platform_readonly ?? false}
          onToggle={togglePlatform}
        />

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Users size={15} color="#D97706" />
            <Text style={s.sectionTitle}>운영자별 읽기전용</Text>
            <View style={[s.countBadge, { backgroundColor: (data?.operators_readonly?.length ?? 0) > 0 ? "#FFF1BF" : "#FFFFFF" }]}>
              <Text style={[s.countTxt, { color: (data?.operators_readonly?.length ?? 0) > 0 ? "#D97706" : "#64748B" }]}>
                {data?.operators_readonly?.length ?? 0}개
              </Text>
            </View>
          </View>

          {!data?.operators_readonly?.length ? (
            <View style={s.emptyRow}>
              <Text style={s.emptyTxt}>읽기전용 운영자 없음</Text>
            </View>
          ) : (
            data.operators_readonly.map(op => (
              <View key={op.id} style={or.row}>
                <View style={{ flex: 1 }}>
                  <Text style={or.name}>{op.name}</Text>
                  {op.owner_name && <Text style={or.sub}>{op.owner_name}</Text>}
                  {op.readonly_reason && <Text style={[or.sub, { color: "#D97706" }]}>{op.readonly_reason}</Text>}
                </View>
                <Pressable style={or.releaseBtn} onPress={() => releaseOperator(op)}>
                  <Unlock size={12} color="#2EC4B6" />
                  <Text style={or.releaseTxt}>해제</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <ToggleLeft size={15} color="#2EC4B6" />
            <Text style={s.sectionTitle}>기능별 읽기전용 (기능 플래그)</Text>
          </View>
          {!data?.feature_readonly?.filter(f => !f.global_enabled).length ? (
            <View style={s.emptyRow}>
              <Text style={s.emptyTxt}>비활성화된 기능 플래그 없음</Text>
            </View>
          ) : (
            data!.feature_readonly.filter(f => !f.global_enabled).map(f => (
              <View key={f.key} style={or.row}>
                <View style={{ flex: 1 }}>
                  <Text style={or.name}>{f.name}</Text>
                  <Text style={or.sub}>{f.description ?? ""}</Text>
                </View>
                <View style={[lr.badge, { backgroundColor: "#F9DEDA" }]}>
                  <Text style={[lr.badgeTxt, { color: "#D96C6C" }]}>비활성</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Activity size={15} color="#64748B" />
            <Text style={s.sectionTitle}>최근 읽기전용 제어 로그</Text>
          </View>
          {!data?.recent_logs?.length ? (
            <View style={s.emptyRow}>
              <Text style={s.emptyTxt}>로그 없음</Text>
            </View>
          ) : (
            data.recent_logs.map(log => {
              const isActivate = log.enabled;
              return (
                <View key={log.id} style={lr.row}>
                  <View style={[lr.dot, { backgroundColor: isActivate ? "#D96C6C" : "#2EC4B6" }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={lr.desc} numberOfLines={1}>
                      {log.scope === "platform" ? "플랫폼 전체" : log.target_name ?? log.feature_key ?? log.target_id} — {isActivate ? "활성화" : "해제"}
                    </Text>
                    <Text style={lr.time}>{log.actor_name} · {fmtRelative(log.created_at)}</Text>
                    {log.reason && <Text style={[lr.time, { color: "#D97706" }]} numberOfLines={1}>{log.reason}</Text>}
                  </View>
                  <View style={[lr.badge, { backgroundColor: isActivate ? "#F9DEDA" : "#E6FFFA" }]}>
                    <Text style={[lr.badgeTxt, { color: isActivate ? "#D96C6C" : "#2EC4B6" }]}>
                      {isActivate ? "활성화" : "해제"}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F1F5F9" },
  scopeRow:     { flexDirection: "row", gap: 8 },
  scopeCard:    { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#E5E7EB" },
  scopeIcon:    { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  scopeLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 4 },
  scopeDesc:    { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", lineHeight: 14 },
  section:      { backgroundColor: "#fff", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#E5E7EB" },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  countBadge:   { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countTxt:     { fontSize: 11, fontFamily: "Pretendard-Regular" },
  emptyRow:     { paddingVertical: 16, alignItems: "center" },
  emptyTxt:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
});

const or = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  name:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  releaseBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#E6FFFA", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  releaseTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#2EC4B6" },
});

const lr = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#FFFFFF" },
  dot:      { width: 8, height: 8, borderRadius: 4 },
  desc:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  time:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  badge:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular" },
});
