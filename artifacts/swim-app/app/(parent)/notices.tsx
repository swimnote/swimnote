/**
 * 학부모 공지사항
 * - 전체공지 / 우리반공지 태그 분리
 * - ParentScreenHeader (홈 버튼 → 학부모 홈)
 */
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface Notice {
  id: string; title: string; content: string; author_name: string;
  is_pinned: boolean; is_read: boolean; created_at: string;
  notice_type?: string;
  audience_scope?: "global" | "pool";
}
type FilterKey = "all" | "general" | "class";

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function TypeBadge({ type, scope }: { type?: string; scope?: string }) {
  const isClass   = type === "class";
  const isGlobal  = scope === "global";
  const label     = isGlobal ? "플랫폼 전체" : isClass ? "우리반 공지" : "수영장 공지";
  const bg        = isGlobal ? "#EEDDF5" : isClass ? "#F3EDFE" : "#DDF2EF";
  const color     = isGlobal ? "#7C3AED" : isClass ? "#6D28D9" : "#1F8F86";
  return (
    <View style={[tb.badge, { backgroundColor: bg }]}>
      <Text style={[tb.txt, { color }]}>{label}</Text>
    </View>
  );
}
const tb = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, alignSelf: "flex-start" },
  txt: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

export default function ParentNoticesScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  async function fetchNotices() {
    try {
      setLoading(true);
      const res = await apiRequest(token, "/parent/notices");
      if (res.ok) setNotices(await res.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { fetchNotices(); }, []);

  async function markRead(n: Notice) {
    if (n.is_read) return;
    await apiRequest(token, `/parent/notices/${n.id}/read`, { method: "POST" });
    setNotices(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x));
  }

  function toggleExpand(n: Notice) {
    if (expanded === n.id) { setExpanded(null); }
    else { setExpanded(n.id); markRead(n); }
  }

  const filtered = notices.filter(n => filter === "all" || n.notice_type === filter);
  const unreadCount = notices.filter(n => !n.is_read).length;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader
        title={unreadCount > 0 ? `공지사항 (${unreadCount})` : "공지사항"}
      />

      {/* 필터 칩 */}
      <View style={s.filterRow}>
        {(["all", "general", "class"] as FilterKey[]).map(k => {
          const labels: Record<FilterKey, string> = { all: "전체", general: "전체공지", class: "우리반공지" };
          const active = filter === k;
          return (
            <Pressable
              key={k}
              style={[s.chip, active && { backgroundColor: C.tint, borderColor: C.tint }]}
              onPress={() => setFilter(k)}
            >
              <Text style={[s.chipTxt, { color: active ? "#fff" : C.textSecondary }]}>{labels[k]}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchNotices(); setRefreshing(false); }} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 10, paddingTop: 8 }}
        >
          {filtered.length === 0 ? (
            <View style={[s.emptyBox, { backgroundColor: C.card }]}>
              <Text style={s.emptyEmoji}>📋</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>공지사항이 없습니다</Text>
            </View>
          ) : filtered.map(n => {
            const isExpanded = expanded === n.id;
            return (
              <Pressable
                key={n.id}
                style={[s.card, { backgroundColor: C.card }, !n.is_read && s.cardUnread]}
                onPress={() => toggleExpand(n)}
              >
                <View style={s.cardTop}>
                  <TypeBadge type={n.notice_type} scope={n.audience_scope} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    {!n.is_read && <View style={[s.dot, { backgroundColor: C.tint }]} />}
                    {n.is_pinned && <Feather name="bookmark" size={13} color={C.tint} />}
                  </View>
                </View>
                <Text style={[s.title, { color: C.text }]}>{n.title}</Text>
                {isExpanded
                  ? <Text style={[s.content, { color: C.textSecondary }]}>{n.content}</Text>
                  : <Text style={[s.contentPreview, { color: C.textSecondary }]} numberOfLines={2}>{n.content}</Text>
                }
                <View style={s.cardBottom}>
                  <Text style={[s.meta, { color: C.textMuted }]}>{n.author_name} · {fmtDate(n.created_at)}</Text>
                  <Text style={[s.expandHint, { color: C.tint }]}>{isExpanded ? "접기" : "펼치기"}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  filterRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 20,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F6F3F1",
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: "#E9E2DD", backgroundColor: "#fff",
  },
  chipTxt: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: {
    borderRadius: 16, padding: 14, gap: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardUnread: { borderLeftWidth: 3, borderLeftColor: C.tint },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  content: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  contentPreview: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  expandHint: { fontSize: 12, fontFamily: "Inter_500Medium" },
  emptyBox: { borderRadius: 16, padding: 40, alignItems: "center", gap: 8, marginTop: 20 },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
