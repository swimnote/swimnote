/**
 * 커뮤니티 탭 — 공지사항 + 학부모 가입 요청(student_registration_requests)
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;
const TABS = ["공지사항", "학부모 요청"] as const;
type Tab = typeof TABS[number];

interface Notice {
  id: string; title: string; content: string; notice_type: string;
  is_pinned: boolean; view_count: number; created_at: string; author_name: string;
}

interface ParentReq {
  id: string;
  status: string;
  created_at: string;
  child_names: string[];
  memo: string | null;
  parent: { id: string; name: string; phone: string } | null;
}

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
        apiRequest(token, "/admin/student-requests?status=pending"),
      ]);
      if (nRes.ok) setNotices(await nRes.json());
      if (rRes.ok) {
        const data = await rRes.json();
        setRequests(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(req: ParentReq) {
    Alert.alert(
      "가입 승인",
      `${req.parent?.name || "학부모"}님의 가입 요청을 승인하시겠습니까?\n자녀 연결은 학부모 관리 화면에서 추가할 수 있습니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "승인",
          onPress: async () => {
            setProcessingId(req.id);
            try {
              const res = await apiRequest(token, `/admin/student-requests/${req.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "link", student_ids: [] }),
              });
              if (res.ok) {
                setRequests(prev => prev.filter(r => r.id !== req.id));
                Alert.alert("승인 완료", "학부모 가입이 승인되었습니다.\n학부모 관리에서 자녀를 연결해주세요.");
              } else {
                const err = await res.json();
                Alert.alert("오류", err.error || "처리에 실패했습니다.");
              }
            } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
            finally { setProcessingId(null); }
          },
        },
      ]
    );
  }

  async function handleReject(req: ParentReq) {
    Alert.alert(
      "가입 거절",
      `${req.parent?.name || "학부모"}님의 요청을 거절하시겠습니까?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "거절",
          style: "destructive",
          onPress: async () => {
            setProcessingId(req.id);
            try {
              const res = await apiRequest(token, `/admin/student-requests/${req.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "reject", reason: "관리자 거부" }),
              });
              if (res.ok) {
                setRequests(prev => prev.filter(r => r.id !== req.id));
                Alert.alert("거절 완료", "요청이 거절되었습니다.");
              } else {
                const err = await res.json();
                Alert.alert("오류", err.error || "처리에 실패했습니다.");
              }
            } catch { Alert.alert("오류", "네트워크 오류가 발생했습니다."); }
            finally { setProcessingId(null); }
          },
        },
      ]
    );
  }

  async function deleteNotice(id: string) {
    Alert.alert("공지 삭제", "이 공지를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive", onPress: async () => {
          const res = await apiRequest(token, `/notices/${id}`, { method: "DELETE" });
          if (res.ok) setNotices(prev => prev.filter(n => n.id !== id));
          else Alert.alert("오류", "삭제에 실패했습니다.");
        }
      },
    ]);
  }

  const NOTICE_TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
    general:    { label: "일반",     color: "#111827", bg: "#F8FAFC" },
    important:  { label: "중요",     color: "#D96C6C", bg: "#F9DEDA" },
    event:      { label: "이벤트",   color: "#7C3AED", bg: "#F3E8FF" },
    class_info: { label: "수업 안내", color: "#2EC4B6", bg: "#E6FFFA" },
    fee:        { label: "요금 안내", color: "#D97706", bg: "#FFF1BF" },
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;

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
              {t === "학부모 요청" && pendingCount > 0 && (
                <Text style={[s.tabBadge, { color: themeColor }]}> {pendingCount}</Text>
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
                    <View style={[s.typeBadge, { backgroundColor: "#E6FFFA" }]}>
                      <Feather name="thumbtack" size={11} color="#2EC4B6" />
                      <Text style={[s.typeBadgeText, { color: "#2EC4B6" }]}>고정</Text>
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
        /* ── 학부모 가입 요청 ── */
        <FlatList
          data={requests}
          keyExtractor={r => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="check-circle" size={40} color={C.textMuted} />
              <Text style={s.emptyText}>처리 대기 중인 가입 요청이 없습니다</Text>
            </View>
          }
          renderItem={({ item: r }) => (
            <View style={[s.reqCard, { backgroundColor: C.card }]}>
              {/* 학부모 정보 */}
              <View style={s.reqHeader}>
                <View style={[s.reqAvatar, { backgroundColor: themeColor + "20" }]}>
                  <Feather name="user" size={18} color={themeColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.reqParent}>{r.parent?.name || "알 수 없음"}</Text>
                  <Text style={s.reqPhone}>{r.parent?.phone || "-"}</Text>
                </View>
                <Text style={s.reqDate}>
                  {new Date(r.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                </Text>
              </View>

              {/* 신청 자녀 */}
              {r.child_names && r.child_names.length > 0 && (
                <View style={s.childRow}>
                  <Feather name="users" size={13} color={C.textSecondary} />
                  <Text style={s.childLabel}>신청 자녀:</Text>
                  <Text style={s.childNames}>{r.child_names.join(", ")}</Text>
                </View>
              )}

              {/* 메모 */}
              {r.memo ? (
                <View style={s.memoRow}>
                  <Feather name="message-square" size={13} color={C.textSecondary} />
                  <Text style={s.memoText} numberOfLines={2}>{r.memo}</Text>
                </View>
              ) : null}

              {/* 버튼 */}
              <View style={s.reqBtns}>
                <Pressable
                  style={[s.reqBtn, { backgroundColor: "#F9DEDA", opacity: processingId === r.id ? 0.5 : 1 }]}
                  onPress={() => handleReject(r)}
                  disabled={processingId === r.id}
                >
                  <Feather name="x" size={15} color="#D96C6C" />
                  <Text style={[s.reqBtnText, { color: "#D96C6C" }]}>거절</Text>
                </Pressable>
                <Pressable
                  style={[s.reqBtn, { backgroundColor: "#E6FFFA", flex: 1.5, opacity: processingId === r.id ? 0.5 : 1 }]}
                  onPress={() => handleApprove(r)}
                  disabled={processingId === r.id}
                >
                  {processingId === r.id ? (
                    <ActivityIndicator color="#2EC4B6" size="small" />
                  ) : (
                    <>
                      <Feather name="check" size={15} color="#2EC4B6" />
                      <Text style={[s.reqBtnText, { color: "#2EC4B6" }]}>승인</Text>
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

  reqCard: { borderRadius: 16, padding: 16, gap: 10, shadowColor: "#00000012", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  reqHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  reqAvatar: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reqParent: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  reqPhone: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  reqDate: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  childRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F8FAFC", padding: 10, borderRadius: 10 },
  childLabel: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  childNames: { fontSize: 13, fontFamily: "Inter_700Bold", color: C.text, flex: 1 },
  memoRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, paddingHorizontal: 4 },
  memoText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, flex: 1 },
  reqBtns: { flexDirection: "row", gap: 10 },
  reqBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  reqBtnText: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
