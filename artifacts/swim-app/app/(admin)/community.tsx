import { BellOff, Eye, Pin, Plus } from "lucide-react-native";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Pressable,
  RefreshControl, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface Notice {
  id: string; title: string; content: string; notice_type: string;
  is_pinned: boolean; view_count: number; created_at: string; author_name: string;
}

export default function CommunityScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, "/notices");
      if (res.ok) setNotices(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

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
    general:    { label: "일반",     color: "#0F172A", bg: "#FFFFFF" },
    important:  { label: "중요",     color: "#D96C6C", bg: "#F9DEDA" },
    event:      { label: "이벤트",   color: "#7C3AED", bg: "#E6FAF8" },
    class_info: { label: "수업 안내", color: "#2EC4B6", bg: "#E6FFFA" },
    fee:        { label: "요금 안내", color: "#D97706", bg: "#FFF1BF" },
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="공지/알림"
        rightSlot={
          <Pressable
            style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: C.button, alignItems: "center", justifyContent: "center" }}
            onPress={() => router.push("/(admin)/notices?backTo=community" as any)}
          >
            <Plus size={18} color="#fff" />
          </Pressable>
        }
      />

      {loading ? (
        <ActivityIndicator color={C.tint} size="large" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notices}
          keyExtractor={n => n.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.tint} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <BellOff size={40} color={C.textMuted} />
              <Text style={s.emptyText}>공지사항이 없습니다</Text>
              <Pressable style={[s.emptyBtn, { backgroundColor: C.button }]} onPress={() => router.push("/(admin)/notices?backTo=community" as any)}>
                <Plus size={16} color="#fff" />
                <Text style={s.emptyBtnText}>첫 공지 작성</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item: n }) => {
            const type = NOTICE_TYPE_LABEL[n.notice_type] || NOTICE_TYPE_LABEL.general;
            return (
              <Pressable
                style={[s.noticeCard, { backgroundColor: C.card }]}
                onPress={() => router.push("/(admin)/notices?backTo=community" as any)}
                onLongPress={() => deleteNotice(n.id)}
              >
                <View style={s.noticeHeader}>
                  <View style={[s.typeBadge, { backgroundColor: type.bg }]}>
                    <Text style={[s.typeBadgeText, { color: type.color }]}>{type.label}</Text>
                  </View>
                  {n.is_pinned && (
                    <View style={[s.typeBadge, { backgroundColor: "#E6FFFA" }]}>
                      <Pin size={11} color="#2EC4B6" />
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
                    <Eye size={12} color={C.textMuted} />
                    <Text style={s.noticeView}>{n.view_count || 0}</Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textMuted },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  noticeCard: { borderRadius: 16, padding: 16, gap: 8, shadowColor: "#00000012", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  noticeHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typeBadgeText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  noticeDate: { marginLeft: "auto", fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  noticeTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text },
  noticePreview: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  noticeFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noticeAuthor: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  noticeView: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
});
