/**
 * 학부모 수업일지 — 수업 피드백 리스트
 * - FlatList로 수백개 일지도 부드럽게 스크롤
 * - 날짜, 선생님, 내용 미리보기, 개별코멘트 표시
 * - 항목 클릭 시 펼치기/접기
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { useMode } from "@/context/ModeContext";
import { X as XT, isXMode } from "@/constants/xTheme";
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
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <View style={[ts.toast, { bottom: insets.bottom + 46 }]} pointerEvents="none">
      <LucideIcon name="check-circle" size={14} color="#fff" />
      <Text style={ts.toastTxt}>{msg}</Text>
    </View>
  );
}

function DiaryCard({ entry, studentId, studentName, classGroupId, initialOpen }: {
  entry: DiaryEntry; studentId: string; studentName: string; classGroupId?: string | null; initialOpen?: boolean;
}) {
  const { token } = useAuth();
  const effectiveClassGroupId = classGroupId ?? entry.class_group_id;
  const [open, setOpen] = useState(initialOpen ?? false);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set(entry.reactions ?? []));
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    apiRequest(token, `/parent/diary/${entry.id}/reactions`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.myReactions) setMyReactions(new Set(d.myReactions)); })
      .catch(() => {});
  }, [entry.id]);

  function showToast(msg: string) {
    setToast(msg); setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1800);
  }

  async function toggleReaction(type: "like") {
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
      showToast(data.active ? "좋아요를 눌렀어요" : "취소했습니다");
    }
  }

  function goToComments() {
    router.push({
      pathname: "/(parent)/diary-comments" as any,
      params: {
        diaryId: entry.id,
        diaryDate: entry.lesson_date,
        teacherName: entry.teacher_name,
        studentId,
        studentName,
      },
    });
  }

  const { month, day, weekday } = parseLessonDate(entry.lesson_date);

  return (
    <View style={[ds.card, { backgroundColor: C.card }]}>
      <Pressable onPress={() => setOpen(o => !o)} style={ds.cardHeader}>
        <View style={[ds.dateBadge, { backgroundColor: C.brandStrong }]}>
          <Text style={ds.dateMonth}>{month}월</Text>
          <Text style={ds.dateDay}>{day}</Text>
          <Text style={ds.dateWeekday}>{weekday}</Text>
        </View>
        <View style={ds.cardMeta}>
          <View style={ds.metaRow}>
            <Text style={[ds.teacher, { color: C.text }]}>{entry.teacher_name} 선생님</Text>
            {entry.class_group_name && (
              <View style={[ds.badge, { backgroundColor: C.brandMist }]}>
                <Text style={[ds.badgeTxt, { color: C.brandStrong }]}>{entry.class_group_name}</Text>
              </View>
            )}
            {entry.is_edited && (
              <View style={[ds.badge, { backgroundColor: C.surface }]}>
                <Text style={[ds.badgeTxt, { color: C.textMuted }]}>수정됨</Text>
              </View>
            )}
          </View>
          <Text style={[ds.preview, { color: C.textMuted }]} numberOfLines={2}>{entry.common_content?.trim() || entry.student_note?.note_content?.trim() || ""}</Text>
        </View>
        <LucideIcon name={open ? "chevron-up" : "chevron-down"} size={18} color={C.textMuted} />
      </Pressable>

      {open && (
        <View style={ds.body}>
          <View style={[ds.divider, { backgroundColor: C.border }]} />

          {entry.common_content?.trim() ? (
            <>
              <View style={ds.section}>
                <View style={[ds.dot, { backgroundColor: C.brandStrong }]} />
                <Text style={[ds.sectionLabel, { color: C.brandStrong }]}>수업 내용</Text>
              </View>
              <Text style={[ds.content, { color: C.text }]}>{entry.common_content}</Text>
            </>
          ) : null}

          {entry.student_note?.note_content?.trim() ? (
            <Text style={[ds.content, { color: C.text }]}>{entry.student_note.note_content}</Text>
          ) : null}

          {effectiveClassGroupId ? (
            <DiaryPhotoStrip
              token={token}
              classGroupId={effectiveClassGroupId}
              lessonDate={entry.lesson_date.slice(0, 10)}
              diaryId={entry.id}
              studentId={studentId}
              parentMode={true}
            />
          ) : null}
        </View>
      )}

      {/* 반응 */}
      <View style={[ds.reactions, { borderTopColor: C.border }]}>
        <Pressable onPress={() => toggleReaction("like")} style={ds.reactionBtn}>
          <LucideIcon
            name="heart"
            size={20}
            color={myReactions.has("like") ? "#E8003D" : "#6B7280"}
            fill={myReactions.has("like") ? "#E8003D" : "none"}
          />
        </Pressable>
        <Pressable onPress={goToComments} style={ds.reactionBtn}>
          <LucideIcon name="message-circle" size={18} color="#6B7280" />
        </Pressable>
      </View>

      <Toast msg={toast} visible={toastVisible} />
    </View>
  );
}

export default function ParentDiaryScreen() {
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const { mode } = useMode();
  const isX = isXMode(mode);
  const { diary_id: highlightId } = useLocalSearchParams<{ diary_id: string }>();
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList>(null);

  // API 응답에는 GROWTH_REPORT 아이템이 섞여 있음 — DiaryCard 렌더 불가, 필터 필수
  const diaryOnly = (items: any[]): DiaryEntry[] =>
    items.filter((item) => item.type !== "GROWTH_REPORT" && typeof item.lesson_date === "string");

  const fetchEntries = useCallback(async () => {
    const sid = selectedStudent?.id;
    if (!sid) { setLoading(false); return; }
    let hasCached = false;
    try {
      const raw = await AsyncStorage.getItem(`@sn:parent_diary_${sid}`);
      if (raw) { setEntries(diaryOnly(JSON.parse(raw))); hasCached = true; setLoading(false); }
    } catch {}
    if (!hasCached) setLoading(true);
    try {
      const res = await apiRequest(token, `/parent/students/${sid}/diary`);
      if (res.ok) {
        const data = await res.json();
        setEntries(diaryOnly(Array.isArray(data) ? data : []));
        AsyncStorage.setItem(`@sn:parent_diary_${sid}`, JSON.stringify(data)).catch(() => {});
      }
      apiRequest(token, `/parent/students/${sid}/mark-diary-read`, { method: "POST" }).catch(() => {});
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, selectedStudent?.id]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // diary_id가 전달됐지만 목록에 없을 때 오류 상태 (빈 목록 포함)
  const diaryNotFound = !!highlightId && !loading && !refreshing
    && !entries.find(e => e.id === highlightId);

  // 하이라이트 항목 스크롤
  useEffect(() => {
    if (!highlightId || entries.length === 0) return;
    const idx = entries.findIndex(e => e.id === highlightId);
    if (idx > 0) {
      setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true, viewOffset: 8 }), 400);
    }
  }, [highlightId, entries]);

  const renderItem = useCallback(({ item }: { item: DiaryEntry }) => (
    <DiaryCard
      entry={item}
      studentId={selectedStudent?.id ?? ""}
      studentName={selectedStudent?.name ?? ""}
      classGroupId={selectedStudent?.class_group_id}
      initialOpen={!!highlightId && item.id === highlightId}
    />
  ), [selectedStudent, highlightId]);

  const keyExtractor = useCallback((item: DiaryEntry) => item.id, []);

  return (
    <View style={[ds.root, { backgroundColor: isX ? XT.background : C.background }]}>
      <ParentScreenHeader
        title="수업일지"
        subtitle={selectedStudent ? `${selectedStudent.name}` : undefined}
      />

      {loading ? (
        <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} />
      ) : !selectedStudent ? (
        <View style={ds.empty}>
          <LucideIcon name="user-round" size={44} color={C.textMuted} />
          <Text style={[ds.emptyTitle, { color: C.text }]}>자녀를 선택해주세요</Text>
          <Text style={[ds.emptySub, { color: C.textSecondary }]}>홈 화면에서 자녀를 선택하세요</Text>
          <Pressable
            onPress={() => router.push("/(parent)/home" as any)}
            style={ds.homeBtn}
          >
            <Text style={ds.homeBtnTxt}>홈으로 가기</Text>
          </Pressable>
        </View>
      ) : diaryNotFound ? (
        <View style={ds.empty}>
          <LucideIcon name="book-open" size={44} color={C.textMuted} />
          <Text style={[ds.emptyTitle, { color: C.text }]}>일지를 찾을 수 없습니다</Text>
          <Text style={[ds.emptySub, { color: C.textSecondary }]}>요청한 수업일지가 목록에 없습니다{"\n"}아래로 당겨 새로고침해 주세요</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={ds.empty}>
          <LucideIcon name="book-open" size={44} color={C.textMuted} />
          <Text style={[ds.emptyTitle, { color: C.text }]}>아직 수업 일지가 없습니다</Text>
          <Text style={[ds.emptySub, { color: C.textSecondary }]}>선생님이 수업 후 일지를 작성하면{"\n"}여기에서 확인하실 수 있습니다</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEntries(); }} />
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={15}
          initialNumToRender={10}
          onScrollToIndexFailed={() => {}}
        />
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
  reactions: { flexDirection: "row", borderTopWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
  reactionBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
  homeBtn:  { marginTop: 4, paddingHorizontal: 24, paddingVertical: 10,
               backgroundColor: XT.primary, borderRadius: 12 },
  homeBtnTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
});

const ts = StyleSheet.create({
  toast: {
    position: "absolute", alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6, zIndex: 999,
  },
  toastTxt: { color: "#fff", fontSize: 13, fontFamily: "Pretendard-Regular" },
});
