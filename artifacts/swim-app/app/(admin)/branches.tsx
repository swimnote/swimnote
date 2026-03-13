import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, Modal, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  memo: string | null;
  display_order: number;
}

export default function BranchesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Branch | null>(null);
  const [form, setForm] = useState({ name: "", address: "", phone: "", memo: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [detailTarget, setDetailTarget] = useState<Branch | null>(null);

  async function fetchBranches() {
    try {
      const res = await apiRequest(token, "/branches");
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchBranches(); }, []);

  function openAdd() {
    setEditTarget(null);
    setForm({ name: "", address: "", phone: "", memo: "" });
    setFormError("");
    setShowModal(true);
  }

  function openEdit(b: Branch) {
    setEditTarget(b);
    setForm({ name: b.name, address: b.address || "", phone: b.phone || "", memo: b.memo || "" });
    setFormError("");
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError("지점명을 입력해주세요."); return; }
    setSaving(true); setFormError("");
    try {
      if (editTarget) {
        const res = await apiRequest(token, `/branches/${editTarget.id}`, {
          method: "PUT", body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBranches(prev => prev.map(b => b.id === editTarget.id ? data : b));
      } else {
        const res = await apiRequest(token, "/branches", {
          method: "POST", body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setBranches(prev => [...prev, data]);
      }
      setShowModal(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "저장 중 오류가 발생했습니다.");
    } finally { setSaving(false); }
  }

  async function handleDelete(b: Branch) {
    Alert.alert("지점 삭제", `"${b.name}" 지점을 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive", onPress: async () => {
          await apiRequest(token, `/branches/${b.id}`, { method: "DELETE" });
          setBranches(prev => prev.filter(x => x.id !== b.id));
        },
      },
    ]);
  }

  // 순서 변경: 위로 이동
  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...branches];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setBranches(next);
    saveOrder(next);
  }

  // 순서 변경: 아래로 이동
  function moveDown(idx: number) {
    if (idx === branches.length - 1) return;
    const next = [...branches];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setBranches(next);
    saveOrder(next);
  }

  async function saveOrder(list: Branch[]) {
    try {
      await apiRequest(token, "/branches/reorder/bulk", {
        method: "PUT",
        body: JSON.stringify({ ordered_ids: list.map(b => b.id) }),
      });
    } catch (err) { console.error("순서 저장 실패", err); }
  }

  // 가나다순 정렬
  function sortKorean() {
    const sorted = [...branches].sort((a, b) => a.name.localeCompare(b.name, "ko"));
    setBranches(sorted);
    saveOrder(sorted);
  }

  const koreanInitial = (name: string) => {
    const code = name.charCodeAt(0) - 0xAC00;
    if (code < 0) return name[0];
    const initials = ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
    return initials[Math.floor(code / 588)] ?? name[0];
  };

  const CARD_COLORS = ["#EFF6FF","#F0FDF4","#FFF7ED","#FDF4FF","#FFF1F2","#ECFDF5"];
  const TEXT_COLORS = ["#1D4ED8","#15803D","#C2410C","#7C3AED","#BE123C","#059669"];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.title, { color: C.text }]}>지점 관리</Text>
        <Pressable
          style={[styles.editModeBtn, { backgroundColor: editMode ? C.tint : C.card, borderColor: C.border }]}
          onPress={() => setEditMode(e => !e)}
        >
          <Feather name={editMode ? "check" : "move"} size={15} color={editMode ? "#fff" : C.textSecondary} />
          <Text style={[styles.editModeTxt, { color: editMode ? "#fff" : C.textSecondary }]}>
            {editMode ? "완료" : "순서 변경"}
          </Text>
        </Pressable>
      </View>

      {/* 정렬 + 카운트 */}
      <View style={[styles.toolbar, { paddingHorizontal: 20 }]}>
        <Text style={[styles.countText, { color: C.textSecondary }]}>
          총 <Text style={{ color: C.tint, fontFamily: "Inter_600SemiBold" }}>{branches.length}</Text>개 지점
        </Text>
        {!editMode && (
          <Pressable style={styles.sortBtn} onPress={sortKorean}>
            <Feather name="list" size={14} color={C.tint} />
            <Text style={[styles.sortTxt, { color: C.tint }]}>가나다순</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 120, gap: 12 }}
        >
          {branches.length === 0 && (
            <View style={styles.empty}>
              <Feather name="map-pin" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>등록된 지점이 없습니다</Text>
              <Text style={[styles.emptySubText, { color: C.textMuted }]}>아래 버튼을 눌러 지점을 추가하세요</Text>
            </View>
          )}

          {branches.map((b, idx) => {
            const colorIdx = idx % CARD_COLORS.length;
            const initial = koreanInitial(b.name);
            return (
              <Pressable
                key={b.id}
                onPress={() => !editMode && setDetailTarget(b)}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: C.card, shadowColor: C.shadow, opacity: pressed && !editMode ? 0.88 : 1 },
                ]}
              >
                {/* 색상 앰블럼 */}
                <View style={[styles.emblem, { backgroundColor: CARD_COLORS[colorIdx] }]}>
                  <Text style={[styles.emblemText, { color: TEXT_COLORS[colorIdx] }]}>{initial}</Text>
                </View>

                <View style={styles.cardBody}>
                  <Text style={[styles.branchName, { color: C.text }]}>{b.name}</Text>
                  {b.address ? (
                    <View style={styles.infoRow}>
                      <Feather name="map-pin" size={11} color={C.textMuted} />
                      <Text style={[styles.infoTxt, { color: C.textSecondary }]} numberOfLines={1}>{b.address}</Text>
                    </View>
                  ) : null}
                  {b.phone ? (
                    <View style={styles.infoRow}>
                      <Feather name="phone" size={11} color={C.textMuted} />
                      <Text style={[styles.infoTxt, { color: C.textSecondary }]}>{b.phone}</Text>
                    </View>
                  ) : null}
                </View>

                {editMode ? (
                  <View style={styles.reorderBtns}>
                    <Pressable
                      style={[styles.arrowBtn, { opacity: idx === 0 ? 0.3 : 1 }]}
                      onPress={() => moveUp(idx)}
                      disabled={idx === 0}
                    >
                      <Feather name="chevron-up" size={20} color={C.text} />
                    </Pressable>
                    <Pressable
                      style={[styles.arrowBtn, { opacity: idx === branches.length - 1 ? 0.3 : 1 }]}
                      onPress={() => moveDown(idx)}
                      disabled={idx === branches.length - 1}
                    >
                      <Feather name="chevron-down" size={20} color={C.text} />
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.actionBtns}>
                    <Pressable style={styles.iconBtn} onPress={() => openEdit(b)}>
                      <Feather name="edit-2" size={16} color={C.textSecondary} />
                    </Pressable>
                    <Pressable style={styles.iconBtn} onPress={() => handleDelete(b)}>
                      <Feather name="trash-2" size={16} color={C.error} />
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* FAB 추가 버튼 */}
      {!editMode && (
        <Pressable
          style={[styles.fab, { backgroundColor: C.tint, bottom: insets.bottom + 32 }]}
          onPress={openAdd}
        >
          <Feather name="plus" size={24} color="#fff" />
          <Text style={styles.fabText}>지점 추가</Text>
        </Pressable>
      )}

      {/* 등록/수정 모달 */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.sheet, { backgroundColor: C.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.handle} />
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: C.text }]}>
                {editTarget ? "지점 수정" : "지점 추가"}
              </Text>
              <Pressable onPress={() => setShowModal(false)}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>
            {formError ? <Text style={[styles.errorText, { color: C.error }]}>{formError}</Text> : null}
            {[
              { key: "name", label: "지점명 *", placeholder: "예: 화정점" },
              { key: "address", label: "주소", placeholder: "경기도 고양시..." },
              { key: "phone", label: "전화번호", placeholder: "031-000-0000" },
              { key: "memo", label: "메모", placeholder: "특이사항" },
            ].map(({ key, label, placeholder }) => (
              <View key={key} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>{label}</Text>
                <TextInput
                  style={[styles.input, { borderColor: C.border, color: C.text, backgroundColor: C.background }]}
                  value={form[key as keyof typeof form]}
                  onChangeText={v => setForm(f => ({ ...f, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={C.textMuted}
                />
              </View>
            ))}
            <Pressable
              style={({ pressed }) => [styles.saveBtn, { backgroundColor: C.tint, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnTxt}>저장하기</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 지점 상세 모달 */}
      <Modal visible={!!detailTarget} animationType="fade" transparent onRequestClose={() => setDetailTarget(null)}>
        <Pressable style={styles.overlay} onPress={() => setDetailTarget(null)}>
          <View style={[styles.detailSheet, { backgroundColor: C.card }]}>
            {detailTarget && (
              <>
                <Text style={[styles.detailName, { color: C.text }]}>{detailTarget.name}</Text>
                {[
                  { icon: "map-pin" as const, value: detailTarget.address },
                  { icon: "phone" as const, value: detailTarget.phone },
                  { icon: "file-text" as const, value: detailTarget.memo },
                ].filter(r => r.value).map(({ icon, value }) => (
                  <View key={icon} style={styles.detailRow}>
                    <Feather name={icon} size={14} color={C.textMuted} />
                    <Text style={[styles.detailValue, { color: C.textSecondary }]}>{value}</Text>
                  </View>
                ))}
                <Pressable
                  style={[styles.detailEditBtn, { backgroundColor: C.tint }]}
                  onPress={() => { setDetailTarget(null); openEdit(detailTarget); }}
                >
                  <Text style={styles.detailEditTxt}>수정하기</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  editModeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  editModeTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  countText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sortBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  sortTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 16, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  emblem: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emblemText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  cardBody: { flex: 1, gap: 4 },
  branchName: { fontSize: 17, fontFamily: "Inter_700Bold" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  infoTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  reorderBtns: { flexDirection: "column", gap: 2 },
  arrowBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  actionBtns: { flexDirection: "row", gap: 4 },
  iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  fab: { position: "absolute", right: 24, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 },
  fabText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 16, fontFamily: "Inter_500Medium" },
  emptySubText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 4 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  field: { gap: 5 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },
  saveBtn: { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 },
  saveBtnTxt: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  detailSheet: { margin: 40, borderRadius: 20, padding: 24, gap: 12 },
  detailName: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 4 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailValue: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  detailEditBtn: { height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  detailEditTxt: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
