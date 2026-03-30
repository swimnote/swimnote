import { Calendar } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, RefreshControl,
  StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

interface Attendance {
  id: string; date: string;
  status: "present" | "absent" | "makeup" | "late" | "excused";
  note?: string | null;
  created_by_name?: string | null;
  modified_by_name?: string | null;
  modification_reason?: string | null;
}

type FeedItem =
  | { type: "record"; record: Attendance; key: string }
  | { type: "divider"; upperMonth: string; lowerMonth: string; lowerStats: { present: number; absent: number; makeup: number }; key: string };

const C = Colors.light;

const STATUS_LABEL: Record<string, string> = {
  present: "출석", absent: "결석", makeup: "보강", late: "출석", excused: "출석",
};
const STATUS_COLOR: Record<string, string> = {
  present: C.success, absent: C.error, makeup: "#7C3AED", late: C.success, excused: C.success,
};
const WEEKDAY: Record<string, string> = {
  "0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토",
};

function formatMonthLabel(ym: string): string {
  const [, m] = ym.split("-");
  return `${parseInt(m, 10)}월`;
}

function getWeekday(dateStr: string) {
  const d = new Date(dateStr);
  return WEEKDAY[String(d.getDay())] || "";
}

export default function AttendanceHistoryScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id: paramId, name: paramName } = useLocalSearchParams<{ id: string; name: string }>();
  const { selectedStudent } = useParent();
  const id   = paramId  || selectedStudent?.id   || "";
  const name = paramName || selectedStudent?.name || "";

  const [allRecords, setAllRecords] = useState<Attendance[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchAll() {
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    try {
      const results = await Promise.allSettled(
        months.map(m =>
          apiRequest(token, `/parent/students/${id}/attendance?month=${m}`)
            .then(r => (r.ok ? r.json() : []))
            .catch(() => [])
        )
      );
      const combined: Attendance[] = [];
      results.forEach(r => {
        if (r.status === "fulfilled" && Array.isArray(r.value)) combined.push(...r.value);
      });
      const seen = new Set<string>();
      const unique = combined.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
      unique.sort((a, b) => b.date.localeCompare(a.date));
      setAllRecords(unique);
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { if (id) fetchAll(); }, [id]);

  const feedItems = useMemo((): FeedItem[] => {
    if (allRecords.length === 0) return [];

    const monthMap = new Map<string, Attendance[]>();
    allRecords.forEach(r => {
      const m = r.date.slice(0, 7);
      if (!monthMap.has(m)) monthMap.set(m, []);
      monthMap.get(m)!.push(r);
    });
    const sortedMonths = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a));

    const items: FeedItem[] = [];
    sortedMonths.forEach((month, i) => {
      const records = monthMap.get(month)!;
      records.forEach(r => items.push({ type: "record", record: r, key: r.id }));

      if (i < sortedMonths.length - 1) {
        const nextMonth   = sortedMonths[i + 1];
        const nextRecords = monthMap.get(nextMonth)!;
        const present = nextRecords.filter(r => ["present", "late", "excused"].includes(r.status)).length;
        const absent  = nextRecords.filter(r => r.status === "absent").length;
        const makeup  = nextRecords.filter(r => r.status === "makeup").length;
        items.push({
          type: "divider",
          upperMonth: month,
          lowerMonth: nextMonth,
          lowerStats: { present, absent, makeup },
          key: `divider-${month}`,
        });
      }
    });
    return items;
  }, [allRecords]);

  function renderItem({ item }: { item: FeedItem }) {
    if (item.type === "divider") {
      const upperLabel = formatMonthLabel(item.upperMonth);
      const lowerLabel = formatMonthLabel(item.lowerMonth);
      return (
        <View style={s.dividerRow}>
          <View style={[s.dividerLine, { flex: 1 }]} />
          <View style={s.dividerContent}>
            <Text style={s.dividerUpper}>{upperLabel}</Text>
            <Text style={s.dividerSep}>│</Text>
            <Text style={s.dividerStats}>
              {lowerLabel}&nbsp;
              <Text style={{ color: C.success }}>출석 {item.lowerStats.present}</Text>
              {"  "}
              <Text style={{ color: C.error }}>결석 {item.lowerStats.absent}</Text>
              {"  "}
              <Text style={{ color: "#7C3AED" }}>보강 {item.lowerStats.makeup}</Text>
            </Text>
          </View>
          <View style={[s.dividerLine, { flex: 1 }]} />
        </View>
      );
    }

    const r     = item.record;
    const color = STATUS_COLOR[r.status] || C.textMuted;
    const label = STATUS_LABEL[r.status] || r.status;
    const wd    = getWeekday(r.date);
    const [, mm, dd] = r.date.split("-");
    const dateDisplay = `${parseInt(mm, 10)}월 ${parseInt(dd, 10)}일`;

    return (
      <View style={[s.recordRow, { borderLeftColor: color }]}>
        <View style={s.recordLeft}>
          <Text style={[s.recordDate, { color: C.text }]}>{dateDisplay}</Text>
          {wd ? <Text style={[s.recordWd, { color: C.textMuted }]}>{wd}</Text> : null}
        </View>
        <View style={s.recordRight}>
          <View style={[s.badge, { backgroundColor: color + "18" }]}>
            <Text style={[s.badgeText, { color }]}>{label}</Text>
          </View>
          {r.note ? <Text style={[s.noteText, { color: C.textSecondary }]} numberOfLines={1}>{r.note}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader title="출결 기록" subtitle={name || undefined} />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : allRecords.length === 0 ? (
        <View style={s.empty}>
          <Calendar size={40} color={C.textMuted} />
          <Text style={[s.emptyText, { color: C.textMuted }]}>출결 기록이 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={feedItems}
          keyExtractor={item => item.key}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 80 }}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchAll(); }}
              tintColor={C.tint}
            />
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:           { flex: 1 },
  empty:          { alignItems: "center", gap: 10, paddingVertical: 80 },
  emptyText:      { fontSize: 14, fontFamily: "Pretendard-Regular" },
  recordRow:      { flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 12, borderLeftWidth: 4, paddingVertical: 11, paddingHorizontal: 14, gap: 12 },
  recordLeft:     { flexDirection: "row", alignItems: "baseline", gap: 5, minWidth: 80 },
  recordDate:     { fontSize: 14, fontFamily: "Pretendard-Regular" },
  recordWd:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  recordRight:    { flex: 1, gap: 2 },
  badge:          { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  badgeText:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  noteText:       { fontSize: 12, fontFamily: "Pretendard-Regular" },
  dividerRow:     { flexDirection: "row", alignItems: "center", marginVertical: 10, gap: 8 },
  dividerLine:    { height: 1, backgroundColor: C.border },
  dividerContent: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  dividerUpper:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.tint },
  dividerSep:     { fontSize: 11, color: C.border },
  dividerStats:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
});
