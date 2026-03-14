import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Image, Linking, Modal,
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface MediaItem {
  key: string;
  type: "image" | "video";
}

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
  media_items?: MediaItem[];
  created_at: string;
}

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";
const { width: SCREEN_W } = Dimensions.get("window");

function mediaUrl(key: string) {
  return `${API_BASE}/api/uploads/${encodeURIComponent(key)}`;
}

function Section({ label, color, value }: { label: string; color: string; value?: string | null }) {
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

function MediaGrid({ items, legacyUrls }: { items: MediaItem[]; legacyUrls: string[] }) {
  const [lightboxUri, setLightboxUri] = useState<string | null>(null);

  const allMedia: MediaItem[] = [
    ...items,
    ...legacyUrls.map(url => ({ key: url, type: "image" as const })),
  ];

  if (allMedia.length === 0) return null;

  return (
    <>
      <View style={styles.mediaSection}>
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: "#6366F1" }]} />
          <Text style={[styles.sectionLabel, { color: "#6366F1" }]}>수업 사진 · 영상</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
          {allMedia.map((m, i) => (
            <Pressable
              key={i}
              style={styles.mediaTile}
              onPress={() => {
                if (m.type === "video") {
                  Linking.openURL(mediaUrl(m.key)).catch(() => {});
                } else {
                  setLightboxUri(mediaUrl(m.key));
                }
              }}
            >
              {m.type === "image" ? (
                <Image source={{ uri: mediaUrl(m.key) }} style={styles.mediaImg} resizeMode="cover" />
              ) : (
                <View style={[styles.mediaImg, styles.videoTile]}>
                  <View style={styles.playIcon}>
                    <Feather name="play" size={22} color="#fff" />
                  </View>
                  <Text style={styles.videoLabel}>영상</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* 이미지 전체화면 */}
      <Modal visible={!!lightboxUri} transparent animationType="fade" onRequestClose={() => setLightboxUri(null)}>
        <Pressable style={styles.lightboxBg} onPress={() => setLightboxUri(null)}>
          {lightboxUri && (
            <Image
              source={{ uri: lightboxUri }}
              style={styles.lightboxImg}
              resizeMode="contain"
            />
          )}
          <Pressable style={styles.lightboxClose} onPress={() => setLightboxUri(null)}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function DiaryCard({ entry, defaultOpen }: { entry: DiaryEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const media: MediaItem[] = Array.isArray(entry.media_items) ? entry.media_items : [];
  const legacyUrls: string[] = Array.isArray(entry.image_urls) ? entry.image_urls : [];
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
              {entry.title || "수업 일지"}
            </Text>
            <View style={styles.cardSubRow}>
              <Text style={[styles.cardAuthor, { color: C.textMuted }]}>{entry.author_name} 선생님</Text>
              {(media.length > 0 || legacyUrls.length > 0) && (
                <View style={styles.mediaBadge}>
                  <Feather name="image" size={10} color="#6366F1" />
                  <Text style={styles.mediaBadgeText}>{media.length + legacyUrls.length}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={styles.cardBody}>
          <View style={[styles.divider, { backgroundColor: C.border }]} />

          <Section color="#1A5CFF" label="오늘의 수업 내용" value={entry.lesson_content} />
          <Section color="#059669" label="연습한 동작 / 목표" value={entry.practice_goals} />
          <Section color="#F59E0B" label="잘한 점" value={entry.good_points} />
          <Section color="#EF4444" label="보완할 점" value={entry.improve_points} />
          <Section color="#7C3AED" label="다음 수업 포인트" value={entry.next_focus} />

          <MediaGrid items={media} legacyUrls={legacyUrls} />
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
  root:   { flex: 1 },
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
  dateBadge: { width: 52, borderRadius: 12, alignItems: "center", paddingVertical: 8, gap: 1 },
  dateBadgeMonth: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)" },
  dateBadgeDay: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 26 },
  dateBadgeWeekday: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },
  cardMeta: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  cardSubRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardAuthor: { fontSize: 12, fontFamily: "Inter_400Regular" },
  mediaBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#EEF2FF", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  mediaBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#6366F1" },

  cardBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  divider: { height: 1, marginBottom: 4 },

  section: { gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  sectionValue: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, paddingLeft: 14 },

  mediaSection: { gap: 8 },
  mediaRow:     { gap: 10, paddingVertical: 4 },
  mediaTile:    { width: 120, height: 100, borderRadius: 10, overflow: "hidden" },
  mediaImg:     { width: 120, height: 100 },
  videoTile:    { backgroundColor: "#1F2937", alignItems: "center", justifyContent: "center", gap: 6 },
  playIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  videoLabel:   { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },

  lightboxBg:   { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  lightboxImg:  { width: SCREEN_W, height: SCREEN_W * 1.2 },
  lightboxClose:{ position: "absolute", top: 50, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
