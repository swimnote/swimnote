/**
 * (parent)/growth-report.tsx — 학생 3개월 성장 리포트
 * - 월별 출석 현황 (3개월)
 * - 레벨 타임라인
 * - 최근 수업 일지 피드백
 * - 공유 버튼 (카카오톡 포함)
 */
import { Award, BookOpen, Calendar, ChevronLeft, Share2, TrendingUp } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable,
  ScrollView, Share, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C = Colors.light;

interface MonthlyAtt  { label: string; present: number; absent: number; late: number; total: number; }
interface LevelRecord { level: string; achieved_date: string; note?: string; teacher_name?: string; }
interface DiaryRecord { lesson_date: string; common_content: string; teacher_name: string; student_note?: string; }

interface Report {
  student_name:      string;
  class_name:        string;
  monthly_attendance: MonthlyAtt[];
  level_history:      LevelRecord[];
  recent_diaries:     DiaryRecord[];
  total_lessons:      number;
  period_label:       string;
}

function fmtDate(iso: string) {
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/* ── 월별 출석 막대 ─────────────────────────────────────────────────── */
function AttBar({ month }: { month: MonthlyAtt }) {
  const maxH = 60;
  const pct = month.total > 0 ? month.present / month.total : 0;
  const barH = Math.max(4, Math.round(pct * maxH));
  const rate = month.total > 0 ? Math.round((month.present / month.total) * 100) : 0;

  return (
    <View style={gr.barCol}>
      <Text style={gr.barPct}>{month.total > 0 ? `${rate}%` : "-"}</Text>
      <View style={gr.barTrack}>
        <View style={[gr.barFill, { height: barH, backgroundColor: rate >= 80 ? "#2EC4B6" : rate >= 60 ? "#F59E0B" : "#EF4444" }]} />
      </View>
      <Text style={gr.barLabel}>{month.label}</Text>
      <Text style={gr.barSub}>{month.present}/{month.total}</Text>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════ */
export default function GrowthReportScreen() {
  const { token } = useAuth();
  const { selectedStudent } = useParent();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ studentId?: string }>();

  const studentId = params.studentId || selectedStudent?.id;

  const [report,  setReport]  = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!studentId) { setLoading(false); return; }
    load();
  }, [studentId]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await apiRequest(token, `/parent/students/${studentId}/growth-report`);
      if (r.ok) setReport(await r.json());
      else setError("리포트를 불러올 수 없습니다.");
    } catch { setError("네트워크 오류가 발생했습니다."); }
    setLoading(false);
  }

  async function handleShare() {
    if (!report) return;
    const { student_name, period_label, monthly_attendance, level_history, total_lessons } = report;

    const totalPresent = monthly_attendance.reduce((s, m) => s + m.present, 0);
    const totalAll     = monthly_attendance.reduce((s, m) => s + m.total, 0);
    const rate = totalAll > 0 ? Math.round((totalPresent / totalAll) * 100) : 0;

    const currentLevel = level_history.length > 0 ? level_history[level_history.length - 1].level : null;
    const firstLevel   = level_history.length > 1 ? level_history[0].level : null;

    const lines: string[] = [];
    lines.push(`🏊 ${student_name}의 3개월 성장 리포트`);
    lines.push(`📅 ${period_label}`);
    lines.push("");
    lines.push(`✅ 출석률 ${rate}% (${totalPresent}/${totalAll}회)`);
    lines.push(`📚 총 수업 일수 ${total_lessons}회`);
    if (currentLevel) {
      lines.push(firstLevel && firstLevel !== currentLevel
        ? `🏅 레벨 ${firstLevel} → ${currentLevel} (성장!)`
        : `🏅 현재 레벨 ${currentLevel}`);
    }
    lines.push("");
    lines.push("─────────────────────");
    lines.push("💙 스윔노트 앱에서 자세한 성장 기록을 확인하세요");
    lines.push(Platform.OS === "ios"
      ? "https://apps.apple.com/app/id6738888898"
      : "https://play.google.com/store/apps/details?id=com.swimnote.app");

    try {
      await Share.share({ message: lines.join("\n"), title: `${student_name}의 성장 리포트` });
    } catch (_) {}
  }

  const PT = insets.top + (Platform.OS === "web" ? 67 : 12);

  if (loading) {
    return (
      <View style={[gr.root, { paddingTop: PT }]}>
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} size="large" />
      </View>
    );
  }

  if (error || !report) {
    return (
      <View style={[gr.root, { paddingTop: PT }]}>
        <View style={gr.topBar}>
          <Pressable style={gr.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color={C.text} />
          </Pressable>
          <Text style={gr.topTitle}>성장 리포트</Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <TrendingUp size={36} color={C.textMuted} />
          <Text style={{ fontSize: 15, color: C.textSecondary, fontFamily: "Pretendard-Regular" }}>
            {error || "리포트 데이터가 없습니다."}
          </Text>
        </View>
      </View>
    );
  }

  const { student_name, class_name, monthly_attendance, level_history, recent_diaries, total_lessons, period_label } = report;

  const totalPresent = monthly_attendance.reduce((s, m) => s + m.present, 0);
  const totalAll     = monthly_attendance.reduce((s, m) => s + m.total, 0);
  const totalAbsent  = monthly_attendance.reduce((s, m) => s + m.absent, 0);
  const overallRate  = totalAll > 0 ? Math.round((totalPresent / totalAll) * 100) : 0;

  const currentLevel = level_history.length > 0 ? level_history[level_history.length - 1] : null;
  const startLevel   = level_history.length > 1 ? level_history[0] : null;
  const leveledUp    = startLevel && currentLevel && startLevel.level !== currentLevel.level;

  return (
    <View style={[gr.root, { paddingTop: PT }]}>
      {/* 상단 바 */}
      <View style={gr.topBar}>
        <Pressable style={gr.backBtn} onPress={() => router.back()}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={gr.topTitle}>{student_name}의 성장 리포트</Text>
          <Text style={gr.topSub}>{period_label} · {class_name}</Text>
        </View>
        <Pressable style={gr.shareTopBtn} onPress={handleShare}>
          <Share2 size={15} color="#4EA7D8" />
          <Text style={gr.shareTopText}>공유</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={gr.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 요약 카드 ── */}
        <View style={gr.summaryRow}>
          <View style={[gr.summaryChip, { backgroundColor: "#ECFDF5" }]}>
            <Calendar size={14} color="#059669" />
            <Text style={[gr.summaryVal, { color: "#059669" }]}>{totalPresent}회</Text>
            <Text style={[gr.summaryKey, { color: "#059669" }]}>출석</Text>
          </View>
          <View style={[gr.summaryChip, { backgroundColor: "#FEF2F2" }]}>
            <Calendar size={14} color="#DC2626" />
            <Text style={[gr.summaryVal, { color: "#DC2626" }]}>{totalAbsent}회</Text>
            <Text style={[gr.summaryKey, { color: "#DC2626" }]}>결석</Text>
          </View>
          <View style={[gr.summaryChip, { backgroundColor: "#EFF6FF" }]}>
            <BookOpen size={14} color="#2563EB" />
            <Text style={[gr.summaryVal, { color: "#2563EB" }]}>{total_lessons}회</Text>
            <Text style={[gr.summaryKey, { color: "#2563EB" }]}>수업 일수</Text>
          </View>
          <View style={[gr.summaryChip, { backgroundColor: overallRate >= 80 ? "#ECFDF5" : "#FEF9C3" }]}>
            <TrendingUp size={14} color={overallRate >= 80 ? "#059669" : "#D97706"} />
            <Text style={[gr.summaryVal, { color: overallRate >= 80 ? "#059669" : "#D97706" }]}>{overallRate}%</Text>
            <Text style={[gr.summaryKey, { color: overallRate >= 80 ? "#059669" : "#D97706" }]}>출석률</Text>
          </View>
        </View>

        {/* ── 월별 출석 막대 ── */}
        <View style={gr.card}>
          <View style={gr.cardHeader}>
            <View style={[gr.cardIconBg, { backgroundColor: "#DBEAFE" }]}>
              <Calendar size={15} color="#2563EB" />
            </View>
            <Text style={gr.cardTitle}>월별 출석 현황</Text>
          </View>
          <View style={gr.barsRow}>
            {monthly_attendance.map(m => <AttBar key={m.label} month={m} />)}
          </View>
          <View style={gr.legendRow}>
            <View style={[gr.legendDot, { backgroundColor: "#2EC4B6" }]} />
            <Text style={gr.legendText}>80% 이상</Text>
            <View style={[gr.legendDot, { backgroundColor: "#F59E0B", marginLeft: 10 }]} />
            <Text style={gr.legendText}>60~79%</Text>
            <View style={[gr.legendDot, { backgroundColor: "#EF4444", marginLeft: 10 }]} />
            <Text style={gr.legendText}>60% 미만</Text>
          </View>
        </View>

        {/* ── 레벨 타임라인 ── */}
        {level_history.length > 0 && (
          <View style={gr.card}>
            <View style={gr.cardHeader}>
              <View style={[gr.cardIconBg, { backgroundColor: "#DCFCE7" }]}>
                <Award size={15} color="#16A34A" />
              </View>
              <Text style={gr.cardTitle}>레벨 히스토리</Text>
              {leveledUp && (
                <View style={gr.upBadge}>
                  <TrendingUp size={11} color="#16A34A" />
                  <Text style={gr.upBadgeText}>레벨 상승!</Text>
                </View>
              )}
            </View>
            <View style={gr.timeline}>
              {level_history.map((lv, idx) => {
                const isLast = idx === level_history.length - 1;
                return (
                  <View key={idx} style={gr.tlRow}>
                    <View style={gr.tlLeft}>
                      <View style={[gr.tlDot, { backgroundColor: isLast ? "#16A34A" : C.border }]} />
                      {!isLast && <View style={gr.tlLine} />}
                    </View>
                    <View style={gr.tlRight}>
                      <View style={gr.tlTopRow}>
                        <View style={[gr.levelBadge, { backgroundColor: isLast ? "#DCFCE7" : "#F3F4F6" }]}>
                          <Text style={[gr.levelBadgeText, { color: isLast ? "#15803D" : C.textSecondary }]}>
                            {lv.level}
                          </Text>
                        </View>
                        {isLast && (
                          <View style={gr.currentBadge}>
                            <Text style={gr.currentBadgeText}>현재</Text>
                          </View>
                        )}
                      </View>
                      <Text style={gr.tlDate}>
                        {lv.achieved_date ? fmtDate(lv.achieved_date) : ""}
                        {lv.teacher_name ? ` · ${lv.teacher_name} 선생님` : ""}
                      </Text>
                      {lv.note ? <Text style={gr.tlNote} numberOfLines={2}>{lv.note}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── 최근 수업 일지 피드백 ── */}
        {recent_diaries.length > 0 && (
          <View style={gr.card}>
            <View style={gr.cardHeader}>
              <View style={[gr.cardIconBg, { backgroundColor: "#EDE9FE" }]}>
                <BookOpen size={15} color="#7C3AED" />
              </View>
              <Text style={gr.cardTitle}>최근 수업 피드백</Text>
            </View>
            <View style={{ gap: 10 }}>
              {recent_diaries.map((d, idx) => (
                <View key={idx} style={gr.diaryItem}>
                  <Text style={gr.diaryDate}>{fmtDate(d.lesson_date)} · {d.teacher_name} 선생님</Text>
                  <Text style={gr.diaryContent} numberOfLines={3}>
                    {d.student_note || d.common_content}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── 공유 버튼 ── */}
        <Pressable style={gr.shareBtn} onPress={handleShare}>
          <Share2 size={16} color="#fff" />
          <Text style={gr.shareBtnText}>카카오톡으로 공유하기</Text>
        </Pressable>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>
    </View>
  );
}

const gr = StyleSheet.create({
  root:        { flex: 1, backgroundColor: C.background },
  topBar:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  backBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  topTitle:    { fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },
  topSub:      { fontSize: 11, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginTop: 1 },
  shareTopBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#EBF5FB", borderWidth: 1, borderColor: "#B8DCF0" },
  shareTopText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: "#4EA7D8" },

  scroll: { paddingHorizontal: 16, gap: 12, paddingTop: 4 },

  summaryRow:  { flexDirection: "row", gap: 8 },
  summaryChip: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center", gap: 3 },
  summaryVal:  { fontSize: 16, fontFamily: "Pretendard-Regular" },
  summaryKey:  { fontSize: 10, fontFamily: "Pretendard-Regular" },

  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader:  { flexDirection: "row", alignItems: "center", gap: 8 },
  cardIconBg:  { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cardTitle:   { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },

  barsRow:     { flexDirection: "row", justifyContent: "space-around", alignItems: "flex-end", gap: 8, paddingHorizontal: 8 },
  barCol:      { alignItems: "center", gap: 4, flex: 1 },
  barPct:      { fontSize: 11, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  barTrack:    { width: "100%", maxWidth: 36, height: 60, backgroundColor: "#F3F4F6", borderRadius: 6, justifyContent: "flex-end", overflow: "hidden" },
  barFill:     { width: "100%", borderRadius: 6 },
  barLabel:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.text },
  barSub:      { fontSize: 10, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  legendRow:   { flexDirection: "row", alignItems: "center" },
  legendDot:   { width: 8, height: 8, borderRadius: 4 },
  legendText:  { fontSize: 10, color: C.textSecondary, fontFamily: "Pretendard-Regular", marginLeft: 4 },

  upBadge:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "#DCFCE7" },
  upBadgeText: { fontSize: 11, color: "#16A34A", fontFamily: "Pretendard-Regular" },

  timeline:    { gap: 0 },
  tlRow:       { flexDirection: "row", gap: 12 },
  tlLeft:      { alignItems: "center", width: 16 },
  tlDot:       { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  tlLine:      { width: 2, flex: 1, backgroundColor: C.border, marginVertical: 2 },
  tlRight:     { flex: 1, paddingBottom: 16, gap: 4 },
  tlTopRow:    { flexDirection: "row", alignItems: "center", gap: 8 },
  levelBadge:  { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  levelBadgeText: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  currentBadge:   { backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  currentBadgeText:{ fontSize: 10, color: "#16A34A", fontFamily: "Pretendard-Regular" },
  tlDate:      { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  tlNote:      { fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 18 },

  diaryItem:   { backgroundColor: "#F9FAFB", borderRadius: 10, padding: 12, gap: 5 },
  diaryDate:   { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },
  diaryContent:{ fontSize: 13, color: C.text, fontFamily: "Pretendard-Regular", lineHeight: 19 },

  shareBtn:    {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#4EA7D8", borderRadius: 14, height: 50, marginTop: 4,
  },
  shareBtnText:{ fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
});
