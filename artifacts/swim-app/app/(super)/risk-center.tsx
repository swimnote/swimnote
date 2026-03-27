/**
 * (super)/risk-center.tsx — 장애·리스크 센터
 * Zustand 완전 제거 → GET /super/risk-center 실 API 연동
 * 모크 데이터(RECOVERY_FAILURES, SMS) 제거 / external_services API 반환값 사용
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import Colors from "@/constants/colors";

const C = Colors.light;
const P = "#7C3AED";

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const h = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function hoursLeftStr(hoursLeft: number | string | null | undefined): string {
  const h = typeof hoursLeft === "string" ? parseFloat(hoursLeft) : (hoursLeft ?? 0);
  if (isNaN(h) || h < 0) return "만료됨";
  if (h < 1) return "1시간 미만";
  return `${Math.round(h)}시간 후`;
}

interface RiskGroupProps {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string; bg: string;
  count: number;
  children: React.ReactNode;
  onViewAll?: () => void;
}

function RiskGroup({ title, icon, color, bg, count, children, onViewAll }: RiskGroupProps) {
  if (count === 0) return null;
  return (
    <View style={g.group}>
      <View style={g.groupHeader}>
        <View style={[g.groupIcon, { backgroundColor: bg }]}>
          <Feather name={icon} size={14} color={color} />
        </View>
        <Text style={g.groupTitle}>{title}</Text>
        <View style={[g.countBadge, { backgroundColor: bg }]}>
          <Text style={[g.countTxt, { color }]}>{count}</Text>
        </View>
        {onViewAll && (
          <Pressable onPress={onViewAll} style={{ marginLeft: "auto" }}>
            <Text style={[g.viewAll, { color }]}>전체 보기</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

export default function RiskCenterScreen() {
  const { token, adminUser } = useAuth() as any;
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const [paymentFailed,   setPaymentFailed]   = useState<any[]>([]);
  const [storageDanger,   setStorageDanger]    = useState<any[]>([]);
  const [deletionPending, setDeletionPending]  = useState<any[]>([]);
  const [uploadSpike,     setUploadSpike]      = useState<any[]>([]);
  const [support,         setSupport]          = useState<{ open_count: number; overdue_count: number }>({ open_count: 0, overdue_count: 0 });
  const [backup,          setBackup]           = useState<{ last_at: string | null }>({ last_at: null });
  const [externalSvcs,    setExternalSvcs]     = useState<{ name: string; status: string }[]>([]);
  const [policyUnsigned,  setPolicyUnsigned]   = useState<any[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    try {
      const [rcData, puData] = await Promise.all([
        apiRequest(token, "/super/risk-center"),
        apiRequest(token, "/super/operators?filter=policy_unsigned"),
      ]);
      setPaymentFailed(rcData.payment_failed ?? []);
      setStorageDanger(rcData.storage_danger ?? []);
      setDeletionPending(rcData.deletion_pending ?? []);
      setUploadSpike(rcData.upload_spike ?? []);
      setSupport(rcData.support ?? { open_count: 0, overdue_count: 0 });
      setBackup(rcData.backup ?? { last_at: null });
      setExternalSvcs(rcData.external_services ?? []);
      setPolicyUnsigned(Array.isArray(puData) ? puData : []);
    } catch {
      // 네트워크 오류 시 기존 상태 유지
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const totalRisk = paymentFailed.length + storageDanger.length + deletionPending.length + uploadSpike.length + policyUnsigned.length;

  async function withProcessing(id: string, fn: () => Promise<void>) {
    setProcessing(id);
    try { await fn(); } catch { Alert.alert("오류", "처리에 실패했습니다."); }
    setProcessing(null);
    load(true);
  }

  function applyGraceAction(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_status: "active" }),
      });
      Alert.alert("완료", `${op.name} 유예(복구) 처리했습니다.`);
    });
  }

  function setReadonly(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/readonly`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, reason: "결제 실패 — 읽기전용 전환" }),
      });
      Alert.alert("완료", `${op.name} 읽기전용으로 전환했습니다.`);
    });
  }

  function blockUpload(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/block-upload`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
    });
  }

  function limitUpload(op: any) {
    withProcessing(op.pool_id ?? op.id, async () => {
      await apiRequest(token, `/super/operators/${op.pool_id ?? op.id}/block-upload`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      Alert.alert("완료", `${op.name} 업로드를 제한했습니다.`);
    });
  }

  function deferDeletion(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/defer-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: 48 }),
      });
      Alert.alert("완료", `${op.name} 자동삭제를 48시간 유예했습니다.`);
    });
  }

  function cancelDeletion(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/cancel-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      Alert.alert("완료", `${op.name} 자동삭제 예약을 해제했습니다.`);
    });
  }

  function sendPolicyReminder(op: any) {
    withProcessing(op.id, async () => {
      await apiRequest(token, `/super/operators/${op.id}/policy-reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_key: "refund_policy" }),
      });
      Alert.alert("완료", `${op.name}에 정책 재알림을 발송했습니다.`);
    });
  }

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="장애·리스크 센터" homePath="/(super)/dashboard" />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(true); }} />}>

        {/* 요약 헤더 */}
        <View style={s.summaryCard}>
          <View style={s.summaryRow}>
            <Feather name="shield" size={20} color={totalRisk > 0 ? "#F87171" : "#34D399"} />
            <Text style={[s.summaryTitle, totalRisk > 0 && { color: "#F87171" }]}>
              {totalRisk > 0 ? `리스크 ${totalRisk}건 처리 필요` : "현재 리스크 없음 ✓"}
            </Text>
          </View>
          <View style={s.riskGrid}>
            {[
              { label: "결제 실패",   count: paymentFailed.length,   color: "#F87171" },
              { label: "저장 95%↑",  count: storageDanger.length,    color: "#C084FC" },
              { label: "삭제 예정",  count: deletionPending.length,  color: "#4EA7D8" },
              { label: "업로드 급증", count: uploadSpike.length,     color: "#FBBF24" },
              { label: "정책 미확인", count: policyUnsigned.length,  color: "#818CF8" },
              { label: "SLA 초과",   count: support.overdue_count,   color: "#F87171" },
            ].map(item => (
              <View key={item.label} style={s.riskTile}>
                <Text style={[s.riskNum, { color: item.count > 0 ? item.color : "#6B7280" }]}>{item.count}</Text>
                <Text style={s.riskLbl}>{item.label}</Text>
              </View>
            ))}
          </View>
          {support.open_count > 0 && (
            <View style={s.supportRow}>
              <Feather name="message-circle" size={13} color="#38BDF8" />
              <Text style={s.supportTxt}>
                고객센터 미처리 {support.open_count}건
                {support.overdue_count > 0 && ` · SLA 초과 ${support.overdue_count}건`}
              </Text>
              <Pressable onPress={() => router.push("/(super)/support" as any)} style={s.supportLink}>
                <Text style={s.supportLinkTxt}>처리</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* ── 결제 실패 ── */}
        <RiskGroup title="결제 실패 운영자" icon="credit-card" color="#D96C6C" bg="#F9DEDA"
          count={paymentFailed.length} onViewAll={() => router.push("/(super)/subscriptions" as any)}>
          {paymentFailed.slice(0, 5).map((op: any) => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.owner_name ?? "—"} · {op.subscription_status ?? "결제 실패"}</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => applyGraceAction(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>복구</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === op.id} onPress={() => setReadonly(op)}>
                  <Text style={[g.btnTxt, { color: "#D96C6C" }]}>RO</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: C.button }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 저장공간 95% 초과 ── */}
        <RiskGroup title="저장공간 위험 (95%↑)" icon="hard-drive" color={P} bg="#EEDDF5"
          count={storageDanger.length} onViewAll={() => router.push("/(super)/storage" as any)}>
          {storageDanger.slice(0, 5).map((op: any) => {
            const pct = op.usage_pct ?? 0;
            return (
              <View key={op.id} style={g.item}>
                <View style={g.itemLeft}>
                  <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                  <View style={g.barRow}>
                    <View style={g.barBg}>
                      <View style={[g.barFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: "#D96C6C" }]} />
                    </View>
                    <Text style={[g.pctTxt, { color: "#D96C6C" }]}>{pct}%</Text>
                  </View>
                </View>
                <View style={g.itemActions}>
                  <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => {
                    Alert.alert("임시 허용", `${op.name} 업로드를 임시 허용하려면 저장공간 탭에서 용량을 늘려주세요.`);
                  }}>
                    <Text style={[g.btnTxt, { color: "#D97706" }]}>안내</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === op.id} onPress={() => blockUpload(op)}>
                    <Text style={[g.btnTxt, { color: "#D96C6C" }]}>차단</Text>
                  </Pressable>
                  <Pressable style={[g.btn, { backgroundColor: C.button }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                    <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </RiskGroup>

        {/* ── 자동삭제 예정 ── */}
        <RiskGroup title="자동삭제 예정 (48h)" icon="trash-2" color="#2EC4B6" bg="#ECFEFF"
          count={deletionPending.length} onViewAll={() => router.push("/(super)/kill-switch" as any)}>
          {deletionPending.slice(0, 5).map((op: any) => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.owner_name ?? "—"} · 삭제 {hoursLeftStr(op.hours_left)}</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => deferDeletion(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>유예</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#E6FFFA" }]} disabled={processing === op.id} onPress={() => cancelDeletion(op)}>
                  <Text style={[g.btnTxt, { color: "#2EC4B6" }]}>해제</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: C.button }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 업로드 급증 ── */}
        <RiskGroup title="업로드 급증 탐지" icon="trending-up" color="#D97706" bg="#FFF1BF"
          count={uploadSpike.length}>
          {uploadSpike.slice(0, 5).map((op: any) => (
            <View key={op.pool_id ?? op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.owner_name ?? "—"} · 24h 내 {op.event_count}건 급증</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#F9DEDA" }]} disabled={processing === (op.pool_id ?? op.id)} onPress={() => limitUpload(op)}>
                  <Text style={[g.btnTxt, { color: "#D96C6C" }]}>제한</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: C.button }]} onPress={() => router.push(`/(super)/operator-detail?id=${op.pool_id ?? op.id}` as any)}>
                  <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 정책 미확인 ── */}
        <RiskGroup title="정책 미확인 운영자" icon="file-text" color="#2EC4B6" bg="#E6FFFA"
          count={policyUnsigned.length} onViewAll={() => router.push("/(super)/policy" as any)}>
          {policyUnsigned.slice(0, 5).map((op: any) => (
            <View key={op.id} style={g.item}>
              <View style={g.itemLeft}>
                <Text style={g.itemName} numberOfLines={1}>{op.name}</Text>
                <Text style={g.itemSub}>{op.owner_name ?? "—"} · 환불정책 미확인</Text>
              </View>
              <View style={g.itemActions}>
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF" }]} disabled={processing === op.id} onPress={() => sendPolicyReminder(op)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>재알림</Text>
                </Pressable>
                <Pressable style={[g.btn, { backgroundColor: "#E6FFFA" }]} onPress={() => router.push("/(super)/policy" as any)}>
                  <Text style={[g.btnTxt, { color: "#2EC4B6" }]}>상세</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </RiskGroup>

        {/* ── 외부 서비스 상태 ── */}
        <View style={s.serviceCard}>
          <Text style={s.serviceTitle}>인프라 서비스 상태</Text>
          {externalSvcs.map((svc: any) => (
            <View key={svc.name} style={s.serviceRow}>
              <View style={[s.serviceDot, { backgroundColor: svc.status === "normal" ? "#2E9B6F" : "#D96C6C" }]} />
              <Text style={s.serviceName}>{svc.name}</Text>
              <Text style={[s.serviceStatus, { color: svc.status === "normal" ? "#2E9B6F" : "#D96C6C" }]}>
                {svc.status === "normal" ? "정상" : "이상"}
              </Text>
              {svc.status !== "normal" && (
                <Pressable style={[g.btn, { backgroundColor: "#FFF1BF", marginLeft: 4 }]}
                  onPress={() => Alert.alert("재확인", `${svc.name} 상태를 재확인 요청했습니다.`)}>
                  <Text style={[g.btnTxt, { color: "#D97706" }]}>재확인</Text>
                </Pressable>
              )}
            </View>
          ))}
          <View style={s.backupRow}>
            <Feather name="database" size={13} color="#6B7280" />
            <Text style={s.backupTxt}>마지막 백업 이벤트: {fmtAgo(backup.last_at)}</Text>
          </View>
        </View>

        {totalRisk === 0 && support.open_count === 0 && (
          <View style={s.allClear}>
            <Feather name="check-circle" size={32} color="#2E9B6F" />
            <Text style={s.allClearTxt}>오늘 처리할 리스크가 없습니다</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.background },
  summaryCard:   { backgroundColor: "#1F1235", borderRadius: 14, padding: 16, gap: 12 },
  summaryRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: "#F1F5F9" },
  riskGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskTile:      { flex: 1, minWidth: "28%", backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, padding: 10, alignItems: "center" },
  riskNum:       { fontSize: 20, fontFamily: "Inter_700Bold", color: "#6B7280" },
  riskLbl:       { fontSize: 10, fontFamily: "Inter_500Medium", color: "#9CA3AF", marginTop: 2, textAlign: "center" },
  supportRow:    { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(2,132,199,0.12)", borderRadius: 8, padding: 8 },
  supportTxt:    { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#38BDF8" },
  supportLink:   { backgroundColor: "#0284C7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  supportLinkTxt:{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },

  serviceCard:   { backgroundColor: "#fff", borderRadius: 14, padding: 14,
                   borderWidth: 1, borderColor: "#E5E7EB", gap: 4 },
  serviceTitle:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 8 },
  serviceRow:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6,
                   borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  serviceDot:    { width: 8, height: 8, borderRadius: 4 },
  serviceName:   { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827" },
  serviceStatus: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  serviceActions:{ flexDirection: "row", gap: 4 },
  backupRow:     { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  backupTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280" },

  allClear:      { alignItems: "center", paddingVertical: 40, gap: 12 },
  allClearTxt:   { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#2E9B6F" },
});

const g = StyleSheet.create({
  group:       { backgroundColor: "#fff", borderRadius: 14, padding: 12,
                 borderWidth: 1, borderColor: "#E5E7EB" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  groupIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  groupTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  countBadge:  { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  countTxt:    { fontSize: 12, fontFamily: "Inter_700Bold" },
  viewAll:     { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  item:        { flexDirection: "row", alignItems: "center", gap: 8,
                 paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  itemLeft:    { flex: 1 },
  itemName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  itemSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  itemActions: { flexDirection: "row", gap: 4 },

  barRow:      { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  barBg:       { flex: 1, height: 6, borderRadius: 3, backgroundColor: "#E5E7EB", overflow: "hidden" },
  barFill:     { height: 6, borderRadius: 3 },
  pctTxt:      { fontSize: 11, fontFamily: "Inter_700Bold", minWidth: 30 },

  btn:         { flexDirection: "row", alignItems: "center", gap: 3,
                 paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  btnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
