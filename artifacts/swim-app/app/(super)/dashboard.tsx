/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 콘솔
 * Zustand 완전 제거 → GET /super/dashboard-stats, /super/risk-summary, /super/recent-audit-logs 실 API 연동
 */
import { Activity, ChevronRight, CircleAlert, Clipboard, LogOut, MessageCircle, Save, Shield } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, apiRequest } from "@/context/AuthContext";

const P = "#7C3AED";

interface Stats {
  total_operators: number; active_operators: number; pending_operators: number;
  payment_issue_count: number; storage_danger_count: number; deletion_pending_count: number;
}
interface TodoItem {
  id: string; name: string; owner_name?: string; todo_type: string;
  pool_type?: string; subscription_status?: string; subscription_end_at?: string;
  usage_pct?: number; total_gb?: number; hours_left?: number;
  pool_name?: string; actor_name?: string; description?: string; created_at?: string;
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
interface RiskSummary {
  payment_risk: number; storage_risk: number; deletion_pending: number;
  policy_unsigned: number; sla_overdue: number; security_events: number;
}
interface AuditLogItem {
  id: string; category: string; description?: string;
  actor_name?: string; pool_name?: string; created_at: string;
}

const MINT = "#2EC4B6"; const MINT_BG = "#E6FAF8";
const ORNG = "#F97316"; const ORNG_BG = "#FFF1E8";
const NAVY = "#0F172A"; const NAVY_BG = "#E8EEF4";
const POOL_TYPE_LABELS: Record<string, string> = {
  swimming_pool: "수영장", solo_coach: "1인 코치", rental_team: "대관팀", franchise: "프랜차이즈",
};

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function relStr(iso: string | null | undefined): string {
  const d = safeDate(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diff) / 60000);
  const h = Math.floor(m / 60);
  if (m < 60)  return `${m}분 전`;
  if (h < 24)  return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function TodoRow({
  item, onAction, color,
}: {
  item: TodoItem;
  onAction: (action: string, id: string) => void;
  color: string;
}) {
  return (
    <View style={[tr.row, { borderLeftColor: color }]}>
      <View style={{ flex: 1 }}>
        <Text style={tr.name} numberOfLines={1}>{item.name ?? item.pool_name ?? "—"}</Text>
        <Text style={tr.sub} numberOfLines={1}>
          {item.owner_name ?? item.actor_name ?? ""}
          {item.pool_type ? ` · ${POOL_TYPE_LABELS[item.pool_type] ?? item.pool_type}` : ""}
          {item.usage_pct != null ? ` · 저장 ${item.usage_pct}%` : ""}
          {item.hours_left != null ? ` · ${Math.round(item.hours_left as number)}시간 남음` : ""}
          {item.description ? ` · ${item.description}` : ""}
        </Text>
      </View>
      <View style={tr.actions}>
        {item.todo_type === "pending_approval" && <>
          <Pressable style={[tr.btn, { backgroundColor: "#E6FFFA" }]} onPress={() => onAction("approve", item.id)}>
            <Text style={[tr.btnTxt, { color: "#2EC4B6" }]}>승인</Text>
          </Pressable>
          <Pressable style={[tr.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onAction("reject", item.id)}>
            <Text style={[tr.btnTxt, { color: "#D96C6C" }]}>반려</Text>
          </Pressable>
        </>}
        {item.todo_type === "deletion_pending" && (
          <Pressable style={[tr.btn, { backgroundColor: "#ECFEFF" }]} onPress={() => onAction("defer", item.id)}>
            <Text style={[tr.btnTxt, { color: "#2EC4B6" }]}>유예</Text>
          </Pressable>
        )}
        {item.todo_type === "policy_unsigned" && (
          <Pressable style={[tr.btn, { backgroundColor: "#E6FFFA" }]} onPress={() => onAction("policy_reminder", item.id)}>
            <Text style={[tr.btnTxt, { color: "#2EC4B6" }]}>재알림</Text>
          </Pressable>
        )}
        <Pressable style={[tr.btn, { backgroundColor: "#FFFFFF" }]} onPress={() => router.push(`/(super)/operator-detail?id=${item.id}&backTo=dashboard` as any)}>
          <Text style={[tr.btnTxt, { color: "#0F172A" }]}>상세</Text>
        </Pressable>
      </View>
    </View>
  );
}

const tr = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
             paddingLeft: 10, borderLeftWidth: 3, marginBottom: 4 },
  name:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  sub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  actions: { flexDirection: "row", gap: 4 },
  btn:     { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  btnTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
});

function TodoSection({
  title, count, color, bg, icon, items, renderItem, path, pathLabel,
}: {
  title: string; count: number; color: string; bg: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  items: any[];
  renderItem: (item: any) => React.ReactNode;
  path: string;
  pathLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;
  return (
    <View style={ts.wrap}>
      <Pressable style={ts.header} onPress={() => setOpen(o => !o)}>
        <View style={[ts.iconWrap, { backgroundColor: bg }]}>
          <LucideIcon name={icon} size={14} color={color} />
        </View>
        <Text style={ts.title}>{title}</Text>
        <View style={[ts.badge, { backgroundColor: color }]}>
          <Text style={ts.badgeTxt}>{count}</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={14} color="#64748B" style={{ marginLeft: "auto" }} />
      </Pressable>
      {open && (
        <View style={ts.body}>
          {items.slice(0, 3).map((item, i) => <View key={i}>{renderItem(item)}</View>)}
          {count > 3 && (
            <Pressable style={ts.more} onPress={() => router.push(path as any)}>
              <Text style={[ts.moreTxt, { color }]}>{pathLabel ?? `${count - 3}건 더 보기 →`}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const ts = StyleSheet.create({
  wrap:     { backgroundColor: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden",
              borderWidth: 1, borderColor: "#E5E7EB" },
  header:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  badge:    { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#fff" },
  body:     { paddingHorizontal: 12, paddingBottom: 8 },
  more:     { alignItems: "center", paddingVertical: 8 },
  moreTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
});

export default function SuperDashboard() {
  const { logout, adminUser, token } = useAuth() as any;

  const [stats,      setStats]      = useState<Stats | null>(null);
  const [todo,       setTodo]       = useState<Todo | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummary | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLogItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const [dashRes, riskRes, logsRes] = await Promise.all([
        apiRequest(token, "/super/dashboard-stats"),
        apiRequest(token, "/super/risk-summary"),
        apiRequest(token, "/super/recent-audit-logs?limit=5"),
      ]);
      const [dashData, riskData, logsData] = await Promise.all([
        dashRes.json(),
        riskRes.json(),
        logsRes.json(),
      ]);
      setStats(dashData.stats ?? null);
      setTodo(dashData.todo ?? null);
      setRiskSummary(riskData.risk ?? riskData ?? null);
      setRecentLogs(logsData.logs ?? []);
    } catch {
      // 네트워크 오류 시 기존 상태 유지
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function doAction(action: string, id: string) {
    try {
      if (action === "approve") {
        await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" });
        Alert.alert("완료", "운영 승인이 처리되었습니다.");
      } else if (action === "reject") {
        await apiRequest(token, `/super/operators/${id}/reject`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "기준 미달" }),
        });
        Alert.alert("완료", "반려 처리가 완료되었습니다.");
      } else if (action === "defer") {
        await apiRequest(token, `/super/operators/${id}/defer-deletion`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: 48 }),
        });
        Alert.alert("완료", "자동삭제를 48시간 유예했습니다.");
      } else if (action === "policy_reminder") {
        await apiRequest(token, `/super/operators/${id}/policy-reminder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy_key: "refund_policy" }),
        });
        Alert.alert("완료", "정책 재알림을 발송했습니다.");
      }
      load(true);
    } catch {
      Alert.alert("오류", "처리에 실패했습니다.");
    }
  }

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const totalAlerts = (stats?.storage_danger_count ?? 0) + (stats?.deletion_pending_count ?? 0);
  const todoCount = (todo?.pending_approval.length ?? 0) +
    (todo?.storage_danger.length ?? 0) + (todo?.deletion_pending.length ?? 0) +
    (todo?.policy_unsigned.length ?? 0) + (todo?.security_events.length ?? 0) +
    (todo?.support_open_count ?? 0);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>슈퍼관리자</Text>
          <Text style={s.headerSub}>{today}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {totalAlerts > 0 && (
            <Pressable style={s.alertPill} onPress={() => router.push("/(super)/risk-center?backTo=dashboard" as any)}>
              <CircleAlert size={13} color="#D96C6C" />
              <Text style={s.alertPillTxt}>{totalAlerts}건 처리 필요</Text>
            </Pressable>
          )}
          <Pressable style={s.avatarCircle} onPress={() => router.push("/(super)/backup?backTo=dashboard" as any)}>
            <Save size={17} color="#fff" />
          </Pressable>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <LogOut size={15} color={P} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(true); }} />}>

        {loading ? (
          <ActivityIndicator color={P} style={{ marginVertical: 40 }} />
        ) : (
          <>
            {/* ── 6대 KPI ── */}
            <View style={s.statsGrid}>
              {[
                { label: "전체 운영자",   v: stats?.total_operators ?? 0,        alert: false, path: "/(super)/pools?backTo=dashboard" },
                { label: "활성 운영자",   v: stats?.active_operators ?? 0,       alert: false, path: "/(super)/pools?backTo=dashboard" },
                { label: "승인 대기",     v: stats?.pending_operators ?? 0,      alert: true,  path: "/(super)/pools?filter=pending&backTo=dashboard" },
                { label: "저장 위험",     v: stats?.storage_danger_count ?? 0,   alert: true,  path: "/(super)/storage?backTo=dashboard" },
                { label: "24h 삭제",      v: stats?.deletion_pending_count ?? 0, alert: true,  path: "/(super)/risk-center?backTo=dashboard" },
              ].map((item, i) => (
                <Pressable key={i} style={[s.statCard, item.alert && item.v > 0 && s.statAlert]}
                  onPress={() => router.push(item.path as any)}>
                  {item.alert && item.v > 0 && <View style={s.alertDot} />}
                  <Text style={[s.statNum, item.alert && item.v > 0 && { color: "#D96C6C" }]}>{item.v}</Text>
                  <Text style={s.statLabel}>{item.label}</Text>
                </Pressable>
              ))}
            </View>

            {/* ── 오늘 처리할 일 ── */}
            {todoCount > 0 && (
              <View style={s.todoSection}>
                <View style={s.todoHeader}>
                  <Clipboard size={15} color="#0F172A" />
                  <Text style={s.todoHeaderTxt}>오늘 처리할 일</Text>
                  <View style={s.todoBadge}>
                    <Text style={s.todoBadgeTxt}>{todoCount}</Text>
                  </View>
                </View>

                {/* 승인 대기 */}
                <TodoSection
                  title="승인 대기" count={todo?.pending_approval.length ?? 0}
                  color="#D97706" bg="#FFF1BF" icon="user-check"
                  items={todo?.pending_approval ?? []}
                  renderItem={(item: TodoItem) => (
                    <TodoRow item={item} color="#D97706" onAction={doAction} />
                  )}
                  path="/(super)/pools?filter=pending&backTo=dashboard"
                />

                {/* 저장공간 위험 */}
                <TodoSection
                  title="저장 95% 초과" count={todo?.storage_danger.length ?? 0}
                  color={P} bg="#EEDDF5" icon="hard-drive"
                  items={todo?.storage_danger ?? []}
                  renderItem={(item: TodoItem) => (
                    <TodoRow item={item} color={P} onAction={doAction} />
                  )}
                  path="/(super)/storage?backTo=dashboard"
                />

                {/* 자동삭제 예정 */}
                <TodoSection
                  title="24h 내 자동삭제" count={todo?.deletion_pending.length ?? 0}
                  color="#2EC4B6" bg="#ECFEFF" icon="clock"
                  items={todo?.deletion_pending ?? []}
                  renderItem={(item: TodoItem) => (
                    <TodoRow item={item} color="#2EC4B6" onAction={doAction} />
                  )}
                  path="/(super)/risk-center?backTo=dashboard"
                />

                {/* 정책 미확인 */}
                <TodoSection
                  title="정책 미확인" count={todo?.policy_unsigned.length ?? 0}
                  color="#2EC4B6" bg="#E6FFFA" icon="file-text"
                  items={todo?.policy_unsigned ?? []}
                  renderItem={(item: TodoItem) => (
                    <TodoRow item={item} color="#2EC4B6" onAction={doAction} />
                  )}
                  path="/(super)/policy?backTo=dashboard"
                />

                {/* 보안 이벤트 */}
                {(todo?.security_events.length ?? 0) > 0 && (
                  <TodoSection
                    title="보안 이벤트 (24h)" count={todo?.security_events.length ?? 0}
                    color="#991B1B" bg="#F9DEDA" icon="shield"
                    items={todo?.security_events ?? []}
                    renderItem={(item: TodoItem) => (
                      <View style={[tr.row, { borderLeftColor: "#991B1B" }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={tr.name} numberOfLines={1}>{item.pool_name ?? item.name ?? "플랫폼"}</Text>
                          <Text style={tr.sub} numberOfLines={1}>{item.description ?? ""} · {relStr(item.created_at)}</Text>
                        </View>
                        <Pressable style={[tr.btn, { backgroundColor: "#F9DEDA" }]}
                          onPress={() => router.push("/(super)/op-logs?backTo=dashboard" as any)}>
                          <Text style={[tr.btnTxt, { color: "#991B1B" }]}>로그</Text>
                        </Pressable>
                      </View>
                    )}
                    path="/(super)/op-logs?backTo=dashboard"
                  />
                )}

                {/* 고객센터 미처리 배너 */}
                {(todo?.support_open_count ?? 0) > 0 && (
                  <Pressable style={s.supportBanner} onPress={() => router.push("/(super)/support?backTo=dashboard" as any)}>
                    <View style={[ts.iconWrap, { backgroundColor: "#E0F2FE" }]}>
                      <MessageCircle size={14} color="#0284C7" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.supportTitle}>고객센터 미처리</Text>
                      <Text style={s.supportSub}>
                        처리 대기 {todo?.support_open_count ?? 0}건
                        {(todo?.support_overdue_count ?? 0) > 0 && ` · SLA 초과 ${todo?.support_overdue_count}건`}
                      </Text>
                    </View>
                    {(todo?.support_overdue_count ?? 0) > 0 && (
                      <View style={[ts.badge, { backgroundColor: "#D96C6C" }]}>
                        <Text style={ts.badgeTxt}>{todo?.support_overdue_count}</Text>
                      </View>
                    )}
                    <ChevronRight size={14} color="#0284C7" />
                  </Pressable>
                )}
              </View>
            )}

            {/* ── 리스크 요약 ── */}
            {riskSummary && (
              <View style={s.riskSection}>
                <Pressable style={s.riskHeader} onPress={() => router.push("/(super)/risk-center?backTo=dashboard" as any)}>
                  <Shield size={15} color="#9333EA" />
                  <Text style={s.riskHeaderTxt}>리스크 요약</Text>
                  <ChevronRight size={14} color="#64748B" style={{ marginLeft: "auto" }} />
                </Pressable>
                <View style={s.riskGrid}>
                  {[
                    { label: "저장공간 리스크", v: riskSummary.storage_risk,    color: "#D97706", path: "/(super)/storage?backTo=dashboard" },
                    { label: "삭제 예정",      v: riskSummary.deletion_pending, color: "#2EC4B6", path: "/(super)/risk-center?backTo=dashboard" },
                    { label: "정책 미확인",    v: riskSummary.policy_unsigned,  color: "#2EC4B6", path: "/(super)/policy?backTo=dashboard" },
                    { label: "SLA 초과",       v: riskSummary.sla_overdue,      color: "#D96C6C", path: "/(super)/support?backTo=dashboard" },
                    { label: "보안 이벤트",    v: riskSummary.security_events,  color: "#991B1B", path: "/(super)/op-logs?backTo=dashboard" },
                  ].map((item) => (
                    <Pressable key={item.label} style={s.riskCard}
                      onPress={() => router.push(item.path as any)}>
                      <Text style={[s.riskNum, item.v > 0 && { color: item.color }]}>{item.v}</Text>
                      <Text style={s.riskLabel}>{item.label}</Text>
                      {item.v > 0 && <View style={[s.riskDot, { backgroundColor: item.color }]} />}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* ── 최근 감사 로그 5개 ── */}
            <View style={s.auditSection}>
              <Pressable style={s.auditHeader} onPress={() => router.push("/(super)/op-logs?backTo=dashboard" as any)}>
                <Activity size={15} color="#2EC4B6" />
                <Text style={s.auditHeaderTxt}>최근 감사 로그</Text>
                <ChevronRight size={14} color="#64748B" style={{ marginLeft: "auto" }} />
              </Pressable>
              {recentLogs.length === 0 ? (
                <View style={s.auditEmpty}>
                  <Text style={s.auditEmptyTxt}>기록된 감사 로그가 없습니다</Text>
                </View>
              ) : (
                recentLogs.map((log) => {
                  const d = new Date(log.created_at);
                  const timeStr = isNaN(d.getTime()) ? "—" :
                    d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  return (
                    <View key={log.id} style={s.auditRow}>
                      <View style={s.auditCatBadge}>
                        <Text style={s.auditCatTxt} numberOfLines={1}>{log.category ?? "—"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.auditDesc} numberOfLines={1}>{log.description ?? "—"}</Text>
                        <Text style={s.auditMeta}>{log.actor_name ?? "시스템"} · {timeStr}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#FFFFFF" },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 18, paddingTop: 28, paddingBottom: 14 },
  headerTitle:   { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  headerSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },
  alertPill:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F9DEDA",
                   borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  alertPillTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  avatarCircle:  { width: 34, height: 34, borderRadius: 17, backgroundColor: P,
                   alignItems: "center", justifyContent: "center" },
  logoutBtn:     { width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(124,58,237,0.1)",
                   alignItems: "center", justifyContent: "center" },

  statsGrid:     { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  statCard:      { width: "30.5%", backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12,
                   borderWidth: 1, borderColor: "#E5E7EB", position: "relative" },
  statAlert:     { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  alertDot:      { position: "absolute", top: 8, right: 8, width: 7, height: 7,
                   borderRadius: 3.5, backgroundColor: "#D96C6C" },
  statNum:       { fontSize: 24, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  statLabel:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2, lineHeight: 14 },

  todoSection:   { marginHorizontal: 14, marginBottom: 14 },
  todoHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  todoHeaderTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  todoBadge:     { backgroundColor: "#D96C6C", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  todoBadgeTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#fff" },

  supportBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                   borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB",
                   marginBottom: 10 },
  supportTitle:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  supportSub:    { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 2 },

  riskSection:   { marginHorizontal: 14, marginBottom: 14, backgroundColor: "#FFFFFF",
                   borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  riskHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  riskHeaderTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  riskGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskCard:      { width: "30.5%", backgroundColor: "#FFFFFF", borderRadius: 10, padding: 10,
                   borderWidth: 1, borderColor: "#E5E7EB", position: "relative", minHeight: 60 },
  riskNum:       { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  riskLabel:     { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 3, lineHeight: 13 },
  riskDot:       { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },

  auditSection:  { marginHorizontal: 14, marginBottom: 14, backgroundColor: "#FFFFFF",
                   borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  auditHeader:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  auditHeaderTxt:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A", flex: 1 },
  auditRow:      { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7,
                   borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  auditCatBadge: { backgroundColor: "#E6FAF8", borderRadius: 5, paddingHorizontal: 7,
                   paddingVertical: 3, minWidth: 50, alignItems: "center" },
  auditCatTxt:   { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#7C3AED" },
  auditDesc:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  auditMeta:     { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 1 },
  auditEmpty:    { paddingVertical: 12, alignItems: "center" },
  auditEmptyTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },

});
