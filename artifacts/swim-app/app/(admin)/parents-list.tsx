/**
 * (admin)/parents-list.tsx — 학부모 명단
 * 이 수영장을 선택해 가입한 학부모 + 보호자 정보가 있는 학부모 목록
 * 실시간 갱신: useFocusEffect
 */
import { HeartHandshake, Phone, Search, Users, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

type FilterKey = "all" | "app" | "guardian";

interface ParentRow {
  id: string;
  name: string | null;
  phone: string | null;
  login_id: string | null;
  created_at: string;
  source: "app" | "guardian";
  linked: boolean;
  students: { id: string; name: string }[];
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all",      label: "전체" },
  { key: "app",      label: "앱 가입" },
  { key: "guardian", label: "보호자만" },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

function maskPhone(phone: string | null) {
  if (!phone) return "번호 없음";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length >= 11) {
    return digits.slice(0, 3) + "-" + digits.slice(3, 7) + "-" + digits.slice(7);
  }
  return phone;
}

export default function ParentsListScreen() {
  const { token, pool } = useAuth();
  const { themeColor } = useBrand();

  const [parents, setParents]       = useState<ParentRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]         = useState<FilterKey>("all");
  const [search, setSearch]         = useState("");

  const fetchParents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/admin/parents");
      if (res.ok) {
        const data: ParentRow[] = await res.json();
        setParents(data);
      }
    } catch { /* 무시 */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchParents();
  }, [fetchParents]));

  const filtered = parents.filter(p => {
    if (filter === "app"      && p.source !== "app")      return false;
    if (filter === "guardian" && p.source !== "guardian") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const nameMatch = (p.name || "").toLowerCase().includes(q);
      const phoneMatch = (p.phone || "").replace(/[^0-9]/g, "").includes(q.replace(/[^0-9]/g, ""));
      const studentMatch = p.students.some(s => s.name.toLowerCase().includes(q));
      if (!nameMatch && !phoneMatch && !studentMatch) return false;
    }
    return true;
  });

  const appCount = parents.filter(p => p.source === "app").length;
  const guardianCount = parents.filter(p => p.source === "guardian").length;

  return (
    <View style={s.root}>
      <SubScreenHeader
        title="학부모 명단"
        subtitle={`${pool?.name ? pool.name + " · " : ""}전체 ${parents.length}명 · 앱 가입 ${appCount}명`}
      />

      {/* 검색 */}
      <View style={s.searchBox}>
        <Search size={15} color={C.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="이름, 전화번호, 자녀 이름 검색"
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <X size={14} color={C.textMuted} />
          </Pressable>
        )}
      </View>

      {/* 필터 칩 */}
      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f.key}
            style={[s.chip, filter === f.key && { backgroundColor: themeColor, borderColor: themeColor }]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.chipTxt, filter === f.key && { color: "#fff" }]}>
              {f.label}
              {f.key === "all"      && ` ${parents.length}`}
              {f.key === "app"      && ` ${appCount}`}
              {f.key === "guardian" && ` ${guardianCount}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={themeColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: (Platform.OS === "web" ? 84 : 72) + 16,
            paddingTop: 4,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchParents(); }} tintColor={themeColor} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <HeartHandshake size={40} color={C.textMuted} />
              <Text style={s.emptyTxt}>
                {search ? "검색 결과가 없습니다" : "등록된 학부모가 없습니다"}
              </Text>
              <Text style={s.emptySub}>
                {search ? "다른 검색어를 사용해 보세요" : "학부모가 앱에서 수영장을 선택하면\n자동으로 여기에 표시됩니다"}
              </Text>
            </View>
          }
          renderItem={({ item }) => <ParentItem item={item} />}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}
    </View>
  );
}

function ParentItem({ item }: { item: ParentRow }) {
  const isApp = item.source === "app";
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        {/* 아이콘 */}
        <View style={[s.iconBox, { backgroundColor: isApp ? "#E0F2FE" : "#F1F5F9" }]}>
          <LucideIcon name={isApp ? "heart-handshake" : "user"} size={20} color={isApp ? "#0EA5E9" : "#64748B"} />
        </View>

        {/* 이름 + 배지 */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={s.name}>{item.name || "(이름 없음)"}</Text>
            <View style={[s.badge, { backgroundColor: isApp ? "#DBEAFE" : "#F1F5F9" }]}>
              <Text style={[s.badgeTxt, { color: isApp ? "#1D4ED8" : "#64748B" }]}>
                {isApp ? "앱 가입" : "보호자"}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Phone size={11} color={C.textMuted} />
            <Text style={s.phone}>{maskPhone(item.phone)}</Text>
          </View>
        </View>

        {/* 가입일 */}
        <Text style={s.date}>{formatDate(item.created_at)}</Text>
      </View>

      {/* 자녀 목록 */}
      {item.students.length > 0 && (
        <View style={s.studentsRow}>
          <Users size={11} color={C.textMuted} />
          <Text style={s.studentsLabel}>자녀: </Text>
          <Text style={s.studentsVal}>
            {item.students.map(s => s.name).join(", ")}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: C.background },

  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff",
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput:  { flex: 1, fontSize: 14, color: C.text, padding: 0 },

  filterRow:    { flexDirection: "row", gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  chip: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border, backgroundColor: "#fff",
  },
  chipTxt:      { fontSize: 12, fontWeight: "600", color: C.textSecondary },

  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000", shadowOpacity: 0.05,
    shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardHeader:   { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox:      { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  name:         { fontSize: 15, fontWeight: "700", color: C.text },
  badge: {
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeTxt:     { fontSize: 11, fontWeight: "600" },
  phone:        { fontSize: 12, color: C.textMuted },
  date:         { fontSize: 11, color: C.textMuted, alignSelf: "flex-start" },

  studentsRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  studentsLabel:{ fontSize: 12, color: C.textMuted },
  studentsVal:  { fontSize: 12, color: C.textSecondary, flex: 1 },

  empty:        { alignItems: "center", marginTop: 60, gap: 10 },
  emptyTxt:     { fontSize: 15, fontWeight: "700", color: C.textSecondary },
  emptySub:     { fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 20 },
});
