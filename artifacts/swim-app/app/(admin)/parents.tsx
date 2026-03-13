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

interface StudentLink {
  id: string; name: string; link_id: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null; created_at: string;
}
interface ParentRow {
  id: string; name: string; phone: string;
  students: StudentLink[];
}
interface StudentOption { id: string; name: string; class_group_name?: string | null; }

type Tab = "accounts" | "pending";

export default function ParentsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("pending");
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [pendingLinks, setPendingLinks] = useState<any[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showAddParent, setShowAddParent] = useState(false);
  const [showAddLink, setShowAddLink] = useState<ParentRow | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formStudentId, setFormStudentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const fetch = useCallback(async () => {
    try {
      const [pRes, pndRes, sRes] = await Promise.all([
        apiRequest(token, "/admin/parents"),
        apiRequest(token, "/admin/pending-connections"),
        apiRequest(token, "/students"),
      ]);
      if (pRes.ok) setParents(await pRes.json());
      if (pndRes.ok) setPendingLinks(await pndRes.json());
      if (sRes.ok) setStudents(await sRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  async function handleDecision(linkId: string, parentId: string, action: "approve" | "reject") {
    const label = action === "approve" ? "승인" : "거부";
    Alert.alert(`연결 ${label}`, `이 연결 요청을 ${label}하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: label, style: action === "reject" ? "destructive" : "default",
        onPress: async () => {
          const res = await apiRequest(token, `/admin/parents/${parentId}/students/${linkId}`, {
            method: "PATCH", body: JSON.stringify({ action }),
          });
          if (res.ok) { await fetch(); }
          else { const d = await res.json(); Alert.alert("오류", d.error || "처리 중 오류가 발생했습니다."); }
        },
      },
    ]);
  }

  async function handleAddParent() {
    if (!formName || !formPhone || !formPin) { setFormError("모든 필드를 입력해주세요."); return; }
    setSubmitting(true); setFormError("");
    const res = await apiRequest(token, "/admin/parents", {
      method: "POST", body: JSON.stringify({ name: formName, phone: formPhone, pin: formPin }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setFormError(data.error || "오류가 발생했습니다."); return; }
    setShowAddParent(false); setFormName(""); setFormPhone(""); setFormPin("");
    await fetch();
  }

  async function handleAddLink() {
    if (!formStudentId || !showAddLink) { setFormError("학생을 선택해주세요."); return; }
    setSubmitting(true); setFormError("");
    const res = await apiRequest(token, `/admin/parents/${showAddLink.id}/students`, {
      method: "POST", body: JSON.stringify({ student_id: formStudentId }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) { setFormError(data.error || "오류가 발생했습니다."); return; }
    setShowAddLink(null); setFormStudentId("");
    setTab("pending");
    await fetch();
  }

  async function handleDeleteLink(parentId: string, linkId: string) {
    Alert.alert("연결 삭제", "이 연결을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          await apiRequest(token, `/admin/parents/${parentId}/students/${linkId}`, { method: "DELETE" });
          await fetch();
        },
      },
    ]);
  }

  const statusBadge = (status: string) => {
    const map: Record<string, { color: string; bg: string; label: string }> = {
      pending: { color: C.warning, bg: "#FEF3C7", label: "승인 대기" },
      approved: { color: C.success, bg: "#D1FAE5", label: "승인됨" },
      rejected: { color: C.error, bg: "#FEE2E2", label: "거부됨" },
    };
    const s = map[status] || map["pending"];
    return (
      <View style={[styles.badge, { backgroundColor: s.bg }]}>
        <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
      </View>
    );
  };

  const pendingCount = pendingLinks.length;

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[styles.title, { color: C.text }]}>학부모 관리</Text>
        <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => { setFormError(""); setShowAddParent(true); }}>
          <Feather name="plus" size={16} color="#fff" />
          <Text style={styles.addBtnText}>학부모 추가</Text>
        </Pressable>
      </View>

      <View style={[styles.tabRow, { borderBottomColor: C.border }]}>
        {([
          { key: "pending", label: "승인 대기", count: pendingCount },
          { key: "accounts", label: "전체 계정" },
        ] as const).map(t => (
          <Pressable key={t.key} style={[styles.tabItem, tab === t.key && { borderBottomColor: C.tint }]} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabLabel, { color: tab === t.key ? C.tint : C.textSecondary }]}>{t.label}</Text>
            {!!t.count && <View style={[styles.countBadge, { backgroundColor: C.error }]}>
              <Text style={styles.countText}>{t.count}</Text>
            </View>}
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === "pending" && (
            pendingLinks.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="check-circle" size={48} color={C.success} />
                <Text style={[styles.emptyTitle, { color: C.text }]}>대기 중인 연결이 없습니다</Text>
                <Text style={[styles.emptySub, { color: C.textSecondary }]}>모든 연결 요청이 처리되었습니다</Text>
              </View>
            ) : pendingLinks.map((item: any) => (
              <View key={item.link_id} style={[styles.pendingCard, { backgroundColor: C.card, borderLeftColor: C.warning }]}>
                <View style={styles.pendingMeta}>
                  <View style={[styles.badge, { backgroundColor: "#FEF3C7" }]}>
                    <Feather name="clock" size={11} color={C.warning} />
                    <Text style={[styles.badgeText, { color: C.warning }]}>승인 대기</Text>
                  </View>
                  <Text style={[styles.metaDate, { color: C.textMuted }]}>
                    {new Date(item.created_at).toLocaleDateString("ko-KR")}
                  </Text>
                </View>
                <View style={styles.pendingInfo}>
                  <View style={styles.pendingPerson}>
                    <View style={[styles.smallAvatar, { backgroundColor: C.tintLight }]}>
                      <Feather name="user" size={14} color={C.tint} />
                    </View>
                    <View>
                      <Text style={[styles.personName, { color: C.text }]}>{item.parent?.name}</Text>
                      <Text style={[styles.personSub, { color: C.textMuted }]}>{item.parent?.phone}</Text>
                    </View>
                  </View>
                  <Feather name="arrow-right" size={16} color={C.textMuted} />
                  <View style={styles.pendingPerson}>
                    <View style={[styles.smallAvatar, { backgroundColor: "#D1FAE5" }]}>
                      <Feather name="user" size={14} color={C.success} />
                    </View>
                    <View>
                      <Text style={[styles.personName, { color: C.text }]}>{item.student?.name}</Text>
                      <Text style={[styles.personSub, { color: C.textMuted }]}>학생</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    style={({ pressed }) => [styles.rejectBtn, { borderColor: C.error, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => handleDecision(item.link_id, item.parent?.id, "reject")}
                  >
                    <Feather name="x" size={14} color={C.error} />
                    <Text style={[styles.rejectBtnText, { color: C.error }]}>거부</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.approveBtn, { backgroundColor: C.success, opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => handleDecision(item.link_id, item.parent?.id, "approve")}
                  >
                    <Feather name="check" size={14} color="#fff" />
                    <Text style={styles.approveBtnText}>승인</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {tab === "accounts" && (
            parents.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="users" size={48} color={C.textMuted} />
                <Text style={[styles.emptyTitle, { color: C.text }]}>등록된 학부모가 없습니다</Text>
                <Text style={[styles.emptySub, { color: C.textSecondary }]}>상단 버튼으로 학부모를 추가하세요</Text>
              </View>
            ) : parents.map(pa => (
              <View key={pa.id} style={[styles.accountCard, { backgroundColor: C.card }]}>
                <View style={styles.accountHeader}>
                  <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.avatarText, { color: C.tint }]}>{pa.name[0]}</Text>
                  </View>
                  <View style={styles.accountInfo}>
                    <Text style={[styles.accountName, { color: C.text }]}>{pa.name}</Text>
                    <Text style={[styles.accountPhone, { color: C.textSecondary }]}>{pa.phone}</Text>
                  </View>
                  <Pressable
                    style={[styles.linkBtn, { borderColor: C.tint }]}
                    onPress={() => { setFormStudentId(""); setFormError(""); setShowAddLink(pa); }}
                  >
                    <Feather name="link" size={13} color={C.tint} />
                    <Text style={[styles.linkBtnText, { color: C.tint }]}>학생 연결</Text>
                  </Pressable>
                </View>

                {pa.students.length > 0 && (
                  <View style={[styles.studentsSection, { borderTopColor: C.border }]}>
                    {pa.students.map((s: StudentLink) => (
                      <View key={s.link_id} style={styles.studentRow}>
                        <View style={styles.studentLeft}>
                          {statusBadge(s.status)}
                          <Text style={[styles.studentName, { color: C.text }]}>{s.name}</Text>
                        </View>
                        <View style={styles.studentRight}>
                          {s.status === "pending" && (
                            <>
                              <Pressable onPress={() => handleDecision(s.link_id, pa.id, "approve")} style={[styles.miniBtn, { backgroundColor: C.success }]}>
                                <Feather name="check" size={12} color="#fff" />
                              </Pressable>
                              <Pressable onPress={() => handleDecision(s.link_id, pa.id, "reject")} style={[styles.miniBtn, { backgroundColor: C.error }]}>
                                <Feather name="x" size={12} color="#fff" />
                              </Pressable>
                            </>
                          )}
                          <Pressable onPress={() => handleDeleteLink(pa.id, s.link_id)}>
                            <Feather name="trash-2" size={14} color={C.textMuted} />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* 학부모 추가 모달 */}
      <Modal visible={showAddParent} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>학부모 계정 추가</Text>

            {!!formError && <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{formError}</Text>
            </View>}

            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>이름</Text>
              <TextInput style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={formName} onChangeText={setFormName} placeholder="홍길동" placeholderTextColor={C.textMuted} />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>전화번호</Text>
              <TextInput style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={formPhone} onChangeText={setFormPhone} placeholder="010-0000-0000" keyboardType="phone-pad" placeholderTextColor={C.textMuted} />
            </View>
            <View style={styles.field}>
              <Text style={[styles.label, { color: C.textSecondary }]}>PIN 번호 (4자리 이상)</Text>
              <TextInput style={[styles.input, { borderColor: C.border, color: C.text }]}
                value={formPin} onChangeText={setFormPin} placeholder="****" keyboardType="number-pad"
                secureTextEntry maxLength={8} placeholderTextColor={C.textMuted} />
            </View>

            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => setShowAddParent(false)}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, { backgroundColor: C.tint }]} onPress={handleAddParent} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>추가</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 학생 연결 모달 */}
      <Modal visible={!!showAddLink} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>학생 연결 요청</Text>
            <View style={[styles.infoBox, { backgroundColor: "#FEF3C7", borderColor: C.warning }]}>
              <Feather name="info" size={13} color={C.warning} />
              <Text style={[styles.infoText, { color: "#92400E" }]}>
                연결 요청은 관리자 승인 후 학부모에게 노출됩니다.
              </Text>
            </View>
            {!!formError && <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{formError}</Text>
            </View>}

            <Text style={[styles.label, { color: C.textSecondary }]}>학생 선택</Text>
            <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
              {students
                .filter(s => !showAddLink?.students.some(ls => ls.id === s.id && ls.status !== "rejected"))
                .map(s => (
                <Pressable key={s.id}
                  style={[styles.studentOption, { borderColor: formStudentId === s.id ? C.tint : C.border, backgroundColor: formStudentId === s.id ? C.tintLight : "transparent" }]}
                  onPress={() => setFormStudentId(s.id)}
                >
                  <Feather name={formStudentId === s.id ? "check-circle" : "circle"} size={16} color={formStudentId === s.id ? C.tint : C.textMuted} />
                  <Text style={[styles.optionName, { color: C.text }]}>{s.name}</Text>
                  {s.class_group_name && <Text style={[styles.optionSub, { color: C.textMuted }]}>{s.class_group_name}</Text>}
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => setShowAddLink(null)}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, { backgroundColor: C.tint }]} onPress={handleAddLink} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>연결 요청</Text>}
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1, marginHorizontal: 16 },
  tabItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  countBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  countText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  pendingCard: { borderRadius: 14, padding: 16, gap: 12, borderLeftWidth: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  pendingMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pendingInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pendingPerson: { flexDirection: "row", alignItems: "center", gap: 10 },
  smallAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  personName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  personSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  rejectBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  rejectBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  approveBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10 },
  approveBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  accountCard: { borderRadius: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  accountHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  avatar: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  accountPhone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  linkBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  studentsSection: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  studentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  studentLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  studentRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  studentName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  miniBtn: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errBox: { padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular" },
  studentOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, marginBottom: 8 },
  optionName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  optionSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 2, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
