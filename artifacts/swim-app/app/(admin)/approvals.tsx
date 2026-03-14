/**
 * 승인 관리 (학부모 승인 + 선생님 승인)
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface JoinRequest {
  id: string; swimming_pool_id: string; parent_name: string; phone: string;
  request_status: "pending" | "approved" | "rejected";
  requested_at: string; processed_at?: string | null;
  rejection_reason?: string | null; parent_account_id?: string | null;
  child_name?: string | null; child_birth_year?: number | null;
  children_requested?: Array<{ childName: string; childBirthYear: number | null }> | null;
}

interface TeacherInvite {
  id: string; name: string; phone: string; position: string | null;
  invite_token: string | null; invite_status: string;
  created_at: string; requested_at: string | null;
  approved_at: string | null; user_email: string | null;
}

type Tab = "parents" | "teachers";
type Filter = "pending" | "approved" | "rejected";

const STATUS_CONFIG = {
  pending:  { label: "대기",   color: C.warning,  bg: "#FEF3C7", icon: "clock" as const },
  approved: { label: "승인",   color: C.success,  bg: "#D1FAE5", icon: "check-circle" as const },
  rejected: { label: "거절됨", color: C.error,    bg: "#FEE2E2", icon: "x-circle" as const },
};

const INVITE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  invited:               { label: "초대 보냄",  color: "#3B82F6", bg: "#DBEAFE" },
  joinedPendingApproval: { label: "승인 대기",  color: "#D97706", bg: "#FEF3C7" },
  approved:              { label: "승인 완료",  color: "#059669", bg: "#D1FAE5" },
  rejected:              { label: "거절됨",     color: "#DC2626", bg: "#FEE2E2" },
  inactive:              { label: "비활성",     color: "#6B7280", bg: "#F3F4F6" },
};

export default function ApprovalsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("parents");
  const [filter, setFilter] = useState<Filter>("pending");
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [invites, setInvites] = useState<TeacherInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      const [jrRes, iRes] = await Promise.all([
        apiRequest(token, "/admin/parent-requests"),
        apiRequest(token, "/admin/teacher-invites"),
      ]);
      if (jrRes.ok) { const d = await jrRes.json(); setJoinRequests(d.data ?? []); }
      if (iRes.ok) { const d = await iRes.json(); setInvites(d.data ?? []); }
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  async function handleJoinDecision(reqId: string, action: "approve" | "reject") {
    if (action === "reject" && !rejectReason.trim()) {
      Alert.alert("거절 사유 입력", "거절 사유를 입력해주세요.");
      return;
    }
    setProcessingId(reqId);
    try {
      const res = await apiRequest(token, `/admin/parent-requests/${reqId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejection_reason: action === "reject" ? rejectReason : undefined }),
      });
      const d = await res.json();
      if (!res.ok) { Alert.alert("오류", d.message || "처리 중 오류가 발생했습니다."); return; }
      if (action === "approve" && d.default_pin) {
        Alert.alert("승인 완료", `학부모 계정이 생성되었습니다.\n초기 PIN: ${d.default_pin}\n(학부모에게 전달해 주세요)`);
      }
      setShowRejectModal(null);
      setRejectReason("");
      await fetch();
    } finally { setProcessingId(null); }
  }

  async function handleInviteAction(inviteId: string, action: "approve" | "reject") {
    if (action === "reject" && !rejectReason.trim()) {
      Alert.alert("거절 사유 입력", "거절 사유를 입력해주세요.");
      return;
    }
    setProcessingId(inviteId);
    try {
      const res = await apiRequest(token, `/admin/teacher-invites/${inviteId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejection_reason: action === "reject" ? rejectReason : undefined }),
      });
      const d = await res.json();
      if (!res.ok) Alert.alert("오류", d.message || "처리 중 오류 발생");
      else await fetch();
      setShowRejectModal(null);
      setRejectReason("");
    } finally { setProcessingId(null); }
  }

  const filteredRequests = joinRequests.filter(r => r.request_status === filter);
  const filteredInvites = invites.filter(i => {
    if (filter === "pending") return i.invite_status === "joinedPendingApproval";
    if (filter === "approved") return i.invite_status === "approved";
    if (filter === "rejected") return i.invite_status === "rejected";
    return false;
  });

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[styles.title, { color: C.text }]}>승인 관리</Text>
      </View>

      {/* 탭 */}
      <View style={[styles.tabRow, { borderBottomColor: C.border }]}>
        {[
          { key: "parents" as Tab, label: "학부모 승인", count: joinRequests.filter(r => r.request_status === "pending").length },
          { key: "teachers" as Tab, label: "선생님 승인", count: invites.filter(i => i.invite_status === "joinedPendingApproval").length },
        ].map(t => (
          <Pressable key={t.key} style={[styles.tabItem, tab === t.key && { borderBottomColor: C.tint }]} onPress={() => { setTab(t.key); setFilter("pending"); }}>
            <Text style={[styles.tabLabel, { color: tab === t.key ? C.tint : C.textSecondary }]}>{t.label}</Text>
            {!!t.count && <View style={[styles.countBadge, { backgroundColor: C.error }]}>
              <Text style={styles.countText}>{t.count}</Text>
            </View>}
          </Pressable>
        ))}
      </View>

      {/* 상태 필터 */}
      <View style={styles.filterRow}>
        {(["pending", "approved", "rejected"] as Filter[]).map(f => {
          const cfg = STATUS_CONFIG[f];
          const count = tab === "parents"
            ? joinRequests.filter(r => r.request_status === f).length
            : invites.filter(i => {
                if (f === "pending") return i.invite_status === "joinedPendingApproval";
                if (f === "approved") return i.invite_status === "approved";
                if (f === "rejected") return i.invite_status === "rejected";
                return false;
              }).length;
          const isActive = filter === f;
          return (
            <Pressable
              key={f}
              style={[styles.filterChip, { backgroundColor: isActive ? cfg.bg : C.card, borderColor: isActive ? cfg.color : C.border }]}
              onPress={() => setFilter(f)}
            >
              <Feather name={cfg.icon} size={12} color={isActive ? cfg.color : C.textMuted} />
              <Text style={[styles.filterChipText, { color: isActive ? cfg.color : C.textSecondary }]}>{cfg.label}</Text>
              <Text style={[styles.filterCount, { color: isActive ? cfg.color : C.textMuted }]}>{count}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {/* 학부모 승인 */}
          {tab === "parents" && (
            filteredRequests.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="users" size={40} color={C.textMuted} />
                <Text style={[styles.emptyTitle, { color: C.text }]}>
                  {filter === "pending" ? "대기 중인 가입 요청이 없습니다" :
                   filter === "approved" ? "승인된 요청이 없습니다" : "거절된 요청이 없습니다"}
                </Text>
              </View>
            ) : filteredRequests.map(req => {
              const cfg = STATUS_CONFIG[req.request_status];
              const childrenList = req.children_requested && req.children_requested.length > 0
                ? req.children_requested
                : (req.child_name ? [{ childName: req.child_name, childBirthYear: req.child_birth_year }] : []);
              return (
                <View key={req.id} style={[styles.card, { backgroundColor: C.card, borderLeftColor: cfg.color, borderLeftWidth: 4 }]}>
                  <View style={styles.cardTop}>
                    <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                      <Text style={[styles.avatarText, { color: C.tint }]}>{req.parent_name[0]}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.name, { color: C.text }]}>{req.parent_name}</Text>
                      <Text style={[styles.phone, { color: C.textSecondary }]}>{req.phone}</Text>
                      <Text style={[styles.date, { color: C.textMuted }]}>{new Date(req.requested_at).toLocaleDateString("ko-KR")} 요청</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  {childrenList.length > 0 && (
                    <View style={[styles.section, { backgroundColor: C.background, borderColor: C.border }]}>
                      <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>자녀 정보</Text>
                      {childrenList.map((child, idx) => (
                        <View key={idx} style={styles.childRow}>
                          <Text style={[styles.childName, { color: C.text }]}>{child.childName}</Text>
                          {child.childBirthYear && <Text style={[styles.childBirth, { color: C.textMuted }]}>{child.childBirthYear}년생</Text>}
                        </View>
                      ))}
                    </View>
                  )}
                  {req.rejection_reason && (
                    <Text style={[styles.rejectNote, { color: C.error }]}>거절 사유: {req.rejection_reason}</Text>
                  )}
                  {req.request_status === "pending" && (
                    <View style={styles.actions}>
                      <Pressable
                        style={({ pressed }) => [styles.rejectBtn, { borderColor: C.error, opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => setShowRejectModal(req.id)}
                        disabled={processingId === req.id}
                      >
                        {processingId === req.id ? <ActivityIndicator size="small" color={C.error} /> : (
                          <><Feather name="x" size={14} color={C.error} />
                          <Text style={[styles.rejectText, { color: C.error }]}>거절</Text></>
                        )}
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.approveBtn, { backgroundColor: C.success, opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => handleJoinDecision(req.id, "approve")}
                        disabled={processingId === req.id}
                      >
                        {processingId === req.id ? <ActivityIndicator size="small" color="#fff" /> : (
                          <><Feather name="check" size={14} color="#fff" />
                          <Text style={styles.approveText}>승인</Text></>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}

          {/* 선생님 승인 */}
          {tab === "teachers" && (
            filteredInvites.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="send" size={40} color={C.textMuted} />
                <Text style={[styles.emptyTitle, { color: C.text }]}>
                  {filter === "pending" ? "대기 중인 승인이 없습니다" :
                   filter === "approved" ? "승인된 초대가 없습니다" : "거절된 초대가 없습니다"}
                </Text>
              </View>
            ) : filteredInvites.map(inv => {
              const statusKey = inv.invite_status as keyof typeof INVITE_STATUS_CONFIG;
              const cfg = INVITE_STATUS_CONFIG[statusKey] || INVITE_STATUS_CONFIG.invited;
              return (
                <View key={inv.id} style={[styles.card, { backgroundColor: C.card, borderLeftColor: cfg.color, borderLeftWidth: 4 }]}>
                  <View style={styles.cardTop}>
                    <View style={[styles.avatar, { backgroundColor: cfg.bg }]}>
                      <Feather name="user" size={18} color={cfg.color} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.name, { color: C.text }]}>{inv.name}</Text>
                      <Text style={[styles.phone, { color: C.textSecondary }]}>{inv.phone}</Text>
                      {inv.position && <Text style={[styles.date, { color: C.textMuted }]}>{inv.position}</Text>}
                      {inv.user_email && <Text style={[styles.date, { color: C.textMuted }]}>{inv.user_email}</Text>}
                    </View>
                    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  {inv.invite_status === "joinedPendingApproval" && (
                    <View style={styles.actions}>
                      <Pressable
                        style={({ pressed }) => [styles.rejectBtn, { borderColor: C.error, opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => setShowRejectModal(inv.id)}
                        disabled={processingId === inv.id}
                      >
                        {processingId === inv.id ? <ActivityIndicator size="small" color={C.error} /> : (
                          <><Feather name="x" size={14} color={C.error} />
                          <Text style={[styles.rejectText, { color: C.error }]}>거절</Text></>
                        )}
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.approveBtn, { backgroundColor: C.success, opacity: pressed ? 0.8 : 1 }]}
                        onPress={() => handleInviteAction(inv.id, "approve")}
                        disabled={processingId === inv.id}
                      >
                        {processingId === inv.id ? <ActivityIndicator size="small" color="#fff" /> : (
                          <><Feather name="check" size={14} color="#fff" />
                          <Text style={styles.approveText}>승인</Text></>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* 거절 사유 모달 */}
      <Modal visible={!!showRejectModal} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={[styles.modal, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <Text style={[styles.modalTitle, { color: C.text }]}>거절 사유 입력</Text>
            <TextInput
              style={[styles.input, { borderColor: C.border, color: C.text }]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="거절 사유를 입력해주세요"
              placeholderTextColor={C.textMuted}
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowRejectModal(null); setRejectReason(""); }}>
                <Text style={[styles.cancelText, { color: C.text }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.rejectConfirmBtn, { backgroundColor: C.error }]} onPress={() => {
                if (showRejectModal) {
                  const isParent = joinRequests.some(r => r.id === showRejectModal);
                  isParent ? handleJoinDecision(showRejectModal, "reject") : handleInviteAction(showRejectModal, "reject");
                }
              }}>
                <Text style={styles.confirmText}>거절</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
  title: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, paddingHorizontal: 16 },
  tabItem: { flex: 1, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent", alignItems: "center", gap: 4 },
  tabLabel: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  countBadge: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 10, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
  filterRow: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8, height: 50 },
  filterChip: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 4 },
  filterChipText: { fontSize: 12, fontWeight: "500", fontFamily: "Inter_500Medium" },
  filterCount: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", marginTop: 60, gap: 12 },
  emptyTitle: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  card: { height: 280, borderRadius: 12, padding: 16, gap: 10, backgroundColor: "#fff", justifyContent: "space-between" },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12, height: 70 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", minWidth: 44 },
  avatarText: { fontSize: 18, fontWeight: "700", fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  phone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  date: { fontSize: 12, fontFamily: "Inter_400Regular" },
  badge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, minWidth: 50, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  section: { borderRadius: 8, borderWidth: 1, padding: 10, gap: 6, height: 70 },
  sectionTitle: { fontSize: 12, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  childRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  childName: { fontSize: 13, fontWeight: "500", fontFamily: "Inter_500Medium" },
  childBirth: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rejectNote: { fontSize: 12, fontFamily: "Inter_400Regular", height: 36, justifyContent: "center" },
  actions: { flexDirection: "row", gap: 10, height: 48 },
  rejectBtn: { flex: 1, flexDirection: "row", borderWidth: 1.5, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 6, height: 48 },
  rejectText: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  approveBtn: { flex: 1, flexDirection: "row", borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 6, height: 48 },
  approveText: { fontSize: 13, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: "top", fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 13, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  rejectConfirmBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  confirmText: { fontSize: 13, fontWeight: "600", color: "#fff", fontFamily: "Inter_600SemiBold" },
});
