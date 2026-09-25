import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";

interface ClassGroup {
  id: string; name: string;
  schedule_days: string; schedule_time: string;
  instructor?: string | null; level?: string | null;
}
interface Student {
  id: string; name: string;
  birth_date?: string | null;
  class_group?: ClassGroup | null;
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

  const cg = student?.class_group;
  const chips = cg?.schedule_days ? parseChips(cg.schedule_days, cg.schedule_time || "") : [];

  return (
    <View style={[styles.root, { backgroundColor: C.background }]}>
      <SubScreenHeader title={name as string || "학생 정보"} showHome={false} homePath="/(parent)/children" />

      {loading ? <ActivityIndicator color={C.brandStrong} style={{ marginTop: 60 }} /> : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchStudent(); }} />}
        >
          {/* 학생 이름 */}
          <Text style={[styles.studentName, { color: C.text }]}>{name}</Text>

          {/* 수업시간 칩 - 정보 전용 */}
          {chips.length > 0 ? (
            <View style={styles.chipsRow}>
              {chips.map((chip, i) => (
                <View key={i} style={[styles.chip, { backgroundColor: C.brandMist }]}>
                  <Text style={[styles.chipText, { color: C.brandStrong }]}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.noSchedule, { color: C.textMuted }]}>수업 배정 없음</Text>
          )}

          {/* 큰 카드 2개 - 사진첩 / 수영일지 */}
          <View style={styles.bigCardsRow}>
            <Pressable
              style={({ pressed }) => [styles.bigCard, { backgroundColor: "#7C3AED", opacity: pressed ? 0.9 : 1 }]}
              onPress={() => router.push({ pathname: "/(parent)/photos", params: { id, name, backTo: "student-detail" } })}
            >
              <Text style={styles.bigCardEmoji}>📷</Text>
              <Text style={styles.bigCardLabel}>수영 사진첩</Text>
              <Text style={styles.bigCardSub}>수업 사진 보기</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.bigCard, { backgroundColor: C.primaryAction, opacity: pressed ? 0.9 : 1 }]}
              onPress={() => router.push({ pathname: "/(parent)/swim-diary", params: { id, name, backTo: "student-detail" } })}
            >
              <Text style={styles.bigCardEmoji}>📒</Text>
              <Text style={styles.bigCardLabel}>수영 일지</Text>
              <Text style={styles.bigCardSub}>성장 기록 보기</Text>
            </Pressable>
          </View>

          {/* 출결기록 - 중간 카드 */}
          <Pressable
            style={({ pressed }) => [styles.midCard, { backgroundColor: C.card, opacity: pressed ? 0.9 : 1 }]}
            onPress={() => router.push({ pathname: "/(parent)/attendance-history", params: { id, name, backTo: "student-detail" } })}
          >
            <View style={[styles.midIcon, { backgroundColor: C.success + "20" }]}>
              <LucideIcon name="calendar" size={22} color={C.success} />
            </View>
            <View style={styles.midText}>
              <Text style={[styles.midLabel, { color: C.text }]}>출결기록 보기</Text>
              <Text style={[styles.midSub, { color: C.textMuted }]}>월별 출결 현황 확인</Text>
            </View>
            <LucideIcon name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>

          {/* 공지사항 - 작은 카드 */}
          <Pressable
            style={({ pressed }) => [styles.smallCard, { backgroundColor: C.card, borderColor: C.border, opacity: pressed ? 0.9 : 1 }]}
            onPress={() => router.push({ pathname: "/(parent)/notices", params: { backTo: "student-detail" } })}
          >
            <LucideIcon name="bell" size={16} color={C.textSecondary} />
            <Text style={[styles.smallLabel, { color: C.textSecondary }]}>공지사항</Text>
            <LucideIcon name="chevron-right" size={14} color={C.textMuted} />
          </Pressable>

          {/* 지난 수강 기록 - 관리자가 Archive 연결 시 표시 */}
          <ArchiveDiariesButton studentId={id as string} studentName={name as string} token={token} />
        </ScrollView>
      )}
    </View>
  );
}

// ── Archive Diaries Button ───────────────────────────────────────────────────
// 관리자가 Archive를 연결한 경우에만 표시 (link 없으면 렌더링 자체 안 함)
function ArchiveDiariesButton({ studentId, studentName, token }: { studentId: string; studentName: string; token: string | null }) {
  const [hasArchive, setHasArchive] = useState(false);

  useEffect(() => {
    if (!studentId || !token) return;
    apiRequest(token, `/parent/students/${studentId}/archive-diaries`)
      .then(r => r.ok ? r.json() : [])
      .then((data: any[]) => setHasArchive(data.length > 0))
      .catch(() => {});
  }, [studentId, token]);

  if (!hasArchive) return null;

  return (
    <Pressable
      style={({ pressed }) => [archiveBtnStyle, { opacity: pressed ? 0.8 : 1 }]}
      onPress={() => router.push({ pathname: "/(parent)/archive-diaries", params: { id: studentId, name: studentName } } as any)}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#E0F2FE", alignItems: "center", justifyContent: "center" }}>
        <LucideIcon name="history" size={18} color="#0369A1" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: "#0C4A6E", fontWeight: "600" }}>지난 수강 기록</Text>
        <Text style={{ fontSize: 12, color: "#64748B", marginTop: 1 }}>이전 수강 이력 보기</Text>
      </View>
      <LucideIcon name="chevron-right" size={16} color="#94A3B8" />
    </Pressable>
  );
}

const archiveBtnStyle: any = {
  flexDirection: "row", alignItems: "center", gap: 12,
  borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  borderWidth: 1, borderColor: "#BAE6FD", backgroundColor: "#F0F9FF", marginBottom: 10,
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 4 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  studentName: { fontSize: 28, fontFamily: "Pretendard-Regular", marginBottom: 10 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  chipText: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  noSchedule: { fontSize: 13, fontFamily: "Pretendard-Regular", marginBottom: 24 },

  bigCardsRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  bigCard: { flex: 1, borderRadius: 20, padding: 20, gap: 6, minHeight: 140, justifyContent: "flex-end" },
  bigCardEmoji: { fontSize: 32, marginBottom: 4 },
  bigCardLabel: { fontSize: 17, fontFamily: "Pretendard-Regular", color: "#fff" },
  bigCardSub: { fontSize: 12, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)" },

  midCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 16, padding: 16, marginBottom: 10,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2, shadowColor: "#00000012",
  },
  midIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  midText: { flex: 1, gap: 3 },
  midLabel: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  midSub: { fontSize: 12, fontFamily: "Pretendard-Regular" },

  smallCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, marginBottom: 10,
  },
  smallLabel: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular" },
});
