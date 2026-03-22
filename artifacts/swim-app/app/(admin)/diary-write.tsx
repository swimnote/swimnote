/**
 * (admin)/diary-write.tsx — 관리자 수업일지 허브
 *
 * 선생님 목록 → 선택 → diary-teacher-entries.tsx 로 이동
 * (관리자는 작성 불가, 조회/삭제만 가능)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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

interface TeacherStat {
  teacher_id: string;
  teacher_name: string;
  class_count: number;
  diary_count: number;
  last_diary_date: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AdminDiaryHubScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [teachers, setTeachers] = useState<TeacherStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/diaries/admin/teachers");
      if (res.ok) {
        const data = await res.json();
        setTeachers(Array.isArray(data.teachers) ? data.teachers : []);
      }
    } catch (e) {
      console.error("[admin-diary-hub] load error", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const handlePress = useCallback((t: TeacherStat) => {
    router.push({
      pathname: "/(admin)/diary-teacher-entries",
      params: { teacherId: t.teacher_id, teacherName: t.teacher_name },
    } as any);
  }, []);

  const renderItem = useCallback(({ item }: { item: TeacherStat }) => {
    const dCount = Number(item.diary_count) || 0;
    const cCount = Number(item.class_count) || 0;
    return (
      <Pressable
        style={[dw.card, { backgroundColor: C.card }]}
        onPress={() => handlePress(item)}
      >
        <View style={dw.cardLeft}>
          <View style={[dw.avatar, { backgroundColor: themeColor + "20" }]}>
            <Text style={[dw.avatarText, { color: themeColor }]}>
              {(item.teacher_name || "?").charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dw.teacherName}>{item.teacher_name} 선생님</Text>
            <View style={dw.statRow}>
              <View style={dw.statItem}>
                <Feather name="layers" size={11} color={C.textSecondary} />
                <Text style={dw.statText}>담당 반 {cCount}개</Text>
              </View>
              <View style={dw.statItem}>
                <Feather name="book-open" size={11} color={C.textSecondary} />
                <Text style={dw.statText}>작성 {dCount}건</Text>
              </View>
              {item.last_diary_date && (
                <View style={dw.statItem}>
                  <Feather name="clock" size={11} color={C.textSecondary} />
                  <Text style={dw.statText}>최근 {formatDate(item.last_diary_date)}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <Feather name="chevron-right" size={16} color={C.textMuted} />
      </Pressable>
    );
  }, [handlePress, themeColor]);

  const keyExtractor = useCallback((item: TeacherStat) => item.teacher_id, []);

  const totalDiaries = teachers.reduce((s, t) => s + (Number(t.diary_count) || 0), 0);

  return (
    <SafeAreaView style={dw.safe} edges={[]}>
      <SubScreenHeader
        title="수업일지 관리"
        subtitle="선생님별 일지 조회 및 삭제"
        homePath="/(admin)/dashboard"
      />

      {/* 요약 */}
      {!loading && teachers.length > 0 && (
        <View style={dw.summaryBar}>
          <View style={dw.summaryItem}>
            <Text style={dw.summaryNum}>{teachers.length}</Text>
            <Text style={dw.summaryLabel}>선생님</Text>
          </View>
          <View style={dw.summaryDivider} />
          <View style={dw.summaryItem}>
            <Text style={dw.summaryNum}>{totalDiaries}</Text>
            <Text style={dw.summaryLabel}>전체 일지</Text>
          </View>
          <View style={[dw.summaryNote]}>
            <Feather name="info" size={11} color={C.textMuted} />
            <Text style={dw.summaryNoteText}>조회·삭제만 가능 (수정 불가)</Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={teachers}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={dw.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={() => { setRefreshing(true); load(); }}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={dw.empty}>
              <Feather name="users" size={40} color={C.textMuted} />
              <Text style={dw.emptyTitle}>등록된 선생님이 없습니다</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const dw = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.background },

  summaryBar: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 12,
    padding: 14, backgroundColor: C.card,
    borderRadius: 12, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  summaryItem: { alignItems: "center" },
  summaryNum: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  summaryLabel: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular" },
  summaryDivider: { width: 1, height: 28, backgroundColor: C.border },
  summaryNote: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 4,
    justifyContent: "flex-end",
  },
  summaryNoteText: { fontSize: 11, color: C.textMuted, fontFamily: "Inter_400Regular" },

  listContent: { paddingHorizontal: 16, paddingBottom: 100, gap: 8 },

  card: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  teacherName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text, marginBottom: 4 },
  statRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  statText: { fontSize: 11, color: C.textSecondary, fontFamily: "Inter_400Regular" },

  empty: { alignItems: "center", paddingTop: 100, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
});
