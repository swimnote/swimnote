import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface WithdrawnMember {
  id: string;
  name: string;
  last_class_group_name: string | null;
  attendance_count: number;
  withdrawn_at: string | null;
  phone?: string | null;
}

export default function WithdrawnMembersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [members, setMembers] = useState<WithdrawnMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await apiRequest(token, "/admin/withdrawn-members");
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const filtered = members.filter(m =>
    m.name.includes(search) || (m.last_class_group_name || "").includes(search)
  );

  function fmtDate(d: string | null) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[styles.title, { color: C.text }]}>탈퇴 회원 관리</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* 검색 */}
      <View style={[styles.searchBox, { borderColor: C.border, backgroundColor: C.card, marginHorizontal: 20 }]}>
        <Feather name="search" size={16} color={C.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="이름 또는 수업명 검색"
          placeholderTextColor={C.textMuted}
        />
      </View>

      {/* 건수 표시 */}
      <View style={[styles.countRow, { paddingHorizontal: 20 }]}>
        <Text style={[styles.countText, { color: C.textSecondary }]}>
          탈퇴 회원 <Text style={{ color: C.error, fontFamily: "Inter_600SemiBold" }}>{filtered.length}</Text>명
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="user-x" size={40} color={C.textMuted} />
          <Text style={[styles.emptyText, { color: C.textMuted }]}>
            {search ? "검색 결과가 없습니다" : "탈퇴 회원이 없습니다"}
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}
        >
          {/* 테이블 헤더 */}
          <View style={[styles.tableHeader, { backgroundColor: C.tint + "12", borderColor: C.border }]}>
            <Text style={[styles.thCell, styles.colName, { color: C.tint }]}>이름</Text>
            <Text style={[styles.thCell, styles.colClass, { color: C.tint }]}>마지막 반</Text>
            <Text style={[styles.thCell, styles.colAtt, { color: C.tint }]}>출석</Text>
            <Text style={[styles.thCell, styles.colDate, { color: C.tint }]}>탈퇴일</Text>
          </View>

          {/* 테이블 로우 */}
          {filtered.map((m, idx) => (
            <View
              key={m.id}
              style={[
                styles.tableRow,
                { backgroundColor: idx % 2 === 0 ? C.card : C.background, borderColor: C.border },
              ]}
            >
              <View style={[styles.colName, styles.nameCell]}>
                <View style={[styles.avatar, { backgroundColor: "#FEE2E2" }]}>
                  <Text style={[styles.avatarTxt, { color: C.error }]}>{m.name[0]}</Text>
                </View>
                <Text style={[styles.tdName, { color: C.text }]}>{m.name}</Text>
              </View>
              <Text style={[styles.tdCell, styles.colClass, { color: C.textSecondary }]} numberOfLines={1}>
                {m.last_class_group_name || "-"}
              </Text>
              <View style={[styles.colAtt, { alignItems: "center" }]}>
                <View style={[styles.attBadge, { backgroundColor: C.tintLight }]}>
                  <Text style={[styles.attTxt, { color: C.tint }]}>{m.attendance_count}</Text>
                </View>
              </View>
              <Text style={[styles.tdCell, styles.colDate, { color: C.textMuted }]} numberOfLines={1}>
                {fmtDate(m.withdrawn_at)}
              </Text>
            </View>
          ))}

          <Text style={[styles.footNote, { color: C.textMuted }]}>
            * 탈퇴 회원의 출결 기록은 보존됩니다. 사진첩은 삭제됩니다.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  countRow: { marginBottom: 10 },
  countText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  tableHeader: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, marginBottom: 2 },
  tableRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderTopWidth: 0, paddingVertical: 10, paddingHorizontal: 8 },
  thCell: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tdCell: { fontSize: 13, fontFamily: "Inter_400Regular" },
  tdName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  colName: { flex: 2, flexDirection: "row", alignItems: "center", gap: 6 },
  colClass: { flex: 2 },
  colAtt: { flex: 1 },
  colDate: { flex: 2, textAlign: "right" },
  nameCell: {},
  avatar: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  avatarTxt: { fontSize: 12, fontFamily: "Inter_700Bold" },
  attBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  attTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  footNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 16, textAlign: "center", lineHeight: 16 },
});
