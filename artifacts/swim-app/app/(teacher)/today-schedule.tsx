/**
 * (teacher)/today-schedule.tsx — 오늘 스케쥴 탭
 *
 * - 시간순 수업 카드 (출결·일지·메모 상태)
 * - 개인메모 바텀시트 (수업별 텍스트 + 음성녹음)
 * - 스케줄 메모 달력: 날짜 제한 없이 클릭, 날짜별 텍스트/음성 메모 작성
 */
import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Modal,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

const C = Colors.light;
const API_BASE = process.env.EXPO_PUBLIC_API_URL || "";

/* ── 타입 ────────────────────────────────────────── */
interface ScheduleItem {
  id: string; name: string; schedule_time: string; schedule_days: string;
  level?: string | null; student_count: number;
  att_total: number; att_present: number;
  diary_done: boolean; has_note: boolean;
  note_text: string | null; audio_file_url: string | null;
}
interface DailyMemo {
  id?: string; note_text?: string | null; audio_file_url?: string | null;
}
interface DailyMemoDateInfo { date: string; has_text: boolean; has_audio: boolean; }

/* ── 날짜 유틸 ──────────────────────────────────── */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}
function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function getFirstDayOfMonth(year: number, month: number) { return new Date(year, month - 1, 1).getDay(); }

/* ══════════════════════════════════════════════════
   달력 컴포넌트
   - 모든 날짜 클릭 가능
   - 텍스트메모: 주황 dot, 음성메모: 파란 dot
   ═════════════════════════════════════════════════ */
function MiniCalendar({
  year, month, memoInfo, onSelectDate, onChangeMonth,
}: {
  year: number; month: number;
  memoInfo: DailyMemoDateInfo[];
  onSelectDate: (d: string) => void;
  onChangeMonth: (y: number, m: number) => void;
}) {
  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayStr();

  return (
    <View style={cal.wrap}>
      <View style={cal.header}>
        <Pressable
          style={cal.navBtn}
          onPress={() => { const d = new Date(year, month - 2, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}
        >
          <Feather name="chevron-left" size={22} color={C.text} />
        </Pressable>
        <Text style={cal.title}>{year}년 {month}월</Text>
        <Pressable
          style={cal.navBtn}
          onPress={() => { const d = new Date(year, month, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}
        >
          <Feather name="chevron-right" size={22} color={C.text} />
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
          const info = memoInfo.find(m => m.date === dateStr);
          const hasText  = !!info?.has_text;
          const hasAudio = !!info?.has_audio;
          const isToday  = dateStr === today;
          const dayIdx   = new Date(dateStr + "T00:00:00").getDay();
          const isSun    = dayIdx === 0;
          const isSat    = dayIdx === 6;

          return (
            <Pressable key={dateStr} style={cal.cell} onPress={() => onSelectDate(dateStr)}>
              <View style={[cal.dayBox, isToday && { backgroundColor: C.tint }]}>
                <Text style={[
                  cal.dayNum,
                  isToday  ? { color: "#fff", fontFamily: "Inter_700Bold" } :
                  isSun    ? { color: "#EF4444" } :
                  isSat    ? { color: "#3B82F6" } :
                             { color: C.text },
                ]}>
                  {day}
                </Text>
              </View>
              {/* 메모 dot 표시 */}
              <View style={cal.dotRow}>
                {hasText  && <View style={[cal.dot, { backgroundColor: "#F59E0B" }]} />}
                {hasAudio && <View style={[cal.dot, { backgroundColor: "#3B82F6" }]} />}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* 범례 */}
      <View style={cal.legend}>
        <View style={cal.legendItem}>
          <View style={[cal.legendDot, { backgroundColor: "#F59E0B" }]} />
          <Text style={cal.legendText}>텍스트 메모</Text>
        </View>
        <View style={cal.legendItem}>
          <View style={[cal.legendDot, { backgroundColor: "#3B82F6" }]} />
          <Text style={cal.legendText}>음성 메모</Text>
        </View>
      </View>
    </View>
  );
}

/* ══════════════════════════════════════════════════
   날짜 메모 편집 페이지 (스케줄 메모 전용)
   ═════════════════════════════════════════════════ */
function DailyMemoPage({
  date, token, themeColor, onBack, onSaved,
}: {
  date: string; token: string | null; themeColor: string;
  onBack: () => void;
  onSaved: (date: string, info: DailyMemoDateInfo) => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [text, setText]       = useState("");
  const [audioKey, setAudioKey]   = useState<string | null>(null);
  const [audioUri, setAudioUri]   = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sound, setSound]     = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const [playDur, setPlayDur] = useState(0);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [saving, setSaving]   = useState(false);
  const recSecs = useRef(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recDisplay, setRecDisplay] = useState("0:00");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await apiRequest(token, `/daily-memos?date=${date}`);
        if (res.ok) {
          const data: DailyMemo | null = await res.json();
          if (data) {
            setText(data.note_text || "");
            setAudioKey(data.audio_file_url || null);
          } else {
            setText(""); setAudioKey(null);
          }
        }
      } catch(e) { console.error(e); }
      finally { setLoading(false); }
    })();
    return () => {
      sound?.unloadAsync();
      if (recTimer.current) clearInterval(recTimer.current);
    };
  }, [date]);

  /* ── 녹음 ── */
  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { Alert.alert("권한 필요", "마이크 권한이 필요합니다."); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec); setIsRecording(true);
      recSecs.current = 0; setRecDisplay("0:00");
      recTimer.current = setInterval(() => {
        recSecs.current += 1;
        const m = Math.floor(recSecs.current / 60);
        const s = recSecs.current % 60;
        setRecDisplay(`${m}:${String(s).padStart(2, "0")}`);
      }, 1000);
    } catch (e) { Alert.alert("오류", "녹음을 시작할 수 없습니다."); }
  }
  async function stopRecording() {
    if (!recording) return;
    if (recTimer.current) clearInterval(recTimer.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null); setIsRecording(false);
    setAudioUri(uri || null);
  }

  /* ── 재생 ── */
  async function playAudio() {
    if (playing) {
      await sound?.pauseAsync(); setPlaying(false); return;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      let playUri = audioUri;
      if (!playUri && audioKey) {
        playUri = `${API_BASE}/api/daily-memos/audio?key=${encodeURIComponent(audioKey)}`;
      }
      if (!playUri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      setSound(s); setPlaying(true);
      s.setOnPlaybackStatusUpdate(status => {
        const st = status as any;
        if (st.isLoaded) {
          setPlayPos(st.positionMillis || 0);
          setPlayDur(st.durationMillis || 0);
        }
        if (st.didJustFinish) {
          setPlaying(false); setPlayPos(0);
          s.unloadAsync(); setSound(null);
        }
      });
    } catch { Alert.alert("오류", "재생에 실패했습니다."); }
  }
  function deleteAudio() {
    Alert.alert("음성 메모 삭제", "녹음된 음성 메모를 삭제하시겠습니까?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: () => { setAudioUri(null); setAudioKey(null); setPlaying(false); sound?.unloadAsync(); setSound(null); } },
    ]);
  }

  /* ── 음성 업로드 ── */
  async function uploadAudio(): Promise<string | null> {
    if (!audioUri) return audioKey;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      const filename = audioUri.split("/").pop() || "audio.m4a";
      (formData as any).append("audio", { uri: audioUri, name: filename, type: "audio/m4a" } as any);
      const res = await fetch(`${API_BASE}/api/daily-memos/audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      return data.audio_file_url || null;
    } catch {
      Alert.alert("오류", "음성 업로드에 실패했습니다."); return null;
    } finally { setUploadingAudio(false); }
  }

  /* ── 저장 ── */
  async function handleSave() {
    setSaving(true);
    try {
      const uploadedKey = await uploadAudio();
      const res = await apiRequest(token, "/daily-memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          note_text: text.trim() || null,
          audio_file_url: uploadedKey || null,
        }),
      });
      if (res.ok) {
        onSaved(date, {
          date,
          has_text:  !!(text.trim()),
          has_audio: !!(uploadedKey),
        });
        onBack();
      } else {
        const d = await res.json();
        Alert.alert("오류", d.error || "저장에 실패했습니다.");
      }
    } finally { setSaving(false); }
  }

  const hasAudio = !!(audioUri || audioKey);
  const progPercent = playDur > 0 ? (playPos / playDur) * 100 : 0;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={themeColor} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[dm.header, { paddingTop: insets.top + 12, borderBottomColor: C.border }]}>
        <Pressable style={dm.backBtn} onPress={onBack}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[dm.headerTitle, { color: C.text }]}>{formatDate(date)}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 텍스트 메모 */}
        <View style={dm.section}>
          <View style={dm.sectionHeader}>
            <Feather name="edit-3" size={16} color={themeColor} />
            <Text style={[dm.sectionTitle, { color: C.text }]}>텍스트 메모</Text>
          </View>
          <TextInput
            style={[dm.textArea, { borderColor: C.border, color: C.text }]}
            value={text}
            onChangeText={setText}
            placeholder="수업 준비, 특이사항, 개인 스케줄 등 자유롭게 작성하세요..."
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        {/* 음성 메모 */}
        <View style={dm.section}>
          <View style={dm.sectionHeader}>
            <Feather name="mic" size={16} color="#3B82F6" />
            <Text style={[dm.sectionTitle, { color: C.text }]}>음성 메모</Text>
          </View>

          <View style={[dm.audioBox, { borderColor: C.border }]}>
            {isRecording ? (
              /* 녹음 중 */
              <View style={dm.recordingRow}>
                <View style={dm.recPulse}>
                  <View style={dm.recDot} />
                </View>
                <Text style={[dm.recTime, { color: "#EF4444" }]}>{recDisplay}</Text>
                <Text style={[dm.recLabel, { color: C.textSecondary }]}>녹음 중...</Text>
                <Pressable style={dm.stopBtn} onPress={stopRecording}>
                  <Feather name="square" size={14} color="#fff" />
                  <Text style={dm.stopBtnText}>중지</Text>
                </Pressable>
              </View>
            ) : hasAudio ? (
              /* 음성 있음 → 재생/삭제 */
              <View style={{ gap: 12 }}>
                <View style={dm.playerRow}>
                  <Pressable
                    style={[dm.playerBtn, { backgroundColor: "#3B82F6" }]}
                    onPress={playAudio}
                  >
                    <Feather name={playing ? "pause" : "play"} size={18} color="#fff" />
                  </Pressable>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={[dm.progressTrack, { backgroundColor: C.border }]}>
                      <View style={[dm.progressFill, { width: `${progPercent}%` as any, backgroundColor: "#3B82F6" }]} />
                    </View>
                    <View style={dm.playerMeta}>
                      <Text style={[dm.playerStatus, { color: playing ? "#3B82F6" : C.textSecondary }]}>
                        {playing ? "재생 중" : "재생 가능"}
                      </Text>
                      {audioUri && <Text style={[dm.playerStatus, { color: "#F59E0B" }]}>새 녹음 (미저장)</Text>}
                    </View>
                  </View>
                  <Pressable style={dm.deleteAudioBtn} onPress={deleteAudio}>
                    <Feather name="trash-2" size={16} color="#EF4444" />
                  </Pressable>
                </View>
                <Pressable
                  style={[dm.rerecordBtn, { borderColor: C.border }]}
                  onPress={startRecording}
                >
                  <Feather name="refresh-cw" size={13} color={C.textSecondary} />
                  <Text style={[dm.rerecordText, { color: C.textSecondary }]}>다시 녹음</Text>
                </Pressable>
              </View>
            ) : (
              /* 음성 없음 → 녹음 시작 */
              <Pressable style={dm.startRecBtn} onPress={startRecording}>
                <View style={[dm.micCircle, { backgroundColor: "#EFF6FF" }]}>
                  <Feather name="mic" size={22} color="#3B82F6" />
                </View>
                <Text style={[dm.startRecText, { color: C.text }]}>녹음 시작</Text>
                <Text style={[dm.startRecSub, { color: C.textSecondary }]}>탭하면 녹음이 시작됩니다</Text>
              </Pressable>
            )}
          </View>
        </View>
      </ScrollView>

      {/* 저장 버튼 - 하단 고정 */}
      <View style={[dm.saveWrap, { paddingBottom: insets.bottom + 12, borderTopColor: C.border, backgroundColor: C.background }]}>
        <Pressable
          style={[dm.saveBtn, { backgroundColor: themeColor, opacity: saving || uploadingAudio ? 0.7 : 1 }]}
          onPress={handleSave}
          disabled={saving || uploadingAudio}
        >
          {saving || uploadingAudio
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
                <Feather name="check" size={18} color="#fff" />
                <Text style={dm.saveBtnText}>저장</Text>
              </>
          }
        </Pressable>
      </View>
    </View>
  );
}

/* ══════════════════════════════════════════════════
   스케줄 메모 달력 모달
   - calendarView: 달력 (모든 날짜 클릭 가능)
   - memoView:     선택 날짜 메모 편집
   ═════════════════════════════════════════════════ */
function ScheduleMemoModal({
  visible, token, themeColor, onClose,
}: {
  visible: boolean; token: string | null; themeColor: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [year, setYear]     = useState(now.getFullYear());
  const [month, setMonth]   = useState(now.getMonth() + 1);
  const [memoInfo, setMemoInfo] = useState<DailyMemoDateInfo[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const loadDates = useCallback(async (y: number, m: number) => {
    setLoadingDates(true);
    try {
      const res = await apiRequest(token, `/daily-memos/dates?year=${y}&month=${m}`);
      if (res.ok) setMemoInfo(await res.json());
    } finally { setLoadingDates(false); }
  }, [token]);

  useEffect(() => {
    if (visible) { loadDates(year, month); }
  }, [visible, year, month]);

  function handleChangeMonth(y: number, m: number) {
    setYear(y); setMonth(m); setMemoInfo([]);
  }

  function handleSelectDate(date: string) {
    setSelectedDate(date);
  }

  function handleBack() {
    if (selectedDate) {
      setSelectedDate(null);
    } else {
      onClose();
    }
  }

  function handleMemoSaved(date: string, info: DailyMemoDateInfo) {
    setMemoInfo(prev => {
      const filtered = prev.filter(m => m.date !== date);
      if (info.has_text || info.has_audio) return [...filtered, info];
      return filtered;
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleBack}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top"]}>
        {selectedDate ? (
          <DailyMemoPage
            date={selectedDate}
            token={token}
            themeColor={themeColor}
            onBack={() => setSelectedDate(null)}
            onSaved={handleMemoSaved}
          />
        ) : (
          <>
            {/* 달력 헤더 */}
            <View style={[sm.header, { borderBottomColor: C.border }]}>
              <Pressable style={sm.backBtn} onPress={onClose}>
                <Feather name="arrow-left" size={22} color={C.text} />
              </Pressable>
              <Text style={[sm.headerTitle, { color: C.text }]}>스케줄 메모</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}
              showsVerticalScrollIndicator={false}
            >
              {loadingDates && (
                <ActivityIndicator color={themeColor} style={{ marginBottom: 4 }} />
              )}
              <MiniCalendar
                year={year} month={month}
                memoInfo={memoInfo}
                onSelectDate={handleSelectDate}
                onChangeMonth={handleChangeMonth}
              />
              <View style={[sm.tipBox, { backgroundColor: C.tintLight }]}>
                <Feather name="info" size={13} color={themeColor} />
                <Text style={[sm.tipText, { color: themeColor }]}>
                  날짜를 탭하면 메모를 작성하거나 편집할 수 있습니다.
                </Text>
              </View>
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════
   수업별 개인메모 바텀시트 (기존 유지)
   ═════════════════════════════════════════════════ */
function MemoSheet({
  visible, item, date, token, themeColor, onClose, onSaved,
}: {
  visible: boolean; item: ScheduleItem | null; date: string;
  token: string | null; themeColor: string;
  onClose: () => void; onSaved: (updated: Partial<ScheduleItem>) => void;
}) {
  const [text, setText]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri]   = useState<string | null>(null);
  const [audioKey, setAudioKey]   = useState<string | null>(null);
  const [sound, setSound]     = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const recSecs = useRef(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [recDisplay, setRecDisplay] = useState("0:00");

  useEffect(() => {
    if (visible && item) {
      setText(item.note_text || "");
      setAudioKey(item.audio_file_url || null);
      setAudioUri(null); setIsRecording(false);
      setRecording(null); setPlaying(false);
    }
  }, [visible, item]);

  async function startRecording() {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec); setIsRecording(true);
      recSecs.current = 0; setRecDisplay("0:00");
      recTimer.current = setInterval(() => {
        recSecs.current += 1;
        const m = Math.floor(recSecs.current / 60);
        const s = recSecs.current % 60;
        setRecDisplay(`${m}:${String(s).padStart(2, "0")}`);
      }, 1000);
    } catch (e) { Alert.alert("오류", "녹음을 시작할 수 없습니다."); }
  }
  async function stopRecording() {
    if (!recording) return;
    if (recTimer.current) clearInterval(recTimer.current);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null); setIsRecording(false); setAudioUri(uri || null);
  }
  async function uploadAudio(): Promise<string | null> {
    if (!audioUri) return audioKey;
    setUploadingAudio(true);
    try {
      const formData = new FormData();
      const filename = audioUri.split("/").pop() || "audio.m4a";
      (formData as any).append("audio", { uri: audioUri, name: filename, type: "audio/m4a" } as any);
      const res = await fetch(`${API_BASE}/api/schedule-notes/audio`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData,
      });
      const data = await res.json();
      return data.audio_file_url || null;
    } catch { Alert.alert("오류", "음성 업로드에 실패했습니다."); return null; }
    finally { setUploadingAudio(false); }
  }
  async function playAudio() {
    const key = audioKey;
    if (!key && !audioUri) return;
    if (playing) { await sound?.pauseAsync(); setPlaying(false); return; }
    try {
      let playUri = audioUri;
      if (!playUri && key) playUri = `${API_BASE}/api/schedule-notes/audio?key=${encodeURIComponent(key)}`;
      if (!playUri) return;
      const { sound: s } = await Audio.Sound.createAsync({ uri: playUri }, { shouldPlay: true });
      setSound(s); setPlaying(true);
      s.setOnPlaybackStatusUpdate(status => {
        if ((status as any).didJustFinish) { setPlaying(false); s.unloadAsync(); setSound(null); }
      });
    } catch { Alert.alert("오류", "재생에 실패했습니다."); }
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
          class_group_id: item.id, schedule_date: date,
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
          <Pressable onPress={onClose} style={ms.closeBtn}><Feather name="x" size={20} color={C.text} /></Pressable>
        </View>
        <TextInput style={[ms.textArea, { borderColor: C.border }]}
          value={text} onChangeText={setText}
          placeholder="수업 준비 메모, 특이사항 등 자유롭게 작성하세요..."
          placeholderTextColor={C.textMuted} multiline numberOfLines={5} textAlignVertical="top"
        />
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
          onPress={handleSave} disabled={saving || uploadingAudio}
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

/* ══════════════════════════════════════════════════
   수업 카드
   ═════════════════════════════════════════════════ */
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
      <View style={card.topRow}>
        <View style={[card.timeBox, { backgroundColor: themeColor + "15" }]}>
          <Text style={[card.time, { color: themeColor }]}>{item.schedule_time}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={card.name}>{item.name}</Text>
          <Text style={card.sub}>학생 {item.student_count}명{item.level ? ` · ${item.level}` : ""}</Text>
        </View>
        {item.has_note && (
          <View style={[card.noteBadge, { backgroundColor: "#FEF3C7" }]}>
            <Feather name="edit-3" size={10} color="#D97706" />
            <Text style={card.noteBadgeText}>메모</Text>
          </View>
        )}
      </View>
      <View style={card.statusRow}>
        <View style={[card.badge, { backgroundColor: attDone ? "#D1FAE5" : attPartial ? "#FEF3C7" : "#F3F4F6" }]}>
          <Feather name={attDone ? "check-circle" : "circle"} size={11}
            color={attDone ? "#059669" : attPartial ? "#D97706" : "#9CA3AF"} />
          <Text style={[card.badgeText, { color: attDone ? "#059669" : attPartial ? "#D97706" : "#6B7280" }]}>
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

/* ══════════════════════════════════════════════════
   메인 화면
   ═════════════════════════════════════════════════ */
export default function TodayScheduleScreen() {
  const { token }   = useAuth();
  const { themeColor } = useBrand();
  const today = todayStr();

  const [items, setItems]             = useState<ScheduleItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [memoItem, setMemoItem]       = useState<ScheduleItem | null>(null);
  const [memoVisible, setMemoVisible] = useState(false);
  const [schedMemoVisible, setSchedMemoVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiRequest(token, `/today-schedule?date=${today}`);
      if (res.ok) setItems(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, today]);

  useEffect(() => { load(); }, [load]);

  const attDoneCount   = items.filter(i => i.att_total > 0 && i.att_present === i.att_total).length;
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={themeColor}
          />
        }

        ListHeaderComponent={() => (
          <View>
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
          <Pressable
            style={[s.schedCard, { backgroundColor: C.card }]}
            onPress={() => setSchedMemoVisible(true)}
          >
            <View style={[s.schedIcon, { backgroundColor: themeColor + "15" }]}>
              <Feather name="calendar" size={22} color={themeColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.schedTitle}>스케줄 메모</Text>
              <Text style={s.schedSub}>날짜를 선택해 텍스트·음성 메모를 작성하세요</Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        )}
      />

      {/* 수업별 개인메모 바텀시트 */}
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

      {/* 스케줄 메모 달력 */}
      <ScheduleMemoModal
        visible={schedMemoVisible}
        token={token}
        themeColor={themeColor}
        onClose={() => setSchedMemoVisible(false)}
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
  schedCard:  { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 18, marginTop: 6 },
  schedIcon:  { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  schedTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  schedSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
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
  wrap:       { backgroundColor: C.card, borderRadius: 18, padding: 16, gap: 10 },
  header:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  navBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  title:      { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  dayRow:     { flexDirection: "row", justifyContent: "space-around" },
  dayLabel:   { width: "14.28%" as any, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  grid:       { flexDirection: "row", flexWrap: "wrap" },
  cell:       { width: "14.28%" as any, alignItems: "center", paddingVertical: 4, gap: 2 },
  dayBox:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dayNum:     { fontSize: 14, fontFamily: "Inter_500Medium" },
  dotRow:     { flexDirection: "row", gap: 2, minHeight: 6 },
  dot:        { width: 5, height: 5, borderRadius: 3 },
  legend:     { flexDirection: "row", justifyContent: "center", gap: 20, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
});

const sm = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1 },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  tipBox:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12 },
  tipText:     { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});

const dm = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:      { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", flex: 1, textAlign: "center" },
  section:      { gap: 10 },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  textArea:     { borderWidth: 1.5, borderRadius: 14, padding: 14, minHeight: 130, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
  audioBox:     { borderWidth: 1.5, borderRadius: 14, padding: 16, gap: 0 },
  recordingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  recPulse:     { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  recDot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444" },
  recTime:      { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 44 },
  recLabel:     { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  stopBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: "#EF4444" },
  stopBtnText:  { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  playerRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  playerBtn:    { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  progressTrack:{ height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  playerMeta:   { flexDirection: "row", gap: 10 },
  playerStatus: { fontSize: 11, fontFamily: "Inter_500Medium" },
  deleteAudioBtn:{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#FEE2E2" },
  rerecordBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5 },
  rerecordText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  startRecBtn:  { alignItems: "center", gap: 8, paddingVertical: 16 },
  micCircle:    { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  startRecText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  startRecSub:  { fontSize: 12, fontFamily: "Inter_400Regular" },
  saveWrap:     { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  saveBtn:      { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  saveBtnText:  { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
