/**
 * (super)/readonly-control.tsx — 읽기전용 제어
 * 3단계: 플랫폼 전체 / 운영자별 / 기능별
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useReadonlyStore } from "@/store";
import { fmtRelative, createAuditLog } from "@/utils/super-utils";

const P = "#7C3AED";

type Scope = "platform" | "operator" | "feature";

interface ControlData {
  platform_readonly: boolean;
  operators_readonly: any[];
  feature_readonly: any[];
  recent_logs: any[];
}

// ── 플랫폼 전체 읽기전용 섹션 ────────────────────────────────────
function PlatformSection({
  enabled,
  onToggle,
  loading,
}: {
  enabled: boolean;
  onToggle: (reason: string) => void;
  loading: boolean;
}) {
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <View style={[ps.card, enabled && ps.cardActive]}>
      <View style={ps.top}>
        <View style={[ps.iconBox, { backgroundColor: enabled ? "#FEE2E2" : "#F3F4F6" }]}>
          <Feather name="globe" size={20} color={enabled ? "#DC2626" : "#6B7280"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ps.title}>플랫폼 전체 읽기전용</Text>
          <Text style={ps.sub}>모든 운영자의 쓰기 기능을 일시 중단합니다</Text>
        </View>
        <View style={[ps.badge, { backgroundColor: enabled ? "#FEE2E2" : "#D1FAE5" }]}>
          <Text style={[ps.badgeTxt, { color: enabled ? "#DC2626" : "#059669" }]}>
            {enabled ? "활성화 중" : "정상 운영"}
          </Text>
        </View>
      </View>

      {enabled && (
        <View style={ps.warningBanner}>
          <Feather name="alert-triangle" size={14} color="#DC2626" />
          <Text style={ps.warningTxt}>플랫폼 전체가 읽기전용 상태입니다. 모든 운영자의 데이터 입력이 차단됩니다.</Text>
        </View>
      )}

      <Pressable
        style={[ps.btn, enabled ? { backgroundColor: "#D1FAE5" } : { backgroundColor: "#FEE2E2" }]}
        onPress={() => setShowModal(true)}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={enabled ? "#059669" : "#DC2626"} />
        ) : (
          <>
            <Feather name={enabled ? "unlock" : "lock"} size={14} color={enabled ? "#059669" : "#DC2626"} />
            <Text style={[ps.btnTxt, { color: enabled ? "#059669" : "#DC2626" }]}>
              {enabled ? "읽기전용 해제" : "읽기전용 활성화"}
            </Text>
          </>
        )}
      </Pressable>

      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <Pressable style={pm.overlay} onPress={() => setShowModal(false)}>
          <Pressable style={pm.sheet} onPress={() => {}}>
            <Text style={pm.title}>{enabled ? "읽기전용 해제" : "플랫폼 전체 읽기전용 활성화"}</Text>
            {!enabled && (
              <View style={pm.warningBox}>
                <Feather name="alert-triangle" size={16} color="#D97706" />
                <Text style={pm.warningTxt}>모든 운영자의 쓰기 기능이 즉시 차단됩니다.</Text>
              </View>
            )}
            <Text style={pm.label}>사유 입력 (필수)</Text>
            <TextInput
              style={pm.input}
              value={reason}
              onChangeText={setReason}
              placeholder="변경 사유를 입력하세요"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[pm.actionBtn, { flex: 1, backgroundColor: "#F3F4F6" }]}
                onPress={() => { setShowModal(false); setReason(""); }}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[pm.actionBtn, { flex: 1, backgroundColor: enabled ? "#059669" : "#DC2626" },
                  !reason.trim() && { opacity: 0.4 }]}
                onPress={() => {
                  if (!reason.trim()) return;
                  onToggle(reason);
                  setShowModal(false);
                  setReason("");
                }}
                disabled={!reason.trim()}
              >
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const ps = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 12,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  cardActive:  { borderColor: "#DC2626", borderWidth: 2, backgroundColor: "#FFF5F5" },
  top:         { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  iconBox:     { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  sub:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  badge:       { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTxt:    { fontSize: 11, fontFamily: "Inter_700Bold" },
  warningBanner:{ flexDirection: "row", alignItems: "flex-start", gap: 8,
                  backgroundColor: "#FEE2E2", borderRadius: 8, padding: 10, marginBottom: 12 },
  warningTxt:  { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#991B1B", lineHeight: 18 },
  btn:         { borderRadius: 10, flexDirection: "row", alignItems: "center",
                 justifyContent: "center", gap: 6, padding: 12 },
  btnTxt:      { fontSize: 13, fontFamily: "Inter_700Bold" },
});

const pm = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet:      { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  title:      { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 12 },
  warningBox: { flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: "#FEF3C7", borderRadius: 8, padding: 10, marginBottom: 12 },
  warningTxt: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#92400E" },
  label:      { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#374151", marginBottom: 6 },
  input:      { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#D1D5DB",
                borderRadius: 8, padding: 10, fontSize: 13, fontFamily: "Inter_400Regular",
                color: "#111827", height: 80 },
  actionBtn:  { borderRadius: 8, padding: 12, alignItems: "center" },
});

// ── 운영자별 읽기전용 행 ──────────────────────────────────────────
function OperatorRow({ op, onRelease }: { op: any; onRelease: (id: string, name: string) => void }) {
  return (
    <View style={or.row}>
      <View style={{ flex: 1 }}>
        <Text style={or.name}>{op.name ?? "—"}</Text>
        <Text style={or.sub}>{op.owner_name ?? ""}{op.readonly_reason ? ` · ${op.readonly_reason}` : ""}</Text>
      </View>
      <Pressable style={or.releaseBtn} onPress={() => onRelease(op.id, op.name)}>
        <Feather name="unlock" size={12} color="#059669" />
        <Text style={or.releaseTxt}>해제</Text>
      </Pressable>
    </View>
  );
}

const or = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  name:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  sub:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  releaseBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#D1FAE5",
                borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6 },
  releaseTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#059669" },
});

// ── 최근 로그 행 ──────────────────────────────────────────────────
function LogRow({ log }: { log: any }) {
  return (
    <View style={lr.row}>
      <View style={[lr.dot, { backgroundColor: log.enabled ? "#DC2626" : "#059669" }]} />
      <View style={{ flex: 1 }}>
        <Text style={lr.desc} numberOfLines={1}>{log.scope} · {log.reason ?? "사유 없음"}</Text>
        <Text style={lr.time}>{log.actor_name} · {fmtRelative(log.created_at)}</Text>
      </View>
      <View style={[lr.badge, { backgroundColor: log.enabled ? "#FEE2E2" : "#D1FAE5" }]}>
        <Text style={[lr.badgeTxt, { color: log.enabled ? "#DC2626" : "#059669" }]}>
          {log.enabled ? "활성화" : "해제"}
        </Text>
      </View>
    </View>
  );
}

const lr = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
              borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  dot:      { width: 8, height: 8, borderRadius: 4 },
  desc:     { fontSize: 12, fontFamily: "Inter_500Medium", color: "#374151" },
  time:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  badge:    { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontFamily: "Inter_700Bold" },
});

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function ReadonlyControlScreen() {
  const { token, adminUser } = useAuth();
  const { platformReadonly, setPlatformReadonly } = useReadonlyStore();
  const [data, setData] = useState<ControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest(token, "/super/readonly-control");
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setPlatformReadonly(d.platform_readonly);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, []);

  async function togglePlatform(reason: string) {
    setToggling(true);
    const newEnabled = !platformReadonly;
    try {
      const res = await apiRequest(token, "/super/readonly-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "platform", enabled: newEnabled, reason }),
      });
      if (res.ok) {
        setPlatformReadonly(newEnabled, reason);
        await createAuditLog(token, apiRequest, {
          category: "읽기전용",
          title: `플랫폼 전체 읽기전용 ${newEnabled ? "활성화" : "해제"}`,
          actor: adminUser?.name ?? "슈퍼관리자",
          impact: "critical",
          reason,
        });
        load();
      }
    } catch {}
    finally { setToggling(false); }
  }

  async function releaseOperator(id: string, name: string) {
    Alert.alert(
      "읽기전용 해제",
      `'${name}'의 읽기전용을 해제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "해제",
          onPress: async () => {
            try {
              await apiRequest(token, "/super/readonly-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope: "operator", target_id: id, enabled: false, reason: "수동 해제" }),
              });
              await createAuditLog(token, apiRequest, {
                category: "읽기전용",
                title: `운영자 읽기전용 해제: ${name}`,
                actor: adminUser?.name ?? "슈퍼관리자",
                impact: "medium",
                reason: "수동 해제",
              });
              load();
            } catch {}
          },
        },
      ]
    );
  }

  const SCOPE_INFO = [
    {
      scope: "플랫폼 전체", color: "#DC2626", bg: "#FEE2E2", icon: "globe" as const,
      desc: "모든 운영자에 동시 적용. 긴급 상황 시 사용.",
    },
    {
      scope: "운영자별", color: "#D97706", bg: "#FEF3C7", icon: "users" as const,
      desc: "특정 운영자의 쓰기 기능만 차단. 개별 조치 시 사용.",
    },
    {
      scope: "기능별", color: "#4F46E5", bg: "#EEF2FF", icon: "toggle-left" as const,
      desc: "기능 플래그와 연동. 특정 기능 읽기전용 전환.",
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="읽기전용 제어" subtitle="3단계 읽기전용 제어 시스템" />

      {loading && !refreshing ? (
        <ActivityIndicator color={P} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* 3단계 설명 */}
          <View style={s.scopeRow}>
            {SCOPE_INFO.map((info) => (
              <View key={info.scope} style={[s.scopeCard, { borderTopColor: info.color, borderTopWidth: 3 }]}>
                <View style={[s.scopeIcon, { backgroundColor: info.bg }]}>
                  <Feather name={info.icon} size={14} color={info.color} />
                </View>
                <Text style={s.scopeLabel}>{info.scope}</Text>
                <Text style={s.scopeDesc}>{info.desc}</Text>
              </View>
            ))}
          </View>

          {/* 플랫폼 전체 */}
          <PlatformSection
            enabled={platformReadonly}
            onToggle={togglePlatform}
            loading={toggling}
          />

          {/* 운영자별 읽기전용 목록 */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="users" size={15} color="#D97706" />
              <Text style={s.sectionTitle}>운영자별 읽기전용</Text>
              <View style={[s.countBadge, { backgroundColor: (data?.operators_readonly?.length ?? 0) > 0 ? "#FEF3C7" : "#F3F4F6" }]}>
                <Text style={[s.countTxt, { color: (data?.operators_readonly?.length ?? 0) > 0 ? "#D97706" : "#9CA3AF" }]}>
                  {data?.operators_readonly?.length ?? 0}개
                </Text>
              </View>
            </View>

            {(data?.operators_readonly?.length ?? 0) === 0 ? (
              <View style={s.emptyRow}>
                <Text style={s.emptyTxt}>읽기전용 운영자 없음</Text>
              </View>
            ) : (
              data?.operators_readonly?.map((op) => (
                <OperatorRow key={op.id} op={op} onRelease={releaseOperator} />
              ))
            )}
          </View>

          {/* 기능별 읽기전용 */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="toggle-left" size={15} color="#4F46E5" />
              <Text style={s.sectionTitle}>기능별 읽기전용 (기능 플래그)</Text>
            </View>
            {(data?.feature_readonly?.length ?? 0) === 0 ? (
              <View style={s.emptyRow}>
                <Text style={s.emptyTxt}>읽기전용 기능 플래그 없음</Text>
              </View>
            ) : (
              data?.feature_readonly?.map((f) => (
                <View key={f.key} style={or.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={or.name}>{f.name}</Text>
                    <Text style={or.sub}>{f.description ?? ""}</Text>
                  </View>
                  <View style={[lr.badge, { backgroundColor: f.global_enabled ? "#D1FAE5" : "#F3F4F6" }]}>
                    <Text style={[lr.badgeTxt, { color: f.global_enabled ? "#059669" : "#9CA3AF" }]}>
                      {f.global_enabled ? "활성" : "비활성"}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* 최근 제어 로그 */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="activity" size={15} color="#6B7280" />
              <Text style={s.sectionTitle}>최근 제어 로그</Text>
            </View>
            {(data?.recent_logs?.length ?? 0) === 0 ? (
              <View style={s.emptyRow}>
                <Text style={s.emptyTxt}>로그 없음</Text>
              </View>
            ) : (
              data?.recent_logs?.slice(0, 10).map((log) => (
                <LogRow key={log.id} log={log} />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F9FAFB" },
  scopeRow:     { flexDirection: "row", gap: 8 },
  scopeCard:    { flex: 1, backgroundColor: "#fff", borderRadius: 10, padding: 10,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  scopeIcon:    { width: 28, height: 28, borderRadius: 8, alignItems: "center",
                  justifyContent: "center", marginBottom: 6 },
  scopeLabel:   { fontSize: 11, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 4 },
  scopeDesc:    { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 14 },
  section:      { backgroundColor: "#fff", borderRadius: 14, padding: 16,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", flex: 1 },
  countBadge:   { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countTxt:     { fontSize: 11, fontFamily: "Inter_700Bold" },
  emptyRow:     { paddingVertical: 16, alignItems: "center" },
  emptyTxt:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
});
