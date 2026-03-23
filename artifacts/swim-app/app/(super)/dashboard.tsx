/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 콘솔
 * 홈: 6대 KPI → 오늘 처리할 일 큐(인라인 액션) → 9개 메뉴 그리드
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useOperatorsStore } from "@/store/operatorsStore";
import { useAuditLogStore } from "@/store/auditLogStore";
import { useRiskStore } from "@/store/riskStore";
import { useSupportStore } from "@/store/supportStore";

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

const MENUS = [
  { id: "op",       icon: "briefcase" as const,      title: "운영 관리",   sub: "운영자·구독·저장공간·공지관리",  path: "/(super)/op-group",            color: P,         bg: "#EEDDF5" },
  { id: "support",  icon: "message-circle" as const, title: "지원 센터",   sub: "고객센터·정책·초대·인증번호",    path: "/(super)/support-group",        color: "#0284C7", bg: "#E0F2FE" },
  { id: "protect",  icon: "shield" as const,         title: "보호·통제",   sub: "킬스위치·백업·플래그·읽기전용", path: "/(super)/protect-group",        color: "#D96C6C", bg: "#F9DEDA" },
  { id: "security", icon: "lock" as const,           title: "보안·설정",   sub: "계정·2FA·외부서비스·세션·정책", path: "/(super)/security-settings",    color: "#991B1B", bg: "#FEF2F2" },
  { id: "audit",    icon: "activity" as const,       title: "감사·리스크", sub: "운영로그·리스크·보안·민감작업",  path: "/(super)/audit-group",          color: "#1F8F86", bg: "#DDF2EF" },
  { id: "billing",  icon: "bar-chart-2" as const,    title: "매출·정산",   sub: "매출·지출·수수료·순이익 통합 관리", path: "/(super)/billing-analytics",  color: "#1F8F86", bg: "#DDF2EF" },
];

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

// ─── 처리 큐 행 ─────────────────────────────────────────────────
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
          <Pressable style={[tr.btn, { backgroundColor: "#DDF2EF" }]} onPress={() => onAction("approve", item.id)}>
            <Text style={[tr.btnTxt, { color: "#1F8F86" }]}>승인</Text>
          </Pressable>
          <Pressable style={[tr.btn, { backgroundColor: "#F9DEDA" }]} onPress={() => onAction("reject", item.id)}>
            <Text style={[tr.btnTxt, { color: "#D96C6C" }]}>반려</Text>
          </Pressable>
        </>}
        {item.todo_type === "deletion_pending" && (
          <Pressable style={[tr.btn, { backgroundColor: "#ECFEFF" }]} onPress={() => onAction("defer", item.id)}>
            <Text style={[tr.btnTxt, { color: "#1F8F86" }]}>유예</Text>
          </Pressable>
        )}
        {item.todo_type === "policy_unsigned" && (
          <Pressable style={[tr.btn, { backgroundColor: "#DDF2EF" }]} onPress={() => onAction("policy_reminder", item.id)}>
            <Text style={[tr.btnTxt, { color: "#1F8F86" }]}>재알림</Text>
          </Pressable>
        )}
        <Pressable style={[tr.btn, { backgroundColor: "#F6F3F1" }]} onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
          <Text style={[tr.btnTxt, { color: "#1F1F1F" }]}>상세</Text>
        </Pressable>
      </View>
    </View>
  );
}

const tr = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
             paddingLeft: 10, borderLeftWidth: 3, marginBottom: 4 },
  name:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  sub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  actions: { flexDirection: "row", gap: 4 },
  btn:     { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  btnTxt:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

// ─── 처리 큐 섹션 ────────────────────────────────────────────────
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
  const [open, setOpen] = useState(true);
  if (count === 0) return null;
  return (
    <View style={ts.wrap}>
      <Pressable style={ts.header} onPress={() => setOpen(o => !o)}>
        <View style={[ts.iconWrap, { backgroundColor: bg }]}>
          <Feather name={icon} size={14} color={color} />
        </View>
        <Text style={ts.title}>{title}</Text>
        <View style={[ts.badge, { backgroundColor: color }]}>
          <Text style={ts.badgeTxt}>{count}</Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color="#9A948F" style={{ marginLeft: "auto" }} />
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
              borderWidth: 1, borderColor: "#E9E2DD" },
  header:   { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  iconWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  title:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  badge:    { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  body:     { paddingHorizontal: 12, paddingBottom: 8 },
  more:     { alignItems: "center", paddingVertical: 8 },
  moreTxt:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
interface RiskSummary {
  payment_risk: number;
  storage_risk: number;
  deletion_pending: number;
  policy_unsigned: number;
  sla_overdue: number;
  security_events: number;
  feature_errors: number;
  external_services: number;
  backup_failures: number;
  abuse_detected: number;
}

interface AuditLogItem {
  id: string;
  category: string;
  description?: string;
  actor_name?: string;
  pool_name?: string;
  created_at: string;
}

export default function SuperDashboard() {
  const { logout, adminUser } = useAuth();
  const actorName = adminUser?.name ?? '슈퍼관리자';
  const [refreshing, setRefreshing] = useState(false);

  const operators      = useOperatorsStore(s => s.operators);
  const scheduleDelete = useOperatorsStore(s => s.scheduleAutoDelete);
  const createLog      = useAuditLogStore(s => s.createLog);
  const allLogs        = useAuditLogStore(s => s.logs);
  const recentLogs     = useMemo(() => allLogs.slice(0, 5), [allLogs]);
  const riskSummary    = useRiskStore(s => s.summary);
  const openCount      = useSupportStore(s => s.getOpenCount());
  const slaOverdue     = useSupportStore(s => s.getSlaOverdueCount());

  // Derived stats
  const stats = useMemo(() => ({
    total_operators:    operators.length,
    active_operators:   operators.filter(o => o.status === 'active').length,
    pending_operators:  operators.filter(o => o.status === 'pending').length,
    payment_issue_count: operators.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace').length,
    storage_danger_count: operators.filter(o => o.storageBlocked95).length,
    deletion_pending_count: operators.filter(o => !!o.autoDeleteScheduledAt).length,
  }), [operators]);

  // Derive todo queues from operators (승인 절차 없음 — 수영장은 가입 즉시 활성화됨)
  const todo = useMemo(() => ({
    payment_failed: operators.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace').slice(0, 5).map(o => ({
      id: o.id, name: o.name, owner_name: o.representativeName,
      todo_type: 'payment_failed', subscription_status: o.billingStatus, created_at: o.lastLoginAt,
    })),
    storage_danger: operators.filter(o => o.storageBlocked95).slice(0, 5).map(o => ({
      id: o.id, name: o.name, owner_name: o.representativeName,
      todo_type: 'storage_danger',
      usage_pct: Math.round((o.storageUsedMb / o.storageTotalMb) * 100),
      total_gb: +(o.storageTotalMb / 1024).toFixed(1), created_at: o.lastLoginAt,
    })),
    deletion_pending: operators.filter(o => !!o.autoDeleteScheduledAt).slice(0, 5).map(o => {
      const msLeft = new Date(o.autoDeleteScheduledAt!).getTime() - Date.now();
      return {
        id: o.id, name: o.name, owner_name: o.representativeName,
        todo_type: 'deletion_pending',
        hours_left: Math.max(0, msLeft / 3600000), created_at: o.autoDeleteScheduledAt,
      };
    }),
    policy_unsigned: operators.filter(o => !o.policyRefundRead || !o.policyPrivacyRead).slice(0, 5).map(o => ({
      id: o.id, name: o.name, owner_name: o.representativeName,
      todo_type: 'policy_unsigned', created_at: o.createdAt,
    })),
    security_events: operators.filter(o => o.refundRepeatFlag || o.uploadSpikeFlag).slice(0, 3).map(o => ({
      id: o.id, name: o.name, pool_name: o.name,
      actor_name: o.representativeName, todo_type: 'security',
      description: o.refundRepeatFlag ? '반복 환불 감지' : '업로드 급증',
      created_at: o.lastLoginAt,
    })),
    support_open_count: openCount,
    support_overdue_count: slaOverdue,
  }), [operators, openCount, slaOverdue]);

  function doAction(action: string, id: string) {
    const op = operators.find(o => o.id === id);
    if (!op) return;
    if (action === "defer") {
      const at = new Date(Date.now() + 48 * 3600000).toISOString();
      scheduleDelete(id, at);
      createLog({ category: '운영자관리', title: `${op.name} 자동삭제 48h 유예`, operatorId: id, operatorName: op.name, actorName, impact: 'high', detail: '자동삭제 유예 48시간' });
    } else if (action === "policy_reminder") {
      createLog({ category: '정책', title: `${op.name} 정책 확인 요청`, operatorId: id, operatorName: op.name, actorName, impact: 'low', detail: '환불정책 확인 알림 발송' });
    }
  }

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const totalAlerts = stats.payment_issue_count + stats.storage_danger_count + stats.deletion_pending_count;
  const todoCount = todo.payment_failed.length +
    todo.storage_danger.length + todo.deletion_pending.length +
    todo.policy_unsigned.length + todo.security_events.length +
    todo.support_open_count;
  const loading = false;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 헤더 */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>운영 콘솔</Text>
          <Text style={s.headerSub}>{today}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {totalAlerts > 0 && (
            <Pressable style={s.alertPill} onPress={() => router.push("/(super)/risk-center" as any)}>
              <Feather name="alert-circle" size={13} color="#D96C6C" />
              <Text style={s.alertPillTxt}>{totalAlerts}건 처리 필요</Text>
            </Pressable>
          )}
          <View style={s.avatarCircle}>
            <Text style={s.avatarTxt}>{adminUser?.name?.[0] ?? "S"}</Text>
          </View>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <Feather name="log-out" size={15} color={P} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 400); }} />}>

        {/* ── 6대 KPI ── */}
        {loading ? (
          <ActivityIndicator color={P} style={{ marginVertical: 20 }} />
        ) : (
          <View style={s.statsGrid}>
            {[
              { label: "전체 운영자",   v: stats?.total_operators ?? 0,       alert: false, path: "/(super)/pools" },
              { label: "활성 운영자",   v: stats?.active_operators ?? 0,      alert: false, path: "/(super)/pools" },
              { label: "승인 대기",     v: stats?.pending_operators ?? 0,     alert: true,  path: "/(super)/pools?filter=pending" },
              { label: "결제 이슈",     v: stats?.payment_issue_count ?? 0,   alert: true,  path: "/(super)/subscriptions" },
              { label: "저장 위험",     v: stats?.storage_danger_count ?? 0,  alert: true,  path: "/(super)/storage" },
              { label: "24h 삭제",      v: stats?.deletion_pending_count ?? 0, alert: true, path: "/(super)/risk-center" },
            ].map((item, i) => (
              <Pressable key={i} style={[s.statCard, item.alert && item.v > 0 && s.statAlert]}
                onPress={() => router.push(item.path as any)}>
                {item.alert && item.v > 0 && <View style={s.alertDot} />}
                <Text style={[s.statNum, item.alert && item.v > 0 && { color: "#D96C6C" }]}>{item.v}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── 오늘 처리할 일 ── */}
        {!loading && todoCount > 0 && (
          <View style={s.todoSection}>
            <View style={s.todoHeader}>
              <Feather name="clipboard" size={15} color="#1F1F1F" />
              <Text style={s.todoHeaderTxt}>오늘 처리할 일</Text>
              <View style={s.todoBadge}>
                <Text style={s.todoBadgeTxt}>{todoCount}</Text>
              </View>
            </View>

            {/* 결제 실패 */}
            <TodoSection
              title="결제 실패" count={todo?.payment_failed.length ?? 0}
              color="#D96C6C" bg="#F9DEDA" icon="credit-card"
              items={todo?.payment_failed ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#D96C6C" onAction={doAction} />
              )}
              path="/(super)/subscriptions"
            />

            {/* 저장공간 위험 */}
            <TodoSection
              title="저장 95% 초과" count={todo?.storage_danger.length ?? 0}
              color={P} bg="#EEDDF5" icon="hard-drive"
              items={todo?.storage_danger ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color={P} onAction={doAction} />
              )}
              path="/(super)/storage"
            />

            {/* 자동삭제 예정 */}
            <TodoSection
              title="24h 내 자동삭제" count={todo?.deletion_pending.length ?? 0}
              color="#1F8F86" bg="#ECFEFF" icon="clock"
              items={todo?.deletion_pending ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#1F8F86" onAction={doAction} />
              )}
              path="/(super)/risk-center"
            />

            {/* 정책 미확인 */}
            <TodoSection
              title="정책 미확인" count={todo?.policy_unsigned.length ?? 0}
              color="#1F8F86" bg="#DDF2EF" icon="file-text"
              items={todo?.policy_unsigned ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#1F8F86" onAction={doAction} />
              )}
              path="/(super)/policy"
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
                      onPress={() => router.push("/(super)/op-logs" as any)}>
                      <Text style={[tr.btnTxt, { color: "#991B1B" }]}>로그</Text>
                    </Pressable>
                  </View>
                )}
                path="/(super)/op-logs"
              />
            )}

            {/* 고객센터 미처리 배너 */}
            {(todo?.support_open_count ?? 0) > 0 && (
              <Pressable style={s.supportBanner} onPress={() => router.push("/(super)/support" as any)}>
                <View style={[ts.iconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Feather name="message-circle" size={14} color="#0284C7" />
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
                <Feather name="chevron-right" size={14} color="#0284C7" />
              </Pressable>
            )}
          </View>
        )}

        {/* ── 리스크 요약 ── */}
        {!loading && (
          <View style={s.riskSection}>
            <Pressable style={s.riskHeader} onPress={() => router.push("/(super)/risk-center" as any)}>
              <Feather name="shield" size={15} color="#9333EA" />
              <Text style={s.riskHeaderTxt}>리스크 요약</Text>
              <Feather name="chevron-right" size={14} color="#6F6B68" style={{ marginLeft: "auto" }} />
            </Pressable>
            <View style={s.riskGrid}>
              {[
                { label: "결제 리스크",    v: riskSummary.paymentRisk,    color: "#D96C6C", path: "/(super)/subscriptions" },
                { label: "저장공간 리스크", v: riskSummary.storageRisk,    color: "#D97706", path: "/(super)/storage" },
                { label: "삭제 예정",      v: riskSummary.deletionPending, color: "#1F8F86", path: "/(super)/risk-center" },
                { label: "정책 미확인",    v: riskSummary.policyUnsigned,  color: "#1F8F86", path: "/(super)/policy" },
                { label: "SLA 초과",       v: riskSummary.slaOverdue,      color: "#D96C6C", path: "/(super)/support" },
                { label: "보안 이벤트",    v: riskSummary.securityEvents,  color: "#991B1B", path: "/(super)/op-logs" },
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
        {!loading && (
          <View style={s.auditSection}>
            <Pressable style={s.auditHeader} onPress={() => router.push("/(super)/op-logs" as any)}>
              <Feather name="activity" size={15} color="#1F8F86" />
              <Text style={s.auditHeaderTxt}>최근 감사 로그</Text>
              <Feather name="chevron-right" size={14} color="#6F6B68" style={{ marginLeft: "auto" }} />
            </Pressable>
            {recentLogs.length === 0 ? (
              <View style={s.auditEmpty}>
                <Text style={s.auditEmptyTxt}>기록된 감사 로그가 없습니다</Text>
              </View>
            ) : (
              recentLogs.map((log) => {
                const d = new Date(log.createdAt);
                const timeStr = isNaN(d.getTime()) ? "—" :
                  d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                return (
                  <View key={log.id} style={s.auditRow}>
                    <View style={s.auditCatBadge}>
                      <Text style={s.auditCatTxt} numberOfLines={1}>{log.category ?? "—"}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.auditDesc} numberOfLines={1}>{log.title ?? log.detail ?? "—"}</Text>
                      <Text style={s.auditMeta}>{log.actorName ?? "시스템"} · {timeStr}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ── 메뉴 그리드 ── */}
        <View style={s.menuSection}>
          <View style={s.menuGrid}>
            {MENUS.map(m => (
              <Pressable key={m.id} style={s.menuCard} onPress={() => router.push(m.path as any)}>
                <View style={[s.menuIconBox, { backgroundColor: m.bg }]}>
                  <Feather name={m.icon} size={24} color={m.color} />
                </View>
                <Text style={s.menuTitle}>{m.title}</Text>
                <Text style={s.menuSub} numberOfLines={2}>{m.sub}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={s.footer}>
          <Feather name="user" size={13} color="#9A948F" />
          <Text style={s.footerTxt}>{adminUser?.name ?? "슈퍼관리자"} · 슈퍼관리자 계정</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#F6F3F1" },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 },
  headerTitle:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  headerSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },
  alertPill:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#F9DEDA",
                   borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  alertPillTxt:  { fontSize: 11, fontFamily: "Inter_700Bold", color: "#D96C6C" },
  avatarCircle:  { width: 34, height: 34, borderRadius: 17, backgroundColor: P,
                   alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn:     { width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(124,58,237,0.1)",
                   alignItems: "center", justifyContent: "center" },

  statsGrid:     { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  statCard:      { width: "30.5%", backgroundColor: "#FFFFFF", borderRadius: 12, padding: 12,
                   borderWidth: 1, borderColor: "#E9E2DD", position: "relative" },
  statAlert:     { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  alertDot:      { position: "absolute", top: 8, right: 8, width: 7, height: 7,
                   borderRadius: 3.5, backgroundColor: "#D96C6C" },
  statNum:       { fontSize: 24, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  statLabel:     { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6F6B68", marginTop: 2, lineHeight: 14 },

  // 처리 큐 영역
  todoSection:   { marginHorizontal: 14, marginBottom: 14 },
  todoHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  todoHeaderTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1F1F1F", flex: 1 },
  todoBadge:     { backgroundColor: "#D96C6C", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  todoBadgeTxt:  { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  supportBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                   borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E9E2DD",
                   marginBottom: 10 },
  supportTitle:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#1F1F1F" },
  supportSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 2 },

  menuSection:   { paddingHorizontal: 14 },
  menuGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  menuCard:      { width: "47.5%", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16,
                   borderWidth: 1, borderColor: "#E9E2DD", gap: 8 },
  menuIconBox:   { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuTitle:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  menuSub:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6F6B68", lineHeight: 15 },

  // 반려 모달
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  rejectSheet:   { backgroundColor: "#fff", borderRadius: 20, padding: 20, margin: 16 },
  rejectTitle:   { fontSize: 17, fontFamily: "Inter_700Bold", color: "#1F1F1F", marginBottom: 12 },
  rejectInput:   { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12,
                   fontSize: 14, fontFamily: "Inter_400Regular", color: "#1F1F1F", minHeight: 80,
                   textAlignVertical: "top" },
  rejectBtn:     { borderRadius: 10, paddingVertical: 12, alignItems: "center" },

  // 리스크 요약
  riskSection:   { marginHorizontal: 14, marginBottom: 14, backgroundColor: "#FFFFFF",
                   borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD" },
  riskHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  riskHeaderTxt: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", flex: 1 },
  riskGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  riskCard:      { width: "30.5%", backgroundColor: "#F6F3F1", borderRadius: 10, padding: 10,
                   borderWidth: 1, borderColor: "#E9E2DD", position: "relative", minHeight: 60 },
  riskNum:       { fontSize: 22, fontFamily: "Inter_700Bold", color: "#1F1F1F" },
  riskLabel:     { fontSize: 9, fontFamily: "Inter_500Medium", color: "#6F6B68", marginTop: 3, lineHeight: 13 },
  riskDot:       { position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },

  // 감사 로그
  auditSection:  { marginHorizontal: 14, marginBottom: 14, backgroundColor: "#FFFFFF",
                   borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#E9E2DD" },
  auditHeader:   { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  auditHeaderTxt:{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#1F1F1F", flex: 1 },
  auditRow:      { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7,
                   borderBottomWidth: 1, borderBottomColor: "#E9E2DD" },
  auditCatBadge: { backgroundColor: "#EDE9FE", borderRadius: 5, paddingHorizontal: 7,
                   paddingVertical: 3, minWidth: 50, alignItems: "center" },
  auditCatTxt:   { fontSize: 9, fontFamily: "Inter_700Bold", color: "#7C3AED" },
  auditDesc:     { fontSize: 12, fontFamily: "Inter_500Medium", color: "#1F1F1F" },
  auditMeta:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6F6B68", marginTop: 1 },
  auditEmpty:    { paddingVertical: 12, alignItems: "center" },
  auditEmptyTxt: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#6F6B68" },

  footer:        { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: 24 },
  footerTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6F6B68" },
});
