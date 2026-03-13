import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Image, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface DiaryEntry {
  id: string;
  student_id: string;
  author_name: string;
  title?: string | null;
  lesson_content?: string | null;
  practice_goals?: string | null;
  good_points?: string | null;
  improve_points?: string | null;
  next_focus?: string | null;
  image_urls?: string[];
  created_at: string;
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

function photoUrl(key: string) {
  return `${API_BASE}/api/uploads/${encodeURIComponent(key)}`;
}

function Section({ icon, color, label, value }: { icon: any; color: string; label: string; value?: string | null }) {
  if (!value?.trim()) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: color }]} />
        <Text style={[styles.sectionLabel, { color }]}>{label}</Text>
      </View>
      <Text style={[styles.sectionValue, { color: C.text }]}>{value}</Text>
    </View>
  );
}

function DiaryCard({ entry, defaultOpen }: { entry: DiaryEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const images: string[] = Array.isArray(entry.image_urls) ? entry.image_urls : [];
  const d = new Date(entry.created_at);
  const dateStr = d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];

  return (
    <View style={[styles.card, { backgroundColor: C.card }]}>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.dateBadge, { backgroundColor: C.tint }]}>
            <Text style={styles.dateBadgeMonth}>{d.getMonth() + 1}월</Text>
            <Text style={styles.dateBadgeDay}>{d.getDate()}</Text>
            <Text style={styles.dateBadgeWeekday}>{weekday}</Text>
          </View>
          <View style={styles.cardMeta}>
            <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={open ? undefined : 1}>
              {entry.title || "수영 일지"}
            </Text>
            <Text style={[styles.cardAuthor, { color: C.textMuted }]}>{entry.author_name} 선생님</Text>
          </View>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={styles.cardBody}>
          <View style={[styles.divider, { backgroundColor: C.border }]} />

          <Section icon="book-open" color="#1A5CFF" label="오늘의 수업 내용" value={entry.lesson_content} />
          <Section icon="target" color="#059669" label="연습한 동작 / 목표" value={entry.practice_goals} />
          <Section icon="thumbs-up" color="#F59E0B" label="잘한 점" value={entry.good_points} />
          <Section icon="edit-2" color="#EF4444" label="보완할 점" value={entry.improve_points} />
          <Section icon="arrow-right-circle" color="#7C3AED" label="다음 수업 포인트" value={entry.next_focus} />

          {images.length > 0 && (
            <View style={styles.imagesBlock}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: C.textSecondary }]} />
                <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>수업 사진</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {images.map((key, i) => (
                  <Image
                    key={i}
                    source={{ uri: photoUrl(key) }}
                    style={styles.diaryImage}
                    resizeMode="cover"
                  />
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function SwimDiaryScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchEntries() {
    try {
      const res = await apiRequest(token, `/students/${id}/diary`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : []);
      }
    } catch { setEntries([]); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchEntries(); }, [id]);

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>{name} 수영 일지</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} /> : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEntries(); }} />}
        >
          {entries.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>📒</Text>
              <Text style={[styles.emptyTitle, { color: C.text }]}>아직 수영 일지가 없습니다</Text>
              <Text style={[styles.emptySub, { color: C.textSecondary }]}>
                선생님이 수업 후 일지를 작성하면{"\n"}여기에서 확인하실 수 있습니다
              </Text>
            </View>
          ) : (
            entries.map((e, i) => <DiaryCard key={e.id} entry={e} defaultOpen={i === 0} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  card: {
    borderRadius: 18, overflow: "hidden",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3, shadowColor: "#00000014",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
  cardHeaderLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  dateBadge: {
    width: 52, borderRadius: 12, alignItems: "center", paddingVertical: 8, gap: 1,
  },
  dateBadgeMonth: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)" },
  dateBadgeDay: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 26 },
  dateBadgeWeekday: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },
  cardMeta: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardAuthor: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  divider: { height: 1, marginBottom: 4 },
  section: { gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  sectionValue: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, paddingLeft: 14 },
  imagesBlock: { gap: 8 },
  diaryImage: { width: 160, height: 120, borderRadius: 10 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
