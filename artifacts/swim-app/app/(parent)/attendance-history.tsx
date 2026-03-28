import { Calendar } from "lucide-react-native";
import { LucideIcon } from "@/components/common/LucideIcon";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

interface Attendance {
  id: string; date: string;
  status: "present" | "absent" | "makeup";
  note?: string | null;
  created_by_name?: string | null;
  modified_by_name?: string | null;
  modification_reason?: string | null;
}

const C = Colors.light;

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  makeup: "보강",
  late: "출석",
  excused: "출석",
};
const STATUS_COLOR: Record<string, string> = {
  present: C.success,
  absent: C.error,
  makeup: "#7C3AED",
  late: C.success,
  excused: C.success,
};
const WEEKDAY: Record<string, string> = { "0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토" };

export default function AttendanceHistoryScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id: paramId, name: paramName } = useLocalSearchParams<{ id: string; name: string }>();
  const { selectedStudent } = useParent();
  const id = paramId || selectedStudent?.id || "";
  const name = paramName || selectedStudent?.name || "";

  const [records, setRecords] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  async function fetchRecords(m = month) {
    try {
      const res = await apiRequest(token, `/parent/students/${id}/attendance?month=${m}`);
      if (res.ok) setRecords(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchRecords(month); }, [id, month]);

  const present = records.filter(r => ["present", "late", "excused"].includes(r.status)).length;
  const absent = records.filter(r => r.status === "absent").length;
  const makeup = records.filter(r => r.status === "makeup").length;

  function getWeekday(dateStr: string) {
    const d = new Date(dateStr);
    return WEEKDAY[String(d.getDay())] || "";
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader
        title="출결 기록"
        subtitle={name || undefined}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRecords(month); }} />}
      >
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.monthScroll}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingRight: 20 }}
        >
          {months.map(m => {
            const [y, mo] = m.split("-");
            const isSelected = m === month;
            return (
              <View
                key={m}
                style={[styles.monthBtn, { backgroundColor: isSelected ? C.tint : C.card, borderColor: isSelected ? C.tint : C.border }]}
                onStartShouldSetResponder={() => true}
                onResponderRelease={() => { setMonth(m); setLoading(true); }}
              >
                <Text style={[styles.monthText, { color: isSelected ? "#fff" : C.textSecondary }]}>{y}.{mo}</Text>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.statsRow}>
          {[
            { label: "출석", count: present, color: C.success, icon: "check-circle" as const },
            { label: "결석", count: absent, color: C.error, icon: "x-circle" as const },
            { label: "보강", count: makeup, color: "#7C3AED", icon: "refresh-cw" as const },
          ].map(s => (
            <View key={s.label} style={[styles.statBox, { backgroundColor: s.color + "18" }]}>
              <LucideIcon name={s.icon} size={18} color={s.color} />
              <Text style={[styles.statNum, { color: s.color }]}>{s.count}</Text>
              <Text style={[styles.statLabel, { color: s.color }]}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.list}>
          {loading ? (
            <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
          ) : records.length === 0 ? (
            <View style={styles.empty}>
              <Calendar size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>이달 출결 기록이 없습니다</Text>
            </View>
          ) : (
            records.map(r => {
              const color = STATUS_COLOR[r.status] || C.textMuted;
              const label = STATUS_LABEL[r.status] || r.status;
              const wd = getWeekday(r.date);
              return (
                <View key={r.id} style={[styles.recordBox, { backgroundColor: C.card, borderLeftColor: color, borderLeftWidth: 4 }]}>
                  <View style={styles.recordTop}>
                    <View style={styles.recordDateBlock}>
                      <Text style={[styles.recordDate, { color: C.text }]}>{r.date}</Text>
                      {wd ? <Text style={[styles.recordWeekday, { color: C.textMuted }]}>({wd})</Text> : null}
                    </View>
                    <View style={[styles.badge, { backgroundColor: color + "20" }]}>
                      <Text style={[styles.badgeText, { color }]}>{label}</Text>
                    </View>
                  </View>
                  {r.note ? <Text style={[styles.noteText, { color: C.textSecondary }]}>{r.note}</Text> : null}
                  {r.created_by_name ? (
                    <Text style={[styles.metaText, { color: C.textMuted }]}>입력: {r.created_by_name}</Text>
                  ) : null}
                  {r.modified_by_name && r.modification_reason ? (
                    <Text style={[styles.metaText, { color: C.textMuted }]}>수정: {r.modified_by_name} · {r.modification_reason}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerTitle: { fontSize: 20, fontFamily: "Pretendard-SemiBold" },
  monthScroll: { paddingVertical: 12 },
  monthBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  monthText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statBox: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: "center", gap: 4 },
  statNum: { fontSize: 24, fontFamily: "Pretendard-SemiBold" },
  statLabel: { fontSize: 12, fontFamily: "Pretendard-Medium" },
  list: { paddingHorizontal: 20, gap: 10 },
  recordBox: { borderRadius: 14, padding: 14, gap: 6, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 2, shadowColor: "#00000010" },
  recordTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recordDateBlock: { flexDirection: "row", alignItems: "center", gap: 6 },
  recordDate: { fontSize: 15, fontFamily: "Pretendard-Medium" },
  recordWeekday: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 13, fontFamily: "Pretendard-Medium" },
  noteText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  metaText: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 60 },
  emptyText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
});
