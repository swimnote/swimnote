import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";

const C = Colors.light;

interface StudentLink {
  id: string; name: string; link_id: string;
  status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null; created_at: string;
}
interface RequestedChild { childName: string; childBirthYear?: number | null; }
interface ParentRow {
  id: string; name: string; phone: string;
  students: StudentLink[];
  requested_children?: RequestedChild[];
}
interface StudentOption { id: string; name: string; class_group_name?: string | null; }

export default function ParentsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddParent, setShowAddParent] = useState(false);
  const [showAddLink, setShowAddLink] = useState<ParentRow | null>(null);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formStudentId, setFormStudentId] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const sel = useSelectionMode();

  const load = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        apiRequest(token, "/admin/parents"),
        apiRequest(token, "/students"),
      ]);
      if (pRes.ok) setParents(await pRes.json());
      if (sRes.ok) setStudents(await sRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

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
          if (res.ok) { await load(); }
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
    await load();
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
    await load();
  }

  async function handleDeleteLink(parentId: string, linkId: string) {
    Alert.alert("연결 삭제", "이 연결을 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          await apiRequest(token, `/admin/parents/${parentId}/students/${linkId}`, { method: "DELETE" });
          await load();
        },
      },
    ]);
  }

  async function doDeleteParents(ids: string[]) {
    if (ids.length === 0) return;
    const isSingle = ids.length === 1;
    if (isSingle) setDeletingId(ids[0]);
    else setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        ids.map(id => apiRequest(token, `/admin/parents/${id}`, { method: "DELETE" })
          .then(r => ({ id, ok: r.ok }))
        )
      );
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value.id);
      const failed = ids.length - succeeded.length;
      setParents(prev => prev.filter(p => !succeeded.includes(p.id)));
      if (!isSingle) sel.exitSelectionMode();
      if (failed > 0) Alert.alert("일부 실패", `${failed}개 삭제에 실패했습니다.`);
    } catch (e) {
      console.error(e);
      Alert.alert("오류", "삭제 중 오류가 발생했습니다.");
    } finally {
      setDeletingId(null);
      setBulkDeleting(false);
    }
  }

  function handleDeleteParent(id: string, name: string) {
    console.log(`[admin][deleteParent] click parentId=${id}`);
    Alert.alert(
      "학부모 계정 삭제",
      `"${name}" 계정을 삭제합니다.\n계정과 학생 연결이 모두 해제됩니다.\n자녀의 수업 이력·출결 기록은 보존됩니다.\n\n진행하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        { text: "삭제", style: "destructive", onPress: () => doDeleteParents([id]) },
      ]
    );
  }

  function handleBulkDelete() {
    const ids = Array.from(sel.selectedIds);
    if (ids.length === 0) return;
    console.log(`[admin][deleteParent] bulk selectedCount=${ids.length}`, ids);
    Alert.alert(
      "선택 학부모 삭제",
      `선택한 ${ids.length}개 학부모 계정을 삭제합니다.\n각 계정의 학생 연결이 모두 해제됩니다.\n자녀의 수업 이력은 보존됩니다.\n\n진행하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        { text: `${ids.length}개 삭제`, style: "destructive", onPress: () => doDeleteParents(ids) },
      ]
    );
  }

  const allParentIds = parents.map(p => p.id);

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

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <Text style={[styles.title, { color: C.text }]}>학부모 관리</Text>
        <View style={styles.headerRight}>
          {/* 선택 모드 토글 */}
          <Pressable
            style={[styles.selBtn, sel.selectionMode && { backgroundColor: C.tintLight }]}
            onPress={sel.toggleSelectionMode}
          >
            <Feather name="check-square" size={16} color={sel.selectionMode ? C.tint : C.textSecondary} />
            <Text style={[styles.selBtnText, sel.selectionMode && { color: C.tint }]}>
              {sel.selectionMode ? "취소" : "선택"}
            </Text>
          </Pressable>
          {!sel.selectionMode && (
            <Pressable style={[styles.addBtn, { backgroundColor: C.tint }]} onPress={() => { setFormError(""); setShowAddParent(true); }}>
              <Feather name="plus" size={16} color="#fff" />
              <Text style={styles.addBtnText}>직접 추가</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {parents.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="users" size={48} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>등록된 학부모가 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textSecondary }]}>승인 메뉴에서 가입 요청을 승인하거나 직접 추가하세요</Text>
            </View>
          ) : parents.map(pa => {
            const isSelected = sel.isSelected(pa.id);
            const isThisDeleting = deletingId === pa.id;
            return (
              <Pressable
                key={pa.id}
                style={[styles.accountCard, { backgroundColor: C.card }, isSelected && { borderWidth: 2, borderColor: C.tint }]}
                onPress={sel.selectionMode ? () => sel.toggleItem(pa.id) : undefined}
              >
                <View style={styles.accountHeader}>
                  {/* 선택 모드 체크박스 */}
                  {sel.selectionMode && (
                    <Pressable onPress={() => sel.toggleItem(pa.id)} style={styles.checkWrap}>
                      <View style={[styles.checkbox, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
                        {isSelected && <Feather name="check" size={12} color="#fff" />}
                      </View>
                    </Pressable>
                  )}
                  <View style={[styles.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[styles.avatarText, { color: C.tint }]}>{pa.name[0]}</Text>
                  </View>
                  <View style={styles.accountInfo}>
                    <Text style={[styles.accountName, { color: C.text }]}>{pa.name}</Text>
                    <Text style={[styles.accountPhone, { color: C.textSecondary }]}>{pa.phone}</Text>
                  </View>
                  {/* 선택모드: 카드 우측엔 아무것도 안 보임 / 일반모드: 연결+삭제 */}
                  {!sel.selectionMode && (
                    <View style={styles.cardActions}>
                      <Pressable
                        style={[styles.linkBtn, { borderColor: C.tint }]}
                        onPress={() => { setFormStudentId(""); setStudentSearch(""); setFormError(""); setShowAddLink(pa); }}
                      >
                        <Feather name="link" size={13} color={C.tint} />
                        <Text style={[styles.linkBtnText, { color: C.tint }]}>학생 연결</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.deleteParentBtn, isThisDeleting && { opacity: 0.5 }]}
                        onPress={!isThisDeleting ? () => handleDeleteParent(pa.id, pa.name) : undefined}
                        disabled={isThisDeleting}
                      >
                        {isThisDeleting
                          ? <ActivityIndicator size={14} color={C.error} />
                          : <Feather name="trash-2" size={15} color={C.error} />
                        }
                      </Pressable>
                    </View>
                  )}
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
                          {!sel.selectionMode && s.status === "pending" && (
                            <>
                              <Pressable onPress={() => handleDecision(s.link_id, pa.id, "approve")} style={[styles.miniBtn, { backgroundColor: C.success }]}>
                                <Feather name="check" size={12} color="#fff" />
                              </Pressable>
                              <Pressable onPress={() => handleDecision(s.link_id, pa.id, "reject")} style={[styles.miniBtn, { backgroundColor: C.error }]}>
                                <Feather name="x" size={12} color="#fff" />
                              </Pressable>
                            </>
                          )}
                          {!sel.selectionMode && (
                            <Pressable onPress={() => handleDeleteLink(pa.id, s.link_id)}>
                              <Feather name="trash-2" size={14} color={C.textMuted} />
                            </Pressable>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* 선택 모드 액션바 */}
      <SelectionActionBar
        visible={sel.selectionMode}
        selectedCount={sel.selectedCount}
        totalCount={parents.length}
        isAllSelected={sel.isAllSelected(allParentIds)}
        deleting={bulkDeleting}
        onSelectAll={() => sel.selectAll(allParentIds)}
        onClearSelection={sel.clearSelection}
        onDeleteSelected={handleBulkDelete}
        onExit={sel.exitSelectionMode}
      />

      {/* 학부모 직접 추가 모달 */}
      <Modal visible={showAddParent} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>학부모 계정 직접 추가</Text>
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

      {/* 학생 연결 요청 모달 */}
      <Modal visible={!!showAddLink} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: C.text }]}>학생 연결 요청</Text>
            <View style={[styles.infoBox, { backgroundColor: "#FEF3C7", borderColor: C.warning }]}>
              <Feather name="info" size={13} color={C.warning} />
              <Text style={[styles.infoText, { color: "#92400E" }]}>연결 요청은 관리자 승인 후 학부모에게 노출됩니다.</Text>
            </View>

            {/* 신청 시 입력한 자녀명 */}
            {(showAddLink?.requested_children ?? []).length > 0 && (
              <View style={[styles.childRefBox, { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" }]}>
                <View style={styles.childRefHeader}>
                  <Feather name="user-check" size={13} color="#4338CA" />
                  <Text style={[styles.childRefLabel, { color: "#4338CA" }]}>가입 신청 시 입력한 자녀</Text>
                </View>
                {(showAddLink?.requested_children ?? []).map((c, i) => (
                  <View key={i} style={styles.childRefRow}>
                    <Text style={[styles.childRefName, { color: C.text }]}>{c.childName}</Text>
                    {c.childBirthYear && (
                      <Text style={[styles.childRefYear, { color: C.textMuted }]}>{c.childBirthYear}년생</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {!!formError && <View style={[styles.errBox, { backgroundColor: "#FEE2E2" }]}>
              <Text style={[styles.errText, { color: C.error }]}>{formError}</Text>
            </View>}

            <Text style={[styles.label, { color: C.textSecondary }]}>실제 학생 기록 검색</Text>
            <View style={[styles.searchRow, { borderColor: C.border, backgroundColor: C.background }]}>
              <Feather name="search" size={15} color={C.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: C.text }]}
                value={studentSearch}
                onChangeText={setStudentSearch}
                placeholder="이름으로 검색..."
                placeholderTextColor={C.textMuted}
              />
              {studentSearch.length > 0 && (
                <Pressable onPress={() => { setStudentSearch(""); setFormStudentId(""); }}>
                  <Feather name="x-circle" size={15} color={C.textMuted} />
                </Pressable>
              )}
            </View>

            <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
              {studentSearch.trim().length === 0 ? (
                <View style={styles.searchHint}>
                  <Text style={[styles.searchHintText, { color: C.textMuted }]}>이름을 입력하면 학생 목록이 표시됩니다</Text>
                </View>
              ) : students.filter(s =>
                s.name.includes(studentSearch.trim()) &&
                !showAddLink?.students.some(ls => ls.id === s.id && ls.status !== "rejected")
              ).length === 0 ? (
                <View style={styles.searchHint}>
                  <Text style={[styles.searchHintText, { color: C.textMuted }]}>"{studentSearch}"에 해당하는 학생이 없습니다</Text>
                </View>
              ) : (
                students.filter(s =>
                  s.name.includes(studentSearch.trim()) &&
                  !showAddLink?.students.some(ls => ls.id === s.id && ls.status !== "rejected")
                ).map(s => (
                  <Pressable key={s.id}
                    style={[styles.studentOption, { borderColor: formStudentId === s.id ? C.tint : C.border, backgroundColor: formStudentId === s.id ? C.tintLight : "transparent" }]}
                    onPress={() => setFormStudentId(s.id)}
                  >
                    <Feather name={formStudentId === s.id ? "check-circle" : "circle"} size={16} color={formStudentId === s.id ? C.tint : C.textMuted} />
                    <Text style={[styles.optionName, { color: C.text }]}>{s.name}</Text>
                    {s.class_group_name && <Text style={[styles.optionSub, { color: C.textMuted }]}>{s.class_group_name}</Text>}
                  </Pressable>
                ))
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable style={[styles.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowAddLink(null); setStudentSearch(""); }}>
                <Text style={[styles.cancelText, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[styles.submitBtn, { backgroundColor: formStudentId ? C.tint : C.border }]} onPress={handleAddLink} disabled={submitting || !formStudentId}>
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
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  selBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  checkWrap: { justifyContent: "center", marginRight: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, backgroundColor: C.background, alignItems: "center", justifyContent: "center" },
  avatar: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  accountCard: { borderRadius: 14, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2, borderWidth: 1.5, borderColor: "transparent" },
  accountHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  accountPhone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  linkBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  deleteParentBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#FEE2E2" },
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
  childRefBox: { borderRadius: 10, borderWidth: 1.5, padding: 12, gap: 6 },
  childRefHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  childRefLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  childRefRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  childRefName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  childRefYear: { fontSize: 12, fontFamily: "Inter_400Regular" },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  searchHint: { paddingVertical: 16, alignItems: "center" },
  searchHintText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  submitBtn: { flex: 2, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
