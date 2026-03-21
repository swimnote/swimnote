/**
 * (teacher)/my-schedule.tsx — 통합 업무 스케줄러
 * 기본 진입: 월간 뷰 / 탭: 월·주·일
 * 날짜 클릭 → 날짜 상세 팝업(토글)
 * 팝업 → 반 클릭 → 반 상세 / 일지 / 보강 이동 → 같은 날짜 팝업 복귀
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, FlatList, Modal,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { addTabResetListener } from "@/utils/tabReset";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";
import StudentManagementSheet from "@/components/teacher/StudentManagementSheet";
import { WEEKLY_BADGE } from "@/utils/studentUtils";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const KO_DAY_ARR = ["일", "월", "화", "수", "목", "금", "토"];
const TIMETABLE_COLS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const COL_W = 64;
const TIME_W = 40;
const ROW_H = 56;

type ViewMode = "monthly" | "weekly" | "daily";

interface StudentItem {
  id: string; name: string; birth_year?: string | null;
  assigned_class_ids?: string[]; class_group_id?: string | null;
  weekly_count?: number; schedule_labels?: string | null;
  status?: string; parent_user_id?: string | null;
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseHour(t: string): number { return parseInt(t.split(/[:-]/)[0]) || 0; }
function parseScheduleMinutes(t: string): number {
  const parts = t.split(/[:-]/);
  return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
}
function getKoDay(dateStr: string): string {
  return KO_DAY_ARR[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}
function classesForDate(groups: TeacherClassGroup[], dateStr: string) {
  const koDay = getKoDay(dateStr);
  return groups
    .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}
function fmtHour(t: string) {
  const h = parseHour(t);
  return `${h}시`;
}
function dateLabelFull(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일 (${KO_DAY_ARR[d.getUTCDay()]})`;
}
function getHourRange(groups: TeacherClassGroup[]): number[] {
  if (!groups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
  const hours = groups.map(g => parseHour(g.schedule_time));
  const minH = Math.max(6, Math.min(...hours));
  const maxH = Math.min(22, Math.max(...hours));
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}
const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

// ─── 주간 시간표 ─────────────────────────────────────────────────
function WeeklyTimetable({ groups, onSelectClass, selectionMode, selectedIds, toggleSelect }:
  { groups: TeacherClassGroup[]; onSelectClass: (g: TeacherClassGroup) => void;
    selectionMode: boolean; selectedIds: Set<string>; toggleSelect: (id: string) => void }) {

  const hours = useMemo(() => getHourRange(groups), [groups]);
  const cellClasses = useMemo(() => {
    const map: Record<string, TeacherClassGroup[]> = {};
    TIMETABLE_COLS.forEach(day => {
      hours.forEach(h => {
        const key = `${day}-${h}`;
        map[key] = groups.filter(g => {
          const days = g.schedule_days.split(",").map(d => d.trim());
          return days.includes(day) && parseHour(g.schedule_time) === h;
        });
      });
    });
    return map;
  }, [groups, hours]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={wt.outer}>
      <View>
        <View style={wt.headerRow}>
          <View style={[wt.timeCell, wt.header]} />
          {TIMETABLE_COLS.map(day => (
            <View key={day} style={[wt.dayHeader, { width: COL_W }]}>
              <Text style={wt.dayHeaderText}>{day}</Text>
            </View>
          ))}
        </View>
        {hours.map(h => (
          <View key={h} style={[wt.row, { height: ROW_H }]}>
            <View style={wt.timeCell}><Text style={wt.timeText}>{h}:00</Text></View>
            {TIMETABLE_COLS.map(day => {
              const cls = cellClasses[`${day}-${h}`] ?? [];
              return (
                <View key={day} style={[wt.cell, { width: COL_W }]}>
                  {cls.map(g => {
                    const selected = selectedIds.has(g.id);
                    const bg = classColor(g.id);
                    return (
                      <Pressable key={g.id}
                        style={[wt.classCard, { backgroundColor: bg, opacity: selected ? 0.7 : 1 }]}
                        onPress={() => selectionMode ? toggleSelect(g.id) : onSelectClass(g)}
                        onLongPress={() => toggleSelect(g.id)}>
                        {selectionMode && (
                          <View style={[wt.checkBox, { borderColor: "#fff", backgroundColor: selected ? "#fff" : "transparent" }]}>
                            {selected && <Feather name="check" size={8} color={bg} />}
                          </View>
                        )}
                        <Text style={wt.cardName} numberOfLines={2}>{g.name}</Text>
                        <Text style={wt.cardTime} numberOfLines={1}>{g.schedule_time}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
const wt = StyleSheet.create({
  outer:        { flex: 1 },
  headerRow:    { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border },
  header:       { backgroundColor: "#F9FAFB" },
  dayHeader:    { height: 36, alignItems: "center", justifyContent: "center",
                  borderLeftWidth: 1, borderLeftColor: C.border, backgroundColor: "#F9FAFB" },
  dayHeaderText:{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text },
  row:          { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  timeCell:     { width: TIME_W, alignItems: "center", justifyContent: "flex-start",
                  paddingTop: 4, borderRightWidth: 1, borderRightColor: C.border },
  timeText:     { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textMuted },
  cell:         { borderLeftWidth: 1, borderLeftColor: "#F3F4F6", padding: 2, gap: 2 },
  classCard:    { flex: 1, borderRadius: 6, padding: 4, minHeight: 48, justifyContent: "center" },
  cardName:     { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#fff", lineHeight: 12 },
  cardTime:     { fontSize: 8, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.85)", marginTop: 2 },
  checkBox:     { position: "absolute", top: 3, right: 3, width: 14, height: 14,
                  borderRadius: 7, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
});

// ─── 월간 달력 ───────────────────────────────────────────────────
function MonthlyCalendar({
  groups, themeColor, selectedDate, onSelectDate, memoDateSet,
  selectionMode, selectedDates,
}: {
  groups: TeacherClassGroup[];
  themeColor: string;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
  memoDateSet: Set<string>;
  selectionMode?: boolean;
  selectedDates?: Set<string>;
}) {
  const today = todayDateStr();
  const { token, adminUser } = useAuth();
  const poolId = (adminUser as any)?.swimming_pool_id || "";
  const [offset, setOffset] = useState(0);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());

  const { year, month, days } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear(); const m = d.getMonth() + 1;
    const firstDay = new Date(y, m - 1, 1).getDay();
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++)
      cells.push(`${y}-${String(m).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    while (cells.length % 7 !== 0) cells.push(null);
    return { year: y, month: m, days: cells };
  }, [offset]);

  useEffect(() => {
    if (!poolId) return;
    const mm = String(month).padStart(2, "0");
    apiRequest(token, `/holidays?pool_id=${poolId}&month=${year}-${mm}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.holidays) setHolidayDates(new Set(d.holidays.map((h: any) => h.holiday_date))); })
      .catch(() => {});
  }, [token, poolId, year, month]);

  const CELL_H = Math.max(72, Math.floor((SCREEN_W - 32) / 7 * 1.1));
  const CELL_W = Math.floor((SCREEN_W - 32) / 7);
  const now = new Date();
  const nowHour = now.getHours();

  return (
    <View style={mc.root}>
      <View style={mc.monthNav}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Pressable onPress={() => setOffset(0)}>
          <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        </Pressable>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_W }]}>
            <Text style={[mc.weekHeaderText,
              i === 0 && { color: "#EF4444" },
              i === 6 && { color: themeColor },
            ]}>{wd}</Text>
          </View>
        ))}
      </View>

      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_W, height: CELL_H }]} />;
            const isToday       = dateStr === today;
            const isPast        = dateStr < today;
            const isSelected    = !selectionMode && dateStr === selectedDate;
            const isMultiPicked = selectionMode && (selectedDates?.has(dateStr) ?? false);
            const isHoliday     = holidayDates.has(dateStr);
            const cls        = classesForDate(groups, dateStr);
            const dayNum     = parseInt(dateStr.split("-")[2]);
            const isSun      = di === 0;
            const isSat      = di === 6;
            const hasMemo    = memoDateSet.has(dateStr);
            const timePills  = cls.slice(0, 3).map(g => fmtHour(g.schedule_time));
            const extraCount = cls.length - timePills.length;

            return (
              <Pressable key={dateStr}
                style={[
                  mc.dayCell, { width: CELL_W, height: CELL_H },
                  isSelected && { backgroundColor: themeColor + "18", borderRadius: 8 },
                  isMultiPicked && { backgroundColor: "#10B981" + "20", borderRadius: 8, borderWidth: 1.5, borderColor: "#10B981" },
                  isToday && !isSelected && !isMultiPicked && { backgroundColor: themeColor + "0C" },
                  isHoliday && !isMultiPicked && { backgroundColor: "#FEF2F2" },
                ]}
                onPress={() => onSelectDate(dateStr)}>

                {isMultiPicked && (
                  <View style={{ position: "absolute", top: 3, right: 3, width: 14, height: 14, borderRadius: 7,
                    backgroundColor: "#10B981", alignItems: "center", justifyContent: "center" }}>
                    <Feather name="check" size={9} color="#fff" />
                  </View>
                )}

                <View style={[mc.dayNumWrap,
                  isToday && { backgroundColor: themeColor },
                  isSelected && !isToday && { backgroundColor: themeColor + "30" },
                ]}>
                  <Text style={[mc.dayNum,
                    isSun || isHoliday ? { color: "#EF4444" } : isSat ? { color: themeColor } : {},
                    isToday && { color: "#fff" },
                  ]}>{dayNum}</Text>
                </View>

                {hasMemo && !isHoliday && (
                  <View style={mc.memoDot} />
                )}

                {isHoliday ? (
                  <Text style={mc.holidayTag}>휴무일</Text>
                ) : (
                  <View style={mc.timePills}>
                    {timePills.map((label, ti) => {
                      const pillIsPast = isPast ||
                        (isToday && parseHour(cls[ti].schedule_time) < nowHour);
                      return (
                        <View key={ti} style={[mc.timePill, { backgroundColor: classColor(cls[ti].id) + "22" }]}>
                          <Text style={[mc.timePillText, { color: classColor(cls[ti].id) }]}>{label}</Text>
                          {pillIsPast && (
                            <View style={mc.strikeOverlay} pointerEvents="none">
                              <View style={mc.strikeLine} />
                            </View>
                          )}
                        </View>
                      );
                    })}
                    {extraCount > 0 && (
                      <Text style={mc.moreTxt}>+{extraCount}</Text>
                    )}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const mc = StyleSheet.create({
  root:           { paddingHorizontal: 16, paddingBottom: 8 },
  monthNav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  navBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  monthTitle:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  weekRow:        { flexDirection: "row" },
  weekHeader:     { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  dayCell:        { alignItems: "center", paddingTop: 4, paddingHorizontal: 1 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 12, fontFamily: "Inter_500Medium", color: C.text },
  memoDot:        { width: 4, height: 4, borderRadius: 2, backgroundColor: "#F59E0B", marginTop: 1 },
  timePills:      { flexDirection: "column", alignItems: "center", gap: 1, marginTop: 2, width: "100%" },
  timePill:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, alignItems: "center" },
  timePillText:   { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  strikeOverlay:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
                    justifyContent: "center" },
  strikeLine:     { height: 1.5, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 1,
                    marginHorizontal: 1 },
  moreTxt:        { fontSize: 8, fontFamily: "Inter_400Regular", color: C.textMuted },
  holidayTag:     { fontSize: 9, fontFamily: "Inter_700Bold", color: "#EF4444", marginTop: 2 },
});

// ─── 날짜 상세 팝업 (월간 → 날짜 클릭) ──────────────────────────
function DaySheet({
  dateStr, classes, attMap, diarySet, themeColor, poolId,
  memo, onMemoChange, onSaveMemo,
  onClose, onSelectClass,
  onOpenMakeup, onAddClass,
}: {
  dateStr: string;
  classes: TeacherClassGroup[];
  attMap: Record<string, number>;
  diarySet: Set<string>;
  themeColor: string;
  poolId: string;
  memo: string;
  onMemoChange: (v: string) => void;
  onSaveMemo: () => void;
  onClose: () => void;
  onSelectClass: (g: TeacherClassGroup) => void;
  onOpenMakeup: () => void;
  onAddClass: () => void;
}) {
  const [editingMemo, setEditingMemo] = useState(false);
  const label = dateLabelFull(dateStr);

  // ── 음성 메모 상태 (다중 녹음 목록) ──
  type AudioItem = { uri: string; createdAt: string };
  const [isRecording,  setIsRecording]  = useState(false);
  const [recording,    setRecording]    = useState<Audio.Recording | null>(null);
  const [audioList,    setAudioList]    = useState<AudioItem[]>([]);
  const [sound,        setSound]        = useState<Audio.Sound | null>(null);
  const [playingUri,   setPlayingUri]   = useState<string | null>(null);

  const AUDIO_LIST_KEY = `scheduleAudioList_${poolId}_${dateStr}`;

  // 날짜 변경 시 저장된 음성 목록 로드
  useEffect(() => {
    AsyncStorage.getItem(AUDIO_LIST_KEY)
      .then(raw => setAudioList(raw ? JSON.parse(raw) : []))
      .catch(() => setAudioList([]));
    return () => { sound?.unloadAsync().catch(() => {}); };
  }, [dateStr, poolId]);

  async function saveAudioList(list: AudioItem[]) {
    setAudioList(list);
    await AsyncStorage.setItem(AUDIO_LIST_KEY, JSON.stringify(list)).catch(() => {});
  }

  async function startRecording() {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
    } catch {}
  }

  async function stopAndSaveRecording() {
    if (!recording) return;
    setIsRecording(false);
    let tempUri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      tempUri = recording.getURI();
    } catch {}
    setRecording(null);
    if (!tempUri) return;

    const ts = Date.now();
    let finalUri = tempUri;

    // 네이티브 환경에서는 영구 저장소로 복사, 웹에서는 임시 URI 그대로 사용
    try {
      if (FileSystem.documentDirectory) {
        const dest = `${FileSystem.documentDirectory}scheduleAudio_${poolId}_${dateStr}_${ts}.m4a`;
        await FileSystem.copyAsync({ from: tempUri, to: dest });
        finalUri = dest;
      }
    } catch {}

    const newItem: AudioItem = { uri: finalUri, createdAt: new Date(ts).toISOString() };
    await saveAudioList([...audioList, newItem]);
  }

  async function playAudio(uri: string) {
    try {
      if (sound) { await sound.unloadAsync(); setSound(null); setPlayingUri(null); }
      if (playingUri === uri) return; // 같은 항목 누르면 정지
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      setSound(s); setPlayingUri(uri);
      s.setOnPlaybackStatusUpdate(status => {
        if ("didJustFinish" in status && status.didJustFinish) {
          setPlayingUri(null); setSound(null);
        }
      });
    } catch {}
  }

  async function deleteAudioItem(uri: string) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    if (playingUri === uri) {
      await sound?.unloadAsync().catch(() => {}); setSound(null); setPlayingUri(null);
    }
    await saveAudioList(audioList.filter(a => a.uri !== uri));
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={dy.backdrop} onPress={onClose} />
      <View style={dy.sheet}>
        <View style={dy.handle} />

        {/* 헤더 */}
        <View style={dy.header}>
          <View style={{ flex: 1 }}>
            <Text style={dy.dateTitle}>{label}</Text>
            <Text style={dy.dateSub}>{classes.length > 0 ? `수업 ${classes.length}개` : "수업 없음"}</Text>
          </View>
          <View style={dy.headerActions}>
            <Pressable style={[dy.headerBtn, { backgroundColor: "#EEF2FF" }]} onPress={onOpenMakeup}>
              <Feather name="repeat" size={13} color="#4338CA" />
              <Text style={[dy.headerBtnTxt, { color: "#4338CA" }]}>보강</Text>
            </Pressable>
            <Pressable style={[dy.headerBtn, { backgroundColor: themeColor }]} onPress={onAddClass}>
              <Feather name="plus" size={13} color="#fff" />
              <Text style={[dy.headerBtnTxt, { color: "#fff" }]}>수업 추가</Text>
            </Pressable>
            <Pressable onPress={onClose} style={dy.closeBtn}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}>

          {/* 수업 없음 */}
          {classes.length === 0 && (
            <View style={dy.emptyBox}>
              <Feather name="calendar" size={32} color={C.textMuted} />
              <Text style={dy.emptyTxt}>이 날은 수업이 없습니다</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Pressable style={[dy.emptyAction, { borderColor: "#4338CA" }]} onPress={onOpenMakeup}>
                  <Feather name="repeat" size={13} color="#4338CA" />
                  <Text style={[dy.emptyActionTxt, { color: "#4338CA" }]}>보강 추가</Text>
                </Pressable>
                <Pressable style={[dy.emptyAction, { borderColor: themeColor }]}
                  onPress={() => { onClose(); setTimeout(onAddClass, 200); }}>
                  <Feather name="plus-circle" size={13} color={themeColor} />
                  <Text style={[dy.emptyActionTxt, { color: themeColor }]}>수업 추가</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* 수업 리스트 (시간순, 완료 = 취소선) */}
          {classes.length > 0 && (
            <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
              {classes.map(g => {
                const diarDone = diarySet.has(g.id);
                const attCnt   = attMap[g.id] || 0;
                const done     = diarDone;
                const color    = classColor(g.id);
                return (
                  <Pressable key={g.id} style={[dy.classCard, done && dy.classCardDone]}
                    onPress={() => onSelectClass(g)}>
                    <View style={[dy.colorBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={[dy.classTime, done && dy.strikeText]}>
                          {g.schedule_time}
                        </Text>
                        <Text style={[dy.className, done && dy.strikeText]} numberOfLines={1}>
                          {g.name}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                        <Text style={[dy.classSub, done && { color: C.textMuted }]}>
                          {g.student_count}명
                        </Text>
                        {attCnt > 0 && (
                          <View style={dy.attBadge}>
                            <Feather name="check" size={9} color="#059669" />
                            <Text style={dy.attBadgeTxt}>출결 {attCnt}</Text>
                          </View>
                        )}
                        {diarDone && (
                          <View style={dy.diaryBadge}>
                            <Feather name="edit-3" size={9} color="#7C3AED" />
                            <Text style={dy.diaryBadgeTxt}>일지 완료</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <Feather name="chevron-right" size={16} color={done ? C.textMuted : C.textSecondary} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* 날짜 메모 */}
          <View style={dy.memoSection}>
            <View style={dy.memoHeader}>
              <Feather name="file-text" size={14} color={C.textSecondary} />
              <Text style={dy.memoLabel}>날짜 메모</Text>
              {!editingMemo && (
                <Pressable onPress={() => setEditingMemo(true)} style={dy.memoEditBtn}>
                  <Text style={[dy.memoEditBtnTxt, { color: themeColor }]}>
                    {memo ? "수정" : "추가"}
                  </Text>
                </Pressable>
              )}
            </View>
            {editingMemo ? (
              <View style={dy.memoEditArea}>
                <TextInput
                  style={dy.memoInput}
                  value={memo}
                  onChangeText={onMemoChange}
                  placeholder="학부모 요청, 행사, 준비물 등..."
                  placeholderTextColor={C.textMuted}
                  multiline
                  autoFocus
                />
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Pressable style={dy.memoCancelBtn} onPress={() => setEditingMemo(false)}>
                    <Text style={dy.memoCancelBtnTxt}>취소</Text>
                  </Pressable>
                  <Pressable style={[dy.memoSaveBtn, { backgroundColor: themeColor }]}
                    onPress={() => { onSaveMemo(); setEditingMemo(false); }}>
                    <Text style={dy.memoSaveBtnTxt}>저장</Text>
                  </Pressable>
                </View>
              </View>
            ) : memo ? (
              <Text style={dy.memoContent}>{memo}</Text>
            ) : (
              <Text style={dy.memoEmpty}>메모 없음</Text>
            )}

            {/* 음성 메모 */}
            <View style={dy.audioDivider} />
            <View style={dy.audioRow}>
              <Feather name="mic" size={13} color={C.textSecondary} />
              <Text style={dy.audioLabel}>음성 메모</Text>
              <View style={{ flex: 1 }} />
              {isRecording ? (
                <Pressable style={[dy.audioBtn, { backgroundColor: "#FEE2E2" }]}
                  onPress={stopAndSaveRecording}>
                  <Feather name="stop-circle" size={15} color="#EF4444" />
                  <Text style={[dy.audioBtnTxt, { color: "#EF4444" }]}>저장</Text>
                </Pressable>
              ) : (
                <Pressable style={[dy.audioBtn, { backgroundColor: themeColor + "1A" }]}
                  onPress={startRecording}>
                  <Feather name="mic" size={15} color={themeColor} />
                  <Text style={[dy.audioBtnTxt, { color: themeColor }]}>녹음</Text>
                </Pressable>
              )}
            </View>
            {isRecording && (
              <View style={dy.recordingIndicator}>
                <View style={dy.recordingDot} />
                <Text style={dy.recordingTxt}>녹음 중... (저장을 눌러 완료)</Text>
              </View>
            )}
            {/* 녹음 목록 */}
            {audioList.length > 0 && (
              <View style={dy.audioListBox}>
                {audioList.map((item, idx) => {
                  const isThis = playingUri === item.uri;
                  const t = new Date(item.createdAt);
                  const timeLabel = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`;
                  return (
                    <View key={item.uri} style={dy.audioListItem}>
                      <Feather name="file-text" size={13} color="#92400E" style={{ transform: [{ rotate: "0deg" }] }} />
                      <Text style={dy.audioListLabel}>녹음 {idx + 1}  <Text style={dy.audioListTime}>{timeLabel}</Text></Text>
                      <View style={{ flex: 1 }} />
                      <Pressable
                        style={[dy.audioPlayBtn, isThis && { backgroundColor: themeColor + "30" }]}
                        onPress={() => playAudio(item.uri)}>
                        <Feather name={isThis ? "volume-2" : "play"} size={14}
                          color={isThis ? themeColor : "#059669"} />
                        <Text style={[dy.audioBtnTxt, { color: isThis ? themeColor : "#059669" }]}>
                          {isThis ? "재생중" : "재생"}
                        </Text>
                      </Pressable>
                      <Pressable style={dy.audioDelBtn} onPress={() => deleteAudioItem(item.uri)}>
                        <Feather name="trash-2" size={13} color="#EF4444" />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const dy = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet:          { position: "absolute", bottom: 0, left: 0, right: 0,
                    backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22,
                    maxHeight: "78%", paddingBottom: 8 },
  handle:         { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                    alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:         { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16,
                    paddingVertical: 10, gap: 8 },
  dateTitle:      { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  dateSub:        { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  headerActions:  { flexDirection: "row", alignItems: "center", gap: 6 },
  headerBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                    paddingVertical: 7, borderRadius: 10 },
  headerBtnTxt:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  closeBtn:       { padding: 4, marginLeft: 2 },
  emptyBox:       { alignItems: "center", paddingVertical: 32, gap: 6 },
  emptyTxt:       { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  emptyAction:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14,
                    paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  emptyActionTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  classCard:      { flexDirection: "row", alignItems: "center", gap: 10,
                    backgroundColor: "#F9FAFB", borderRadius: 12, padding: 12,
                    borderWidth: 1, borderColor: C.border },
  classCardDone:  { backgroundColor: "#F3F4F6", borderColor: "#E5E7EB", opacity: 0.8 },
  colorBar:       { width: 3, height: 40, borderRadius: 2 },
  classTime:      { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  className:      { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text, flex: 1 },
  strikeText:     { textDecorationLine: "line-through", color: C.textMuted },
  classSub:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  attBadge:       { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6,
                    paddingVertical: 2, borderRadius: 6, backgroundColor: "#D1FAE5" },
  attBadgeTxt:    { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#059669" },
  diaryBadge:     { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6,
                    paddingVertical: 2, borderRadius: 6, backgroundColor: "#EDE9FE" },
  diaryBadgeTxt:  { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#7C3AED" },
  memoSection:    { marginHorizontal: 16, padding: 14, backgroundColor: "#FFFBEB",
                    borderRadius: 12, borderWidth: 1, borderColor: "#FDE68A" },
  memoHeader:     { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  memoLabel:      { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E", flex: 1 },
  memoEditBtn:    { paddingHorizontal: 8, paddingVertical: 2 },
  memoEditBtnTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  memoContent:    { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 20 },
  memoEmpty:      { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted, fontStyle: "italic" },
  memoEditArea:   { gap: 4 },
  memoInput:      { borderWidth: 1, borderColor: "#FDE68A", borderRadius: 8, padding: 10,
                    fontSize: 14, fontFamily: "Inter_400Regular", color: C.text,
                    backgroundColor: "#fff", minHeight: 80, textAlignVertical: "top" },
  memoCancelBtn:  { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: "#F3F4F6",
                    alignItems: "center" },
  memoCancelBtnTxt:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  memoSaveBtn:    { flex: 2, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  memoSaveBtnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  // 음성 메모
  audioDivider:   { height: 1, backgroundColor: "#FDE68A", marginVertical: 10 },
  audioRow:       { flexDirection: "row", alignItems: "center", gap: 6 },
  audioLabel:     { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  audioBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                    paddingVertical: 6, borderRadius: 8 },
  audioBtnTxt:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  audioDelBtn:    { width: 28, height: 28, alignItems: "center", justifyContent: "center",
                    borderRadius: 7, backgroundColor: "#FEE2E2" },
  audioPlayBtn:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8,
                    paddingVertical: 5, borderRadius: 7, backgroundColor: "#F0FDF4" },
  recordingIndicator: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  recordingDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  recordingTxt:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#EF4444" },
  audioListBox:   { marginTop: 10, gap: 6 },
  audioListItem:  { flexDirection: "row", alignItems: "center", gap: 6,
                    backgroundColor: "#FFFBEB", borderRadius: 8, padding: 8,
                    borderWidth: 1, borderColor: "#FDE68A" },
  audioListLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  audioListTime:  { fontSize: 11, fontFamily: "Inter_400Regular", color: "#B45309" },
});

// ─── 반 상세 시트 (주간 뷰 클릭용) ─────────────────────────────
function ClassDetailSheet({ group, students, attMap, diarySet, themeColor, onClose, onOpenUnreg, onOpenRemove, onOpenExtra }:
  { group: TeacherClassGroup; students: StudentItem[]; attMap: Record<string,number>;
    diarySet: Set<string>; themeColor: string; onClose: () => void;
    onOpenUnreg?: () => void; onOpenRemove?: () => void; onOpenExtra?: () => void }) {

  const groupStudents = students.filter(st =>
    (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
    || st.class_group_id === group.id
  ).sort((a, b) => a.name.localeCompare(b.name));

  const attDone  = (attMap[group.id] || 0) >= group.student_count && group.student_count > 0;
  const diarDone = diarySet.has(group.id);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={cds.backdrop} onPress={onClose} />
      <View style={cds.sheet}>
        <View style={cds.handle} />
        <View style={cds.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={cds.sheetTitle}>{group.name}</Text>
            <Text style={cds.sheetSub}>{group.schedule_days.split(",").join("·")} · {group.schedule_time}</Text>
          </View>
          <Pressable onPress={onClose} style={cds.closeBtn}>
            <Feather name="x" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
        <View style={cds.actionRow}>
          <Pressable style={[cds.actionBtn, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}
            onPress={() => { onClose(); router.push({ pathname:"/(teacher)/attendance", params:{classGroupId: group.id} } as any); }}>
            <Feather name="check-square" size={13} color={attDone ? "#059669" : "#DC2626"} />
            <Text style={[cds.actionText, { color: attDone ? "#059669" : "#DC2626" }]}>출결</Text>
          </Pressable>
          <Pressable style={[cds.actionBtn, { backgroundColor: diarDone ? "#D1FAE5" : "#FEF3C7" }]}
            onPress={() => { onClose(); router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name} } as any); }}>
            <Feather name="edit-3" size={13} color={diarDone ? "#059669" : "#D97706"} />
            <Text style={[cds.actionText, { color: diarDone ? "#059669" : "#D97706" }]}>수업일지</Text>
          </Pressable>
          <Pressable style={[cds.actionBtn, { backgroundColor: "#EEF2FF" }]}
            onPress={() => { onClose(); router.push(`/class-assign?classId=${group.id}` as any); }}>
            <Feather name="users" size={13} color="#4338CA" />
            <Text style={[cds.actionText, { color: "#4338CA" }]}>반배정</Text>
          </Pressable>
          <Pressable style={[cds.actionBtn, { backgroundColor: "#FEF9C3" }]}
            onPress={() => { onClose(); setTimeout(() => onOpenExtra?.(), 200); }}>
            <Feather name="plus-circle" size={13} color="#CA8A04" />
            <Text style={[cds.actionText, { color: "#CA8A04" }]}>기타수업</Text>
          </Pressable>
          <Pressable style={[cds.actionBtn, { backgroundColor: "#F0FDF4" }]}
            onPress={() => { onClose(); setTimeout(() => onOpenUnreg?.(), 200); }}>
            <Feather name="user-plus" size={13} color="#059669" />
            <Text style={[cds.actionText, { color: "#059669" }]}>미등록</Text>
          </Pressable>
          <Pressable style={[cds.actionBtn, { backgroundColor: "#FFF1F2" }]}
            onPress={() => { onClose(); setTimeout(() => onOpenRemove?.(), 200); }}>
            <Feather name="log-out" size={13} color="#E11D48" />
            <Text style={[cds.actionText, { color: "#E11D48" }]}>반이동</Text>
          </Pressable>
        </View>
        <Text style={cds.sectionLabel}>학생 목록</Text>
        <ScrollView style={cds.studentScroll} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={cds.empty}>
              <Feather name="users" size={28} color={C.textMuted} />
              <Text style={cds.emptyText}>배정된 학생이 없습니다</Text>
            </View>
          ) : groupStudents.map(st => {
            const wc = Math.min(st.weekly_count || 1, 3) as 1 | 2 | 3;
            const wb = WEEKLY_BADGE[wc];
            return (
              <Pressable key={st.id} style={cds.studentRow}
                onPress={() => { onClose(); setTimeout(() => router.push({ pathname:"/(teacher)/student-detail", params:{id: st.id} } as any), 200); }}>
                <View style={[cds.avatar, { backgroundColor: themeColor + "18" }]}>
                  <Text style={[cds.avatarText, { color: themeColor }]}>{st.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection:"row", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <Text style={cds.studentName}>{st.name}</Text>
                    <View style={[cds.weeklyBadge, { backgroundColor: wb.bg }]}>
                      <Text style={[cds.weeklyBadgeText, { color: wb.color }]}>{wb.label}</Text>
                    </View>
                  </View>
                  {st.birth_year && <Text style={cds.studentSub}>{st.birth_year}년생</Text>}
                </View>
                <Feather name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            );
          })}
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}
const cds = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:        { position: "absolute", bottom: 0, left: 0, right: 0,
                  backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                  maxHeight: "75%", paddingBottom: 32 },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB",
                  alignSelf: "center", marginTop: 10, marginBottom: 4 },
  sheetHeader:  { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  sheetTitle:   { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sheetSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  closeBtn:     { padding: 4 },
  actionRow:    { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
                  paddingVertical: 8, borderRadius: 10 },
  actionText:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted,
                  paddingHorizontal: 16, marginBottom: 6 },
  studentScroll:{ flexShrink: 1 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 16, paddingVertical: 10,
                  borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  avatar:       { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  studentName:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  weeklyBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  weeklyBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  empty:        { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText:    { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
});

// ─── 기타 수업 생성 모달 ──────────────────────────────────────────
function ExtraClassModal({ token, poolId, group, groupStudents, onClose, onCreated }: {
  token: string | null; poolId: string; group: TeacherClassGroup;
  groupStudents: StudentItem[]; onClose: () => void; onCreated: () => void;
}) {
  const { themeColor } = useBrand();
  const [className, setClassName] = useState(group.name + " 기타수업");
  const [classDate, setClassDate] = useState(todayDateStr());
  const [classTime, setClassTime] = useState(group.schedule_time || "09:00");
  const [notes, setNotes]         = useState("");
  const [isFifthWeek, setIsFifthWeek] = useState(false);
  const [selectedStuIds, setSelectedStuIds] = useState<Set<string>>(new Set());
  const [unreg, setUnreg]         = useState("");
  const [unregNames, setUnregNames] = useState<string[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  function toggleStu(id: string) {
    setSelectedStuIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function addUnreg() {
    const name = unreg.trim(); if (!name) return;
    setUnregNames(prev => [...prev, name]); setUnreg("");
  }
  async function handleCreate() {
    if (!className.trim() || !classDate || !classTime) { setError("수업명·날짜·시간을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/extra-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pool_id: poolId, class_name: className.trim(), class_date: classDate,
          class_time: classTime, student_ids: Array.from(selectedStuIds),
          unregistered_names: unregNames, is_fifth_week: isFifthWeek, notes: notes.trim() || null }),
      });
      if (res.ok) { onCreated(); onClose(); }
      else { const d = await res.json(); setError(d.error || "생성 실패"); }
    } catch { setError("네트워크 오류"); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={em.backdrop} onPress={onClose} />
      <View style={em.sheet}>
        <View style={em.handle} />
        <View style={em.header}>
          <Text style={em.title}>기타 수업 추가</Text>
          <Pressable onPress={onClose}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          <View style={em.field}>
            <Text style={em.label}>수업명 *</Text>
            <TextInput style={em.input} value={className} onChangeText={setClassName} placeholder="수업명" placeholderTextColor={C.textMuted} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={[em.field, { flex: 1 }]}>
              <Text style={em.label}>날짜 *</Text>
              <TextInput style={em.input} value={classDate} onChangeText={setClassDate} placeholder="YYYY-MM-DD" placeholderTextColor={C.textMuted} />
            </View>
            <View style={[em.field, { width: 100 }]}>
              <Text style={em.label}>시간 *</Text>
              <TextInput style={em.input} value={classTime} onChangeText={setClassTime} placeholder="09:00" placeholderTextColor={C.textMuted} />
            </View>
          </View>
          <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 8 }} onPress={() => setIsFifthWeek(!isFifthWeek)}>
            <View style={[em.checkbox, isFifthWeek && { backgroundColor: themeColor, borderColor: themeColor }]}>
              {isFifthWeek && <Feather name="check" size={12} color="#fff" />}
            </View>
            <Text style={em.label}>5주차 수업</Text>
          </Pressable>
          {groupStudents.length > 0 && (
            <View style={em.field}>
              <Text style={em.label}>참가 학생</Text>
              {groupStudents.map(st => (
                <Pressable key={st.id} style={em.stuRow} onPress={() => toggleStu(st.id)}>
                  <View style={[em.checkbox, selectedStuIds.has(st.id) && { backgroundColor: themeColor, borderColor: themeColor }]}>
                    {selectedStuIds.has(st.id) && <Feather name="check" size={12} color="#fff" />}
                  </View>
                  <Text style={em.stuName}>{st.name}</Text>
                  {st.birth_year && <Text style={em.stuSub}>{st.birth_year}년생</Text>}
                </Pressable>
              ))}
            </View>
          )}
          <View style={em.field}>
            <Text style={em.label}>미등록 회원 추가</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[em.input, { flex: 1 }]} value={unreg} onChangeText={setUnreg} placeholder="이름 입력" placeholderTextColor={C.textMuted} onSubmitEditing={addUnreg} returnKeyType="done" />
              <Pressable style={[em.addBtn, { backgroundColor: themeColor }]} onPress={addUnreg}>
                <Feather name="plus" size={16} color="#fff" />
              </Pressable>
            </View>
            {unregNames.map((n, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                <Text style={em.stuName}>{n}</Text>
                <Pressable onPress={() => setUnregNames(prev => prev.filter((_, j) => j !== i))}>
                  <Feather name="x" size={14} color={C.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
          <View style={em.field}>
            <Text style={em.label}>메모</Text>
            <TextInput style={[em.input, { height: 72, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} placeholder="특이사항..." placeholderTextColor={C.textMuted} multiline />
          </View>
          {error ? <Text style={em.error}>{error}</Text> : null}
          <Pressable style={[em.createBtn, { backgroundColor: themeColor, opacity: saving ? 0.6 : 1 }]} onPress={handleCreate} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={em.createBtnText}>기타 수업 등록</Text>}
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
const em = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
                 borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%", paddingBottom: 0 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title:       { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  field:       { gap: 6 },
  label:       { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  input:       { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
                 fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, backgroundColor: "#F9FAFB" },
  checkbox:    { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border,
                 backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  stuRow:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  stuName:     { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  stuSub:      { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  addBtn:      { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  createBtn:   { paddingVertical: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createBtnText:{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  error:       { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626", textAlign: "center" },
});

// ─── 메인 스크린 ─────────────────────────────────────────────────
export default function MyScheduleScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const params = useLocalSearchParams<{ openDate?: string }>();
  const selfTeacher = adminUser ? { id: adminUser.id, name: adminUser.name || "나" } : undefined;
  const poolId = (adminUser as any)?.swimming_pool_id || "";

  const [viewMode,      setViewMode]      = useState<ViewMode>("monthly");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const [groups,    setGroups]    = useState<TeacherClassGroup[]>([]);
  const [students,  setStudents]  = useState<StudentItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createInitialDays, setCreateInitialDays] = useState<string[]>([]);
  const [createInitialStep, setCreateInitialStep] = useState<1|2|3|4>(1);
  const [deleting,   setDeleting]   = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteFailCount,   setDeleteFailCount]   = useState(0);
  const [showManagement, setShowManagement] = useState(false);

  // 날짜 팝업 토글
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 선택 날짜의 출결/일지 데이터
  const [dayAttMap, setDayAttMap] = useState<Record<string, number>>({});
  const [dayDiarySet, setDayDiarySet] = useState<Set<string>>(new Set());

  // 날짜 메모 (AsyncStorage)
  const [dayMemo, setDayMemo] = useState("");
  const [memoDateSet, setMemoDateSet] = useState<Set<string>>(new Set());

  // 주간/일간 용 공통 오늘 데이터
  const [todayAttMap, setTodayAttMap] = useState<Record<string, number>>({});
  const [todayDiarySet, setTodayDiarySet] = useState<Set<string>>(new Set());

  // 서브 모달
  const [detailGroup,       setDetailGroup]       = useState<TeacherClassGroup | null>(null);
  const [showExtraModal,    setShowExtraModal]    = useState(false);
  const [extraGroupForModal,setExtraGroupForModal]= useState<TeacherClassGroup | null>(null);
  const [unregClassId,      setUnregClassId]      = useState<string | null>(null);
  const [removeClassGroup,  setRemoveClassGroup]  = useState<TeacherClassGroup | null>(null);

  // 일간 뷰 서브 선택 그룹
  const [selectedGroup, setSelectedGroup] = useState<TeacherClassGroup | null>(null);

  // 최초 마운트 여부 (useFocusEffect skip)
  const isMountedRef = useRef(false);
  // openDate 파라미터 자동 오픈 처리 여부
  const autoOpenDoneRef = useRef(false);

  // ── 기본 데이터 로드 ──
  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, stRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (cgRes.ok)  setGroups(await cgRes.json());
      if (stRes.ok)  setStudents(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string,number> = {};
        arr.forEach(a => { const cid = a.class_group_id||a.class_id; if (cid) map[cid]=(map[cid]||0)+1; });
        setTodayAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setTodayDiarySet(new Set(arr.map((d:any) => d.class_group_id).filter(Boolean)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ── openDate 파라미터: 홈에서 특정 날짜 팝업 자동 오픈 ──
  useEffect(() => {
    if (!loading && params.openDate && typeof params.openDate === "string" && !autoOpenDoneRef.current) {
      autoOpenDoneRef.current = true;
      setViewMode("monthly");
      handleDatePress(params.openDate);
    }
  }, [loading, params.openDate]);

  // ── 날짜별 출결/일지 로드 ──
  async function loadDayData(dateStr: string) {
    try {
      const [attRes, dRes] = await Promise.all([
        apiRequest(token, `/attendance?date=${dateStr}`),
        apiRequest(token, `/diary?date=${dateStr}`),
      ]);
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string,number> = {};
        arr.forEach(a => { const cid = a.class_group_id||a.class_id; if (cid) map[cid]=(map[cid]||0)+1; });
        setDayAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDayDiarySet(new Set(arr.map((d:any) => d.class_group_id).filter(Boolean)));
      }
    } catch {}
  }

  // ── 날짜 메모 로드/저장 ──
  async function loadMemo(dateStr: string) {
    const key = `scheduleMemo_${poolId}_${dateStr}`;
    const v = await AsyncStorage.getItem(key).catch(() => null);
    setDayMemo(v || "");
  }
  async function saveMemo(dateStr: string, text: string) {
    const key = `scheduleMemo_${poolId}_${dateStr}`;
    if (text.trim()) {
      await AsyncStorage.setItem(key, text).catch(() => {});
      setMemoDateSet(prev => new Set([...prev, dateStr]));
    } else {
      await AsyncStorage.removeItem(key).catch(() => {});
      setMemoDateSet(prev => { const n = new Set(prev); n.delete(dateStr); return n; });
    }
  }

  // ── 날짜 클릭 ——  선택모드: 날짜 다중선택  /  일반: 날짜 팝업 열기
  function handleDatePress(dateStr: string) {
    if (selectionMode) {
      setSelectedDates(prev => {
        const next = new Set(prev);
        next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
        return next;
      });
      return;
    }
    if (selectedDate === dateStr) {
      setSelectedDate(null);
    } else {
      setSelectedDate(dateStr);
      loadDayData(dateStr);
      loadMemo(dateStr);
    }
  }

  // ── DaySheet에서 반 클릭 → 반 상세 or 바로 출결/일지 등 이동 ──
  function handleDaySheetClassPress(g: TeacherClassGroup) {
    // 반 상세를 선택 날짜와 함께 보여주는 sub sheet
    setDetailGroup(g);
  }

  // ── DaySheet에서 보강 클릭 ──
  function handleDaySheetMakeup() {
    router.push("/(teacher)/makeups" as any);
  }

  // ── 포커스 복귀 시 날짜 데이터 갱신 (반 상세 / 일지 / 보강 작업 후) ──
  useFocusEffect(useCallback(() => {
    if (!isMountedRef.current) { isMountedRef.current = true; return; }
    // 학생 데이터 새로고침
    apiRequest(token, "/students").then(r => r.ok && r.json()).then(data => {
      if (Array.isArray(data)) setStudents(data);
    }).catch(() => {});
    // 선택 날짜가 있으면 해당 날짜 데이터 갱신
    if (selectedDate) {
      loadDayData(selectedDate);
      loadMemo(selectedDate);
    }
  }, [token, selectedDate]));

  // ── 탭 재탭 초기화 ──
  useEffect(() => {
    return addTabResetListener("my-schedule", () => {
      setSelectedGroup(null);
      setDetailGroup(null);
      setSelectedDate(null);
      setSelectionMode(false);
      setSelectedIds(new Set());
      setSelectedDates(new Set());
      setViewMode("monthly");
    });
  }, []);

  const groupStudents = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = {
      attChecked: todayAttMap[g.id] || 0,
      diaryDone:  todayDiarySet.has(g.id),
      hasPhotos:  false,
    };
  });

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  async function confirmDelete() {
    setShowDeleteConfirm(false); setDeleting(true);
    const ids = Array.from(selectedIds); let failed = 0;
    for (const id of ids) { const res = await apiRequest(token, `/class-groups/${id}`, { method: "DELETE" }); if (!res.ok) failed++; }
    setDeleting(false); setSelectionMode(false); setSelectedIds(new Set());
    if (failed > 0) setDeleteFailCount(failed);
    load();
  }
  async function confirmDeleteMemos() {
    setShowDeleteConfirm(false); setDeleting(true);
    for (const dateStr of Array.from(selectedDates)) {
      await AsyncStorage.removeItem(`scheduleMemo_${poolId}_${dateStr}`).catch(() => {});
      await AsyncStorage.removeItem(`scheduleAudioList_${poolId}_${dateStr}`).catch(() => {});
    }
    setMemoDateSet(prev => {
      const next = new Set(prev);
      selectedDates.forEach(d => next.delete(d));
      return next;
    });
    setDeleting(false); setSelectionMode(false); setSelectedDates(new Set());
  }

  // ─ 로딩 ─
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title="스케줄러" homePath="/(teacher)/today-schedule" />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ─ 일간 뷰 서브뷰 ─
  if (viewMode === "daily" && selectedGroup) {
    const g = selectedGroup;
    const attDone  = (todayAttMap[g.id] || 0) >= g.student_count && g.student_count > 0;
    const diarDone = todayDiarySet.has(g.id);
    return (
      <SafeAreaView style={s.safe} edges={[]}>
        <SubScreenHeader title={g.name} subtitle={`${g.schedule_days} · ${g.schedule_time}`}
          onBack={() => setSelectedGroup(null)} homePath="/(teacher)/today-schedule" />
        <View style={s.subHeader}>
          <Pressable style={[s.subActionBtn, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}
            onPress={() => router.push({ pathname:"/(teacher)/attendance", params:{classGroupId: g.id} } as any)}>
            <Feather name="check-square" size={13} color={attDone ? "#059669" : "#DC2626"} />
            <Text style={[s.subActionText, { color: attDone ? "#059669" : "#DC2626" }]}>출결</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: diarDone ? "#D1FAE5" : "#FEF3C7" }]}
            onPress={() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: g.id, className: g.name} } as any)}>
            <Feather name="edit-3" size={13} color={diarDone ? "#059669" : "#D97706"} />
            <Text style={[s.subActionText, { color: diarDone ? "#059669" : "#D97706" }]}>수업일지</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: "#EEF2FF" }]}
            onPress={() => router.push(`/class-assign?classId=${g.id}` as any)}>
            <Feather name="users" size={13} color="#4338CA" />
            <Text style={[s.subActionText, { color: "#4338CA" }]}>반배정</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: "#FEF9C3" }]}
            onPress={() => setShowExtraModal(true)}>
            <Feather name="plus-circle" size={13} color="#CA8A04" />
            <Text style={[s.subActionText, { color: "#CA8A04" }]}>기타수업</Text>
          </Pressable>
        </View>
        {showExtraModal && poolId && (
          <ExtraClassModal token={token} poolId={poolId} group={g} groupStudents={groupStudents}
            onClose={() => setShowExtraModal(false)}
            onCreated={() => { setShowExtraModal(false); load(); }} />
        )}
        <FlatList data={groupStudents} keyExtractor={i => i.id}
          contentContainerStyle={s.studentList} showsVerticalScrollIndicator={false}
          ListEmptyComponent={<View style={s.emptyBox}><Feather name="users" size={32} color={C.textMuted} /><Text style={s.emptyText}>배정된 학생이 없습니다</Text></View>}
          ListHeaderComponent={<Text style={s.listHeader}>학생 {groupStudents.length}명</Text>}
          renderItem={({ item }) => {
            const wc = Math.min(item.weekly_count || 1, 3) as 1 | 2 | 3;
            const wb = WEEKLY_BADGE[wc];
            return (
              <Pressable style={[s.studentRow, { backgroundColor: C.card }]}
                onPress={() => router.push({ pathname:"/(teacher)/student-detail", params:{id: item.id} } as any)}>
                <View style={[s.avatar, { backgroundColor: themeColor + "18" }]}>
                  <Text style={[s.avatarText, { color: themeColor }]}>{item.name[0]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection:"row", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <Text style={s.studentName}>{item.name}</Text>
                    <View style={[s.weeklyBadge, { backgroundColor: wb.bg }]}>
                      <Text style={[s.weeklyBadgeText, { color: wb.color }]}>{wb.label}</Text>
                    </View>
                  </View>
                  {item.birth_year && <Text style={s.studentSub}>{item.birth_year}년생 · {item.schedule_labels||""}</Text>}
                </View>
                {item.parent_user_id ? (
                  <View style={[s.connBadge, { backgroundColor: "#D1FAE5" }]}>
                    <Feather name="check-circle" size={10} color="#059669" />
                    <Text style={[s.connText, { color: "#059669" }]}>연결</Text>
                  </View>
                ) : item.status === "pending_parent_link" ? (
                  <View style={[s.connBadge, { backgroundColor: "#FFF7ED" }]}>
                    <Feather name="clock" size={10} color="#EA580C" />
                    <Text style={[s.connText, { color: "#EA580C" }]}>대기</Text>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={16} color={C.textMuted} />
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    );
  }

  const dayClasses = selectedDate ? classesForDate(groups, selectedDate) : [];

  // ─ 메인 뷰 ─
  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <SubScreenHeader title="스케줄러" homePath="/(teacher)/today-schedule" />

      {/* 헤더 영역 */}
      <View style={s.titleArea}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>수업 스케줄러</Text>
            <Text style={s.titleSub}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
            </Text>
          </View>
          <View style={s.rightBtns}>
            {selectionMode ? (
              <>
                <Pressable style={[s.selBtn, { backgroundColor: selectedDates.size > 0 ? "#EF4444" : "#9CA3AF" }]}
                  onPress={() => { if (selectedDates.size > 0) setShowDeleteConfirm(true); }}
                  disabled={deleting || selectedDates.size === 0}>
                  {deleting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Feather name="trash-2" size={13} color="#fff" /><Text style={s.selBtnText}>메모삭제{selectedDates.size > 0 ? ` (${selectedDates.size})` : ""}</Text></>}
                </Pressable>
                <Pressable style={[s.selBtn, { backgroundColor: "#6B7280" }]}
                  onPress={() => { setSelectionMode(false); setSelectedIds(new Set()); setSelectedDates(new Set()); }}>
                  <Text style={s.selBtnText}>취소</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={[s.selBtn, { backgroundColor: "#F3F4F6" }]} onPress={() => setSelectionMode(true)}>
                  <Feather name="check-square" size={13} color={C.textSecondary} />
                  <Text style={[s.selBtnText, { color: C.textSecondary }]}>선택</Text>
                </Pressable>
                <Pressable style={[s.mgmtBtn, { borderColor: themeColor }]} onPress={() => setShowManagement(true)}>
                  <Feather name="users" size={13} color={themeColor} />
                  <Text style={[s.mgmtBtnText, { color: themeColor }]}>수강생관리</Text>
                </Pressable>
                <Pressable style={[s.createBtn, { backgroundColor: themeColor }]} onPress={() => { setCreateInitialDays([]); setCreateInitialStep(1); setShowCreate(true); }}>
                  <Feather name="plus" size={14} color="#fff" />
                  <Text style={s.createBtnText}>반 등록</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* 뷰 탭: 월/주/일 */}
        <View style={s.controlRow}>
          <View style={s.viewToggle}>
            {(["monthly","weekly","daily"] as ViewMode[]).map(mode => {
              const labels = { monthly: "월", weekly: "주", daily: "일" };
              const isActive = viewMode === mode;
              return (
                <Pressable key={mode}
                  style={[s.toggleBtn, isActive && { backgroundColor: themeColor, borderColor: themeColor }]}
                  onPress={() => { setViewMode(mode); setSelectionMode(false); setSelectedIds(new Set()); setSelectedDates(new Set()); if (mode !== "monthly") setSelectedDate(null); }}>
                  <Text style={[s.toggleText, isActive && { color: "#fff" }]}>{labels[mode]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable style={[s.diaryIndexBtn, { borderColor: themeColor + "55", backgroundColor: themeColor + "12" }]}
            onPress={() => router.push("/(teacher)/diary-index" as any)}>
            <Feather name="book-open" size={13} color={themeColor} />
            <Text style={[s.diaryIndexBtnText, { color: themeColor }]}>수업 일지</Text>
          </Pressable>
        </View>
      </View>

      {/* ── 월간 뷰 ── */}
      {viewMode === "monthly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <MonthlyCalendar
            groups={groups}
            themeColor={themeColor}
            selectedDate={selectedDate}
            onSelectDate={handleDatePress}
            memoDateSet={memoDateSet}
            selectionMode={selectionMode}
            selectedDates={selectedDates}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 주간 뷰 ── */}
      {viewMode === "weekly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {groups.length === 0 ? (
            <View style={s.emptyBox}>
              <Feather name="calendar" size={40} color={C.textMuted} />
              <Text style={s.emptyText}>등록된 반이 없습니다</Text>
            </View>
          ) : (
            <WeeklyTimetable groups={groups} onSelectClass={g => setDetailGroup(g)}
              selectionMode={selectionMode} selectedIds={selectedIds} toggleSelect={toggleSelect} />
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 일간 뷰 (반 목록) ── */}
      {viewMode === "daily" && !selectedGroup && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <WeeklySchedule
            classGroups={groups} statusMap={statusMap} onSelectClass={setSelectedGroup}
            themeColor={themeColor} selectionMode={selectionMode}
            selectedIds={selectedIds} onToggleSelect={toggleSelect} />
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 날짜 상세 팝업 (월간 뷰) ── */}
      {viewMode === "monthly" && selectedDate && (
        <DaySheet
          dateStr={selectedDate}
          classes={dayClasses}
          attMap={dayAttMap}
          diarySet={dayDiarySet}
          themeColor={themeColor}
          poolId={poolId}
          memo={dayMemo}
          onMemoChange={setDayMemo}
          onSaveMemo={() => saveMemo(selectedDate, dayMemo)}
          onClose={() => setSelectedDate(null)}
          onSelectClass={handleDaySheetClassPress}
          onOpenMakeup={handleDaySheetMakeup}
          onAddClass={() => {
            const koDay = selectedDate ? getKoDay(selectedDate) : null;
            const validDay = koDay && koDay !== "일" ? koDay : null;
            setCreateInitialDays(validDay ? [validDay] : []);
            setCreateInitialStep(validDay ? 2 : 1);
            setSelectedDate(null);
            setTimeout(() => setShowCreate(true), 200);
          }}
        />
      )}

      {/* ── 반 상세 시트 (주간/일간 뷰 or 날짜 팝업에서 클릭) ── */}
      {detailGroup && (
        <ClassDetailSheet
          group={detailGroup}
          students={students}
          attMap={selectedDate ? dayAttMap : todayAttMap}
          diarySet={selectedDate ? dayDiarySet : todayDiarySet}
          themeColor={themeColor}
          onClose={() => setDetailGroup(null)}
          onOpenUnreg={() => { setDetailGroup(null); setUnregClassId(detailGroup.id); }}
          onOpenRemove={() => { setDetailGroup(null); setRemoveClassGroup(detailGroup); }}
          onOpenExtra={() => { const g = detailGroup; setDetailGroup(null); setTimeout(() => { setExtraGroupForModal(g); setShowExtraModal(true); }, 200); }}
        />
      )}

      {/* 수강생관리 바텀시트 */}
      <StudentManagementSheet
        visible={showManagement}
        token={token}
        groups={groups}
        themeColor={themeColor}
        onClose={() => setShowManagement(false)}
        onAssignDone={() => { setShowManagement(false); setDetailGroup(null); setSelectedGroup(null); load(); }}
      />

      {/* 반 등록 Flow */}
      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="teacher"
          selfTeacher={selfTeacher}
          initialDays={createInitialDays}
          initialStep={createInitialStep}
          onSuccess={(newGroup) => {
            const g = newGroup as TeacherClassGroup;
            setGroups(prev => [...prev, g]);
            setShowCreate(false);
            setTimeout(() => setDetailGroup(g), 300);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* 메모 삭제 확인 */}
      <ConfirmModal visible={showDeleteConfirm} title="메모 삭제"
        message={`선택한 날짜 ${selectedDates.size}일의 텍스트·음성 메모를 삭제하시겠습니까?\n수업·출결 데이터는 삭제되지 않습니다.`}
        confirmText="삭제" cancelText="취소" destructive
        onConfirm={confirmDeleteMemos} onCancel={() => setShowDeleteConfirm(false)} />
      <ConfirmModal visible={deleteFailCount > 0} title="일부 실패"
        message={`${deleteFailCount}개 반 삭제에 실패했습니다.`}
        confirmText="확인" onConfirm={() => setDeleteFailCount(0)} />

      {/* 미등록회원 모달 */}
      {unregClassId && (
        <UnregisteredPickerModal token={token} classGroupId={unregClassId} themeColor={themeColor}
          onClose={() => setUnregClassId(null)}
          onAssigned={() => { setUnregClassId(null); load(); }} />
      )}

      {/* 반이동 모달 */}
      {removeClassGroup && (
        <MoveToClassModal token={token} classGroup={removeClassGroup} classGroups={groups}
          students={students} themeColor={themeColor}
          onClose={() => setRemoveClassGroup(null)}
          onMoved={() => { setRemoveClassGroup(null); load(); }} />
      )}

      {/* 기타수업 모달 */}
      {showExtraModal && poolId && extraGroupForModal && (
        <ExtraClassModal token={token} poolId={poolId} group={extraGroupForModal}
          groupStudents={students.filter(st =>
            (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(extraGroupForModal.id))
            || st.class_group_id === extraGroupForModal.id
          )}
          onClose={() => { setShowExtraModal(false); setExtraGroupForModal(null); }}
          onCreated={() => { setShowExtraModal(false); setExtraGroupForModal(null); load(); }} />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },
  titleArea:    { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.border,
                  paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  titleRow:     { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  title:        { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  titleSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  rightBtns:    { flexDirection: "row", gap: 4, alignItems: "center" },
  selBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10 },
  selBtnText:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  mgmtBtn:      { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, backgroundColor: "#fff" },
  mgmtBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  createBtnText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  controlRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewToggle:   { flexDirection: "row", gap: 6 },
  toggleBtn:    { paddingHorizontal: 18, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  toggleText:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  diaryIndexBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  diaryIndexBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  subHeader:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12,
                  backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  subActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 5, paddingVertical: 9, borderRadius: 10 },
  subActionText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },
  studentList:  { padding: 12, gap: 8, paddingBottom: 120 },
  listHeader:   { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textMuted, marginBottom: 4 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  avatar:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentName:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  weeklyBadge:  { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  weeklyBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  connBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  connText:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  emptyBox:     { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});

// ─── 미등록회원 가져오기 Modal ──────────────────────────────────────
const INVITE_LABEL: Record<string, string> = {
  none: "초대 전", invited: "초대 완료", joined: "가입 완료",
};
function UnregisteredPickerModal({ token, classGroupId, themeColor, onClose, onAssigned }: {
  token: string | null; classGroupId: string; themeColor: string;
  onClose: () => void; onAssigned: () => void;
}) {
  const [list, setList]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const r = await apiRequest(token, "/teacher/unregistered");
      if (r.ok) setList(await r.json());
      setLoading(false);
    })();
  }, []);

  const filtered = list.filter(u => !q || u.name?.includes(q) || u.parent_phone?.includes(q));

  async function doAssign(student: any) {
    setAssigning(student.id);
    await apiRequest(token, `/teacher/unregistered/${student.id}/assign`, {
      method: "POST", body: JSON.stringify({ class_group_id: classGroupId }),
    });
    setAssigning(null); onAssigned();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={um.backdrop} onPress={onClose} />
      <View style={um.sheet}>
        <View style={um.handle} />
        <View style={um.header}>
          <View style={{ flex: 1 }}>
            <Text style={um.title}>미등록회원 가져오기</Text>
            <Text style={um.sub}>반에 배정하면 정상회원으로 전환됩니다</Text>
          </View>
          <Pressable onPress={onClose} style={{ padding: 4 }}>
            <Feather name="x" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
        <View style={um.searchBar}>
          <Feather name="search" size={14} color={C.textMuted} />
          <TextInput style={um.searchInput} value={q} onChangeText={setQ}
            placeholder="이름·전화번호 검색" placeholderTextColor={C.textMuted} />
          {!!q && <Pressable onPress={() => setQ("")}><Feather name="x" size={14} color={C.textMuted} /></Pressable>}
        </View>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={themeColor} />
        ) : (
          <ScrollView style={um.list} showsVerticalScrollIndicator={false}>
            {filtered.length === 0 ? (
              <View style={um.empty}>
                <Feather name="users" size={28} color={C.textMuted} />
                <Text style={um.emptyTxt}>미등록회원이 없습니다</Text>
              </View>
            ) : filtered.map(item => (
              <View key={item.id} style={um.row}>
                <View style={{ flex: 1 }}>
                  <Text style={um.name}>{item.name}</Text>
                  <Text style={um.phone}>{item.parent_phone || "-"}</Text>
                  <Text style={[um.invTag,
                    item.invite_status === "invited" ? { color: "#2563EB" } :
                    item.invite_status === "joined"  ? { color: "#059669" } : { color: "#6B7280" }
                  ]}>{INVITE_LABEL[item.invite_status || "none"]}</Text>
                </View>
                <Pressable style={[um.assignBtn, { backgroundColor: themeColor }]}
                  onPress={() => setConfirmItem(item)} disabled={assigning === item.id}>
                  {assigning === item.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={um.assignTxt}>반배정</Text>}
                </Pressable>
              </View>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </View>
      <ConfirmModal visible={!!confirmItem} title="반배정"
        message={`${confirmItem?.name}을(를) 이 반에 배정하시겠습니까?\n배정 후 정상회원으로 전환됩니다.`}
        confirmText="배정" cancelText="취소"
        onConfirm={() => { const s = confirmItem; setConfirmItem(null); doAssign(s); }}
        onCancel={() => setConfirmItem(null)} />
    </Modal>
  );
}
const um = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                 backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 maxHeight: "75%", paddingBottom: 32 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  title:       { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16,
                 marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#F3F4F6", borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, fontFamily: "Inter_400Regular" },
  list:        { flexShrink: 1 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  name:        { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  phone:       { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  invTag:      { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  assignBtn:   { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 60, alignItems: "center" },
  assignTxt:   { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  empty:       { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:    { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
});

// ─── 반이동 Modal ─────────────────────────────────────────────────
function MoveToClassModal({ token, classGroup, classGroups, students, themeColor, onClose, onMoved }: {
  token: string | null; classGroup: TeacherClassGroup; classGroups: TeacherClassGroup[];
  students: StudentItem[]; themeColor: string; onClose: () => void; onMoved: () => void;
}) {
  const [step, setStep] = useState<"list" | "pick-class" | "confirm">("list");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<StudentItem | null>(null);
  const [fromClassId, setFromClassId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const teacherClassIds = new Set(classGroups.map(g => g.id));
  const eligible = students.filter(st => {
    const ids: string[] = Array.isArray(st.assigned_class_ids) ? st.assigned_class_ids : (st.class_group_id ? [st.class_group_id] : []);
    if (ids.includes(classGroup.id)) return false;
    return ids.some(id => teacherClassIds.has(id));
  }).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = eligible.filter(st => !q || st.name.includes(q));

  function teacherClassesOf(st: StudentItem): TeacherClassGroup[] {
    const ids: string[] = Array.isArray(st.assigned_class_ids) ? st.assigned_class_ids : (st.class_group_id ? [st.class_group_id] : []);
    return classGroups.filter(g => ids.includes(g.id) && g.id !== classGroup.id);
  }
  function clsLabel(g: TeacherClassGroup) {
    const days = g.schedule_days.split(",").map(d => d.trim()).join("·");
    const [h, m] = g.schedule_time.split(":");
    return `${days} ${h}:${m}반`;
  }
  function handleSelectStudent(st: StudentItem) {
    setSelected(st);
    const fromCls = teacherClassesOf(st);
    if (fromCls.length === 1) { setFromClassId(fromCls[0].id); setStep("confirm"); }
    else { setFromClassId(null); setStep("pick-class"); }
  }
  async function doMove() {
    if (!selected || !fromClassId) return;
    setMoving(true);
    await apiRequest(token, `/students/${selected.id}/move-class`, {
      method: "POST", body: JSON.stringify({ from_class_id: fromClassId, to_class_id: classGroup.id }),
    });
    setMoving(false); onMoved();
  }

  const fromCls = classGroups.find(g => g.id === fromClassId);
  const confirmMsg = selected && fromCls
    ? `${selected.name} 회원을 ${clsLabel(fromCls)}에서 ${clsLabel(classGroup)}으로 이동하시겠습니까?`
    : "";

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={rm.backdrop} onPress={onClose} />
      <View style={rm.sheet}>
        <View style={rm.handle} />
        {step === "list" && (
          <>
            <View style={rm.header}>
              <View style={{ flex: 1 }}>
                <Text style={rm.title}>반이동 — {clsLabel(classGroup)}</Text>
                <Text style={rm.sub}>선택한 학생을 현재 반으로 이동합니다</Text>
              </View>
              <Pressable onPress={onClose} style={{ padding: 4 }}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
            </View>
            <View style={rm.searchBar}>
              <Feather name="search" size={14} color={C.textMuted} />
              <TextInput style={rm.searchInput} value={q} onChangeText={setQ} placeholder="이름 검색" placeholderTextColor={C.textMuted} />
              {!!q && <Pressable onPress={() => setQ("")}><Feather name="x" size={14} color={C.textMuted} /></Pressable>}
            </View>
            <ScrollView style={rm.list} showsVerticalScrollIndicator={false}>
              {filtered.length === 0 ? (
                <View style={rm.empty}><Feather name="users" size={28} color={C.textMuted} /><Text style={rm.emptyTxt}>이동 가능한 학생이 없습니다</Text></View>
              ) : filtered.map(item => {
                const fromClses = teacherClassesOf(item);
                return (
                  <View key={item.id} style={rm.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={rm.name}>{item.name}</Text>
                      <Text style={rm.weeklyBadge}>주 {item.weekly_count ?? 1}회</Text>
                      <Text style={rm.classSub} numberOfLines={2}>현재 반: {fromClses.map(clsLabel).join(" / ") || "—"}</Text>
                    </View>
                    <Pressable style={[rm.moveBtn, { borderColor: themeColor }]} onPress={() => handleSelectStudent(item)}>
                      <Text style={[rm.moveTxt, { color: themeColor }]}>이동</Text>
                    </Pressable>
                  </View>
                );
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          </>
        )}
        {step === "pick-class" && selected && (
          <>
            <View style={rm.header}>
              <Pressable onPress={() => { setStep("list"); setSelected(null); }} style={{ padding: 4, marginRight: 8 }}>
                <Feather name="arrow-left" size={20} color={C.textSecondary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={rm.title}>어떤 반에서 제거할까요?</Text>
                <Text style={rm.sub}>{selected.name} · 주 {selected.weekly_count ?? 1}회</Text>
              </View>
            </View>
            <ScrollView style={rm.list} showsVerticalScrollIndicator={false}>
              {teacherClassesOf(selected).map(g => (
                <Pressable key={g.id} style={rm.pickRow} onPress={() => { setFromClassId(g.id); setStep("confirm"); }}>
                  <View style={{ flex: 1 }}>
                    <Text style={rm.pickName}>{clsLabel(g)}</Text>
                    <Text style={rm.pickSub}>이 반에서 {selected.name} 회원만 제거됩니다</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={C.textMuted} />
                </Pressable>
              ))}
              <View style={{ height: 40 }} />
            </ScrollView>
          </>
        )}
      </View>
      <ConfirmModal visible={step === "confirm" && !!selected && !!fromClassId}
        title="반이동 확인" message={confirmMsg} confirmText="이동" cancelText="취소"
        onConfirm={() => { setStep("list"); doMove(); }}
        onCancel={() => setStep(selected && teacherClassesOf(selected).length > 1 ? "pick-class" : "list")} />
    </Modal>
  );
}
const rm = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:       { position: "absolute", bottom: 0, left: 0, right: 0,
                 backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
                 maxHeight: "80%", paddingBottom: 32 },
  handle:      { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:      { flexDirection: "row", alignItems: "flex-start", padding: 16, paddingTop: 8 },
  title:       { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sub:         { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  searchBar:   { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16,
                 marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#F3F4F6", borderRadius: 10 },
  searchInput: { flex: 1, fontSize: 14, color: C.text, fontFamily: "Inter_400Regular" },
  list:        { flexShrink: 1 },
  row:         { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  name:        { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  weeklyBadge: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.tint, marginTop: 2 },
  classSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  moveBtn:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, minWidth: 52, alignItems: "center" },
  moveTxt:     { fontSize: 13, fontFamily: "Inter_700Bold" },
  pickRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  pickName:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  pickSub:     { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  empty:       { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyTxt:    { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
});
