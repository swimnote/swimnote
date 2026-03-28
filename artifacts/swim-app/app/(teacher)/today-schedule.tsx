/**
 * (teacher)/today-schedule.tsx — 오늘 스케줄 탭 (thin shell)
 * 컴포넌트: components/teacher/today-schedule/
 */
import { ChevronRight, Layers, LogOut, Repeat, Sun, UserPlus } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { router } from "expo-router";
import { Platform, Pressable } from "react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";

import ScheduleCard from "@/components/teacher/today-schedule/ScheduleCard";
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
interface HubIcon {
  key: string; label: string; icon: string; color: string; bg: string;
  badge?: number | null; onPress: () => void;
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

  const pendingAtt  = items.filter(i => i.student_count > 0 && i.att_present < i.student_count).length;
  const diaryPending = items.filter(i => !i.diary_done).length;
  const sortedItems  = [...items].sort((a, b) => a.schedule_time.localeCompare(b.schedule_time));

  function handleOpenDiaryFromMsg(_diaryId: string) {
    router.push("/(teacher)/diary" as any);
  }

  function updateItem(id: string, updated: Partial<ScheduleItem>) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...updated } : it));
  }

  async function handleChipPress(item: ScheduleItem) {
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

  const IB = "#E6FAF8";

  const icons: HubIcon[] = [
    { key: "my-schedule", label: "수업관리",  icon: "layers",         color: "#16A34A", bg: IB, onPress: () => router.push("/(teacher)/my-schedule" as any) },
    { key: "students",    label: "회원관리",  icon: "users",          color: "#1D4ED8", bg: IB, onPress: () => router.push("/(teacher)/students" as any) },
    { key: "makeups",     label: "보강관리",  icon: "refresh-cw",     color: "#EA580C", bg: IB,
      badge: (overview?.makeup_count ?? 0) > 0 ? overview!.makeup_count : null,
      onPress: () => router.push("/(teacher)/makeups" as any) },
    { key: "note",        label: "쪽지",     icon: "mail",           color: "#0369A1", bg: IB,
      badge: (overview?.unread_messages ?? 0) > 0 ? overview!.unread_messages : null,
      onPress: () => setNotePopupVisible(true) },
    { key: "messenger",   label: "메신저",   icon: "message-circle", color: "#7C3AED", bg: IB, onPress: () => router.push("/(teacher)/messenger" as any) },
    { key: "revenue",     label: "정산",     icon: "dollar-sign",    color: "#CA8A04", bg: IB, onPress: () => router.push("/(teacher)/revenue" as any) },
    { key: "my-info",     label: "내정보",   icon: "user",           color: "#DB2777", bg: IB, onPress: () => router.push("/(teacher)/my-info" as any) },
    { key: "settings",    label: "설정",     icon: "settings",       color: "#0F172A", bg: IB, onPress: () => router.push("/(teacher)/settings" as any) },
  ];

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 8);

  return (
    <SafeAreaView style={h.safe} edges={[]}>
      <View style={[h.header, { paddingTop: topPad }]}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={[h.poolName, { color: C.text }]} numberOfLines={1}>
              {pool?.name ?? "수영장"}
            </Text>
            {canSwitchToAdmin && (
              <Pressable style={({ pressed }) => [h.switchChip, { borderColor: C.border, backgroundColor: C.backgroundSoft, opacity: pressed || switching ? 0.7 : 1 }]}
                onPress={handleSwitchToAdmin} disabled={switching}>
                {switching
                  ? <ActivityIndicator size="small" color={C.textSecondary} />
                  : <><Repeat size={10} color={C.textSecondary} /><Text style={[h.switchChipTxt, { color: C.textSecondary }]}>관리자로 전환</Text></>}
              </Pressable>
            )}
          </View>
          <Text style={h.greeting} numberOfLines={1}>{adminUser?.name ?? "선생님"}선생님</Text>
        </View>
        <Pressable onPress={logout} style={h.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <LogOut size={18} color={C.textMuted} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={[h.scroll, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={themeColor} />}>

        <View style={[h.todayBanner, { backgroundColor: C.card }]}>
          <Text style={h.todayDate}>{formatDate(today)}</Text>
          <View style={h.todayStatRow}>
            <Pressable style={h.todayStat} onPress={() => router.push({ pathname:"/(teacher)/my-schedule", params:{openDate:today} } as any)}>
              <Text style={h.todayStatNum}>{loading ? "-" : items.length}</Text>
              <Text style={h.todayStatLabel}>오늘 수업</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/attendance" as any)}>
              <Text style={[h.todayStatNum, pendingAtt > 0 && { color: C.error }]}>{loading ? "-" : pendingAtt}</Text>
              <Text style={h.todayStatLabel}>출석 미체크</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/diary" as any)}>
              <Text style={[h.todayStatNum, diaryPending > 0 && { color: C.error }]}>{loading ? "-" : diaryPending}</Text>
              <Text style={h.todayStatLabel}>미작성 일지</Text>
            </Pressable>
            <View style={h.todayDivider} />
            <Pressable style={h.todayStat} onPress={() => router.push("/(teacher)/makeups" as any)}>
              <Text style={[h.todayStatNum, (overview?.makeup_count ?? 0) > 0 && { color: C.error }]}>
                {loading ? "-" : (overview?.makeup_count ?? 0)}
              </Text>
              <Text style={h.todayStatLabel}>보강 대기</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={[h.schedHero, { backgroundColor: "#CCFBF1" }]} onPress={() => router.push("/(teacher)/my-schedule" as any)}>
          <View style={h.schedHeroTop}>
            <View>
              <Text style={h.schedHeroTitle}>스케줄러 바로 가기</Text>
              <Text style={h.schedHeroSub}>수업 · 출결 · 일지 · 날짜메모</Text>
            </View>
          </View>
          <View style={h.miniWeek}>
            {WEEK_DAYS.map((dn, i) => {
              const d = weekDates[i];
              const isToday = d.toDateString() === new Date().toDateString();
              const isSun = i === 0; const isSat = i === 6;
              return (
                <View key={i} style={h.miniCell}>
                  <Text style={[h.miniDayName, isSun && { color: "#D96C6C" }, isSat && { color: "#4EA7D8" }]}>{dn}</Text>
                  <View style={[h.miniCircle, isToday && h.miniCircleToday]}>
                    <Text style={[h.miniDate, isToday && h.miniDateToday, isSun && !isToday && { color: "#D96C6C" }, isSat && !isToday && { color: "#4EA7D8" }]}>
                      {d.getDate()}
                    </Text>
                  </View>
                  {isToday && items.length > 0 && <View style={h.miniDot} />}
                </View>
              );
            })}
          </View>
        </Pressable>

        <Pressable style={({ pressed }) => [h.addMemberBtn, { backgroundColor: C.card, opacity: pressed ? 0.82 : 1 }]}
          onPress={() => setShowTeacherRegister(true)}>
          <View style={[h.addMemberIconWrap, { backgroundColor: "#E6FAF8" }]}>
            <UserPlus size={20} color="#0F172A" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={h.addMemberLabel}>회원추가</Text>
            <Text style={h.addMemberSub}>등록 요청 → 관리자 승인 후 반영</Text>
          </View>
          <ChevronRight size={18} color={C.textMuted} />
        </Pressable>

        <View style={[h.sectionCard, { backgroundColor: C.card }]}>
          <View style={h.sectionHeaderRow}>
            <View style={[h.sectionIconBox, { backgroundColor: C.tintLight }]}>
              <Layers size={13} color={C.iconSchedule} />
            </View>
            <Text style={h.sectionTitle}>오늘 수업</Text>
            {!loading && sortedItems.length > 0 && (
              <Text style={[h.classCnt, { color: C.tint }]}>{sortedItems.length}개</Text>
            )}
          </View>
          <View style={h.badgeGrid}>
            {loading ? (
              <ActivityIndicator color={themeColor} style={{ flex: 1 }} />
            ) : sortedItems.length === 0 ? (
              <View style={h.badgeEmpty}>
                <Sun size={20} color={C.textMuted} />
                <Text style={h.emptyTxt}>오늘 수업 없음</Text>
              </View>
            ) : sortedItems.slice(0, 12).map(item => {
              const attDone    = item.att_present >= item.student_count && item.student_count > 0;
              const attPartial = item.att_present > 0 && !attDone;
              const dotColor   = item.att_total === 0 ? "transparent" : attDone ? "#2E9B6F" : attPartial ? "#E4A93A" : "#D96C6C";
              return (
                <Pressable key={item.id} style={[h.chip, { backgroundColor: C.tintLight }]}
                  onPress={() => handleChipPress(item)}>
                  <View style={h.chipTop}>
                    <Text style={[h.chipTime, { color: C.tint }]} numberOfLines={1}>{item.schedule_time}</Text>
                    {item.att_total > 0 && <View style={[h.chipDot, { backgroundColor: dotColor }]} />}
                  </View>
                  <Text style={h.chipName} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[h.gridCard, { backgroundColor: C.card }]}>
          <View style={h.grid}>
            {icons.map(ic => (
              <Pressable key={ic.key} style={h.gridItem} onPress={ic.onPress}>
                <View style={[h.gridIconWrap, { backgroundColor: ic.bg }]}>
                  <LucideIcon name={ic.icon as any} size={24} color={ic.color} />
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
        onClose={() => setNotePopupVisible(false)} onOpenDiary={handleOpenDiaryFromMsg} />
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
  badgeGrid:      { flexDirection: "row", flexWrap: "wrap", gap: 6, minHeight: 164, alignContent: "flex-start" },
  badgeEmpty:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  chip:           { width: "23.5%", borderRadius: 10, padding: 8, gap: 4 },
  chipTop:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chipTime:       { fontSize: 11, fontFamily: "Pretendard-Regular" },
  chipDot:        { width: 6, height: 6, borderRadius: 3 },
  chipName:       { fontSize: 10, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  emptyTxt:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textMuted },
  schedHero:        { borderRadius: 18, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4 },
  schedHeroTop:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 },
  schedHeroTitle:   { fontSize: 18, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  schedHeroSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: "#64748B", marginTop: 3 },
  schedHeroBtn:     { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  schedHeroBtnTxt:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  miniWeek:         { flexDirection: "row", backgroundColor: "#fff", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 6 },
  miniCell:         { flex: 1, alignItems: "center", gap: 5 },
  miniDayName:      { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#64748B", letterSpacing: 0.3 },
  miniCircle:       { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  miniCircleToday:  { backgroundColor: "#0F172A" },
  miniDate:         { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#0F172A" },
  miniDateToday:    { fontSize: 14, fontFamily: "Pretendard-Regular", color: "#fff" },
  miniDot:          { width: 4, height: 4, borderRadius: 2, backgroundColor: "#2DD4BF", marginTop: -2 },
  addMemberBtn:     { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  addMemberIconWrap:{ width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  addMemberLabel:   { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.text },
  addMemberSub:     { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textMuted, marginTop: 2 },
  gridCard:       { borderRadius: 18, padding: 10, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  grid:           { flexDirection: "row", flexWrap: "wrap" },
  gridItem:       { width: "25%", alignItems: "center", gap: 5, paddingVertical: 8 },
  gridIconWrap:   { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", position: "relative" },
  gridBadge:      { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#D96C6C", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  gridBadgeTxt:   { color: "#fff", fontSize: 10, fontFamily: "Pretendard-Regular" },
  gridLabel:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.text, textAlign: "center" },
});
