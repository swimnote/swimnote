import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, RefreshControl,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { ParentScreenHeader } from "@/components/parent/ParentScreenHeader";
import { LevelBadge, type LevelDef } from "@/components/common/LevelBadge";
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

interface LevelInfo {
  current_level_order: number | null;
  current_level: LevelDef | null;
  next_level: LevelDef | null;
  all_levels: LevelDef[];
}

const LEVEL_COLORS = ["#DDF2EF", "#DFF3EC", "#FFF1BF", "#FDF4FF", "#FFF1F2"];
const LEVEL_ACCENTS = ["#1F8F86", "#16A34A", "#D97706", "#9333EA", "#E11D48"];

export default function ParentLevelScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const [records, setRecords] = useState<LevelRecord[]>([]);
  const [levelInfo, setLevelInfo] = useState<LevelInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchLevels() {
    if (!selectedStudent?.id) { setLoading(false); return; }
    try {
      const [histRes, infoRes] = await Promise.all([
        apiRequest(token, `/parent/students/${selectedStudent.id}/levels`),
        apiRequest(token, `/parent/students/${selectedStudent.id}/level-info`),
      ]);
      if (histRes.ok) {
        const data = await histRes.json();
        setRecords(Array.isArray(data) ? data : []);
      }
      if (infoRes.ok) setLevelInfo(await infoRes.json());
    } catch { }
    finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { setLoading(true); fetchLevels(); }, [selectedStudent?.id]);

  const currentLevel = levelInfo?.current_level;

  return (
    <View style={[s.root, { backgroundColor: C.background }]}>
      <ParentScreenHeader
        title="레벨 기록"
        subtitle={selectedStudent?.name}
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
            {currentLevel ? (
              <View style={{ alignItems: "center", gap: 8 }}>
                <LevelBadge level={currentLevel} size="lg" />
                <Text style={s.currentLevelName}>{currentLevel.level_name}</Text>
              </View>
            ) : records[0] ? (
              <>
                <Text style={s.currentLevel}>{records[0].level}</Text>
                <Text style={s.currentDate}>달성일: {records[0].achieved_date}</Text>
              </>
            ) : (
              <>
                <Text style={s.currentLevel}>-</Text>
                <Text style={s.currentDate}>아직 레벨 기록이 없습니다</Text>
              </>
            )}
          </View>

          {/* 현재 레벨 설명 카드 */}
          {currentLevel && (currentLevel.level_description || currentLevel.learning_content || currentLevel.promotion_test_rule) && (
            <View style={[s.descCard, { backgroundColor: C.card }]}>
              {currentLevel.level_description ? (
                <View style={s.descBlock}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Feather name="info" size={14} color={C.tint} />
                    <Text style={[s.descTitle, { color: C.tint }]}>레벨 소개</Text>
                  </View>
                  <Text style={[s.descText, { color: C.text }]}>{currentLevel.level_description}</Text>
                </View>
              ) : null}

              {currentLevel.learning_content ? (
                <View style={[s.descBlock, currentLevel.level_description && s.descBorderTop]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Feather name="book-open" size={14} color="#3B82F6" />
                    <Text style={[s.descTitle, { color: "#3B82F6" }]}>이 레벨에서 배우는 내용</Text>
                  </View>
                  <Text style={[s.descText, { color: C.text }]}>{currentLevel.learning_content}</Text>
                </View>
              ) : null}

              {currentLevel.promotion_test_rule ? (
                <View style={[s.descBlock, (currentLevel.level_description || currentLevel.learning_content) && s.descBorderTop]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Feather name="award" size={14} color="#D97706" />
                    <Text style={[s.descTitle, { color: "#D97706" }]}>다음 레벨 승급 기준</Text>
                  </View>
                  <Text style={[s.descText, { color: C.text }]}>{currentLevel.promotion_test_rule}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* 다음 레벨 안내 */}
          {levelInfo?.next_level && (
            <View style={[s.nextCard, { backgroundColor: "#FFFBEB", borderColor: "#FEF3C7" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Feather name="arrow-right-circle" size={18} color="#D97706" />
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>
                  다음 목표: 레벨 {levelInfo.next_level.level_name}
                </Text>
              </View>
              {levelInfo.next_level.promotion_test_rule ? (
                <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", marginTop: 6, lineHeight: 20 }}>
                  {levelInfo.next_level.promotion_test_rule}
                </Text>
              ) : null}
            </View>
          )}

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
  currentCard: {
    borderRadius: 24, padding: 28, alignItems: "center", gap: 8,
    shadowColor: "#0000002A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 4,
  },
  currentLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.8)" },
  currentLevel: { fontSize: 52, fontFamily: "Inter_700Bold", color: "#fff", marginTop: 4 },
  currentLevelName: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  currentDate: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.8)" },

  descCard: {
    marginTop: 14, borderRadius: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  descBlock: { padding: 14 },
  descBorderTop: { borderTopWidth: 1, borderTopColor: "#F0EDE9" },
  descTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  descText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },

  nextCard: {
    marginTop: 12, borderRadius: 14, padding: 14, borderWidth: 1,
  },

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
