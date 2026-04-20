/**
 * (super)/system-status.tsx — 시스템 상태
 * 실제 API(/super/system-health)에서 각 서비스의 상태/지연/메모를 가져와 표시.
 */
import { Info, RefreshCw } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useFocusEffect } from "expo-router";
import { apiRequest, useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

export type ServiceStatus = "normal" | "warning" | "error";

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  icon: string;
  status: ServiceStatus;
  latencyMs: number | null;
  uptimePct: number;
  lastChecked: string;
  note: string;
}

const STATUS_CFG: Record<ServiceStatus, { label: string; color: string; bg: string; icon: string }> = {
  normal:  { label: "정상",  color: "#2EC4B6", bg: "#E6FFFA", icon: "check-circle" },
  warning: { label: "주의",  color: "#D97706", bg: "#FFF1BF", icon: "alert-circle" },
  error:   { label: "장애",  color: "#D96C6C", bg: "#F9DEDA", icon: "alert-triangle" },
};

function StatusBadge({ status }: { status: ServiceStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <View style={[sb.badge, { backgroundColor: cfg.bg }]}>
      <LucideIcon name={cfg.icon} size={11} color={cfg.color} />
      <Text style={[sb.txt, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  txt:   { fontSize: 11, fontFamily: "Pretendard-Regular" },
});

function ServiceCard({ item }: { item: ServiceItem }) {
  const cfg = STATUS_CFG[item.status];
  return (
    <View style={[sc.card, { borderLeftColor: cfg.color, borderLeftWidth: 4 }]}>
      <View style={sc.top}>
        <View style={[sc.iconWrap, { backgroundColor: cfg.bg }]}>
          <LucideIcon name={item.icon} size={16} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={sc.name}>{item.name}</Text>
          <Text style={sc.category}>{item.category}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={sc.metrics}>
        <View style={sc.metricItem}>
          <Text style={sc.metricLabel}>지연</Text>
          <Text style={sc.metricVal}>{item.latencyMs != null ? `${item.latencyMs}ms` : "—"}</Text>
        </View>
        <View style={sc.metricItem}>
          <Text style={sc.metricLabel}>가동률</Text>
          <Text style={[sc.metricVal, { color: item.uptimePct < 99 ? "#D96C6C" : "#2EC4B6" }]}>
            {item.uptimePct.toFixed(2)}%
          </Text>
        </View>
      </View>
      {item.note ? <Text style={sc.note}>{item.note}</Text> : null}
    </View>
  );
}
const sc = StyleSheet.create({
  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  top:        { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  iconWrap:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  category:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metrics:    { flexDirection: "row", gap: 16, marginBottom: 6 },
  metricItem: { gap: 2 },
  metricLabel:{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metricVal:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  note:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 4 },
});

export default function SystemStatusScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt]   = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);
    try {
      const data = await apiRequest(token, "/super/system-health");
      setServices(data.services ?? []);
      setCheckedAt(data.summary?.checkedAt ?? null);
    } catch (e: any) {
      setFetchError(e?.message ?? "헬스체크 요청 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const normalCount  = useMemo(() => services.filter(s => s.status === "normal").length, [services]);
  const warningCount = useMemo(() => services.filter(s => s.status === "warning").length, [services]);
  const errorCount   = useMemo(() => services.filter(s => s.status === "error").length, [services]);

  const overallStatus: ServiceStatus = errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "normal";
  const overallCfg = STATUS_CFG[overallStatus];

  const categorized = useMemo(() => {
    const map: Record<string, ServiceItem[]> = {};
    for (const svc of services) {
      if (!map[svc.category]) map[svc.category] = [];
      map[svc.category].push(svc);
    }
    return map;
  }, [services]);

  const checkedAtStr = useMemo(() => {
    if (!checkedAt) return null;
    return new Date(checkedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [checkedAt]);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="시스템 상태" homePath="/(super)/more" />

      {/* 전체 상태 배너 */}
      <View style={[s.overallBanner, { backgroundColor: loading ? "#F1F5F9" : overallCfg.bg }]}>
        {loading
          ? <ActivityIndicator size="small" color={P} />
          : <LucideIcon name={overallCfg.icon} size={20} color={overallCfg.color} />
        }
        <View style={{ flex: 1 }}>
          <Text style={[s.overallTitle, { color: loading ? "#94A3B8" : overallCfg.color }]}>
            {loading
              ? "점검 중..."
              : fetchError
                ? "헬스체크 실패"
                : overallStatus === "normal" ? "모든 시스템 정상"
                  : overallStatus === "warning" ? "일부 서비스 주의 필요" : "장애 감지됨"}
          </Text>
          <Text style={[s.overallSub, { color: loading ? "#94A3B8" : overallCfg.color }]}>
            {loading
              ? "서버에서 실측 중..."
              : fetchError
                ? fetchError
                : `정상 ${normalCount} · 주의 ${warningCount} · 장애 ${errorCount}${checkedAtStr ? `  ·  ${checkedAtStr} 기준` : ""}`}
          </Text>
        </View>
        <Pressable style={s.refreshBtn} onPress={() => load(true)} disabled={loading || refreshing}>
          <RefreshCw size={14} color={loading ? "#94A3B8" : overallCfg.color} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={P} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>

        {loading && services.length === 0 ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={P} />
            <Text style={s.loadingTxt}>각 서비스 실측 중...</Text>
          </View>
        ) : (
          Object.entries(categorized).map(([category, items]) => (
            <View key={category} style={{ gap: 8 }}>
              <Text style={s.categoryTitle}>{category}</Text>
              {items.map(item => (
                <ServiceCard key={item.id} item={item} />
              ))}
            </View>
          ))
        )}

        <View style={s.noteBox}>
          <Info size={12} color="#64748B" />
          <Text style={s.noteTxt}>
            이 화면을 열거나 새로고침할 때 각 서비스에 실시간으로 연결해 상태를 확인합니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F1F5F9" },
  overallBanner:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, margin: 16,
                    borderRadius: 14 },
  overallTitle:   { fontSize: 15, fontFamily: "Pretendard-Regular" },
  overallSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  refreshBtn:     { padding: 6 },
  categoryTitle:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B", textTransform: "uppercase", marginTop: 4 },
  noteBox:        { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFFFFF",
                    borderRadius: 8, padding: 10 },
  noteTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
  loadingBox:     { alignItems: "center", gap: 10, paddingVertical: 40 },
  loadingTxt:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#64748B" },
});
