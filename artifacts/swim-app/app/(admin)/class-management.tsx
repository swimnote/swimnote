import { Calendar, CircleAlert, Grid2x2, Inbox, List, RefreshCw, RotateCcw } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";

const C = Colors.light;

interface ClassStats {
  totals: {
    total_classes: number;
    one_time_classes: number;
    total_students: number;
    avg_capacity: number;
  };
  attendance: {
    month_present: number;
    month_absent: number;
    today_total: number;
    today_present: number;
  };
  makeups: {
    pending: number;
    assigned: number;
    completed: number;
    extinguished: number;
  };
  classes: Array<{
    id: string;
    name: string;
    schedule_days: string;
    schedule_time: string;
    capacity: number | null;
    is_one_time: boolean;
    instructor: string | null;
    teacher_name: string | null;
    student_count: number;
    month_att_count: number;
  }>;
}

function StatBox({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <View style={[s.statBox, { backgroundColor: C.card }]}>
      <Text style={[s.statNum, { color: color ?? C.text }]}>{value}</Text>
      <Text style={[s.statLabel, { color: C.textSecondary }]}>{label}</Text>
      {sub ? <Text style={[s.statSub, { color: C.textMuted }]}>{sub}</Text> : null}
    </View>
  );
}

export default function ClassManagementScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ClassStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<"name" | "students" | "att">("students");
  const [sortAsc,  setSortAsc]  = useState(false);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthLabel = (() => {
    const d = new Date();
    return `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  })();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await apiRequest(token, "/admin/class-stats");
      if (!res.ok) throw new Error("조회 실패");
      setData(await res.json());
    } catch (e: any) { setError(e.message || "오류"); }
    finally { setLoading(false); }
  }

  const sortedClasses = data ? [...data.classes].sort((a, b) => {
    let cmp = 0;
    if (sortMode === "name")     cmp = a.name.localeCompare(b.name);
    else if (sortMode === "students") cmp = b.student_count - a.student_count;
    else                         cmp = b.month_att_count - a.month_att_count;
    return sortAsc ? -cmp : cmp;
  }) : [];

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: C.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.tint} size="large" />
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="수업 관리"
        rightSlot={
          <Pressable onPress={load} style={s.refreshBtn} hitSlop={8}>
            <RefreshCw size={18} color={C.textSecondary} />
          </Pressable>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >

      {error ? (
        <View style={[s.errBox, { backgroundColor: "#F9DEDA", marginHorizontal: 16 }]}>
          <CircleAlert size={14} color={C.error} />
          <Text style={[s.errText, { color: C.error }]}>{error}</Text>
        </View>
      ) : null}

      {data && (
        <>
          {/* 반 현황 */}
          <View style={s.sectionHeader}>
            <Grid2x2 size={15} color={C.tint} />
            <Text style={[s.sectionTitle, { color: C.text }]}>반 현황</Text>
          </View>
          <View style={s.statsRow}>
            <StatBox label="전체 반" value={data.totals.total_classes} />
            <StatBox label="1회성 반" value={data.totals.one_time_classes} color="#7C3AED" />
            <StatBox label="전체 회원" value={data.totals.total_students} color={C.tint} />
            <StatBox label="평균 정원" value={`${Math.round(Number(data.totals.avg_capacity))}명`} />
          </View>

          {/* 이달 출결 */}
          <View style={s.sectionHeader}>
            <Calendar size={15} color="#2EC4B6" />
            <Text style={[s.sectionTitle, { color: C.text }]}>{monthLabel} 출결</Text>
          </View>
          <View style={s.statsRow}>
            <StatBox label="출석" value={data.attendance.month_present} color="#2EC4B6" />
            <StatBox label="결석" value={data.attendance.month_absent} color="#D96C6C" />
            <StatBox label="오늘 총" value={data.attendance.today_total} />
            <StatBox label="오늘 출석" value={data.attendance.today_present} color={C.tint} />
          </View>

          {/* 보강 현황 */}
          <View style={s.sectionHeader}>
            <RotateCcw size={15} color="#D97706" />
            <Text style={[s.sectionTitle, { color: C.text }]}>{monthLabel} 보강</Text>
          </View>
          <View style={s.statsRow}>
            <StatBox label="대기" value={data.makeups.pending} color={data.makeups.pending > 0 ? "#D96C6C" : C.textSecondary} />
            <StatBox label="배정됨" value={data.makeups.assigned} color="#D97706" />
            <StatBox label="완료" value={data.makeups.completed} color="#2EC4B6" />
            <StatBox label="소멸" value={data.makeups.extinguished} color="#64748B" />
          </View>

          {/* 반 목록 */}
          <View style={[s.sectionHeader, { marginTop: 4 }]}>
            <List size={15} color={C.tint} />
            <Text style={[s.sectionTitle, { color: C.text }]}>반별 현황</Text>
          </View>

          {/* 정렬 칩 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
            {[
              { key: "students" as const, label: "회원 수순" },
              { key: "att"      as const, label: "출석 수순" },
              { key: "name"     as const, label: "이름순" },
            ].map(opt => {
              const active = sortMode === opt.key;
              return (
              <Pressable
                key={opt.key}
                style={[s.chip, {
                  backgroundColor: active ? C.tintLight : C.card,
                  borderColor: active ? C.tint : C.border,
                }]}
                onPress={() => {
                  if (active) {
                    setSortAsc(v => !v);
                  } else {
                    setSortMode(opt.key);
                    setSortAsc(false);
                  }
                }}
              >
                <Text style={[s.chipText, { color: active ? C.tint : C.textSecondary }]}>{opt.label}</Text>
                {active && (
                  <LucideIcon
                    name={sortAsc ? "chevron-up" : "chevron-down"}
                    size={13}
                    color={C.tint}
                  />
                )}
              </Pressable>
              );
            })}
          </ScrollView>

          {sortedClasses.length === 0 ? (
            <View style={s.empty}>
              <Inbox size={36} color={C.textMuted} />
              <Text style={[s.emptyText, { color: C.textMuted }]}>등록된 반이 없습니다</Text>
            </View>
          ) : sortedClasses.map(cls => {
            const fill = cls.capacity ? Math.min(1, cls.student_count / cls.capacity) : 0;
            const fillColor = fill >= 1 ? "#D96C6C" : fill >= 0.8 ? "#D97706" : "#2EC4B6";
            return (
              <View key={cls.id} style={[s.classCard, { backgroundColor: C.card }]}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[s.className, { color: C.text }]}>{cls.name}</Text>
                      {cls.is_one_time && (
                        <View style={[s.oneTimeTag, { backgroundColor: "#E6FAF8" }]}>
                          <Text style={[s.oneTimeTagText, { color: "#7C3AED" }]}>1회성</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[s.classSub, { color: C.textSecondary }]}>
                      {cls.schedule_days} {cls.schedule_time} · {cls.teacher_name || cls.instructor || "선생님 미지정"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.studentCount, { color: C.tint }]}>
                      {cls.student_count}{cls.capacity ? `/${cls.capacity}` : ""}명
                    </Text>
                    <Text style={[s.attCount, { color: C.textMuted }]}>이달 {cls.month_att_count}회 출석</Text>
                  </View>
                </View>
                {cls.capacity ? (
                  <View style={[s.fillBar, { backgroundColor: C.border }]}>
                    <View style={[s.fillBarInner, { width: `${Math.round(fill * 100)}%` as any, backgroundColor: fillColor }]} />
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  refreshBtn: { padding: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8, marginTop: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 4 },
  statBox: { flex: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 2 },
  statNum: { fontSize: 22, fontFamily: "Pretendard-Bold" },
  statLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center" },
  statSub: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, flexDirection: "row", alignItems: "center", gap: 4 },
  chipText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  classCard: { marginHorizontal: 16, marginBottom: 10, borderRadius: 14, padding: 14, gap: 10 },
  className: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  classSub: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  studentCount: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  attCount: { fontSize: 11, fontFamily: "Pretendard-Regular", marginTop: 2 },
  fillBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  fillBarInner: { height: 4, borderRadius: 2 },
  oneTimeTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  oneTimeTagText: { fontSize: 10, fontFamily: "Pretendard-SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  errBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, marginBottom: 10 },
  errText: { fontSize: 13, fontFamily: "Pretendard-Regular", flex: 1 },
});
