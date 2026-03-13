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

interface Student {
  id: string; name: string; birth_date?: string | null; phone?: string | null;
  class_group_id?: string | null; class_group_name?: string | null; memo?: string | null;
}

const C = Colors.light;

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

  const colors = [C.tint, C.success, "#7C3AED", C.warning];

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
              const color = colors[i % colors.length];
              return (
                <Pressable
                  key={s.id}
                  style={({ pressed }) => [styles.card, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1, shadowColor: C.shadow }]}
                  onPress={() => router.push({ pathname: "/(parent)/student-detail", params: { id: s.id, name: s.name } })}
                >
                  <View style={[styles.avatar, { backgroundColor: color + "20" }]}>
                    <Text style={[styles.avatarText, { color }]}>{s.name[0]}</Text>
                  </View>
                  <View style={styles.info}>
                    <Text style={[styles.name, { color: C.text }]}>{s.name}</Text>
                    {s.class_group_name ? (
                      <View style={[styles.groupBadge, { backgroundColor: C.tintLight }]}>
                        <Feather name="clock" size={11} color={C.tint} />
                        <Text style={[styles.groupText, { color: C.tint }]}>{s.class_group_name}</Text>
                      </View>
                    ) : (
                      <Text style={[styles.noGroup, { color: C.textMuted }]}>수업 그룹 미배정</Text>
                    )}
                    {s.birth_date ? <Text style={[styles.birth, { color: C.textMuted }]}>{s.birth_date}</Text> : null}
                  </View>
                  <Feather name="chevron-right" size={20} color={C.textMuted} />
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingBottom: 16 },
  poolName: { fontSize: 20, fontFamily: "Inter_700Bold" },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  logoutBtn: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  card: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 10, elevation: 3 },
  avatar: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  info: { flex: 1, gap: 5 },
  name: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  groupBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  groupText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  noGroup: { fontSize: 12, fontFamily: "Inter_400Regular" },
  birth: { fontSize: 12, fontFamily: "Inter_400Regular" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
