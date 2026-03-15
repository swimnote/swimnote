import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform,
  Pressable, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { useSelectionMode } from "@/hooks/useSelectionMode";
import { SelectionActionBar } from "@/components/admin/SelectionActionBar";

// 탭바 높이: iOS 49, Android 56, Web 84
const TAB_BAR_HEIGHT = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

const C = Colors.light;

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  instructor: string | null;
  student_count: number;
  level: string | null;
  capacity: number | null;
  teacher_user_id: string | null;
  is_deleted?: boolean;
}

export default function ClassesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const sel = useSelectionMode();
  const visibleIds = groups.map(g => g.id);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/class-groups");
      if (res.ok) {
        const data = await res.json();
        setGroups(Array.isArray(data) ? data.filter((g: ClassGroup) => !g.is_deleted) : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function deleteIds(ids: string[]) {
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      console.log(`[admin][deleteClass] selectedCount=${ids.length}`, ids);
      const results = await Promise.allSettled(
        ids.map(id => apiRequest(token, `/class-groups/${id}`, { method: "DELETE" })
          .then(r => ({ id, ok: r.ok }))
        )
      );
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> => r.status === "fulfilled" && r.value.ok)
        .map(r => r.value.id);
      const failed = ids.length - succeeded.length;

      setGroups(prev => prev.filter(g => !succeeded.includes(g.id)));
      sel.exitSelectionMode();
      console.log(`[admin][deleteClass] class soft deleted success: ${succeeded.join(", ")}`);
      console.log(`[admin][deleteClass] UI refresh complete`);

      if (failed > 0) Alert.alert("일부 실패", `${failed}개 삭제에 실패했습니다.`);
    } catch (e) {
      console.error(e);
      Alert.alert("오류", "삭제 중 오류가 발생했습니다.");
    } finally { setDeleting(false); }
  }

  function confirmDelete(ids: string[]) {
    if (ids.length === 0) return;
    const isSingle = ids.length === 1;
    const target = isSingle
      ? groups.find(g => g.id === ids[0])?.name || "반"
      : `${ids.length}개 반`;

    Alert.alert(
      "반 삭제",
      `선택한 반을 삭제하면 소속 회원은 삭제되지 않고 미배정 상태로 변경됩니다.\n선생님·출결·스케줄·학부모 화면에도 즉시 반영됩니다.\n\n"${target}"을 삭제하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제", style: "destructive",
          onPress: () => deleteIds(ids),
        },
      ]
    );
  }

  function handleSingleDelete(id: string) {
    console.log(`[admin][deleteClass] click classId=${id}`);
    confirmDelete([id]);
  }

  function handleBulkDelete() {
    const ids = Array.from(sel.selectedIds);
    console.log(`[admin][deleteClass] click classId=${ids.join(",")}`);
    confirmDelete(ids);
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + 16 }]}>
        <Text style={s.title}>수업</Text>
        <View style={s.headerRight}>
          <Pressable style={[s.makeupBtn]} onPress={() => router.push("/(admin)/makeups")}>
            <Feather name="rotate-ccw" size={15} color="#7C3AED" />
            <Text style={s.makeupBtnTxt}>보강</Text>
          </Pressable>
          <Pressable
            style={[s.selBtn, sel.selectionMode && { backgroundColor: C.tintLight }]}
            onPress={sel.toggleSelectionMode}
          >
            <Feather name="check-square" size={18} color={sel.selectionMode ? C.tint : C.textSecondary} />
            <Text style={[s.selBtnText, sel.selectionMode && { color: C.tint }]}>
              {sel.selectionMode ? "취소" : "선택"}
            </Text>
          </Pressable>
          {!sel.selectionMode && (
            <Pressable style={[s.addBtn, { backgroundColor: C.tint }]} onPress={() => setShowCreate(true)}>
              <Feather name="plus" size={16} color="#fff" />
              <Text style={s.addBtnText}>반 등록</Text>
            </Pressable>
          )}
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: sel.selectionMode ? insets.bottom + 90 : insets.bottom + 120,
            paddingTop: 8, gap: 12,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="layers" size={48} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.textMuted }]}>등록된 반이 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textMuted }]}>반 등록 버튼을 눌러 첫 번째 반을 만들어보세요</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ClassGroupCard
              item={item}
              selectionMode={sel.selectionMode}
              isSelected={sel.isSelected(item.id)}
              onToggle={() => sel.toggleItem(item.id)}
              onDelete={() => handleSingleDelete(item.id)}
              isDeleting={deleting}
              onAssign={() => router.push(`/class-assign?classId=${item.id}` as any)}
            />
          )}
        />
      )}

      {/* 선택모드 액션바 — 1개 선택 시 회원 반배정 버튼 포함 */}
      {sel.selectionMode && sel.selectedCount === 1 ? (
        <SingleClassActionBar
          selectedId={Array.from(sel.selectedIds)[0]}
          deleting={deleting}
          insets={insets}
          onAssign={(classId) => {
            sel.exitSelectionMode();
            router.push(`/class-assign?classId=${classId}`);
          }}
          onDelete={() => handleBulkDelete()}
          onExit={sel.exitSelectionMode}
        />
      ) : (
        <SelectionActionBar
          visible={sel.selectionMode}
          selectedCount={sel.selectedCount}
          totalCount={groups.length}
          isAllSelected={sel.isAllSelected(visibleIds)}
          deleting={deleting}
          onSelectAll={() => sel.selectAll(visibleIds)}
          onClearSelection={sel.clearSelection}
          onDeleteSelected={handleBulkDelete}
          onExit={sel.exitSelectionMode}
        />
      )}

      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="pool_admin"
          onSuccess={(newGroup) => {
            setGroups(prev => [newGroup, ...prev]);
            setShowCreate(false);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </View>
  );
}

function ClassGroupCard({
  item, selectionMode, isSelected, onToggle, onDelete, isDeleting, onAssign,
}: {
  item: ClassGroup;
  selectionMode: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  onAssign: () => void;
}) {
  const days = item.schedule_days.split(",").map(d => d.trim()).join("·");

  return (
    <Pressable
      style={[cd.card, { shadowColor: C.shadow }, isSelected && { borderWidth: 2, borderColor: C.tint }]}
      onPress={selectionMode ? onToggle : onAssign}
    >
      <View style={cd.top}>
        {/* 선택모드 체크박스 */}
        {selectionMode && (
          <Pressable onPress={onToggle} style={cd.checkWrap}>
            <View style={[cd.checkbox, isSelected && { backgroundColor: C.tint, borderColor: C.tint }]}>
              {isSelected && <Feather name="check" size={12} color="#fff" />}
            </View>
          </Pressable>
        )}
        <View style={cd.icon}>
          <Feather name="layers" size={20} color="#7C3AED" />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[cd.name, { color: C.text }]}>{item.name}</Text>
          <View style={cd.metaRow}>
            <Feather name="calendar" size={12} color={C.textMuted} />
            <Text style={[cd.meta, { color: C.textSecondary }]}>{days}요일</Text>
          </View>
          <View style={cd.metaRow}>
            <Feather name="clock" size={12} color={C.textMuted} />
            <Text style={[cd.meta, { color: C.textSecondary }]}>{item.schedule_time}</Text>
          </View>
          {item.instructor && (
            <View style={cd.metaRow}>
              <Feather name="user" size={12} color={C.textMuted} />
              <Text style={[cd.meta, { color: C.textSecondary }]}>{item.instructor}</Text>
            </View>
          )}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <View style={[cd.countBadge, { backgroundColor: C.tintLight }]}>
            <Text style={[cd.countText, { color: C.tint }]}>{item.student_count}명</Text>
          </View>
          {item.level && (
            <View style={[cd.levelBadge]}>
              <Text style={cd.levelText}>{item.level}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 하단: 회원관리 + 삭제 (선택모드 아닐 때만) */}
      {!selectionMode && (
        <View style={cd.bottom}>
          <Pressable style={cd.manageBtn} onPress={onAssign}>
            <Feather name="users" size={13} color={C.tint} />
            <Text style={[cd.manageBtnText, { color: C.tint }]}>회원관리</Text>
            <Feather name="chevron-right" size={13} color={C.tint} />
          </Pressable>
          <Pressable
            style={[cd.deleteBtn, isDeleting && { opacity: 0.5 }]}
            onPress={!isDeleting ? onDelete : undefined}
            disabled={isDeleting}
          >
            <Feather name="trash-2" size={14} color={C.error} />
            <Text style={[cd.deleteBtnText, { color: C.error }]}>삭제</Text>
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  selBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  selBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  addBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  makeupBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: "#EDE9FE", borderWidth: 1, borderColor: "#DDD6FE" },
  makeupBtnTxt: { fontSize: 13, fontWeight: "600", color: "#7C3AED" },
  empty: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});

const cd = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, gap: 14, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3, borderWidth: 1.5, borderColor: "transparent" },
  top: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  checkWrap: { justifyContent: "center", paddingRight: 2, paddingTop: 2 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: C.border, backgroundColor: C.background, alignItems: "center", justifyContent: "center" },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: "#F3E8FF", alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontFamily: "Inter_700Bold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  countText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#EDE9FE" },
  levelText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#7C3AED" },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  capacityChip: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1 },
  capacityText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  manageBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "#EDE9FE" },
  manageBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "#FEE2E2" },
  deleteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── 1개 반 선택 시 전용 액션바 ───────────────────────────────────────
function SingleClassActionBar({
  selectedId, deleting, insets, onAssign, onDelete, onExit,
}: {
  selectedId: string;
  deleting: boolean;
  insets: { bottom: number };
  onAssign: (classId: string) => void;
  onDelete: () => void;
  onExit: () => void;
}) {
  // 탭바 위에 위치
  const bottomPos = insets.bottom + TAB_BAR_HEIGHT;

  return (
    <View style={[sa.bar, { bottom: bottomPos }]}>
      <View style={sa.row}>
        <Pressable style={[sa.assignBtn, { backgroundColor: C.tint }]} onPress={() => onAssign(selectedId)}>
          <Feather name="users" size={15} color="#fff" />
          <Text style={sa.assignText}>회원 반배정</Text>
        </Pressable>
        <Pressable
          style={[sa.deleteBtn, deleting && { opacity: 0.5 }]}
          onPress={!deleting ? onDelete : undefined}
          disabled={deleting}
        >
          {deleting
            ? <ActivityIndicator size={14} color={C.error} />
            : <Feather name="trash-2" size={14} color={C.error} />
          }
          <Text style={sa.deleteText}>{deleting ? "삭제 중..." : "삭제"}</Text>
        </Pressable>
        <Pressable style={sa.cancelBtn} onPress={onExit}>
          <Feather name="x" size={16} color={C.textSecondary} />
          <Text style={sa.cancelText}>취소</Text>
        </Pressable>
      </View>
    </View>
  );
}

const sa = StyleSheet.create({
  bar: {
    position: "absolute", left: 0, right: 0,
    zIndex: 1000,
    backgroundColor: C.card,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingTop: 12, paddingBottom: 12, paddingHorizontal: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 30,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  assignBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 12, borderRadius: 12,
  },
  assignText: { color: "#fff", fontSize: 14, fontFamily: "Inter_700Bold" },
  deleteBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12,
    backgroundColor: "#FEE2E2",
  },
  deleteText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.error },
  cancelBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.background,
  },
  cancelText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
});
