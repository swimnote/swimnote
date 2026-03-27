import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, KeyboardAvoidingView, Linking,
  Modal, PanResponder, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { callPhone, formatPhone, CALL_COLOR } from "@/utils/phoneUtils";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";

const C = Colors.light;
const DISMISS_THRESHOLD = 100;

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
interface StudentOption {
  id: string;
  name: string;
  birth_year?: string | null;
  parent_phone?: string | null;
  parent_user_id?: string | null;
  class_group_name?: string | null;
  schedule_labels?: string | null;
  assigned_class_ids?: string[] | null;
}

// ── 드래그 닫기 시트 ─────────────────────────────────────────────
const SCREEN_HEIGHT = 900; // 충분히 큰 값

function DraggableSheet({
  visible, onClose, children, paddingBottom,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  paddingBottom?: number;
}) {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // onClose를 ref로 보관해 panResponder 클로저가 항상 최신 값 사용
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // 열기/닫기 애니메이션
  useEffect(() => {
    if (visible) {
      translateY.setValue(SCREEN_HEIGHT);
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 28, stiffness: 280, mass: 0.9 }),
        Animated.timing(backdropOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      translateY.setValue(SCREEN_HEIGHT);
      backdropOpacity.setValue(0);
      onCloseRef.current();
    });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // 핸들 영역에서 아래로 드래그하는 제스처만 잡음
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 3 && gs.vy >= 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gs) => {
        if (gs.dy >= 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > DISMISS_THRESHOLD || gs.vy > 0.8) {
          // 속도 기반으로도 닫기
          const duration = Math.max(100, Math.min(250, 250 - gs.vy * 100));
          Animated.parallel([
            Animated.timing(translateY, { toValue: SCREEN_HEIGHT, duration, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration, useNativeDriver: true }),
          ]).start(() => {
            translateY.setValue(SCREEN_HEIGHT);
            backdropOpacity.setValue(0);
            onCloseRef.current();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 300 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* 반투명 배경 */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.45)", opacity: backdropOpacity }]}
          pointerEvents="none"
        />
        {/* 배경 탭으로 닫기 */}
        <Pressable style={StyleSheet.absoluteFillObject} onPress={dismiss} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Animated.View
            style={[s.sheet, { backgroundColor: C.card, paddingBottom: paddingBottom ?? 20 }, { transform: [{ translateY }] }]}
          >
            {/* 드래그 핸들 — 이 영역에 panHandlers 부착 */}
            <View {...panResponder.panHandlers} style={s.dragArea} hitSlop={{ top: 10, bottom: 10, left: 40, right: 40 }}>
              <View style={s.handle} />
            </View>

            {children}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── 학생 연결 모달 ───────────────────────────────────────────────
function StudentLinkSheet({
  visible, parent, students, onClose, onLink,
}: {
  visible: boolean;
  parent: ParentRow | null;
  students: StudentOption[];
  onClose: () => void;
  onLink: (studentId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (visible) { setSearch(""); setSelectedId(""); setError(""); }
  }, [visible]);

  // 이미 연결된 학생 ID 목록
  const linkedIds = new Set((parent?.students ?? []).filter(s => s.status !== "rejected").map(s => s.id));

  // 학부모미연결 학생: parent_user_id가 없는 학생
  const unlinked = students.filter(s => {
    if (linkedIds.has(s.id)) return false;
    return !s.parent_user_id;
  });

  // 검색어 필터링 (학부모미연결 목록 기반)
  const displayList = search.trim()
    ? students.filter(s => {
        if (linkedIds.has(s.id)) return false;
        const q = search.trim().toLowerCase();
        return s.name.toLowerCase().includes(q) ||
          (s.parent_phone || "").includes(q) ||
          (s.birth_year || "").includes(q);
      })
    : unlinked;

  function handleConfirm() {
    if (!selectedId) { setError("학생을 선택해주세요."); return; }
    setSubmitting(true);
    onLink(selectedId);
  }

  return (
    <DraggableSheet visible={visible} onClose={onClose} paddingBottom={insets.bottom + 16}>
      <Text style={s.sheetTitle}>학생 연결 요청</Text>

      <View style={[s.infoBox, { backgroundColor: "#FFF1BF" }]}>
        <Feather name="info" size={13} color="#D97706" />
        <Text style={[s.infoText, { color: "#92400E" }]}>연결 요청은 관리자 승인 후 학부모에게 노출됩니다.</Text>
      </View>

      {/* 신청 시 입력한 자녀 */}
      {(parent?.requested_children ?? []).length > 0 && (
        <View style={[s.childRefBox, { backgroundColor: "#DDF2EF" }]}>
          <View style={s.childRefHeader}>
            <Feather name="user-check" size={13} color="#4338CA" />
            <Text style={[s.childRefLabel, { color: "#4338CA" }]}>가입 신청 시 입력한 자녀</Text>
          </View>
          {(parent?.requested_children ?? []).map((c, i) => (
            <View key={i} style={s.childRefRow}>
              <Text style={[s.childRefName, { color: C.text }]}>{c.childName}</Text>
              {c.childBirthYear && <Text style={[s.childRefYear, { color: C.textMuted }]}>{c.childBirthYear}년생</Text>}
            </View>
          ))}
        </View>
      )}

      {!!error && (
        <View style={[s.errBox, { backgroundColor: "#F9DEDA" }]}>
          <Text style={[s.errText, { color: C.error }]}>{error}</Text>
        </View>
      )}

      {/* 검색창 */}
      <View style={[s.searchRow, { borderColor: C.border, backgroundColor: C.background }]}>
        <Feather name="search" size={15} color={C.textMuted} />
        <TextInput
          style={[s.searchInput, { color: C.text }]}
          value={search}
          onChangeText={v => { setSearch(v); setSelectedId(""); setError(""); }}
          placeholder="이름·전화번호 검색..."
          placeholderTextColor={C.textMuted}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => { setSearch(""); setSelectedId(""); }}>
            <Feather name="x-circle" size={15} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {/* 섹션 헤더 */}
      <View style={s.listHeader}>
        <Text style={s.listHeaderText}>
          {search.trim() ? `검색 결과 ${displayList.length}명` : `학부모미연결 ${unlinked.length}명`}
        </Text>
        {!search.trim() && <Text style={s.listHeaderSub}>학부모 앱 미연결 학생 목록</Text>}
      </View>

      {/* 학생 목록 */}
      <ScrollView
        style={s.listScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {displayList.length === 0 ? (
          <View style={s.emptyHint}>
            <Feather name="users" size={28} color={C.textMuted} />
            <Text style={[s.emptyHintText, { color: C.textMuted }]}>
              {search.trim() ? `"${search}" 검색 결과가 없습니다` : "학부모미연결 학생이 없습니다\n검색으로 전체 학생을 찾아보세요"}
            </Text>
          </View>
        ) : displayList.map(student => {
          const isSelected = selectedId === student.id;
          return (
            <Pressable
              key={student.id}
              style={[s.studentOption, { borderColor: isSelected ? C.tint : C.border, backgroundColor: isSelected ? C.tintLight : C.background }]}
              onPress={() => { setSelectedId(student.id); setError(""); }}
            >
              <View style={[s.sOptionAvatar, { backgroundColor: isSelected ? C.tint + "20" : C.tintLight }]}>
                <Text style={[s.sOptionAvatarText, { color: isSelected ? C.tint : C.tint }]}>{student.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.sOptionName, { color: C.text }]}>{student.name}</Text>
                <Text style={s.sOptionSub}>
                  {student.birth_year ? `${student.birth_year}년생` : ""}
                  {student.parent_phone ? ` · ${student.parent_phone}` : ""}
                  {student.schedule_labels ? ` · ${student.schedule_labels}` : " · 미배정"}
                </Text>
              </View>
              {isSelected
                ? <Feather name="check-circle" size={20} color={C.tint} />
                : <View style={s.sOptionCircle} />
              }
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 하단 버튼 */}
      <View style={s.modalActions}>
        <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={onClose}>
          <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
        </Pressable>
        <Pressable
          style={[s.submitBtn, { backgroundColor: selectedId ? C.tint : "#D1D5DB" }]}
          onPress={handleConfirm}
          disabled={submitting || !selectedId}
        >
          {submitting
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={s.submitText}>연결 요청</Text>
          }
        </Pressable>
      </View>
    </DraggableSheet>
  );
}

// ── 학부모 직접 추가 시트 ─────────────────────────────────────────
function AddParentSheet({
  visible, onClose, onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, phone: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showSmsConfirm, setShowSmsConfirm] = useState(false);
  const [addedPhone, setAddedPhone] = useState("");

  useEffect(() => {
    if (visible) { setFormName(""); setFormPhone(""); setError(""); setShowSmsConfirm(false); }
  }, [visible]);

  async function handleSubmit() {
    if (!formName.trim() || !formPhone.trim()) { setError("이름과 전화번호를 입력해주세요."); return; }
    setSubmitting(true);
    try {
      await onSubmit(formName.trim(), formPhone.trim());
      setAddedPhone(formPhone.trim());
      setShowSmsConfirm(true);
    } catch (e: any) { setError(e.message || "오류가 발생했습니다."); }
    finally { setSubmitting(false); }
  }

  function openSmsApp() {
    const phone = addedPhone.replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(
      "안녕하세요. 스윔노트 학부모 앱 설치 안내입니다.\n아래 경로에서 앱을 다운로드 후 회원가입을 진행해주세요.\n[앱 다운로드 링크]"
    );
    const url = Platform.OS === "ios" ? `sms:${phone}&body=${msg}` : `sms:${phone}?body=${msg}`;
    Linking.openURL(url);
    setShowSmsConfirm(false);
    onClose();
  }

  if (showSmsConfirm) {
    return (
      <DraggableSheet visible={visible} onClose={onClose} paddingBottom={insets.bottom + 16}>
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 8 }}>
          <View style={[s.smsIcon, { backgroundColor: "#DDF2EF" }]}>
            <Feather name="message-square" size={26} color="#1F8F86" />
          </View>
          <Text style={[s.sheetTitle, { textAlign: "center" }]}>앱 안내 문자 발송</Text>
          <Text style={[s.smsDesc, { color: C.textSecondary }]}>
            해당 학부모에게 애플리케이션 다운로드 안내 메시지가 발송됩니다.
          </Text>
          <Text style={[s.smsPhone, { color: C.text }]}>{addedPhone}</Text>
        </View>
        <View style={s.modalActions}>
          <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={() => { setShowSmsConfirm(false); onClose(); }}>
            <Text style={[s.cancelText, { color: C.textSecondary }]}>나중에</Text>
          </Pressable>
          <Pressable style={[s.submitBtn, { backgroundColor: C.tint, flexDirection: "row", gap: 6 }]} onPress={openSmsApp}>
            <Feather name="send" size={15} color="#fff" />
            <Text style={s.submitText}>문자 앱 열기</Text>
          </Pressable>
        </View>
      </DraggableSheet>
    );
  }

  return (
    <DraggableSheet visible={visible} onClose={onClose} paddingBottom={insets.bottom + 16}>
      <Text style={s.sheetTitle}>학부모 계정 직접 추가</Text>
      {!!error && <View style={[s.errBox, { backgroundColor: "#F9DEDA" }]}><Text style={[s.errText, { color: C.error }]}>{error}</Text></View>}
      <View style={s.field}>
        <Text style={[s.label, { color: C.textSecondary }]}>학부모 이름</Text>
        <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={formName} onChangeText={setFormName} placeholder="홍길동" placeholderTextColor={C.textMuted} />
      </View>
      <View style={s.field}>
        <Text style={[s.label, { color: C.textSecondary }]}>학부모 전화번호</Text>
        <TextInput style={[s.input, { borderColor: C.border, color: C.text }]} value={formPhone} onChangeText={setFormPhone} placeholder="010-0000-0000" keyboardType="phone-pad" placeholderTextColor={C.textMuted} />
      </View>
      <View style={s.modalActions}>
        <Pressable style={[s.cancelBtn, { borderColor: C.border }]} onPress={onClose}>
          <Text style={[s.cancelText, { color: C.textSecondary }]}>취소</Text>
        </Pressable>
        <Pressable style={[s.submitBtn, { backgroundColor: C.tint }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>추가</Text>}
        </Pressable>
      </View>
    </DraggableSheet>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────────
export default function ParentsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddParent, setShowAddParent] = useState(false);
  const [showAddLink, setShowAddLink] = useState<ParentRow | null>(null);
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

  async function handleAddParent(name: string, phone: string) {
    const res = await apiRequest(token, "/admin/parents", {
      method: "POST", body: JSON.stringify({ name, phone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "오류가 발생했습니다.");
    await load();
  }

  async function handleAddLink(studentId: string) {
    if (!showAddLink) return;
    const res = await apiRequest(token, `/admin/parents/${showAddLink.id}/students`, {
      method: "POST", body: JSON.stringify({ student_id: studentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      Alert.alert("오류", data.error || "오류가 발생했습니다.");
      return;
    }
    setShowAddLink(null);
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
        ids.map(async id => {
          const r = await apiRequest(token, `/admin/parents/${id}`, { method: "DELETE" });
          if (!r.ok) {
            const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
            const msg = body?.error || `HTTP ${r.status}`;
            Alert.alert("삭제 실패", msg);
            return { id, ok: false };
          }
          return { id, ok: true };
        })
      );
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value.id);
      setParents(prev => prev.filter(p => !succeeded.includes(p.id)));
      if (!isSingle) sel.exitSelectionMode();
    } catch (e: any) { Alert.alert("오류", e?.message || "삭제 중 오류가 발생했습니다."); }
    finally { setDeletingId(null); setBulkDeleting(false); }
  }

  function handleDeleteParent(id: string, name: string) {
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
      pending:  { color: C.warning,  bg: "#FFF1BF", label: "승인 대기" },
      approved: { color: C.success,  bg: "#DDF2EF", label: "승인됨" },
      rejected: { color: C.error,    bg: "#F9DEDA", label: "거부됨" },
    };
    const st = map[status] || map["pending"];
    return (
      <View style={[s.badge, { backgroundColor: st.bg }]}>
        <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
      </View>
    );
  };

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="학부모 관리"
        onBack={undefined}
        rightSlot={
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <Pressable
              style={[s.selBtn, sel.selectionMode && { backgroundColor: C.tintLight }]}
              onPress={sel.toggleSelectionMode}
            >
              <Feather name="check-square" size={16} color={sel.selectionMode ? C.tint : C.textSecondary} />
              <Text style={[s.selBtnText, sel.selectionMode && { color: C.tint }]}>
                {sel.selectionMode ? "취소" : "선택"}
              </Text>
            </Pressable>
            {!sel.selectionMode && (
              <Pressable style={[s.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowAddParent(true)}>
                <Feather name="plus" size={16} color="#fff" />
                <Text style={s.addBtnText}>추가</Text>
              </Pressable>
            )}
          </View>
        }
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {parents.length === 0 ? (
            <View style={s.empty}>
              <Feather name="users" size={48} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.text }]}>등록된 학부모가 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>승인 메뉴에서 가입 요청을 승인하거나 직접 추가하세요</Text>
            </View>
          ) : parents.map(pa => {
            const isSelected = sel.isSelected(pa.id);
            const isThisDeleting = deletingId === pa.id;
            return (
              <Pressable
                key={pa.id}
                style={[s.accountCard, { backgroundColor: C.card }, isSelected && { borderWidth: 2, borderColor: C.tint }]}
                onPress={sel.selectionMode ? () => sel.toggleItem(pa.id) : undefined}
              >
                <View style={s.accountHeader}>
                  {sel.selectionMode && (
                    <Pressable onPress={() => sel.toggleItem(pa.id)} style={s.checkWrap}>
                      <View style={[s.checkbox, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
                        {isSelected && <Feather name="check" size={12} color="#fff" />}
                      </View>
                    </Pressable>
                  )}
                  <View style={[s.avatar, { backgroundColor: C.tintLight }]}>
                    <Text style={[s.avatarText, { color: C.tint }]}>{pa.name[0]}</Text>
                  </View>
                  <View style={s.accountInfo}>
                    <Text style={[s.accountName, { color: C.text }]}>{pa.name}</Text>
                    {pa.phone ? (
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
                        onPress={() => callPhone(pa.phone)}
                        hitSlop={6}
                      >
                        <Feather name="phone" size={11} color={CALL_COLOR} />
                        <Text style={[s.accountPhone, { color: CALL_COLOR }]}>{formatPhone(pa.phone)}</Text>
                      </Pressable>
                    ) : (
                      <Text style={[s.accountPhone, { color: C.textSecondary }]}>연락처 없음</Text>
                    )}
                  </View>
                  {!sel.selectionMode && (
                    <View style={s.cardActions}>
                      <Pressable
                        style={[s.linkBtn, { borderColor: C.tint }]}
                        onPress={() => setShowAddLink(pa)}
                      >
                        <Feather name="link" size={13} color={C.tint} />
                        <Text style={[s.linkBtnText, { color: C.tint }]}>학생 연결</Text>
                      </Pressable>
                      <Pressable
                        style={[s.deleteParentBtn, isThisDeleting && { opacity: 0.5 }]}
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
                  <View style={[s.studentsSection, { borderTopColor: C.border }]}>
                    {pa.students.map((st: StudentLink) => (
                      <View key={st.link_id} style={s.studentRow}>
                        <View style={s.studentLeft}>
                          {statusBadge(st.status)}
                          <Text style={[s.studentName, { color: C.text }]}>{st.name}</Text>
                        </View>
                        <View style={s.studentRight}>
                          {!sel.selectionMode && st.status === "pending" && (
                            <>
                              <Pressable onPress={() => handleDecision(st.link_id, pa.id, "approve")} style={[s.miniBtn, { backgroundColor: C.success }]}>
                                <Feather name="check" size={12} color="#fff" />
                              </Pressable>
                              <Pressable onPress={() => handleDecision(st.link_id, pa.id, "reject")} style={[s.miniBtn, { backgroundColor: C.error }]}>
                                <Feather name="x" size={12} color="#fff" />
                              </Pressable>
                            </>
                          )}
                          {!sel.selectionMode && (
                            <Pressable onPress={() => handleDeleteLink(pa.id, st.link_id)}>
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

      {/* 학부모 직접 추가 시트 */}
      <AddParentSheet
        visible={showAddParent}
        onClose={() => setShowAddParent(false)}
        onSubmit={handleAddParent}
      />

      {/* 학생 연결 시트 */}
      <StudentLinkSheet
        visible={!!showAddLink}
        parent={showAddLink}
        students={students}
        onClose={() => setShowAddLink(null)}
        onLink={handleAddLink}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  // 헤더
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  selBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  // 빈 상태
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  // 카드
  checkWrap: { justifyContent: "center", marginRight: 4 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, backgroundColor: C.background, alignItems: "center", justifyContent: "center" },
  avatar: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  accountCard: { borderRadius: 14, overflow: "hidden", borderWidth: 1.5, borderColor: "transparent", backgroundColor: C.card },
  accountHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  accountInfo: { flex: 1 },
  accountName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  accountPhone: { fontSize: 13, fontFamily: "Inter_400Regular" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1.5 },
  linkBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  deleteParentBtn: { padding: 6 },

  // 학생 목록 (카드 내)
  studentsSection: { borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 6, gap: 4 },
  studentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  studentLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  studentName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  studentRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  miniBtn: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // 드래그 시트 공통
  kvOverlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 0, gap: 12 },
  dragArea: { alignItems: "center", paddingVertical: 14 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB" },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 2 },

  // 연결 모달 내부
  infoBox: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: 12 },
  infoText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  childRefBox: { borderRadius: 12, padding: 12, gap: 6 },
  childRefHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  childRefLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  childRefRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  childRefName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  childRefYear: { fontSize: 13, fontFamily: "Inter_400Regular" },

  // 검색
  searchRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },

  // 리스트 헤더
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  listHeaderSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },

  // 학생 선택 목록
  listScroll: { maxHeight: 220 },
  emptyHint: { alignItems: "center", paddingVertical: 24, gap: 10 },
  emptyHintText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  studentOption: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5, marginBottom: 6 },
  sOptionAvatar: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sOptionAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sOptionName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sOptionSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  sOptionCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.border },

  // 에러
  errBox: { padding: 10, borderRadius: 10 },
  errText: { fontSize: 13, fontFamily: "Inter_400Regular" },

  // 추가 폼
  field: { gap: 5 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: "Inter_400Regular" },

  // 하단 버튼
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  smsIcon: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  smsDesc: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, textAlign: "center" },
  smsPhone: { fontSize: 16, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  submitBtn: { flex: 2, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
