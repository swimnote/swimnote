import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Notice {
  id: string;
  title: string;
  content: string;
  author_name: string;
  is_pinned: boolean;
  is_read: boolean;
  created_at: string;
  notice_type?: string;
  student_name?: string | null;
  image_urls?: string[];
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

function TypeBadge({ type }: { type?: string }) {
  const isClass = type === "class";
  return (
    <View style={[tb.badge, { backgroundColor: isClass ? "#EDE9FE" : "#EFF6FF" }]}>
      <Text style={[tb.txt, { color: isClass ? "#6D28D9" : "#1D4ED8" }]}>
        {isClass ? "반" : "전체"}
      </Text>
    </View>
  );
}
const tb = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start" },
  txt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

export default function ParentNoticesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "general" | "class">("all");

  async function fetchNotices() {
    try {
      const res = await apiRequest(token, "/parent/notices");
      const data = await res.json();
      setNotices(Array.isArray(data) ? data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchNotices(); }, []);

  async function handleOpen(n: Notice) {
    const isOpening = expanded !== n.id;
    setExpanded(isOpening ? n.id : null);
    if (isOpening && !n.is_read) {
      await apiRequest(token, `/parent/notices/${n.id}/read`, { method: "POST" });
      setNotices(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
    }
  }

  const filtered = filter === "all" ? notices : notices.filter(n => (n.notice_type || "general") === filter);
  const pinned = filtered.filter(n => n.is_pinned);
  const regular = filtered.filter(n => !n.is_pinned);
  const unreadCount = notices.filter(n => !n.is_read).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <SubScreenHeader
        title="공지사항"
        onBack={() => router.navigate("/(parent)/more" as any)}
        rightSlot={
          unreadCount > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: C.error }]}>
              <Text style={styles.unreadCount}>미읽음 {unreadCount}</Text>
            </View>
          ) : undefined
        }
      />

      {/* 필터 탭 */}
      <View style={styles.filterRow}>
        {(["all", "general", "class"] as const).map(f => (
          <Pressable
            key={f}
            style={[styles.filterBtn, { backgroundColor: filter === f ? C.tint : "#F3F4F6" }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTxt, { color: filter === f ? "#fff" : C.textSecondary }]}>
              {f === "all" ? "전체" : f === "general" ? "수영장 공지" : "반 공지"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotices(); }} />}
        >
          {pinned.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Feather name="pin" size={13} color={C.tint} />
                <Text style={[styles.sectionLabel, { color: C.tint }]}>고정 공지</Text>
              </View>
              {pinned.map(n => <NoticeItem key={n.id} n={n} expanded={expanded} onOpen={handleOpen} />)}
            </>
          )}
          {regular.length > 0 && (
            <>
              {pinned.length > 0 && (
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>일반 공지</Text>
                </View>
              )}
              {regular.map(n => <NoticeItem key={n.id} n={n} expanded={expanded} onOpen={handleOpen} />)}
            </>
          )}
          {filtered.length === 0 && (
            <View style={styles.empty}>
              <Feather name="bell-off" size={48} color={C.textMuted} />
              <Text style={[styles.emptyTitle, { color: C.text }]}>공지사항 없음</Text>
              <Text style={[styles.emptyText, { color: C.textSecondary }]}>아직 등록된 공지사항이 없습니다</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function NoticeItem({ n, expanded, onOpen }: {
  n: Notice; expanded: string | null; onOpen: (n: Notice) => void;
}) {
  const isOpen = expanded === n.id;
  const images: string[] = Array.isArray(n.image_urls) ? n.image_urls : [];

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: C.card, borderLeftWidth: n.is_pinned ? 3 : 0, borderLeftColor: C.tint },
        !n.is_read && { borderWidth: 1.5, borderColor: C.tint + "60" },
      ]}
      onPress={() => onOpen(n)}
    >
      <View style={styles.cardRow}>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TypeBadge type={n.notice_type} />
            {!n.is_read && <View style={[styles.unreadDot, { backgroundColor: C.tint }]} />}
          </View>
          <Text style={[styles.noticeTitle, { color: C.text, fontFamily: n.is_read ? "Inter_500Medium" : "Inter_700Bold" }]} numberOfLines={isOpen ? undefined : 2}>
            {n.title}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
        </View>
      </View>

      {isOpen && (
        <View style={styles.expandedArea}>
          {n.student_name && (
            <View style={[styles.individualTag, { backgroundColor: C.tintLight }]}>
              <Feather name="user" size={12} color={C.tint} />
              <Text style={[styles.individualText, { color: C.tint }]}>{n.student_name} 학생 개별 공지</Text>
            </View>
          )}
          <Text style={[styles.noticeContent, { color: C.textSecondary }]}>{n.content}</Text>
          {images.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }} contentContainerStyle={{ gap: 8 }}>
              {images.map((key, i) => (
                <Image
                  key={i}
                  source={{ uri: `${API_BASE}/api/uploads/${encodeURIComponent(key)}` }}
                  style={styles.thumbImage}
                  resizeMode="cover"
                />
              ))}
            </ScrollView>
          )}
        </View>
      )}

      <View style={styles.meta}>
        <Text style={[styles.metaText, { color: C.textMuted }]}>{n.author_name}</Text>
        <Text style={[styles.metaText, { color: C.textMuted }]}>{new Date(n.created_at).toLocaleDateString("ko-KR")}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  unreadBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  unreadCount: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  filterRow: { flexDirection: "row", paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  filterTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, padding: 14, gap: 10, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2, shadowColor: "#0000001A", backgroundColor: "#fff" },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, marginTop: 2, flexShrink: 0 },
  noticeTitle: { fontSize: 15, lineHeight: 22 },
  expandedArea: { gap: 8 },
  individualTag: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  individualText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  noticeContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  thumbImage: { width: 140, height: 140, borderRadius: 10 },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
