/**
 * (teacher)/student-detail.tsx
 * 선생님이 회원 상세 정보 조회하는 화면
 * 내반 탭에서 학생 이름 클릭 시 진입
 */
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useBrand } from "@/context/BrandContext";
import { PoolHeader } from "@/components/PoolHeader";

const C = Colors.light;

const KO_DAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface AssignedClass {
  id: string; name: string; schedule_days: string; schedule_time: string;
  student_count: number; level?: string | null;
}

interface Student {
  id: string; name: string; birth_year?: string | null; gender?: string | null;
  phone?: string | null; address?: string | null; status?: string;
  parent_user_id?: string | null; weekly_count?: number;
  schedule_labels?: string | null;
  assignedClasses?: AssignedClass[];
}

interface AttendanceStat {
  total: number; present: number; absent: number;
}

function getBirthAge(birthYear?: string | null): string {
  if (!birthYear) return "";
  const age = new Date().getFullYear() - parseInt(birthYear) + 1;
  return `${birthYear}년생 (${age}세)`;
}

function getStatusLabel(status?: string): { text: string; color: string; bg: string } {
  const map: Record<string, { text: string; color: string; bg: string }> = {
    active:              { text: "정상",     color: "#059669", bg: "#D1FAE5" },
    pending_parent_link: { text: "연결 대기", color: "#EA580C", bg: "#FFF7ED" },
    withdrawn:           { text: "탈퇴",     color: "#DC2626", bg: "#FEE2E2" },
    suspended:           { text: "일시정지", color: "#D97706", bg: "#FEF3C7" },
  };
  return map[status ?? ""] ?? { text: status ?? "등록", color: "#6B7280", bg: "#F3F4F6" };
}

export default function StudentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const { themeColor } = useBrand();

  const [student,  setStudent]  = useState<Student | null>(null);
  const [attStat,  setAttStat]  = useState<AttendanceStat | null>(null);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [stRes, attRes] = await Promise.all([
        apiRequest(token, `/students/${id}`),
        apiRequest(token, `/students/${id}/attendance`),
      ]);
      if (stRes.ok)  setStudent(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const total   = arr.length;
        const present = arr.filter(a => a.status === "present").length;
        const absent  = total - present;
        setAttStat({ total, present, absent });
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <ActivityIndicator color={themeColor} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!student) {
    return (
      <SafeAreaView style={s.safe} edges={["top"]}>
        <PoolHeader />
        <View style={s.emptyBox}>
          <Feather name="user-x" size={40} color={C.textMuted} />
          <Text style={s.emptyText}>학생 정보를 불러올 수 없습니다</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusBadge = getStatusLabel(student.status);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <PoolHeader />

      {/* 뒤로 가기 헤더 */}
      <View style={s.header}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>회원 정보</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
        {/* 프로필 카드 */}
        <View style={s.profileCard}>
          <View style={[s.avatarLarge, { backgroundColor: themeColor + "18" }]}>
            <Text style={[s.avatarText, { color: themeColor }]}>{student.name[0]}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.studentName}>{student.name}</Text>
            {student.birth_year && (
              <Text style={s.studentSub}>{getBirthAge(student.birth_year)}</Text>
            )}
          </View>
          <View style={[s.statusBadge, { backgroundColor: statusBadge.bg }]}>
            <Text style={[s.statusText, { color: statusBadge.color }]}>{statusBadge.text}</Text>
          </View>
        </View>

        {/* 기본 정보 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>기본 정보</Text>
          <View style={s.card}>
            <InfoRow icon="user" label="이름" value={student.name} />
            {student.birth_year && (
              <InfoRow icon="calendar" label="생년" value={getBirthAge(student.birth_year)} />
            )}
            {student.gender && (
              <InfoRow icon="users" label="성별" value={student.gender === "male" ? "남" : student.gender === "female" ? "여" : student.gender} />
            )}
            <InfoRow
              icon="link"
              label="학부모 연결"
              value={student.parent_user_id ? "연결됨" : student.status === "pending_parent_link" ? "대기 중" : "미연결"}
              valueColor={student.parent_user_id ? "#059669" : student.status === "pending_parent_link" ? "#EA580C" : "#6B7280"}
            />
          </View>
        </View>

        {/* 출결 통계 */}
        {attStat && attStat.total > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>출결 현황</Text>
            <View style={[s.card, s.attRow]}>
              <AttBox label="전체" value={attStat.total} color={themeColor} />
              <View style={s.attDivider} />
              <AttBox label="출석" value={attStat.present} color="#059669" />
              <View style={s.attDivider} />
              <AttBox label="결석" value={attStat.absent} color="#DC2626" />
              <View style={s.attDivider} />
              <AttBox
                label="출석률"
                value={`${Math.round((attStat.present / attStat.total) * 100)}%`}
                color={attStat.present / attStat.total >= 0.8 ? "#059669" : "#D97706"}
              />
            </View>
          </View>
        )}

        {/* 배정된 반 */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>수강 반</Text>
          {(!student.assignedClasses || student.assignedClasses.length === 0) ? (
            <View style={[s.card, s.emptyCard]}>
              <Feather name="layers" size={24} color={C.textMuted} />
              <Text style={s.emptyCardText}>배정된 반이 없습니다</Text>
            </View>
          ) : (
            <View style={s.card}>
              {student.assignedClasses.map((cls, i) => (
                <View key={cls.id}>
                  {i > 0 && <View style={s.divider} />}
                  <View style={s.classRow}>
                    <View style={[s.colorBar, { backgroundColor: colorFromId(cls.id, themeColor) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.className}>{cls.name}</Text>
                      <Text style={s.classMeta}>
                        {cls.schedule_days.split(",").join("·")} · {cls.schedule_time}
                        {cls.level ? ` · ${cls.level}` : ""}
                      </Text>
                    </View>
                    <Pressable
                      style={[s.goBtn, { borderColor: themeColor + "40" }]}
                      onPress={() => router.push({ pathname: "/(teacher)/attendance", params: { classGroupId: cls.id } } as any)}
                    >
                      <Text style={[s.goBtnText, { color: themeColor }]}>출결</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, valueColor }: { icon: any; label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.infoRow}>
      <Feather name={icon} size={14} color={C.textMuted} style={{ marginTop: 1 }} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

function AttBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={s.attBox}>
      <Text style={[s.attValue, { color }]}>{value}</Text>
      <Text style={s.attLabel}>{label}</Text>
    </View>
  );
}

function colorFromId(id: string, fallback: string): string {
  const COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: "#F3F4F6" },
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff",
                  borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6",
                  alignItems: "center", justifyContent: "center" },
  headerTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },

  content:      { padding: 16, gap: 16 },

  profileCard:  { backgroundColor: "#fff", borderRadius: 16, padding: 16,
                  flexDirection: "row", alignItems: "center", gap: 14,
                  shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  avatarLarge:  { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText:   { fontSize: 24, fontFamily: "Inter_700Bold" },
  profileInfo:  { flex: 1 },
  studentName:  { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  studentSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textMuted, marginTop: 2 },
  statusBadge:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  statusText:   { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  section:      { gap: 8 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, paddingLeft: 4 },
  card:         { backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
                  shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },

  infoRow:      { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  infoLabel:    { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary, width: 70 },
  infoValue:    { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: C.text, textAlign: "right" },

  attRow:       { flexDirection: "row", padding: 16 },
  attBox:       { flex: 1, alignItems: "center", gap: 4 },
  attValue:     { fontSize: 20, fontFamily: "Inter_700Bold" },
  attLabel:     { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  attDivider:   { width: 1, backgroundColor: C.border, marginVertical: 4 },

  classRow:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  colorBar:     { width: 4, height: 40, borderRadius: 2 },
  className:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  classMeta:    { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  divider:      { height: 1, backgroundColor: "#F3F4F6", marginHorizontal: 14 },
  goBtn:        { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5 },
  goBtnText:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  emptyCard:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  emptyCardText:{ fontSize: 13, color: C.textMuted, fontFamily: "Inter_400Regular" },

  emptyBox:     { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyText:    { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textMuted },
});
