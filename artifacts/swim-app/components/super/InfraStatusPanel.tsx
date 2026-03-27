/**
 * 플랫폼 인프라 상태 패널
 * - 상단 4개 핵심 카드: 슈퍼관리자 DB / 수영장 운영 DB / 사진 저장소 / 영상 저장소
 * - 서비스 2그룹: A. 플랫폼 운영 인프라  B. 수영장 운영 인프라
 * - 경고 임계치 (용량 80/90/100%, 응답속도 300/1000ms)
 * - 최근 이상 감지 섹션
 * - 최근 24시간 상태 이력 섹션
 */
import { Feather } from "@expo/vector-icons";
import React, { useState, useCallback } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useAuth, apiRequest } from "@/context/AuthContext";

// ── 색상 상수 ────────────────────────────────────────────────────────────────
const P       = "#7C3AED";
const GREEN   = "#2EC4B6";
const WARN    = "#D97706";
const DANGER  = "#DC2626";
const GRAY    = "#6B7280";

// ── 상태 설정 ─────────────────────────────────────────────────────────────────
type InfraStatus = "normal" | "warning" | "danger" | "full" | "error" | "inactive" | "delay" | "critical_delay";

const STATUS_CFG: Record<InfraStatus, { label: string; color: string; bg: string; border: string; icon: string }> = {
  normal:         { label: "정상",     color: GREEN,   bg: "#E6FFFA", border: "#A7D9D4", icon: "check-circle"   },
  warning:        { label: "임박",     color: WARN,    bg: "#FEF3C7", border: "#FCD34D", icon: "alert-triangle" },
  danger:         { label: "위험",     color: "#C05621", bg: "#FFEDD5", border: "#FB923C", icon: "alert-circle"  },
  full:           { label: "가득 참",  color: DANGER,  bg: "#FEE2E2", border: "#FCA5A5", icon: "x-circle"       },
  error:          { label: "오류",     color: DANGER,  bg: "#FEE2E2", border: "#FCA5A5", icon: "x-circle"       },
  inactive:       { label: "비활성",   color: GRAY,    bg: "#F3F4F6", border: "#D1D5DB", icon: "minus-circle"   },
  delay:          { label: "지연",     color: WARN,    bg: "#FEF3C7", border: "#FCD34D", icon: "clock"          },
  critical_delay: { label: "심각 지연", color: DANGER, bg: "#FEE2E2", border: "#FCA5A5", icon: "alert-circle"   },
};

function toInfraStatus(raw: string): InfraStatus {
  const map: Record<string, InfraStatus> = {
    normal: "normal", warning: "warning", danger: "danger",
    full: "full", error: "error", inactive: "inactive",
    delay: "delay", critical_delay: "critical_delay",
  };
  return map[raw] ?? "normal";
}

// ── 포맷 헬퍼 ────────────────────────────────────────────────────────────────
function fmtMb(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return "미측정";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtPct(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return "—";
  return `${pct.toFixed(1)}%`;
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "미측정";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "미측정";
  return n.toLocaleString();
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "확인 없음";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return "방금 전";
  if (s < 3600)  return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

// ── 용량 프로그레스바 ──────────────────────────────────────────────────────────
function UsageBar({ pct, color }: { pct: number; color: string }) {
  const width = `${Math.min(100, Math.max(0, pct))}%`;
  return (
    <View style={bar.track}>
      <View style={[bar.fill, { width: width as any, backgroundColor: color }]} />
    </View>
  );
}
const bar = StyleSheet.create({
  track: { height: 5, borderRadius: 3, backgroundColor: "#E5E7EB", overflow: "hidden", marginTop: 4 },
  fill:  { height: 5, borderRadius: 3 },
});

// ── 핵심 4카드 ────────────────────────────────────────────────────────────────
interface CoreCardProps {
  title: string;
  desc: string;
  icon: string;
  status: InfraStatus;
  usedMb: number | null;
  limitMb: number | null;
  usagePct: number | null;
  latencyMs?: number | null;
  rows: { label: string; value: string | null }[];
  lastChecked: string | null;
  onRefresh: () => void;
  onDetail: () => void;
  refreshing: boolean;
}

function CoreCard({
  title, desc, icon, status,
  usedMb, limitMb, usagePct, latencyMs,
  rows, lastChecked, onRefresh, onDetail, refreshing,
}: CoreCardProps) {
  const cfg = STATUS_CFG[status];
  return (
    <View style={[cc.card, { borderColor: cfg.border, borderWidth: 1.5 }]}>
      {/* 헤더 */}
      <View style={cc.header}>
        <View style={[cc.iconBox, { backgroundColor: cfg.bg }]}>
          <Feather name={icon as any} size={16} color={cfg.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={cc.title}>{title}</Text>
          <Text style={cc.desc} numberOfLines={1}>{desc}</Text>
        </View>
        <View style={[cc.badge, { backgroundColor: cfg.bg }]}>
          <Feather name={cfg.icon as any} size={9} color={cfg.color} />
          <Text style={[cc.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>

      {/* 사용량 */}
      {usedMb !== null && limitMb !== null && usagePct !== null ? (
        <View style={cc.usageBox}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <Text style={cc.usageMain}>{fmtMb(usedMb)} <Text style={cc.usageSub}>/ {fmtMb(limitMb)}</Text></Text>
            <Text style={[cc.pctTxt, { color: cfg.color }]}>{fmtPct(usagePct)}</Text>
          </View>
          <UsageBar pct={usagePct} color={cfg.color} />
        </View>
      ) : null}

      {/* 응답속도 */}
      {latencyMs !== null && latencyMs !== undefined && (
        <View style={cc.latRow}>
          <Feather name="zap" size={11} color={GRAY} />
          <Text style={cc.latTxt}>응답속도 {fmtLatency(latencyMs)}</Text>
        </View>
      )}

      {/* 핵심 지표 행 */}
      <View style={cc.metricsGrid}>
        {rows.filter(r => r.value !== null).map((r, i) => (
          <View key={i} style={cc.metricItem}>
            <Text style={cc.metricLabel}>{r.label}</Text>
            <Text style={cc.metricVal}>{r.value ?? "미측정"}</Text>
          </View>
        ))}
      </View>

      {/* 하단 */}
      <View style={cc.footer}>
        <Text style={cc.checkedTxt}>{fmtAgo(lastChecked)}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Pressable style={cc.footBtn} onPress={onRefresh} disabled={refreshing}>
            {refreshing
              ? <ActivityIndicator size="small" color={P} />
              : <Feather name="refresh-cw" size={12} color={P} />
            }
          </Pressable>
          <Pressable style={[cc.footBtn, { paddingHorizontal: 10 }]} onPress={onDetail}>
            <Text style={cc.detailTxt}>상세보기</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const cc = StyleSheet.create({
  card:       { borderRadius: 14, padding: 14, gap: 10, backgroundColor: "#fff" },
  header:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconBox:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  title:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  desc:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  badge:      { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  usageBox:   { gap: 0 },
  usageMain:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#111827" },
  usageSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  pctTxt:     { fontSize: 13, fontFamily: "Inter_700Bold" },
  latRow:     { flexDirection: "row", alignItems: "center", gap: 4 },
  latTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: GRAY },
  metricsGrid:{ flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metricItem: { backgroundColor: "#F8FAFC", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: "30%" },
  metricLabel:{ fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  metricVal:  { fontSize: 12, fontFamily: "Inter_700Bold", color: "#111827", marginTop: 2 },
  footer:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#F8FAFC", paddingTop: 8 },
  checkedTxt: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  footBtn:    { height: 28, minWidth: 28, borderRadius: 8, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
  detailTxt:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P },
});

// ── 상세 슬라이드 패널 ────────────────────────────────────────────────────────
interface DetailRow { label: string; value: string | null; highlight?: boolean }
function DetailPanel({ title, rows, onClose }: { title: string; rows: DetailRow[]; onClose: () => void }) {
  return (
    <View style={dp.container}>
      <View style={dp.header}>
        <Text style={dp.title}>{title} 상세</Text>
        <Pressable onPress={onClose}>
          <Feather name="x" size={18} color="#111827" />
        </Pressable>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={dp.row}>
          <Text style={dp.key}>{r.label}</Text>
          <Text style={[dp.val, r.highlight ? { color: P, fontFamily: "Inter_700Bold" } : {}]}>
            {r.value ?? "미측정"}
          </Text>
        </View>
      ))}
      <Pressable style={dp.closeBtn} onPress={onClose}>
        <Text style={dp.closeTxt}>닫기</Text>
      </Pressable>
    </View>
  );
}
const dp = StyleSheet.create({
  container: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 0 },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  title:     { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  row:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  key:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF", flex: 1 },
  val:       { fontSize: 13, fontFamily: "Inter_500Medium", color: "#111827", textAlign: "right", flex: 1 },
  closeBtn:  { marginTop: 12, backgroundColor: "#F8FAFC", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  closeTxt:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#111827" },
});

// ── 서비스 행 (그룹 리스트용) ─────────────────────────────────────────────────
interface ServiceItem {
  id: string;
  name: string;
  icon: string;
  status: InfraStatus;
  message: string;
  lastChecked: string | null;
  isPlaceholder?: boolean;
}

function ServiceRow({ sv, refreshing, onRefresh }: {
  sv: ServiceItem;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const cfg = STATUS_CFG[sv.status];
  return (
    <View style={[svc.card,
      sv.status === "error" || sv.status === "full" ? { borderColor: cfg.color, borderWidth: 1.5 } : {}
    ]}>
      <View style={[svc.iconBox, { backgroundColor: cfg.bg }]}>
        <Feather name={sv.icon as any} size={14} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={svc.name}>{sv.name}</Text>
          <View style={[svc.badge, { backgroundColor: cfg.bg }]}>
            <Feather name={cfg.icon as any} size={8} color={cfg.color} />
            <Text style={[svc.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          {sv.isPlaceholder && (
            <View style={svc.placeholder}>
              <Text style={svc.placeholderTxt}>미연결</Text>
            </View>
          )}
        </View>
        <Text style={svc.msg} numberOfLines={1}>{sv.message}</Text>
        <Text style={svc.checked}>{sv.lastChecked ? fmtAgo(sv.lastChecked) : "확인 없음"}</Text>
      </View>
      {!sv.isPlaceholder && (
        <Pressable style={[svc.refreshBtn, refreshing && { opacity: 0.5 }]} disabled={refreshing} onPress={onRefresh}>
          {refreshing
            ? <ActivityIndicator size="small" color={P} />
            : <Feather name="refresh-cw" size={12} color={P} />
          }
        </Pressable>
      )}
    </View>
  );
}

const svc = StyleSheet.create({
  card:        { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: "#FAFAFA", borderWidth: 1, borderColor: "#E5E7EB" },
  iconBox:     { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  name:        { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#111827" },
  badge:       { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  badgeTxt:    { fontSize: 9, fontFamily: "Inter_700Bold" },
  placeholder: { backgroundColor: "#F3F4F6", borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  placeholderTxt: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: GRAY },
  msg:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 1 },
  checked:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 1 },
  refreshBtn:  { width: 28, height: 28, borderRadius: 7, backgroundColor: "#EEDDF5", alignItems: "center", justifyContent: "center" },
});

// ── 그룹 헤더 ────────────────────────────────────────────────────────────────
function GroupHeader({ label, icon, color, bg }: { label: string; icon: string; color: string; bg: string }) {
  return (
    <View style={gh.row}>
      <View style={[gh.iconBox, { backgroundColor: bg }]}>
        <Feather name={icon as any} size={11} color={color} />
      </View>
      <Text style={[gh.label, { color }]}>{label}</Text>
      <View style={gh.line} />
    </View>
  );
}
const gh = StyleSheet.create({
  row:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  iconBox:{ width: 20, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  label:  { fontSize: 11, fontFamily: "Inter_700Bold" },
  line:   { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
});

// ── 이상 감지 아이템 ──────────────────────────────────────────────────────────
interface AnomalyItem { level: "error" | "warning" | "info"; message: string }
function AnomalyRow({ item }: { item: AnomalyItem }) {
  const color = item.level === "error" ? DANGER : item.level === "warning" ? WARN : "#0284C7";
  const bg    = item.level === "error" ? "#FEE2E2" : item.level === "warning" ? "#FEF3C7" : "#EFF6FF";
  const icon  = item.level === "error" ? "x-circle" : item.level === "warning" ? "alert-triangle" : "info";
  return (
    <View style={[anom.row, { backgroundColor: bg }]}>
      <Feather name={icon as any} size={12} color={color} />
      <Text style={[anom.msg, { color }]}>{item.message}</Text>
    </View>
  );
}
const anom = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10 },
  msg: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
});

// ── 이력 아이템 ───────────────────────────────────────────────────────────────
interface HistoryItem { time: string; message: string; ok: boolean }
function HistoryRow({ item }: { item: HistoryItem }) {
  return (
    <View style={hist.row}>
      <Feather name={item.ok ? "check-circle" : "alert-circle"} size={12}
        color={item.ok ? GREEN : DANGER} />
      <Text style={hist.time}>{item.time}</Text>
      <Text style={hist.msg}>{item.message}</Text>
    </View>
  );
}
const hist = StyleSheet.create({
  row:  { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" },
  time: { fontSize: 11, fontFamily: "Inter_500Medium", color: GRAY, minWidth: 42 },
  msg:  { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "#111827" },
});

// ═══════════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ═══════════════════════════════════════════════════════════════════════════
export default function InfraStatusPanel() {
  const { token } = useAuth();
  const [loading,   setLoading]   = useState(false);
  const [summary,   setSummary]   = useState<any>(null);
  const [superDb,   setSuperDb]   = useState<any>(null);
  const [poolDb,    setPoolDb]    = useState<any>(null);
  const [storage,   setStorage]   = useState<any>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  const get = useCallback(async (path: string) => {
    const res = await apiRequest(token, path);
    if (!res.ok) throw new Error(`${path} 오류 ${res.status}`);
    return res.json();
  }, [token]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sum, sdb, pdb, sto] = await Promise.all([
        get("/super/infra-usage/summary"),
        get("/super/infra-usage/super-db"),
        get("/super/infra-usage/pool-db"),
        get("/super/infra-usage/storage"),
      ]);
      setSummary(sum);
      setSuperDb(sdb);
      setPoolDb(pdb);
      setStorage(sto);
    } catch (e: any) {
      setError(e?.message ?? "데이터 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [get]);

  const refreshCard = useCallback(async (key: string) => {
    setRefreshing(r => ({ ...r, [key]: true }));
    try {
      if (key === "super_db" || key === "super_db_svc") {
        const [sum, sdb] = await Promise.all([
          get("/super/infra-usage/summary"),
          get("/super/infra-usage/super-db"),
        ]);
        setSummary(sum); setSuperDb(sdb);
      } else if (key === "pool_db" || key === "pool_db_svc") {
        const [sum, pdb] = await Promise.all([
          get("/super/infra-usage/summary"),
          get("/super/infra-usage/pool-db"),
        ]);
        setSummary(sum); setPoolDb(pdb);
      } else if (key === "photo_storage" || key === "video_storage" || key === "photo_svc" || key === "video_svc") {
        const [sum, sto] = await Promise.all([
          get("/super/infra-usage/summary"),
          get("/super/infra-usage/storage"),
        ]);
        setSummary(sum); setStorage(sto);
      }
    } catch {}
    setRefreshing(r => ({ ...r, [key]: false }));
  }, [get]);

  // 최초 로드
  React.useEffect(() => { loadAll(); }, []);

  // ── 전체 상태 요약 배지 ────────────────────────────────────────────────────
  const totals = summary?.totals ?? { ok_count: 0, warning_count: 0, error_count: 0 };

  // ── 이상 감지 목록 (요약 기반으로 생성) ────────────────────────────────────
  const anomalies: AnomalyItem[] = React.useMemo(() => {
    if (!summary) return [];
    const items: AnomalyItem[] = [];
    const sd = summary.super_db;
    const pd = summary.pool_db;
    const ph = summary.photo_storage;
    const vd = summary.video_storage;

    if (sd?.usage_percent >= 90)    items.push({ level: "error",   message: `슈퍼관리자 DB 용량 ${fmtPct(sd.usage_percent)} — 위험` });
    else if (sd?.usage_percent >= 80) items.push({ level: "warning", message: `슈퍼관리자 DB 용량 ${fmtPct(sd.usage_percent)} — 임박` });
    if (sd?.latency_ms >= 1000)     items.push({ level: "error",   message: `슈퍼관리자 DB 응답 ${fmtLatency(sd.latency_ms)} — 심각 지연` });
    else if (sd?.latency_ms >= 300)  items.push({ level: "warning", message: `슈퍼관리자 DB 응답 ${fmtLatency(sd.latency_ms)} — 지연` });

    if (pd?.usage_percent >= 90)    items.push({ level: "error",   message: `수영장 운영 DB 용량 ${fmtPct(pd.usage_percent)} — 위험` });
    else if (pd?.usage_percent >= 80) items.push({ level: "warning", message: `수영장 운영 DB 용량 ${fmtPct(pd.usage_percent)} — 임박` });
    if (pd?.latency_ms >= 1000)     items.push({ level: "error",   message: `수영장 운영 DB 응답 ${fmtLatency(pd.latency_ms)} — 심각 지연` });

    if (ph?.usage_percent >= 90)    items.push({ level: "error",   message: `사진 저장소 용량 ${fmtPct(ph.usage_percent)} — 위험` });
    else if (ph?.usage_percent >= 80) items.push({ level: "warning", message: `사진 저장소 용량 ${fmtPct(ph.usage_percent)} — 임박` });

    if (vd?.usage_percent >= 90)    items.push({ level: "error",   message: `영상 저장소 용량 ${fmtPct(vd.usage_percent)} — 위험` });
    else if (vd?.usage_percent >= 80) items.push({ level: "warning", message: `영상 저장소 용량 ${fmtPct(vd.usage_percent)} — 임박` });

    if (items.length === 0) items.push({ level: "info", message: "현재 이상 감지된 항목이 없습니다." });
    return items;
  }, [summary]);

  // ── 24h 이력 (현재는 측정 시점 성공/실패로 구성) ────────────────────────────
  const history: HistoryItem[] = React.useMemo(() => {
    if (!superDb && !poolDb && !storage) return [];
    const items: HistoryItem[] = [];
    const now = new Date();
    const fmt = (d: Date) => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    if (superDb?.health?.last_success_at)
      items.push({ time: fmt(new Date(superDb.health.last_success_at)), message: "슈퍼관리자 DB 점검 완료", ok: true });
    if (superDb?.health?.last_failure_at)
      items.push({ time: fmt(new Date(superDb.health.last_failure_at)), message: "슈퍼관리자 DB 점검 실패", ok: false });
    if (poolDb?.health?.last_success_at)
      items.push({ time: fmt(new Date(poolDb.health.last_success_at)), message: "수영장 운영 DB 점검 완료", ok: true });
    if (storage?.photo_storage?.health?.last_success_at)
      items.push({ time: fmt(new Date(storage.photo_storage.health.last_success_at)), message: "사진 저장소 조회 완료", ok: true });
    if (storage?.video_storage?.health?.last_success_at)
      items.push({ time: fmt(new Date(storage.video_storage.health.last_success_at)), message: "영상 저장소 조회 완료", ok: true });
    if (items.length === 0)
      items.push({ time: fmt(now), message: "아직 기록된 이력이 없습니다", ok: true });
    return items;
  }, [superDb, poolDb, storage]);

  // ── 서비스 그룹 A: 플랫폼 운영 인프라 ──────────────────────────────────────
  const groupA: ServiceItem[] = React.useMemo(() => {
    const sd = summary?.super_db;
    const now = summary?.checked_at ?? null;
    return [
      {
        id: "super_db_svc", name: "슈퍼관리자 DB",
        icon: "database", status: toInfraStatus(sd?.status ?? "normal"),
        message: sd ? `${fmtMb(sd.used_mb)} / ${fmtMb(sd.limit_mb)} · ${fmtLatency(sd.latency_ms)}` : "조회 중...",
        lastChecked: sd ? now : null,
      },
      { id: "payment", name: "결제 시스템 (PortOne)", icon: "credit-card", status: "inactive" as InfraStatus,
        message: "연결 설정 필요", lastChecked: null, isPlaceholder: true },
      { id: "otp", name: "OTP/보안 (TOTP)", icon: "shield", status: "normal" as InfraStatus,
        message: "슈퍼관리자 OTP 인증 활성", lastChecked: now },
      { id: "settlement", name: "정산 계좌", icon: "dollar-sign", status: "inactive" as InfraStatus,
        message: "미연결 — 운영자 수익 정산 예정", lastChecked: null, isPlaceholder: true },
      { id: "backup", name: "백업 스토리지", icon: "hard-drive", status: "inactive" as InfraStatus,
        message: "미연결 — 재해 복구 오프사이트 예정", lastChecked: null, isPlaceholder: true },
      { id: "sentry", name: "오류 수집 (Sentry)", icon: "activity", status: "inactive" as InfraStatus,
        message: "SDK 미연결", lastChecked: null, isPlaceholder: true },
      { id: "audit", name: "감사/로그 서버", icon: "file-text", status: "normal" as InfraStatus,
        message: "슈퍼관리자 DB 내 data_change_logs 기록 중", lastChecked: now },
    ];
  }, [summary]);

  // ── 서비스 그룹 B: 수영장 운영 인프라 ──────────────────────────────────────
  const groupB: ServiceItem[] = React.useMemo(() => {
    const pd = summary?.pool_db;
    const ph = summary?.photo_storage;
    const vd = summary?.video_storage;
    const now = summary?.checked_at ?? null;
    return [
      {
        id: "pool_db_svc", name: "수영장 운영 DB",
        icon: "database", status: toInfraStatus(pd?.status ?? "normal"),
        message: pd ? `${fmtMb(pd.used_mb)} / ${fmtMb(pd.limit_mb)} · ${fmtLatency(pd.latency_ms)}` : "조회 중...",
        lastChecked: pd ? now : null,
      },
      {
        id: "photo_svc", name: "사진 저장소",
        icon: "image", status: toInfraStatus(ph?.status ?? "normal"),
        message: ph ? `${fmtCount(ph.file_count)}개 · ${fmtPct(ph.usage_percent)} 사용` : "조회 중...",
        lastChecked: ph ? now : null,
      },
      {
        id: "video_svc", name: "영상 저장소",
        icon: "video", status: toInfraStatus(vd?.status ?? "normal"),
        message: vd ? (vd.enabled_pool_count === 0 ? "비활성 — 유료 플랜 미활성" : `${fmtCount(vd.file_count)}개 · 활성 수영장 ${fmtCount(vd.enabled_pool_count)}개`) : "조회 중...",
        lastChecked: vd ? now : null,
      },
      { id: "cdn", name: "CDN (Cloudflare)", icon: "globe", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "apns", name: "APNs (iOS 푸시)", icon: "bell", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "fcm", name: "FCM (Android 푸시)", icon: "smartphone", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "sms", name: "SMS", icon: "message-square", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "email", name: "Email", icon: "mail", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "phone_auth", name: "휴대폰 인증", icon: "phone", status: "inactive" as InfraStatus,
        message: "미연결", lastChecked: null, isPlaceholder: true },
      { id: "file_upload", name: "파일 업로드 서비스", icon: "upload-cloud", status: "normal" as InfraStatus,
        message: "Cloudflare R2 직접 업로드 동작 중", lastChecked: now },
    ];
  }, [summary]);

  // ── 상세 패널 데이터 ───────────────────────────────────────────────────────
  const detailRows = React.useMemo((): DetailRow[] => {
    if (!detailKey) return [];
    if (detailKey === "super_db" && superDb) {
      const d = superDb;
      return [
        { label: "서비스 키",     value: d.service_key },
        { label: "리전",          value: d.region },
        { label: "상태",          value: d.status_label, highlight: true },
        { label: "메시지",        value: d.message },
        { label: "사용량",        value: `${fmtMb(d.usage?.used_mb)} / ${fmtMb(d.usage?.limit_mb)}` },
        { label: "사용률",        value: fmtPct(d.usage?.usage_percent), highlight: true },
        { label: "응답속도",      value: fmtLatency(d.latency_ms?.current) },
        { label: "테이블 수",     value: fmtCount(d.counts?.table_count) },
        { label: "사용자 수",     value: fmtCount(d.counts?.user_count) },
        { label: "수영장 수",     value: fmtCount(d.counts?.pool_count) },
        { label: "구독 수",       value: fmtCount(d.counts?.subscription_count) },
        { label: "수익 로그",     value: fmtCount(d.counts?.revenue_log_count) },
        { label: "이벤트 로그",   value: fmtCount(d.counts?.pool_event_log_count) },
        { label: "최근 오류 수",  value: d.health?.recent_error_count === 0 ? "오류 없음" : fmtCount(d.health?.recent_error_count) },
        { label: "최근 성공",     value: fmtAgo(d.health?.last_success_at) },
        { label: "경고 임계치",   value: `${d.thresholds?.warning_percent}% / ${d.thresholds?.danger_percent}% / ${d.thresholds?.critical_percent}%` },
      ];
    }
    if (detailKey === "pool_db" && poolDb) {
      const d = poolDb;
      return [
        { label: "서비스 키",     value: d.service_key },
        { label: "리전",          value: d.region },
        { label: "상태",          value: d.status_label, highlight: true },
        { label: "메시지",        value: d.message },
        { label: "사용량",        value: `${fmtMb(d.usage?.used_mb)} / ${fmtMb(d.usage?.limit_mb)}` },
        { label: "사용률",        value: fmtPct(d.usage?.usage_percent), highlight: true },
        { label: "응답속도",      value: fmtLatency(d.latency_ms?.current) },
        { label: "학생 수",       value: fmtCount(d.counts?.student_count) },
        { label: "학부모 수",     value: fmtCount(d.counts?.parent_count) },
        { label: "강사 수",       value: fmtCount(d.counts?.teacher_count) },
        { label: "반 수",         value: fmtCount(d.counts?.class_count) },
        { label: "출결 기록",     value: fmtCount(d.counts?.attendance_count) },
        { label: "수업일지",      value: fmtCount(d.counts?.journal_count) },
        { label: "사진 메타",     value: fmtCount(d.counts?.photo_meta_count) },
        { label: "영상 메타",     value: fmtCount(d.counts?.video_meta_count) },
        { label: "최근 오류 수",  value: d.health?.recent_error_count === 0 ? "오류 없음" : fmtCount(d.health?.recent_error_count) },
      ];
    }
    if (detailKey === "photo_storage" && storage?.photo_storage) {
      const d = storage.photo_storage;
      return [
        { label: "서비스 키",        value: d.service_key },
        { label: "제공사",           value: d.provider },
        { label: "버킷",             value: d.bucket_name },
        { label: "상태",             value: d.status_label, highlight: true },
        { label: "메시지",           value: d.message },
        { label: "사용량",           value: `${fmtMb(d.usage?.used_mb)} / ${fmtMb(d.usage?.limit_mb)}` },
        { label: "사용률",           value: fmtPct(d.usage?.usage_percent), highlight: true },
        { label: "파일 수",          value: fmtCount(d.counts?.file_count) },
        { label: "24h 업로드",       value: fmtCount(d.counts?.upload_count_24h) },
        { label: "24h 삭제",         value: fmtCount(d.counts?.delete_count_24h) },
        { label: "24h 업로드 실패",  value: d.counts?.failed_upload_count_24h === null ? "미측정" : fmtCount(d.counts?.failed_upload_count_24h) },
        { label: "평균 업로드 속도", value: d.performance?.avg_upload_ms === null ? "미측정" : fmtLatency(d.performance?.avg_upload_ms) },
        { label: "최근 오류",        value: d.health?.recent_error_count === 0 ? "오류 없음" : fmtCount(d.health?.recent_error_count) },
        { label: "경고 임계치",      value: `${d.thresholds?.warning_percent}% / ${d.thresholds?.danger_percent}% / ${d.thresholds?.critical_percent}%` },
      ];
    }
    if (detailKey === "video_storage" && storage?.video_storage) {
      const d = storage.video_storage;
      return [
        { label: "서비스 키",       value: d.service_key },
        { label: "제공사",          value: d.provider },
        { label: "버킷",            value: d.bucket_name },
        { label: "기능 상태",       value: d.feature_status === "active" ? "활성" : "비활성", highlight: true },
        { label: "상태",            value: d.status_label },
        { label: "메시지",          value: d.message },
        { label: "사용량",          value: `${fmtMb(d.usage?.used_mb)} / ${fmtMb(d.usage?.limit_mb)}` },
        { label: "사용률",          value: fmtPct(d.usage?.usage_percent), highlight: true },
        { label: "파일 수",         value: fmtCount(d.counts?.file_count) },
        { label: "활성 수영장 수",  value: fmtCount(d.counts?.enabled_pool_count) },
        { label: "24h 업로드",      value: fmtCount(d.counts?.upload_count_24h) },
        { label: "24h 업로드 실패", value: d.counts?.failed_upload_count_24h === null ? "미측정" : fmtCount(d.counts?.failed_upload_count_24h) },
        { label: "최근 오류",       value: d.health?.recent_error_count === 0 ? "오류 없음" : fmtCount(d.health?.recent_error_count) },
        { label: "경고 임계치",     value: `${d.thresholds?.warning_percent}% / ${d.thresholds?.danger_percent}% / ${d.thresholds?.critical_percent}%` },
      ];
    }
    return [];
  }, [detailKey, superDb, poolDb, storage]);

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  if (loading && !summary) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
        <ActivityIndicator color={P} size="large" />
        <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: GRAY }}>인프라 상태 조회 중...</Text>
      </View>
    );
  }

  if (error && !summary) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 30, gap: 10 }}>
        <Feather name="alert-circle" size={24} color={DANGER} />
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: DANGER }}>{error}</Text>
        <Pressable style={{ backgroundColor: "#EEDDF5", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }} onPress={loadAll}>
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: P }}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const sd = summary?.super_db;
  const pd = summary?.pool_db;
  const ph = summary?.photo_storage;
  const vd = summary?.video_storage;

  return (
    <View style={ps.container}>

      {/* ── 헤더 영역 ─────────────────────────────────────────────── */}
      <View style={ps.topHeader}>
        <View style={{ flex: 1 }}>
          <Text style={ps.mainTitle}>플랫폼 인프라 상태</Text>
          <Text style={ps.mainSub}>연결 상태 · 사용량 · 경고 임계치 · 최근 확인 결과</Text>
        </View>
        <Pressable style={ps.refreshAll} onPress={loadAll} disabled={loading}>
          {loading
            ? <ActivityIndicator size="small" color={P} />
            : <Feather name="refresh-cw" size={14} color={P} />
          }
          <Text style={ps.refreshAllTxt}>전체 새로고침</Text>
        </Pressable>
      </View>

      {/* 전체 상태 요약 배지 */}
      <View style={ps.summaryBadgeRow}>
        {[
          { label: `정상 ${totals.ok_count}개`,     color: GREEN,   bg: "#E6FFFA" },
          { label: `주의 ${totals.warning_count}개`, color: WARN,    bg: "#FEF3C7" },
          { label: `오류 ${totals.error_count}개`,   color: DANGER,  bg: "#FEE2E2" },
        ].map((b, i) => (
          <View key={i} style={[ps.summaryBadge, { backgroundColor: b.bg }]}>
            <Text style={[ps.summaryBadgeTxt, { color: b.color }]}>{b.label}</Text>
          </View>
        ))}
      </View>

      {/* ── 핵심 4카드 ────────────────────────────────────────────── */}
      <Text style={ps.groupTitle}>핵심 자원 현황</Text>

      {/* 슈퍼관리자 DB */}
      <CoreCard
        title="슈퍼관리자 DB"
        desc="플랫폼 계정 · 구독 · 결제 · 감사로그 원본"
        icon="database"
        status={toInfraStatus(sd?.status ?? "normal")}
        usedMb={sd?.used_mb ?? null}
        limitMb={sd?.limit_mb ?? null}
        usagePct={sd?.usage_percent ?? null}
        latencyMs={sd?.latency_ms ?? null}
        rows={[
          { label: "테이블",   value: fmtCount(superDb?.counts?.table_count) },
          { label: "사용자",   value: fmtCount(superDb?.counts?.user_count) },
          { label: "수영장",   value: fmtCount(superDb?.counts?.pool_count) },
          { label: "오류",     value: superDb?.health?.recent_error_count === 0 ? "없음" : fmtCount(superDb?.health?.recent_error_count) },
        ]}
        lastChecked={sd?.last_checked_at ?? null}
        refreshing={refreshing["super_db"] ?? false}
        onRefresh={() => refreshCard("super_db")}
        onDetail={() => setDetailKey(detailKey === "super_db" ? null : "super_db")}
      />

      {/* 수영장 운영 DB */}
      <CoreCard
        title="수영장 운영 DB"
        desc="학생 · 반 · 출결 · 일지 · 운영 원본 데이터"
        icon="server"
        status={toInfraStatus(pd?.status ?? "normal")}
        usedMb={pd?.used_mb ?? null}
        limitMb={pd?.limit_mb ?? null}
        usagePct={pd?.usage_percent ?? null}
        latencyMs={pd?.latency_ms ?? null}
        rows={[
          { label: "학생",     value: fmtCount(poolDb?.counts?.student_count) },
          { label: "반",       value: fmtCount(poolDb?.counts?.class_count) },
          { label: "출결",     value: fmtCount(poolDb?.counts?.attendance_count) },
          { label: "일지",     value: fmtCount(poolDb?.counts?.journal_count) },
        ]}
        lastChecked={pd?.last_checked_at ?? null}
        refreshing={refreshing["pool_db"] ?? false}
        onRefresh={() => refreshCard("pool_db")}
        onDetail={() => setDetailKey(detailKey === "pool_db" ? null : "pool_db")}
      />

      {/* 사진 저장소 */}
      <CoreCard
        title="사진 저장소"
        desc="기본 제공 사진 업로드 · 다운로드 압축본 기준"
        icon="image"
        status={toInfraStatus(ph?.status ?? "normal")}
        usedMb={ph?.used_mb ?? null}
        limitMb={ph?.limit_mb ?? null}
        usagePct={ph?.usage_percent ?? null}
        rows={[
          { label: "파일 수",       value: fmtCount(ph?.file_count) },
          { label: "24h 업로드",    value: fmtCount(storage?.photo_storage?.counts?.upload_count_24h) },
          { label: "업로드 속도",   value: storage?.photo_storage?.performance?.avg_upload_ms === null ? "미측정" : fmtLatency(storage?.photo_storage?.performance?.avg_upload_ms) },
          { label: "오류",          value: storage?.photo_storage?.health?.recent_error_count === 0 ? "없음" : fmtCount(storage?.photo_storage?.health?.recent_error_count) },
        ]}
        lastChecked={ph?.last_checked_at ?? null}
        refreshing={refreshing["photo_storage"] ?? false}
        onRefresh={() => refreshCard("photo_storage")}
        onDetail={() => setDetailKey(detailKey === "photo_storage" ? null : "photo_storage")}
      />

      {/* 영상 저장소 */}
      <CoreCard
        title="영상 저장소"
        desc="기본 잠금 · 유료 저장공간 구매 시 활성화"
        icon="video"
        status={storage?.video_storage?.feature_status === "inactive" ? "inactive" : toInfraStatus(vd?.status ?? "normal")}
        usedMb={vd?.used_mb ?? null}
        limitMb={vd?.limit_mb ?? null}
        usagePct={vd?.usage_percent ?? null}
        rows={[
          { label: "파일 수",      value: fmtCount(vd?.file_count) },
          { label: "활성 수영장",  value: fmtCount(vd?.enabled_pool_count) },
          { label: "기능 상태",    value: storage?.video_storage?.feature_status === "active" ? "활성" : "비활성" },
          { label: "오류",         value: storage?.video_storage?.health?.recent_error_count === 0 ? "없음" : fmtCount(storage?.video_storage?.health?.recent_error_count) },
        ]}
        lastChecked={vd?.last_checked_at ?? null}
        refreshing={refreshing["video_storage"] ?? false}
        onRefresh={() => refreshCard("video_storage")}
        onDetail={() => setDetailKey(detailKey === "video_storage" ? null : "video_storage")}
      />

      {/* 상세 패널 (인라인 확장) */}
      {detailKey && detailRows.length > 0 && (
        <DetailPanel
          title={{
            super_db:      "슈퍼관리자 DB",
            pool_db:       "수영장 운영 DB",
            photo_storage: "사진 저장소",
            video_storage: "영상 저장소",
          }[detailKey] ?? detailKey}
          rows={detailRows}
          onClose={() => setDetailKey(null)}
        />
      )}

      {/* ── 서비스 그룹 A: 플랫폼 운영 인프라 ───────────────────── */}
      <View style={ps.groupSection}>
        <GroupHeader label="A. 플랫폼 운영 인프라" icon="layers" color={P} bg="#EEDDF5" />
        {groupA.map(sv => (
          <ServiceRow
            key={sv.id}
            sv={sv}
            refreshing={refreshing[sv.id] ?? false}
            onRefresh={() => refreshCard(sv.id)}
          />
        ))}
      </View>

      {/* ── 서비스 그룹 B: 수영장 운영 인프라 ───────────────────── */}
      <View style={ps.groupSection}>
        <GroupHeader label="B. 수영장 운영 인프라" icon="droplet" color="#0284C7" bg="#E0F2FE" />
        {groupB.map(sv => (
          <ServiceRow
            key={sv.id}
            sv={sv}
            refreshing={refreshing[sv.id] ?? false}
            onRefresh={() => refreshCard(sv.id)}
          />
        ))}
      </View>

      {/* ── 최근 이상 감지 ──────────────────────────────────────── */}
      <View style={ps.subSection}>
        <Text style={ps.subTitle}>최근 이상 감지</Text>
        {anomalies.map((a, i) => <AnomalyRow key={i} item={a} />)}
      </View>

      {/* ── 최근 24시간 상태 이력 ───────────────────────────────── */}
      <View style={ps.subSection}>
        <Text style={ps.subTitle}>최근 24시간 상태 이력</Text>
        {history.map((h, i) => <HistoryRow key={i} item={h} />)}
      </View>

    </View>
  );
}

const ps = StyleSheet.create({
  container:       { gap: 12 },
  topHeader:       { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  mainTitle:       { fontSize: 16, fontFamily: "Inter_700Bold", color: "#111827" },
  mainSub:         { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  refreshAll:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: "#EEDDF5" },
  refreshAllTxt:   { fontSize: 11, fontFamily: "Inter_600SemiBold", color: P },
  summaryBadgeRow: { flexDirection: "row", gap: 6 },
  summaryBadge:    { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  summaryBadgeTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },
  groupTitle:      { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827" },
  groupSection:    { gap: 6 },
  subSection:      { gap: 6, backgroundColor: "#FAFAFA", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  subTitle:        { fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 2 },
});
