/**
 * (admin)/classes.tsx — 관리자 수업 탭
 * 주간 시간표 고정 → 셀 클릭 → 선생님 선택 → 반 목록 → 반 현황판
 * 반 등록(ClassCreateFlow) 포함
 */
import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { addTabResetListener } from "@/utils/tabReset";
import AdminWeekBoard, { ClassGroupItem } from "@/components/admin/AdminWeekBoard";
import TeacherPickerList, { TeacherForPicker } from "@/components/admin/TeacherPickerList";
import ClassDetailPanel, { ClassDetail } from "@/components/admin/ClassDetailPanel";
import ClassCreateFlow from "@/components/classes/ClassCreateFlow";

const C = Colors.light;
const TAB_BAR_H = Platform.OS === "web" ? 84 : Platform.OS === "android" ? 56 : 49;

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseStartTime(t: string) { return t.split(/[-~]/)[0].trim(); }

interface Teacher {
  id: string; name: string; phone: string; position: string; is_activated: boolean;
}
interface AttRecord { student_id: string; status: string; class_group_id: string; }
interface DiaryRec { id: string; class_group_id: string; }

type NavStep =
  | { step: "main" }
  | { step: "teachers"; day: string; time: string }
  | { step: "classes"; day: string; time: string; teacherId: string }
  | { step: "detail"; day: string; time: string; teacherId: string; classId: string };

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();

  const [classGroups, setClassGroups] = useState<ClassGroupItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttRecord[]>>({});
  const [diarySet, setDiarySet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [nav, setNav] = useState<NavStep>({ step: "main" });

  // 탭 포커스 시 첫 화면으로 초기화
  useFocusEffect(
    useCallback(() => {
      setNav({ step: "main" });
    }, [])
  );

  // 같은 탭 재탭 시 첫 화면으로 초기화
  useEffect(() => {
    return addTabResetListener("classes", () => setNav({ step: "main" }));
  }, []);

  const [classDetail, setClassDetail] = useState<ClassDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailDate, setDetailDate] = useState(todayDateStr());

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // ── 데이터 로드
  const loadAll = useCallback(async () => {
    try {
      const today = todayDateStr();
      const [cgRes, tRes, attRes, diaryRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/teachers"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (cgRes.ok) setClassGroups((await cgRes.json()).filter((g: any) => !g.is_deleted));
      if (tRes.ok) setTeachers(await tRes.json());
      if (attRes.ok) {
        const data: AttRecord[] = await attRes.json();
        const map: Record<string, AttRecord[]> = {};
        data.forEach(a => { if (!map[a.class_group_id]) map[a.class_group_id] = []; map[a.class_group_id].push(a); });
        setAttendanceMap(map);
      }
      if (diaryRes.ok) {
        const data: DiaryRec[] = await diaryRes.json();
        setDiarySet(new Set(data.map(d => d.class_group_id)));
      }
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function fetchClassDetail(classId: string) {
    setDetailLoading(true);
    const today = todayDateStr();
    setDetailDate(today);
    try {
      const res = await apiRequest(token, `/admin/class-groups/${classId}/detail?date=${today}`);
      if (res.ok) setClassDetail(await res.json());
    } finally { setDetailLoading(false); }
  }

  // ── 탐색 핸들러
  function onCellPress(day: string, time: string) { setNav({ step: "teachers", day, time }); }

  function onSelectTeacher(teacherId: string) {
    if (nav.step !== "teachers") return;
    setNav({ step: "classes", day: nav.day, time: nav.time, teacherId });
  }

  function onSelectClass(classId: string) {
    if (nav.step !== "classes") return;
    setClassDetail(null);
    setNav({ step: "detail", day: nav.day, time: nav.time, teacherId: nav.teacherId, classId });
    fetchClassDetail(classId);
  }

  function goBack() {
    if (nav.step === "detail") { const { day, time, teacherId } = nav; setNav({ step: "classes", day, time, teacherId }); }
    else if (nav.step === "classes") { const { day, time } = nav; setNav({ step: "teachers", day, time }); }
    else if (nav.step === "teachers") { setNav({ step: "main" }); }
  }

  // ── 선생님 목록 for picker
  const teachersForPicker = useMemo((): TeacherForPicker[] => {
    if (nav.step !== "teachers") return [];
    const { day, time } = nav;
    const slotGroups = classGroups.filter(g =>
      g.schedule_days.split(",").map(d => d.trim()).includes(day) &&
      parseStartTime(g.schedule_time) === time
    );
    const ids = [...new Set(slotGroups.map(g => g.teacher_user_id).filter(Boolean))] as string[];
    return ids.map(id => {
      const t = teachers.find(x => x.id === id);
      if (!t) return null;
      const tgs = slotGroups.filter(g => g.teacher_user_id === id);
      return {
        id: t.id, name: t.name, position: t.position, classCount: tgs.length,
        uncheckedAtt: tgs.filter(g => (attendanceMap[g.id]?.length ?? 0) < g.student_count).length,
        unwrittenDiary: tgs.filter(g => !diarySet.has(g.id)).length,
      };
    }).filter(Boolean) as TeacherForPicker[];
  }, [nav, classGroups, teachers, attendanceMap, diarySet]);

  // ── 반 목록 for list view
  const classesForList = useMemo(() => {
    if (nav.step !== "classes") return [];
    const { day, time, teacherId } = nav;
    return classGroups.filter(g =>
      g.schedule_days.split(",").map(d => d.trim()).includes(day) &&
      parseStartTime(g.schedule_time) === time &&
      g.teacher_user_id === teacherId
    );
  }, [nav, classGroups]);

  // ── 반 삭제
  async function confirmDeleteClass() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await apiRequest(token, `/class-groups/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false); setDeleteTarget(null);
    if (res.ok) { setClassGroups(prev => prev.filter(g => g.id !== deleteTarget.id)); setNav({ step: "main" }); }
  }

  const crumbTeacher = (nav.step === "classes" || nav.step === "detail")
    ? teachers.find(t => t.id === (nav as any).teacherId)?.name ?? "선생님" : "";

  const headerTitle = nav.step === "main" ? "수업"
    : nav.step === "teachers" ? `${nav.day}요일 ${nav.time}`
    : nav.step === "classes" ? crumbTeacher
    : (classDetail?.class_group.name ?? "반 현황판");

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          {nav.step !== "main" && (
            <Pressable onPress={goBack} hitSlop={8}>
              <Feather name="arrow-left" size={20} color={C.tint} />
            </Pressable>
          )}
          <Text style={[s.title, { color: C.text }]} numberOfLines={1}>{headerTitle}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {nav.step === "main" && (
            <>
              <Pressable style={[s.btn, { backgroundColor: "#FEF9C3" }]} onPress={() => router.push("/(admin)/community" as any)}>
                <Feather name="bell" size={14} color="#CA8A04" />
                <Text style={[s.btnTxt, { color: "#CA8A04" }]}>공지</Text>
              </Pressable>
              <Pressable style={[s.btn, { backgroundColor: "#EDE9FE" }]} onPress={() => {}}>
                <Feather name="rotate-ccw" size={14} color="#7C3AED" />
                <Text style={[s.btnTxt, { color: "#7C3AED" }]}>보강</Text>
              </Pressable>
              <Pressable style={[s.btn, { backgroundColor: C.tint }]} onPress={() => setShowCreate(true)}>
                <Feather name="plus" size={14} color="#fff" />
                <Text style={[s.btnTxt, { color: "#fff" }]}>반 등록</Text>
              </Pressable>
            </>
          )}
          {nav.step === "detail" && classDetail && (
            <Pressable style={[s.btn, { backgroundColor: "#FEE2E2" }]}
              onPress={() => setDeleteTarget({ id: classDetail.class_group.id, name: classDetail.class_group.name })}>
              <Feather name="trash-2" size={14} color="#EF4444" />
              <Text style={[s.btnTxt, { color: "#EF4444" }]}>삭제</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* 브레드크럼 */}
      {nav.step !== "main" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[s.breadcrumb, { borderBottomColor: C.border }]}
          contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20, paddingVertical: 8 }}>
          <Pressable onPress={() => setNav({ step: "main" })}><Text style={[s.crumb, { color: C.tint }]}>주간보드</Text></Pressable>
          {(nav.step === "teachers" || nav.step === "classes" || nav.step === "detail") && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => nav.step !== "teachers" && setNav({ step: "teachers", day: (nav as any).day, time: (nav as any).time })}>
                <Text style={[s.crumb, { color: nav.step === "teachers" ? C.text : C.tint, fontWeight: nav.step === "teachers" ? "700" : "500" }]}>
                  {(nav as any).day}요일 {(nav as any).time}
                </Text>
              </Pressable>
            </>
          )}
          {(nav.step === "classes" || nav.step === "detail") && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Pressable onPress={() => nav.step !== "classes" && setNav({ step: "classes", day: (nav as any).day, time: (nav as any).time, teacherId: (nav as any).teacherId })}>
                <Text style={[s.crumb, { color: nav.step === "classes" ? C.text : C.tint, fontWeight: nav.step === "classes" ? "700" : "500" }]}>{crumbTeacher}</Text>
              </Pressable>
            </>
          )}
          {nav.step === "detail" && classDetail && (
            <>
              <Feather name="chevron-right" size={12} color={C.textMuted} />
              <Text style={[s.crumb, { color: C.text, fontWeight: "700" }]}>{classDetail.class_group.name}</Text>
            </>
          )}
        </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : (
        <>
          {/* ── 주간 보드 */}
          {nav.step === "main" && (
            <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(); }} />}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_H + 20 }}>
              <View style={[s.hintRow, { backgroundColor: C.tintLight }]}>
                <Feather name="info" size={13} color={C.tint} />
                <Text style={[s.hintTxt, { color: C.tint }]}>요일·시간 셀을 눌러 선생님·반을 탐색하세요</Text>
              </View>
              <AdminWeekBoard classGroups={classGroups} onCellPress={onCellPress} />
              {classGroups.length === 0 && (
                <View style={s.emptyBox}>
                  <Feather name="layers" size={48} color={C.textMuted} />
                  <Text style={[s.emptyTitle, { color: C.textMuted }]}>등록된 반이 없습니다</Text>
                  <Text style={[s.emptySub, { color: C.textMuted }]}>상단 '반 등록'을 눌러 첫 번째 반을 만들어보세요</Text>
                </View>
              )}
            </ScrollView>
          )}

          {/* ── 선생님 선택 */}
          {nav.step === "teachers" && (
            <TeacherPickerList day={nav.day} time={nav.time} teachers={teachersForPicker}
              onSelectTeacher={onSelectTeacher} onBack={goBack} bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}

          {/* ── 반 목록 */}
          {nav.step === "classes" && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + TAB_BAR_H + 20, gap: 8 }} showsVerticalScrollIndicator={false}>
              <Text style={[s.sectionHead, { color: C.text }]}>반 선택</Text>
              <Text style={[s.sectionSub, { color: C.textMuted }]}>{nav.day}요일 {nav.time} · {crumbTeacher}</Text>
              {classesForList.length === 0 ? (
                <View style={s.emptyBox}>
                  <Feather name="layers" size={36} color={C.textMuted} />
                  <Text style={[s.emptyTitle, { color: C.textMuted }]}>해당 시간에 반이 없습니다</Text>
                </View>
              ) : classesForList.map(g => {
                const att = attendanceMap[g.id] || [];
                const present = att.filter(a => a.status === "present").length;
                const absent = att.filter(a => a.status === "absent").length;
                const hasDiary = diarySet.has(g.id);
                return (
                  <Pressable key={g.id} style={[s.classRow, { backgroundColor: C.card }]} onPress={() => onSelectClass(g.id)}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <Text style={[s.className, { color: C.text }]}>{g.name}</Text>
                        <View style={[s.diaryBadge, { backgroundColor: hasDiary ? "#D1FAE5" : "#FEF3C7" }]}>
                          <Text style={[s.diaryBadgeTxt, { color: hasDiary ? "#059669" : "#D97706" }]}>{hasDiary ? "일지 완료" : "일지 미작성"}</Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <Text style={[s.classStat, { color: C.textSecondary }]}>학생 {g.student_count}명</Text>
                        <Text style={[s.classStat, { color: "#059669" }]}>출석 {present}</Text>
                        <Text style={[s.classStat, { color: "#EF4444" }]}>결석 {absent}</Text>
                      </View>
                    </View>
                    <Feather name="chevron-right" size={18} color={C.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {/* ── 반 현황판 */}
          {nav.step === "detail" && (
            <ClassDetailPanel detail={classDetail} loading={detailLoading} date={detailDate}
              onBack={goBack} bottomInset={insets.bottom + TAB_BAR_H + 20} />
          )}
        </>
      )}

      {/* 반 등록 모달 */}
      {showCreate && (
        <ClassCreateFlow token={token} role="pool_admin"
          onSuccess={(newGroup) => { setClassGroups(prev => [newGroup, ...prev]); setShowCreate(false); }}
          onClose={() => setShowCreate(false)} />
      )}

      {/* 삭제 확인 모달 */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent presentationStyle="overFullScreen">
        <View style={s.overlay}>
          <View style={[s.confirmCard, { backgroundColor: C.card }]}>
            <Text style={[s.confirmTitle, { color: C.text }]}>반 삭제</Text>
            <Text style={[s.confirmMsg, { color: C.textSecondary }]}>
              {deleteTarget?.name}을 삭제하면{"\n"}소속 학생은 미배정 상태로 변경됩니다.
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable style={[s.confirmBtn, { borderColor: C.border, borderWidth: 1.5 }]} onPress={() => setDeleteTarget(null)}>
                <Text style={[s.confirmBtnTxt, { color: C.textSecondary }]}>취소</Text>
              </Pressable>
              <Pressable style={[s.confirmBtn, { backgroundColor: "#EF4444" }]} onPress={confirmDeleteClass} disabled={deleting}>
                {deleting ? <ActivityIndicator size={16} color="#fff" /> : <Text style={[s.confirmBtnTxt, { color: "#fff" }]}>삭제</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", flex: 1 },
  btn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  btnTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  breadcrumb: { borderBottomWidth: 1 },
  crumb: { fontSize: 13, fontFamily: "Inter_500Medium" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginVertical: 10, padding: 10, borderRadius: 10 },
  hintTxt: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  sectionHead: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 2 },
  sectionSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 8 },
  classRow: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 1 },
  className: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  classStat: { fontSize: 12, fontFamily: "Inter_400Regular" },
  diaryBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  diaryBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  emptyBox: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  emptySub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center" },
  confirmCard: { borderRadius: 20, padding: 24, gap: 8, width: "80%", maxWidth: 320 },
  confirmTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  confirmMsg: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  confirmBtn: { flex: 1, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  confirmBtnTxt: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
