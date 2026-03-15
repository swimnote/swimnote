/**
 * 커뮤니케이션 탭
 * 서브탭: 공지사항 / 학부모 요청 / 선생님 전달
 * 실 DB: /notices, /parent-students/pending, /class-diaries
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;
const TABS = ["공지사항", "학부모 요청", "선생님 전달"] as const;
type CommTab = typeof TABS[number];

interface Notice {
  id: string; title: string; content: string; notice_type: string;
  is_pinned: boolean; created_at: string; author_name: string;
}

export default function CommunicationScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab, setTab]           = useState<CommTab>("공지사항");
  const [notices, setNotices]   = useState<Notice[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [diaries, setDiaries]   = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);

  const [showCreate, setShowCreate]   = useState(false);
  const [newTitle, setNewTitle]       = useState("");
  const [newContent, setNewContent]   = useState("");
  const [newType, setNewType]         = useState<"all" | "class" | "individual">("all");
  const [creating, setCreating]       = useState(false);

  const loadNotices = useCallback(async () => {
    setLoading(true);
    const r = await apiRequest(token, "/notices");
    if (r.ok) setNotices(await r.json());
    setLoading(false);
  }, [token]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    const r = await apiRequest(token, "/admin/parent-requests?status=pending");
    if (r.ok) {
      const d = await r.json();
      setRequests(Array.isArray(d) ? d : d.data || d.items || []);
    }
    setLoading(false);
  }, [token]);

  const loadDiaries = useCallback(async () => {
    setLoading(true);
    const r = await apiRequest(token, "/diaries?limit=30");
    if (r.ok) {
      const d = await r.json();
      setDiaries(Array.isArray(d) ? d : d.diaries || []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (tab === "공지사항")  loadNotices();
    if (tab === "학부모 요청") loadRequests();
    if (tab === "선생님 전달") loadDiaries();
  }, [tab]);

  const createNotice = async () => {
    if (!newTitle.trim()) { Alert.alert("제목을 입력해주세요"); return; }
    setCreating(true);
    const r = await apiRequest(token, "/notices", { method: "POST", body: JSON.stringify({ title: newTitle, content: newContent, notice_type: newType, is_pinned: false }) });
    setCreating(false);
    if (r.ok) { setShowCreate(false); setNewTitle(""); setNewContent(""); loadNotices(); }
    else Alert.alert("등록 실패");
  };

  const deleteNotice = (id: string) => {
    Alert.alert("공지 삭제", "삭제 후 복구할 수 없습니다.", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
        loadNotices();
      }},
    ]);
  };

  const handleApprove = (id: string, action: "approve" | "reject") => {
    Alert.alert(action === "approve" ? "승인" : "거절", "진행하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: action === "approve" ? "승인" : "거절", style: action === "reject" ? "destructive" : "default",
        onPress: async () => {
          await apiRequest(token, `/admin/parent-requests/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
          loadRequests();
        },
      },
    ]);
  };

  const listData = tab === "공지사항" ? notices : tab === "학부모 요청" ? requests : diaries;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* 헤더 */}
      <View style={s.header}>
        <Text style={s.headerTitle}>커뮤니케이션</Text>
        {tab === "공지사항" && (
          <Pressable style={[s.createBtn, { backgroundColor: themeColor }]} onPress={() => setShowCreate(true)}>
            <Feather name="plus" size={16} color="#fff" />
            <Text style={s.createBtnTxt}>공지 작성</Text>
          </Pressable>
        )}
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

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={themeColor} />
      ) : (
        <FlatList
          data={listData as any[]}
          keyExtractor={(item, i) => item.id || String(i)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: TAB_BAR_H + 16 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => {
            if (tab === "공지사항") loadNotices();
            if (tab === "학부모 요청") loadRequests();
            if (tab === "선생님 전달") loadDiaries();
          }} />}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>항목이 없습니다</Text></View>}
          renderItem={({ item }) => {
            if (tab === "공지사항") return (
              <View style={s.card}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      {item.is_pinned && <Feather name="bookmark" size={13} color={themeColor} />}
                      <Text style={s.name} numberOfLines={1}>{item.title}</Text>
                    </View>
                    <Text style={s.sub}>{item.author_name || "관리자"}  {new Date(item.created_at).toLocaleDateString("ko-KR")}</Text>
                    {item.content ? <Text style={s.sub2} numberOfLines={2}>{item.content}</Text> : null}
                  </View>
                  <Pressable onPress={() => deleteNotice(item.id)} style={{ padding: 6 }}>
                    <Feather name="trash-2" size={16} color="#DC2626" />
                  </Pressable>
                </View>
              </View>
            );
            if (tab === "학부모 요청") return (
              <View style={s.card}>
                <Text style={s.name}>{item.parent_name || "학부모"}  자녀: {item.child_name || "-"}</Text>
                <Text style={s.sub}>연락처: {item.phone || "-"}  {new Date(item.requested_at || item.created_at).toLocaleDateString("ko-KR")}</Text>
                {item.children_requested && <Text style={s.sub2}>요청 자녀: {item.children_requested}</Text>}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <Pressable style={[s.actBtn, { backgroundColor: themeColor }]} onPress={() => handleApprove(item.id, "approve")}>
                    <Text style={s.actBtnTxt}>승인</Text>
                  </Pressable>
                  <Pressable style={[s.actBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => handleApprove(item.id, "reject")}>
                    <Text style={[s.actBtnTxt, { color: "#DC2626" }]}>거절</Text>
                  </Pressable>
                </View>
              </View>
            );
            return (
              <View style={s.card}>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{item.lesson_date || ""}  {item.class_name || ""}</Text>
                    <Text style={s.sub}>담당: {item.teacher_name || "-"}  노트: {item.note_count || 0}건</Text>
                    {item.common_content && <Text style={s.sub2} numberOfLines={2}>{item.common_content}</Text>}
                  </View>
                  {item.is_edited && (
                    <View style={[s.badge, { backgroundColor: "#FEF3C7" }]}>
                      <Text style={[s.badgeTxt, { color: "#D97706" }]}>수정됨</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* 공지 작성 모달 */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.modal, { paddingTop: insets.top }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>공지 작성</Text>
            <Pressable onPress={() => setShowCreate(false)}><Feather name="x" size={22} color={C.text} /></Pressable>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
            {/* 유형 선택 */}
            <View>
              <Text style={s.fieldLabel}>공지 유형</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["all", "class", "individual"] as const).map(t => (
                  <Pressable key={t} style={[s.typeChip, newType === t && { backgroundColor: themeColor, borderColor: themeColor }]}
                    onPress={() => setNewType(t)}>
                    <Text style={[s.typeChipTxt, newType === t && { color: "#fff" }]}>
                      {t === "all" ? "전체" : t === "class" ? "반별" : "개별"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View>
              <Text style={s.fieldLabel}>제목 *</Text>
              <TextInput style={s.input} value={newTitle} onChangeText={setNewTitle} placeholder="제목을 입력하세요" placeholderTextColor={C.textSecondary} />
            </View>
            <View>
              <Text style={s.fieldLabel}>내용</Text>
              <TextInput style={[s.input, { height: 120, textAlignVertical: "top" }]} value={newContent} onChangeText={setNewContent}
                placeholder="내용을 입력하세요" placeholderTextColor={C.textSecondary} multiline />
            </View>
            <Pressable style={[s.submitBtn, { backgroundColor: themeColor }]} onPress={createNotice} disabled={creating}>
              <Text style={s.submitBtnTxt}>{creating ? "등록 중..." : "공지 등록"}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.background },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: C.text },
  createBtn:   { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  createBtnTxt:{ fontSize: 13, fontWeight: "700", color: "#fff" },
  chipRow:     { flexGrow: 0, paddingVertical: 6 },
  chip:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  chipTxt:     { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  card:        { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row:         { flexDirection: "row", alignItems: "center" },
  name:        { fontSize: 14, fontWeight: "700", color: C.text },
  sub:         { fontSize: 12, color: C.textSecondary, marginTop: 3 },
  sub2:        { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  badge:       { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeTxt:    { fontSize: 11, fontWeight: "600" },
  actBtn:      { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: "center" },
  actBtnTxt:   { fontSize: 13, fontWeight: "700", color: "#fff" },
  empty:       { paddingVertical: 40, alignItems: "center" },
  emptyTxt:    { color: C.textSecondary, fontSize: 14 },
  modal:       { flex: 1, backgroundColor: C.background },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle:  { fontSize: 18, fontWeight: "700", color: C.text },
  fieldLabel:  { fontSize: 13, color: C.textSecondary, marginBottom: 6, fontWeight: "600" },
  input:       { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: C.text, backgroundColor: "#fff" },
  typeChip:    { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, alignItems: "center" },
  typeChipTxt: { fontSize: 13, fontWeight: "600", color: C.textSecondary },
  submitBtn:   { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitBtnTxt:{ fontSize: 15, fontWeight: "700", color: "#fff" },
});
