/**
 * (super)/system-status.tsx — 시스템 상태
 * DB·스토리지·PG·이메일·푸시·기타 연동 서비스 상태 표시.
 * 정상(normal) / 주의(warning) / 장애(error) 상태.
 * 오늘 처리할 일 · 리스크 요약과 연동 가능한 구조.
 */
import { Info, RefreshCw } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useAuth } from "@/context/AuthContext";

const P = "#7C3AED";

export type ServiceStatus = "normal" | "warning" | "error";

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  status: ServiceStatus;
  latencyMs: number | null;
  uptimePct: number;
  lastChecked: string;
  note: string;
}

// ─── 시스템 상태 시드 데이터 ───────────────────────────────────────────────
// 실제 운영에서는 각 서비스의 health endpoint 또는 모니터링 API 연동으로 대체.
const INITIAL_SERVICES: ServiceItem[] = [
  { id: "db",       name: "데이터베이스",     category: "인프라",  icon: "database",     status: "normal",  latencyMs: 12,   uptimePct: 99.98, lastChecked: new Date().toISOString(), note: "PostgreSQL 17 — 정상 운영 중" },
  { id: "storage",  name: "파일 스토리지",    category: "인프라",  icon: "hard-drive",   status: "warning", latencyMs: 180,  uptimePct: 99.5,  lastChecked: new Date().toISOString(), note: "업로드 지연 감지 — 점검 중" },
  { id: "pg",       name: "PG (결제)",        category: "외부",    icon: "credit-card",  status: "normal",  latencyMs: 65,   uptimePct: 99.95, lastChecked: new Date().toISOString(), note: "토스페이먼츠 — 정상" },
  { id: "email",    name: "이메일 서비스",    category: "외부",    icon: "mail",         status: "normal",  latencyMs: 320,  uptimePct: 99.9,  lastChecked: new Date().toISOString(), note: "SendGrid — 정상 발송 중" },
  { id: "push",     name: "푸시 알림",        category: "외부",    icon: "bell",         status: "normal",  latencyMs: 45,   uptimePct: 99.8,  lastChecked: new Date().toISOString(), note: "FCM/APNs — 정상" },
  { id: "auth",     name: "인증 서버",        category: "인프라",  icon: "lock",         status: "normal",  latencyMs: 8,    uptimePct: 100,   lastChecked: new Date().toISOString(), note: "JWT/세션 정상 처리 중" },
  { id: "cdn",      name: "CDN",              category: "인프라",  icon: "globe",        status: "normal",  latencyMs: 22,   uptimePct: 99.99, lastChecked: new Date().toISOString(), note: "Cloudflare — 전 리전 정상" },
  { id: "sms_gw",   name: "SMS 게이트웨이",  category: "외부",    icon: "message-square", status: "warning", latencyMs: null, uptimePct: 97.2, lastChecked: new Date().toISOString(), note: "알림톡 연동 지연 — 자체 발송으로 전환" },
  { id: "monitor",  name: "모니터링",         category: "내부",    icon: "activity",     status: "normal",  latencyMs: 5,    uptimePct: 100,   lastChecked: new Date().toISOString(), note: "Sentry/로그 수집 정상" },
];

const STATUS_CFG: Record<ServiceStatus, { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Feather>["name"] }> = {
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
  txt:   { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
});

function ServiceCard({ item, onToggle }: { item: ServiceItem; onToggle: (id: string) => void }) {
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
      {item.status !== "normal" && (
        <Pressable style={sc.fixBtn} onPress={() => onToggle(item.id)}>
          <RefreshCw size={12} color={cfg.color} />
          <Text style={[sc.fixTxt, { color: cfg.color }]}>정상으로 표시</Text>
        </Pressable>
      )}
    </View>
  );
}
const sc = StyleSheet.create({
  card:       { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  top:        { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  iconWrap:   { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#0F172A" },
  category:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metrics:    { flexDirection: "row", gap: 16, marginBottom: 6 },
  metricItem: { gap: 2 },
  metricLabel:{ fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B" },
  metricVal:  { fontSize: 13, fontFamily: "Pretendard-Bold", color: "#0F172A" },
  note:       { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 4 },
  fixBtn:     { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, padding: 6,
                borderRadius: 6, backgroundColor: "#F1F5F9" },
  fixTxt:     { fontSize: 11, fontFamily: "Pretendard-SemiBold" },
});

export default function SystemStatusScreen() {
  const insets = useSafeAreaInsets();
  const { adminUser } = useAuth();
  const actorName = adminUser?.name ?? "슈퍼관리자";
  const createLog = useAuditLogStore(s => s.createLog);

  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES);
  const [refreshing, setRefreshing] = useState(false);

  const normalCount  = useMemo(() => services.filter(s => s.status === "normal").length, [services]);
  const warningCount = useMemo(() => services.filter(s => s.status === "warning").length, [services]);
  const errorCount   = useMemo(() => services.filter(s => s.status === "error").length, [services]);

  const overallStatus: ServiceStatus = errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "normal";
  const overallCfg = STATUS_CFG[overallStatus];

  function handleToggleNormal(id: string) {
    const svc = services.find(s => s.id === id);
    if (!svc) return;
    setServices(prev => prev.map(s => s.id === id ? { ...s, status: "normal", lastChecked: new Date().toISOString() } : s));
    createLog({
      category: "시스템상태",
      title: `${svc.name} 상태 정상으로 변경`,
      actorName,
      impact: "medium",
      detail: `이전 상태: ${svc.status}`,
    });
  }

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => {
      setServices(prev => prev.map(s => ({ ...s, lastChecked: new Date().toISOString() })));
      setRefreshing(false);
    }, 800);
  }

  const categorized = useMemo(() => {
    const map: Record<string, ServiceItem[]> = {};
    for (const svc of services) {
      if (!map[svc.category]) map[svc.category] = [];
      map[svc.category].push(svc);
    }
    return map;
  }, [services]);

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="시스템 상태" homePath="/(super)/dashboard" />

      {/* 전체 상태 배너 */}
      <View style={[s.overallBanner, { backgroundColor: overallCfg.bg }]}>
        <LucideIcon name={overallCfg.icon} size={20} color={overallCfg.color} />
        <View style={{ flex: 1 }}>
          <Text style={[s.overallTitle, { color: overallCfg.color }]}>
            {overallStatus === "normal" ? "모든 시스템 정상" : overallStatus === "warning" ? "일부 서비스 주의 필요" : "장애 감지됨"}
          </Text>
          <Text style={[s.overallSub, { color: overallCfg.color }]}>
            정상 {normalCount} · 주의 {warningCount} · 장애 {errorCount}
          </Text>
        </View>
        <Pressable style={s.refreshBtn} onPress={handleRefresh}>
          <RefreshCw size={14} color={overallCfg.color} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={P} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 14 }}>

        {Object.entries(categorized).map(([category, items]) => (
          <View key={category} style={{ gap: 8 }}>
            <Text style={s.categoryTitle}>{category}</Text>
            {items.map(item => (
              <ServiceCard key={item.id} item={item} onToggle={handleToggleNormal} />
            ))}
          </View>
        ))}

        <View style={s.noteBox}>
          <Info size={12} color="#64748B" />
          <Text style={s.noteTxt}>
            서비스 상태는 1분 단위로 자동 점검됩니다. 이상 감지 시 슈퍼관리자에게 푸시 알림이 발송됩니다.
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
  overallTitle:   { fontSize: 15, fontFamily: "Pretendard-Bold" },
  overallSub:     { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  refreshBtn:     { padding: 6 },
  categoryTitle:  { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#64748B", textTransform: "uppercase",
                    letterSpacing: 0.5, marginTop: 4 },
  noteBox:        { flexDirection: "row", gap: 6, alignItems: "flex-start", backgroundColor: "#FFFFFF",
                    borderRadius: 8, padding: 10 },
  noteTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", flex: 1 },
});
