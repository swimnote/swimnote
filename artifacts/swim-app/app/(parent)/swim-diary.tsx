/**
 * (parent)/swim-diary.tsx — 학부모용 수영일지 (v4)
 *
 * 변경: 보강 반 일지 표시(is_makeup_diary), 공통/개인 사진 표시
 */
import { BookOpen, User, Calendar, Images } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth, API_BASE } from "@/context/AuthContext";

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
  class_group_name?: string | null;
  is_makeup_diary?: boolean;
  student_note?: StudentNote | null;
}

interface PhotoItem {
  id: string;
  file_url: string;
  caption?: string | null;
  student_note_id?: string | null;
}

function parseLessonDate(dateStr: string) {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: weekdays[d.getDay()],
    year: d.getFullYear(),
    weekYear: getWeekKey(d),
  };
}

function getWeekKey(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return `${mon.getFullYear()}-W${String(mon.getMonth() + 1).padStart(2, "0")}${String(mon.getDate()).padStart(2, "0")}`;
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d);
  mon.setDate(diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
  return `${fmt(mon)} ~ ${fmt(sun)}`;
}

function PhotoGrid({ photos, token }: { photos: PhotoItem[]; token: string }) {
  if (!photos.length) return null;
  return (
    <View style={s.photoGrid}>
      {photos.map(p => (
        <ExpoImage
          key={p.id}
          source={{ uri: `${API_BASE}${p.file_url}`, headers: { Authorization: `Bearer ${token}` } }}
          style={s.photoItem}
          contentFit="cover"
          transition={200}
        />
      ))}
    </View>
  );
}

function DiaryCard({ entry, defaultOpen, token }: { entry: DiaryEntry; defaultOpen?: boolean; token: string }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [photos, setPhotos] = useState<{ common: PhotoItem[]; individual: PhotoItem[] } | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const { month, day, weekday, year } = parseLessonDate(entry.lesson_date);
  const isCurrentYear = year === new Date().getFullYear();

  async function loadPhotos() {
    if (photos !== null || photoLoading) return;
    setPhotoLoading(true);
    try {
      const r = await apiRequest(token, `/parent/diary/${entry.id}/photos`);
      if (r.ok) {
        const data = await r.json();
        setPhotos({ common: data.common || [], individual: data.individual || [] });
      }
    } catch { } finally { setPhotoLoading(false); }
  }

  function handleOpen() {
    const next = !open;
    setOpen(next);
    if (next) loadPhotos();
  }

  const hasPhotos = photos && (photos.common.length + photos.individual.length) > 0;
  const totalPhotoCount = (photos?.common.length ?? 0) + (photos?.individual.length ?? 0);

  return (
    <View style={[s.card, { backgroundColor: C.card }]}>
      <Pressable onPress={handleOpen} style={s.cardHeader}>
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
            {entry.is_makeup_diary && (
              <View style={[s.editedBadge, { backgroundColor: "#DBEAFE" }]}>
                <Text style={[s.editedBadgeText, { color: "#1D4ED8" }]}>보강</Text>
              </View>
            )}
            {entry.is_edited && (
              <View style={s.editedBadge}>
                <Text style={s.editedBadgeText}>수정됨</Text>
              </View>
            )}
            {entry.student_note && (
              <View style={[s.editedBadge, { backgroundColor: "#EEDDF5" }]}>
                <User size={9} color="#7C3AED" />
                <Text style={[s.editedBadgeText, { color: "#7C3AED" }]}>개별 일지</Text>
              </View>
            )}
          </View>
          <Text style={[s.cardPreview, { color: C.textMuted }]} numberOfLines={open ? undefined : 1}>
            {!isCurrentYear && `${year}년 · `}
            {entry.class_group_name ? `[${entry.class_group_name}] ` : ""}
            {entry.common_content || (entry.student_note?.note_content ? "개별 메모 있음" : "")}
          </Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={s.cardBody}>
          <View style={[s.divider, { backgroundColor: C.border }]} />

          {/* 공통 일지 */}
          {entry.common_content ? (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <View style={[s.dot, { backgroundColor: C.tint }]} />
                <Text style={[s.sectionLabel, { color: C.tint }]}>수업 내용</Text>
              </View>
              <Text style={[s.sectionValue, { color: C.text }]}>{entry.common_content}</Text>
            </View>
          ) : null}

          {/* 개별 추가 일지 */}
          {entry.student_note?.note_content && (
            <>
              {entry.common_content ? (
                <View style={s.noteSeparator}>
                  <View style={[s.noteSepLine, { backgroundColor: "#E9D5FF" }]} />
                  <View style={[s.noteSepBadge, { backgroundColor: "#F3E8FF" }]}>
                    <User size={10} color="#7C3AED" />
                    <Text style={s.noteSepText}>우리 아이 개별 메모</Text>
                  </View>
                  <View style={[s.noteSepLine, { backgroundColor: "#E9D5FF" }]} />
                </View>
              ) : null}
              <View style={[s.noteBox, { backgroundColor: "#EEDDF5", borderColor: "#E9D5FF" }]}>
                {!entry.common_content && (
                  <View style={s.sectionHeader}>
                    <User size={12} color="#7C3AED" />
                    <Text style={s.noteTitle}>우리 아이 개별 메모</Text>
                  </View>
                )}
                {entry.student_note.is_edited && (
                  <View style={[s.editedBadge, { backgroundColor: "#F3E8FF", alignSelf: "flex-start" }]}>
                    <Text style={[s.editedBadgeText, { color: "#7C3AED" }]}>수정됨</Text>
                  </View>
                )}
                <Text style={[s.sectionValue, { color: "#0F172A", paddingLeft: 0 }]}>{entry.student_note.note_content}</Text>
              </View>
            </>
          )}

          {/* 사진 섹션 */}
          {photoLoading && (
            <ActivityIndicator size="small" color={C.tint} style={{ marginTop: 4 }} />
          )}
          {!photoLoading && photos !== null && (
            <>
              {/* 공통 사진 */}
              {photos.common.length > 0 && (
                <View style={s.photoSection}>
                  <View style={s.sectionHeader}>
                    <Images size={13} color={C.tint} />
                    <Text style={[s.sectionLabel, { color: C.tint }]}>수업 사진</Text>
                  </View>
                  <PhotoGrid photos={photos.common} token={token} />
                </View>
              )}
              {/* 개인 사진 */}
              {photos.individual.length > 0 && (
                <View style={s.photoSection}>
                  <View style={s.sectionHeader}>
                    <User size={13} color="#7C3AED" />
                    <Text style={[s.sectionLabel, { color: "#7C3AED" }]}>우리 아이 사진</Text>
                  </View>
                  <PhotoGrid photos={photos.individual} token={token} />
                </View>
              )}
              {photos.common.length === 0 && photos.individual.length === 0 && (
                <Text style={[s.noPhoto, { color: C.textMuted }]}>첨부 사진이 없습니다</Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

function WeekHeader({ label }: { label: string }) {
  return (
    <View style={s.weekHeader}>
      <View style={[s.weekLine, { backgroundColor: C.border }]} />
      <View style={[s.weekBadge, { backgroundColor: C.card, borderColor: C.border }]}>
        <Calendar size={11} color={C.textMuted} />
        <Text style={[s.weekLabel, { color: C.textMuted }]}>{label}</Text>
      </View>
      <View style={[s.weekLine, { backgroundColor: C.border }]} />
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

  const grouped: { weekKey: string; weekLabel: string; items: DiaryEntry[] }[] = [];
  for (const entry of entries) {
    const { weekYear } = parseLessonDate(entry.lesson_date);
    const weekLabel = getWeekLabel(entry.lesson_date);
    const last = grouped[grouped.length - 1];
    if (last && last.weekKey === weekYear) {
      last.items.push(entry);
    } else {
      grouped.push({ weekKey: weekYear, weekLabel, items: [entry] });
    }
  }

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
              <BookOpen size={44} color={C.textMuted} />
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 수업 일지가 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>
                선생님이 수업 후 일지를 작성하면{"\n"}여기에서 확인하실 수 있습니다
              </Text>
            </View>
          ) : (
            grouped.map((group, gi) => (
              <View key={group.weekKey} style={{ gap: 12 }}>
                <WeekHeader label={group.weekLabel} />
                {group.items.map((e, i) => (
                  <DiaryCard key={e.id} entry={e} defaultOpen={gi === 0 && i === 0} token={token} />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  card: {
    borderRadius: 18, overflow: "hidden",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 3, shadowColor: "#00000014",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },

  dateBadge: { width: 52, borderRadius: 12, alignItems: "center", paddingVertical: 8, gap: 1, flexShrink: 0 },
  dateMonth: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },
  dateDay: { fontSize: 22, fontFamily: "Pretendard-Regular", color: "#fff", lineHeight: 26 },
  dateWeekday: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },

  cardMeta: { flex: 1, gap: 4 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  cardTeacher: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  cardPreview: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },

  editedBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FFF1BF", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  editedBadgeText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#92400E" },

  cardBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  divider: { height: 1, marginBottom: 2 },

  section: { gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", textTransform: "uppercase" },
  sectionValue: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22, paddingLeft: 14 },

  noteSeparator: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 2 },
  noteSepLine: { flex: 1, height: 1 },
  noteSepBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: "#E9D5FF" },
  noteSepText: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#7C3AED" },

  noteBox: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  noteTitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED", flex: 1 },

  photoSection: { gap: 8 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  photoItem: { width: 100, height: 100, borderRadius: 10, backgroundColor: C.border },
  noPhoto: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", paddingVertical: 4 },

  weekHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  weekLine: { flex: 1, height: 1 },
  weekBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  weekLabel: { fontSize: 11, fontFamily: "Pretendard-Regular" },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
});
