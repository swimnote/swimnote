import { Award, BookOpen, CircleArrowRight, Info } from "lucide-react-native";
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

const LEVEL_COLORS = ["#E6FFFA", "#DFF3EC", "#FFF1BF", "#FDF4FF", "#FFF1F2"];
const LEVEL_ACCENTS = ["#2EC4B6", "#16A34A", "#D97706", "#9333EA", "#E11D48"];

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
                    <Info size={14} color={C.tint} />
                    <Text style={[s.descTitle, { color: C.tint }]}>레벨 소개</Text>
                  </View>
                  <Text style={[s.descText, { color: C.text }]}>{currentLevel.level_description}</Text>
                </View>
              ) : null}

              {currentLevel.learning_content ? (
                <View style={[s.descBlock, currentLevel.level_description && s.descBorderTop]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <BookOpen size={14} color="#3B82F6" />
                    <Text style={[s.descTitle, { color: "#3B82F6" }]}>이 레벨에서 배우는 내용</Text>
                  </View>
                  <Text style={[s.descText, { color: C.text }]}>{currentLevel.learning_content}</Text>
                </View>
              ) : null}

              {currentLevel.promotion_test_rule ? (
                <View style={[s.descBlock, (currentLevel.level_description || currentLevel.learning_content) && s.descBorderTop]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Award size={14} color="#D97706" />
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
                <CircleArrowRight size={18} color="#D97706" />
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: "#D97706" }}>
                  다음 목표: 레벨 {levelInfo.next_level.level_name}
                </Text>
              </View>
              {levelInfo.next_level.promotion_test_rule ? (
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: "#92400E", marginTop: 6, lineHeight: 20 }}>
                  {levelInfo.next_level.promotion_test_rule}
                </Text>
              ) : null}
            </View>
          )}

          {/* 성장 타임라인 */}
          {(() => {
            // 기록이 없지만 현재 레벨은 있으면 안내 항목으로 표시
            const displayRecords: LevelRecord[] = records.length > 0
              ? records
              : currentLevel
                ? [{ id: "__current__", level: currentLevel.level_name, achieved_date: "", note: null, teacher_name: null }]
                : [];

            if (displayRecords.length === 0) {
              return (
                <View style={s.empty}>
                  <Text style={s.emptyEmoji}>🏅</Text>
                  <Text style={[s.emptyTitle, { color: C.text }]}>아직 레벨 기록이 없습니다</Text>
                  <Text style={[s.emptySub, { color: C.textSecondary }]}>선생님이 레벨을 변경하면{"\n"}날짜와 함께 자동으로 기록됩니다</Text>
                </View>
              );
            }

            return (
              <View style={{ marginTop: 24, gap: 0 }}>
                <Text style={[s.sectionTitle, { color: C.text }]}>성장 기록</Text>
                <View style={{ marginTop: 12, gap: 0 }}>
                  {displayRecords.map((r, i) => {
                    const bg = LEVEL_COLORS[i % LEVEL_COLORS.length];
                    const accent = LEVEL_ACCENTS[i % LEVEL_ACCENTS.length];
                    const isPlaceholder = r.id === "__current__";
                    return (
                      <View key={r.id} style={s.timelineRow}>
                        <View style={s.timelineLeft}>
                          <View style={[s.timelineDot, { backgroundColor: accent }]} />
                          {i < displayRecords.length - 1 && <View style={[s.timelineLine, { backgroundColor: C.border }]} />}
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
                          {r.achieved_date
                            ? <Text style={[s.timelineDate, { color: C.textSecondary }]}>달성일: {r.achieved_date}</Text>
                            : isPlaceholder
                              ? <Text style={[s.timelineDate, { color: C.textMuted }]}>선생님이 레벨을 변경하면 날짜가 기록됩니다</Text>
                              : null
                          }
                          {r.teacher_name ? <Text style={[s.timelineTeacher, { color: C.textMuted }]}>{r.teacher_name} 선생님</Text> : null}
                          {r.note ? <Text style={[s.timelineNote, { color: C.textSecondary }]}>{r.note}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}
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
  currentLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },
  currentLevel: { fontSize: 52, fontFamily: "Pretendard-Regular", color: "#fff", marginTop: 4 },
  currentLevelName: { fontSize: 20, fontFamily: "Pretendard-Regular", color: "#fff" },
  currentDate: { fontSize: 13, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.8)" },

  descCard: {
    marginTop: 14, borderRadius: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  descBlock: { padding: 14 },
  descBorderTop: { borderTopWidth: 1, borderTopColor: "#F0EDE9" },
  descTitle: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  descText: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 22 },

  nextCard: {
    marginTop: 12, borderRadius: 14, padding: 14, borderWidth: 1,
  },

  sectionTitle: { fontSize: 17, fontFamily: "Pretendard-Regular" },
  timelineRow: { flexDirection: "row", gap: 12 },
  timelineLeft: { alignItems: "center", width: 16 },
  timelineDot: { width: 14, height: 14, borderRadius: 7, marginTop: 16 },
  timelineLine: { width: 2, flex: 1, marginTop: 4 },
  timelineCard: { borderRadius: 16, padding: 14 },
  timelineHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  timelineLevel: { fontSize: 20, fontFamily: "Pretendard-Regular" },
  currentBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  currentBadgeTxt: { fontSize: 10, fontFamily: "Pretendard-Regular", color: "#fff" },
  timelineDate: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 2 },
  timelineTeacher: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  timelineNote: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 4, lineHeight: 18 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontSize: 18, fontFamily: "Pretendard-Regular" },
  emptySub: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22 },
});
