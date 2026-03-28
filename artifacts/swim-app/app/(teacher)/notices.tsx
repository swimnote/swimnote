/**
 * (teacher)/notices.tsx — 선생님 공지함 (읽기 전용)
 *
 * 소속 수영장의 공지를 열람한다.
 * 작성·삭제 권한 없음.
 */
import { BellOff, Pin, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

interface Notice {
  id: string;
  title: string;
  content: string;
  author_name: string;
  is_pinned: boolean;
  created_at: string;
  notice_type?: string;
  student_name?: string | null;
  audience_scope?: "global" | "pool";
}

export default function TeacherNoticesScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();

  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function fetchNotices() {
    try {
      const res = await apiRequest(token, "/notices");
      if (res.ok) {
        const data = await res.json();
        setNotices(Array.isArray(data) ? data : []);
      }
    } catch { } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { fetchNotices(); }, []);

  function handleExpand(id: string) {
    setExpanded(prev => (prev === id ? null : id));
  }

  const pinned  = notices.filter(n => n.is_pinned);
  const regular = notices.filter(n => !n.is_pinned);

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: "#FFFFFF" }]} edges={[]}>
      <SubScreenHeader title="공지함" homePath="/(teacher)/today-schedule" />

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 80 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} tintColor={themeColor}
              onRefresh={() => { setRefreshing(true); fetchNotices(); }} />
          }
        >
          {pinned.length > 0 && (
            <>
              <View style={s.sectionRow}>
                <Pin size={13} color={themeColor} />
                <Text style={[s.sectionLabel, { color: themeColor }]}>고정 공지</Text>
              </View>
              {pinned.map(n => (
                <NoticeCard key={n.id} n={n} expanded={expanded} onExpand={handleExpand} themeColor={themeColor} />
              ))}
              {regular.length > 0 && (
                <View style={s.sectionRow}>
                  <Text style={[s.sectionLabel, { color: "#64748B" }]}>일반 공지</Text>
                </View>
              )}
            </>
          )}
          {regular.map(n => (
            <NoticeCard key={n.id} n={n} expanded={expanded} onExpand={handleExpand} themeColor={themeColor} />
          ))}
          {notices.length === 0 && (
            <View style={s.empty}>
              <BellOff size={40} color="#D1D5DB" />
              <Text style={s.emptyTxt}>등록된 공지사항이 없습니다</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function NoticeCard({
  n, expanded, onExpand, themeColor,
}: {
  n: Notice; expanded: string | null; onExpand: (id: string) => void; themeColor: string;
}) {
  const isOpen = expanded === n.id;
  return (
    <Pressable
      style={[s.card, n.is_pinned && { borderLeftWidth: 3, borderLeftColor: themeColor }]}
      onPress={() => onExpand(n.id)}
    >
      <View style={s.cardHeader}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {n.is_pinned && <Pin size={12} color={themeColor} />}
          <Text style={s.noticeTitle} numberOfLines={isOpen ? undefined : 1}>{n.title}</Text>
        </View>
        <LucideIcon name={isOpen ? "chevron-up" : "chevron-down"} size={16} color="#64748B" />
      </View>

      {isOpen && (
        <Text style={s.content}>{n.content}</Text>
      )}

      <View style={s.meta}>
        {n.notice_type === "individual" && n.student_name && (
          <View style={s.indiBadge}>
            <User size={10} color="#7C3AED" />
            <Text style={s.indiBadgeTxt}>{n.student_name} 개인공지</Text>
          </View>
        )}
        <Text style={s.metaTxt}>{n.author_name}</Text>
        <Text style={s.metaTxt}>
          {new Date(n.created_at).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe:       { flex: 1 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 },
  sectionLabel:{ fontSize: 13, fontFamily: "Pretendard-Medium" },
  card:       { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8,
                shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05,
                shadowRadius: 4, elevation: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  noticeTitle:{ fontSize: 15, fontFamily: "Pretendard-Medium", color: "#0F172A", flex: 1 },
  content:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#4B5563", lineHeight: 22 },
  meta:       { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  indiBadge:  { flexDirection: "row", alignItems: "center", gap: 3,
                backgroundColor: "#EEDDF5", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  indiBadgeTxt:{ fontSize: 10, fontFamily: "Pretendard-Medium", color: "#7C3AED" },
  metaTxt:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#64748B" },
  empty:      { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTxt:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#64748B" },
});
