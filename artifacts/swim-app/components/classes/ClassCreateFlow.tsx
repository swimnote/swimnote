/**
 * ClassCreateFlow — 반 등록 Step UI 공통 컴포넌트
 *
 * Step 1: 요일 선택 (월~토, 복수 선택) / 1회성 반이면 날짜 선택
 * Step 2: 시간 선택 (평일 13:00-21:00 / 토 08:00-16:00)
 * Step 3: 선생님 선택 (pool_admin만, teacher는 자동 스킵)
 * Step 4: 반 개설 확인 카드
 */
import { ArrowLeft, ArrowRight, Calendar, Check, CircleAlert, CircleCheck, Layers, UserX, X } from "lucide-react-native";
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
const SATURDAY = "토" as const;
const ALL_DAYS = [...WEEKDAYS, SATURDAY];
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

function makeTimeSlots(days: string[]): string[] {
  const hasSat = days.includes("토");
  const hasWeekday = days.some(d => WEEKDAYS.includes(d as any));
  const slots: string[] = [];
  if (hasWeekday) {
    for (let h = 13; h <= 21; h++) slots.push(`${String(h).padStart(2, "0")}:00`);
  }
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

interface Teacher {
  id: string;
  name: string;
  is_activated: boolean;
  is_admin_self_teacher: boolean;
}

type StepId = 1 | 2 | 3 | 4;

interface ClassCreateFlowProps {
  token: string | null;
  role: "pool_admin" | "teacher";
  selfTeacher?: { id: string; name: string };
  onSuccess: (newClass: any) => void;
  onClose: () => void;
  initialDays?: string[];
  initialStep?: StepId;
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={sd.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[sd.dot, i + 1 <= current ? sd.dotActive : sd.dotInactive]}
        />
      ))}
    </View>
  );
}
const sd = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: C.tint, width: 20 },
  dotInactive: { backgroundColor: C.border },
});

function DayButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const isSat = label === "토";
  const color = selected ? (isSat ? "#D96C6C" : C.tint) : C.text;
  const bg = selected ? (isSat ? "#F9DEDA" : C.tintLight) : C.background;
  const border = selected ? (isSat ? "#D96C6C" : C.tint) : C.border;
  return (
    <Pressable
      style={[db.btn, { backgroundColor: bg, borderColor: border }]}
      onPress={onPress}
    >
      <Text style={[db.label, { color }]}>{label}</Text>
    </Pressable>
  );
}
const db = StyleSheet.create({
  btn: {
    width: 52, height: 52, borderRadius: 16, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  label: { fontSize: 16, fontFamily: "Pretendard-Regular" },
});

function TimeButton({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[tb.btn, selected && { backgroundColor: C.tint, borderColor: C.tint }]}
      onPress={onPress}
    >
      <Text style={[tb.label, { color: selected ? "#fff" : C.text }]}>{label}</Text>
    </Pressable>
  );
}
const tb = StyleSheet.create({
  btn: {
    width: "30%", paddingVertical: 11,
    borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.background,
  },
  label: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});

function TeacherRow({ t, selected, onPress }: { t: Teacher; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[tr.row, { borderColor: selected ? C.tint : C.border, backgroundColor: selected ? C.tintLight : C.background }]}
      onPress={onPress}
    >
      <View style={[tr.avatar, { backgroundColor: selected ? C.tint : C.border }]}>
        <Text style={[tr.initial, { color: selected ? "#fff" : C.textSecondary }]}>{t.name[0]}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[tr.name, { color: C.text }]}>{t.name}</Text>
        {t.is_admin_self_teacher && (
          <Text style={{ fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" }}>관리자 본인</Text>
        )}
      </View>
      {!t.is_activated && (
        <View style={tr.badge}>
          <Text style={tr.badgeText}>미활성</Text>
        </View>
      )}
      {selected && <CircleCheck size={20} color={C.tint} />}
    </Pressable>
  );
}
const tr = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, marginBottom: 8 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  name: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: "#FFF1BF" },
  badgeText: { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#92400E" },
});

export default function ClassCreateFlow({ token, role, selfTeacher, onSuccess, onClose, initialDays, initialStep }: ClassCreateFlowProps) {
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<StepId>(initialStep ?? 1);
  const [selectedDays, setSelectedDays] = useState<string[]>(initialDays ?? []);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>("#FFFFFF");

  // 1회성 반
  const [isOneTime, setIsOneTime]   = useState(false);
  const [oneTimeDate, setOneTimeDate] = useState(() => new Date().toISOString().split("T")[0]);

  // 기본 정원
  const [defaultCapacity, setDefaultCapacity] = useState<number>(20);

  const isAdmin = role === "pool_admin";
  const totalSteps = isAdmin ? 4 : 3;

  // 기본 정원 로드
  useEffect(() => {
    apiRequest(token, "/admin/class-settings")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.default_capacity) setDefaultCapacity(d.default_capacity); })
      .catch(() => {});
  }, [token]);

  function stepIndex(s: StepId): number {
    if (!isAdmin) {
      if (s === 1) return 1;
      if (s === 2) return 2;
      return 3;
    }
    return s as number;
  }

  useEffect(() => {
    if (step === 3 && isAdmin) {
      setTeachersLoading(true);
      apiRequest(token, "/teachers")
        .then(r => r.json())
        .then(data => setTeachers(Array.isArray(data) ? data : []))
        .catch(() => setTeachers([]))
        .finally(() => setTeachersLoading(false));
    }
  }, [step, isAdmin, token]);

  function toggleDay(d: string) {
    setSelectedDays(prev =>
      prev.includes(d) ? [] : [d]
    );
    setSelectedTime(null);
  }

  function handleOneTimeDateChange(date: string) {
    setOneTimeDate(date);
    const day = getDayOfWeek(date);
    if (day) setSelectedDays([day]);
    else setSelectedDays([]);
    setSelectedTime(null);
  }

  function handleNext() {
    setErrorMsg(null);
    if (step === 1) {
      if (isOneTime) {
        const day = getDayOfWeek(oneTimeDate);
        if (!oneTimeDate || !day) { setErrorMsg("유효한 날짜를 입력해주세요. (YYYY-MM-DD)"); return; }
        setSelectedDays([day]);
      } else {
        if (selectedDays.length === 0) { setErrorMsg("요일을 1개 이상 선택해주세요."); return; }
      }
      setStep(2);
    } else if (step === 2) {
      if (!selectedTime) { setErrorMsg("수업 시간을 선택해주세요."); return; }
      if (isAdmin) setStep(3);
      else setStep(4);
    } else if (step === 3) {
      if (isAdmin && isOneTime && !selectedTeacher) {
        setErrorMsg("1회성 반은 담당 선생님 지정이 필수입니다."); return;
      }
      setStep(4);
    }
  }

  function handleBack() {
    setErrorMsg(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(isAdmin ? 3 : 2);
  }

  async function handleCreate() {
    setSaving(true); setErrorMsg(null);
    try {
      const daysStr = selectedDays.join(",");
      const teacherId = isAdmin ? selectedTeacher?.id : selfTeacher?.id;
      const body: any = {
        schedule_days: daysStr,
        schedule_time: selectedTime,
        teacher_user_id: teacherId || undefined,
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
    } catch (e) {
      setErrorMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const timeSlots = makeTimeSlots(selectedDays.length > 0 ? selectedDays : isOneTime ? [getDayOfWeek(oneTimeDate) || "월"] : ["월"]);
  const dayLabel = isOneTime ? `${oneTimeDate} (${getDayOfWeek(oneTimeDate)}요일)` : selectedDays.join("·") + "요일";
  const classLabel = selectedTime
    ? (isOneTime ? `${oneTimeDate} ${selectedTime}반` : `${selectedDays.join("·")} ${selectedTime}반`)
    : "—";
  const teacherName = isAdmin
    ? (selectedTeacher?.name || "미지정")
    : (selfTeacher?.name || "본인");

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={fl.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[fl.sheet, { height: SCREEN_H * 0.75 }]}>
          {/* 핸들 */}
          <View style={fl.handle} />

          {/* 헤더 */}
          <View style={fl.header}>
            <View>
              <Text style={fl.title}>반 등록</Text>
              <StepDots current={stepIndex(step)} total={totalSteps} />
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {/* 에러 (고정, 스크롤 밖) */}
          {errorMsg && (
            <View style={fl.errorRow}>
              <CircleAlert size={14} color={C.error} />
              <Text style={fl.errorText}>{errorMsg}</Text>
            </View>
          )}

          {/* ── 스크롤 가능한 컨텐츠 영역 ── */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Step 1: 요일/날짜 선택 ── */}
            {step === 1 && (
              <>
                {/* 1회성 반 토글 */}
                <Pressable
                  style={[ot.toggleRow, {
                    backgroundColor: isOneTime ? "#E6FAF8" : C.background,
                    borderColor: isOneTime ? "#7C3AED" : C.border,
                  }]}
                  onPress={() => {
                    setIsOneTime(!isOneTime);
                    setSelectedDays([]);
                    setSelectedTime(null);
                    setErrorMsg(null);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[ot.toggleLabel, { color: isOneTime ? "#7C3AED" : C.text }]}>1회성 반</Text>
                    <Text style={[ot.toggleSub, { color: isOneTime ? "#7C3AED" : C.textMuted }]}>
                      특정 날짜 1회만 운영하는 특별반
                    </Text>
                  </View>
                  <View style={[ot.toggleSwitch, { backgroundColor: isOneTime ? "#7C3AED" : C.border }]}>
                    <View style={[ot.toggleKnob, { transform: [{ translateX: isOneTime ? 18 : 0 }] }]} />
                  </View>
                </Pressable>

                {isOneTime ? (
                  <>
                    <Text style={fl.stepTitle}>수업 날짜를 입력하세요</Text>
                    <Text style={fl.stepSub}>1회만 운영되는 특별 수업입니다</Text>
                    <View style={[ot.dateBox, { borderColor: oneTimeDate && getDayOfWeek(oneTimeDate) ? C.tint : C.border, backgroundColor: C.background }]}>
                      <Calendar size={18} color={C.tint} style={{ marginRight: 10 }} />
                      <TextInput
                        style={[ot.dateInput, { color: C.text }]}
                        value={oneTimeDate}
                        onChangeText={handleOneTimeDateChange}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={C.textMuted}
                        keyboardType="numeric"
                        maxLength={10}
                      />
                    </View>
                    {oneTimeDate && getDayOfWeek(oneTimeDate) ? (
                      <View style={[s1.preview, { backgroundColor: "#E6FAF8" }]}>
                        <CircleCheck size={14} color="#7C3AED" />
                        <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#7C3AED" }}>
                          {oneTimeDate} ({getDayOfWeek(oneTimeDate)}요일)
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={fl.stepTitle}>수업 요일을 선택하세요</Text>
                    <Text style={fl.stepSub}>요일은 1개만 선택 가능합니다</Text>
                    <View style={s1.grid}>
                      {ALL_DAYS.map(d => (
                        <DayButton
                          key={d}
                          label={d}
                          selected={selectedDays.includes(d)}
                          onPress={() => toggleDay(d)}
                        />
                      ))}
                    </View>
                    {selectedDays.length > 0 && (
                      <View style={s1.preview}>
                        <Text style={s1.previewLabel}>선택: </Text>
                        <Text style={[s1.previewValue, { color: C.tint }]}>
                          {selectedDays.join("·")}요일
                        </Text>
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Step 2: 시간 선택 ── */}
            {step === 2 && (
              <>
                <Text style={fl.stepTitle}>수업 시간을 선택하세요</Text>
                <Text style={fl.stepSub}>
                  {isOneTime
                    ? `${oneTimeDate} (${getDayOfWeek(oneTimeDate)}요일) 수업`
                    : selectedDays.includes("토") && selectedDays.some(d => WEEKDAYS.includes(d as any))
                    ? "평일(13:00-21:00) · 토(08:00-16:00)"
                    : selectedDays.includes("토")
                    ? "토요일(08:00-16:00)"
                    : "평일(13:00-21:00)"}
                </Text>
                <View style={s2.grid}>
                  {timeSlots.map(t => (
                    <TimeButton
                      key={t}
                      label={t}
                      selected={selectedTime === t}
                      onPress={() => setSelectedTime(t)}
                    />
                  ))}
                </View>
              </>
            )}

            {/* ── Step 3: 선생님 선택 (관리자만) ── */}
            {step === 3 && isAdmin && (
              <>
                <Text style={fl.stepTitle}>담당 선생님을 선택하세요</Text>
                <Text style={fl.stepSub}>
                  {isOneTime ? "1회성 반은 선생님 지정을 권장합니다" : "선택하지 않으면 미지정으로 개설됩니다"}
                </Text>
                {teachersLoading ? (
                  <ActivityIndicator color={C.tint} style={{ marginTop: 30 }} />
                ) : teachers.length === 0 ? (
                  <View style={s3.empty}>
                    <UserX size={36} color={C.textMuted} />
                    <Text style={[s3.emptyText, { color: C.textMuted }]}>등록된 선생님이 없습니다</Text>
                  </View>
                ) : (
                  <>
                    {!isOneTime && (
                      <Pressable
                        style={[tr.row, {
                          borderColor: C.border,
                          backgroundColor: selectedTeacher === null ? "#FFFFFF" : C.background,
                        }]}
                        onPress={() => setSelectedTeacher(null)}
                      >
                        <View style={[tr.avatar, { backgroundColor: C.border }]}>
                          <UserX size={18} color={C.textMuted} />
                        </View>
                        <Text style={[tr.name, { color: C.textSecondary }]}>미지정</Text>
                        {selectedTeacher === null && <CircleCheck size={20} color={C.textSecondary} />}
                      </Pressable>
                    )}
                    {teachers.map(t => (
                      <TeacherRow
                        key={t.id}
                        t={t}
                        selected={selectedTeacher?.id === t.id}
                        onPress={() => setSelectedTeacher(t)}
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {/* ── Step 4: 반 개설 확인 ── */}
            {step === 4 && (
              <View style={s4.wrap}>
                <Text style={fl.stepTitle}>반 개설을 확인하세요</Text>
                <View style={[s4.card, { borderColor: (isOneTime ? "#7C3AED" : C.tint) + "50" }]}>
                  <View style={[s4.nameRow, { backgroundColor: selectedColor !== "#FFFFFF" ? selectedColor : (isOneTime ? "#E6FAF8" : C.tintLight) }]}>
                    {isOneTime && (
                      <View style={[ot.oneTimeBadge, { backgroundColor: "#7C3AED" }]}>
                        <Text style={{ color: "#fff", fontSize: 10, fontFamily: "Pretendard-Regular" }}>1회성</Text>
                      </View>
                    )}
                    <Layers size={20} color={isOneTime ? "#7C3AED" : C.tint} />
                    <Text style={[s4.name, { color: isOneTime ? "#7C3AED" : C.tint }]}>{classLabel}</Text>
                  </View>
                  <View style={s4.rows}>
                    {isOneTime
                      ? <InfoRow icon="calendar" label="날짜" value={`${oneTimeDate} (${getDayOfWeek(oneTimeDate)}요일)`} />
                      : <InfoRow icon="calendar" label="요일" value={selectedDays.join("·") + "요일"} />
                    }
                    <InfoRow icon="clock" label="시간" value={selectedTime || "—"} />
                    <InfoRow icon="user" label="선생님" value={teacherName} />
                    <InfoRow icon="users" label="기본 정원" value={`${defaultCapacity}명`} />
                  </View>
                </View>

                {/* 반 색상 선택 */}
                <View style={{ marginTop: 20 }}>
                  <Text style={[fl.stepTitle, { fontSize: 14, marginBottom: 6 }]}>반 색상 (선택)</Text>
                  <Text style={{ fontSize: 12, color: C.textMuted, fontFamily: "Pretendard-Regular", marginBottom: 10 }}>
                    시간표에서 반을 구분할 색상을 선택하세요
                  </Text>
                  <PastelColorPicker
                    selected={selectedColor}
                    onSelect={setSelectedColor}
                  />
                </View>
              </View>
            )}
          </ScrollView>

          {/* ── 하단 버튼 (항상 고정, 스크롤과 분리) ── */}
          <View style={[fl.btnRow, { paddingBottom: insets.bottom + 8 }]}>
            {step > 1 && (
              <Pressable style={fl.backBtn} onPress={handleBack}>
                <ArrowLeft size={18} color={C.textSecondary} />
              </Pressable>
            )}
            {step < 4 ? (
              <Pressable
                style={[fl.nextBtn, { backgroundColor: C.tint, flex: step > 1 ? 1 : undefined }]}
                onPress={handleNext}
              >
                <Text style={fl.nextText}>다음</Text>
                <ArrowRight size={16} color="#fff" />
              </Pressable>
            ) : (
              <Pressable
                style={[fl.nextBtn, { backgroundColor: isOneTime ? "#7C3AED" : C.tint, flex: 1 }]}
                onPress={handleCreate}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Check size={16} color="#fff" />
                    <Text style={fl.nextText}>{isOneTime ? "1회성 반 개설" : "반 개설하기"}</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={ir.row}>
      <LucideIcon name={icon} size={14} color={C.textMuted} />
      <Text style={ir.label}>{label}</Text>
      <Text style={ir.value}>{value}</Text>
    </View>
  );
}
const ir = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.border },
  label: { width: 60, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  value: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
});

const fl = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 16, paddingHorizontal: 24 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 6 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 6 },
  stepTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", color: C.text, marginBottom: 4 },
  stepSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted, marginBottom: 16 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#F9DEDA", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginBottom: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.error },
  btnRow: { flexDirection: "row", gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#FFFFFF" },
  backBtn: { width: 50, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  nextBtn: { height: 50, borderRadius: 14, paddingHorizontal: 28, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  nextText: { color: "#fff", fontSize: 16, fontFamily: "Pretendard-Regular" },
});

const s1 = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  preview: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.tintLight, padding: 12, borderRadius: 12 },
  previewLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  previewValue: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});

const s2 = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});

const s3 = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});

const s4 = StyleSheet.create({
  wrap: { gap: 12 },
  card: { borderRadius: 18, borderWidth: 1.5, overflow: "hidden" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  name: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  rows: { paddingHorizontal: 16 },
});

const ot = StyleSheet.create({
  toggleRow: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 16, gap: 12 },
  toggleLabel: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  toggleSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: "center" },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  dateBox: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, height: 52, marginBottom: 12 },
  dateInput: { flex: 1, fontSize: 16, fontFamily: "Pretendard-Regular", letterSpacing: 1 },
  oneTimeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
});
