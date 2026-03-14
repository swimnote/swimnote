/**
 * (teacher)/today-schedule.tsx — 오늘 스케쥴 탭
 *
 * - 시간순 수업 카드 (출결·일지·메모 상태)
 * - 개인메모 바텀시트 (텍스트 + 음성녹음)
 * - 지난 스케쥴 메모 달력 (메모 있는 날짜 표시)
 */
import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Animated, FlatList, Modal,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

interface ScheduleItem {
  id: string;
  name: string;
  schedule_time: string;
  schedule_days: string;
  level?: string | null;
  student_count: number;
  att_total: number;
  att_present: number;
  diary_done: boolean;
  has_note: boolean;
  note_text: string | null;
  audio_file_url: string | null;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month - 1, 1).getDay();
}

/* ── 달력 컴포넌트 ──────────────────────────────── */
function MiniCalendar({
  year, month, markedDates, onSelectDate, onChangeMonth,
}: {
  year: number; month: number; markedDates: string[];
  onSelectDate: (d: string) => void; onChangeMonth: (y: number, m: number) => void;
}) {
  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayStr();

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <Pressable onPress={() => { const d = new Date(year, month - 2, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={cal.title}>{year}년 {month}월</Text>
        <Pressable onPress={() => { const d = new Date(year, month, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>
      <View style={cal.dayRow}>
        {["일","월","화","수","목","금","토"].map(d => (
          <Text key={d} style={[cal.dayLabel, d === "일" && { color: "#EF4444" }, d === "토" && { color: "#3B82F6" }]}>{d}</Text>
        ))}
      </View>
      <View style={cal.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={cal.cell} />;
          const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isMarked = markedDates.includes(dateStr);
          const isToday = dateStr === today;
          return (
            <Pressable key={dateStr} style={cal.cell} onPress={() => isMarked && onSelectDate(dateStr)}>
              <View style={[cal.dayBox, isToday && cal.todayBox]}>
                <Text style={[cal.dayNum, isToday && { color: "#fff" }, !isMarked && { color: C.textMuted }]}>{day}</Text>
              </View>
              {isMarked && <View style={cal.dot} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── 개인메모 바텀시트 ──────────────────────────── */
function MemoSheet({
  visible, item, date, token, themeColor, onClose, onSaved,
}: {
  visible: boolean; item: ScheduleItem | null; date: string;
  token: string | null; themeColor: string;
  onClose: () => void; onSaved: (updated: Partial<ScheduleItem>) => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [audioKey, setAudioKey] = useState<string | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const recSecs = useRef(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recDisplay, setRecDisplay] = useState("0:00");

  useEffect(() => {
    if (visible && item) {
      setText(item.note_text || "");
      setAudioKey(item.audio_file_url || null);
      setAudioUri(null);
      setIsRecording(false);
      setRecording(null);
      setPlaying(false);
    }
  }, [visible, item]);

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
      recSecs.current = 0;
      setRecDisplay("0:00");
      recTimer.current = setInterval(() => {
        recSecs.current += 1;
        const m = Math.floor(recSecs.current / 60);
        const s = recSecs.current % 60;
        setRecDisplay(`${m}:${String(s).padStart(2, "0")}`);
      }, 1000);
    } catch (e) {
      Alert.alert("오류", "녹음을 시작할 수 없습니다.");
    }
  }

  async function stopRecording() {
    if (!recording) return;
    if (recTimer.current) clearInterval(recTimer.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    setIsRecording(false);
    setAudioUri(uri || null);
  }

  async function uploadAudio(): Promise<string | null> {
    if (!audioUri) return audioKey;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      const filename = audioUri.split("/").pop() || "audio.m4a";
      (formData as any).append("audio", { uri: audioUri, name: filename, type: "audio/m4a" } as any);
      const res = await fetch(`${API_BASE}/api/schedule-notes/audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      return data.audio_file_url || null;
    } catch {
      Alert.alert("오류", "음성 업로드에 실패했습니다.");
      return null;
    } finally {
      setUploadingAudio(false);
    }
  }

  async function playAudio() {
    const key = audioKey || (audioUri ? null : null);
    if (!key && !audioUri) return;
    if (playing) {
      await sound?.pauseAsync();
      setPlaying(false);
      return;
    }
    try {
      let playUri = audioUri;
      if (!playUri && key) {
        playUri = `${API_BASE}/api/schedule-notes/audio?key=${encodeURIComponent(key)}`;
      }
      if (!playUri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      setSound(s);
      setPlaying(true);
      s.setOnPlaybackStatusUpdate(status => {
        if ((status as any).didJustFinish) { setPlaying(false); s.unloadAsync(); setSound(null); }
      });
    } catch {
      Alert.alert("오류", "재생에 실패했습니다.");
    }
  }

  async function handleSave() {
    if (!item) return;
    setSaving(true);
    try {
      const uploadedKey = await uploadAudio();
      const res = await apiRequest(token, "/schedule-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_group_id: item.id,
          schedule_date: date,
          note_text: text.trim() || null,
          audio_file_url: uploadedKey || null,
        }),
      });
      if (res.ok) {
        onSaved({ note_text: text.trim() || null, audio_file_url: uploadedKey || null, has_note: !!(text.trim() || uploadedKey) });
        onClose();
      }
    } finally { setSaving(false); }
  }

  if (!item) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={ms.overlay} onPress={onClose} />
      <View style={ms.sheet}>
        <View style={ms.handle} />
        <View style={ms.sheetHeader}>
          <View>
            <Text style={ms.sheetTitle}>개인 메모</Text>
            <Text style={ms.sheetSub}>{item.name} · {item.schedule_time}</Text>
          </View>
          <Pressable onPress={onClose} style={ms.closeBtn}>
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
        </View>

        <TextInput
          style={[ms.textArea, { borderColor: C.border }]}
          value={text}
          onChangeText={setText}
          placeholder="수업 준비 메모, 특이사항 등 자유롭게 작성하세요..."
          placeholderTextColor={C.textMuted}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        {/* 음성 메모 */}
        <View style={[ms.audioBox, { borderColor: C.border }]}>
          <Feather name="mic" size={16} color={themeColor} />
          <Text style={[ms.audioLabel, { color: C.textSecondary }]}>음성 메모</Text>
          {isRecording ? (
            <View style={ms.recRow}>
              <View style={ms.recDot} />
              <Text style={[ms.recTime, { color: "#EF4444" }]}>{recDisplay}</Text>
              <Pressable style={[ms.recBtn, { backgroundColor: "#EF4444" }]} onPress={stopRecording}>
                <Feather name="square" size={14} color="#fff" />
                <Text style={ms.recBtnText}>중지</Text>
              </Pressable>
            </View>
          ) : (
            <View style={ms.recRow}>
              {(audioUri || audioKey) ? (
                <>
                  <Pressable style={[ms.recBtn, { backgroundColor: themeColor }]} onPress={playAudio}>
                    <Feather name={playing ? "pause" : "play"} size={14} color="#fff" />
                    <Text style={ms.recBtnText}>{playing ? "일시정지" : "재생"}</Text>
                  </Pressable>
                  <Pressable style={[ms.recBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => { setAudioUri(null); setAudioKey(null); }}>
                    <Feather name="trash-2" size={14} color={C.error} />
                    <Text style={[ms.recBtnText, { color: C.error }]}>삭제</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={[ms.recBtn, { backgroundColor: "#FEE2E2" }]} onPress={startRecording}>
                  <Feather name="mic" size={14} color="#EF4444" />
                  <Text style={[ms.recBtnText, { color: "#EF4444" }]}>녹음 시작</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <Text style={ms.privateNote}>
          <Feather name="lock" size={11} color={C.textMuted} /> 개인 메모는 선생님 본인만 볼 수 있습니다.
        </Text>

        <Pressable
          style={[ms.saveBtn, { backgroundColor: themeColor, opacity: saving || uploadingAudio ? 0.7 : 1 }]}
          onPress={handleSave}
          disabled={saving || uploadingAudio}
        >
          {saving || uploadingAudio
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={ms.saveBtnText}>저장</Text>
          }
        </Pressable>
      </View>
    </Modal>
  );
}

/* ── 지난 메모 달력 모달 ──────────────────────── */
function PastMemosModal({
  visible, token, onClose,
}: {
  visible: boolean; token: string | null; onClose: () => void;
}) {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [marked, setMarked] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [notes, setNotes]   = useState<any[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const loadDates = useCallback(async (y: number, m: number) => {
    setLoadingDates(true);
    try {
      const res = await apiRequest(token, `/schedule-notes/dates?year=${y}&month=${m}`);
      if (res.ok) setMarked(await res.json());
    } finally { setLoadingDates(false); }
  }, [token]);

  useEffect(() => { if (visible) loadDates(year, month); }, [visible, year, month]);

  const handleMonth = (y: number, m: number) => {
    setYear(y); setMonth(m); setSelectedDate(null); setNotes([]);
  };

  const handleDate = async (dateStr: string) => {
    setSelectedDate(dateStr);
    setLoadingNotes(true);
    try {
      const res = await apiRequest(token, `/schedule-notes?date=${dateStr}`);
      if (res.ok) setNotes(await res.json());
    } finally { setLoadingNotes(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }}>
        <View style={pm.header}>
          <Pressable onPress={() => { setSelectedDate(null); setNotes([]); if (!selectedDate) onClose(); }}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <Text style={pm.title}>{selectedDate ? formatDate(selectedDate) : "지난 스케쥴 메모"}</Text>
          <View style={{ width: 22 }} />
        </View>

        {selectedDate ? (
          // 날짜 선택 → 메모 목록
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {loadingNotes ? (
              <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
            ) : notes.length === 0 ? (
              <View style={pm.empty}>
                <Feather name="file-text" size={32} color={C.textMuted} />
                <Text style={pm.emptyText}>이 날짜에 메모가 없습니다.</Text>
              </View>
            ) : notes.map((note: any) => (
              <View key={note.id} style={[pm.noteCard, { backgroundColor: C.card }]}>
                <View style={pm.noteCardHeader}>
                  <Text style={pm.noteName}>{note.class_name}</Text>
                  <Text style={pm.noteTime}>{note.schedule_time}</Text>
                </View>
                {note.note_text ? (
                  <Text style={pm.noteText}>{note.note_text}</Text>
                ) : null}
                {note.audio_file_url ? (
                  <View style={pm.audioRow}>
                    <Feather name="mic" size={13} color={C.textSecondary} />
                    <Text style={pm.audioLabel}>음성 메모 있음</Text>
                  </View>
                ) : null}
                <Text style={pm.noteDate}>작성: {new Date(note.updated_at).toLocaleString("ko-KR")}</Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          // 달력
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {loadingDates && <ActivityIndicator color={C.tint} style={{ marginBottom: 8 }} />}
            <MiniCalendar
              year={year} month={month}
              markedDates={marked}
              onSelectDate={handleDate}
              onChangeMonth={handleMonth}
            />
            {marked.length === 0 && !loadingDates && (
              <View style={pm.empty}>
                <Feather name="calendar" size={32} color={C.textMuted} />
                <Text style={pm.emptyText}>이 달에 작성된 메모가 없습니다.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ── 수업 카드 ─────────────────────────────────── */
function ScheduleCard({
  item, themeColor, onMemo, onAttendance, onDiary,
}: {
  item: ScheduleItem; themeColor: string;
  onMemo: () => void; onAttendance: () => void; onDiary: () => void;
}) {
  const attDone    = item.att_total > 0 && item.att_present === item.att_total;
  const attPartial = item.att_total > 0 && item.att_present > 0 && !attDone;
  const noAtt      = item.att_total === 0;

  return (
    <View style={[card.wrap, { backgroundColor: C.card }]}>
      {/* 수업 정보 행 */}
      <View style={card.topRow}>
        <View style={[card.timeBox, { backgroundColor: themeColor + "15" }]}>
          <Text style={[card.time, { color: themeColor }]}>{item.schedule_time}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={card.name}>{item.name}</Text>
          <Text style={card.sub}>
            학생 {item.student_count}명
            {item.level ? ` · ${item.level}` : ""}
          </Text>
        </View>
        {item.has_note && (
          <View style={[card.noteBadge, { backgroundColor: "#FEF3C7" }]}>
            <Feather name="edit-3" size={10} color="#D97706" />
            <Text style={card.noteBadgeText}>메모</Text>
          </View>
        )}
      </View>

      {/* 상태 배지 행 */}
      <View style={card.statusRow}>
        <View style={[card.badge, {
          backgroundColor: attDone ? "#D1FAE5" : attPartial ? "#FEF3C7" : noAtt ? "#F3F4F6" : "#FEE2E2"
        }]}>
          <Feather
            name={attDone ? "check-circle" : "circle"}
            size={11}
            color={attDone ? "#059669" : attPartial ? "#D97706" : "#9CA3AF"}
          />
          <Text style={[card.badgeText, {
            color: attDone ? "#059669" : attPartial ? "#D97706" : "#6B7280"
          }]}>
            {noAtt ? "출결 미시작" : `출결 ${item.att_present}/${item.att_total}`}
          </Text>
        </View>

        <View style={[card.badge, { backgroundColor: item.diary_done ? "#D1FAE5" : "#FEF3C7" }]}>
          <Feather name={item.diary_done ? "check-circle" : "edit"} size={11} color={item.diary_done ? "#059669" : "#D97706"} />
          <Text style={[card.badgeText, { color: item.diary_done ? "#059669" : "#D97706" }]}>
            {item.diary_done ? "일지 완료" : "일지 미작성"}
          </Text>
        </View>
      </View>

      {/* 빠른 이동 버튼 */}
      <View style={card.btnRow}>
        <Pressable style={[card.actionBtn, { borderColor: attDone ? "#059669" : C.border }]} onPress={onAttendance}>
          <Feather name="check-square" size={14} color={attDone ? "#059669" : C.textSecondary} />
          <Text style={[card.actionText, { color: attDone ? "#059669" : C.textSecondary }]}>출결</Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: item.diary_done ? "#059669" : C.border }]} onPress={onDiary}>
          <Feather name="book" size={14} color={item.diary_done ? "#059669" : C.textSecondary} />
          <Text style={[card.actionText, { color: item.diary_done ? "#059669" : C.textSecondary }]}>일지</Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: item.has_note ? "#D97706" : C.border, flex: 1.4 }]} onPress={onMemo}>
          <Feather name="edit-3" size={14} color={item.has_note ? "#D97706" : C.textSecondary} />
          <Text style={[card.actionText, { color: item.has_note ? "#D97706" : C.textSecondary }]}>
            {item.has_note ? "메모 수정" : "개인메모"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── 메인 화면 ─────────────────────────────────── */
export default function TodayScheduleScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();
  const today = todayStr();

  const [items, setItems]           = useState<ScheduleItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [memoItem, setMemoItem]     = useState<ScheduleItem | null>(null);
  const [memoVisible, setMemoVisible] = useState(false);
  const [pastVisible, setPastVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, `/today-schedule?date=${today}`);
      if (res.ok) setItems(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, today]);

  useEffect(() => { load(); }, [load]);

  const attDoneCount  = items.filter(i => i.att_total > 0 && i.att_present === i.att_total).length;
  const diaryDoneCount = items.filter(i => i.diary_done).length;

  const handleMemoSaved = (classGroupId: string, updated: Partial<ScheduleItem>) => {
    setItems(prev => prev.map(i => i.id === classGroupId ? { ...i, ...updated } : i));
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}

        ListHeaderComponent={() => (
          <View>
            {/* 헤더 요약 */}
            <View style={[s.headerCard, { backgroundColor: themeColor }]}>
              <Text style={s.headerDate}>{formatDate(today)}</Text>
              <Text style={s.headerCount}>오늘 수업 {items.length}개</Text>
              {items.length > 0 ? (
                <View style={s.headerSummaryRow}>
                  <View style={s.summaryItem}>
                    <Feather name="check-square" size={13} color="rgba(255,255,255,0.8)" />
                    <Text style={s.summaryText}>출결 완료 {attDoneCount}/{items.length}</Text>
                  </View>
                  <View style={s.summaryItem}>
                    <Feather name="book" size={13} color="rgba(255,255,255,0.8)" />
                    <Text style={s.summaryText}>일지 작성 {diaryDoneCount}/{items.length}</Text>
                  </View>
                </View>
              ) : (
                <Text style={s.headerNoClass}>오늘 담당 수업이 없습니다</Text>
              )}
            </View>

            {items.length > 0 && (
              <Text style={s.sectionTitle}>시간순 수업 목록</Text>
            )}
          </View>
        )}

        renderItem={({ item }) => (
          <ScheduleCard
            item={item}
            themeColor={themeColor}
            onMemo={() => { setMemoItem(item); setMemoVisible(true); }}
            onAttendance={() =>
              router.push({ pathname: "/(teacher)/attendance", params: { classGroupId: item.id } } as any)
            }
            onDiary={() =>
              router.push({ pathname: "/(teacher)/diary", params: { classGroupId: item.id, className: item.name } } as any)
            }
          />
        )}

        ListFooterComponent={() => (
          <Pressable style={[s.pastCard, { backgroundColor: C.card }]} onPress={() => setPastVisible(true)}>
            <View style={[s.pastIcon, { backgroundColor: themeColor + "15" }]}>
              <Feather name="calendar" size={22} color={themeColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.pastTitle}>지난 스케쥴 메모</Text>
              <Text style={s.pastSub}>날짜를 선택해 과거 수업 메모를 확인하세요</Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        )}
      />

      {/* 개인메모 바텀시트 */}
      <MemoSheet
        visible={memoVisible}
        item={memoItem}
        date={today}
        token={token}
        themeColor={themeColor}
        onClose={() => setMemoVisible(false)}
        onSaved={(updated) => {
          if (memoItem) handleMemoSaved(memoItem.id, updated);
        }}
      />

      {/* 지난 메모 달력 */}
      <PastMemosModal
        visible={pastVisible}
        token={token}
        onClose={() => setPastVisible(false)}
      />
    </SafeAreaView>
  );
}

/* ── StyleSheets ─────────────────────────────────── */
const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: "#F3F4F6" },
  list:        { padding: 12, gap: 10, paddingBottom: 120 },
  headerCard:  { borderRadius: 18, padding: 20, marginBottom: 4, gap: 6 },
  headerDate:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)" },
  headerCount: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerNoClass: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 4 },
  headerSummaryRow: { flexDirection: "row", gap: 16, marginTop: 4 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  summaryText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.9)" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, marginTop: 4, marginBottom: 2, paddingHorizontal: 4 },
  pastCard:  { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18, marginTop: 6 },
  pastIcon:  { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  pastTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  pastSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
});

const card = StyleSheet.create({
  wrap:     { borderRadius: 16, padding: 14, gap: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  topRow:   { flexDirection: "row", alignItems: "center", gap: 10 },
  timeBox:  { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  time:     { fontSize: 15, fontFamily: "Inter_700Bold" },
  name:     { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  sub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  statusRow:{ flexDirection: "row", gap: 8, flexWrap: "wrap" },
  badge:    { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText:{ fontSize: 11, fontFamily: "Inter_600SemiBold" },
  noteBadge:{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 7 },
  noteBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#D97706" },
  btnRow:   { flexDirection: "row", gap: 8 },
  actionBtn:{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  actionText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

const ms = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:      { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, paddingBottom: 36 },
  handle:     { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  sheetHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  sheetSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  closeBtn:   { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  textArea:   { borderWidth: 1.5, borderRadius: 12, padding: 12, minHeight: 110, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text },
  audioBox:   { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 12, padding: 12 },
  audioLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  recRow:     { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  recTime:    { fontSize: 14, fontFamily: "Inter_700Bold", minWidth: 36 },
  recBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  recBtnText: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  privateNote:{ fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, textAlign: "center" },
  saveBtn:    { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  saveBtnText:{ color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

const cal = StyleSheet.create({
  wrap:     { backgroundColor: C.card, borderRadius: 18, padding: 16, gap: 12 },
  header:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title:    { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  dayRow:   { flexDirection: "row", justifyContent: "space-around" },
  dayLabel: { width: 36, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  grid:     { flexDirection: "row", flexWrap: "wrap" },
  cell:     { width: "14.28%", alignItems: "center", paddingVertical: 3, gap: 2 },
  dayBox:   { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  todayBox: { backgroundColor: C.tint },
  dayNum:   { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  dot:      { width: 5, height: 5, borderRadius: 3, backgroundColor: C.tint },
});

const pm = StyleSheet.create({
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  noteCard:  { borderRadius: 16, padding: 16, gap: 8 },
  noteCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteName:  { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  noteTime:  { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  noteText:  { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 22 },
  audioRow:  { flexDirection: "row", alignItems: "center", gap: 6 },
  audioLabel:{ fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  noteDate:  { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  empty:     { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted },
});
