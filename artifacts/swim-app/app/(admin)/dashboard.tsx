import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface Stats { members: number; classes: number; todayPresent: number; totalNotices: number; }

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  trial: { label: "체험 중", color: Colors.light.trial, bg: "#F3E8FF" },
  active: { label: "구독 중", color: Colors.light.active, bg: "#D1FAE5" },
  expired: { label: "만료됨", color: Colors.light.expired, bg: "#F3F4F6" },
  suspended: { label: "정지됨", color: Colors.light.suspended, bg: "#FEF3C7" },
  cancelled: { label: "해지됨", color: Colors.light.cancelled, bg: "#FEE2E2" },
};

export default function DashboardScreen() {
  const { user, pool, logout, token } = useAuth();
  const insets = useSafeAreaInsets();
  const C = Colors.light;
  const [stats, setStats] = useState<Stats>({ members: 0, classes: 0, todayPresent: 0, totalNotices: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStats() {
    try {
      const [membersRes, classesRes, noticesRes] = await Promise.all([
        apiRequest(token, "/members"),
        apiRequest(token, "/classes"),
        apiRequest(token, "/notices"),
      ]);
      const [members, classes, notices] = await Promise.all([
        membersRes.json(),
        classesRes.json(),
        noticesRes.json(),
      ]);
      const today = new Date().toISOString().split("T")[0];
      const attRes = await apiRequest(token, `/attendance?date=${today}`);
      const att = await attRes.json();
      setStats({
        members: Array.isArray(members) ? members.length : 0,
        classes: Array.isArray(classes) ? classes.length : 0,
        todayPresent: Array.isArray(att) ? att.filter((a: { status: string }) => a.status === "present").length : 0,
        totalNotices: Array.isArray(notices) ? notices.length : 0,
      });
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchStats(); }, []);

  const subStatus = STATUS_MAP[pool?.subscription_status || "trial"];

  const statCards = [
    { label: "전체 회원", value: stats.members, icon: "users" as const, color: C.tint, bg: C.tintLight },
    { label: "개설 반", value: stats.classes, icon: "layers" as const, color: "#7C3AED", bg: "#F3E8FF" },
    { label: "오늘 출석", value: stats.todayPresent, icon: "check-circle" as const, color: C.success, bg: "#D1FAE5" },
    { label: "공지사항", value: stats.totalNotices, icon: "bell" as const, color: C.warning, bg: "#FEF3C7" },
  ];

  const menuItems = [
    { title: "회원 등록", icon: "user-plus" as const, route: "/(admin)/members" as const, color: C.tint },
    { title: "반 관리", icon: "layers" as const, route: "/(admin)/classes" as const, color: "#7C3AED" },
    { title: "출결 체크", icon: "check-square" as const, route: "/(admin)/attendance" as const, color: C.success },
    { title: "공지 작성", icon: "edit-3" as const, route: "/(admin)/notices" as const, color: C.warning },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), paddingBottom: insets.bottom + 100, paddingHorizontal: 20, gap: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStats(); }} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topRow}>
          <View>
            <Text style={[styles.poolName, { color: C.text }]}>{pool?.name || "수영장"}</Text>
            <Text style={[styles.greeting, { color: C.textSecondary }]}>안녕하세요, {user?.name}님</Text>
          </View>
          <View style={styles.topRight}>
            <View style={[styles.subBadge, { backgroundColor: subStatus?.bg }]}>
              <Text style={[styles.subBadgeText, { color: subStatus?.color }]}>{subStatus?.label}</Text>
            </View>
            <Pressable onPress={logout} style={[styles.logoutIcon, { backgroundColor: C.card }]}>
              <Feather name="log-out" size={18} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 20 }} /> : (
          <View style={styles.statsGrid}>
            {statCards.map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
                <View style={[styles.statIcon, { backgroundColor: s.bg }]}>
                  <Feather name={s.icon} size={20} color={s.color} />
                </View>
                <Text style={[styles.statValue, { color: C.text }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: C.textSecondary }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: C.text }]}>빠른 메뉴</Text>
        <View style={styles.menuGrid}>
          {menuItems.map((m) => (
            <Pressable
              key={m.title}
              style={({ pressed }) => [styles.menuCard, { backgroundColor: C.card, shadowColor: C.shadow, opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push(m.route)}
            >
              <View style={[styles.menuIcon, { backgroundColor: m.color + "15" }]}>
                <Feather name={m.icon} size={24} color={m.color} />
              </View>
              <Text style={[styles.menuTitle, { color: C.text }]}>{m.title}</Text>
            </Pressable>
          ))}
        </View>

        {pool && (
          <View style={[styles.poolInfoCard, { backgroundColor: C.card, shadowColor: C.shadow }]}>
            <Text style={[styles.sectionTitle, { color: C.text, marginBottom: 0 }]}>수영장 정보</Text>
            {[
              { icon: "map-pin" as const, value: pool.address },
              { icon: "phone" as const, value: pool.phone },
              { icon: "user" as const, value: pool.owner_name + " 대표" },
            ].map(({ icon, value }) => (
              <View key={icon} style={styles.poolInfoRow}>
                <Feather name={icon} size={14} color={C.textMuted} />
                <Text style={[styles.poolInfoText, { color: C.textSecondary }]}>{value}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  poolName: { fontSize: 22, fontFamily: "Inter_700Bold" },
  greeting: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  topRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  subBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  subBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  logoutIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flex: 1, minWidth: "45%", borderRadius: 16, padding: 16, gap: 8, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  statIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  menuGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  menuCard: { flex: 1, minWidth: "45%", borderRadius: 16, padding: 20, gap: 12, alignItems: "center", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  menuIcon: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  menuTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  poolInfoCard: { borderRadius: 16, padding: 16, gap: 10, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 12, elevation: 3 },
  poolInfoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  poolInfoText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
