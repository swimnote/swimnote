/**
 * (super)/dashboard.tsx — 슈퍼관리자 운영 콘솔
 * 홈: 6대 KPI → 오늘 처리할 일 큐(인라인 액션) → 9개 메뉴 그리드
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest, useAuth } from "@/context/AuthContext";

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
  { id: "ops",     icon: "users" as const,         title: "운영자 관리",       sub: "승인·반려·제한·종료",        path: "/(super)/pools",        color: P,         bg: "#EDE9FE" },
  { id: "sub",     icon: "credit-card" as const,   title: "구독·결제",         sub: "플랜·결제실패·환불·차지백",  path: "/(super)/subscriptions", color: "#0891B2", bg: "#ECFEFF" },
  { id: "store",   icon: "hard-drive" as const,    title: "저장공간",           sub: "사용량·급증·차단·삭제큐",   path: "/(super)/storage",      color: "#059669", bg: "#D1FAE5" },
  { id: "kill",    icon: "alert-triangle" as const, title: "데이터·킬스위치",  sub: "삭제·유예·실행로그",         path: "/(super)/kill-switch",  color: "#DC2626", bg: "#FEE2E2" },
  { id: "policy",  icon: "file-text" as const,     title: "정책·컴플라이언스", sub: "환불·개인정보·버전·동의",    path: "/(super)/policy",       color: "#D97706", bg: "#FEF3C7" },
  { id: "logs",    icon: "activity" as const,      title: "운영 로그·감사",     sub: "결제·삭제·보안 이벤트",     path: "/(super)/op-logs",      color: "#4F46E5", bg: "#EEF2FF" },
  { id: "support", icon: "message-circle" as const, title: "고객센터",          sub: "문의·SLA·환불·결제연결",    path: "/(super)/support",      color: "#0284C7", bg: "#E0F2FE" },
  { id: "risk",    icon: "shield" as const,        title: "장애·리스크",        sub: "오늘 처리 큐·서비스 상태",  path: "/(super)/risk-center",  color: "#9333EA", bg: "#F3E8FF" },
  { id: "flags",   icon: "toggle-left" as const,   title: "기능 플래그",        sub: "ON/OFF·운영자별 예외",      path: "/(super)/feature-flags", color: "#059669", bg: "#D1FAE5" },
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
          <Pressable style={[tr.btn, { backgroundColor: "#D1FAE5" }]} onPress={() => onAction("approve", item.id)}>
            <Text style={[tr.btnTxt, { color: "#059669" }]}>승인</Text>
          </Pressable>
          <Pressable style={[tr.btn, { backgroundColor: "#FEE2E2" }]} onPress={() => onAction("reject", item.id)}>
            <Text style={[tr.btnTxt, { color: "#DC2626" }]}>반려</Text>
          </Pressable>
        </>}
        {item.todo_type === "deletion_pending" && (
          <Pressable style={[tr.btn, { backgroundColor: "#ECFEFF" }]} onPress={() => onAction("defer", item.id)}>
            <Text style={[tr.btnTxt, { color: "#0891B2" }]}>유예</Text>
          </Pressable>
        )}
        {item.todo_type === "policy_unsigned" && (
          <Pressable style={[tr.btn, { backgroundColor: "#EEF2FF" }]} onPress={() => onAction("policy_reminder", item.id)}>
            <Text style={[tr.btnTxt, { color: "#4F46E5" }]}>재알림</Text>
          </Pressable>
        )}
        <Pressable style={[tr.btn, { backgroundColor: "#F3F4F6" }]} onPress={() => router.push(`/(super)/operator-detail?id=${item.id}` as any)}>
          <Text style={[tr.btnTxt, { color: "#374151" }]}>상세</Text>
        </Pressable>
      </View>
    </View>
  );
}

const tr = StyleSheet.create({
  row:     { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8,
             paddingLeft: 10, borderLeftWidth: 3, marginBottom: 4 },
  name:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  sub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
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
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color="#9CA3AF" style={{ marginLeft: "auto" }} />
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
  title:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  badge:    { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  body:     { paddingHorizontal: 12, paddingBottom: 8 },
  more:     { alignItems: "center", paddingVertical: 8 },
  moreTxt:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
export default function SuperDashboard() {
  const { logout, user, token } = useAuth();
  const [stats,      setStats]      = useState<Stats | null>(null);
  const [todo,       setTodo]       = useState<Todo | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rejectModal, setRejectModal] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [processing, setProcessing] = useState(false);

  async function load() {
    try {
      const res = await apiRequest(token, "/super/dashboard-stats");
      if (res.ok) {
        const d = await res.json();
        setStats(d.stats ?? null);
        setTodo(d.todo ?? null);
      }
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { load(); }, []);

  async function doAction(action: string, id: string) {
    if (action === "reject") { setRejectModal({ id }); return; }
    setProcessing(true);
    try {
      if (action === "approve") {
        await apiRequest(token, `/super/operators/${id}/approve`, { method: "PATCH" });
      } else if (action === "defer") {
        await apiRequest(token, `/super/operators/${id}/defer-deletion`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: 48 }),
        });
      } else if (action === "policy_reminder") {
        await apiRequest(token, `/super/operators/${id}/policy-reminder`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy_key: "refund_policy" }),
        });
      }
      load();
    } catch {}
    finally { setProcessing(false); }
  }

  async function doReject() {
    if (!rejectModal) return;
    setProcessing(true);
    try {
      await apiRequest(token, `/super/operators/${rejectModal.id}/reject`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason || "기준 미달" }),
      });
      setRejectModal(null); setRejectReason(""); load();
    } catch {}
    finally { setProcessing(false); }
  }

  const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const totalAlerts = (stats?.pending_operators ?? 0) + (stats?.payment_issue_count ?? 0) +
    (stats?.storage_danger_count ?? 0) + (stats?.deletion_pending_count ?? 0);
  const todoCount = (todo?.pending_approval.length ?? 0) + (todo?.payment_failed.length ?? 0) +
    (todo?.storage_danger.length ?? 0) + (todo?.deletion_pending.length ?? 0) +
    (todo?.policy_unsigned.length ?? 0) + (todo?.security_events.length ?? 0) +
    (todo?.support_open_count ?? 0);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      {/* 반려 모달 */}
      <Modal visible={!!rejectModal} transparent animationType="fade" onRequestClose={() => setRejectModal(null)}>
        <Pressable style={s.overlay} onPress={() => setRejectModal(null)}>
          <Pressable style={s.rejectSheet} onPress={() => {}}>
            <Text style={s.rejectTitle}>반려 사유</Text>
            <TextInput style={s.rejectInput} value={rejectReason} onChangeText={setRejectReason}
              placeholder="반려 사유를 입력하세요" multiline numberOfLines={3} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable style={[s.rejectBtn, { flex: 1, backgroundColor: "#F3F4F6" }]} onPress={() => setRejectModal(null)}>
                <Text style={{ color: "#374151", fontFamily: "Inter_600SemiBold" }}>취소</Text>
              </Pressable>
              <Pressable style={[s.rejectBtn, { flex: 1, backgroundColor: "#DC2626" }]} onPress={doReject} disabled={processing}>
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>반려 확인</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 헤더 */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>운영 콘솔</Text>
          <Text style={s.headerSub}>{today}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {totalAlerts > 0 && (
            <Pressable style={s.alertPill} onPress={() => router.push("/(super)/risk-center" as any)}>
              <Feather name="alert-circle" size={13} color="#DC2626" />
              <Text style={s.alertPillTxt}>{totalAlerts}건 처리 필요</Text>
            </Pressable>
          )}
          <View style={s.avatarCircle}>
            <Text style={s.avatarTxt}>{user?.name?.[0] ?? "S"}</Text>
          </View>
          <Pressable style={s.logoutBtn} onPress={logout}>
            <Feather name="log-out" size={15} color={P} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={P}
          onRefresh={() => { setRefreshing(true); load(); }} />}>

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
                <Text style={[s.statNum, item.alert && item.v > 0 && { color: "#DC2626" }]}>{item.v}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* ── 오늘 처리할 일 ── */}
        {!loading && todoCount > 0 && (
          <View style={s.todoSection}>
            <View style={s.todoHeader}>
              <Feather name="clipboard" size={15} color="#111827" />
              <Text style={s.todoHeaderTxt}>오늘 처리할 일</Text>
              <View style={s.todoBadge}>
                <Text style={s.todoBadgeTxt}>{todoCount}</Text>
              </View>
            </View>

            {/* 승인 대기 */}
            <TodoSection
              title="승인 대기" count={todo?.pending_approval.length ?? 0}
              color="#D97706" bg="#FEF3C7" icon="user-check"
              items={todo?.pending_approval ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#D97706" onAction={doAction} />
              )}
              path="/(super)/pools?filter=pending"
              pathLabel={`${(todo?.pending_approval.length ?? 0) - 3}건 더 보기 →`}
            />

            {/* 결제 실패 */}
            <TodoSection
              title="결제 실패" count={todo?.payment_failed.length ?? 0}
              color="#DC2626" bg="#FEE2E2" icon="credit-card"
              items={todo?.payment_failed ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#DC2626" onAction={doAction} />
              )}
              path="/(super)/subscriptions"
            />

            {/* 저장공간 위험 */}
            <TodoSection
              title="저장 95% 초과" count={todo?.storage_danger.length ?? 0}
              color={P} bg="#EDE9FE" icon="hard-drive"
              items={todo?.storage_danger ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color={P} onAction={doAction} />
              )}
              path="/(super)/storage"
            />

            {/* 자동삭제 예정 */}
            <TodoSection
              title="24h 내 자동삭제" count={todo?.deletion_pending.length ?? 0}
              color="#0891B2" bg="#ECFEFF" icon="clock"
              items={todo?.deletion_pending ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#0891B2" onAction={doAction} />
              )}
              path="/(super)/risk-center"
            />

            {/* 정책 미확인 */}
            <TodoSection
              title="정책 미확인" count={todo?.policy_unsigned.length ?? 0}
              color="#4F46E5" bg="#EEF2FF" icon="file-text"
              items={todo?.policy_unsigned ?? []}
              renderItem={(item: TodoItem) => (
                <TodoRow item={item} color="#4F46E5" onAction={doAction} />
              )}
              path="/(super)/policy"
            />

            {/* 보안 이벤트 */}
            {(todo?.security_events.length ?? 0) > 0 && (
              <TodoSection
                title="보안 이벤트 (24h)" count={todo?.security_events.length ?? 0}
                color="#991B1B" bg="#FEE2E2" icon="shield"
                items={todo?.security_events ?? []}
                renderItem={(item: TodoItem) => (
                  <View style={[tr.row, { borderLeftColor: "#991B1B" }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={tr.name} numberOfLines={1}>{item.pool_name ?? item.name ?? "플랫폼"}</Text>
                      <Text style={tr.sub} numberOfLines={1}>{item.description ?? ""} · {relStr(item.created_at)}</Text>
                    </View>
                    <Pressable style={[tr.btn, { backgroundColor: "#FEE2E2" }]}
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
                  <View style={[ts.badge, { backgroundColor: "#DC2626" }]}>
                    <Text style={ts.badgeTxt}>{todo?.support_overdue_count}</Text>
                  </View>
                )}
                <Feather name="chevron-right" size={14} color="#0284C7" />
              </Pressable>
            )}
          </View>
        )}

        {/* ── 메뉴 그리드 (9개) ── */}
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
          <Feather name="user" size={13} color="#9CA3AF" />
          <Text style={s.footerTxt}>{user?.name ?? "슈퍼관리자"} · 슈퍼관리자 계정</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: "#0F0A1E" },
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                   paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 },
  headerTitle:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  headerSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },
  alertPill:     { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2",
                   borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  alertPillTxt:  { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" },
  avatarCircle:  { width: 34, height: 34, borderRadius: 17, backgroundColor: P,
                   alignItems: "center", justifyContent: "center" },
  avatarTxt:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn:     { width: 34, height: 34, borderRadius: 9, backgroundColor: "rgba(124,58,237,0.15)",
                   alignItems: "center", justifyContent: "center" },

  statsGrid:     { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 14, gap: 8, marginBottom: 10 },
  statCard:      { width: "30.5%", backgroundColor: "#1A1030", borderRadius: 12, padding: 12,
                   borderWidth: 1, borderColor: "#2D1B4E", position: "relative" },
  statAlert:     { borderColor: "#450A0A", backgroundColor: "#1C0A0A" },
  alertDot:      { position: "absolute", top: 8, right: 8, width: 7, height: 7,
                   borderRadius: 3.5, backgroundColor: "#DC2626" },
  statNum:       { fontSize: 24, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  statLabel:     { fontSize: 10, fontFamily: "Inter_500Medium", color: "#6B7280", marginTop: 2, lineHeight: 14 },

  // 처리 큐 영역
  todoSection:   { marginHorizontal: 14, marginBottom: 14 },
  todoHeader:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  todoHeaderTxt: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#F9FAFB", flex: 1 },
  todoBadge:     { backgroundColor: "#DC2626", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  todoBadgeTxt:  { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  supportBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff",
                   borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#E5E7EB",
                   marginBottom: 10 },
  supportTitle:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#111827" },
  supportSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", marginTop: 2 },

  menuSection:   { paddingHorizontal: 14 },
  menuGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  menuCard:      { width: "47.5%", backgroundColor: "#1A1030", borderRadius: 16, padding: 16,
                   borderWidth: 1, borderColor: "#2D1B4E", gap: 8 },
  menuIconBox:   { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuTitle:     { fontSize: 14, fontFamily: "Inter_700Bold", color: "#F9FAFB" },
  menuSub:       { fontSize: 10, fontFamily: "Inter_400Regular", color: "#6B7280", lineHeight: 15 },

  // 반려 모달
  overlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  rejectSheet:   { backgroundColor: "#fff", borderRadius: 20, padding: 20, margin: 16 },
  rejectTitle:   { fontSize: 17, fontFamily: "Inter_700Bold", color: "#111827", marginBottom: 12 },
  rejectInput:   { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 10, padding: 12,
                   fontSize: 14, fontFamily: "Inter_400Regular", color: "#111827", minHeight: 80,
                   textAlignVertical: "top" },
  rejectBtn:     { borderRadius: 10, paddingVertical: 12, alignItems: "center" },

  footer:        { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: 24 },
  footerTxt:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "#4B5563" },
});
