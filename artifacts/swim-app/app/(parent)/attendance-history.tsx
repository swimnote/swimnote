import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Attendance {
  id: string; date: string;
  status: "present" | "absent" | "late" | "excused";
  note?: string | null;
  created_by_name?: string | null;
  modified_by_name?: string | null;
  modification_reason?: string | null;
}

const C = Colors.light;

const STATUS_LABEL: Record<string, string> = { present: "출석", absent: "결석", late: "지각", excused: "공결" };
const STATUS_COLOR: Record<string, string> = {
  present: C.success, absent: C.error, late: C.warning, excused: "#7C3AED",
};
const WEEKDAY: Record<string, string> = { "0": "일", "1": "월", "2": "화", "3": "수", "4": "목", "5": "금", "6": "토" };

export default function AttendanceHistoryScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

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

  const present = records.filter(r => r.status === "present").length;
  const absent = records.filter(r => r.status === "absent").length;
  const late = records.filter(r => r.status === "late").length;
  const excused = records.filter(r => r.status === "excused").length;

  function getWeekday(dateStr: string) {
    const d = new Date(dateStr);
    return WEEKDAY[String(d.getDay())] || "";
  }

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>{name} 출결 기록</Text>
        <View style={{ width: 40 }} />
      </View>

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
              <Pressable
                key={m}
                style={[styles.monthBtn, { backgroundColor: isSelected ? C.tint : C.card, borderColor: isSelected ? C.tint : C.border }]}
                onPress={() => { setMonth(m); setLoading(true); }}
              >
                <Text style={[styles.monthText, { color: isSelected ? "#fff" : C.textSecondary }]}>{y}.{mo}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.statsRow}>
          {[
            { label: "출석", count: present, color: C.success },
            { label: "결석", count: absent, color: C.error },
            { label: "지각", count: late, color: C.warning },
            { label: "공결", count: excused, color: "#7C3AED" },
          ].map(s => (
            <View key={s.label} style={[styles.statBox, { backgroundColor: s.color + "18" }]}>
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
              <Feather name="calendar" size={40} color={C.textMuted} />
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  monthScroll: { paddingVertical: 12 },
  monthBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  monthText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  statBox: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", gap: 3 },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  list: { paddingHorizontal: 20, gap: 10 },
  recordBox: { borderRadius: 14, padding: 14, gap: 6, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 2, shadowColor: "#00000010" },
  recordTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recordDateBlock: { flexDirection: "row", alignItems: "center", gap: 6 },
  recordDate: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recordWeekday: { fontSize: 13, fontFamily: "Inter_400Regular" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  badgeText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noteText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 60 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
