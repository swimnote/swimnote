/**
 * ClassCreateFlow — 반 등록 단일 스크롤 폼
 * 모든 항목(요일·시간·선생님·색상)을 한 화면에서 입력
 */
import { Calendar, Check, CircleAlert, CircleCheck, Layers, UserX, X } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Dimensions, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import PastelColorPicker from "@/components/common/PastelColorPicker";

const C = Colors.light;
const SCREEN_H = Dimensions.get("window").height;

const WEEKDAYS = ["월", "화", "수", "목", "금"] as const;
const ALL_DAYS = [...WEEKDAYS, "토"] as const;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function makeTimeSlots(days: string[]): string[] {
  const hasSat = days.includes("토");
  const hasWeekday = days.some(d => WEEKDAYS.includes(d as any));
  const slots: string[] = [];
  if (hasWeekday) for (let h = 13; h <= 21; h++) slots.push(`${String(h).padStart(2, "0")}:00`);
  if (hasSat) {
    for (let h = 8; h <= 16; h++) {
      const t = `${String(h).padStart(2, "0")}:00`;
      if (!slots.includes(t)) slots.push(t);
    }
    slots.sort();
  }
  return slots;
}

function getDayOfWeek(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return DAY_NAMES[d.getDay()];
  } catch { return ""; }
}

interface Teacher { id: string; name: string; is_activated: boolean; is_admin_self_teacher: boolean; }

interface ClassCreateFlowProps {
  token: string | null;
  role: "pool_admin" | "teacher";
  selfTeacher?: { id: string; name: string };
  onSuccess: (newClass: any) => void;
  onClose: () => void;
  initialDays?: string[];
  initialStep?: number;
}

// ── 서브 컴포넌트 ──────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return <Text style={sh.label}>{label}</Text>;
}
const sh = StyleSheet.create({
  label: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginBottom: 10, marginTop: 4 },
});

function DayButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const isSat = label === "토";
  const color = selected ? (isSat ? "#D96C6C" : C.tint) : C.text;
  const bg = selected ? (isSat ? "#F9DEDA" : C.tintLight) : C.background;
  const border = selected ? (isSat ? "#D96C6C" : C.tint) : C.border;
  return (
    <Pressable style={[db.btn, { backgroundColor: bg, borderColor: border }]} onPress={onPress}>
      <Text style={[db.lbl, { color }]}>{label}</Text>
    </Pressable>
  );
}
const db = StyleSheet.create({
  btn: { width: 50, height: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  lbl: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});

function TimeButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[tb.btn, selected && { backgroundColor: C.tint, borderColor: C.tint }]}
      onPress={onPress}
    >
      <Text style={[tb.lbl, { color: selected ? "#fff" : C.text }]}>{label}</Text>
    </Pressable>
  );
}
const tb = StyleSheet.create({
  btn: { width: "30%", paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center", backgroundColor: C.background },
  lbl: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});

function TeacherRow({ t, selected, onPress }: { t: Teacher; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[tr.row, { borderColor: selected ? C.tint : C.border, backgroundColor: selected ? C.tintLight : C.background }]}
      onPress={onPress}
    >
      <View style={[tr.avatar, { backgroundColor: selected ? C.tint : C.border }]}>
        <Text style={[tr.init, { color: selected ? "#fff" : C.textSecondary }]}>{t.name[0]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={tr.name}>{t.name}</Text>
        {t.is_admin_self_teacher && <Text style={tr.sub}>관리자 본인</Text>}
      </View>
      {!t.is_activated && (
        <View style={tr.badge}><Text style={tr.badgeTxt}>미활성</Text></View>
      )}
      {selected && <CircleCheck size={18} color={C.tint} />}
    </Pressable>
  );
}
const tr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, marginBottom: 6 },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  init: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  name: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  sub: { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: "#FFF1BF" },
  badgeTxt: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E" },
});

// ── 메인 컴포넌트 ──────────────────────────────────────────────────

export default function ClassCreateFlow({ token, role, selfTeacher, onSuccess, onClose, initialDays }: ClassCreateFlowProps) {
  const insets = useSafeAreaInsets();
  const isAdmin = role === "pool_admin";

  const [isOneTime, setIsOneTime] = useState(false);
  const [oneTimeDate, setOneTimeDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedDays, setSelectedDays] = useState<string[]>(initialDays ?? []);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>("#FFFFFF");
  const [defaultCapacity, setDefaultCapacity] = useState<number>(20);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 기본 정원 & 선생님 목록 로드
  useEffect(() => {
    apiRequest(token, "/admin/class-settings")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.default_capacity) setDefaultCapacity(d.default_capacity); })
      .catch(() => {});
    if (isAdmin) {
      setTeachersLoading(true);
      apiRequest(token, "/teachers")
        .then(r => r.json())
        .then(d => setTeachers(Array.isArray(d) ? d : []))
        .catch(() => setTeachers([]))
        .finally(() => setTeachersLoading(false));
    }
  }, [token, isAdmin]);

  function toggleDay(d: string) {
    setSelectedDays(prev => prev.includes(d) ? [] : [d]);
    setSelectedTime(null);
  }

  function handleOneTimeDateChange(date: string) {
    setOneTimeDate(date);
    const day = getDayOfWeek(date);
    setSelectedDays(day ? [day] : []);
    setSelectedTime(null);
  }

  const timeSlots = makeTimeSlots(
    selectedDays.length > 0
      ? selectedDays
      : isOneTime ? [getDayOfWeek(oneTimeDate) || "월"] : ["월"]
  );

  const activeDays = isOneTime ? (getDayOfWeek(oneTimeDate) ? [getDayOfWeek(oneTimeDate)] : []) : selectedDays;
  const dayLabel = isOneTime
    ? (oneTimeDate && getDayOfWeek(oneTimeDate) ? `${oneTimeDate} (${getDayOfWeek(oneTimeDate)}요일)` : "—")
    : (selectedDays.length > 0 ? selectedDays.join("·") + "요일" : "—");
  const classLabel = selectedTime
    ? (isOneTime ? `${oneTimeDate} ${selectedTime}반` : `${selectedDays.join("·")} ${selectedTime}반`)
    : "—";
  const teacherName = isAdmin ? (selectedTeacher?.name || "미지정") : (selfTeacher?.name || "본인");

  async function handleCreate() {
    setErrorMsg(null);
    if (isOneTime) {
      if (!oneTimeDate || !getDayOfWeek(oneTimeDate)) { setErrorMsg("유효한 날짜를 입력해주세요. (YYYY-MM-DD)"); return; }
    } else {
      if (selectedDays.length === 0) { setErrorMsg("수업 요일을 선택해주세요."); return; }
    }
    if (!selectedTime) { setErrorMsg("수업 시간을 선택해주세요."); return; }
    if (isAdmin && isOneTime && !selectedTeacher) { setErrorMsg("1회성 반은 담당 선생님 지정이 필수입니다."); return; }

    setSaving(true);
    try {
      const daysStr = isOneTime ? (getDayOfWeek(oneTimeDate) || selectedDays[0]) : selectedDays.join(",");
      const body: any = {
        schedule_days: daysStr,
        schedule_time: selectedTime,
        teacher_user_id: isAdmin ? selectedTeacher?.id : selfTeacher?.id,
        capacity: defaultCapacity,
        is_one_time: isOneTime,
        one_time_date: isOneTime ? oneTimeDate : undefined,
        color: selectedColor !== "#FFFFFF" ? selectedColor : undefined,
      };
      const res = await apiRequest(token, "/class-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || data.message || "개설에 실패했습니다."); return; }
      onSuccess(data);
    } catch { setErrorMsg("네트워크 오류가 발생했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={fl.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* 높이 93% — 화면 위쪽까지 크게 */}
        <View style={[fl.sheet, { height: SCREEN_H * 0.93 }]}>
          {/* 핸들 */}
          <View style={fl.handle} />

          {/* 헤더 */}
          <View style={fl.header}>
            <Text style={fl.title}>반 등록</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <X size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* 에러 */}
          {errorMsg && (
            <View style={fl.errorRow}>
              <CircleAlert size={14} color={C.error} />
              <Text style={fl.errorText}>{errorMsg}</Text>
            </View>
          )}

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={fl.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

            {/* ── 1회성 반 토글 ── */}
            <Pressable
              style={[fl.toggleRow, { backgroundColor: isOneTime ? "#EDE9FE" : C.background, borderColor: isOneTime ? "#7C3AED" : C.border }]}
              onPress={() => { setIsOneTime(!isOneTime); setSelectedDays([]); setSelectedTime(null); setErrorMsg(null); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={[fl.toggleLabel, { color: isOneTime ? "#7C3AED" : C.text }]}>1회성 반</Text>
                <Text style={[fl.toggleSub, { color: isOneTime ? "#7C3AED" : C.textMuted }]}>특정 날짜 1회만 운영하는 특별반</Text>
              </View>
              <View style={[fl.sw, { backgroundColor: isOneTime ? "#7C3AED" : C.border }]}>
                <View style={[fl.knob, { transform: [{ translateX: isOneTime ? 18 : 0 }] }]} />
              </View>
            </Pressable>

            <View style={fl.divider} />

            {/* ── 요일 / 날짜 선택 ── */}
            <SectionHeader label={isOneTime ? "수업 날짜" : "수업 요일"} />
            {isOneTime ? (
              <>
                <View style={fl.dateBox}>
                  <Calendar size={16} color={C.tint} />
                  <TextInput
                    style={fl.dateInput}
                    value={oneTimeDate}
                    onChangeText={handleOneTimeDateChange}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={C.textMuted}
                    keyboardType="numeric"
                    maxLength={10}
                  />
                </View>
                {getDayOfWeek(oneTimeDate) ? (
                  <View style={fl.chip}>
                    <CircleCheck size={12} color="#7C3AED" />
                    <Text style={fl.chipTxt}>{oneTimeDate} ({getDayOfWeek(oneTimeDate)}요일)</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <View style={fl.dayGrid}>
                  {ALL_DAYS.map(d => (
                    <DayButton key={d} label={d} selected={selectedDays.includes(d)} onPress={() => toggleDay(d)} />
                  ))}
                </View>
                {selectedDays.length > 0 && (
                  <View style={fl.chip}>
                    <Text style={fl.chipTxt}>선택: <Text style={{ color: C.tint }}>{selectedDays.join("·")}요일</Text></Text>
                  </View>
                )}
              </>
            )}

            <View style={fl.divider} />

            {/* ── 시간 선택 ── */}
            <SectionHeader label="수업 시간" />
            {activeDays.length === 0 && !isOneTime ? (
              <Text style={fl.hint}>먼저 요일을 선택하면 시간이 표시됩니다</Text>
            ) : timeSlots.length === 0 ? (
              <Text style={fl.hint}>선택 가능한 시간대가 없습니다</Text>
            ) : (
              <>
                <Text style={fl.subHint}>
                  {selectedDays.includes("토") && selectedDays.some(d => WEEKDAYS.includes(d as any))
                    ? "평일(13:00-21:00) · 토(08:00-16:00)"
                    : selectedDays.includes("토") ? "토요일(08:00-16:00)" : "평일(13:00-21:00)"}
                </Text>
                <View style={fl.timeGrid}>
                  {timeSlots.map(t => (
                    <TimeButton key={t} label={t} selected={selectedTime === t} onPress={() => setSelectedTime(t)} />
                  ))}
                </View>
              </>
            )}

            {/* ── 선생님 선택 (관리자만) ── */}
            {isAdmin && (
              <>
                <View style={fl.divider} />
                <SectionHeader label="담당 선생님" />
                {teachersLoading ? (
                  <ActivityIndicator color={C.tint} style={{ marginVertical: 12 }} />
                ) : teachers.length === 0 ? (
                  <View style={fl.emptyTeacher}>
                    <UserX size={28} color={C.textMuted} />
                    <Text style={fl.emptyTeacherTxt}>등록된 선생님이 없습니다</Text>
                  </View>
                ) : (
                  <>
                    {!isOneTime && (
                      <Pressable
                        style={[tr.row, { borderColor: C.border, backgroundColor: selectedTeacher === null ? C.tintLight : C.background }]}
                        onPress={() => setSelectedTeacher(null)}
                      >
                        <View style={[tr.avatar, { backgroundColor: C.border }]}>
                          <UserX size={16} color={C.textMuted} />
                        </View>
                        <Text style={[tr.name, { color: C.textSecondary }]}>미지정</Text>
                        {selectedTeacher === null && <CircleCheck size={18} color={C.textSecondary} />}
                      </Pressable>
                    )}
                    {teachers.map(t => (
                      <TeacherRow key={t.id} t={t} selected={selectedTeacher?.id === t.id} onPress={() => setSelectedTeacher(t)} />
                    ))}
                  </>
                )}
              </>
            )}

            {/* ── 반 색상 ── */}
            <View style={fl.divider} />
            <SectionHeader label="반 색상 (선택)" />
            <Text style={fl.subHint}>시간표에서 반을 구분할 색상을 선택하세요</Text>
            <PastelColorPicker selected={selectedColor} onSelect={setSelectedColor} />

            {/* ── 요약 카드 ── */}
            {(selectedDays.length > 0 || (isOneTime && getDayOfWeek(oneTimeDate))) && selectedTime && (
              <>
                <View style={fl.divider} />
                <SectionHeader label="반 개설 확인" />
                <View style={[fl.summaryCard, { borderColor: (isOneTime ? "#7C3AED" : C.tint) + "50" }]}>
                  <View style={[fl.summaryName, { backgroundColor: selectedColor !== "#FFFFFF" ? selectedColor : (isOneTime ? "#EDE9FE" : C.tintLight) }]}>
                    {isOneTime && (
                      <View style={fl.oneTimeBadge}>
                        <Text style={fl.oneTimeBadgeTxt}>1회성</Text>
                      </View>
                    )}
                    <Layers size={18} color={isOneTime ? "#7C3AED" : C.tint} />
                    <Text style={[fl.summaryNameTxt, { color: isOneTime ? "#7C3AED" : C.tint }]}>{classLabel}</Text>
                  </View>
                  <View style={fl.summaryRows}>
                    <SummaryRow icon="calendar" label={isOneTime ? "날짜" : "요일"} value={dayLabel} />
                    <SummaryRow icon="clock" label="시간" value={selectedTime} />
                    <SummaryRow icon="user" label="선생님" value={teacherName} />
                    <SummaryRow icon="users" label="기본 정원" value={`${defaultCapacity}명`} last />
                  </View>
                </View>
              </>
            )}

          </ScrollView>

          {/* ── 하단 버튼 ── */}
          <View style={[fl.footer, { paddingBottom: insets.bottom + 8 }]}>
            <Pressable
              style={[fl.createBtn, { backgroundColor: isOneTime ? "#7C3AED" : C.tint }]}
              onPress={handleCreate}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Check size={18} color="#fff" />
                  <Text style={fl.createBtnTxt}>{isOneTime ? "1회성 반 개설" : "반 개설하기"}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SummaryRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[sr.row, !last && sr.border]}>
      <LucideIcon name={icon as any} size={13} color={C.textMuted} />
      <Text style={sr.label}>{label}</Text>
      <Text style={sr.value}>{value}</Text>
    </View>
  );
}
const sr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  border: { borderBottomWidth: 1, borderBottomColor: C.border },
  label: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, width: 60 },
  value: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
});

const fl = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    overflow: "hidden",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 18, fontFamily: "Pretendard-Regular", color: C.text },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 20, marginBottom: 8, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10 },
  errorText: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error, flex: 1 },

  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 2 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 16 },

  // 1회성 토글
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 4 },
  toggleLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  toggleSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  sw: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: "center" },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },

  // 요일 그리드
  dayGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },

  // 시간 그리드
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  subHint: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 10 },
  hint: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted, textAlign: "center", paddingVertical: 16 },

  // 날짜 입력
  dateBox: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 12, backgroundColor: C.background },
  dateInput: { flex: 1, fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },

  // 선택 chip
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.tintLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8, alignSelf: "flex-start" },
  chipTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  // 선생님 없음
  emptyTeacher: { alignItems: "center", paddingVertical: 20, gap: 8 },
  emptyTeacherTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textMuted },

  // 요약 카드
  summaryCard: { borderRadius: 14, borderWidth: 1.5, overflow: "hidden" },
  summaryName: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  summaryNameTxt: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  summaryRows: { paddingHorizontal: 14 },
  oneTimeBadge: { backgroundColor: "#7C3AED", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  oneTimeBadgeTxt: { color: "#fff", fontSize: 10, fontFamily: "Pretendard-Regular" },

  // 하단 버튼
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  createBtn: { height: 52, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  createBtnTxt: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});
