import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface ClassGroup {
  name: string;
  schedule_days: string;
  schedule_time: string;
}

interface Student {
  id: string;
  name: string;
  birth_date?: string | null;
  phone?: string | null;
  class_group?: ClassGroup | null;
}

const C = Colors.light;

const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

function parseScheduleChips(days: string, time: string): string[] {
  let parts: string[] = [];
  if (days.includes(",")) {
    parts = days.split(",").map(d => d.trim()).filter(Boolean);
  } else {
    parts = days.split("").filter(d => DAY_ORDER.includes(d));
  }
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.slice(0, 7).map(d => `${d} ${time}`);
}

function ScheduleChips({ class_group }: { class_group: ClassGroup | null | undefined }) {
  if (!class_group || !class_group.schedule_days || !class_group.schedule_time) {
    return <Text style={styles.noGroup}>수업 그룹 미배정</Text>;
  }
  const chips = parseScheduleChips(class_group.schedule_days, class_group.schedule_time);
  return (
    <View style={styles.chipsRow}>
      {chips.map((chip, i) => (
        <View key={i} style={[styles.chip, { backgroundColor: C.tintLight }]}>
          <Text style={[styles.chipText, { color: C.tint }]}>{chip}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ChildrenScreen() {
  const { token, parentAccount, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { fetchStudents(); }, []);

  async function fetchStudents() {
    try {
      const res = await apiRequest(token, "/parent/students");
      const data = await res.json();
      setStudents(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }

  const avatarColors = [C.tint, C.success, "#7C3AED", C.warning];

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20) }]}>
        <View>
          <Text style={[styles.poolName, { color: C.text }]}>{parentAccount?.pool_name || "수영장"}</Text>
          <Text style={[styles.greeting, { color: C.textSecondary }]}>{parentAccount?.name}님, 안녕하세요</Text>
        </View>
        <Pressable onPress={logout} style={[styles.logoutBtn, { backgroundColor: C.card }]}>
          <Feather name="log-out" size={18} color={C.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 12, paddingTop: 8 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStudents(); }} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
        ) : students.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="user-x" size={52} color={C.textMuted} />
            <Text style={[styles.emptyTitle, { color: C.text }]}>연결된 자녀가 없습니다</Text>
            <Text style={[styles.emptySub, { color: C.textSecondary }]}>수영장 관리자에게 학생 연결을 요청하세요</Text>
          </View>
        ) : (
          <>
            <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>자녀 {students.length}명</Text>
            {students.map((s, i) => {
              const color = avatarColors[i % avatarColors.length];
              return (
                <Pressable
                  key={s.id}
                  style={({ pressed }) => [styles.card, { backgroundColor: C.card, opacity: pressed ? 0.92 : 1, shadowColor: C.shadow }]}
                  onPress={() => router.push({ pathname: "/(parent)/student-detail", params: { id: s.id, name: s.name } })}
                >
                  <View style={styles.cardTop}>
                    <View style={[styles.avatar, { backgroundColor: color + "22" }]}>
                      <Text style={[styles.avatarText, { color }]}>{s.name[0]}</Text>
                    </View>
                    <View style={styles.nameBlock}>
                      <Text style={[styles.name, { color: C.text }]}>{s.name}</Text>
                      {s.birth_date ? (
                        <Text style={[styles.birth, { color: C.textMuted }]}>{s.birth_date}</Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={20} color={C.textMuted} />
                  </View>

                  <ScheduleChips class_group={s.class_group} />
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
    paddingHorizontal: 20, paddingBottom: 16,
  },
  poolName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: {
    borderRadius: 16, padding: 16, gap: 12,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  nameBlock: { flex: 1, gap: 3 },
  name: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  birth: { fontSize: 12, fontFamily: "Inter_400Regular" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noGroup: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#9CA3AF" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
