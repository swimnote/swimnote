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

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  instructor?: string | null; level?: string | null;
}

interface Student {
  id: string; name: string;
  birth_date?: string | null; phone?: string | null;
  class_group?: ClassGroup | null; memo?: string | null;
}

const C = Colors.light;
const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

function parseChips(days: string, time: string): string[] {
  let parts: string[] = days.includes(",")
    ? days.split(",").map(d => d.trim()).filter(Boolean)
    : days.split("").filter(d => DAY_ORDER.includes(d));
  parts.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return parts.slice(0, 7).map(d => `${d} ${time}`);
}

function ScheduleDisplay({ cg }: { cg?: ClassGroup | null }) {
  if (!cg || !cg.schedule_days) {
    return (
      <View style={[styles.scheduleBox, { backgroundColor: C.card }]}>
        <Feather name="clock" size={16} color={C.textMuted} />
        <Text style={[styles.noSchedule, { color: C.textMuted }]}>배정된 수업이 없습니다</Text>
      </View>
    );
  }
  const chips = parseChips(cg.schedule_days, cg.schedule_time || "");
  return (
    <View style={[styles.scheduleBox, { backgroundColor: C.card }]}>
      <View style={styles.scheduleTop}>
        <Text style={[styles.cgName, { color: C.text }]}>{cg.name}</Text>
        {cg.level ? <View style={[styles.lvBadge, { backgroundColor: C.tintLight }]}><Text style={[styles.lvText, { color: C.tint }]}>{cg.level}</Text></View> : null}
      </View>
      {cg.instructor ? <Text style={[styles.instructor, { color: C.textSecondary }]}>강사: {cg.instructor}</Text> : null}
      <View style={styles.chipsRow}>
        {chips.map((chip, i) => (
          <View key={i} style={[styles.chip, { backgroundColor: C.tint + "18" }]}>
            <Text style={[styles.chipText, { color: C.tint }]}>{chip}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function MenuCard({ icon, label, sub, color, onPress }: { icon: any; label: string; sub: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuCard, { backgroundColor: C.card, opacity: pressed ? 0.88 : 1 }]}
      onPress={onPress}
    >
      <View style={[styles.menuIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon} size={22} color={color} />
      </View>
      <View style={styles.menuText}>
        <Text style={[styles.menuLabel, { color: C.text }]}>{label}</Text>
        <Text style={[styles.menuSub, { color: C.textMuted }]}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={C.textMuted} />
    </Pressable>
  );
}

export default function ParentStudentDetailScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();

  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStudent() {
    try {
      const res = await apiRequest(token, `/parent/students/${id}`);
      if (res.ok) setStudent(await res.json());
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { fetchStudent(); }, [id]);

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: C.text }]}>{name || "학생 상세"}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} /> : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 20, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStudent(); }} />}
        >
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>현재 수업 시간표</Text>
            <ScheduleDisplay cg={student?.class_group} />
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>메뉴</Text>
            <MenuCard
              icon="calendar" label="출결 기록" sub="월별 출결 현황 확인"
              color={C.tint}
              onPress={() => router.push({ pathname: "/(parent)/attendance-history", params: { id, name } })}
            />
            <MenuCard
              icon="bell" label="공지사항" sub="수영장 공지 및 개별 안내"
              color={C.success}
              onPress={() => router.push({ pathname: "/(parent)/notices", params: { studentId: id, studentName: name } })}
            />
            <MenuCard
              icon="image" label="사진첩" sub="수업 사진 보기 및 다운로드"
              color="#7C3AED"
              onPress={() => router.push({ pathname: "/(parent)/photos", params: { id, name } })}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  section: { gap: 10 },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.6 },
  scheduleBox: { borderRadius: 16, padding: 16, gap: 10 },
  scheduleTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  cgName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  lvBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  lvText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  instructor: { fontSize: 13, fontFamily: "Inter_400Regular" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  chipText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  noSchedule: { fontSize: 14, fontFamily: "Inter_400Regular" },
  menuCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, padding: 16, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2, shadowColor: "#00000015" },
  menuIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuText: { flex: 1, gap: 3 },
  menuLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  menuSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
