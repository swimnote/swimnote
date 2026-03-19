/**
 * 선생님관리 전용 화면
 * /admin/teachers API → 목록 + 검색
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

type FilterKey = "전체" | "승인됨" | "미승인" | "부관리자";
const FILTERS: FilterKey[] = ["전체", "승인됨", "미승인", "부관리자"];

interface Teacher {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  position?: string;
  is_activated: boolean;
  is_admin_self_teacher?: boolean;
  class_count?: number;
  student_count?: number;
  today_att?: number;
  today_diary?: number;
  makeup_waiting?: number;
}

export default function PeopleTeachersScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("전체");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await apiRequest(token, "/admin/teachers");
      if (r.ok) setTeachers(await r.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = teachers.filter(t => {
    const matchQ = !q || t.name?.toLowerCase().includes(q.toLowerCase()) ||
      t.phone?.includes(q) || t.email?.toLowerCase().includes(q.toLowerCase());
    if (!matchQ) return false;
    if (filter === "전체") return true;
    if (filter === "승인됨") return t.is_activated;
    if (filter === "미승인") return !t.is_activated;
    if (filter === "부관리자") return !!t.is_admin_self_teacher;
    return true;
  });

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SubScreenHeader title="선생님관리" onBack={() => router.back()} />

      {/* 검색 */}
      <View style={s.searchBar}>
        <Feather name="search" size={15} color={C.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="이름·전화번호·이메일 검색"
          placeholderTextColor={C.textSecondary}
        />
        {!!q && (
          <Pressable onPress={() => setQ("")}>
            <Feather name="x" size={15} color={C.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* 필터 칩 */}
      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f}
            style={[s.chip, filter === f && { backgroundColor: themeColor, borderColor: themeColor }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[s.chipTxt, filter === f && { color: "#fff" }]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: TAB_BAR_H + 16 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTxt}>선생님이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push({ pathname: "/(admin)/teacher-hub", params: { id: item.id, name: item.name } })}
            >
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <View style={s.nameRow}>
                    <Text style={s.name}>{item.name}</Text>
                    {item.is_admin_self_teacher && (
                      <View style={s.adminBadge}>
                        <Text style={s.adminBadgeTxt}>부관리자</Text>
                      </View>
                    )}
                    <View style={[s.statusBadge, item.is_activated ? s.activeBadge : s.inactiveBadge]}>
                      <Text style={[s.statusTxt, item.is_activated ? s.activeTxt : s.inactiveTxt]}>
                        {item.is_activated ? "승인됨" : "미승인"}
                      </Text>
                    </View>
                  </View>
                  {!!item.phone && <Text style={s.sub}>{item.phone}</Text>}
                  {!!item.email && <Text style={s.sub2}>{item.email}</Text>}
                  <View style={s.statsRow}>
                    <StatChip label={`담당반 ${item.class_count ?? 0}`} />
                    <StatChip label={`회원 ${item.student_count ?? 0}`} />
                    <StatChip label={`오늘출결 ${item.today_att ?? 0}`} />
                    {(item.makeup_waiting ?? 0) > 0 && (
                      <StatChip label={`보강대기 ${item.makeup_waiting}`} warn />
                    )}
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color={C.textSecondary} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function StatChip({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <View style={[s.statChip, warn && s.warnChip]}>
      <Text style={[s.statChipTxt, warn && s.warnChipTxt]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },
  searchBar:    { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#F3F4F6", borderRadius: 10 },
  searchInput:  { flex: 1, fontSize: 14, color: C.text },
  filterRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8, flexWrap: "wrap" },
  chip:         { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:      { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  card:         { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:          { flexDirection: "row", alignItems: "center" },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 },
  name:         { fontSize: 15, fontWeight: "700", color: C.text },
  sub:          { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  sub2:         { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  statsRow:     { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  statChip:     { backgroundColor: "#F3F4F6", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statChipTxt:  { fontSize: 11, color: C.textSecondary },
  warnChip:     { backgroundColor: "#FEE2E2" },
  warnChipTxt:  { color: "#DC2626" },
  statusBadge:  { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  activeBadge:  { backgroundColor: "#D1FAE5" },
  inactiveBadge:{ backgroundColor: "#F3F4F6" },
  statusTxt:    { fontSize: 11, fontWeight: "600" },
  activeTxt:    { color: "#059669" },
  inactiveTxt:  { color: "#6B7280" },
  adminBadge:   { backgroundColor: "#EDE9FE", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  adminBadgeTxt:{ fontSize: 11, fontWeight: "600", color: "#7C3AED" },
  empty:        { paddingVertical: 40, alignItems: "center" },
  emptyTxt:     { color: C.textSecondary, fontSize: 14 },
});
