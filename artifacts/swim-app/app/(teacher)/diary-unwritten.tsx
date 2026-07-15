/**
 * (teacher)/diary-unwritten.tsx — 미작성 일지 리스트
 *
 * 선생님이 아직 작성하지 않은 수업 슬롯을 날짜 오름차순으로 보여줌
 * 항목 클릭 → diary.tsx (classGroupId + lessonDate 파라미터 전달)
 * 빈 일지 작성 → 반 선택 모달 → diary.tsx (classGroupId 전달)
 */
import { CircleAlert, CircleCheck, Clock, Layers, Pencil, PenLine, Users, X } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { haptic } from "@/utils/haptic";

const C = Colors.light;

interface UnwrittenSlot {
  classGroupId: string;
  className: string;
  scheduleTime: string;
  lessonDate: string;
  dayOfWeek: string;
  studentCount: number;
}

interface ClassGroup {
  id: string;
  name: string;
  schedule_time: string;
  schedule_days: string;
}

function formatDateKo(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${parseInt(m)}월 ${parseInt(d)}일`;
}

export default function DiaryUnwrittenScreen() {
  const { token, adminUser: user } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [slots, setSlots] = useState<UnwrittenSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [classPickerVisible, setClassPickerVisible] = useState(false);
  const [classGroupsLoading, setClassGroupsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/diaries/unwritten-slots");
      if (res.ok) {
        const data = await res.json();
        setSlots(Array.isArray(data.slots) ? data.slots : []);
      }
    } catch (e) {
      console.error("[diary-unwritten] load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadClassGroups = useCallback(async () => {
    if (!token) return;
    setClassGroupsLoading(true);
    try {
      const res = await apiRequest(token, "/class-groups?mine=true");
      if (res.ok) {
        const allGroups: any[] = await res.json();
        const uid = user?.id;
        const mine = uid
          ? allGroups.filter((g: any) =>
              g.teacher_user_id === uid ||
              (Array.isArray(g.co_teacher_ids) && g.co_teacher_ids.includes(uid))
            )
          : allGroups;
        setClassGroups(mine);
      }
    } catch (e) {
      console.error("[diary-unwritten] loadClassGroups error", e);
    } finally {
      setClassGroupsLoading(false);
    }
  }, [token, user?.id]);

  function openClassPicker() {
    haptic.light();
    loadClassGroups();
    setClassPickerVisible(true);
  }

  function handleClassSelect(group: ClassGroup) {
    setClassPickerVisible(false);
    haptic.light();
    router.push({
      pathname: "/(teacher)/diary",
      params: { classGroupId: group.id },
    } as any);
  }

  const handlePress = useCallback((slot: UnwrittenSlot) => {
    router.push({
      pathname: "/(teacher)/diary",
      params: {
        classGroupId: slot.classGroupId,
        lessonDate: slot.lessonDate,
      },
    } as any);
  }, []);

  const renderItem = useCallback(({ item, index }: { item: UnwrittenSlot; index: number }) => {
    const prevDate = index > 0 ? slots[index - 1].lessonDate : null;
    const showDateHeader = prevDate !== item.lessonDate;

    return (
      <>
        {showDateHeader && (
          <View style={u.dateHeader}>
            <Text style={u.dateHeaderText}>
              {formatDateKo(item.lessonDate)} ({item.dayOfWeek})
            </Text>
          </View>
        )}
        <Pressable
          style={[u.card, { backgroundColor: C.card }]}
          onPress={() => handlePress(item)}
        >
          <View style={u.cardLeft}>
            <View style={[u.unwrittenBadge]}>
              <Text style={u.unwrittenBadgeText}>미작성</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={u.className} numberOfLines={1}>{item.className}</Text>
              <View style={u.metaRow}>
                <Clock size={11} color={C.textSecondary} />
                <Text style={u.metaText}>{item.scheduleTime}</Text>
                <Users size={11} color={C.textSecondary} style={{ marginLeft: 8 }} />
                <Text style={u.metaText}>{item.studentCount}명</Text>
              </View>
            </View>
          </View>
          <Pencil size={16} color={themeColor} />
        </Pressable>
      </>
    );
  }, [slots, handlePress, themeColor]);

  const keyExtractor = useCallback((item: UnwrittenSlot) =>
    `${item.classGroupId}-${item.lessonDate}`, []);

  return (
    <SafeAreaView style={u.safe} edges={[]}>
      <SubScreenHeader
        title="일지 작성"
        subtitle="미작성 수업 목록"
        homePath="/(teacher)/today-schedule"
      />

      {!loading && (
        <View style={u.summaryBar}>
          <View style={u.summaryLeft}>
            <CircleAlert size={13} color="#D97706" />
            <Text style={u.summaryText}>미작성 {slots.length}건</Text>
          </View>
          <Text style={u.sortLabel}>오래된 순</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={slots}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={u.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={u.empty}>
              <CircleCheck size={42} color="#2E9B6F" />
              <Text style={u.emptyTitle}>모든 수업 일지를 작성했습니다!</Text>
              <Text style={u.emptyDesc}>최근 8주간 미작성 일지가 없습니다.</Text>
              <Pressable style={[u.emptyBtn, { backgroundColor: themeColor }]} onPress={openClassPicker}>
                <PenLine size={15} color="#fff" />
                <Text style={u.emptyBtnText}>반 선택 후 작성하기</Text>
              </Pressable>
            </View>
          }
        />
      )}

      {/* ── 빈 일지 작성 FAB ── */}
      <Pressable
        style={[u.fab, { backgroundColor: themeColor, bottom: insets.bottom + 72 }]}
        onPress={openClassPicker}
        accessibilityLabel="빈 일지 작성"
      >
        <PenLine size={17} color="#fff" />
        <Text style={u.fabText}>빈 일지 작성</Text>
      </Pressable>

      {/* ── 반 선택 모달 ── */}
      <Modal
        visible={classPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setClassPickerVisible(false)}
      >
        <Pressable style={u.backdrop} onPress={() => setClassPickerVisible(false)} />
        <View style={u.pickerSheet}>
          <View style={u.pickerHandle} />
          <View style={u.pickerHeader}>
            <Text style={u.pickerTitle}>반 선택</Text>
            <Pressable onPress={() => setClassPickerVisible(false)} hitSlop={10}>
              <X size={20} color={C.textSecondary} />
            </Pressable>
          </View>
          <Text style={u.pickerSubtitle}>일지를 작성할 반을 선택해주세요</Text>

          {classGroupsLoading ? (
            <ActivityIndicator color={themeColor} style={{ marginVertical: 32 }} />
          ) : classGroups.length === 0 ? (
            <View style={u.pickerEmpty}>
              <Text style={u.pickerEmptyText}>담당 반이 없습니다.</Text>
            </View>
          ) : (
            <ScrollView style={u.pickerList} showsVerticalScrollIndicator={false}>
              {classGroups.map(group => (
                <Pressable
                  key={group.id}
                  style={u.pickerItem}
                  onPress={() => handleClassSelect(group)}
                >
                  <View style={u.pickerItemLeft}>
                    <Layers size={14} color={themeColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={u.pickerItemName} numberOfLines={1}>{group.name}</Text>
                      {(group.schedule_time || group.schedule_days) ? (
                        <Text style={u.pickerItemMeta}>
                          {[group.schedule_days, group.schedule_time].filter(Boolean).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Pencil size={14} color={C.textMuted} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const u = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  summaryBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "#FFFBEB", borderRadius: 10,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "#B45309" },
  sortLabel: { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  listContent: { paddingHorizontal: 16, paddingBottom: 120 },

  dateHeader: { paddingVertical: 8, paddingHorizontal: 4, marginTop: 8 },
  dateHeaderText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  card: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 12, padding: 14, marginBottom: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  unwrittenBadge: {
    backgroundColor: "#F9DEDA", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  unwrittenBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#D96C6C" },
  className: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginLeft: 2 },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
  emptyDesc: { fontSize: 13, color: C.textMuted, fontFamily: "Pretendard-Regular", textAlign: "center" },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24 },
  emptyBtnText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold", lineHeight: 20 },

  fab: { position: "absolute", right: 20, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 28, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 6 },
  fabText: { color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold", lineHeight: 20 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: "70%", paddingBottom: 32,
  },
  pickerHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: C.border,
    alignSelf: "center", marginTop: 10, marginBottom: 8,
  },
  pickerHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 4,
  },
  pickerTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold", color: C.text },
  pickerSubtitle: {
    fontSize: 13, color: C.textSecondary, fontFamily: "Pretendard-Regular",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  pickerList: { paddingHorizontal: 16 },
  pickerItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: C.background, borderRadius: 12, marginBottom: 8,
    borderWidth: 1, borderColor: C.border,
  },
  pickerItemLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, marginRight: 8 },
  pickerItemName: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 2 },
  pickerItemMeta: { fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular" },
  pickerEmpty: { alignItems: "center", paddingVertical: 40 },
  pickerEmptyText: { fontSize: 14, color: C.textMuted, fontFamily: "Pretendard-Regular" },
});
