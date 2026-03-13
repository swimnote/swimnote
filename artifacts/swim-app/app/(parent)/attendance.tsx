import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface AttRecord { id: string; member_id: string; member_name: string; date: string; status: "present" | "absent" | "late"; class_id: string; }
interface Member { id: string; name: string; class_id?: string | null; class_name?: string | null; }

const STATUS_CONFIG = {
  present: { label: "출석", color: Colors.light.present, bg: "#D1FAE5", icon: "check-circle" as const },
  absent: { label: "결석", color: Colors.light.absent, bg: "#FEE2E2", icon: "x-circle" as const },
  late: { label: "지각", color: Colors.light.late, bg: "#FEF3C7", icon: "clock" as const },
};

export default function ParentAttendanceScreen() {
  const { token, user, pool, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { fetchMembers(); }, []);
  useEffect(() => { if (selectedMember) fetchAttendance(selectedMember); }, [selectedMember]);

  async function fetchMembers() {
    try {
      const res = await apiRequest(token, "/members");
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setMembers(list);
      if (list.length > 0) setSelectedMember(list[0].id);
    } finally { setLoading(false); setRefreshing(false); }
  }

  async function fetchAttendance(memberId: string) {
    try {
      const res = await apiRequest(token, `/attendance?member_id=${memberId}`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data.sort((a: AttRecord, b: AttRecord) => b.date.localeCompare(a.date)) : []);
    } catch (err) { console.error(err); }
  }

  const presentCount = records.filter(r => r.status === "present").length;
  const absentCount = records.filter(r => r.status === "absent").length;
  const lateCount = records.filter(r => r.status === "late").length;
  const total = records.length;
  const rate = total > 0 ? Math.round((presentCount / total) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <View>
          <Text style={[styles.poolName, { color: C.text }]}>{pool?.name || "수영장"}</Text>
          <Text style={[styles.subtitle, { color: C.textSecondary }]}>안녕하세요, {user?.name}님</Text>
        </View>
        <Pressable onPress={logout} style={[styles.logoutBtn, { backgroundColor: C.card }]}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      {members.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 8 }}>
          {members.map((m) => (
            <Pressable
              key={m.id}
              style={[styles.memberTab, { backgroundColor: selectedMember === m.id ? C.tint : C.card, borderColor: selectedMember === m.id ? C.tint : C.border }]}
              onPress={() => setSelectedMember(m.id)}
            >
              <Text style={[styles.memberTabText, { color: selectedMember === m.id ? "#fff" : C.textSecondary }]}>{m.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
      ) : members.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="user-x" size={48} color={C.textMuted} />
          <Text style={[styles.emptyTitle, { color: C.text }]}>자녀 정보 없음</Text>
          <Text style={[styles.emptyText, { color: C.textSecondary }]}>수영장 관리자에게 문의하세요</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); selectedMember && fetchAttendance(selectedMember); setRefreshing(false); }} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <View style={[styles.statsCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={styles.rateBox}>
                  <Text style={[styles.rateNum, { color: C.tint }]}>{rate}%</Text>
                  <Text style={[styles.rateLabel, { color: C.textSecondary }]}>출석률</Text>
                </View>
                <View style={styles.statsRight}>
                  {[
                    { label: "출석", value: presentCount, color: C.present },
                    { label: "결석", value: absentCount, color: C.absent },
                    { label: "지각", value: lateCount, color: C.late },
                  ].map(({ label, value, color }) => (
                    <View key={label} style={styles.statItem}>
                      <Text style={[styles.statNum, { color }]}>{value}</Text>
                      <Text style={[styles.statLabel, { color: C.textMuted }]}>{label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={[styles.sectionTitle, { color: C.text }]}>출결 기록</Text>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 8 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="calendar" size={40} color={C.textMuted} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>출결 기록이 없습니다</Text>
            </View>
          }
          renderItem={({ item }) => {
            const sc = STATUS_CONFIG[item.status];
            return (
              <View style={[styles.recordCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={[styles.recordIcon, { backgroundColor: sc.bg }]}>
                  <Feather name={sc.icon} size={18} color={sc.color} />
                </View>
                <View style={styles.recordInfo}>
                  <Text style={[styles.recordDate, { color: C.text }]}>
                    {new Date(item.date).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}
                  </Text>
                  <Text style={[styles.recordMember, { color: C.textSecondary }]}>{item.member_name}</Text>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 12 },
  poolName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  memberTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  memberTabText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  listHeader: { gap: 16, marginBottom: 8 },
  statsCard: { borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  rateBox: { alignItems: "center" },
  rateNum: { fontSize: 36, fontFamily: "Inter_700Bold" },
  rateLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statsRight: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  recordCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 12, gap: 12, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  recordIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  recordInfo: { flex: 1 },
  recordDate: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  recordMember: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
