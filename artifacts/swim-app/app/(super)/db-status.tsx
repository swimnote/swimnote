/**
 * (super)/db-status.tsx — DB 이원화 모니터링 (4탭)
 * 탭: DB 개요 / 수영장별 / 이벤트 로그 / 서비스 상태
 */
import { CircleAlert, CircleCheck, CircleX, Database, Inbox, RefreshCw, TriangleAlert } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { useAuth, apiRequest } from "@/context/AuthContext";

const P      = "#7C3AED";
const GREEN  = "#2EC4B6";
const ORANGE = "#D97706";
const RED    = "#D96C6C";
const GRAY   = "#64748B";
const BLUE   = "#2563EB";

// ── 타입 ──────────────────────────────────────────────────────────
interface DbInfo {
  label: string; db_name?: string;
  total_bytes: number; total_mb: number; pretty?: string; note?: string;
  top_tables?: { table: string; bytes: number; pretty: string; index_size?: string }[];
  error?: string;
}
interface ConnectionInfo { label: string; ok: boolean; latency_ms?: number; error?: string; note?: string }
interface StatusData {
  is_separated: boolean; checked_at: string;
  connections?: { super_admin_db: ConnectionInfo; pool_ops_db: ConnectionInfo | null };
  super_admin_db: DbInfo; pool_ops_db: DbInfo;
  event_logs:   { total_events: number; pools_with_events: number; last_event_at: string | null };
  retry_queue:  { pending: number; resolved: number; exhausted: number };
  dead_letter_queue: { pending: number; resolved: number };
}
interface PoolRow {
  pool_id: string; pool_name: string;
  student_count: number; teacher_count: number;
  attendance_count: number; diary_count: number;
}
interface EventLogRow {
  id: string; pool_id: string; event_type: string; entity_type: string;
  entity_id: string | null; actor_id: string | null; actor_name: string | null;
  created_at: string; source?: string;
}
interface DlqItem {
  id: string; pool_id: string; event_type: string; entity_type: string;
  entity_id: string | null; actor_id: string | null;
  original_error: string | null; total_retries: number;
  resolved: boolean; resolved_at: string | null; resolved_by: string | null;
  created_at: string;
}
interface DiagData {
  status: "healthy" | "degraded" | "critical";
  duration_ms: number; is_separated: boolean;
  connections: { super_admin_db: ConnectionInfo; pool_ops_db: ConnectionInfo | null };
  events: { by_type: { event_type: string; cnt: number }[]; last_24h: number };
  retry_queue: { pending: number; exhausted: number; avg_retries: number };
  dead_letter_queue: { unresolved: number };
  pool_change_logs: { count: number; error: string | null };
  recommendations: string[];
}

// ── 포맷 헬퍼 ────────────────────────────────────────────────────
function fmtBytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} KB`;
  return `${bytes} B`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "없음";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return `${diff}초 전`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 공통 컴포넌트 ──────────────────────────────────────────────────
function SectionTitle({ icon, title }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string }) {
  return (
    <View style={s.sectionTitle}>
      <LucideIcon name={icon} size={14} color={P} />
      <Text style={s.sectionTitleTxt}>{title}</Text>
    </View>
  );
}

function StatusPill({ ok, label, latency }: { ok: boolean; label: string; latency?: number }) {
  return (
    <View style={[s.pill, { backgroundColor: ok ? "#E6FFFA" : "#FDE8E8" }]}>
      <View style={[s.pillDot, { backgroundColor: ok ? GREEN : RED }]} />
      <Text style={[s.pillTxt, { color: ok ? GREEN : RED }]}>{label}</Text>
      {latency !== undefined && <Text style={s.pillLatency}>{latency}ms</Text>}
    </View>
  );
}

// ── DB 카드 ───────────────────────────────────────────────────────
function DbCard({ info, accent }: { info: DbInfo; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  const ratio = Math.min((info.total_mb / 500) * 100, 100);
  const barColor = ratio > 80 ? RED : ratio > 60 ? ORANGE : GREEN;
  return (
    <View style={[s.card, { borderLeftColor: accent, borderLeftWidth: 4 }]}>
      <View style={s.cardHeader}>
        <View style={[s.dbIcon, { backgroundColor: accent + "18" }]}>
          <Database size={18} color={accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{info.label}</Text>
          {info.db_name && <Text style={s.cardSub}>{info.db_name}</Text>}
          {info.note   && <Text style={[s.cardSub, { color: ORANGE }]}>{info.note}</Text>}
          {info.error  && <Text style={[s.cardSub, { color: RED }]}>오류: {info.error.slice(0, 60)}</Text>}
        </View>
        <Text style={[s.sizeLabel, { color: barColor }]}>{fmtBytes(info.total_bytes)}</Text>
      </View>
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${ratio}%` as any, backgroundColor: barColor }]} />
      </View>
      <Text style={s.barHint}>{info.total_mb.toFixed(1)} MB 사용 / 500 MB 기준</Text>

      {info.top_tables && info.top_tables.length > 0 && (
        <>
          <Pressable style={s.expandBtn} onPress={() => setExpanded(v => !v)}>
            <Text style={s.expandTxt}>테이블 상세 {expanded ? "접기" : "보기"}</Text>
            <LucideIcon name={expanded ? "chevron-up" : "chevron-down"} size={13} color={P} />
          </Pressable>
          {expanded && (
            <View style={s.tableList}>
              {info.top_tables.map((t, i) => (
                <View key={t.table} style={[s.tableRow, i % 2 === 1 && { backgroundColor: "#F9F5FF" }]}>
                  <Text style={s.tableName} numberOfLines={1}>{t.table}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={s.tableSize}>{t.pretty}</Text>
                    {t.index_size && <Text style={[s.tableSize, { fontSize: 9, color: "#64748B" }]}>idx {t.index_size}</Text>}
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ── 이벤트 로그 카드 ──────────────────────────────────────────────
function EventLogCard({ log }: { log: EventLogRow }) {
  const typeColor = (t: string) =>
    t.includes("create") ? GREEN :
    t.includes("absent") || t.includes("late") ? ORANGE :
    t.includes("withdraw") || t.includes("delete") ? RED :
    t.includes("change") || t.includes("assign") ? BLUE : GRAY;
  return (
    <View style={s.logRow}>
      <View style={[s.logDot, { backgroundColor: typeColor(log.event_type) }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.logType}>{log.event_type}</Text>
        <Text style={s.logMeta}>{log.entity_type}{log.actor_name ? ` · ${log.actor_name}` : ""}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={s.logTime}>{fmtTime(log.created_at)}</Text>
        {log.source && log.source !== "pool_ops" && (
          <Text style={[s.logTime, { color: ORANGE, fontSize: 10 }]}>{log.source}</Text>
        )}
      </View>
    </View>
  );
}

// ── DLQ 카드 ────────────────────────────────────────────────────────
function DlqCard({ item, onResend }: { item: DlqItem; onResend: (id: string) => void }) {
  return (
    <View style={s.dlqCard}>
      <View style={s.dlqHeader}>
        <View style={[s.logDot, { backgroundColor: RED, marginTop: 4 }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.logType}>{item.event_type}</Text>
          <Text style={s.logMeta}>{item.entity_type} · {item.pool_id.slice(0, 10)}…</Text>
          {item.original_error && (
            <Text style={s.dlqError} numberOfLines={2}>{item.original_error}</Text>
          )}
          <Text style={[s.logTime, { marginTop: 2 }]}>
            재시도 {item.total_retries}회 · {fmtTime(item.created_at)}
          </Text>
        </View>
        <Pressable
          style={s.resendBtn}
          onPress={() => onResend(item.id)}
        >
          <RefreshCw size={13} color={P} />
          <Text style={s.resendTxt}>재전송</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
type Tab = "overview" | "pools" | "events" | "service";

export default function DbStatusScreen() {
  const { token } = useAuth();
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab]               = useState<Tab>("overview");

  const [status, setStatus]   = useState<StatusData | null>(null);
  const [pools, setPools]     = useState<PoolRow[]>([]);
  const [events, setEvents]   = useState<EventLogRow[]>([]);
  const [dlq, setDlq]         = useState<DlqItem[]>([]);
  const [diag, setDiag]       = useState<DiagData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        apiRequest(token, "/super/db-status"),
        apiRequest(token, "/super/db-status/pools"),
        apiRequest(token, "/super/db-status/event-logs?limit=40"),
        apiRequest(token, "/super/db-status/dead-letters?resolved=false&limit=30"),
        apiRequest(token, "/super/db-status/diagnostic"),
      ]);
      if (r1.ok) setStatus(await r1.json());
      if (r2.ok) { const d = await r2.json(); setPools(d.pools ?? []); }
      if (r3.ok) { const d = await r3.json(); setEvents(d.logs ?? []); }
      if (r4.ok) { const d = await r4.json(); setDlq(d.items ?? []); }
      if (r5.ok) setDiag(await r5.json());
      if (!r1.ok) setError("DB 상태 조회에 실패했습니다.");
    } catch {
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

  const handleResend = useCallback(async (id: string) => {
    Alert.alert("DLQ 재전송", "이 이벤트를 수동으로 재전송하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "재전송",
        style: "destructive",
        onPress: async () => {
          setResending(id);
          try {
            const r = await apiRequest(token!, `/super/db-status/dead-letters/${id}/resend`, "POST");
            if (r.ok) {
              Alert.alert("성공", "이벤트가 재전송되었습니다.");
              setDlq(prev => prev.filter(i => i.id !== id));
              if (status) {
                setStatus(prev => prev ? {
                  ...prev,
                  dead_letter_queue: {
                    pending: Math.max(0, prev.dead_letter_queue.pending - 1),
                    resolved: prev.dead_letter_queue.resolved + 1,
                  },
                } : null);
              }
            } else {
              const d = await r.json();
              Alert.alert("실패", d.error ?? "재전송에 실패했습니다.");
            }
          } catch {
            Alert.alert("오류", "서버 연결 오류가 발생했습니다.");
          } finally {
            setResending(null);
          }
        },
      },
    ]);
  }, [token, status]);

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "DB 개요" },
    { key: "pools",    label: "수영장별" },
    { key: "events",   label: "이벤트" },
    { key: "service",  label: "서비스 상태" },
  ];

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <SubScreenHeader title="DB 이원화 모니터링" />

      {/* 탭 바 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t.key} style={[s.tab, tab === t.key && s.tabActive]} onPress={() => setTab(t.key)}>
            <Text style={[s.tabTxt, tab === t.key && s.tabTxtActive]}>{t.label}</Text>
            {t.key === "service" && (status?.dead_letter_queue.pending ?? 0) > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeTxt}>{status!.dead_letter_queue.pending}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={P} size="large" /></View>
      ) : error ? (
        <View style={s.center}>
          <CircleAlert size={40} color={RED} />
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
          {/* ══ 1. DB 개요 탭 ══ */}
          {tab === "overview" && status && (
            <>
              {/* DB 분리 상태 배너 */}
              <View style={[s.separationBanner, { backgroundColor: status.is_separated ? "#E6FFFA" : "#FFF8E6" }]}>
                <LucideIcon name={status.is_separated ? "check-circle" : "alert-circle"} size={16} color={status.is_separated ? GREEN : ORANGE} />
                <Text style={[s.separationTxt, { color: status.is_separated ? GREEN : ORANGE }]}>
                  {status.is_separated
                    ? "슈퍼관리자 DB · 수영장 운영 DB 물리 분리 완료"
                    : "단일 DB 운영 중 — POOL_DATABASE_URL 등록 시 물리 분리 활성화"}
                </Text>
              </View>

              {/* 2계층 연결 상태 */}
              {status.connections && (
                <>
                  <SectionTitle icon="activity" title="DB 연결 상태" />
                  <View style={s.connGrid}>
                    <View style={s.connCard}>
                      <Text style={s.connLabel}>슈퍼관리자용</Text>
                      <StatusPill
                        ok={status.connections.super_admin_db?.ok ?? true}
                        label={status.connections.super_admin_db?.ok ? "정상" : "오류"}
                        latency={status.connections.super_admin_db?.latency_ms}
                      />
                    </View>
                    <View style={s.connCard}>
                      <Text style={s.connLabel}>유저서비스용</Text>
                      <StatusPill
                        ok={status.connections.pool_ops_db?.ok ?? true}
                        label={status.connections.pool_ops_db?.note ?? (status.connections.pool_ops_db?.ok ? "정상" : "오류")}
                        latency={status.connections.pool_ops_db?.latency_ms}
                      />
                    </View>
                  </View>
                </>
              )}

              <SectionTitle icon="database" title="DB 용량 현황" />
              <DbCard info={status.super_admin_db} accent={P} />
              <DbCard info={status.pool_ops_db}    accent={GREEN} />

              {/* 이벤트 + DLQ 요약 */}
              <SectionTitle icon="zap" title="이벤트 복제 현황" />
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
                  <Text style={[s.statNum, status.dead_letter_queue.pending > 0 && { color: RED }]}>
                    {status.dead_letter_queue.pending}
                  </Text>
                  <Text style={s.statLabel}>DLQ 미처리</Text>
                </View>
              </View>

              {status.retry_queue.pending > 0 && (
                <View style={s.warnBanner}>
                  <TriangleAlert size={14} color={ORANGE} />
                  <Text style={s.warnTxt}>재시도 대기 {status.retry_queue.pending}건 — 백그라운드에서 자동 재처리됩니다.</Text>
                </View>
              )}
              {status.dead_letter_queue.pending > 0 && (
                <View style={[s.warnBanner, { backgroundColor: "#FDE8E8" }]}>
                  <CircleX size={14} color={RED} />
                  <Text style={[s.warnTxt, { color: RED }]}>
                    Dead-letter queue {status.dead_letter_queue.pending}건 — 서비스 상태 탭에서 수동 재전송하세요.
                  </Text>
                </View>
              )}

              <Text style={s.checkedAt}>마지막 조회: {fmtTime(status.checked_at)}</Text>
            </>
          )}

          {/* ══ 2. 수영장별 탭 ══ */}
          {tab === "pools" && (
            <>
              <SectionTitle icon="layers" title="수영장별 운영 데이터 현황" />
              {pools.length === 0 ? (
                <EmptyState text="데이터가 없습니다." />
              ) : pools.map(p => (
                <View key={p.pool_id} style={s.poolCard}>
                  <Text style={s.poolName} numberOfLines={1}>{p.pool_name}</Text>
                  <View style={s.poolStats}>
                    <PoolStat icon="users"       value={p.student_count}    label="학생"    color={P} />
                    <PoolStat icon="user-check"  value={p.teacher_count}    label="선생님"  color={GREEN} />
                    <PoolStat icon="check-square" value={p.attendance_count} label="출결"   color={ORANGE} />
                    <PoolStat icon="book-open"   value={p.diary_count}      label="수업일지" color={GRAY} />
                  </View>
                </View>
              ))}
            </>
          )}

          {/* ══ 3. 이벤트 로그 탭 ══ */}
          {tab === "events" && (
            <>
              <SectionTitle icon="list" title={`최근 이벤트 로그 (${events.length}건)`} />
              {events.length === 0 ? (
                <EmptyState
                  text="아직 이벤트 로그가 없습니다."
                  sub="회원 등록·학생 추가·출결 처리 시 자동으로 기록됩니다."
                />
              ) : (
                <View style={s.logList}>
                  {events.map(e => <EventLogCard key={e.id} log={e} />)}
                </View>
              )}
            </>
          )}

          {/* ══ 4. 서비스 상태 탭 ══ */}
          {tab === "service" && (
            <>
              {/* 진단 요약 */}
              {diag && (
                <>
                  <SectionTitle icon="shield" title="시스템 진단 요약" />
                  <View style={[s.diagBanner, {
                    backgroundColor: diag.status === "healthy" ? "#E6FFFA" : diag.status === "degraded" ? "#FFF8E6" : "#FDE8E8",
                  }]}>
                    <LucideIcon
                      name={diag.status === "healthy" ? "check-circle" : diag.status === "degraded" ? "alert-triangle" : "x-circle"}
                      size={20}
                      color={diag.status === "healthy" ? GREEN : diag.status === "degraded" ? ORANGE : RED}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.diagStatusTxt, {
                        color: diag.status === "healthy" ? GREEN : diag.status === "degraded" ? ORANGE : RED,
                      }]}>
                        {diag.status === "healthy" ? "정상 운영 중" : diag.status === "degraded" ? "주의 필요" : "즉각 조치 필요"}
                      </Text>
                      <Text style={s.diagSubTxt}>진단 소요: {diag.duration_ms}ms</Text>
                    </View>
                  </View>

                  {/* 2계층 연결 상태 */}
                  <SectionTitle icon="wifi" title="서비스 연결 상태" />
                  <View style={s.connGrid}>
                    <View style={s.connCard}>
                      <Text style={s.connLabel}>슈퍼관리자용 DB</Text>
                      <StatusPill
                        ok={diag.connections.super_admin_db?.ok}
                        label={diag.connections.super_admin_db?.ok ? "연결됨" : "연결 실패"}
                        latency={diag.connections.super_admin_db?.latency_ms}
                      />
                    </View>
                    <View style={s.connCard}>
                      <Text style={s.connLabel}>유저서비스용 DB</Text>
                      <StatusPill
                        ok={diag.connections.pool_ops_db?.ok ?? true}
                        label={diag.connections.pool_ops_db?.note ?? (diag.connections.pool_ops_db?.ok ? "연결됨" : "연결 실패")}
                        latency={diag.connections.pool_ops_db?.latency_ms}
                      />
                    </View>
                  </View>

                  {/* 24h 이벤트 + pool_change_logs */}
                  <View style={s.statsGrid}>
                    <View style={s.statBox}>
                      <Text style={s.statNum}>{diag.events.last_24h}</Text>
                      <Text style={s.statLabel}>24h 이벤트</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statNum, diag.retry_queue.pending > 0 && { color: ORANGE }]}>
                        {diag.retry_queue.pending}
                      </Text>
                      <Text style={s.statLabel}>재시도 대기</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statNum, diag.dead_letter_queue.unresolved > 0 && { color: RED }]}>
                        {diag.dead_letter_queue.unresolved}
                      </Text>
                      <Text style={s.statLabel}>DLQ 미처리</Text>
                    </View>
                    <View style={s.statBox}>
                      <Text style={[s.statNum, diag.pool_change_logs.error && { color: ORANGE }]}>
                        {diag.pool_change_logs.error ? "오류" : diag.pool_change_logs.count.toLocaleString()}
                      </Text>
                      <Text style={s.statLabel}>변경 로그</Text>
                    </View>
                  </View>

                  {/* 이벤트 타입별 통계 */}
                  {diag.events.by_type.length > 0 && (
                    <>
                      <SectionTitle icon="bar-chart-2" title="이벤트 타입별 누적" />
                      <View style={s.card}>
                        {diag.events.by_type.slice(0, 8).map((row, i) => (
                          <View key={row.event_type} style={[s.typeRow, i > 0 && { borderTopWidth: 1, borderTopColor: "#F3F4F6" }]}>
                            <Text style={s.typeLabel} numberOfLines={1}>{row.event_type}</Text>
                            <Text style={[s.typeCnt, { color: P }]}>{row.cnt.toLocaleString()}</Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {/* 권고사항 */}
                  {diag.recommendations.length > 0 && (
                    <>
                      <SectionTitle icon="info" title="권고사항" />
                      {diag.recommendations.map((rec, i) => (
                        <View key={i} style={s.recCard}>
                          <TriangleAlert size={13} color={ORANGE} />
                          <Text style={s.recTxt}>{rec}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}

              {/* Dead-letter Queue */}
              <SectionTitle icon="inbox" title={`Dead-letter Queue (${dlq.length}건 미처리)`} />
              {dlq.length === 0 ? (
                <View style={[s.emptyWrap, { backgroundColor: "#E6FFFA", borderRadius: 12, paddingVertical: 20 }]}>
                  <CircleCheck size={28} color={GREEN} />
                  <Text style={[s.emptyTxt, { color: GREEN }]}>미처리 이벤트 없음</Text>
                </View>
              ) : (
                <>
                  <View style={[s.warnBanner, { backgroundColor: "#FDE8E8" }]}>
                    <CircleAlert size={14} color={RED} />
                    <Text style={[s.warnTxt, { color: RED }]}>
                      최대 재시도 초과 이벤트 {dlq.length}건 — 수동 재전송 또는 원인 확인이 필요합니다.
                    </Text>
                  </View>
                  {dlq.map(item => (
                    <DlqCard
                      key={item.id}
                      item={item}
                      onResend={resending ? () => {} : handleResend}
                    />
                  ))}
                  {resending && (
                    <View style={s.center}>
                      <ActivityIndicator color={P} size="small" />
                      <Text style={s.diagSubTxt}>재전송 중…</Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 보조 컴포넌트 ─────────────────────────────────────────────────
function PoolStat({ icon, value, label, color }: {
  icon: React.ComponentProps<typeof Feather>["name"];
  value: number; label: string; color: string;
}) {
  return (
    <View style={ps.wrap}>
      <LucideIcon name={icon} size={13} color={color} />
      <Text style={[ps.num, { color }]}>{value.toLocaleString()}</Text>
      <Text style={ps.label}>{label}</Text>
    </View>
  );
}
function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={s.emptyWrap}>
      <Inbox size={40} color="#D1D5DB" />
      <Text style={s.emptyTxt}>{text}</Text>
      {sub && <Text style={[s.emptyTxt, { fontSize: 12, marginTop: 4 }]}>{sub}</Text>}
    </View>
  );
}

const ps = StyleSheet.create({
  wrap:  { alignItems: "center", flex: 1, gap: 2 },
  num:   { fontSize: 15, fontFamily: "Pretendard-Regular" },
  label: { fontSize: 10, color: GRAY, fontFamily: "Pretendard-Regular" },
});

// ── 스타일 ────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: "#F8F7FF" },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  center:  { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errTxt:  { fontSize: 14, color: RED, textAlign: "center", fontFamily: "Pretendard-Regular" },
  retryBtn:{ backgroundColor: P, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  retryTxt:{ color: "#fff", fontFamily: "Pretendard-Regular", fontSize: 14 },

  tabBar:    { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  tab:       { flex: 1, paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: P },
  tabTxt:    { fontSize: 12, color: GRAY, fontFamily: "Pretendard-Regular" },
  tabTxtActive: { color: P, fontFamily: "Pretendard-Regular" },
  badge:     { backgroundColor: RED, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeTxt:  { color: "#fff", fontSize: 9, fontFamily: "Pretendard-Regular" },

  sectionTitle:    { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  sectionTitleTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#374151" },

  separationBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10 },
  separationTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  warnBanner:       { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, backgroundColor: "#FFF8E6" },
  warnTxt:          { fontSize: 12, color: ORANGE, fontFamily: "Pretendard-Regular", flex: 1 },

  connGrid:  { flexDirection: "row", gap: 8 },
  connCard:  { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, gap: 8, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  connLabel: { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular" },
  pill:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, alignSelf: "flex-start" },
  pillDot:   { width: 6, height: 6, borderRadius: 3 },
  pillTxt:   { fontSize: 12, fontFamily: "Pretendard-Regular" },
  pillLatency:{ fontSize: 10, color: GRAY, fontFamily: "Pretendard-Regular" },

  card:      { backgroundColor: "#fff", borderRadius: 14, padding: 16, gap: 8, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  dbIcon:    { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  cardSub:   { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular", marginTop: 1 },
  sizeLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  barBg:     { height: 6, backgroundColor: "#F3F4F6", borderRadius: 3, overflow: "hidden" },
  barFill:   { height: 6, borderRadius: 3 },
  barHint:   { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular" },
  expandBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  expandTxt: { fontSize: 12, color: P, fontFamily: "Pretendard-Regular" },
  tableList: { gap: 0, borderRadius: 8, overflow: "hidden", marginTop: 4 },
  tableRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 8 },
  tableName: { flex: 1, fontSize: 12, color: "#374151", fontFamily: "Pretendard-Regular" },
  tableSize: { fontSize: 12, color: GRAY, fontFamily: "Pretendard-Regular" },

  statsGrid: { flexDirection: "row", gap: 8 },
  statBox:   { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, alignItems: "center", gap: 2, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  statNum:   { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  statLabel: { fontSize: 10, color: GRAY, fontFamily: "Pretendard-Regular" },
  checkedAt: { fontSize: 11, color: "#64748B", textAlign: "center", fontFamily: "Pretendard-Regular" },

  poolCard:  { backgroundColor: "#fff", borderRadius: 14, padding: 14, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  poolName:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", marginBottom: 10 },
  poolStats: { flexDirection: "row" },

  logList: { gap: 0, backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  logRow:  { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  logDot:  { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  logType: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  logMeta: { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular" },
  logTime: { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular" },

  dlqCard:   { backgroundColor: "#fff", borderRadius: 12, padding: 14, elevation: 1, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, borderLeftWidth: 3, borderLeftColor: RED },
  dlqHeader: { flexDirection: "row", gap: 10 },
  dlqError:  { fontSize: 10, color: RED, fontFamily: "Pretendard-Regular", marginTop: 3, opacity: 0.8 },
  resendBtn: { alignItems: "center", justifyContent: "center", gap: 4, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: P, alignSelf: "flex-start" },
  resendTxt: { fontSize: 11, color: P, fontFamily: "Pretendard-Regular" },

  diagBanner:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12 },
  diagStatusTxt: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  diagSubTxt:    { fontSize: 11, color: GRAY, fontFamily: "Pretendard-Regular", marginTop: 2 },

  typeRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  typeLabel:{ flex: 1, fontSize: 12, color: "#374151", fontFamily: "Pretendard-Regular" },
  typeCnt:  { fontSize: 13, fontFamily: "Pretendard-Regular" },

  recCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FFF8E6", padding: 12, borderRadius: 10 },
  recTxt:  { flex: 1, fontSize: 12, color: ORANGE, fontFamily: "Pretendard-Regular" },

  emptyWrap: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:  { fontSize: 14, color: GRAY, fontFamily: "Pretendard-Regular", textAlign: "center" },
});
