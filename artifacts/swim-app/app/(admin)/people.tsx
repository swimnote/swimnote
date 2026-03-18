/**
 * 사람 탭 — 회원 / 학부모 / 선생님 / 승인
 * 실 DB: /students, /admin/teachers, /admin/parents, /parent-students/pending
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PageHeader } from "@/components/common/PageHeader";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;
const TABS = ["회원", "학부모", "선생님", "승인"] as const;
type PeopleTab = typeof TABS[number];

const MEMBER_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active:              { label: "재원",    color: "#059669", bg: "#D1FAE5" },
  pending_parent_link: { label: "연결대기", color: "#D97706", bg: "#FEF3C7" },
  inactive:            { label: "휴원",    color: "#6B7280", bg: "#F3F4F6" },
  withdrawn:           { label: "탈퇴",    color: "#DC2626", bg: "#FEE2E2" },
  deleted:             { label: "삭제",    color: "#9CA3AF", bg: "#F9FAFB" },
};

export default function PeopleScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [tab, setTab]       = useState<PeopleTab>("회원");
  const [members, setMembers]   = useState<any[]>([]);
  const [parents, setParents]   = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [q, setQ]               = useState("");

  const loadData = useCallback(async (which: PeopleTab) => {
    setLoading(true);
    try {
      if (which === "회원") {
        const r = await apiRequest(token, "/students");
        if (r.ok) setMembers(await r.json());
      } else if (which === "학부모") {
        const r = await apiRequest(token, "/admin/parents");
        if (r.ok) setParents(await r.json());
      } else if (which === "선생님") {
        const r = await apiRequest(token, "/admin/teachers");
        if (r.ok) setTeachers(await r.json());
      } else {
        const r = await apiRequest(token, "/admin/parent-requests?status=pending");
        if (r.ok) {
          const d = await r.json();
          setApprovals(Array.isArray(d) ? d : d.data || d.items || []);
        }
      }
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadData(tab); setQ(""); }, [tab]);

  const handleApprove = (id: string, action: "approve" | "reject") => {
    Alert.alert(
      action === "approve" ? "학부모 연결 승인" : "학부모 연결 거절",
      "진행하시겠습니까?",
      [
        { text: "취소", style: "cancel" },
        {
          text: action === "approve" ? "승인" : "거절",
          style: action === "reject" ? "destructive" : "default",
          onPress: async () => {
            await apiRequest(token, `/admin/parent-requests/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
            loadData("승인");
          },
        },
      ]
    );
  };

  const filtered = (() => {
    const lq = q.toLowerCase();
    if (tab === "회원")  return members.filter(m  => !q || m.name?.includes(q) || m.parent_name?.includes(q));
    if (tab === "학부모") return parents.filter(p  => !q || p.name?.includes(q) || p.phone?.includes(q));
    if (tab === "선생님") return teachers.filter(t => !q || t.name?.toLowerCase().includes(lq));
    return approvals;
  })();

  return (
    <View style={s.root}>
      <PageHeader
        title="사람"
        rightSlot={
          approvals.length > 0 ? (
            <View style={s.badge}><Text style={s.badgeTxt}>{approvals.length}</Text></View>
          ) : undefined
        }
      />

      {/* 탭 칩 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {TABS.map(t => (
          <Pressable key={t} onPress={() => setTab(t)}
            style={[s.chip, tab === t && { backgroundColor: themeColor, borderColor: themeColor }]}>
            <Text style={[s.chipTxt, tab === t && { color: "#fff" }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* 검색 */}
      {tab !== "승인" && (
        <View style={s.searchBar}>
          <Feather name="search" size={15} color={C.textSecondary} />
          <TextInput style={s.searchInput} value={q} onChangeText={setQ}
            placeholder={tab === "회원" ? "이름·보호자 검색" : tab === "선생님" ? "이름 검색" : "이름·연락처 검색"}
            placeholderTextColor={C.textSecondary} />
          {!!q && <Pressable onPress={() => setQ("")}><Feather name="x" size={15} color={C.textSecondary} /></Pressable>}
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => item.id || item.link_id || String(i)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: TAB_BAR_H + 16 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => loadData(tab)} />}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>항목이 없습니다</Text></View>}
          renderItem={({ item }) => {
            if (tab === "회원")   return <MemberRow   item={item} themeColor={themeColor} />;
            if (tab === "학부모") return <ParentRow   item={item} />;
            if (tab === "선생님") return <TeacherRow  item={item} themeColor={themeColor} />;
            return <ApprovalRow item={item} onAction={handleApprove} themeColor={themeColor} />;
          }}
        />
      )}
    </View>
  );
}

function MemberRow({ item, themeColor }: { item: any; themeColor: string }) {
  const st = MEMBER_STATUS[item.status] || MEMBER_STATUS.active;
  return (
    <Pressable style={s.card} onPress={() => router.push({ pathname: "/(admin)/member-detail", params: { id: item.id } })}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={s.name}>{item.name}</Text>
            <View style={[s.pill, { backgroundColor: st.bg }]}>
              <Text style={[s.pillTxt, { color: st.color }]}>{st.label}</Text>
            </View>
          </View>
          <Text style={s.sub}>{item.class_group_name || "반 미배정"}  {item.instructor ? `· ${item.instructor}` : ""}</Text>
          <Text style={s.sub2}>보호자: {item.parent_name || "-"}  {item.parent_phone || ""}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function ParentRow({ item }: { item: any }) {
  const children: any[] = item.children || [];
  const isLinked = children.some((c: any) => c.ps_status === "active");
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <Text style={s.sub}>연락처: {item.phone || "-"}</Text>
          {children.length > 0 && (
            <Text style={s.sub2}>자녀: {children.map((c: any) => c.name).join(", ")}</Text>
          )}
        </View>
        <View style={[s.pill, { backgroundColor: isLinked ? "#D1FAE5" : "#FEF3C7" }]}>
          <Text style={[s.pillTxt, { color: isLinked ? "#059669" : "#D97706" }]}>
            {isLinked ? "연결완료" : "연결대기"}
          </Text>
        </View>
      </View>
    </View>
  );
}

function TeacherRow({ item, themeColor }: { item: any; themeColor: string }) {
  return (
    <Pressable style={s.card}
      onPress={() => router.push({ pathname: "/(admin)/teacher-hub", params: { id: item.id, name: item.name } })}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            <Chip label={`담당반 ${item.class_count ?? 0}`} />
            <Chip label={`회원 ${item.student_count ?? 0}`} />
            <Chip label={`오늘출결 ${item.today_att ?? 0}`} />
            <Chip label={`오늘일지 ${item.today_diary ?? 0}`} />
            {(item.makeup_waiting ?? 0) > 0 && <Chip label={`보강대기 ${item.makeup_waiting}`} warn />}
          </View>
        </View>
        <Feather name="chevron-right" size={18} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function Chip({ label, warn }: { label: string; warn?: boolean }) {
  return (
    <View style={[s.chip2, warn && { backgroundColor: "#FEE2E2" }]}>
      <Text style={[s.chip2Txt, warn && { color: "#DC2626" }]}>{label}</Text>
    </View>
  );
}

function ApprovalRow({ item, onAction, themeColor }: { item: any; onAction: (id: string, a: "approve" | "reject") => void; themeColor: string }) {
  const linkId = item.link_id || item.id;
  return (
    <View style={s.card}>
      <Text style={s.name}>{item.parent?.name || item.parent_name || "학부모"}  자녀: {item.student?.name || item.student_name || item.child_name || "미지정"}</Text>
      <Text style={s.sub}>연락처: {item.parent?.phone || item.parent_phone || item.phone || "-"}</Text>
      <Text style={s.sub2}>{new Date(item.requested_at || item.created_at).toLocaleDateString("ko-KR")}</Text>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <Pressable style={[s.actionBtn, { backgroundColor: themeColor }]} onPress={() => onAction(linkId, "approve")}>
          <Text style={s.actionBtnTxt}>승인</Text>
        </Pressable>
        <Pressable style={[s.actionBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => onAction(linkId, "reject")}>
          <Text style={[s.actionBtnTxt, { color: "#DC2626" }]}>거절</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.background },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: C.text },
  badge:       { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt:    { color: "#fff", fontSize: 11, fontWeight: "700" },
  chipRow:     { flexGrow: 0, paddingVertical: 6 },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:     { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  chip2:       { backgroundColor: "#F3F4F6", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  chip2Txt:    { fontSize: 11, color: C.textSecondary },
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#F3F4F6", borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text },
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:         { flexDirection: "row", alignItems: "center" },
  name:        { fontSize: 15, fontWeight: "700", color: C.text },
  sub:         { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sub2:        { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  pill:        { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pillTxt:     { fontSize: 11, fontWeight: "600" },
  actionBtn:   { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  actionBtnTxt:{ fontSize: 13, fontWeight: "700", color: "#fff" },
  empty:       { paddingVertical: 40, alignItems: "center" },
  emptyTxt:    { color: C.textSecondary, fontSize: 14 },
});
