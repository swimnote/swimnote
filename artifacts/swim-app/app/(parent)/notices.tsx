import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Notice { id: string; title: string; content: string; author_name: string; is_pinned: boolean; created_at: string; }

export default function ParentNoticesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function fetchNotices() {
    try {
      const res = await apiRequest(token, "/notices");
      const data = await res.json();
      setNotices(Array.isArray(data) ? data : []);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchNotices(); }, []);

  const pinned = notices.filter(n => n.is_pinned);
  const regular = notices.filter(n => !n.is_pinned);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Text style={[styles.title, { color: C.text }]}>공지사항</Text>
        <View style={[styles.countBadge, { backgroundColor: C.tintLight }]}>
          <Text style={[styles.countText, { color: C.tint }]}>{notices.length}개</Text>
        </View>
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
              {pinned.map((n) => <NoticeItem key={n.id} n={n} expanded={expanded} setExpanded={setExpanded} C={C} />)}
              {regular.length > 0 && (
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>일반 공지</Text>
                </View>
              )}
            </>
          )}
          {regular.map((n) => <NoticeItem key={n.id} n={n} expanded={expanded} setExpanded={setExpanded} C={C} />)}
          {notices.length === 0 && (
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

function NoticeItem({ n, expanded, setExpanded, C }: { n: Notice; expanded: string | null; setExpanded: (id: string | null) => void; C: typeof Colors.light }) {
  const isOpen = expanded === n.id;
  return (
    <Pressable
      style={[styles.card, { backgroundColor: C.card, shadowColor: C.shadow, borderLeftWidth: n.is_pinned ? 3 : 0, borderLeftColor: C.tint }]}
      onPress={() => setExpanded(isOpen ? null : n.id)}
    >
      <View style={styles.cardRow}>
        {n.is_pinned ? <Feather name="pin" size={12} color={C.tint} /> : null}
        <Text style={[styles.noticeTitle, { color: C.text }]} numberOfLines={isOpen ? undefined : 2}>{n.title}</Text>
        <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
      </View>
      {isOpen && (
        <Text style={[styles.noticeContent, { color: C.textSecondary }]}>{n.content}</Text>
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
  title: { fontSize: 24, fontFamily: "Inter_700Bold" },
  countBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  countText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: { borderRadius: 14, padding: 14, gap: 10, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  noticeTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  noticeContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
