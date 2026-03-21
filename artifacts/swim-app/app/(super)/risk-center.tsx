/**
 * (super)/risk-center.tsx — 장애·리스크 센터
 * 오늘 처리 큐 + 서비스 상태 + 백업 상태
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const P = "#7C3AED";

interface RiskData {
  payment_failed:   any[];
  storage_danger:   any[];
  deletion_pending: any[];
  upload_spike:     any[];
  support:          { open_count: number; overdue_count: number };
  backup:           { last_at: string | null };
  external_services: { name: string; status: string }[];
}

const SUB_CFG: Record<string, string> = {
  expired: "만료", suspended: "정지", cancelled: "해지",
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function hoursLeft(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const h = Math.floor((d.getTime() - Date.now()) / 3600000);
  if (h < 0) return "만료됨";
  if (h < 1) return "1시간 미만";
  return `${h}시간 후`;
}

function fmtAgo(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "기록 없음";
  const h = Math.floor((Date.now() - d.getTime()) / 3600000);
  if (h < 1) return "방금";
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

interface RiskGroupProps {
  title: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  color: string;
  bg: string;
  items: any[];
  max?: number;
  renderItem: (item: any, idx: number) => React.ReactNode;
  onViewAll?: () => void;
}

function RiskGroup({ title, icon, color, bg, items, max = 5, renderItem, onViewAll }: RiskGroupProps) {
  if (items.length === 0) return null;
  return (
    <View style={g.group}>
      <View style={g.groupHeader}>
        <View style={[g.groupIcon, { backgroundColor: bg }]}>
          <Feather name={icon} size={14} color={color} />
        </View>
        <Text style={g.groupTitle}>{title}</Text>
        <View style={[g.countBadge, { backgroundColor: bg }]}>
          <Text style={[g.countTxt, { color }]}>{items.length}</Text>
        </View>
        {onViewAll && (
          <Pressable onPress={onViewAll} style={{ marginLeft: "auto" }}>
            <Text style={[g.viewAll, { color }]}>전체 보기</Text>
          </Pressable>
        )}
      </View>
      {items.slice(0, max).map((item, i) => renderItem(item, i))}
    </View>
  );
}

export default function RiskCenterScreen() {
  const { token } = useAuth();
  const [data,       setData]       = useState<RiskData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  async function load() {
    try {
      const res = await apiRequest(token, "/super/risk-center");
      if (res.ok) setData(await res.json());
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  async function approve(id: string) {
    setProcessing(id);
    await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" }).catch(() => {});
    setProcessing(null); load();
  }

  async function deferDeletion(id: string) {
    setProcessing(id);
    await apiRequest(token, `/super/operators/${id}/defer-deletion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 48 }),
    }).catch(() => {});
    setProcessing(null); load();
  }

  const totalRisk = (data?.payment_failed.length ?? 0) + (data?.storage_danger.length ?? 0) +
    (data?.deletion_pending.length ?? 0) + (data?.upload_spike.length ?? 0);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="장애·리스크 센터" homePath="/(super)/dashboard" />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 14, gap: 14, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(); }} />}>

        {loading ? (
          <ActivityIndicator color={P} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* 요약 헤더 */}
            <View style={s.summaryCard}>
              <View style={s.summaryRow}>
                <Feather name="shield" size={20} color={totalRisk > 0 ? "#DC2626" : "#10B981"} />
                <Text style={[s.summaryTitle, totalRisk > 0 && { color: "#DC2626" }]}>
                  {totalRisk > 0 ? `리스크 ${totalRisk}건 처리 필요` : "현재 리스크 없음 ✓"}
                </Text>
              </View>
              {data?.support && (data.support.open_count > 0) && (
                <View style={s.supportRow}>
                  <Feather name="message-circle" size={13} color="#0284C7" />
                  <Text style={s.supportTxt}>
                    고객센터 미처리 {data.support.open_count}건
                    {data.support.overdue_count > 0 && ` · SLA 초과 ${data.support.overdue_count}건`}
                  </Text>
                  <Pressable onPress={() => router.push("/(super)/support" as any)} style={s.supportLink}>
                    <Text style={s.supportLinkTxt}>처리</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* 결제 실패 */}
            <RiskGroup
              title="결제 실패 운영자"
              icon="credit-card"
              color="#DC2626" bg="#FEE2E2"
              items={data?.payment_failed ?? []}
              onViewAll={() => router.push("/(super)/subscriptions" as any)}>
              {(item: any) => (
                <View key={item.id} style={g.item}>
                  <View style={g.itemLeft}>
                    <Text style={g.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={g.itemSub}>{item.owner_name} · {SUB_CFG[item.subscription_status] ?? item.subscription_status}</Text>
                  </View>
                  <View style={g.itemActions}>
                    <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                      onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                      <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </RiskGroup>

            {/* 저장공간 95% 초과 */}
            <RiskGroup
              title="저장공간 위험 (95%↑)"
              icon="hard-drive"
              color={P} bg="#EDE9FE"
              items={data?.storage_danger ?? []}
              onViewAll={() => router.push("/(super)/storage" as any)}>
              {(item: any) => (
                <View key={item.id} style={g.item}>
                  <View style={g.itemLeft}>
                    <Text style={g.itemName} numberOfLines={1}>{item.name}</Text>
                    <View style={g.barRow}>
                      <View style={g.barBg}>
                        <View style={[g.barFill, { width: `${Math.min(item.usage_pct, 100)}%` as any, backgroundColor: "#DC2626" }]} />
                      </View>
                      <Text style={[g.pctTxt, { color: "#DC2626" }]}>{item.usage_pct}%</Text>
                    </View>
                  </View>
                  <Pressable style={[g.btn, { backgroundColor: "#D1FAE5" }]}
                    onPress={() => router.push(`/(super)/storage` as any)}>
                    <Text style={[g.btnTxt, { color: "#059669" }]}>용량↑</Text>
                  </Pressable>
                </View>
              )}
            </RiskGroup>

            {/* 자동삭제 예정 */}
            <RiskGroup
              title="자동삭제 예정 (48h)"
              icon="trash-2"
              color="#0891B2" bg="#ECFEFF"
              items={data?.deletion_pending ?? []}
              onViewAll={() => router.push("/(super)/kill-switch" as any)}>
              {(item: any) => (
                <View key={item.id} style={g.item}>
                  <View style={g.itemLeft}>
                    <Text style={g.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={g.itemSub}>{item.owner_name} · {hoursLeft(item.subscription_end_at)}</Text>
                  </View>
                  <View style={g.itemActions}>
                    <Pressable style={[g.btn, { backgroundColor: "#FEF3C7" }]}
                      onPress={() => deferDeletion(item.id)}
                      disabled={processing === item.id}>
                      {processing === item.id
                        ? <ActivityIndicator size="small" color="#D97706" />
                        : <Text style={[g.btnTxt, { color: "#D97706" }]}>유예</Text>
                      }
                    </Pressable>
                    <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                      onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
                      <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </RiskGroup>

            {/* 업로드 급증 */}
            <RiskGroup
              title="업로드 급증 탐지 (24h)"
              icon="trending-up"
              color="#D97706" bg="#FEF3C7"
              items={data?.upload_spike ?? []}>
              {(item: any) => (
                <View key={item.pool_id} style={g.item}>
                  <View style={g.itemLeft}>
                    <Text style={g.itemName} numberOfLines={1}>{item.name}</Text>
                    <Text style={g.itemSub}>{item.owner_name} · 24h 내 {item.event_count}회 업로드</Text>
                  </View>
                  <Pressable style={[g.btn, { backgroundColor: "#EDE9FE" }]}
                    onPress={() => router.push(`/(super)/operator-detail?id=${item.pool_id}` as any)}>
                    <Text style={[g.btnTxt, { color: P }]}>상세</Text>
                  </Pressable>
                </View>
              )}
            </RiskGroup>

            {/* 서비스 상태 */}
            <View style={s.serviceCard}>
              <Text style={s.serviceTitle}>외부 서비스 상태</Text>
              {(data?.external_services ?? []).map(svc => (
                <View key={svc.name} style={s.serviceRow}>
                  <View style={[s.serviceDot, { backgroundColor: svc.status === "normal" ? "#10B981" : "#DC2626" }]} />
                  <Text style={s.serviceName}>{svc.name}</Text>
                  <Text style={[s.serviceStatus, { color: svc.status === "normal" ? "#10B981" : "#DC2626" }]}>
                    {svc.status === "normal" ? "정상" : "이상"}
                  </Text>
                </View>
              ))}
              <View style={s.backupRow}>
                <Feather name="database" size={13} color="#6B7280" />
                <Text style={s.backupTxt}>마지막 백업: {fmtAgo(data?.backup?.last_at)}</Text>
              </View>
            </View>

            {totalRisk === 0 && (data?.payment_failed.length === 0) && (
              <View style={s.allClear}>
                <Feather name="check-circle" size={32} color="#10B981" />
                <Text style={s.allClearTxt}>오늘 처리할 리스크가 없습니다</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F5F3FF" },
  summaryCard:  { backgroundColor: "#1F1235", borderRadius: 14, padding: 16, gap: 10 },
  summaryRow:   { flexDirection: "row", alignItems: "center", gap: 8 },
  summaryTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  supportRow:   { flexDirection: "row", alignItems: "center", gap: 6,
                  backgroundColor: "rgba(2,132,199,0.1)", borderRadius: 8, padding: 8 },
  supportTxt:   { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#38BDF8" },
  supportLink:  { backgroundColor: "#0284C7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  supportLinkTxt: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  serviceCard:  { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8,
                  borderWidth: 1, borderColor: "#E5E7EB" },
  serviceTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 4 },
  serviceRow:   { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  serviceDot:   { width: 8, height: 8, borderRadius: 4 },
  serviceName:  { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#374151" },
  serviceStatus:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
  backupRow:    { flexDirection: "row", alignItems: "center", gap: 6,
                  borderTopWidth: 1, borderTopColor: "#F3F4F6", paddingTop: 8, marginTop: 4 },
  backupTxt:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  allClear:     { alignItems: "center", paddingVertical: 40, gap: 10 },
  allClearTxt:  { fontSize: 14, fontFamily: "Inter_500Medium", color: "#6B7280" },
});

const g = StyleSheet.create({
  group:       { backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8,
                 paddingHorizontal: 14, paddingVertical: 12,
                 backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  groupIcon:   { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  groupTitle:  { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  countBadge:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  countTxt:    { fontSize: 11, fontFamily: "Inter_700Bold" },
  viewAll:     { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  item:        { flexDirection: "row", alignItems: "center", gap: 10,
                 paddingHorizontal: 14, paddingVertical: 11,
                 borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  itemLeft:    { flex: 1, gap: 3 },
  itemName:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  itemSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  itemActions: { flexDirection: "row", gap: 6 },
  btn:         { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 40, alignItems: "center" },
  btnTxt:      { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  barRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  barBg:       { flex: 1, height: 4, borderRadius: 2, backgroundColor: "#F3F4F6", overflow: "hidden" },
  barFill:     { height: 4, borderRadius: 2 },
  pctTxt:      { fontSize: 11, fontFamily: "Inter_700Bold", width: 32, textAlign: "right" },
});
