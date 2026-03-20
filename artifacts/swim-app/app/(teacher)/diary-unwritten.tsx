/**
 * (teacher)/diary-unwritten.tsx — 미작성 일지 리스트
 *
 * 선생님이 아직 작성하지 않은 수업 슬롯을 날짜 오름차순으로 보여줌
 * 항목 클릭 → diary.tsx (classGroupId + lessonDate 파라미터 전달)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface UnwrittenSlot {
  classGroupId: string;
  className: string;
  scheduleTime: string;
  lessonDate: string;
  dayOfWeek: string;
  studentCount: number;
}

function formatDateKo(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${parseInt(m)}월 ${parseInt(d)}일`;
}

export default function DiaryUnwrittenScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [slots, setSlots] = useState<UnwrittenSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  // 다른 화면에서 돌아올 때 자동 새로고침 (일지 작성 완료 후)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
                <Feather name="clock" size={11} color={C.textSecondary} />
                <Text style={u.metaText}>{item.scheduleTime}</Text>
                <Feather name="users" size={11} color={C.textSecondary} style={{ marginLeft: 8 }} />
                <Text style={u.metaText}>{item.studentCount}명</Text>
              </View>
            </View>
          </View>
          <Feather name="edit-3" size={16} color={themeColor} />
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

      {/* 요약 바 */}
      {!loading && (
        <View style={u.summaryBar}>
          <View style={u.summaryLeft}>
            <Feather name="alert-circle" size={13} color="#D97706" />
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
              <Feather name="check-circle" size={42} color="#10B981" />
              <Text style={u.emptyTitle}>모든 수업 일지를 작성했습니다!</Text>
              <Text style={u.emptyDesc}>최근 8주간 미작성 일지가 없습니다.</Text>
            </View>
          }
        />
      )}
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
  summaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#B45309" },
  sortLabel: { fontSize: 11, color: C.textMuted, fontFamily: "Inter_400Regular" },

  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  dateHeader: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  dateHeaderText: {
    fontSize: 13, fontFamily: "Inter_700Bold", color: C.textSecondary,
  },

  card: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 12, padding: 14, marginBottom: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  unwrittenBadge: {
    backgroundColor: "#FEE2E2", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  unwrittenBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626" },
  className: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginBottom: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular", marginLeft: 2 },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center" },
  emptyDesc: { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
});
