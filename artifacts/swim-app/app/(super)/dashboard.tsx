/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 대시보드
 *
 * AFTER IA: Dashboard 중심 구조.
 * Header → 글로벌 메뉴 버튼
 * KPI 4개: 전체 수영장 / 활성 수영장 / 승인 대기 / X MODE(API 준비중)
 * 수영장 현황 / Action Center / 운영 건강 / 콘텐츠 운영
 *
 * API: /super/dashboard-stats, /super/risk-summary, /super/scheduler-heartbeat,
 *       /super/ops-alerts, /inquiries/unread-count
 */
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";

const P = "#7C3AED";
const MINT = "#2EC4B6";
const BG = "#F8F8FC";

/* ── 타입 ── */
interface Stats {
  total_operators: number; active_operators: number; pending_operators: number;
  payment_issue_count: number; storage_danger_count: number; deletion_pending_count: number;
  xmode_operators: number;
}
interface TodoItem {
  id: string; name: string; owner_name?: string; todo_type: string;
  pool_type?: string; subscription_status?: string; subscription_end_at?: string;
  usage_pct?: number; hours_left?: number; pool_name?: string;
  actor_name?: string; description?: string; created_at?: string;
}
interface Todo {
  pending_approval: TodoItem[];
  payment_failed: TodoItem[];
  storage_danger: TodoItem[];
  deletion_pending: TodoItem[];
  policy_unsigned: TodoItem[];
  security_events: TodoItem[];
  support_open_count: number;
  support_overdue_count: number;
}
interface HeartbeatItem {
  job_name: string; last_run_at: string; elapsed_seconds: number;
  expected_seconds: number; status: "ok" | "warning"; result: any;
}
interface OpsAlertItem {
  id: string; type: string; title: string; message: string;
  severity: "info" | "success" | "warning" | "error";
  related_pool_id: string | null; is_read: boolean; created_at: string;
}

const POOL_TYPE_LABELS: Record<string, string> = {
  swimming_pool: "수영장", solo_coach: "1인코치",
  rental_team: "대관팀", franchise: "프랜차이즈",
};

function fmtElapsed(sec: number): string {
  if (sec < 0)    return "—";
  if (sec < 60)   return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return `${Math.floor(sec / 3600)}시간 전`;
}

/* ── 소형 KPI 카드 ── */
function KpiCard({
  label, value, alert, path, note,
}: {
  label: string; value: number | null; alert?: boolean;
  path?: string; note?: string;
}) {
  const hasAlert = alert && (value ?? 0) > 0;
  return (
    <Pressable
      style={[k.card, hasAlert && k.cardAlert]}
      onPress={() => path && router.push(path as any)}
    >
      {hasAlert && <View style={k.dot} />}
      <Text style={[k.num, hasAlert && { color: "#D96C6C" }]}>
        {value === null ? "—" : value}
      </Text>
      <Text style={k.label}>{label}</Text>
      {!!note && <Text style={k.note}>{note}</Text>}
    </Pressable>
  );
}

const k = StyleSheet.create({
  card:      { flex: 1, minWidth: "22%", backgroundColor: "#FFF", borderRadius: 12, padding: 11,
               borderWidth: 1, borderColor: "#E5E7EB", position: "relative" },
  cardAlert: { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  dot:       { position: "absolute", top: 7, right: 7, width: 6, height: 6,
               borderRadius: 3, backgroundColor: "#D96C6C" },
  num:       { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#14283D" },
  label:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2, lineHeight: 13 },
  note:      { fontSize: 8, fontFamily: "Pretendard-Regular", color: "#CBD5E1", marginTop: 1 },
});

/* ── Action Center 행 ── */
function ActionRow({
  icon, iconBg, iconColor, label, count, path, urgent,
}: {
  icon: string; iconBg: string; iconColor: string;
  label: string; count: number; path: string; urgent?: boolean;
}) {
  return (
    <Pressable style={a.row} onPress={() => router.push(path as any)}>
      <View style={[a.iconBox, { backgroundColor: iconBg }]}>
        <LucideIcon name={icon as any} size={14} color={iconColor} />
      </View>
      <Text style={a.label}>{label}</Text>
      <View style={[a.badge, { backgroundColor: count > 0 ? (urgent ? "#D96C6C" : P) : "#E5E7EB" }]}>
        <Text style={[a.badgeTxt, { color: count > 0 ? "#fff" : "#94A3B8" }]}>{count}</Text>
      </View>
      <LucideIcon name="chevron-right" size={13} color="#CBD5E1" />
    </Pressable>
  );
}

const a = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
              paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  iconBox:  { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  label:    { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: "#14283D" },
  badge:    { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, minWidth: 26, alignItems: "center" },
  badgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
});

/* ── 수영장 미리보기 행 ── */
function PoolPreviewRow({ item }: { item: TodoItem }) {
  return (
    <Pressable
      style={pp.row}
      onPress={() => router.push(`/(super)/operator-detail?id=${item.id}&backTo=dashboard` as any)}
    >
      <View style={pp.dot} />
      <View style={{ flex: 1 }}>
        <Text style={pp.name} numberOfLines={1}>{item.name}</Text>
        <Text style={pp.sub} numberOfLines={1}>
          {item.owner_name ?? "—"}
          {item.pool_type ? ` · ${POOL_TYPE_LABELS[item.pool_type] ?? item.pool_type}` : ""}
        </Text>
      </View>
      <View style={pp.statusPill}>
        <Text style={pp.statusTxt}>승인대기</Text>
      </View>
      <LucideIcon name="chevron-right" size={12} color="#CBD5E1" />
    </Pressable>
  );
}

const pp = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10,
               paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  dot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D97706" },
  name:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#14283D" },
  sub:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#94A3B8", marginTop: 1 },
  statusPill:{ backgroundColor: "#FFF1BF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  statusTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D97706" },
});

/* ── 카드 래퍼 ── */
function Card({
  children, onHeaderPress, title, rightLabel, rightIcon,
}: {
  children: React.ReactNode;
  title: string;
  onHeaderPress?: () => void;
  rightLabel?: string;
  rightIcon?: string;
}) {
  return (
    <View style={c.wrap}>
      <Pressable style={c.header} onPress={onHeaderPress}>
        <Text style={c.title}>{title}</Text>
        {!!rightLabel && (
          <View style={c.right}>
            <Text style={c.rightTxt}>{rightLabel}</Text>
            {!!rightIcon && <LucideIcon name={rightIcon as any} size={12} color={MINT} />}
          </View>
        )}
      </Pressable>
      {children}
    </View>
  );
}

const c = StyleSheet.create({
  wrap:     { backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB",
              marginBottom: 12, overflow: "hidden" },
  header:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  title:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#14283D", fontWeight: "600" as const },
  right:    { flexDirection: "row", alignItems: "center", gap: 3 },
  rightTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: MINT },
});

/* ── 메인 컴포넌트 ── */
export default function SuperDashboard() {
  const { logout, token } = useAuth() as any;

  const [stats,       setStats]       = useState<Stats | null>(null);
  const [todo,        setTodo]        = useState<Todo | null>(null);
  const [heartbeat,   setHeartbeat]   = useState<HeartbeatItem[]>([]);
  const [opsAlerts,   setOpsAlerts]   = useState<OpsAlertItem[]>([]);
  const [unreadInq,   setUnreadInq]   = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [dashRes, hbRes, alertsRes, inqRes] = await Promise.all([
        apiRequest(token, "/super/dashboard-stats"),
        apiRequest(token, "/super/scheduler-heartbeat"),
        apiRequest(token, "/super/ops-alerts"),
        apiRequest(token, "/inquiries/unread-count").catch(() => null),
      ]);
      const [dashData, hbData, alertsData, inqData] = await Promise.all([
        dashRes.json(),
        hbRes.json(),
        alertsRes.json(),
        inqRes ? inqRes.json().catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
      ]);
      setStats(dashData.stats ?? null);
      setTodo(dashData.todo ?? null);
      setHeartbeat(hbData.items ?? []);
      setOpsAlerts(alertsData.items ?? []);
      setUnreadInq(inqData.count ?? 0);
    } catch {
      // 네트워크 오류 시 기존 상태 유지
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  /* 액션 */
  async function doApprove(id: string) {
    try {
      await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" });
      Alert.alert("완료", "승인 처리가 완료되었습니다.");
      load(true);
    } catch { Alert.alert("오류", "처리에 실패했습니다."); }
  }

  /* 스케줄러 건강 판단 */
  const hasSchedulerWarn = heartbeat.some(j => j.status === "warning");
  const hasOpsError = opsAlerts.some(a => a.severity === "error" || a.severity === "warning");
  const systemHealthy = !hasSchedulerWarn && !hasOpsError;

  /* 오늘 날짜 */
  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  /* Pool preview: 승인 대기 중인 운영처 최대 3개 */
  const poolPreview = (todo?.pending_approval ?? []).slice(0, 3);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>

      {/* ── 헤더 ── */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>SWIMNOTE</Text>
          <Text style={s.headerSub}>{today}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable style={s.menuBtn} onPress={() => router.push("/(super)/global-menu" as any)}>
            <LucideIcon name="menu" size={18} color={P} />
          </Pressable>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <LucideIcon name="log-out" size={15} color="#94A3B8" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: BG }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 60, paddingTop: 10 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={P}
            onRefresh={() => { setRefreshing(true); load(true); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={P} style={{ marginVertical: 60 }} />
        ) : (
          <>
            {/* ══ KPI 4개 ══ */}
            <View style={s.kpiRow}>
              <KpiCard
                label="전체 수영장"
                value={stats?.total_operators ?? 0}
                path="/(super)/pools?backTo=dashboard"
              />
              <KpiCard
                label="활성 수영장"
                value={stats?.active_operators ?? 0}
                path="/(super)/pools?filter=active&backTo=dashboard"
              />
              <KpiCard
                label="승인 대기"
                value={stats?.pending_operators ?? 0}
                alert
                path="/(super)/pools?filter=pending&backTo=dashboard"
              />
              <KpiCard
                label="X MODE"
                value={stats?.xmode_operators ?? 0}
                path="/(super)/pools?filter=xmode&backTo=dashboard"
              />
            </View>

            {/* ══ 수영장 현황 ══ */}
            <Card
              title="수영장 현황"
              rightLabel="전체보기"
              rightIcon="chevron-right"
              onHeaderPress={() => router.push("/(super)/pools?backTo=dashboard" as any)}
            >
              {poolPreview.length === 0 ? (
                <View style={s.emptyRow}>
                  <Text style={s.emptyTxt}>승인 대기 중인 수영장이 없습니다</Text>
                </View>
              ) : (
                poolPreview.map((item) => (
                  <PoolPreviewRow key={item.id} item={item} />
                ))
              )}
              {(stats?.pending_operators ?? 0) > 3 && (
                <Pressable
                  style={s.moreRow}
                  onPress={() => router.push("/(super)/pools?filter=pending&backTo=dashboard" as any)}
                >
                  <Text style={s.moreTxt}>
                    승인 대기 {(stats?.pending_operators ?? 0) - 3}개 더 보기 →
                  </Text>
                </Pressable>
              )}
            </Card>

            {/* ══ Action Center ══ */}
            <Card title="Action Center  오늘 처리할 일">
              <ActionRow
                icon="user-check" iconBg="#FFF1BF" iconColor="#D97706"
                label="승인 대기"
                count={todo?.pending_approval.length ?? 0}
                path="/(super)/pools?filter=pending&backTo=dashboard"
                urgent
              />
              <ActionRow
                icon="inbox" iconBg="#EFF6FF" iconColor="#2563EB"
                label="미답변 문의"
                count={unreadInq}
                path="/(super)/inquiries?backTo=dashboard"
              />
              <ActionRow
                icon="file-text" iconBg="#E6FAF8" iconColor={MINT}
                label="정책 미확인"
                count={todo?.policy_unsigned.length ?? 0}
                path="/(super)/policy?backTo=dashboard"
              />
              <ActionRow
                icon="shield" iconBg="#FEF2F2" iconColor="#D96C6C"
                label="보안 이벤트 (24h)"
                count={todo?.security_events.length ?? 0}
                path="/(super)/op-logs?backTo=dashboard"
                urgent
              />
              <ActionRow
                icon="message-circle" iconBg="#F0F9FF" iconColor="#0284C7"
                label="고객센터 대기"
                count={todo?.support_open_count ?? 0}
                path="/(super)/support?backTo=dashboard"
              />
            </Card>

            {/* ══ 운영 건강 ══ */}
            <Card
              title="운영 건강"
              rightLabel={hasSchedulerWarn ? "지연 있음" : "스케줄러"}
              rightIcon={hasSchedulerWarn ? "alert-circle" : "check-circle"}
              onHeaderPress={() => router.push("/(super)/system-status?backTo=dashboard" as any)}
            >
              {systemHealthy ? (
                <View style={s.healthOk}>
                  <LucideIcon name="check-circle" size={14} color="#16A34A" />
                  <Text style={s.healthOkTxt}>전체 시스템 정상</Text>
                </View>
              ) : (
                <>
                  {hasSchedulerWarn && heartbeat.filter(j => j.status === "warning").map(job => (
                    <View key={job.job_name} style={s.healthWarnRow}>
                      <LucideIcon name="clock" size={13} color="#D97706" />
                      <Text style={s.healthWarnName} numberOfLines={1}>{job.job_name}</Text>
                      <Text style={s.healthWarnTime}>{fmtElapsed(job.elapsed_seconds)}</Text>
                    </View>
                  ))}
                  {opsAlerts.filter(a => a.severity === "error" || a.severity === "warning").slice(0, 2).map(alert => (
                    <View key={alert.id} style={s.healthWarnRow}>
                      <LucideIcon
                        name={alert.severity === "error" ? "alert-circle" : "alert-triangle"}
                        size={13}
                        color={alert.severity === "error" ? "#D96C6C" : "#D97706"}
                      />
                      <Text style={s.healthWarnName} numberOfLines={1}>{alert.title}</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>

            {/* ══ 콘텐츠 운영 ══ */}
            <Card title="콘텐츠 운영">
              <View style={s.contentRow}>
                {[
                  { icon: "bell",         label: "공지사항",  path: "/(super)/notices" },
                  { icon: "layout",       label: "카드배너",  path: "/(super)/ads" },
                  { icon: "minus-square", label: "가로배너",  path: "/(super)/strip-banner" },
                ].map(item => (
                  <Pressable key={item.label} style={s.contentBtn}
                    onPress={() => router.push(`${item.path}?backTo=dashboard` as any)}>
                    <View style={s.contentIcon}>
                      <LucideIcon name={item.icon as any} size={18} color={P} />
                    </View>
                    <Text style={s.contentLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Card>

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#FFFFFF" },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12,
                    backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  headerTitle:    { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#14283D", fontWeight: "700" as const },
  headerSub:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8", marginTop: 1 },
  menuBtn:        { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F5F3FF",
                    alignItems: "center", justifyContent: "center" },
  logoutBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F1F5F9",
                    alignItems: "center", justifyContent: "center" },

  kpiRow:         { flexDirection: "row", gap: 8, marginBottom: 12 },

  emptyRow:       { paddingVertical: 18, alignItems: "center" },
  emptyTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#94A3B8" },
  moreRow:        { paddingVertical: 11, alignItems: "center",
                    borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  moreTxt:        { fontSize: 12, fontFamily: "Pretendard-Regular", color: MINT },

  healthOk:       { flexDirection: "row", alignItems: "center", gap: 8, padding: 14 },
  healthOkTxt:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#16A34A" },
  healthWarnRow:  { flexDirection: "row", alignItems: "center", gap: 8,
                    paddingHorizontal: 14, paddingVertical: 9,
                    borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  healthWarnName: { flex: 1, fontSize: 12, fontFamily: "Pretendard-Regular", color: "#14283D" },
  healthWarnTime: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#94A3B8" },

  contentRow:     { flexDirection: "row", padding: 14, gap: 10 },
  contentBtn:     { flex: 1, alignItems: "center", gap: 8, paddingVertical: 14,
                    backgroundColor: "#F8F8FC", borderRadius: 12 },
  contentIcon:    { width: 38, height: 38, borderRadius: 10, backgroundColor: "#F5F3FF",
                    alignItems: "center", justifyContent: "center" },
  contentLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#374151" },
});
