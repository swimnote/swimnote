/**
 * StudentManagementSheet — 수강생관리 바텀시트
 * 탭1: 미배정회원 리스트  (weekly_count 기준 미충족 학생)
 * 탭2: 보강대기리스트     (status=pending 보강 세션)
 *
 * 배정/보강배정 완료 후 → onAssignDone() 호출 → 주간뷰 복귀 + 데이터 갱신
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/WeeklySchedule";

const C = Colors.light;

/* ──────── 타입 ──────── */
interface UnassignedStudent {
  id: string;
  name: string;
  parent_name?: string | null;
  parent_phone?: string | null;
  weekly_count?: number | null;
  assigned_class_ids?: string[];
  status?: string;
}

interface MakeupSession {
  id: string;
  student_id: string;
  student_name: string;
  original_class_group_id: string | null;
  original_class_group_name: string;
  original_teacher_name: string;
  absence_date: string;
  absence_time?: string | null;
  status: string;
}

interface EligibleClass {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  capacity: number | null;
  current_members: number;
  available_slots: number;
  instructor: string;
  teacher_user_id: string;
}

type ManagementTab = "unassigned" | "makeup";
type SheetView = "tabs" | "weekly-pick" | "class-pick" | "makeup-pick";

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function maskPhone(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 7) return digits.slice(0, 3) + "-****-" + digits.slice(-4);
  return phone;
}

function remainingSlots(stu: UnassignedStudent): number {
  const weekly = stu.weekly_count ?? null;
  if (weekly === null) return 1; // weekly_count 미설정 → 1슬롯 남은 것으로 취급
  const assigned = Array.isArray(stu.assigned_class_ids) ? stu.assigned_class_ids.length : 0;
  return Math.max(0, weekly - assigned);
}

function isFullyAssigned(stu: UnassignedStudent): boolean {
  const weekly = stu.weekly_count ?? null;
  if (weekly === null) return false;
  const assigned = Array.isArray(stu.assigned_class_ids) ? stu.assigned_class_ids.length : 0;
  return assigned >= weekly;
}

/* ──────── 날짜 선택 ──────── */
function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [y, m, d] = value.split("-").map(Number);
  function add(days: number) {
    const dt = new Date(value + "T00:00:00");
    dt.setDate(dt.getDate() + days);
    onChange(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
  }
  const DOW = ["일","월","화","수","목","금","토"][new Date(value + "T00:00:00").getDay()];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 8 }}>
      <TouchableOpacity onPress={() => add(-1)} style={{ padding: 8 }}>
        <Feather name="chevron-left" size={20} color={C.text} />
      </TouchableOpacity>
      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text }}>
        {y}년 {m}월 {d}일 ({DOW})
      </Text>
      <TouchableOpacity onPress={() => add(1)} style={{ padding: 8 }}>
        <Feather name="chevron-right" size={20} color={C.text} />
      </TouchableOpacity>
    </View>
  );
}

/* ──────── 메인 컴포넌트 ──────── */
interface Props {
  visible: boolean;
  token: string | null;
  groups: TeacherClassGroup[];
  themeColor: string;
  readOnly?: boolean;
  onClose: () => void;
  onAssignDone: () => void;
}

export default function StudentManagementSheet({
  visible, token, groups, themeColor, readOnly = false, onClose, onAssignDone,
}: Props) {
  const insets = useSafeAreaInsets();

  /* ── 공통 상태 ── */
  const [tab, setTab]       = useState<ManagementTab>("unassigned");
  const [view, setView]     = useState<SheetView>("tabs");

  /* ── 미배정회원 ── */
  const [allStudents,  setAllStudents]  = useState<UnassignedStudent[]>([]);
  const [stuLoading,   setStuLoading]   = useState(false);

  /* ── 반배정 서브뷰 ── */
  const [pickedStudent,  setPickedStudent]  = useState<UnassignedStudent | null>(null);
  const [pickedWeekly,   setPickedWeekly]   = useState<number>(1);
  const [classSaving,    setClassSaving]    = useState<string | null>(null);

  /* ── 보강대기 ── */
  const [makeups,      setMakeups]      = useState<MakeupSession[]>([]);
  const [mkLoading,    setMkLoading]    = useState(false);

  /* ── 보강배정 서브뷰 ── */
  const [pickedMakeup,      setPickedMakeup]      = useState<MakeupSession | null>(null);
  const [eligibleClasses,   setEligibleClasses]   = useState<EligibleClass[]>([]);
  const [eligLoading,       setEligLoading]       = useState(false);
  const [assignClassId,     setAssignClassId]     = useState("");
  const [assignDate,        setAssignDate]        = useState(todayDateStr);
  const [assigning,         setAssigning]         = useState(false);
  const [assignError,       setAssignError]       = useState("");

  /* ── 미배정 학생 계산 ── */
  const unassigned = allStudents
    .filter(s => s.status !== "inactive" && !isFullyAssigned(s))
    .sort((a, b) => a.name.localeCompare(b.name));

  /* ── 데이터 로드 ── */
  const loadStudents = useCallback(async () => {
    setStuLoading(true);
    try {
      const res = await apiRequest(token, "/students?pool_all=true");
      if (res.ok) {
        const list: UnassignedStudent[] = await res.json();
        setAllStudents(list);
      }
    } catch (e) { console.error(e); }
    finally { setStuLoading(false); }
  }, [token]);

  const loadMakeups = useCallback(async () => {
    setMkLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups?status=pending");
      if (res.ok) {
        const list: MakeupSession[] = await res.json();
        list.sort((a, b) => a.absence_date.localeCompare(b.absence_date));
        setMakeups(list);
      }
    } catch (e) { console.error(e); }
    finally { setMkLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!visible) return;
    setTab("unassigned");
    setView("tabs");
    loadStudents();
    loadMakeups();
  }, [visible]);

  /* ── 미배정 → 반배정 시작 ── */
  function startAssignStudent(stu: UnassignedStudent) {
    setPickedStudent(stu);
    if (stu.weekly_count == null) {
      setPickedWeekly(1);
      setView("weekly-pick");
    } else {
      setPickedWeekly(stu.weekly_count);
      setView("class-pick");
    }
  }

  /* ── 반 배정 실행 ── */
  async function doAssignToClass(classId: string) {
    if (!pickedStudent) return;
    setClassSaving(classId);
    try {
      const currentIds = Array.isArray(pickedStudent.assigned_class_ids)
        ? pickedStudent.assigned_class_ids : [];
      if (currentIds.includes(classId)) return;
      const newIds = [...currentIds, classId];
      const res = await apiRequest(token, `/students/${pickedStudent.id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_class_ids: newIds, weekly_count: pickedWeekly }),
      });
      if (res.ok) {
        onAssignDone();
      }
    } catch (e) { console.error(e); }
    finally { setClassSaving(null); }
  }

  /* ── 보강 → 배정 시작 ── */
  async function startAssignMakeup(mk: MakeupSession) {
    setPickedMakeup(mk);
    setAssignClassId("");
    setAssignDate(todayDateStr());
    setAssignError("");
    setEligLoading(true);
    setView("makeup-pick");
    try {
      const res = await apiRequest(token, "/teacher/makeups/eligible-classes");
      if (res.ok) {
        const list: EligibleClass[] = await res.json();
        list.sort((a, b) => a.schedule_days.localeCompare(b.schedule_days));
        setEligibleClasses(list);
      }
    } catch (e) { console.error(e); }
    finally { setEligLoading(false); }
  }

  /* ── 보강 배정 실행 ── */
  async function doAssignMakeup() {
    if (!pickedMakeup || !assignClassId) { setAssignError("반을 선택해주세요."); return; }
    setAssigning(true); setAssignError("");
    try {
      const res = await apiRequest(token, `/teacher/makeups/${pickedMakeup.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_group_id: assignClassId, assigned_date: assignDate }),
      });
      if (res.ok) {
        onAssignDone();
      } else {
        const d = await res.json().catch(() => ({}));
        setAssignError(d.error || "배정에 실패했습니다.");
      }
    } catch (e) { setAssignError("배정에 실패했습니다."); }
    finally { setAssigning(false); }
  }

  /* ── 공통 헤더 ── */
  function SheetHeader({ title, onBack }: { title: string; onBack?: () => void }) {
    return (
      <View style={st.header}>
        {onBack ? (
          <Pressable onPress={onBack} style={{ padding: 4, marginRight: 8 }}>
            <Feather name="arrow-left" size={20} color={C.textSecondary} />
          </Pressable>
        ) : null}
        <Text style={st.headerTitle}>{title}</Text>
        <Pressable onPress={onClose} style={{ padding: 4 }}>
          <Feather name="x" size={20} color={C.textSecondary} />
        </Pressable>
      </View>
    );
  }

  /* ── 미배정회원 탭 ── */
  function UnassignedTab() {
    if (stuLoading) return (
      <View style={st.center}>
        <ActivityIndicator color={themeColor} />
      </View>
    );
    if (unassigned.length === 0) return (
      <View style={st.emptyBox}>
        <Feather name="check-circle" size={32} color={C.textMuted} />
        <Text style={st.emptyText}>현재 미배정 회원이 없습니다.</Text>
      </View>
    );
    return (
      <FlatList
        data={unassigned}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={readOnly ? (
          <View style={[st.readOnlyBanner, { marginTop: 8 }]}>
            <Feather name="eye" size={12} color="#6B7280" />
            <Text style={st.readOnlyText}>조회 전용 — 배정 기능은 선생님 계정에서 사용하세요</Text>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const weekly = item.weekly_count ?? null;
          const assigned = Array.isArray(item.assigned_class_ids) ? item.assigned_class_ids.length : 0;
          const remaining = weekly != null ? weekly - assigned : null;
          const contactText = item.parent_name
            ? item.parent_name
            : maskPhone(item.parent_phone);
          return (
            <View style={st.row}>
              <View style={st.rowAvatarWrap}>
                <View style={[st.rowAvatar, { backgroundColor: themeColor + "20" }]}>
                  <Text style={[st.rowAvatarText, { color: themeColor }]}>{item.name[0]}</Text>
                </View>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.rowName}>{item.name}</Text>
                {contactText ? (
                  <Text style={st.rowSub}>{contactText}</Text>
                ) : null}
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 1 }}>
                  {weekly != null ? (
                    <View style={st.badge}>
                      <Text style={st.badgeText}>주{weekly}회</Text>
                    </View>
                  ) : (
                    <View style={[st.badge, { backgroundColor: "#FEF3C7" }]}>
                      <Text style={[st.badgeText, { color: "#92400E" }]}>횟수미설정</Text>
                    </View>
                  )}
                  <View style={[st.badge, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={[st.badgeText, { color: "#DC2626" }]}>미배정</Text>
                  </View>
                  {remaining != null && (
                    <Text style={st.remaining}>남은배정 {remaining}개</Text>
                  )}
                </View>
              </View>
              {!readOnly && (
                <Pressable
                  style={[st.actionBtn, { backgroundColor: themeColor }]}
                  onPress={() => startAssignStudent(item)}
                >
                  <Text style={st.actionBtnText}>반배정</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    );
  }

  /* ── 보강대기 탭 ── */
  function MakeupTab() {
    if (mkLoading) return (
      <View style={st.center}>
        <ActivityIndicator color={themeColor} />
      </View>
    );
    if (makeups.length === 0) return (
      <View style={st.emptyBox}>
        <Feather name="check-circle" size={32} color={C.textMuted} />
        <Text style={st.emptyText}>현재 보강 대기 회원이 없습니다.</Text>
      </View>
    );
    return (
      <FlatList
        data={makeups}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={readOnly ? (
          <View style={[st.readOnlyBanner, { marginTop: 8 }]}>
            <Feather name="eye" size={12} color="#6B7280" />
            <Text style={st.readOnlyText}>조회 전용 — 배정 기능은 선생님 계정에서 사용하세요</Text>
          </View>
        ) : null}
        renderItem={({ item }) => {
          const absDate = item.absence_date;
          const [y, m, d] = absDate.split("-").map(Number);
          const DOW = ["일","월","화","수","목","금","토"][new Date(absDate + "T00:00:00").getDay()];
          return (
            <View style={st.row}>
              <View style={st.rowAvatarWrap}>
                <View style={[st.rowAvatar, { backgroundColor: "#FEF3C7" }]}>
                  <Text style={[st.rowAvatarText, { color: "#92400E" }]}>{item.student_name[0]}</Text>
                </View>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.rowName}>{item.student_name}</Text>
                <Text style={st.rowSub}>{item.original_class_group_name}</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 1 }}>
                  <View style={[st.badge, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={[st.badgeText, { color: "#DC2626" }]}>보강대기</Text>
                  </View>
                  <Text style={st.rowSub}>결석일 {y}.{m}.{d}({DOW})</Text>
                </View>
              </View>
              {!readOnly && (
                <Pressable
                  style={[st.actionBtn, { backgroundColor: "#F59E0B" }]}
                  onPress={() => startAssignMakeup(item)}
                >
                  <Text style={st.actionBtnText}>보강배정</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    );
  }

  /* ── 주횟수 선택 뷰 ── */
  function WeeklyPickView() {
    return (
      <View style={{ flex: 1 }}>
        <SheetHeader
          title={`${pickedStudent?.name} — 주 수업 횟수`}
          onBack={() => setView("tabs")}
        />
        <View style={{ padding: 24, gap: 12 }}>
          <Text style={st.pickLabel}>이 회원의 주당 수업 횟수를 선택해주세요.</Text>
          {[1, 2, 3].map(n => (
            <Pressable
              key={n}
              style={[st.weeklyBtn, pickedWeekly === n && { backgroundColor: themeColor, borderColor: themeColor }]}
              onPress={() => setPickedWeekly(n)}
            >
              <Text style={[st.weeklyBtnText, pickedWeekly === n && { color: "#fff" }]}>주 {n}회</Text>
            </Pressable>
          ))}
          <Pressable
            style={[st.confirmBtn, { backgroundColor: themeColor, marginTop: 8 }]}
            onPress={() => setView("class-pick")}
          >
            <Text style={st.confirmBtnText}>다음 — 반 선택</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  /* ── 반 선택 뷰 ── */
  function ClassPickView() {
    const currentIds = Array.isArray(pickedStudent?.assigned_class_ids)
      ? pickedStudent!.assigned_class_ids : [];
    const available = groups.filter(g => !currentIds.includes(g.id));

    return (
      <View style={{ flex: 1 }}>
        <SheetHeader
          title={`${pickedStudent?.name} — 반 선택`}
          onBack={() => setView(pickedStudent?.weekly_count == null ? "weekly-pick" : "tabs")}
        />
        <Text style={[st.pickLabel, { marginHorizontal: 16, marginBottom: 4 }]}>
          주 {pickedWeekly}회 · 배정할 반을 선택해주세요
        </Text>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
          {available.length === 0 ? (
            <View style={st.emptyBox}>
              <Text style={st.emptyText}>배정 가능한 반이 없습니다.</Text>
            </View>
          ) : available.map(g => {
            const isSaving = classSaving === g.id;
            const days = g.schedule_days.split(",").map((d: string) => d.trim()).join("·");
            const gAny = g as any;
            const capFull = gAny.capacity != null && gAny.student_count >= gAny.capacity;
            return (
              <Pressable
                key={g.id}
                style={[st.classRow, capFull && st.classRowFull]}
                onPress={() => !capFull && !isSaving && doAssignToClass(g.id)}
                disabled={capFull || !!classSaving}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[st.className, capFull && { color: C.textMuted }]}>{g.name}</Text>
                  <Text style={st.classSub}>{days} · {g.schedule_time}</Text>
                  {gAny.capacity != null && (
                    <Text style={[st.classCap, capFull && { color: "#DC2626" }]}>
                      정원 {g.student_count}/{gAny.capacity}명{capFull ? " · 정원 초과" : ""}
                    </Text>
                  )}
                </View>
                {isSaving ? (
                  <ActivityIndicator color={themeColor} size="small" />
                ) : (
                  <View style={[st.pickBadge, capFull ? st.pickBadgeFull : { backgroundColor: themeColor }]}>
                    <Text style={[st.pickBadgeText, capFull && { color: "#DC2626" }]}>
                      {capFull ? "정원초과" : "선택"}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  /* ── 보강반 선택 뷰 ── */
  function MakeupPickView() {
    return (
      <View style={{ flex: 1 }}>
        <SheetHeader
          title={`${pickedMakeup?.student_name} — 보강반 선택`}
          onBack={() => { setView("tabs"); setTab("makeup"); }}
        />
        <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
          <Text style={st.pickLabel}>보강 날짜를 선택하세요</Text>
        </View>
        <DatePicker value={assignDate} onChange={setAssignDate} />
        <Text style={[st.pickLabel, { marginHorizontal: 16, marginBottom: 4 }]}>보강 가능한 반 선택</Text>

        {eligLoading ? (
          <View style={st.center}>
            <ActivityIndicator color={themeColor} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
            {eligibleClasses.length === 0 ? (
              <View style={st.emptyBox}>
                <Text style={st.emptyText}>보강 가능한 반이 없습니다.</Text>
              </View>
            ) : eligibleClasses.map(ec => {
              const isFull = ec.available_slots <= 0;
              const selected = assignClassId === ec.id;
              const days = ec.schedule_days.split(",").map((d: string) => d.trim()).join("·");
              return (
                <Pressable
                  key={ec.id}
                  style={[
                    st.classRow,
                    isFull && st.classRowFull,
                    selected && { borderColor: themeColor, borderWidth: 2 },
                  ]}
                  onPress={() => !isFull && setAssignClassId(ec.id)}
                  disabled={isFull}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[st.className, isFull && { color: C.textMuted }]}>{ec.name}</Text>
                    <Text style={st.classSub}>{days} · {ec.schedule_time}</Text>
                    <Text style={[st.classCap, isFull && { color: "#DC2626" }]}>
                      여석 {ec.available_slots}명{isFull ? " · 정원 초과" : ""}
                    </Text>
                  </View>
                  {isFull ? (
                    <View style={st.pickBadgeFull}>
                      <Text style={[st.pickBadgeText, { color: "#DC2626" }]}>정원초과</Text>
                    </View>
                  ) : selected ? (
                    <View style={[st.pickBadge, { backgroundColor: themeColor }]}>
                      <Feather name="check" size={14} color="#fff" />
                    </View>
                  ) : (
                    <View style={[st.pickBadge, { backgroundColor: "#F3F4F6" }]}>
                      <Text style={[st.pickBadgeText, { color: C.textSecondary }]}>선택</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {assignError ? (
          <Text style={{ color: "#DC2626", fontSize: 13, textAlign: "center", marginBottom: 8 }}>{assignError}</Text>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
          <Pressable
            style={[st.confirmBtn, { backgroundColor: assignClassId ? themeColor : C.border, opacity: assigning ? 0.6 : 1 }]}
            onPress={doAssignMakeup}
            disabled={!assignClassId || assigning}
          >
            {assigning
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={st.confirmBtnText}>보강 배정 완료</Text>}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={[st.sheet, { paddingBottom: insets.bottom }]}>
        <View style={st.handle} />

        {/* ── 탭 리스트 뷰 ── */}
        {view === "tabs" && (
          <View style={{ flex: 1 }}>
            <SheetHeader title="수강생관리" />

            {/* 탭 버튼 */}
            <View style={st.tabRow}>
              {(["unassigned", "makeup"] as ManagementTab[]).map(t => {
                const label = t === "unassigned" ? "미배정회원 리스트" : "보강대기리스트";
                const count = t === "unassigned" ? unassigned.length : makeups.length;
                const active = tab === t;
                return (
                  <Pressable
                    key={t}
                    style={[st.tabBtn, active && { borderBottomColor: themeColor, borderBottomWidth: 2 }]}
                    onPress={() => setTab(t)}
                  >
                    <Text style={[st.tabBtnText, active && { color: themeColor }]}>{label}</Text>
                    {count > 0 && (
                      <View style={[st.tabBadge, { backgroundColor: active ? themeColor : "#9CA3AF" }]}>
                        <Text style={st.tabBadgeText}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {tab === "unassigned" ? <UnassignedTab /> : <MakeupTab />}
          </View>
        )}

        {view === "weekly-pick" && <WeeklyPickView />}
        {view === "class-pick"  && <ClassPickView />}
        {view === "makeup-pick" && <MakeupPickView />}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    maxHeight: "90%", minHeight: "60%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "#D1D5DB", alignSelf: "center",
    marginTop: 10, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: {
    flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: C.text,
  },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 12,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnText: {
    fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary,
  },
  tabBadge: {
    borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1,
    minWidth: 18, alignItems: "center",
  },
  tabBadgeText: {
    fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff",
  },
  row: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.card, borderRadius: 14,
    padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.border,
    gap: 10,
  },
  rowAvatarWrap: { width: 40 },
  rowAvatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: "center", justifyContent: "center",
  },
  rowAvatarText: {
    fontSize: 16, fontFamily: "Inter_700Bold",
  },
  rowName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  rowSub:  { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  badge:   {
    backgroundColor: C.border, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary },
  remaining: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#6366F1" },
  actionBtn: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: "center", justifyContent: "center",
  },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  center:   { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  emptyBox: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 10 },
  emptyText:{ fontSize: 14, fontFamily: "Inter_400Regular", color: C.textMuted },

  pickLabel: {
    fontSize: 13, fontFamily: "Inter_500Medium",
    color: C.textSecondary, marginBottom: 4,
  },

  weeklyBtn: {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
    backgroundColor: "#fff",
  },
  weeklyBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text },

  classRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.card, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: C.border, gap: 10,
  },
  classRowFull: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  className: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginBottom: 2 },
  classSub:  { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted },
  classCap:  { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, marginTop: 2 },

  pickBadge: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    alignItems: "center", justifyContent: "center",
  },
  pickBadgeFull: {
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "#FEE2E2",
    alignItems: "center", justifyContent: "center",
  },
  pickBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },

  confirmBtn: {
    paddingVertical: 15, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },

  readOnlyBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F3F4F6", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 4,
  },
  readOnlyText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#6B7280", flex: 1 },
});
