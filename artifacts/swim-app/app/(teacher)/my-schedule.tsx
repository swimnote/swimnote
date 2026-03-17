/**
 * (teacher)/my-schedule.tsx — 내반 탭
 * 일간 / 주간(대학교 강의표) / 월간(달력) 뷰 전환
 * 날짜·수업 클릭 → 반+학생 목록 → 학생 이름 클릭 → 상세
 * 상단 우측: 선택 / 삭제 버튼
 */
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Dimensions, FlatList, Modal,
  Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";
import { WeeklySchedule, TeacherClassGroup, SlotStatus } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;
const SCREEN_W = Dimensions.get("window").width;
const KO_DAY_ARR = ["일", "월", "화", "수", "목", "금", "토"];
const TIMETABLE_COLS = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
const COL_W = 64;
const TIME_W = 40;
const ROW_H = 56;

type ViewMode = "daily" | "weekly" | "monthly";

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

function getKoDay(dateStr: string): string {
  return KO_DAY_ARR[new Date(dateStr + "T12:00:00Z").getUTCDay()];
}

function classesForKoDay(groups: TeacherClassGroup[], koDay: string) {
  return groups
    .filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(koDay))
    .sort((a, b) => parseHour(a.schedule_time) - parseHour(b.schedule_time));
}

function classesForDate(groups: TeacherClassGroup[], dateStr: string) {
  return classesForKoDay(groups, getKoDay(dateStr));
}

function getHourRange(groups: TeacherClassGroup[]): number[] {
  if (!groups.length) return Array.from({ length: 8 }, (_, i) => i + 9);
  const hours = groups.map(g => parseHour(g.schedule_time));
  const minH = Math.max(6, Math.min(...hours));
  const maxH = Math.min(22, Math.max(...hours));
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}

// ─── 수업 카드 색상 (반 ID 해시) ─────────────────────────────────
const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
function classColor(id: string, alpha = 1) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  const base = COLORS[Math.abs(h) % COLORS.length];
  if (alpha === 1) return base;
  return base + Math.round(alpha * 255).toString(16).padStart(2, "0");
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
        {/* 헤더 행 */}
        <View style={wt.headerRow}>
          <View style={[wt.timeCell, wt.header]} />
          {TIMETABLE_COLS.map(day => (
            <View key={day} style={[wt.dayHeader, { width: COL_W }]}>
              <Text style={wt.dayHeaderText}>{day}</Text>
            </View>
          ))}
        </View>
        {/* 시간 행 */}
        {hours.map(h => (
          <View key={h} style={[wt.row, { height: ROW_H }]}>
            <View style={wt.timeCell}>
              <Text style={wt.timeText}>{h}:00</Text>
            </View>
            {TIMETABLE_COLS.map(day => {
              const cls = cellClasses[`${day}-${h}`] ?? [];
              return (
                <View key={day} style={[wt.cell, { width: COL_W }]}>
                  {cls.map(g => {
                    const selected = selectedIds.has(g.id);
                    const bg = classColor(g.id);
                    return (
                      <Pressable
                        key={g.id}
                        style={[wt.classCard, { backgroundColor: bg, opacity: selected ? 0.7 : 1 }]}
                        onPress={() => selectionMode ? toggleSelect(g.id) : onSelectClass(g)}
                        onLongPress={() => toggleSelect(g.id)}
                      >
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
function MonthlyCalendar({ groups, themeColor, onSelectDate }:
  { groups: TeacherClassGroup[]; themeColor: string; onSelectDate: (dateStr: string, cls: TeacherClassGroup[]) => void }) {

  const today = todayDateStr();
  const [offset, setOffset] = useState(0); // months from now

  const { year, month, days } = useMemo(() => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const firstDay = new Date(y, m - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push(`${y}-${String(m).padStart(2,"0")}-${String(i).padStart(2,"0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return { year: y, month: m, days: cells };
  }, [offset]);

  const CELL_SIZE = Math.floor((SCREEN_W - 32) / 7);

  function handleDayPress(dateStr: string) {
    const cls = classesForDate(groups, dateStr);
    onSelectDate(dateStr, cls);
  }

  return (
    <View style={mc.root}>
      {/* 월 네비게이션 */}
      <View style={mc.monthNav}>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o - 1)}>
          <Feather name="chevron-left" size={20} color={C.text} />
        </Pressable>
        <Text style={mc.monthTitle}>{year}년 {month}월</Text>
        <Pressable style={mc.navBtn} onPress={() => setOffset(o => o + 1)}>
          <Feather name="chevron-right" size={20} color={C.text} />
        </Pressable>
      </View>

      {/* 요일 헤더 */}
      <View style={mc.weekRow}>
        {WEEKDAY_NAMES.map((wd, i) => (
          <View key={wd} style={[mc.weekHeader, { width: CELL_SIZE }]}>
            <Text style={[mc.weekHeaderText, i === 0 && { color: "#EF4444" }, i === 6 && { color: themeColor }]}>
              {wd}
            </Text>
          </View>
        ))}
      </View>

      {/* 날짜 셀 */}
      {Array.from({ length: Math.ceil(days.length / 7) }, (_, wi) => (
        <View key={wi} style={mc.weekRow}>
          {days.slice(wi * 7, wi * 7 + 7).map((dateStr, di) => {
            if (!dateStr) return <View key={di} style={[mc.dayCell, { width: CELL_SIZE }]} />;
            const isToday = dateStr === today;
            const cls = classesForDate(groups, dateStr);
            const dayNum = parseInt(dateStr.split("-")[2]);
            const isSun = di === 0;
            const isSat = di === 6;
            return (
              <Pressable key={dateStr} style={[mc.dayCell, { width: CELL_SIZE }, isToday && { backgroundColor: themeColor + "12" }]}
                onPress={() => handleDayPress(dateStr)}>
                <View style={[mc.dayNumWrap, isToday && { backgroundColor: themeColor }]}>
                  <Text style={[mc.dayNum, isSun && { color: "#EF4444" }, isSat && { color: themeColor },
                    isToday && { color: "#fff" }]}>
                    {dayNum}
                  </Text>
                </View>
                {/* 수업 도트 */}
                <View style={mc.dotsRow}>
                  {cls.slice(0, 4).map(g => (
                    <View key={g.id} style={[mc.dot, { backgroundColor: classColor(g.id) }]} />
                  ))}
                  {cls.length > 4 && <Text style={mc.moreText}>+{cls.length - 4}</Text>}
                </View>
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
  monthNav:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingVertical: 10 },
  navBtn:         { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6",
                    alignItems: "center", justifyContent: "center" },
  monthTitle:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  weekRow:        { flexDirection: "row" },
  weekHeader:     { height: 28, alignItems: "center", justifyContent: "center" },
  weekHeaderText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  dayCell:        { height: 64, alignItems: "center", paddingTop: 6, borderRadius: 8 },
  dayNumWrap:     { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dayNum:         { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },
  dotsRow:        { flexDirection: "row", gap: 2, marginTop: 3, flexWrap: "wrap", justifyContent: "center" },
  dot:            { width: 6, height: 6, borderRadius: 3 },
  moreText:       { fontSize: 8, fontFamily: "Inter_400Regular", color: C.textMuted },
});

// ─── 수업 상세 시트 (Modal) ───────────────────────────────────────
function ClassDetailSheet({ group, students, attMap, diarySet, themeColor, onClose }:
  { group: TeacherClassGroup; students: StudentItem[]; attMap: Record<string,number>;
    diarySet: Set<string>; themeColor: string; onClose: () => void }) {

  const groupStudents = students.filter(st =>
    (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(group.id))
    || st.class_group_id === group.id
  ).sort((a, b) => a.name.localeCompare(b.name));

  const attDone  = (attMap[group.id] || 0) >= group.student_count && group.student_count > 0;
  const diarDone = diarySet.has(group.id);

  function handleStudentPress(student: StudentItem) {
    onClose();
    setTimeout(() => {
      router.push({ pathname: "/(teacher)/student-detail", params: { id: student.id } } as any);
    }, 200);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={ds.backdrop} onPress={onClose} />
      <View style={ds.sheet}>
        {/* 시트 헤더 */}
        <View style={ds.handle} />
        <View style={ds.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={ds.sheetTitle}>{group.name}</Text>
            <Text style={ds.sheetSub}>{group.schedule_days.split(",").join("·")} · {group.schedule_time}</Text>
          </View>
          <Pressable onPress={onClose} style={ds.closeBtn}>
            <Feather name="x" size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        {/* 출결/일지/반배정 버튼 */}
        <View style={ds.actionRow}>
          <Pressable style={[ds.actionBtn, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}
            onPress={() => { onClose(); router.push({ pathname:"/(teacher)/attendance", params:{classGroupId: group.id} } as any); }}>
            <Feather name="check-square" size={14} color={attDone ? "#059669" : "#DC2626"} />
            <Text style={[ds.actionText, { color: attDone ? "#059669" : "#DC2626" }]}>출결</Text>
          </Pressable>
          <Pressable style={[ds.actionBtn, { backgroundColor: diarDone ? "#D1FAE5" : "#FEF3C7" }]}
            onPress={() => { onClose(); router.push({ pathname:"/(teacher)/diary", params:{classGroupId: group.id, className: group.name} } as any); }}>
            <Feather name="edit-3" size={14} color={diarDone ? "#059669" : "#D97706"} />
            <Text style={[ds.actionText, { color: diarDone ? "#059669" : "#D97706" }]}>수업일지</Text>
          </Pressable>
          <Pressable style={[ds.actionBtn, { backgroundColor: "#EEF2FF" }]}
            onPress={() => { onClose(); router.push(`/class-assign?classId=${group.id}` as any); }}>
            <Feather name="users" size={14} color="#4338CA" />
            <Text style={[ds.actionText, { color: "#4338CA" }]}>반배정</Text>
          </Pressable>
        </View>

        {/* 학생 목록 */}
        <Text style={ds.sectionLabel}>학생 목록</Text>
        <ScrollView style={ds.studentScroll} showsVerticalScrollIndicator={false}>
          {groupStudents.length === 0 ? (
            <View style={ds.empty}>
              <Feather name="users" size={28} color={C.textMuted} />
              <Text style={ds.emptyText}>배정된 학생이 없습니다</Text>
            </View>
          ) : groupStudents.map(st => (
            <Pressable key={st.id} style={ds.studentRow} onPress={() => handleStudentPress(st)}>
              <View style={[ds.avatar, { backgroundColor: themeColor + "18" }]}>
                <Text style={[ds.avatarText, { color: themeColor }]}>{st.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.studentName}>{st.name}</Text>
                {st.birth_year && (
                  <Text style={ds.studentSub}>{st.birth_year}년생</Text>
                )}
              </View>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          ))}
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const ds = StyleSheet.create({
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
  actionRow:    { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  actionBtn:    { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                  gap: 5, paddingVertical: 9, borderRadius: 10 },
  actionText:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textMuted,
                  paddingHorizontal: 16, marginBottom: 6 },
  studentScroll:{ flexShrink: 1 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10,
                  paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  avatar:       { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 14, fontFamily: "Inter_700Bold" },
  studentName:  { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  empty:        { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText:    { fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },
});

// ─── 날짜 수업 목록 시트 (월간 뷰에서 날짜 탭) ──────────────────
function DayClassSheet({ dateStr, dayClasses, themeColor, onSelectClass, onClose }:
  { dateStr: string; dayClasses: TeacherClassGroup[]; themeColor: string;
    onSelectClass: (g: TeacherClassGroup) => void; onClose: () => void }) {

  const d = new Date(dateStr + "T12:00:00Z");
  const label = `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일 (${KO_DAY_ARR[d.getUTCDay()]})`;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={ds.backdrop} onPress={onClose} />
      <View style={ds.sheet}>
        <View style={ds.handle} />
        <View style={ds.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text style={ds.sheetTitle}>{label}</Text>
            <Text style={ds.sheetSub}>{dayClasses.length}개 수업</Text>
          </View>
          <Pressable onPress={onClose} style={ds.closeBtn}>
            <Feather name="x" size={20} color={C.textSecondary} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
          {dayClasses.length === 0 ? (
            <View style={ds.empty}>
              <Feather name="calendar" size={28} color={C.textMuted} />
              <Text style={ds.emptyText}>이날 수업이 없습니다</Text>
            </View>
          ) : dayClasses.map(g => (
            <Pressable key={g.id} style={dcl.classRow} onPress={() => onSelectClass(g)}>
              <View style={[dcl.colorBar, { backgroundColor: classColor(g.id) }]} />
              <View style={{ flex: 1 }}>
                <Text style={dcl.className}>{g.name}</Text>
                <Text style={dcl.classSub}>{g.schedule_time} · {g.student_count}명</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.textMuted} />
            </Pressable>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const dcl = StyleSheet.create({
  classRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16,
                paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  colorBar:   { width: 4, height: 40, borderRadius: 2 },
  className:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  classSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
});

// ─── 기타 수업 생성 모달 ──────────────────────────────────────────
interface ExtraClassModalProps {
  token: string | null;
  poolId: string;
  group: TeacherClassGroup;
  groupStudents: StudentItem[];
  onClose: () => void;
  onCreated: () => void;
}

function ExtraClassModal({ token, poolId, group, groupStudents, onClose, onCreated }: ExtraClassModalProps) {
  const { themeColor } = useBrand();
  const [className, setClassName]   = useState(group.name + " 기타수업");
  const [classDate, setClassDate]   = useState(todayDateStr());
  const [classTime, setClassTime]   = useState(group.schedule_time || "09:00");
  const [notes, setNotes]           = useState("");
  const [isFifthWeek, setIsFifthWeek] = useState(false);
  const [selectedStuIds, setSelectedStuIds] = useState<Set<string>>(new Set());
  const [unreg, setUnreg]           = useState("");
  const [unregNames, setUnregNames] = useState<string[]>([]);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");

  function toggleStu(id: string) {
    setSelectedStuIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function addUnreg() {
    const name = unreg.trim();
    if (!name) return;
    setUnregNames(prev => [...prev, name]);
    setUnreg("");
  }

  async function handleCreate() {
    if (!className.trim() || !classDate || !classTime) { setError("수업명·날짜·시간을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiRequest(token, "/extra-classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pool_id: poolId,
          class_name: className.trim(),
          class_date: classDate,
          class_time: classTime,
          student_ids: Array.from(selectedStuIds),
          unregistered_names: unregNames,
          is_fifth_week: isFifthWeek,
          notes: notes.trim() || null,
        }),
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
          {/* 수업명 */}
          <View style={em.field}>
            <Text style={em.label}>수업명 *</Text>
            <TextInput style={em.input} value={className} onChangeText={setClassName} placeholder="수업명" placeholderTextColor={C.textMuted} />
          </View>
          {/* 날짜·시간 */}
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
          {/* 5주차 여부 */}
          <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 8 }} onPress={() => setIsFifthWeek(!isFifthWeek)}>
            <View style={[em.checkbox, isFifthWeek && { backgroundColor: themeColor, borderColor: themeColor }]}>
              {isFifthWeek && <Feather name="check" size={12} color="#fff" />}
            </View>
            <Text style={em.label}>5주차 수업</Text>
          </Pressable>
          {/* 등록 학생 선택 */}
          {groupStudents.length > 0 && (
            <View style={em.field}>
              <Text style={em.label}>참가 학생 (이 반)</Text>
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
          {/* 미등록 회원 */}
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
                <View style={[em.checkbox, { backgroundColor: "#F3F4F6", borderColor: C.border }]}>
                  <Feather name="user" size={11} color={C.textMuted} />
                </View>
                <Text style={em.stuName}>{n}</Text>
                <Text style={[em.stuSub, { marginLeft: "auto" }]}>미등록</Text>
                <Pressable onPress={() => setUnregNames(prev => prev.filter((_, j) => j !== i))}>
                  <Feather name="x" size={14} color={C.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
          {/* 메모 */}
          <View style={em.field}>
            <Text style={em.label}>메모</Text>
            <TextInput style={[em.input, { height: 72, textAlignVertical: "top" }]} value={notes} onChangeText={setNotes} placeholder="특이사항 등..." placeholderTextColor={C.textMuted} multiline />
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
  backdrop:  { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff",
               borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%", paddingBottom: 0 },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: "#D1D5DB", alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title:     { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  field:     { gap: 6 },
  label:     { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  input:     { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
               fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, backgroundColor: "#F9FAFB" },
  checkbox:  { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border,
               backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  stuRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  stuName:   { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text },
  stuSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted },
  addBtn:    { width: 42, height: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  createBtn: { paddingVertical: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  createBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  error:     { fontSize: 13, fontFamily: "Inter_400Regular", color: "#DC2626", textAlign: "center" },
});

// ─── 메인 스크린 ─────────────────────────────────────────────────
export default function MyScheduleScreen() {
  const { token, adminUser } = useAuth();
  const { themeColor } = useBrand();
  const selfTeacher = adminUser ? { id: adminUser.id, name: adminUser.name || "나" } : undefined;

  const [viewMode,      setViewMode]      = useState<ViewMode>("daily");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set());

  const [groups,      setGroups]      = useState<TeacherClassGroup[]>([]);
  const [students,    setStudents]    = useState<StudentItem[]>([]);
  const [attMap,      setAttMap]      = useState<Record<string, number>>({});
  const [diarySet,    setDiarySet]    = useState<Set<string>>(new Set());

  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting,   setDeleting]   = useState(false);

  // 일간 뷰 서브뷰 (기존 방식 유지)
  const [selectedGroup,  setSelectedGroup]  = useState<TeacherClassGroup | null>(null);

  // 주간/월간 → 수업 상세 시트
  const [detailGroup,    setDetailGroup]    = useState<TeacherClassGroup | null>(null);

  // 월간 → 날짜 클릭 시트
  const [daySheet,       setDaySheet]       = useState<{ dateStr: string; cls: TeacherClassGroup[] } | null>(null);

  // 기타 수업 생성 모달
  const [showExtraModal, setShowExtraModal] = useState(false);

  // pool_id
  const poolId = (adminUser as any)?.swimming_pool_id || "";

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
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid]||0)+1; });
        setAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // 상태맵
  const statusMap: Record<string, SlotStatus> = {};
  groups.forEach(g => {
    statusMap[g.id] = {
      attChecked: attMap[g.id] || 0,
      diaryDone:  diarySet.has(g.id),
      hasPhotos:  false,
    };
  });

  // 일간 뷰 선택된 반 학생
  const groupStudents = selectedGroup
    ? students.filter(st =>
        (Array.isArray(st.assigned_class_ids) && st.assigned_class_ids.includes(selectedGroup.id))
        || st.class_group_id === selectedGroup.id
      ).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    Alert.alert("반 삭제", `선택한 반 ${selectedIds.size}개를 삭제하시겠습니까?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        setDeleting(true);
        const ids = Array.from(selectedIds);
        let failed = 0;
        for (const id of ids) {
          const res = await apiRequest(token, `/class-groups/${id}`, { method: "DELETE" });
          if (!res.ok) failed++;
        }
        setDeleting(false);
        setSelectionMode(false);
        setSelectedIds(new Set());
        if (failed > 0) Alert.alert("일부 실패", `${failed}개 반 삭제에 실패했습니다.`);
        load();
      }},
    ]);
  }

  // ─ 로딩 ─
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ─ 일간 뷰 서브뷰 (학생 목록) ─
  if (viewMode === "daily" && selectedGroup) {
    const g = selectedGroup;
    const attDone  = (attMap[g.id] || 0) >= g.student_count && g.student_count > 0;
    const diarDone = diarySet.has(g.id);

    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <View style={s.subHeader}>
          <Pressable style={s.backBtn} onPress={() => setSelectedGroup(null)}>
            <Feather name="arrow-left" size={20} color={C.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.subTitle}>{g.name}</Text>
            <Text style={s.subSub}>{g.schedule_days} · {g.schedule_time}</Text>
          </View>
          <Pressable style={[s.subActionBtn, { backgroundColor: attDone ? "#D1FAE5" : "#FEE2E2" }]}
            onPress={() => router.push({ pathname:"/(teacher)/attendance", params:{classGroupId: g.id} } as any)}>
            <Feather name="check-square" size={14} color={attDone ? "#059669" : "#DC2626"} />
            <Text style={[s.subActionText, { color: attDone ? "#059669" : "#DC2626" }]}>출결</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: diarDone ? "#D1FAE5" : "#FEF3C7" }]}
            onPress={() => router.push({ pathname:"/(teacher)/diary", params:{classGroupId: g.id, className: g.name} } as any)}>
            <Feather name="edit-3" size={14} color={diarDone ? "#059669" : "#D97706"} />
            <Text style={[s.subActionText, { color: diarDone ? "#059669" : "#D97706" }]}>일지</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: "#EEF2FF" }]}
            onPress={() => router.push(`/class-assign?classId=${g.id}` as any)}>
            <Feather name="users" size={14} color="#4338CA" />
            <Text style={[s.subActionText, { color: "#4338CA" }]}>반배정</Text>
          </Pressable>
          <Pressable style={[s.subActionBtn, { backgroundColor: "#FEF9C3" }]}
            onPress={() => setShowExtraModal(true)}>
            <Feather name="plus-circle" size={14} color="#CA8A04" />
            <Text style={[s.subActionText, { color: "#CA8A04" }]}>기타수업</Text>
          </Pressable>
        </View>

        {showExtraModal && poolId && (
          <ExtraClassModal
            token={token}
            poolId={poolId}
            group={g}
            groupStudents={groupStudents}
            onClose={() => setShowExtraModal(false)}
            onCreated={() => { setShowExtraModal(false); load(); }}
          />
        )}

        <FlatList
          data={groupStudents}
          keyExtractor={i => i.id}
          contentContainerStyle={s.studentList}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.emptyBox}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={s.emptyText}>배정된 학생이 없습니다</Text>
            </View>
          }
          ListHeaderComponent={<Text style={s.listHeader}>학생 {groupStudents.length}명</Text>}
          renderItem={({ item }) => (
            <Pressable style={[s.studentRow, { backgroundColor: C.card }]}
              onPress={() => router.push({ pathname:"/(teacher)/student-detail", params:{id: item.id} } as any)}>
              <View style={[s.avatar, { backgroundColor: themeColor + "18" }]}>
                <Text style={[s.avatarText, { color: themeColor }]}>{item.name[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.studentName}>{item.name}</Text>
                {item.birth_year && (
                  <Text style={s.studentSub}>{item.birth_year}년생 · {item.schedule_labels || ""}</Text>
                )}
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
          )}
        />
      </SafeAreaView>
    );
  }

  // ─ 메인 뷰 ─
  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />

      {/* 타이틀 + 뷰 토글 + 선택/삭제 버튼 */}
      <View style={s.titleArea}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>내 반</Text>
            <Text style={s.titleSub}>
              {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
            </Text>
          </View>

          {/* 우측 버튼 그룹 */}
          <View style={s.rightBtns}>
            {selectionMode ? (
              <>
                <Pressable
                  style={[s.selBtn, { backgroundColor: selectedIds.size > 0 ? "#EF4444" : "#9CA3AF" }]}
                  onPress={handleDelete}
                  disabled={deleting || selectedIds.size === 0}
                >
                  {deleting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <><Feather name="trash-2" size={13} color="#fff" /><Text style={s.selBtnText}>삭제 {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}</Text></>
                  }
                </Pressable>
                <Pressable style={[s.selBtn, { backgroundColor: "#6B7280" }]}
                  onPress={() => { setSelectionMode(false); setSelectedIds(new Set()); }}>
                  <Text style={s.selBtnText}>취소</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable style={[s.selBtn, { backgroundColor: "#F3F4F6" }]}
                  onPress={() => setSelectionMode(true)}>
                  <Feather name="check-square" size={13} color={C.textSecondary} />
                  <Text style={[s.selBtnText, { color: C.textSecondary }]}>선택</Text>
                </Pressable>
                <Pressable style={[s.createBtn, { backgroundColor: themeColor }]}
                  onPress={() => setShowCreate(true)}>
                  <Feather name="plus" size={14} color="#fff" />
                  <Text style={s.createBtnText}>반 등록</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* 뷰 모드 토글 */}
        <View style={s.viewToggle}>
          {(["daily","weekly","monthly"] as ViewMode[]).map(mode => {
            const labels = { daily: "일간", weekly: "주간", monthly: "월간" };
            const isActive = viewMode === mode;
            return (
              <Pressable key={mode} style={[s.toggleBtn, isActive && { backgroundColor: themeColor, borderColor: themeColor }]}
                onPress={() => { setViewMode(mode); setSelectionMode(false); setSelectedIds(new Set()); }}>
                <Text style={[s.toggleText, isActive && { color: "#fff" }]}>{labels[mode]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── 일간 뷰 ── */}
      {viewMode === "daily" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <WeeklySchedule
            classGroups={groups}
            statusMap={statusMap}
            onSelectClass={setSelectedGroup}
            themeColor={themeColor}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
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
            <WeeklyTimetable
              groups={groups}
              onSelectClass={g => { setDetailGroup(g); }}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
            />
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 월간 뷰 ── */}
      {viewMode === "monthly" && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          <MonthlyCalendar
            groups={groups}
            themeColor={themeColor}
            onSelectDate={(dateStr, cls) => setDaySheet({ dateStr, cls })}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      )}

      {/* ── 반 상세 시트 (주간 뷰에서 수업 클릭) ── */}
      {detailGroup && (
        <ClassDetailSheet
          group={detailGroup}
          students={students}
          attMap={attMap}
          diarySet={diarySet}
          themeColor={themeColor}
          onClose={() => setDetailGroup(null)}
        />
      )}

      {/* ── 날짜 수업 시트 (월간 뷰에서 날짜 클릭) ── */}
      {daySheet && (
        <DayClassSheet
          dateStr={daySheet.dateStr}
          dayClasses={daySheet.cls}
          themeColor={themeColor}
          onSelectClass={g => { setDaySheet(null); setTimeout(() => setDetailGroup(g), 100); }}
          onClose={() => setDaySheet(null)}
        />
      )}

      {/* 반 등록 Flow */}
      {showCreate && (
        <ClassCreateFlow
          token={token}
          role="teacher"
          selfTeacher={selfTeacher}
          onSuccess={(newGroup) => { setGroups(prev => [...prev, newGroup as TeacherClassGroup]); setShowCreate(false); }}
          onClose={() => setShowCreate(false)}
        />
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
  rightBtns:    { flexDirection: "row", gap: 6, alignItems: "center" },
  selBtn:       { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                  paddingVertical: 7, borderRadius: 10 },
  selBtnText:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  createBtn:    { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12,
                  paddingVertical: 8, borderRadius: 10 },
  createBtnText:{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },

  viewToggle:   { flexDirection: "row", gap: 6 },
  toggleBtn:    { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
                  borderWidth: 1.5, borderColor: C.border, backgroundColor: "#fff" },
  toggleText:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },

  subHeader:    { flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
                  backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6",
                  alignItems: "center", justifyContent: "center" },
  subTitle:     { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  subSub:       { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 1 },
  subActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10,
                  paddingVertical: 6, borderRadius: 10 },
  subActionText:{ fontSize: 12, fontFamily: "Inter_600SemiBold" },

  studentList:  { padding: 12, gap: 8, paddingBottom: 120 },
  listHeader:   { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textMuted, marginBottom: 4 },
  studentRow:   { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  avatar:       { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 15, fontFamily: "Inter_700Bold" },
  studentName:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  studentSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  connBadge:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7,
                  paddingVertical: 3, borderRadius: 8 },
  connText:     { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  emptyBox:     { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});
