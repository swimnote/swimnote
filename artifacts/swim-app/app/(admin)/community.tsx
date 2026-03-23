/**
 * 커뮤니티 탭 — 공지사항, 사진첩, 학부모 요청
 * 실 DB 연결 (notices, photos, parent_students)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TABS = ["공지사항", "학부모 요청"] as const;
type Tab = typeof TABS[number];

interface Notice { id: string; title: string; content: string; notice_type: string; is_pinned: boolean; view_count: number; created_at: string; author_name: string; }
interface ParentReq { link_id: string; status: string; created_at: string; parent: { id: string; name: string; phone: string } | null; student: { id: string; name: string } | null; }

export default function CommunityScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("공지사항");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [requests, setRequests] = useState<ParentReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nRes, rRes] = await Promise.all([
        apiRequest(token, "/notices"),
        apiRequest(token, "/admin/pending-connections"),
      ]);
      if (nRes.ok) setNotices(await nRes.json());
      if (rRes.ok) setRequests(await rRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleRequest(linkId: string, studentId: string, action: "approve" | "reject") {
    setProcessingId(linkId);
    try {
      const res = await apiRequest(token, `/admin/student-requests/${studentId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: action === "approve" ? "approved" : "rejected", link_id: linkId }),
      });
      if (res.ok) {
        setRequests(prev => prev.filter(r => r.link_id !== linkId));
        Alert.alert(action === "approve" ? "승인 완료" : "거절 완료",
          action === "approve" ? "학부모 연결이 승인되었습니다." : "요청이 거절되었습니다.");
      } else {
        const err = await res.json();
        Alert.alert("오류", err.error || "처리에 실패했습니다.");
      }
    } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
    finally { setProcessingId(null); }
  }

  async function deleteNotice(id: string) {
    Alert.alert("공지 삭제", "이 공지를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        const res = await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
        if (res.ok) setNotices(prev => prev.filter(n => n.id !== id));
        else Alert.alert("오류", "삭제에 실패했습니다.");
      }},
    ]);
  }

  const NOTICE_TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    general:    { label: "일반",     color: "#1F1F1F", bg: "#F6F3F1" },
    important:  { label: "중요",     color: "#D96C6C", bg: "#F9DEDA" },
    event:      { label: "이벤트",   color: "#7C3AED", bg: "#F3E8FF" },
    class_info: { label: "수업 안내", color: "#1F8F86", bg: "#DDF2EF" },
    fee:        { label: "요금 안내", color: "#D97706", bg: "#FFF1BF" },
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="공지/알림"
        rightSlot={
          tab === "공지사항" ? (
            <Pressable
              style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: themeColor, alignItems: "center", justifyContent: "center" }}
              onPress={() => router.push("/(admin)/notices")}
            >
              <Feather name="plus" size={18} color="#fff" />
            </Pressable>
          ) : undefined
        }
      />

      {/* 탭바 */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable key={t} style={[s.tabItem, tab === t && { borderBottomColor: themeColor, borderBottomWidth: 2 }]} onPress={() => setTab(t)}>
            <Text style={[s.tabText, { color: tab === t ? themeColor : C.textSecondary }]}>
              {t}
              {t === "학부모 요청" && requests.length > 0 && (
                <Text style={[s.tabBadge, { color: themeColor }]}> {requests.length}</Text>
              )}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} size="large" style={{ marginTop: 40 }} />
      ) : tab === "공지사항" ? (
        <FlatList
          data={notices}
          keyExtractor={n => n.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="bell-off" size={40} color={C.textMuted} />
              <Text style={s.emptyText}>공지사항이 없습니다</Text>
              <Pressable style={[s.emptyBtn, { backgroundColor: themeColor }]} onPress={() => router.push("/(admin)/notices")}>
                <Feather name="plus" size={16} color="#fff" />
                <Text style={s.emptyBtnText}>첫 공지 작성</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item: n }) => {
            const type = NOTICE_TYPE_LABEL[n.notice_type] || NOTICE_TYPE_LABEL.general;
            return (
              <Pressable style={[s.noticeCard, { backgroundColor: C.card }]}
                onPress={() => router.push("/(admin)/notices")}
                onLongPress={() => deleteNotice(n.id)}
              >
                <View style={s.noticeHeader}>
                  <View style={[s.typeBadge, { backgroundColor: type.bg }]}>
                    <Text style={[s.typeBadgeText, { color: type.color }]}>{type.label}</Text>
                  </View>
                  {n.is_pinned && (
                    <View style={[s.typeBadge, { backgroundColor: "#DDF2EF" }]}>
                      <Feather name="thumbtack" size={11} color="#1F8F86" />
                      <Text style={[s.typeBadgeText, { color: "#1F8F86" }]}>고정</Text>
                    </View>
                  )}
                  <Text style={s.noticeDate}>
                    {new Date(n.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </Text>
                </View>
                <Text style={s.noticeTitle}>{n.title}</Text>
                {n.content && <Text style={s.noticePreview} numberOfLines={2}>{n.content}</Text>}
                <View style={s.noticeFooter}>
                  <Text style={s.noticeAuthor}>{n.author_name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Feather name="eye" size={12} color={C.textMuted} />
                    <Text style={s.noticeView}>{n.view_count || 0}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      ) : (
        /* 학부모 연결 요청 */
        <FlatList
          data={requests}
          keyExtractor={r => r.link_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={40} color={C.textMuted} />
              <Text style={s.emptyText}>처리 대기 중인 연결 요청이 없습니다</Text>
            </View>
          }
          renderItem={({ item: r }) => (
            <View style={[s.reqCard, { backgroundColor: C.card }]}>
              <View style={s.reqHeader}>
                <View style={[s.reqAvatar, { backgroundColor: "#7C3AED20" }]}>
                  <Feather name="user" size={18} color="#7C3AED" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.reqParent}>{r.parent?.name || "알 수 없음"}</Text>
                  <Text style={s.reqPhone}>{r.parent?.phone || "-"}</Text>
                </View>
                <Text style={s.reqDate}>
                  {new Date(r.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                </Text>
              </View>
              <View style={s.reqStudentRow}>
                <Feather name="link" size={14} color={C.textMuted} />
                <Text style={s.reqStudentLabel}>연결 요청 학생:</Text>
                <Text style={s.reqStudentName}>{r.student?.name || "알 수 없음"}</Text>
              </View>
              <View style={s.reqBtns}>
                <Pressable
                  style={[s.reqBtn, { backgroundColor: "#F9DEDA", opacity: processingId === r.link_id ? 0.5 : 1 }]}
                  onPress={() => r.student && handleRequest(r.link_id, r.student.id, "reject")}
                  disabled={processingId === r.link_id}
                >
                  <Feather name="x" size={15} color="#D96C6C" />
                  <Text style={[s.reqBtnText, { color: "#D96C6C" }]}>거절</Text>
                </Pressable>
                <Pressable
                  style={[s.reqBtn, { backgroundColor: "#DDF2EF", flex: 1.5, opacity: processingId === r.link_id ? 0.5 : 1 }]}
                  onPress={() => r.student && handleRequest(r.link_id, r.student.id, "approve")}
                  disabled={processingId === r.link_id}
                >
                  {processingId === r.link_id ? (
                    <ActivityIndicator color="#1F8F86" size="small" />
                  ) : (
                    <>
                      <Feather name="check" size={15} color="#1F8F86" />
                      <Text style={[s.reqBtnText, { color: "#1F8F86" }]}>승인</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: "center" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabBadge: { fontSize: 13, fontFamily: "Inter_700Bold" },

  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.textMuted },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  noticeCard: { borderRadius: 16, padding: 16, gap: 8, shadowColor: "#00000012", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  noticeHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noticeDate: { marginLeft: "auto", fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  noticeTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  noticePreview: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 18 },
  noticeFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noticeAuthor: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  noticeView: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },

  reqCard: { borderRadius: 16, padding: 16, gap: 12, shadowColor: "#00000012", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  reqHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  reqAvatar: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reqParent: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  reqPhone: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  reqDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  reqStudentRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#FBF8F6", padding: 10, borderRadius: 10 },
  reqStudentLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  reqStudentName: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  reqBtns: { flexDirection: "row", gap: 10 },
  reqBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  reqBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
