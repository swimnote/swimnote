import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

const C = Colors.light;

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  student_count: number; level?: string | null;
}
interface AttendanceRecord { student_id: string; status: string; class_group_id: string; }
interface DiaryRecord { id: string; class_group_id: string; }

type ScheduleView = "today" | "weekly";
const DAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WEEK_DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function todayKo() { return DAY_KO[new Date().getDay()]; }
function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseStartTime(t: string) { return t.split(/[-~]/)[0].trim(); }
function isTodayClass(g: ClassGroup) {
  return g.schedule_days.split(",").map(d => d.trim()).includes(todayKo());
}
function sortByTime(a: ClassGroup, b: ClassGroup) {
  return parseStartTime(a.schedule_time).localeCompare(parseStartTime(b.schedule_time));
}

// ── 수업 카드 ──────────────────────────────────────────────────
function ClassCard({ group, attendance, hasDiary, onPressAttendance, onPressDiary, themeColor }: {
  group: ClassGroup;
  attendance: AttendanceRecord[];
  hasDiary: boolean;
  onPressAttendance: () => void;
  onPressDiary: () => void;
  themeColor: string;
}) {
  const present = attendance.filter(a => a.status === "present").length;
  const absent  = attendance.filter(a => a.status === "absent").length;
  const checked = attendance.length;
  const total   = group.student_count;
  const allDone = checked === total && total > 0;
  const days    = group.schedule_days.split(",").map(d => d.trim()).join("·");

  return (
    <View style={[crd.root, { backgroundColor: "#fff" }]}>
      {/* 헤더: 시간 + 반이름 + 레벨 */}
      <View style={crd.head}>
        <View style={[crd.timePill, { backgroundColor: themeColor + "18" }]}>
          <Feather name="clock" size={11} color={themeColor} />
          <Text style={[crd.timeText, { color: themeColor }]}>{group.schedule_time}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={crd.name} numberOfLines={1}>{group.name}</Text>
          <Text style={crd.days}>{days}</Text>
        </View>
        {group.level && (
          <View style={[crd.levelBadge, { backgroundColor: "#EDE9FE" }]}>
            <Text style={[crd.levelText, { color: "#7C3AED" }]}>{group.level}</Text>
          </View>
        )}
      </View>

      {/* 지표 4개 */}
      <View style={[crd.stats, { borderTopColor: C.border, borderBottomColor: C.border }]}>
        {[
          { icon: "users" as const,        label: "학생",  val: `${total}명`,                      color: C.text },
          { icon: "check-circle" as const, label: "출결",  val: `${checked}/${total}`,              color: allDone ? C.success : C.warning },
          { icon: "user-x" as const,       label: "결석",  val: `${absent}명`,                      color: absent > 0 ? C.error : C.textMuted },
          { icon: "book" as const,         label: "일지",  val: hasDiary ? "작성됨" : "미작성",       color: hasDiary ? C.success : C.textMuted },
        ].map((item, i, arr) => (
          <React.Fragment key={item.label}>
            <View style={crd.statCol}>
              <Feather name={item.icon} size={14} color={item.color} />
              <Text style={[crd.statVal, { color: item.color }]}>{item.val}</Text>
              <Text style={crd.statLabel}>{item.label}</Text>
            </View>
            {i < arr.length - 1 && <View style={[crd.divider, { backgroundColor: C.border }]} />}
          </React.Fragment>
        ))}
      </View>

      {/* 버튼 */}
      <View style={crd.btns}>
        <Pressable
          style={({ pressed }) => [crd.btn, { backgroundColor: themeColor + "15", opacity: pressed ? 0.75 : 1 }]}
          onPress={onPressAttendance}
        >
          <Feather name="check-square" size={14} color={themeColor} />
          <Text style={[crd.btnText, { color: themeColor }]}>출결 관리</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [crd.btn, { backgroundColor: hasDiary ? "#D1FAE5" : "#FEF3C7", opacity: pressed ? 0.75 : 1 }]}
          onPress={onPressDiary}
        >
          <Feather name="edit-3" size={14} color={hasDiary ? C.success : C.warning} />
          <Text style={[crd.btnText, { color: hasDiary ? C.success : C.warning }]}>
            {hasDiary ? "일지 보기" : "일지 작성"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────
export default function MyScheduleScreen() {
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [view, setView]                   = useState<ScheduleView>("today");
  const [groups, setGroups]               = useState<ClassGroup[]>([]);
  const [attMap, setAttMap]               = useState<Record<string, AttendanceRecord[]>>({});
  const [diarySet, setDiarySet]           = useState<Set<string>>(new Set());
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);

  const load = useCallback(async () => {
    try {
      const [cgRes, attRes, diaryRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, `/attendance?date=${todayDateStr()}`),
        apiRequest(token, `/diary?date=${todayDateStr()}`),
      ]);
      if (cgRes.ok)    setGroups(await cgRes.json());
      if (attRes.ok) {
        const arr: AttendanceRecord[] = await attRes.json();
        const map: Record<string, AttendanceRecord[]> = {};
        arr.forEach(a => { if (!map[a.class_group_id]) map[a.class_group_id] = []; map[a.class_group_id].push(a); });
        setAttMap(map);
      }
      if (diaryRes.ok) {
        const arr: DiaryRecord[] = await diaryRes.json();
        setDiarySet(new Set(arr.map(d => d.class_group_id)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // 계산
  const todayGroups   = groups.filter(isTodayClass).sort(sortByTime);
  const weeklyGroups  = WEEK_DAYS
    .map(day => ({ day, items: groups.filter(g => g.schedule_days.split(",").map(d => d.trim()).includes(day)).sort(sortByTime) }))
    .filter(r => r.items.length > 0);
  const uncheckedCnt  = todayGroups.filter(g => (attMap[g.id] || []).length < g.student_count).length;
  const unwrittenCnt  = todayGroups.filter(g => !diarySet.has(g.id)).length;

  const today = new Date();

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />

      {/* 페이지 제목 */}
      <View style={s.titleRow}>
        <Text style={s.title}>내 스케줄</Text>
        <Text style={[s.titleSub, { color: C.textMuted }]}>
          {today.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
        </Text>
      </View>

      {/* 오늘 / 주간 토글 */}
      <View style={[s.toggle, { borderColor: C.border }]}>
        {(["today", "weekly"] as ScheduleView[]).map(v => (
          <Pressable
            key={v}
            style={[s.toggleItem, view === v && { backgroundColor: themeColor }]}
            onPress={() => setView(v)}
          >
            <Text style={[s.toggleText, { color: view === v ? "#fff" : C.textSecondary }]}>
              {v === "today" ? "오늘" : "주간"}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={themeColor} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        >
          {/* 오늘 요약 배너 */}
          {view === "today" && (
            <View style={[s.summary, { backgroundColor: themeColor + "10", borderColor: themeColor + "30" }]}>
              <View style={[s.summaryIcon, { backgroundColor: themeColor + "20" }]}>
                <Feather name="alert-circle" size={18} color={themeColor} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.summaryTitle, { color: themeColor }]}>오늘 확인할 것</Text>
                <Text style={[s.summarySub, { color: C.textSecondary }]}>
                  수업 {todayGroups.length}개{uncheckedCnt > 0 ? ` · 출결 미확인 ${uncheckedCnt}건` : ""}{unwrittenCnt > 0 ? ` · 일지 미작성 ${unwrittenCnt}건` : ""}
                  {todayGroups.length === 0 ? " · 오늘 수업이 없습니다" : ""}
                </Text>
              </View>
            </View>
          )}

          {/* 수업 카드 */}
          {view === "today" ? (
            todayGroups.length === 0 ? (
              <View style={s.empty}>
                <Feather name="calendar" size={48} color={C.textMuted} />
                <Text style={[s.emptyText, { color: C.textMuted }]}>오늘({todayKo()}) 수업이 없습니다</Text>
              </View>
            ) : (
              <View style={s.list}>
                {todayGroups.map(g => (
                  <ClassCard key={g.id} group={g}
                    attendance={attMap[g.id] || []}
                    hasDiary={diarySet.has(g.id)}
                    themeColor={themeColor}
                    onPressAttendance={() => router.push({ pathname: "/(teacher)/attendance", params: { classGroupId: g.id } } as any)}
                    onPressDiary={() => router.push({ pathname: "/(teacher)/diary", params: { classGroupId: g.id, className: g.name } } as any)}
                  />
                ))}
              </View>
            )
          ) : (
            weeklyGroups.length === 0 ? (
              <View style={s.empty}>
                <Feather name="calendar" size={48} color={C.textMuted} />
                <Text style={[s.emptyText, { color: C.textMuted }]}>배정된 수업이 없습니다</Text>
              </View>
            ) : (
              weeklyGroups.map(({ day, items }) => (
                <View key={day} style={s.weekSection}>
                  <View style={s.weekDayRow}>
                    <Text style={[s.weekDay, { color: day === todayKo() ? themeColor : C.text }]}>
                      {day}요일
                    </Text>
                    {day === todayKo() && (
                      <View style={[s.todayBadge, { backgroundColor: themeColor }]}>
                        <Text style={s.todayBadgeText}>오늘</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.list}>
                    {items.map(g => (
                      <ClassCard key={g.id} group={g}
                        attendance={attMap[g.id] || []}
                        hasDiary={diarySet.has(g.id)}
                        themeColor={themeColor}
                        onPressAttendance={() => router.push({ pathname: "/(teacher)/attendance", params: { classGroupId: g.id } } as any)}
                        onPressDiary={() => router.push({ pathname: "/(teacher)/diary", params: { classGroupId: g.id, className: g.name } } as any)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ── 수업 카드 스타일 ──────────────────────────────────────────
const crd = StyleSheet.create({
  root: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#E5E7EB" },
  head: { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 4 },
  timePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  timeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  name: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#111827" },
  days: { fontSize: 11, fontFamily: "Inter_400Regular", color: "#9CA3AF", marginTop: 2 },
  levelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  levelText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  stats: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 10 },
  statCol: { flex: 1, alignItems: "center", gap: 3 },
  statVal: { fontSize: 13, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  divider: { width: 1, marginVertical: 4 },
  btns: { flexDirection: "row", padding: 12, gap: 10 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: 10 },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ── 화면 스타일 ───────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F4F6" },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#111827" },
  titleSub: { fontSize: 13, fontFamily: "Inter_400Regular" },

  toggle: { flexDirection: "row", marginHorizontal: 20, marginVertical: 12, borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  toggleItem: { flex: 1, paddingVertical: 9, alignItems: "center" },
  toggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  scroll: { paddingHorizontal: 20, paddingBottom: 120, gap: 0 },

  summary: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  summaryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  summaryTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  summarySub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  list: { gap: 12 },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  weekSection: { marginBottom: 20 },
  weekDayRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  weekDay: { fontSize: 15, fontFamily: "Inter_700Bold" },
  todayBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  todayBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
