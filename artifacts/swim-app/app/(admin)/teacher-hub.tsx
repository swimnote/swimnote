/**
 * 선생님 운영 현황 허브
 * 실 DB: GET /admin/teacher-hub/:id
 * 탭: 담당회원 / 출결 / 수업일지 / 보강
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;
const TABS = ["담당 회원", "출결", "수업일지", "보강"] as const;
type HubTab = typeof TABS[number];

const ATT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  present: { label: "출석", color: "#059669", bg: "#D1FAE5" },
  absent:  { label: "결석", color: "#DC2626", bg: "#FEE2E2" },
  late:    { label: "지각", color: "#D97706", bg: "#FEF3C7" },
};

const MK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  waiting:     { label: "대기",   color: "#D97706", bg: "#FEF3C7" },
  assigned:    { label: "배정",   color: "#2563EB", bg: "#DBEAFE" },
  transferred: { label: "이동",   color: "#7C3AED", bg: "#EDE9FE" },
  completed:   { label: "완료",   color: "#059669", bg: "#D1FAE5" },
  cancelled:   { label: "취소",   color: "#6B7280", bg: "#F3F4F6" },
};

export default function TeacherHubScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; name?: string }>();

  const [tab, setTab]     = useState<HubTab>("담당 회원");
  const [data, setData]   = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!params.id) return;
    setLoading(true);
    try {
      const r = await apiRequest(token, `/admin/teacher-hub/${params.id}`);
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, [token, params.id]);

  useEffect(() => { load(); }, [load]);

  const deleteDiary = (id: string) => {
    Alert.alert("수업일지 삭제", "삭제 후 복구할 수 없습니다.", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          await apiRequest(token, `/class-diaries/${id}`, { method: "DELETE" });
          load();
        },
      },
    ]);
  };

  if (loading && !data) return (
    <View style={[s.root, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}>
      <ActivityIndicator color={themeColor} />
    </View>
  );

  const stats = data?.stats || {};
  const listData =
    tab === "담당 회원" ? (data?.students || []) :
    tab === "출결"    ? (data?.recent_attendance || []) :
    tab === "수업일지" ? (data?.recent_diaries || []) :
    (data?.makeups || []);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back}><Feather name="arrow-left" size={22} color={C.text} /></Pressable>
        <Text style={s.title} numberOfLines={1}>{data?.teacher?.name || params.name} 운영현황</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* 요약 통계 카드 */}
      <View style={s.statsCard}>
        <Stat label="담당반"  value={stats.class_count  ?? 0} />
        <Stat label="담당회원" value={stats.student_count ?? 0} />
        <Stat label="오늘출결" value={stats.today_att    ?? 0} />
        <Stat label="오늘일지" value={stats.today_diary  ?? 0} />
        <Stat label="보강대기" value={stats.makeup_waiting  ?? 0} warn={(stats.makeup_waiting ?? 0) > 0} />
        <Stat label="대리보강" value={stats.substitute_done ?? 0} />
      </View>

      {/* 탭 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={[s.chip, tab === t && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.chipTxt, tab === t && { color: "#fff" }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={listData}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>항목이 없습니다</Text></View>}
        renderItem={({ item }) => {
          if (tab === "담당 회원") return (
            <Pressable style={s.card} onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.id } })}>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.name}</Text>
                  <Text style={s.sub}>{item.class_name || "반 미배정"}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={C.textSecondary} />
              </View>
            </Pressable>
          );
          if (tab === "출결") {
            const ast = ATT_STATUS[item.status] || { label: item.status, color: "#6B7280", bg: "#F3F4F6" };
            return (
              <View style={s.card}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{item.student_name || "-"}</Text>
                    <Text style={s.sub}>{item.date} · {item.class_name || ""}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: ast.bg }]}>
                    <Text style={[s.badgeTxt, { color: ast.color }]}>{ast.label}</Text>
                  </View>
                </View>
              </View>
            );
          }
          if (tab === "수업일지") return (
            <View style={s.card}>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.lesson_date} · {item.class_name || ""}</Text>
                  <Text style={s.sub} numberOfLines={2}>{item.common_content || "(내용 없음)"}</Text>
                  {item.is_edited && <Text style={[s.sub, { color: "#D97706" }]}>수정됨</Text>}
                </View>
                <Pressable onPress={() => deleteDiary(item.id)} style={{ padding: 6 }}>
                  <Feather name="trash-2" size={16} color="#DC2626" />
                </Pressable>
              </View>
            </View>
          );
          const mst = MK_STATUS[item.status] || { label: item.status, color: "#6B7280", bg: "#F3F4F6" };
          return (
            <View style={s.card}>
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.student_name}</Text>
                  <Text style={s.sub}>결석일: {item.absence_date}  {item.original_class_group_name || ""}</Text>
                  {item.is_substitute && <Text style={[s.sub, { color: "#7C3AED" }]}>대리: {item.substitute_teacher_name}</Text>}
                  {item.transferred_to_teacher_name && <Text style={[s.sub, { color: "#2563EB" }]}>이동→ {item.transferred_to_teacher_name}</Text>}
                </View>
                <View style={[s.badge, { backgroundColor: mst.bg }]}>
                  <Text style={[s.badgeTxt, { color: mst.color }]}>{mst.label}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={[s.statVal, warn && { color: "#DC2626" }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: C.background },
  header:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  back:      { width: 32 },
  title:     { flex: 1, fontSize: 18, fontWeight: "700", color: C.text },
  statsCard: { flexDirection: "row", flexWrap: "wrap", gap: 16, justifyContent: "space-around", backgroundColor: "#fff", marginHorizontal: 16, borderRadius: 14, padding: 16, marginBottom: 6, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  statVal:   { fontSize: 22, fontWeight: "700", color: C.text },
  statLabel: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  chipRow:   { flexGrow: 0, paddingVertical: 8 },
  chip:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:   { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  card:      { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:       { flexDirection: "row", alignItems: "center" },
  name:      { fontSize: 14, fontWeight: "700", color: C.text },
  sub:       { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  badge:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:  { fontSize: 11, fontWeight: "600" },
  empty:     { paddingVertical: 40, alignItems: "center" },
  emptyTxt:  { color: C.textSecondary, fontSize: 14 },
});
