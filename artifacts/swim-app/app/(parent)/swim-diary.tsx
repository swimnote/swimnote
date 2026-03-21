/**
 * (parent)/swim-diary.tsx — 학부모용 수영일지 (v2)
 *
 * 새 구조: lesson_date, common_content, teacher_name, is_edited
 *          student_note: { note_content, is_edited }
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

interface StudentNote {
  id: string;
  note_content: string;
  is_edited: boolean;
}

interface DiaryEntry {
  id: string;
  lesson_date: string;
  common_content: string;
  teacher_name: string;
  is_edited: boolean;
  created_at: string;
  student_note?: StudentNote | null;
}

function parseLessonDate(dateStr: string) {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: weekdays[d.getDay()],
    year: d.getFullYear(),
  };
}

function DiaryCard({ entry, defaultOpen }: { entry: DiaryEntry; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { month, day, weekday, year } = parseLessonDate(entry.lesson_date);
  const isCurrentYear = year === new Date().getFullYear();

  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      <Pressable onPress={() => setOpen(o => !o)} style={s.cardHeader}>
        {/* 날짜 배지 */}
        <View style={[s.dateBadge, { backgroundColor: C.tint }]}>
          <Text style={s.dateMonth}>{month}월</Text>
          <Text style={s.dateDay}>{day}</Text>
          <Text style={s.dateWeekday}>{weekday}</Text>
        </View>

        {/* 메타 */}
        <View style={s.cardMeta}>
          <View style={s.cardMetaRow}>
            <Text style={[s.cardTeacher, { color: C.text }]}>{entry.teacher_name} 선생님</Text>
            {entry.is_edited && (
              <View style={s.editedBadge}>
                <Text style={s.editedBadgeText}>수정됨</Text>
              </View>
            )}
            {entry.student_note && (
              <View style={[s.editedBadge, { backgroundColor: "#EDE9FE" }]}>
                <Feather name="user" size={9} color="#7C3AED" />
                <Text style={[s.editedBadgeText, { color: "#7C3AED" }]}>개별 일지</Text>
              </View>
            )}
          </View>
          <Text style={[s.cardPreview, { color: C.textMuted }]} numberOfLines={open ? undefined : 1}>
            {!isCurrentYear && `${year}년 · `}{entry.common_content}
          </Text>
        </View>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={s.cardBody}>
          <View style={[s.divider, { backgroundColor: C.border }]} />

          {/* 공통 일지 */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={[s.dot, { backgroundColor: C.tint }]} />
              <Text style={[s.sectionLabel, { color: C.tint }]}>수업 내용</Text>
            </View>
            <Text style={[s.sectionValue, { color: C.text }]}>{entry.common_content}</Text>
          </View>

          {/* 개별 추가 일지 */}
          {entry.student_note?.note_content && (
            <View style={[s.noteBox, { backgroundColor: "#F5F3FF", borderColor: "#DDD6FE" }]}>
              <View style={s.sectionHeader}>
                <Feather name="user" size={12} color="#7C3AED" />
                <Text style={s.noteTitle}>우리 아이 개별 일지</Text>
                {entry.student_note.is_edited && (
                  <View style={[s.editedBadge, { backgroundColor: "#EDE9FE" }]}>
                    <Text style={[s.editedBadgeText, { color: "#7C3AED" }]}>수정됨</Text>
                  </View>
                )}
              </View>
              <Text style={[s.sectionValue, { color: "#374151" }]}>{entry.student_note.note_content}</Text>
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
      const res = await apiRequest(token, `/parent/students/${id}/diary`);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : []);
      }
    } catch { setEntries([]); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchEntries(); }, [id]);

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title={`${name} 수업 일지`} showHome={false} homePath="/(parent)/children" />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 100, paddingTop: 8, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEntries(); }} />}
        >
          {entries.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>📒</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 수업 일지가 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>
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

const s = StyleSheet.create({
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
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },

  dateBadge: { width: 52, borderRadius: 12, alignItems: "center", paddingVertical: 8, gap: 1, flexShrink: 0 },
  dateMonth: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.8)" },
  dateDay: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 26 },
  dateWeekday: { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },

  cardMeta: { flex: 1, gap: 4 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardTeacher: { fontSize: 14, fontFamily: "Inter_700Bold" },
  cardPreview: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  editedBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  editedBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#92400E" },

  cardBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  divider: { height: 1, marginBottom: 2 },

  section: { gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  sectionValue: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22, paddingLeft: 14 },

  noteBox: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  noteTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#7C3AED", flex: 1 },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
