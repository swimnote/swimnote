/**
 * (teacher)/students.tsx — 회원 관리
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface StudentItem {
  id: string;
  name: string;
  status: string;
  class_name: string | null;
  birth_year: number | null;
  phone: string | null;
  parent_user_id: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

type FilterTab = "active" | "suspended" | "withdrawn";

const TAB_CONFIG: { key: FilterTab; label: string; color: string }[] = [
  { key: "active",    label: "정상",   color: "#059669" },
  { key: "suspended", label: "연기",   color: "#F59E0B" },
  { key: "withdrawn", label: "탈퇴",   color: "#DC2626" },
];

export default function StudentsScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab,        setTab]        = useState<FilterTab>("active");
  const [list,       setList]       = useState<StudentItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");

  const load = useCallback(async (status: FilterTab) => {
    try {
      const res = await apiRequest(token, `/teacher/me/members?status=${status}`);
      if (res.ok) setList(await res.json());
      else setList([]);
    } catch (e) { console.error(e); setList([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    setList([]);
    setSearch("");
    load(tab);
  }, [tab, load]);

  const displayed = search.trim()
    ? list.filter(s => s.name.includes(search.trim()) || (s.class_name ?? "").includes(search.trim()))
    : list;

  const tabColor = TAB_CONFIG.find(t => t.key === tab)?.color ?? themeColor;

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="회원 관리" homePath="/(teacher)/today-schedule" />

      {/* 탭 */}
      <View style={s.tabRow}>
        {TAB_CONFIG.map(t => (
          <Pressable
            key={t.key}
            style={[s.tabBtn, tab === t.key && { backgroundColor: t.color, borderColor: t.color }]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[s.tabTxt, tab === t.key && { color: "#fff" }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* 검색 */}
      <View style={s.searchRow}>
        <Feather name="search" size={15} color={C.textMuted} style={{ marginLeft: 10 }} />
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 반 이름 검색..."
          placeholderTextColor={C.textMuted}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} style={{ paddingRight: 10 }}>
            <Feather name="x" size={15} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(tab); }} tintColor={themeColor} />
          }
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="users" size={36} color={C.textMuted} />
              <Text style={s.emptyText}>
                {search.trim() ? "검색 결과가 없습니다" : `${TAB_CONFIG.find(t => t.key === tab)?.label}회원이 없습니다`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={[s.memberRow, { backgroundColor: C.card }]}
              onPress={() => router.push({ pathname: "/(teacher)/student-detail", params: { id: item.id } } as any)}
            >
              <View style={[s.avatar, { backgroundColor: tabColor + "20" }]}>
                <Text style={[s.avatarText, { color: tabColor }]}>{item.name[0]}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.name}>{item.name}</Text>
                <Text style={s.sub}>
                  {[item.class_name, item.birth_year ? `${item.birth_year}년생` : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                {item.parent_user_id ? (
                  <View style={[s.badge, { backgroundColor: "#D1FAE5" }]}>
                    <Feather name="check-circle" size={10} color="#059669" />
                    <Text style={[s.badgeTxt, { color: "#059669" }]}>앱 연결</Text>
                  </View>
                ) : null}
                {item.deleted_at ? (
                  <Text style={[s.sub, { color: "#DC2626" }]}>탈퇴 {item.deleted_at.slice(0,10)}</Text>
                ) : null}
              </View>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: "#F3F4F6" },
  tabRow:     { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  tabBtn:     { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: C.border },
  tabTxt:     { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  searchRow:  { flexDirection: "row", alignItems: "center", backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  searchInput:{ flex: 1, height: 42, paddingHorizontal: 8, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text },
  emptyBox:   { alignItems: "center", gap: 12, paddingVertical: 60 },
  emptyText:  { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  memberRow:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14 },
  avatar:     { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name:       { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  sub:        { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  badge:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  badgeTxt:   { fontSize: 10, fontFamily: "Inter_600SemiBold" },
});
