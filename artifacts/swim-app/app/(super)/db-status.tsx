/**
 * (super)/db-status.tsx — DB 이원화 모니터링
 * 슈퍼관리자용: 슈퍼관리자 DB / 수영장 운영 DB 용량·이벤트 로그·재시도 큐 현황 조회
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuth, apiRequest } from "@/context/AuthContext";

const P = "#7C3AED";
const GREEN  = "#1F8F86";
const ORANGE = "#D97706";
const RED    = "#D96C6C";
const GRAY   = "#6B7280";

// ── 타입 ──────────────────────────────────────────────────────────
interface DbInfo {
  label: string;
  db_name?: string;
  total_bytes: number;
  total_mb: number;
  note?: string;
  top_tables?: { table: string; bytes: number; pretty: string }[];
}
interface EventLogSummary { total_events: number; pools_with_events: number; last_event_at: string | null }
interface RetryQueueSummary { pending: number; resolved: number; failed: number }
interface StatusData {
  is_separated: boolean;
  checked_at: string;
  super_admin_db: DbInfo;
  pool_ops_db: DbInfo;
  event_logs: EventLogSummary;
  retry_queue: RetryQueueSummary;
}
interface PoolRow {
  pool_id: string; pool_name: string;
  student_count: number; teacher_count: number;
  attendance_count: number; diary_count: number;
}
interface EventLogRow {
  id: string; pool_id: string; event_type: string; entity_type: string;
  entity_id: string | null; actor_id: string | null; actor_name: string | null;
  created_at: string;
}

// ── 포맷 헬퍼 ────────────────────────────────────────────────────
function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "없음";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return `${diff}초 전`;
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 섹션 헤더 ────────────────────────────────────────────────────
function SectionTitle({ icon, title }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string }) {
  return (
    <View style={s.sectionTitle}>
      <Feather name={icon} size={14} color={P} />
      <Text style={s.sectionTitleTxt}>{title}</Text>
    </View>
  );
}

// ── DB 카드 ──────────────────────────────────────────────────────
function DbCard({ info, accent }: { info: DbInfo; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const ratio = Math.min((info.total_mb / 500) * 100, 100);
  const barColor = ratio > 80 ? RED : ratio > 60 ? ORANGE : GREEN;

  return (
    <View style={[s.card, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      <View style={s.cardHeader}>
        <View style={[s.dbIcon, { backgroundColor: accent + "18" }]}>
          <Feather name="database" size={18} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{info.label}</Text>
          {info.db_name && <Text style={s.cardSub}>{info.db_name}</Text>}
          {info.note && <Text style={[s.cardSub, { color: ORANGE }]}>{info.note}</Text>}
        </View>
        <Text style={[s.sizeLabel, { color: barColor }]}>{fmtBytes(info.total_bytes)}</Text>
      </View>
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${ratio}%` as any, backgroundColor: barColor }]} />
      </View>
      <Text style={s.barHint}>{info.total_mb.toFixed(1)} MB 사용</Text>

      {info.top_tables && info.top_tables.length > 0 && (
        <>
          <Pressable style={s.expandBtn} onPress={() => setExpanded(v => !v)}>
            <Text style={s.expandTxt}>테이블 상세 {expanded ? "접기" : "보기"}</Text>
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={13} color={P} />
          </Pressable>
          {expanded && (
            <View style={s.tableList}>
              {info.top_tables.map((t, i) => (
                <View key={t.table} style={[s.tableRow, i % 2 === 1 && { backgroundColor: "#F9F5FF" }]}>
                  <Text style={s.tableName} numberOfLines={1}>{t.table}</Text>
                  <Text style={s.tableSize}>{t.pretty}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ── 이벤트 로그 카드 ─────────────────────────────────────────────
function EventLogCard({ log }: { log: EventLogRow }) {
  const typeColor = (t: string) =>
    t.includes("create") ? GREEN : t.includes("absent") ? ORANGE : t.includes("withdraw") ? RED : GRAY;
  return (
    <View style={s.logRow}>
      <View style={[s.logDot, { backgroundColor: typeColor(log.event_type) }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.logType}>{log.event_type}</Text>
        <Text style={s.logMeta}>{log.entity_type} · {log.entity_id?.slice(0, 12) ?? "-"}</Text>
      </View>
      <Text style={s.logTime}>{fmtTime(log.created_at)}</Text>
    </View>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────
export default function DbStatusScreen() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"overview" | "pools" | "events">("overview");

  const [status, setStatus]     = useState<StatusData | null>(null);
  const [pools, setPools]       = useState<PoolRow[]>([]);
  const [events, setEvents]     = useState<EventLogRow[]>([]);
  const [error, setError]       = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [r1, r2, r3] = await Promise.all([
        apiRequest(token, "/super/db-status"),
        apiRequest(token, "/super/db-status/pools"),
        apiRequest(token, "/super/db-status/event-logs?limit=30"),
      ]);
      if (r1.ok) setStatus(await r1.json());
      if (r2.ok) { const d = await r2.json(); setPools(d.pools ?? []); }
      if (r3.ok) { const d = await r3.json(); setEvents(d.logs ?? []); }
      if (!r1.ok) setError("DB 상태 조회에 실패했습니다.");
    } catch (e) {
      setError("서버 연결 오류가 발생했습니다.");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const TABS = [
    { key: "overview", label: "DB 개요" },
    { key: "pools",    label: "수영장별" },
    { key: "events",   label: "이벤트 로그" },
  ] as const;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="DB 이원화 모니터링" />

      {/* 탭 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={P} size="large" /></View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={40} color={RED} />
          <Text style={s.errTxt}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={onRefresh}>
            <Text style={s.retryTxt}>다시 시도</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={P} />}
        >
          {/* ── 개요 탭 ── */}
          {tab === "overview" && status && (
            <>
              {/* 분리 상태 배너 */}
              <View style={[s.separationBanner, { backgroundColor: status.is_separated ? "#DDF2EF" : "#FFF8E6" }]}>
                <Feather
                  name={status.is_separated ? "check-circle" : "alert-circle"}
                  size={16}
                  color={status.is_separated ? GREEN : ORANGE}
                />
                <Text style={[s.separationTxt, { color: status.is_separated ? GREEN : ORANGE }]}>
                  {status.is_separated
                    ? "슈퍼관리자 DB · 수영장 운영 DB 물리 분리 완료"
                    : "현재 단일 DB 운영 중 — POOL_DATABASE_URL 등록 시 물리 분리 활성화"}
                </Text>
              </View>

              <SectionTitle icon="database" title="DB 용량 현황" />
              <DbCard info={status.super_admin_db} accent={P} />
              <DbCard info={status.pool_ops_db}    accent={GREEN} />

              {/* 이벤트 요약 */}
              <SectionTitle icon="activity" title="이벤트 복제 현황" />
              <View style={s.statsGrid}>
                <View style={s.statBox}>
                  <Text style={s.statNum}>{status.event_logs.total_events.toLocaleString()}</Text>
                  <Text style={s.statLabel}>총 이벤트</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={s.statNum}>{status.event_logs.pools_with_events}</Text>
                  <Text style={s.statLabel}>연동 수영장</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={[s.statNum, status.retry_queue.pending > 0 && { color: ORANGE }]}>
                    {status.retry_queue.pending}
                  </Text>
                  <Text style={s.statLabel}>재시도 대기</Text>
                </View>
                <View style={s.statBox}>
                  <Text style={[s.statNum, status.retry_queue.failed > 0 && { color: RED }]}>
                    {status.retry_queue.failed}
                  </Text>
                  <Text style={s.statLabel}>최종 실패</Text>
                </View>
              </View>

              {status.retry_queue.pending > 0 && (
                <View style={s.warnBanner}>
                  <Feather name="alert-triangle" size={14} color={ORANGE} />
                  <Text style={s.warnTxt}>
                    재시도 대기 이벤트 {status.retry_queue.pending}건 — 서버 재시작 시 자동 재처리됩니다.
                  </Text>
                </View>
              )}
              {status.retry_queue.failed > 0 && (
                <View style={[s.warnBanner, { backgroundColor: "#FDE8E8" }]}>
                  <Feather name="x-circle" size={14} color={RED} />
                  <Text style={[s.warnTxt, { color: RED }]}>
                    최대 재시도 초과 {status.retry_queue.failed}건 — 수동 확인이 필요합니다.
                  </Text>
                </View>
              )}

              <Text style={s.checkedAt}>
                마지막 조회: {fmtTime(status.checked_at)}
              </Text>
            </>
          )}

          {/* ── 수영장별 탭 ── */}
          {tab === "pools" && (
            <>
              <SectionTitle icon="layers" title="수영장별 운영 데이터 현황" />
              {pools.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Feather name="inbox" size={40} color="#D1D5DB" />
                  <Text style={s.emptyTxt}>데이터가 없습니다.</Text>
                </View>
              ) : pools.map(p => (
                <View key={p.pool_id} style={s.poolCard}>
                  <Text style={s.poolName} numberOfLines={1}>{p.pool_name}</Text>
                  <View style={s.poolStats}>
                    <PoolStat icon="users" value={p.student_count} label="학생" color={P} />
                    <PoolStat icon="user-check" value={p.teacher_count} label="선생님" color={GREEN} />
                    <PoolStat icon="check-square" value={p.attendance_count} label="출결" color={ORANGE} />
                    <PoolStat icon="book-open" value={p.diary_count} label="수업일지" color={GRAY} />
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ── 이벤트 로그 탭 ── */}
          {tab === "events" && (
            <>
              <SectionTitle icon="list" title="최근 이벤트 로그 (최대 30건)" />
              {events.length === 0 ? (
                <View style={s.emptyWrap}>
                  <Feather name="inbox" size={40} color="#D1D5DB" />
                  <Text style={s.emptyTxt}>아직 이벤트 로그가 없습니다.</Text>
                  <Text style={[s.emptyTxt, { fontSize: 12, marginTop: 4 }]}>
                    회원 등록·학생 추가·출결 처리 시 자동으로 기록됩니다.
                  </Text>
                </View>
              ) : (
                <View style={s.logList}>
                  {events.map(e => <EventLogCard key={e.id} log={e} />)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PoolStat({ icon, value, label, color }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  value: number; label: string; color: string;
}) {
  return (
    <View style={ps.wrap}>
      <Feather name={icon} size={13} color={color} />
      <Text style={[ps.num, { color }]}>{value.toLocaleString()}</Text>
      <Text style={ps.label}>{label}</Text>
    </View>
  );
}
const ps = StyleSheet.create({
  wrap:  { alignItems: "center", flex: 1, gap: 2 },
  num:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  label: { fontSize: 10, color: GRAY, fontFamily: "Inter_400Regular" },
});

// ── 스타일 ────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#F8F7FF" },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errTxt:  { fontSize: 14, color: RED, textAlign: "center", fontFamily: "Inter_400Regular" },
  retryBtn:{ backgroundColor: P, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryTxt:{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },

  tabBar:    { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:       { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: P },
  tabTxt:    { fontSize: 13, color: GRAY, fontFamily: "Inter_500Medium" },
  tabTxtActive: { color: P, fontFamily: "Inter_600SemiBold" },

  sectionTitle:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  sectionTitleTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#374151" },

  separationBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  separationTxt:    { fontSize: 12, fontFamily: "Inter_500Medium", flex: 1 },
  warnBanner:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#FFF8E6" },
  warnTxt:          { fontSize: 12, color: ORANGE, fontFamily: "Inter_400Regular", flex: 1 },

  card:      { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  dbIcon:    { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1F2937" },
  cardSub:   { fontSize: 11, color: GRAY, fontFamily: "Inter_400Regular", marginTop: 1 },
  sizeLabel: { fontSize: 15, fontFamily: "Inter_700Bold" },
  barBg:     { height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden" },
  barFill:   { height: 6, borderRadius: 3 },
  barHint:   { fontSize: 11, color: GRAY, fontFamily: "Inter_400Regular" },
  expandBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  expandTxt: { fontSize: 12, color: P, fontFamily: "Inter_500Medium" },
  tableList: { gap: 0, borderRadius: 8, overflow: "hidden", marginTop: 4 },
  tableRow:  { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 8 },
  tableName: { flex: 1, fontSize: 12, color: "#374151", fontFamily: "Inter_400Regular" },
  tableSize: { fontSize: 12, color: GRAY, fontFamily: "Inter_500Medium" },

  statsGrid: { flexDirection: "row", gap: 8 },
  statBox:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", gap: 2, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  statNum:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#1F2937" },
  statLabel: { fontSize: 10, color: GRAY, fontFamily: "Inter_400Regular" },

  checkedAt: { fontSize: 11, color: "#9CA3AF", textAlign: "center", fontFamily: "Inter_400Regular" },

  poolCard:  { backgroundColor: "#fff", borderRadius: 14, padding: 14, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  poolName:  { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F2937", marginBottom: 10 },
  poolStats: { flexDirection: "row" },

  logList: { gap: 0, backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  logRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  logDot:  { width: 8, height: 8, borderRadius: 4 },
  logType: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F2937" },
  logMeta: { fontSize: 11, color: GRAY, fontFamily: "Inter_400Regular" },
  logTime: { fontSize: 11, color: GRAY, fontFamily: "Inter_400Regular" },

  emptyWrap: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:  { fontSize: 14, color: GRAY, fontFamily: "Inter_400Regular", textAlign: "center" },
});
