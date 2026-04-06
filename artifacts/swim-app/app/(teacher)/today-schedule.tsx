/**
 * (teacher)/today-schedule.tsx — 오늘 스케줄 탭 (thin shell)
 * 컴포넌트: components/teacher/today-schedule/
 */
import { BookOpen, ChevronRight, Layers, LogOut, Mail, Repeat, Settings2, Sun, Trophy } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import { Platform, Pressable } from "react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

import ScheduleCard from "@/components/teacher/today-schedule/ScheduleCard";
import { ScheduleCardSkeleton } from "@/components/common/SkeletonBox";
import { haptic } from "@/utils/haptic";
import MemoSheet from "@/components/teacher/today-schedule/MemoSheet";
import AbsenceModal from "@/components/teacher/today-schedule/AbsenceModal";
import ScheduleMemoModal from "@/components/teacher/today-schedule/ScheduleMemoModal";
import UnreadMessagesModal from "@/components/teacher/today-schedule/UnreadMessagesModal";
import TeacherRegisterModal from "@/components/teacher/today-schedule/TeacherRegisterModal";
import { ScheduleItem, formatDate, todayStr } from "@/components/teacher/today-schedule/types";
import ClassDetailSheet from "@/components/teacher/my-schedule/ClassDetailSheet";
import { StudentItem } from "@/components/teacher/my-schedule/utils";
import { TeacherClassGroup } from "@/components/teacher/types";

const C = Colors.light;

interface TeacherOverview {
  unread_messages: number;
  pending_diaries_today: number;
  pending_diaries_past: number;
  makeup_count: number;
}
export default function TodayScheduleScreen() {
  const { token, logout, adminUser, pool, switchRole, setLastUsedRole } = useAuth();
  const { themeColor } = useBrand();
  const insets = useSafeAreaInsets();
  const today = todayStr();

  const [items, setItems]           = useState<ScheduleItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview]     = useState<TeacherOverview | null>(null);
  const [switching, setSwitching]   = useState(false);

  const [showMemo,       setShowMemo]       = useState(false);
  const [showAbsence,    setShowAbsence]    = useState(false);
  const [showSchedMemo,  setShowSchedMemo]  = useState(false);
  const [notePopupVisible, setNotePopupVisible] = useState(false);
  const [showTeacherRegister, setShowTeacherRegister] = useState(false);

  const [activeItem, setActiveItem] = useState<ScheduleItem | null>(null);

  const [activeChipGroup,    setActiveChipGroup]    = useState<TeacherClassGroup | null>(null);
  const [chipStudents,       setChipStudents]       = useState<StudentItem[]>([]);
  const [loadingChipStudents,setLoadingChipStudents]= useState(false);
  const [itemStudentsMap,    setItemStudentsMap]    = useState<Record<string, StudentItem[]>>({});

  // pool_admin과 연결된 선생님 계정에만 관리자 전환 버튼 표시
  const canSwitchToAdmin = !!(adminUser?.roles?.includes("pool_admin"));

  async function handleSwitchToAdmin() {
    if (switching || !canSwitchToAdmin) return;
    setSwitching(true);
    try {
      await switchRole("pool_admin");
      await setLastUsedRole("pool_admin");
      router.replace("/(admin)/dashboard" as any);
    } catch (e) { console.error(e); }
    finally { setSwitching(false); }
  }

  const overviewTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOverview = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiRequest(token, "/teacher/overview");
      if (res.ok) setOverview(await res.json());
    } catch { /* 무시 */ }
  }, [token]);

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

  // 화면 포커스 시 overview 즉시 갱신 + 60초 폴링 (쪽지 배지 실시간 반영)
  useFocusEffect(useCallback(() => {
    loadOverview();
    overviewTimerRef.current = setInterval(loadOverview, 60_000);
    return () => { if (overviewTimerRef.current) clearInterval(overviewTimerRef.current); };
  }, [loadOverview]));

  useEffect(() => {
    if (!token || items.length === 0) return;
    const missing = items.filter(it => !(it.id in itemStudentsMap));
    if (missing.length === 0) return;
    Promise.all(
      missing.map(it =>
        apiRequest(token, `/class-groups/${it.id}/students`)
          .then(r => r.ok ? r.json() : [])
          .then(data => ({
            id: it.id,
            students: (Array.isArray(data) ? data : (data.students ?? [])) as StudentItem[],
          }))
          .catch(() => ({ id: it.id, students: [] as StudentItem[] }))
      )
    ).then(results => {
      setItemStudentsMap(prev => {
        const next = { ...prev };
        results.forEach(r => { next[r.id] = r.students; });
        return next;
      });
    });
  }, [items, token]);

  const pendingAtt  = items.filter(i => i.student_count > 0 && i.att_present < i.student_count).length;
  const diaryPending = items.filter(i => !i.diary_done).length;
  const sortedItems  = [...items].sort((a, b) => a.schedule_time.localeCompare(b.schedule_time));

  const totalTasks  = items.length * 2;
  const doneTasks   = items.filter(i => i.student_count === 0 || i.att_present >= i.student_count).length
                    + items.filter(i => i.diary_done).length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const allDone     = totalTasks > 0 && doneTasks === totalTasks;

  function handleOpenDiaryFromMsg(_diaryId: string) {
    router.push("/(teacher)/diary?backTo=today-schedule" as any);
  }

  function updateItem(id: string, updated: Partial<ScheduleItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...updated } : it));
  }

  async function handleChipPress(item: ScheduleItem) {
    haptic.light();
    const group: TeacherClassGroup = {
      id: item.id,
      name: item.name,
      schedule_days: item.schedule_days,
      schedule_time: item.schedule_time,
      student_count: item.student_count,
      level: item.level,
    };
    setActiveChipGroup(group);
    setChipStudents([]);
    setLoadingChipStudents(true);
    try {
      const res = await apiRequest(token, `/class-groups/${item.id}/students`);
      if (res.ok) {
        const data = await res.json();
        setChipStudents(Array.isArray(data) ? data : (data.students ?? []));
      }
    } catch {}
    setLoadingChipStudents(false);
  }

  function navigateFromChip(navigate: () => void) {
    setActiveChipGroup(null);
    setTimeout(navigate, 200);
  }

  const WEEK_DAYS = ["일","월","화","수","목","금","토"];
  const weekDates = React.useMemo(() => {
    const now = new Date();
    const sun = new Date(now);
    sun.setDate(now.getDate() - now.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(sun); d.setDate(sun.getDate() + i); return d; });
  }, []);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);

  // 미승인 선생님 → 대기 화면
  if (adminUser && adminUser.is_activated === false) {
    return (
      <SafeAreaView style={h.safe} edges={[]}>
        <View style={[h.header, { paddingTop: topPad }]}>
          <View style={{ flex: 1 }}>
            <Text style={[h.poolName, { color: C.text }]}>승인 대기 중</Text>
            <Text style={h.greeting}>{adminUser.name ?? "선생님"}선생님</Text>
          </View>
          <Pressable onPress={logout} style={h.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <LogOut size={18} color={C.textMuted} />
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 20 }}>
          <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: "#FFF8E1", alignItems: "center", justifyContent: "center", marginBottom: 4 }}>
            <Sun size={36} color="#F59E0B" />
          </View>
          <Text style={{ fontSize: 20, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" }}>
            수영장 관리자 승인 대기 중
          </Text>
          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "center", lineHeight: 22 }}>
            관리자가 가입 요청을 확인하고 있어요.{"\n"}승인되면 수영장 정보가 연결되고{"\n"}스케줄을 확인할 수 있어요.
          </Text>
          <View style={{ borderRadius: 16, backgroundColor: C.card, padding: 16, width: "100%", gap: 10,
            shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#EFF4FF", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.tint }}>1</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 }}>
                수영장 관리자가 가입 요청을 검토해요
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#EFF4FF", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.tint }}>2</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 }}>
                승인 후 담당 수업과 학생이 연결돼요
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: "#EFF4FF", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.tint }}>3</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 }}>
                출석체크·일지작성·보강관리를 시작할 수 있어요
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.replace("/(teacher)/today-schedule" as any)}
            style={({ pressed }) => ({ height: 50, borderRadius: 14, paddingHorizontal: 32, borderWidth: 1.5, borderColor: C.border, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.7 : 1, marginTop: 4 })}
          >
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: C.textSecondary }}>새로고침</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={h.safe} edges={[]}>
      <View style={[h.header, { paddingTop: topPad }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[h.poolName, { color: C.text }]} numberOfLines={1}>
              {pool?.name ?? "수영장"}
            </Text>
            {canSwitchToAdmin && (
              <Pressable style={({ pressed }) => [h.switchChip, { borderColor: "#0F172A30", backgroundColor: "#E6FAF8", opacity: pressed || switching ? 0.7 : 1 }]}
                onPress={handleSwitchToAdmin} disabled={switching}>
                {switching
                  ? <ActivityIndicator size="small" color="#0F172A" />
                  : <><Repeat size={10} color="#0F172A" /><Text style={[h.switchChipTxt, { color: "#0F172A" }]}>관리자로 전환</Text></>}
              </Pressable>
            )}
          </View>
          <Text style={h.greeting} numberOfLines={1}>{adminUser?.name ?? "선생님"}선생님</Text>
        </View>
        {/* 학부모 쪽지 확인 버튼 */}
        <Pressable
          onPress={() => setNotePopupVisible(true)}
          style={[h.logoutBtn, { marginRight: 8 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View>
            <Mail size={18} color={C.textMuted} />
            {(overview?.unread_messages ?? 0) > 0 && (
              <View style={{
                position: "absolute", top: -3, right: -3,
                width: 8, height: 8, borderRadius: 4, backgroundColor: "#D96C6C",
              }} />
            )}
          </View>
        </Pressable>
        <Pressable onPress={logout} style={h.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <LogOut size={18} color={C.textMuted} />
        </Pressable>
      </View>

      {/* ── 상단 고정 영역 (스탯 + 주간 + 일지 배너) ── */}
      <View style={h.topFixed}>
        <View style={[h.todayBanner, { backgroundColor: C.card }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={h.todayDate}>{formatDate(today)}</Text>
            {!loading && totalTasks > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                {allDone
                  ? <Trophy size={11} color="#F59E0B" />
                  : null}
                <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: allDone ? "#F59E0B" : C.textMuted }}>
                  {allDone ? "오늘 완료!" : `${progressPct}%`}
                </Text>
              </View>
            )}
          </View>
          {!loading && totalTasks > 0 && (
            <View style={{ height: 3, backgroundColor: C.border, borderRadius: 2, marginBottom: 8, overflow: "hidden" }}>
              <View style={{
                height: 3, borderRadius: 2,
                backgroundColor: allDone ? "#F59E0B" : themeColor,
                width: `${progressPct}%`,
              }} />
            </View>
          )}
          <View style={h.todayStatRow}>
            <Pressable style={h.todayStat} onPress={() => router.push({ pathname:"/(teacher)/my-schedule", params:{openDate:today, backTo:"today-schedule"} } as any)}>
              <Text style={h.todayStatNum}>{loading ? "-" : items.length}</Text>
              <Text style={h.todayStatLabel}>오늘 수업</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/attendance?backTo=today-schedule" as any)}>
              <Text style={[h.todayStatNum, pendingAtt > 0 && { color: C.error }]}>{loading ? "-" : pendingAtt}</Text>
              <Text style={h.todayStatLabel}>출석 미체크</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/diary?backTo=today-schedule" as any)}>
              <Text style={[h.todayStatNum, diaryPending > 0 && { color: C.error }]}>{loading ? "-" : diaryPending}</Text>
              <Text style={h.todayStatLabel}>미작성 일지</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/makeups?backTo=today-schedule" as any)}>
              <Text style={[h.todayStatNum, (overview?.makeup_count ?? 0) > 0 && { color: C.error }]}>
                {loading ? "-" : (overview?.makeup_count ?? 0)}
              </Text>
              <Text style={h.todayStatLabel}>보강 대기</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 미니 주간 캘린더 ── */}
        <View style={[h.weekCard, { backgroundColor: C.card }]}>
          {weekDates.map((d, i) => {
            const dayLabel = WEEK_DAYS[i];
            const dateNum  = d.getDate();
            const isToday  = d.toDateString() === new Date().toDateString();
            const hasClass = items.some(it => {
              const days = (it.schedule_days ?? "").split(",").map((s: string) => s.trim());
              return days.includes(dayLabel);
            });
            return (
              <View key={i} style={h.weekCell}>
                <Text style={[h.weekDay, isToday && { color: themeColor, fontWeight: "600" }]}>{dayLabel}</Text>
                <View style={[h.weekDateBox, isToday && { backgroundColor: themeColor }]}>
                  <Text style={[h.weekDate, isToday && { color: "#fff" }]}>{dateNum}</Text>
                </View>
                {hasClass
                  ? <View style={[h.weekDot, { backgroundColor: isToday ? themeColor : C.tint }]} />
                  : <View style={h.weekDotEmpty} />
                }
              </View>
            );
          })}
        </View>

        {(overview?.pending_diaries_today ?? 0) > 0 && (
          <Pressable
            style={[h.feedbackBanner, { backgroundColor: "#7C3AED" }]}
            onPress={() => router.push("/(teacher)/diary?backTo=today-schedule" as any)}
          >
            <View style={h.feedbackBannerLeft}>
              <Text style={h.feedbackBannerTitle}>미작성 일지 {overview!.pending_diaries_today}개</Text>
              <Text style={h.feedbackBannerSub}>학부모가 기다리고 있어요 · 탭해서 작성</Text>
            </View>
            <ChevronRight size={16} color="rgba(255,255,255,0.8)" />
          </Pressable>
        )}
      </View>

      {/* ── 오늘 수업 카드 (하단 탭바 직전까지 확장) ── */}
      <View style={[h.classCardWrap, { paddingBottom: insets.bottom + 12 }]}>
        <View style={[h.sectionCard, { flex: 1, backgroundColor: C.card }]}>
          <View style={h.sectionHeaderRow}>
            <View style={[h.sectionIconBox, { backgroundColor: C.tintLight }]}>
              <Layers size={13} color={C.iconSchedule} />
            </View>
            <Text style={h.sectionTitle}>오늘 수업</Text>
            {!loading && sortedItems.length > 0 && (
              <Text style={[h.classCnt, { color: C.tint }]}>{sortedItems.length}개</Text>
            )}
          </View>
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}
          >
            {loading ? (
              <View style={{ gap: 10, paddingTop: 4 }}>
                <ScheduleCardSkeleton />
                <ScheduleCardSkeleton />
              </View>
            ) : sortedItems.length === 0 ? (
              <View style={h.badgeEmpty}>
                <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: "#FFF8E1", alignItems: "center", justifyContent: "center", marginBottom: 2 }}>
                  <Sun size={26} color="#F59E0B" />
                </View>
                <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text }}>오늘 수업 없음</Text>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted }}>편하게 쉬어가세요</Text>
              </View>
            ) : sortedItems.map((item, idx) => {
              const students = itemStudentsMap[item.id] ?? [];
              const names    = students.map((s: any) => s.name ?? s.user_name ?? "").filter(Boolean);
              const MAX = 5;
              const shown    = names.slice(0, MAX);
              const extra    = names.length - MAX;
              const nameStr  = shown.join(", ") + (extra > 0 ? ` 외 ${extra}명` : "");
              const isLast   = idx === sortedItems.length - 1;
              const diaryDone = item.diary_done;
              return (
                <Pressable key={item.id}
                  style={({ pressed }) => [h.listRow, !isLast && h.listRowBorder, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    haptic.light();
                    router.push({ pathname: "/(teacher)/diary", params: { classGroupId: item.id, className: item.name, backTo: "today-schedule" } } as any);
                  }}>
                  <View style={[h.diaryStatusBar, { backgroundColor: diaryDone ? "#2EC4B6" : "#F59E0B" }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <Text style={[h.listTime, { color: C.tint }]}>{item.schedule_time}</Text>
                      <Text style={h.listName}>{item.name}</Text>
                      <Text style={[h.listCount, { color: C.textMuted }]}>({item.student_count}명)</Text>
                    </View>
                    {nameStr.length > 0 && (
                      <Text style={h.listNames} numberOfLines={1}>{nameStr}</Text>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                      <BookOpen size={11} color={diaryDone ? "#2EC4B6" : "#F59E0B"} />
                      <Text style={[h.diaryStatusTxt, { color: diaryDone ? "#2EC4B6" : "#F59E0B" }]}>
                        {diaryDone ? "일지 완료" : "일지 미작성"}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    style={h.detailBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 0 }}
                    onPress={(e) => { e.stopPropagation(); haptic.light(); handleChipPress(item); }}>
                    <Settings2 size={16} color={C.textMuted} />
                  </Pressable>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>

      <MemoSheet
        visible={showMemo} item={activeItem} date={today} token={token} themeColor={themeColor}
        onClose={() => { setShowMemo(false); setActiveItem(null); }}
        onSaved={updated => { if (activeItem) updateItem(activeItem.id, updated); }}
      />
      <AbsenceModal
        visible={showAbsence} item={activeItem} date={today} token={token} themeColor={themeColor}
        onClose={() => { setShowAbsence(false); setActiveItem(null); }}
        onDone={() => { load(); }}
      />
      <ScheduleMemoModal visible={showSchedMemo} token={token} themeColor={themeColor}
        onClose={() => setShowSchedMemo(false)} />
      <UnreadMessagesModal visible={notePopupVisible} token={token} themeColor={themeColor}
        onClose={() => setNotePopupVisible(false)} onOpenDiary={handleOpenDiaryFromMsg}
        onMessagesRead={() => setOverview(prev => prev ? { ...prev, unread_messages: 0 } : prev)} />
      <TeacherRegisterModal visible={showTeacherRegister} token={token} themeColor={themeColor}
        onClose={() => setShowTeacherRegister(false)} onSuccess={() => {}} />

      {activeChipGroup && (
        <ClassDetailSheet
          group={activeChipGroup}
          students={loadingChipStudents ? [] : chipStudents}
          attMap={Object.fromEntries(items.map(it => [it.id, it.att_present]))}
          diarySet={new Set(items.filter(it => it.diary_done).map(it => it.id))}
          date={today}
          token={token}
          themeColor={themeColor}
          classGroups={sortedItems.map(it => ({
            id: it.id, name: it.name,
            schedule_days: it.schedule_days, schedule_time: it.schedule_time,
            student_count: it.student_count, level: it.level,
          }))}
          onClose={() => { setActiveChipGroup(null); load(); }}
          onNavigateTo={navigateFromChip}
        />
      )}
    </SafeAreaView>
  );
}

const h = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: C.background },
  topFixed:       { paddingHorizontal: 12, paddingTop: 12, gap: 8 },
  classCardWrap:  { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
  header:         { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border },
  poolName:       { fontSize: 18, fontFamily: "Pretendard-Regular" },
  greeting:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, marginTop: 2 },
  logoutBtn:      { width: 38, height: 38, borderRadius: 10, backgroundColor: C.backgroundSoft, alignItems: "center", justifyContent: "center" },
  switchChip:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  switchChipTxt:  { fontSize: 11, fontFamily: "Pretendard-Regular" },
  scroll:         { padding: 12, gap: 8 },
  todayBanner:    { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  todayDate:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", marginBottom: 6 },
  todayStatRow:   { flexDirection: "row", alignItems: "center" },
  todayStat:      { flex: 1, alignItems: "center", gap: 1, paddingVertical: 0 },
  todayStatNum:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  todayStatLabel: { fontSize: 9, fontFamily: "Pretendard-Regular", color: "#64748B" },
  todayDivider:   { width: 1, height: 18, backgroundColor: C.border },
  sectionCard:    { borderRadius: 14, padding: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  sectionHeaderRow:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  sectionIconBox: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  sectionTitle:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  sectionMore:    { fontSize: 12, fontFamily: "Pretendard-Regular" },
  classCnt:       { marginLeft: "auto", fontSize: 11, fontFamily: "Pretendard-Regular" },
  badgeEmpty:     { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 24 },
  emptyTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  listRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 4, gap: 6 },
  listRowBorder:  { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  listTime:       { fontSize: 12, fontFamily: "Pretendard-Regular", minWidth: 42 },
  listName:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  listCount:      { fontSize: 12, fontFamily: "Pretendard-Regular" },
  listNames:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.text, marginLeft: 50 },
  diaryStatusBar: { width: 3, alignSelf: "stretch", borderRadius: 2, marginRight: 2 },
  diaryStatusTxt: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  detailBtn:      { padding: 8, marginLeft: 4 },
  feedbackBanner:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 16 },
  feedbackBannerLeft: { flex: 1, gap: 2 },
  feedbackBannerTitle:{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  feedbackBannerSub:  { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)" },
  weekCard:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  weekCell:     { flex: 1, alignItems: "center", gap: 5 },
  weekDay:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted },
  weekDateBox:  { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  weekDate:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  weekDot:      { width: 5, height: 5, borderRadius: 3 },
  weekDotEmpty: { width: 5, height: 5 },
  miniDateToday:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  miniDot:          { width: 4, height: 4, borderRadius: 2, backgroundColor: "#2DD4BF", marginTop: -2 },
});
