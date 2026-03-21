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
  ActivityIndicator, Alert, Modal, Platform,
  Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

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
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={cal.title}>{year}년 {month}월</Text>
        <Pressable
          style={cal.navBtn}
          onPress={() => { const d = new Date(year, month, 1); onChangeMonth(d.getFullYear(), d.getMonth() + 1); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="chevron-right" size={24} color={C.text} />
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
  const [errMsg, setErrMsg] = useState<string | null>(null);

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
    } catch (e) { setErrMsg("녹음을 시작할 수 없습니다."); }
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
    } catch { setErrMsg("재생에 실패했습니다."); }
  }
  function deleteAudio() {
    if (sound) { sound.unloadAsync(); setSound(null); }
    setPlaying(false);
    setPlayPos(0);
    setPlayDur(0);
    setAudioUri(null);
    setAudioKey(null);
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
      setErrMsg("음성 업로드에 실패했습니다."); return null;
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
        setErrMsg(d.error || "저장에 실패했습니다.");
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
   <>
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[dm.header, { paddingTop: 20, borderBottomColor: C.border }]}>
        <Pressable
          style={dm.backBtn}
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[dm.headerTitle, { color: C.text }]}>{formatDate(date)}</Text>
        <View style={{ width: 48 }} />
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
    <ConfirmModal
      visible={!!errMsg}
      title="오류"
      message={errMsg ?? ""}
      confirmText="확인"
      onConfirm={() => setErrMsg(null)}
    />
   </>
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
      <SafeAreaView style={{ flex: 1, backgroundColor: C.background }} edges={["top", "left", "right"]}>
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
            <View style={[sm.header, { borderBottomColor: C.border, paddingTop: 20 }]}>
              <Pressable
                style={sm.backBtn}
                onPress={onClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Feather name="arrow-left" size={24} color={C.text} />
              </Pressable>
              <Text style={[sm.headerTitle, { color: C.text }]}>스케줄 메모</Text>
              <View style={{ width: 48 }} />
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
  const [memoErrMsg, setMemoErrMsg] = useState<string | null>(null);
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
    } catch (e) { setMemoErrMsg("녹음을 시작할 수 없습니다."); }
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
    } catch { setMemoErrMsg("음성 업로드에 실패했습니다."); return null; }
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
    } catch { setMemoErrMsg("재생에 실패했습니다."); }
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
   <>
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
                  <Pressable style={[ms.recBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => {
                    if (sound) { sound.unloadAsync(); setSound(null); }
                    setPlaying(false);
                    setAudioUri(null);
                    setAudioKey(null);
                  }}>
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
    <ConfirmModal
      visible={!!memoErrMsg}
      title="오류"
      message={memoErrMsg ?? ""}
      confirmText="확인"
      onConfirm={() => setMemoErrMsg(null)}
    />
   </>
  );
}

/* ══════════════════════════════════════════════════
   결근 처리 모달 (2단계)
   1단계: 없음/있음 선택
   2단계(있음): 학생 선택 → 옆 반 선택
   ═════════════════════════════════════════════════ */
interface NearbyClass { id: string; name: string; schedule_time: string; teacher_name: string; student_count: number; }
interface AbsenceStudent { id: string; name: string; selected: boolean; }

function AbsenceModal({
  visible, item, date, token, themeColor, onClose, onDone,
}: {
  visible: boolean; item: ScheduleItem | null; date: string; token: string | null;
  themeColor: string; onClose: () => void; onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"ask" | "select">("ask");
  const [loading, setLoading] = useState(false);
  const [students, setStudents] = useState<AbsenceStudent[]>([]);
  const [nearby, setNearby] = useState<NearbyClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [absenceId, setAbsenceId] = useState<string>("");
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    if (!visible) { setStep("ask"); setResult(""); setStudents([]); setNearby([]); setSelectedClass(""); setAbsenceId(""); }
  }, [visible]);

  async function handleNoTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const res = await apiRequest(token, "/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: (item as any).pool_id || "", class_group_id: item.id, absence_date: date, absence_time: item.schedule_time }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(`결근 처리 완료. 학생 ${data.affected_students}명이 미실시(선생님) 보강으로 이월되었습니다.`);
      } else {
        setResult("오류: " + (data.error || "처리 실패"));
      }
    } catch (e) {
      setResult("처리 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  }

  async function handleHasTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const [stuRes, nearbyRes] = await Promise.all([
        apiRequest(token, `/class-groups/${item.id}/students`),
        apiRequest(token, `/absences/nearby?class_group_id=${item.id}&date=${date}&time=${item.schedule_time}`),
      ]);
      const stuData = stuRes.ok ? await stuRes.json() : [];
      const nearData = nearbyRes.ok ? await nearbyRes.json() : { classes: [] };
      const stuList = Array.isArray(stuData) ? stuData : (stuData.students || []);
      setStudents(stuList.map((s: any) => ({ id: s.id, name: s.name, selected: false })));
      setNearby(nearData.classes || []);
      setStep("select");
    } catch { setResult("조회 실패"); }
    finally { setLoading(false); }
  }

  async function handleSubmitTransfer() {
    if (!item) return;
    setLoading(true);
    try {
      const absRes = await apiRequest(token, "/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: (item as any).pool_id || "", class_group_id: item.id, absence_date: date, absence_time: item.schedule_time }),
      });
      const absData = await absRes.json();
      if (!absData.success) { setResult("결근 등록 실패: " + absData.error); setLoading(false); return; }
      const aid = absData.absence?.id;

      const transferIds = students.filter(s => s.selected).map(s => s.id);
      if (transferIds.length > 0 && selectedClass) {
        await apiRequest(token, `/absences/${aid}/transfer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transfer_student_ids: transferIds, to_class_group_id: selectedClass }),
        });
      }
      const remaining = students.filter(s => !s.selected).length;
      setResult(`처리 완료. 이동 ${transferIds.length}명, 미실시(선생님) ${remaining}명`);
    } catch { setResult("처리 중 오류"); }
    finally { setLoading(false); }
  }

  function toggleStudent(id: string) {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, selected: !s.selected } : s));
  }

  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={ab.overlay} onPress={onClose} />
      <View style={[ab.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={ab.handle} />
        {result ? (
          <View style={{ gap: 16, padding: 4 }}>
            <View style={[ab.resultBox, { backgroundColor: result.startsWith("오류") ? "#FEE2E2" : "#D1FAE5" }]}>
              <Feather name={result.startsWith("오류") ? "alert-circle" : "check-circle"} size={20} color={result.startsWith("오류") ? "#EF4444" : "#059669"} />
              <Text style={[ab.resultText, { color: result.startsWith("오류") ? "#DC2626" : "#065F46" }]}>{result}</Text>
            </View>
            <Pressable style={[ab.btn, { backgroundColor: themeColor }]} onPress={() => { onDone(); onClose(); }}>
              <Text style={ab.btnText}>확인</Text>
            </Pressable>
          </View>
        ) : step === "ask" ? (
          <View style={{ gap: 16 }}>
            <Text style={ab.title}>결근 처리</Text>
            <View style={[ab.warnBox, { backgroundColor: "#FEF3C7" }]}>
              <Feather name="alert-triangle" size={16} color="#D97706" />
              <Text style={[ab.warnText, { color: "#92400E" }]}>
                {item?.name} 수업을 결근 처리합니다.{"\n"}옆 반 이동 수업하는 학생이 있습니까?
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable style={[ab.choiceBtn, { backgroundColor: "#F3F4F6", flex: 1 }]} onPress={handleNoTransfer} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color="#6B7280" /> : <>
                  <Feather name="x-circle" size={18} color="#6B7280" />
                  <Text style={[ab.choiceBtnText, { color: "#374151" }]}>없음</Text>
                  <Text style={ab.choiceSub}>전원 미실시(선생님)</Text>
                </>}
              </Pressable>
              <Pressable style={[ab.choiceBtn, { backgroundColor: themeColor + "15", borderColor: themeColor, borderWidth: 1.5, flex: 1 }]} onPress={handleHasTransfer} disabled={loading}>
                {loading ? <ActivityIndicator size="small" color={themeColor} /> : <>
                  <Feather name="users" size={18} color={themeColor} />
                  <Text style={[ab.choiceBtnText, { color: themeColor }]}>있음</Text>
                  <Text style={ab.choiceSub}>학생 선택 → 옆 반 이동</Text>
                </>}
              </Pressable>
            </View>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={ab.title}>이동할 학생 및 반 선택</Text>
            <Text style={[ab.sectionLabel, { color: C.textSecondary }]}>이동할 학생 선택</Text>
            {students.map(s => (
              <Pressable key={s.id} style={[ab.studentRow, { backgroundColor: s.selected ? themeColor + "15" : C.background, borderColor: s.selected ? themeColor : C.border }]}
                onPress={() => toggleStudent(s.id)}>
                <Feather name={s.selected ? "check-square" : "square"} size={18} color={s.selected ? themeColor : C.textMuted} />
                <Text style={[ab.studentName, { color: C.text }]}>{s.name}</Text>
                <Text style={[ab.studentTag, { color: s.selected ? themeColor : C.textMuted }]}>{s.selected ? "이동" : "미실시"}</Text>
              </Pressable>
            ))}
            {nearby.length > 0 && (
              <>
                <Text style={[ab.sectionLabel, { color: C.textSecondary, marginTop: 12 }]}>이동할 반 선택</Text>
                {nearby.map(nc => (
                  <Pressable key={nc.id} style={[ab.studentRow, { backgroundColor: selectedClass === nc.id ? themeColor + "15" : C.background, borderColor: selectedClass === nc.id ? themeColor : C.border }]}
                    onPress={() => setSelectedClass(nc.id)}>
                    <Feather name={selectedClass === nc.id ? "check-circle" : "circle"} size={18} color={selectedClass === nc.id ? themeColor : C.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[ab.studentName, { color: C.text }]}>{nc.name}</Text>
                      <Text style={[ab.studentTag, { color: C.textSecondary }]}>{nc.schedule_time} · {nc.teacher_name} · {nc.student_count}명</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
            <Pressable style={[ab.btn, { backgroundColor: themeColor, marginTop: 16, opacity: loading ? 0.6 : 1 }]}
              onPress={handleSubmitTransfer} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={ab.btnText}>처리 완료</Text>}
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════
   수업 카드
   ═════════════════════════════════════════════════ */
function ScheduleCard({
  item, themeColor, onMemo, onAttendance, onDiary, onAbsence,
}: {
  item: ScheduleItem; themeColor: string;
  onMemo: () => void; onAttendance: () => void; onDiary: () => void; onAbsence: () => void;
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
        <Pressable style={[card.actionBtn, { borderColor: item.has_note ? "#D97706" : C.border }]} onPress={onMemo}>
          <Feather name="edit-3" size={14} color={item.has_note ? "#D97706" : C.textSecondary} />
          <Text style={[card.actionText, { color: item.has_note ? "#D97706" : C.textSecondary }]}>
            {item.has_note ? "메모 수정" : "개인메모"}
          </Text>
        </Pressable>
        <Pressable style={[card.actionBtn, { borderColor: "#EF4444", backgroundColor: "#FEF2F2" }]} onPress={onAbsence}>
          <Feather name="user-x" size={14} color="#EF4444" />
          <Text style={[card.actionText, { color: "#EF4444" }]}>결근</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ══════════════════════════════════════════════════
   메인 화면
   ═════════════════════════════════════════════════ */
interface TeacherOverview {
  unread_messages: number;
  pending_diaries_today: number;
  pending_diaries_past: number;
  makeup_count: number;
}
interface UnreadMessage {
  id: string; diary_id: string; sender_name: string; content: string;
  created_at: string; lesson_date: string; class_name: string;
}

/* ══ 안읽은 쪽지 모달 ══════════════════════════════ */
function UnreadMessagesModal({
  visible, token, themeColor, onClose, onOpenDiary,
}: {
  visible: boolean; token: string | null; themeColor: string;
  onClose: () => void; onOpenDiary: (diaryId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<UnreadMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    apiRequest(token, "/teacher/messages?unread=true")
      .then(r => r.ok ? r.json() : [])
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [visible]);

  function fmtDate(s: string) {
    const d = new Date(s);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={um.overlay} onPress={onClose} />
      <View style={[um.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={um.handle} />
        <View style={um.header}>
          <Text style={[um.title, { color: C.text }]}>읽지 않은 쪽지</Text>
          {messages.length > 0 && (
            <View style={[um.countBadge, { backgroundColor: C.error }]}>
              <Text style={um.countTxt}>{messages.length}</Text>
            </View>
          )}
          <Pressable onPress={onClose} style={um.closeBtn}>
            <Feather name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator color={themeColor} style={{ marginTop: 30 }} />
        ) : messages.length === 0 ? (
          <View style={um.empty}>
            <Feather name="mail" size={36} color={C.textMuted} />
            <Text style={[um.emptyTxt, { color: C.textMuted }]}>읽지 않은 쪽지가 없습니다</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {messages.map(msg => (
              <Pressable
                key={msg.id}
                style={[um.item, { borderBottomColor: C.border }]}
                onPress={() => { onOpenDiary(msg.diary_id); onClose(); }}
              >
                <View style={um.itemDot} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[um.itemName, { color: C.text }]}>{msg.sender_name}</Text>
                  <Text style={[um.itemContent, { color: C.textSecondary }]} numberOfLines={1}>{msg.content}</Text>
                  <Text style={[um.itemMeta, { color: C.textMuted }]}>{msg.class_name} · {fmtDate(msg.created_at)}</Text>
                </View>
                <Feather name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const um = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "55%" },
  handle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  countTxt: { color: "#fff", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  closeBtn: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 40 },
  emptyTxt: { fontSize: 14, fontFamily: "Inter_400Regular" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  itemDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2563EB" },
  itemName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  itemContent: { fontSize: 13, fontFamily: "Inter_400Regular" },
  itemMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
});

/* ══════════════════════════════════════════════════
   홈 화면 — 8아이콘 OS 허브
   ═════════════════════════════════════════════════ */
interface HubIcon {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  badge?: number | null;
  onPress: () => void;
}

export default function TodayScheduleScreen() {
  const { token, logout, adminUser, pool, switchRole, setLastUsedRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const today = todayStr();

  const [items, setItems]             = useState<ScheduleItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [overview, setOverview]       = useState<TeacherOverview | null>(null);
  const [notePopupVisible, setNotePopupVisible] = useState(false);
  const [switching, setSwitching]     = useState(false);

  // 관리자로 전환 가능 여부: roles에 pool_admin 포함 시 (부관리자 개념 제거)
  const adminRoleKey = adminUser?.roles?.find(r => r === "pool_admin");
  const canSwitchToAdmin = !!adminRoleKey;

  async function handleSwitchToAdmin() {
    if (switching || !adminRoleKey) return;
    setSwitching(true);
    try {
      await switchRole(adminRoleKey);
      await setLastUsedRole(adminRoleKey);
      router.replace("/(admin)/dashboard" as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }

  const load = useCallback(async () => {
    try {
      const [schedRes, ovRes] = await Promise.all([
        apiRequest(token, `/today-schedule?date=${today}`),
        apiRequest(token, "/teacher/overview"),
      ]);
      if (schedRes.ok) setItems(await schedRes.json());
      if (ovRes.ok) setOverview(await ovRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token, today]);

  useEffect(() => { load(); }, [load]);

  const pendingAtt = items.filter(i => i.student_count > 0 && i.att_present < i.student_count).length;

  function handleOpenDiaryFromMsg(_diaryId: string) {
    router.push("/(teacher)/diary" as any);
  }

  /* ── 8 아이콘 ───────────────────────────────── */
  const icons: HubIcon[] = [
    {
      key: "my-schedule",
      label: "수업관리",
      icon: "layers",
      color: themeColor,
      bg: themeColor + "18",
      onPress: () => router.push("/(teacher)/my-schedule" as any),
    },
    {
      key: "students",
      label: "회원관리",
      icon: "users",
      color: "#059669",
      bg: "#D1FAE5",
      onPress: () => router.push("/(teacher)/students" as any),
    },
    {
      key: "makeups",
      label: "보강관리",
      icon: "refresh-cw",
      color: "#7C3AED",
      bg: "#EDE9FE",
      badge: (overview?.makeup_count ?? 0) > 0 ? overview!.makeup_count : null,
      onPress: () => router.push("/(teacher)/makeups" as any),
    },
    {
      key: "note",
      label: "쪽지",
      icon: "mail",
      color: "#D97706",
      bg: "#FEF3C7",
      badge: (overview?.unread_messages ?? 0) > 0 ? overview!.unread_messages : null,
      onPress: () => setNotePopupVisible(true),
    },
    {
      key: "messenger",
      label: "메신저",
      icon: "message-circle",
      color: "#2563EB",
      bg: "#DBEAFE",
      onPress: () => router.push("/(teacher)/messenger" as any),
    },
    {
      key: "revenue",
      label: "정산",
      icon: "dollar-sign",
      color: "#0891B2",
      bg: "#CFFAFE",
      onPress: () => router.push("/(teacher)/revenue" as any),
    },
    {
      key: "my-info",
      label: "내정보",
      icon: "user",
      color: "#DB2777",
      bg: "#FCE7F3",
      onPress: () => router.push("/(teacher)/my-info" as any),
    },
    {
      key: "settings",
      label: "설정",
      icon: "settings",
      color: "#6B7280",
      bg: "#F3F4F6",
      onPress: () => router.push("/(teacher)/settings" as any),
    },
  ];

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);
  const diaryPending = items.filter(i => !i.diary_done).length;
  const sortedItems = [...items].sort((a, b) => a.schedule_time.localeCompare(b.schedule_time));
  const hasTasks = pendingAtt > 0 || diaryPending > 0 || (overview?.makeup_count ?? 0) > 0;

  return (
    <SafeAreaView style={h.safe} edges={[]}>
      {/* ── 헤더 ── */}
      <View style={[h.header, { paddingTop: topPad }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[h.poolName, { color: themeColor }]} numberOfLines={1}>
              {pool?.name ?? "수영장"}
            </Text>
            {canSwitchToAdmin && (
              <Pressable
                style={({ pressed }) => [
                  h.switchChip,
                  { borderColor: themeColor + "50", backgroundColor: themeColor + "15", opacity: pressed || switching ? 0.7 : 1 },
                ]}
                onPress={handleSwitchToAdmin}
                disabled={switching}
              >
                {switching
                  ? <ActivityIndicator size="small" color={themeColor} />
                  : <>
                      <Feather name="repeat" size={10} color={themeColor} />
                      <Text style={[h.switchChipTxt, { color: themeColor }]}>관리자로 전환</Text>
                    </>
                }
              </Pressable>
            )}
          </View>
          <Text style={h.greeting} numberOfLines={1}>
            {adminUser?.name ?? "선생님"} · 선생님
          </Text>
        </View>
        <Pressable
          onPress={logout}
          style={h.logoutBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="log-out" size={18} color="#6B7280" />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[h.scroll, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />
        }
      >
        {/* ── 오늘 날짜 배너 ── */}
        <View style={[h.todayBanner, { backgroundColor: themeColor }]}>
          <Text style={h.todayDate}>{formatDate(today)}</Text>
          <View style={h.todayStatRow}>
            <Pressable style={h.todayStat}
              onPress={() => router.push({ pathname: "/(teacher)/my-schedule", params: { openDate: today } } as any)}>
              <Text style={h.todayStatNum}>{loading ? "-" : items.length}</Text>
              <Text style={h.todayStatLabel}>오늘 수업</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat}
              onPress={() => router.push("/(teacher)/attendance" as any)}>
              <Text style={[h.todayStatNum, pendingAtt > 0 && { color: "#FFD6D6" }]}>{loading ? "-" : pendingAtt}</Text>
              <Text style={h.todayStatLabel}>출석 미체크</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat}
              onPress={() => router.push("/(teacher)/diary" as any)}>
              <Text style={[h.todayStatNum, diaryPending > 0 && { color: "#FFD6D6" }]}>{loading ? "-" : diaryPending}</Text>
              <Text style={h.todayStatLabel}>미작성 일지</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat}
              onPress={() => router.push("/(teacher)/makeups" as any)}>
              <Text style={[h.todayStatNum, (overview?.makeup_count ?? 0) > 0 && { color: "#FFD6D6" }]}>
                {loading ? "-" : (overview?.makeup_count ?? 0)}
              </Text>
              <Text style={h.todayStatLabel}>보강 대기</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 스케줄러 바로가기 ── */}
        <Pressable
          style={[h.schedCard, { backgroundColor: C.card }]}
          onPress={() => router.push("/(teacher)/my-schedule" as any)}
        >
          <View style={[h.schedIcon, { backgroundColor: themeColor + "15" }]}>
            <Feather name="calendar" size={22} color={themeColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[h.schedTitle, { color: C.text }]}>월간 스케줄러</Text>
            <Text style={h.schedSub}>수업·출결·일지·날짜 메모를 한 화면에서</Text>
          </View>
          <Feather name="chevron-right" size={18} color={themeColor} />
        </Pressable>

        {/* ── 오늘 할 일 (미처리 항목 있을 때만 표시) ── */}
        {!loading && hasTasks && (
          <View style={[h.sectionCard, { backgroundColor: C.card }]}>
            <View style={h.sectionHeaderRow}>
              <View style={[h.sectionIconBox, { backgroundColor: "#FEF3C7" }]}>
                <Feather name="alert-circle" size={13} color="#D97706" />
              </View>
              <Text style={h.sectionTitle}>오늘 할 일</Text>
            </View>
            <View style={h.taskList}>
              {pendingAtt > 0 && (
                <Pressable style={h.taskRow}
                  onPress={() => router.push("/(teacher)/attendance" as any)}>
                  <View style={[h.taskIcon, { backgroundColor: "#FEE2E2" }]}>
                    <Feather name="user-check" size={13} color="#DC2626" />
                  </View>
                  <Text style={h.taskLabel}>출석 미체크</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[h.taskBadge, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={[h.taskBadgeTxt, { color: "#DC2626" }]}>{pendingAtt}명</Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={C.textMuted} />
                </Pressable>
              )}
              {diaryPending > 0 && (
                <Pressable style={h.taskRow}
                  onPress={() => router.push("/(teacher)/diary" as any)}>
                  <View style={[h.taskIcon, { backgroundColor: "#FEF3C7" }]}>
                    <Feather name="edit-3" size={13} color="#D97706" />
                  </View>
                  <Text style={h.taskLabel}>미작성 일지</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[h.taskBadge, { backgroundColor: "#FEF3C7" }]}>
                    <Text style={[h.taskBadgeTxt, { color: "#D97706" }]}>{diaryPending}개</Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={C.textMuted} />
                </Pressable>
              )}
              {(overview?.makeup_count ?? 0) > 0 && (
                <Pressable style={h.taskRow}
                  onPress={() => router.push("/(teacher)/makeups" as any)}>
                  <View style={[h.taskIcon, { backgroundColor: "#EDE9FE" }]}>
                    <Feather name="refresh-cw" size={13} color="#7C3AED" />
                  </View>
                  <Text style={h.taskLabel}>보강 대기</Text>
                  <View style={{ flex: 1 }} />
                  <View style={[h.taskBadge, { backgroundColor: "#EDE9FE" }]}>
                    <Text style={[h.taskBadgeTxt, { color: "#7C3AED" }]}>{overview!.makeup_count}개</Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={C.textMuted} />
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* ── 오늘 수업 ── */}
        <View style={[h.sectionCard, { backgroundColor: C.card }]}>
          <View style={h.sectionHeaderRow}>
            <View style={[h.sectionIconBox, { backgroundColor: themeColor + "18" }]}>
              <Feather name="layers" size={13} color={themeColor} />
            </View>
            <Text style={h.sectionTitle}>오늘 수업</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={themeColor} style={{ paddingVertical: 20 }} />
          ) : sortedItems.length === 0 ? (
            <View style={h.emptyBox}>
              <Feather name="sun" size={28} color={C.textMuted} />
              <Text style={h.emptyTxt}>오늘 수업이 없습니다</Text>
              <Pressable style={[h.emptyBtn, { borderColor: themeColor }]}
                onPress={() => router.push("/(teacher)/my-schedule" as any)}>
                <Text style={[h.emptyBtnTxt, { color: themeColor }]}>스케줄러에서 추가</Text>
              </Pressable>
            </View>
          ) : (
            <View style={h.classList}>
              {sortedItems.map((item, idx) => {
                const attDone = item.att_present >= item.student_count && item.student_count > 0;
                const attPartial = item.att_present > 0 && !attDone;
                return (
                  <Pressable key={item.id}
                    style={[h.classRow, idx < sortedItems.length - 1 && h.classRowBorder]}
                    onPress={() => router.push({ pathname: "/(teacher)/my-schedule", params: { openDate: today } } as any)}>
                    <View style={[h.classTimeBox, { backgroundColor: themeColor + "15" }]}>
                      <Text style={[h.classTime, { color: themeColor }]}>{item.schedule_time}</Text>
                    </View>
                    <Text style={h.className} numberOfLines={1}>
                      {item.name}<Text style={h.classSub}> · {item.student_count}명</Text>
                    </Text>
                    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                      {item.att_total > 0 && (
                        <View style={[h.classBadge, {
                          backgroundColor: attDone ? "#D1FAE5" : attPartial ? "#FEF3C7" : "#FEE2E2",
                        }]}>
                          <Text style={[h.classBadgeTxt, {
                            color: attDone ? "#059669" : attPartial ? "#D97706" : "#DC2626",
                          }]}>
                            {item.att_present}/{item.student_count}
                          </Text>
                        </View>
                      )}
                      {item.diary_done && (
                        <View style={[h.classBadge, { backgroundColor: "#EDE9FE" }]}>
                          <Feather name="check" size={10} color="#7C3AED" />
                        </View>
                      )}
                      <Feather name="chevron-right" size={14} color={C.textMuted} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* ── 기능 메뉴 그리드 ── */}
        <View style={[h.gridCard, { backgroundColor: C.card }]}>
          <View style={h.grid}>
            {icons.map(ic => (
              <Pressable key={ic.key} style={h.gridItem} onPress={ic.onPress}>
                <View style={[h.gridIconWrap, { backgroundColor: ic.bg }]}>
                  <Feather name={ic.icon as any} size={24} color={ic.color} />
                  {ic.badge != null && ic.badge > 0 && (
                    <View style={h.gridBadge}>
                      <Text style={h.gridBadgeTxt}>{ic.badge > 99 ? "99+" : ic.badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={h.gridLabel} numberOfLines={1}>{ic.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* 쪽지 팝업 */}
      <UnreadMessagesModal
        visible={notePopupVisible}
        token={token}
        themeColor={themeColor}
        onClose={() => setNotePopupVisible(false)}
        onOpenDiary={handleOpenDiaryFromMsg}
      />
    </SafeAreaView>
  );
}

/* ── StyleSheets ─────────────────────────────────── */
const h = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: "#F3F4F6" },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  poolName:       { fontSize: 18, fontFamily: "Inter_700Bold" },
  greeting:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  logoutBtn:      { width: 38, height: 38, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  switchChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  switchChipTxt:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  scroll:         { padding: 12, gap: 8 },
  /* 오늘 날짜 배너 */
  todayBanner:    { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  todayDate:      { fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)" },
  todayStatRow:   { flexDirection: "row", alignItems: "center", marginTop: 4 },
  todayStat:      { flex: 1, alignItems: "center", gap: 1, paddingVertical: 2 },
  todayStatNum:   { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  todayStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.82)" },
  todayDivider:   { width: 1, height: 22, backgroundColor: "rgba(255,255,255,0.25)" },
  /* 섹션 공통 */
  sectionCard:    { borderRadius: 14, padding: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  sectionIconBox: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  sectionTitle:   { fontSize: 13, fontFamily: "Inter_700Bold", color: C.text },
  sectionMore:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  /* 오늘 할 일 */
  taskList:       { gap: 0 },
  taskRow:        { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  taskIcon:       { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  taskLabel:      { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  taskBadge:      { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  taskBadgeTxt:   { fontSize: 11, fontFamily: "Inter_700Bold" },
  /* 오늘 수업 */
  classList:      { gap: 0 },
  classRow:       { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  classRowBorder: { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  classTimeBox:   { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, minWidth: 46, alignItems: "center" },
  classTime:      { fontSize: 11, fontFamily: "Inter_700Bold" },
  className:      { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  classSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  classBadge:     { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  classBadgeTxt:  { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  /* 빈 상태 */
  emptyBox:       { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyTxt:       { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
  emptyBtn:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, marginTop: 4 },
  emptyBtnTxt:    { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  /* 스케줄러 바로가기 */
  schedCard:      { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderRadius: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  schedIcon:      { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  schedTitle:     { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  schedSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  /* 기능 메뉴 그리드 */
  gridCard:       { borderRadius: 18, padding: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  grid:           { flexDirection: "row", flexWrap: "wrap" },
  gridItem:       { width: "25%", alignItems: "center", gap: 5, paddingVertical: 8 },
  gridIconWrap:   { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", position: "relative" },
  gridBadge:      { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  gridBadgeTxt:   { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  gridLabel:      { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "center" },
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
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  backBtn:     { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  tipBox:      { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 12 },
  tipText:     { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});

const ab = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:       { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14, maxHeight: "85%" },
  handle:      { width: 36, height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  title:       { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  warnBox:     { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 14 },
  warnText:    { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  choiceBtn:   { alignItems: "center", gap: 6, padding: 18, borderRadius: 16 },
  choiceBtnText:{ fontSize: 16, fontFamily: "Inter_700Bold" },
  choiceSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },
  btn:         { height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnText:     { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sectionLabel:{ fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8, marginBottom: 4 },
  studentRow:  { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 6 },
  studentName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  studentTag:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  resultBox:   { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 16, borderRadius: 14 },
  resultText:  { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 22 },
});

const dm = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn:      { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 12 },
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
