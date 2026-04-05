/**
 * 학부모 수업일지 — 수업 피드백 리스트
 * - 날짜, 선생님, 내용 미리보기, 개별코멘트 표시
 * - 항목 클릭 시 펼치기/접기
 * - 쪽지달기 → messages.tsx 페이지로 이동 (Modal 제거)
 */
import { CircleCheck, Mail, User } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";
import DiaryPhotoStrip from "@/components/common/DiaryPhotoStrip";

const C = Colors.light;

interface StudentNote { id: string; note_content: string; is_edited: boolean; }
interface DiaryEntry {
  id: string; lesson_date: string; common_content: string;
  teacher_name: string; class_group_id?: string | null; class_group_name?: string | null;
  is_edited: boolean; created_at: string;
  student_note?: StudentNote | null;
  reactions?: string[];
}

function parseLessonDate(d: string) {
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  const wd = ["일", "월", "화", "수", "목", "금", "토"];
  return { month: dt.getMonth() + 1, day: dt.getDate(), weekday: wd[dt.getDay()] };
}

function Toast({ msg, visible }: { msg: string; visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={ts.toast} pointerEvents="none">
      <CircleCheck size={14} color="#fff" />
      <Text style={ts.toastTxt}>{msg}</Text>
    </View>
  );
}

function DiaryCard({ entry, studentId, studentName }: { entry: DiaryEntry; studentId: string; studentName: string }) {
  const { token } = useAuth();
  const [showPhotos, setShowPhotos] = useState(false);
  const [open, setOpen] = useState(false);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set(entry.reactions ?? []));
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    apiRequest(token, `/parent/diary/${entry.id}/reactions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.myReactions) setMyReactions(new Set(d.myReactions)); })
      .catch(() => {});
  }, [entry.id]);

  useEffect(() => {
    if (open && entry.class_group_id) setShowPhotos(true);
  }, [open, entry.class_group_id]);

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1800);
  }

  async function toggleReaction(type: "like" | "thank") {
    const res = await apiRequest(token, `/parent/diary/${entry.id}/reactions`, {
      method: "POST", body: JSON.stringify({ reaction_type: type }),
    });
    if (res.ok) {
      const data = await res.json();
      setMyReactions(prev => {
        const s = new Set(prev);
        data.active ? s.add(type) : s.delete(type);
        return s;
      });
      showToast(data.active ? (type === "like" ? "좋아요를 눌렀어요" : "감사합니다를 눌렀어요") : "취소했습니다");
    }
  }

  function goToMessages() {
    router.push({
      pathname: "/(parent)/messages" as any,
      params: {
        diaryId: entry.id,
        diaryDate: entry.lesson_date,
        teacherName: entry.teacher_name,
        studentName,
      },
    });
  }

  const { month, day, weekday } = parseLessonDate(entry.lesson_date);

  return (
    <View style={[ds.card, { backgroundColor: C.card }]}>
      <Pressable onPress={() => setOpen(o => !o)} style={ds.cardHeader}>
        <View style={[ds.dateBadge, { backgroundColor: C.tint }]}>
          <Text style={ds.dateMonth}>{month}월</Text>
          <Text style={ds.dateDay}>{day}</Text>
          <Text style={ds.dateWeekday}>{weekday}</Text>
        </View>
        <View style={ds.cardMeta}>
          <View style={ds.metaRow}>
            <Text style={[ds.teacher, { color: C.text }]}>{entry.teacher_name} 선생님</Text>
            {entry.class_group_name && (
              <View style={[ds.badge, { backgroundColor: "#E6FFFA" }]}>
                <Text style={[ds.badgeTxt, { color: "#2EC4B6" }]}>{entry.class_group_name}</Text>
              </View>
            )}
            {entry.student_note && (
              <View style={[ds.badge, { backgroundColor: "#EEDDF5" }]}>
                <User size={9} color="#7C3AED" />
                <Text style={[ds.badgeTxt, { color: "#7C3AED" }]}>개별 일지</Text>
              </View>
            )}
            {entry.is_edited && (
              <View style={[ds.badge, { backgroundColor: "#FFFFFF" }]}>
                <Text style={[ds.badgeTxt, { color: C.textMuted }]}>수정됨</Text>
              </View>
            )}
          </View>
          <Text style={[ds.preview, { color: C.textMuted }]} numberOfLines={2}>{entry.common_content}</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={ds.body}>
          <View style={[ds.divider, { backgroundColor: C.border }]} />
          <View style={ds.section}>
            <View style={[ds.dot, { backgroundColor: C.tint }]} />
            <Text style={[ds.sectionLabel, { color: C.tint }]}>수업 내용</Text>
          </View>
          <Text style={[ds.content, { color: C.text }]}>{entry.common_content}</Text>

          {showPhotos && entry.class_group_id ? (
            <DiaryPhotoStrip
              token={token}
              classGroupId={entry.class_group_id}
              lessonDate={entry.lesson_date}
            />
          ) : null}

          {entry.student_note?.note_content ? (
            <View style={[ds.noteBox, { backgroundColor: "#EEDDF5", borderColor: "#E6FAF8" }]}>
              <View style={ds.section}>
                <User size={12} color="#7C3AED" />
                <Text style={ds.noteTitle}>우리 아이 개별 일지</Text>
              </View>
              <Text style={[ds.content, { color: "#0F172A" }]}>{entry.student_note.note_content}</Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 반응 + 쪽지달기 */}
      <View style={[ds.reactions, { borderTopColor: C.border }]}>
        <Pressable
          onPress={() => toggleReaction("like")}
          style={[ds.reactionBtn, myReactions.has("like") && { backgroundColor: "#E6FFFA" }]}
        >
          <Text style={[ds.reactionEmoji, myReactions.has("like") && { transform: [{ scale: 1.2 }] }]}>👍</Text>
          <Text style={[ds.reactionLabel, { color: myReactions.has("like") ? "#2EC4B6" : C.textSecondary }]}>좋아요</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleReaction("thank")}
          style={[ds.reactionBtn, myReactions.has("thank") && { backgroundColor: "#F6D8E1" }]}
        >
          <Text style={[ds.reactionEmoji, myReactions.has("thank") && { transform: [{ scale: 1.2 }] }]}>🙏</Text>
          <Text style={[ds.reactionLabel, { color: myReactions.has("thank") ? "#BE185D" : C.textSecondary }]}>감사합니다</Text>
        </Pressable>
        <Pressable onPress={goToMessages} style={ds.reactionBtn}>
          <Mail size={17} color={C.textSecondary} />
          <Text style={[ds.reactionLabel, { color: C.textSecondary }]}>쪽지달기</Text>
        </Pressable>
      </View>

      <Toast msg={toast} visible={toastVisible} />
    </View>
  );
}

export default function ParentDiaryScreen() {
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!selectedStudent?.id) { setLoading(false); return; }
    try {
      const res = await apiRequest(token, `/parent/students/${selectedStudent.id}/diary`);
      if (res.ok) setEntries(await res.json());
      apiRequest(token, `/parent/students/${selectedStudent.id}/mark-diary-read`, { method: "POST" }).catch(() => {});
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, selectedStudent?.id]);

  useEffect(() => { setLoading(true); fetchEntries(); }, [fetchEntries]);

  return (
    <View style={[ds.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader
        title="수업일지"
        subtitle={selectedStudent ? `${selectedStudent.name}` : undefined}
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : !selectedStudent ? (
        <View style={ds.empty}>
          <Text style={ds.emptyEmoji}>👶</Text>
          <Text style={[ds.emptyTitle, { color: C.text }]}>자녀를 선택해주세요</Text>
          <Text style={[ds.emptySub, { color: C.textSecondary }]}>홈 화면에서 자녀를 선택하세요</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEntries(); }} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8, gap: 12 }}
        >
          {entries.length === 0 ? (
            <View style={ds.empty}>
              <Text style={ds.emptyEmoji}>📒</Text>
              <Text style={[ds.emptyTitle, { color: C.text }]}>아직 수업 일지가 없습니다</Text>
              <Text style={[ds.emptySub, { color: C.textSecondary }]}>선생님이 수업 후 일지를 작성하면{"\n"}여기에서 확인하실 수 있습니다</Text>
            </View>
          ) : (
            entries.map(e => (
              <DiaryCard
                key={e.id}
                entry={e}
                studentId={selectedStudent.id}
                studentName={selectedStudent.name}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const ds = StyleSheet.create({
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
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  teacher: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  preview: { fontSize: 12, fontFamily: "Pretendard-Regular", lineHeight: 18 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  divider: { height: 1, marginBottom: 4 },
  section: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", textTransform: "uppercase" },
  content: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22, paddingLeft: 14 },
  noteBox: { borderRadius: 12, borderWidth: 1.5, padding: 12, gap: 8 },
  noteTitle: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "#7C3AED", flex: 1 },
  reactions: { flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  reactionBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, gap: 3, flexDirection: "row", justifyContent: "center" },
  reactionEmoji: { fontSize: 16 },
  reactionLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
});

const ts = StyleSheet.create({
  toast: {
    position: "absolute", bottom: 80, alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6, zIndex: 999,
  },
  toastTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
});
