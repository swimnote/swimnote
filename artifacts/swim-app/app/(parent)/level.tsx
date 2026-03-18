import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { SubScreenHeader } from "@/components/common/SubScreenHeader";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface LevelRecord {
  id: string;
  level: string;
  achieved_date: string;
  note?: string | null;
  teacher_name?: string | null;
}

const LEVEL_COLORS = ["#EFF6FF", "#F0FDF4", "#FFF7ED", "#FDF4FF", "#FFF1F2"];
const LEVEL_ACCENTS = ["#2563EB", "#16A34A", "#D97706", "#9333EA", "#E11D48"];

export default function ParentLevelScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const [records, setRecords] = useState<LevelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchLevels() {
    if (!selectedStudent?.id) { setLoading(false); return; }
    try {
      const res = await apiRequest(token, `/parent/students/${selectedStudent.id}/levels`);
      if (res.ok) {
        const data = await res.json();
        setRecords(Array.isArray(data) ? data : []);
      }
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { setLoading(true); fetchLevels(); }, [selectedStudent?.id]);

  const current = records[0];

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <SubScreenHeader
        title="레벨"
        showHome={false}
        onBack={() => router.navigate("/(parent)/more" as any)}
        rightSlot={
          selectedStudent ? (
            <View style={[s.childChip, { backgroundColor: C.tintLight }]}>
              <Text style={[s.childChipTxt, { color: C.tint }]}>{selectedStudent.name}</Text>
            </View>
          ) : undefined
        }
      />

      {loading ? (
        <ActivityIndicator color={C.tint} style={{ marginTop: 60 }} />
      ) : !selectedStudent ? (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>👶</Text>
          <Text style={[s.emptyTitle, { color: C.text }]}>자녀를 선택해주세요</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLevels(); }} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, paddingTop: 8 }}
        >
          {/* 현재 레벨 카드 */}
          <View style={[s.currentCard, { backgroundColor: C.tint }]}>
            <Text style={s.currentLabel}>현재 레벨</Text>
            {current ? (
              <>
                <Text style={s.currentLevel}>{current.level}</Text>
                <Text style={s.currentDate}>달성일: {current.achieved_date}</Text>
                {current.note ? <Text style={s.currentNote}>{current.note}</Text> : null}
              </>
            ) : (
              <>
                <Text style={s.currentLevel}>-</Text>
                <Text style={s.currentDate}>아직 레벨 기록이 없습니다</Text>
              </>
            )}
          </View>

          {/* 성장 타임라인 */}
          {records.length > 0 ? (
            <View style={{ marginTop: 24, gap: 0 }}>
              <Text style={[s.sectionTitle, { color: C.text }]}>성장 기록</Text>
              <View style={{ marginTop: 12, gap: 0 }}>
                {records.map((r, i) => {
                  const bg = LEVEL_COLORS[i % LEVEL_COLORS.length];
                  const accent = LEVEL_ACCENTS[i % LEVEL_ACCENTS.length];
                  return (
                    <View key={r.id} style={s.timelineRow}>
                      <View style={s.timelineLeft}>
                        <View style={[s.timelineDot, { backgroundColor: accent }]} />
                        {i < records.length - 1 && <View style={[s.timelineLine, { backgroundColor: C.border }]} />}
                      </View>
                      <View style={[s.timelineCard, { backgroundColor: bg, flex: 1, marginBottom: 12 }]}>
                        <View style={s.timelineHeader}>
                          <Text style={[s.timelineLevel, { color: accent }]}>{r.level}</Text>
                          {i === 0 && (
                            <View style={[s.currentBadge, { backgroundColor: accent }]}>
                              <Text style={s.currentBadgeTxt}>현재</Text>
                            </View>
                          )}
                        </View>
                        <Text style={[s.timelineDate, { color: C.textSecondary }]}>{r.achieved_date}</Text>
                        {r.teacher_name ? <Text style={[s.timelineTeacher, { color: C.textMuted }]}>{r.teacher_name} 선생님</Text> : null}
                        {r.note ? <Text style={[s.timelineNote, { color: C.textSecondary }]}>{r.note}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>🏅</Text>
              <Text style={[s.emptyTitle, { color: C.text }]}>아직 레벨 기록이 없습니다</Text>
              <Text style={[s.emptySub, { color: C.textSecondary }]}>선생님이 레벨을 등록하면{"\n"}여기에서 확인할 수 있어요</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", flex: 1 },
  childChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  childChipTxt: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  currentCard: {
    borderRadius: 24, padding: 28, alignItems: "center", gap: 6,
    shadowColor: "#0000002A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 4,
  },
  currentLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },
  currentLevel: { fontSize: 52, fontFamily: "Inter_700Bold", color: "#fff", marginTop: 4 },
  currentDate: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },
  currentNote: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.9)", textAlign: "center", marginTop: 4 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 16 },
  timelineDot: { width: 14, height: 14, borderRadius: 7, marginTop: 16 },
  timelineLine: { width: 2, flex: 1, marginTop: 4 },
  timelineCard: { borderRadius: 16, padding: 14 },
  timelineHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  timelineLevel: { fontSize: 20, fontFamily: "Inter_700Bold" },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  currentBadgeTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#fff" },
  timelineDate: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  timelineTeacher: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  timelineNote: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4, lineHeight: 18 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
});
