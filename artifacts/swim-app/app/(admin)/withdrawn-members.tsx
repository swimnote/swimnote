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
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

interface ArchivedMember {
  id: string;
  name: string;
  last_class_group_name: string | null;
  attendance_count: number;
  withdrawn_at: string | null;
  deleted_at: string | null;
  archived_reason: string | null;
  status: "withdrawn" | "deleted";
  phone?: string | null;
}

type TabKey = "all" | "deleted" | "withdrawn";

export default function WithdrawnMembersScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [members, setMembers] = useState<ArchivedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

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

  const byTab = members.filter(m => {
    if (tab === "deleted") return m.status === "deleted";
    if (tab === "withdrawn") return m.status === "withdrawn";
    return true;
  });

  const filtered = byTab.filter(m =>
    m.name.includes(search) || (m.last_class_group_name || "").includes(search)
  );

  function fmtDate(d: string | null) {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
  }

  function getArchivedDate(m: ArchivedMember): string | null {
    if (m.status === "deleted") return m.deleted_at;
    return m.withdrawn_at;
  }

  const tabs: { key: TabKey; label: string; color: string }[] = [
    { key: "all", label: "전체", color: C.tint },
    { key: "deleted", label: "삭제회원", color: "#DC2626" },
    { key: "withdrawn", label: "탈퇴회원", color: "#6B7280" },
  ];

  const deletedCount = members.filter(m => m.status === "deleted").length;
  const withdrawnCount = members.filter(m => m.status === "withdrawn").length;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader title="보관 회원 관리" />

      {/* 탭 */}
      <View style={styles.tabRow}>
        {tabs.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tab, tab === t.key && { borderBottomWidth: 2, borderBottomColor: t.color }]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabText, { color: tab === t.key ? t.color : C.textMuted }]}>
              {t.label}
              {t.key === "deleted" && deletedCount > 0 && (
                <Text style={{ color: "#DC2626" }}> {deletedCount}</Text>
              )}
              {t.key === "withdrawn" && withdrawnCount > 0 && (
                <Text style={{ color: "#6B7280" }}> {withdrawnCount}</Text>
              )}
            </Text>
          </Pressable>
        ))}
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

      {/* 건수 */}
      <View style={[styles.countRow, { paddingHorizontal: 20 }]}>
        <Text style={[styles.countText, { color: C.textSecondary }]}>
          {tab === "deleted" ? "삭제회원" : tab === "withdrawn" ? "탈퇴회원" : "보관회원"}{" "}
          <Text style={{ color: C.error, fontFamily: "Inter_600SemiBold" }}>{filtered.length}</Text>명
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="user-x" size={40} color={C.textMuted} />
          <Text style={[styles.emptyText, { color: C.textMuted }]}>
            {search ? "검색 결과가 없습니다" : "해당 회원이 없습니다"}
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
            <Text style={[styles.thCell, styles.colDate, { color: C.tint }]}>처리일</Text>
          </View>

          {filtered.map((m, idx) => (
            <View
              key={m.id}
              style={[
                styles.tableRow,
                { backgroundColor: idx % 2 === 0 ? C.card : C.background, borderColor: C.border },
              ]}
            >
              <View style={[styles.colName, styles.nameCell]}>
                <View style={[styles.avatar, {
                  backgroundColor: m.status === "deleted" ? "#FEE2E2" : "#F3F4F6",
                }]}>
                  <Text style={[styles.avatarTxt, {
                    color: m.status === "deleted" ? "#DC2626" : "#6B7280",
                  }]}>{m.name[0]}</Text>
                </View>
                <View>
                  <Text style={[styles.tdName, { color: C.text }]}>{m.name}</Text>
                  <View style={[styles.typeBadge, {
                    backgroundColor: m.status === "deleted" ? "#FEE2E2" : "#F3F4F6",
                  }]}>
                    <Text style={[styles.typeBadgeText, {
                      color: m.status === "deleted" ? "#DC2626" : "#6B7280",
                    }]}>
                      {m.status === "deleted" ? "삭제" : "탈퇴"}
                    </Text>
                  </View>
                </View>
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
                {fmtDate(getArchivedDate(m))}
              </Text>
            </View>
          ))}

          <Text style={[styles.footNote, { color: C.textMuted }]}>
            * 삭제회원은 학부모 계정과의 연결이 유지됩니다. {"\n"}* 출결 및 수업 기록은 보존됩니다.
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
  tabRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", marginBottom: 12 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 10 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  typeBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginTop: 2, alignSelf: "flex-start" },
  typeBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  footNote: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 16, textAlign: "center", lineHeight: 16 },
});
