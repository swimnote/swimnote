import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View,
} from "react-native";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface AttRecord {
  id: string;
  member_id: string;
  member_name: string;
  date: string;
  status: "present" | "absent" | "late" | "makeup";
}

const C = Colors.light;

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  present: { label: "출석",  color: "#2EC4B6", bg: "#E6FFFA", icon: "check-circle" },
  absent:  { label: "결석",  color: "#D96C6C", bg: "#F9DEDA", icon: "x-circle" },
  late:    { label: "지각",  color: "#D97706", bg: "#FFF1BF", icon: "clock" },
  makeup:  { label: "보강",  color: "#7C3AED", bg: "#EEDDF5", icon: "refresh-cw" },
};

type ListItem =
  | { type: "divider"; month: string }
  | { type: "record"; data: AttRecord };

function groupByMonth(records: AttRecord[]): ListItem[] {
  const items: ListItem[] = [];
  let lastMonth = "";
  for (const r of records) {
    const d = new Date(r.date);
    const monthKey = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (monthKey !== lastMonth) {
      items.push({ type: "divider", month: monthKey });
      lastMonth = monthKey;
    }
    items.push({ type: "record", data: r });
  }
  return items;
}

export default function ParentAttendanceScreen() {
  const { token, parentAccount } = useAuth();
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await apiRequest(token, "/parent/attendance");
      const data = await res.json();
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => b.date.localeCompare(a.date))
        : [];
      setRecords(sorted);
    } catch { setRecords([]); }
    finally { setLoading(false); setRefreshing(false); }
  }

  const listData = groupByMonth(records);

  const presentCount = records.filter(r => r.status === "present").length;
  const absentCount  = records.filter(r => r.status === "absent").length;
  const lateCount    = records.filter(r => r.status === "late").length;
  const makeupCount  = records.filter(r => r.status === "makeup").length;
  const total = records.length;
  const rate  = total > 0 ? Math.round((presentCount / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ParentScreenHeader title="출결 기록" />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => item.type === "divider" ? `div_${item.month}` : `rec_${item.data.id}`}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListHeaderComponent={
            total > 0 ? (
              <View style={[styles.statsCard, { backgroundColor: C.card }]}>
                <View style={styles.rateCol}>
                  <Text style={[styles.rateNum, { color: C.tint }]}>{rate}%</Text>
                  <Text style={[styles.rateLabel, { color: C.textSecondary }]}>출석률</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: C.border }]} />
                {[
                  { label: "출석", value: presentCount, color: "#2EC4B6" },
                  { label: "결석", value: absentCount,  color: "#D96C6C" },
                  { label: "지각", value: lateCount,    color: "#D97706" },
                  { label: "보강", value: makeupCount,  color: "#7C3AED" },
                ].map(s => (
                  <View key={s.label} style={styles.statItem}>
                    <Text style={[styles.statNum, { color: s.color }]}>{s.value}</Text>
                    <Text style={[styles.statLabel, { color: C.textMuted }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="calendar" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>출결 기록이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === "divider") {
              return (
                <View style={styles.monthDivider}>
                  <Text style={[styles.monthText, { color: C.textMuted }]}>{item.month}</Text>
                  <View style={[styles.monthLine, { backgroundColor: C.border }]} />
                </View>
              );
            }
            const sc = STATUS_CONFIG[item.data.status] || STATUS_CONFIG.present;
            const d  = new Date(item.data.date);
            const dateStr = d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
            return (
              <View style={[styles.recordRow, { backgroundColor: C.card }]}>
                <View style={[styles.recordIcon, { backgroundColor: sc.bg }]}>
                  <Feather name={sc.icon as any} size={18} color={sc.color} />
                </View>
                <View style={styles.recordInfo}>
                  <Text style={[styles.recordDate, { color: C.text }]}>{dateStr}</Text>
                  {!!item.data.member_name && (
                    <Text style={[styles.recordMember, { color: C.textMuted }]}>{item.data.member_name}</Text>
                  )}
                </View>
                <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                  <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingHorizontal: 20, paddingBottom: 120, gap: 6, paddingTop: 16 },
  statsCard: { flexDirection: "row", alignItems: "center", borderRadius: 18, padding: 18, gap: 16, marginBottom: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  rateCol: { alignItems: "center", minWidth: 58 },
  rateNum: { fontSize: 32, fontFamily: "Inter_700Bold" },
  rateLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  divider: { width: 1, height: 40 },
  statItem: { alignItems: "center", flex: 1 },
  statNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  monthDivider: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  monthText: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  monthLine: { flex: 1, height: 1 },
  recordRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  recordIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  recordInfo: { flex: 1 },
  recordDate: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recordMember: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
