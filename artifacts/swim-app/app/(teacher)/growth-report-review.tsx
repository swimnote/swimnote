/**
 * (teacher)/growth-report-review.tsx — GR5: Teacher Review + Approval Screen
 *
 * - REVIEW_REQUIRED 상태 리포트 검토
 * - ENGINE 결과 표시 (summary, metrics — APP이 재해석 금지)
 * - APPROVE → REVIEW_REQUIRED → APPROVED
 * - REQUEST_REANALYSIS → reason_code 선택 + optional note
 * - loop protection: max_reanalysis 초과 시 재분석 버튼 비활성
 * - 자유 편집 금지 (spec §10)
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────────────────────

type ReviewAction = "APPROVE" | "REQUEST_REANALYSIS";

type ReasonCode =
  | "WRONG_CONTEXT"
  | "STUDENT_ATTRIBUTION_CONCERN"
  | "INSUFFICIENT_CONTEXT"
  | "PARENT_VISIBILITY_CONCERN"
  | "TECHNICAL_FACT_CONCERN"
  | "OTHER";

const REASON_CODE_LABELS: Record<ReasonCode, string> = {
  WRONG_CONTEXT:               "수업 맥락 불일치",
  STUDENT_ATTRIBUTION_CONCERN: "학생 귀속 의문",
  INSUFFICIENT_CONTEXT:        "근거 부족",
  PARENT_VISIBILITY_CONCERN:   "학부모 공개 우려",
  TECHNICAL_FACT_CONCERN:      "기술적 사실 오류",
  OTHER:                       "기타",
};

const REASON_CODES = Object.keys(REASON_CODE_LABELS) as ReasonCode[];

interface ReviewData {
  report_id:            string;
  product_status:       string;
  analysis_status:      string | null;
  report_period:        string | null;
  student:              { id: string; name: string | null };
  report_content:       any;
  sns_summary:          any;
  selected_metrics:     any;
  positive_growth_signals:  any;
  success_conditions:       any;
  support_levers:           any;
  next_growth_targets:      any;
  next_observation_targets: any;
  grounding_result:     any;
  limitations:          any;
  teacher_reviewed_by:      string | null;
  teacher_reviewed_at:      string | null;
  teacher_review_action:    string | null;
  teacher_review_reason_code: string | null;
  teacher_review_note:      string | null;
  teacher_reanalysis_count: number;
  max_reanalysis:           number;
}

// ── 화면 ───────────────────────────────────────────────────────────────────────

export default function GrowthReportReviewScreen() {
  const { reportId } = useLocalSearchParams<{ reportId: string }>();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();

  const [loading, setLoading]     = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData]           = useState<ReviewData | null>(null);

  // Action state
  const [action, setAction]     = useState<ReviewAction | null>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [note, setNote]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Load review data ────────────────────────────────────────────────────────

  const loadReview = useCallback(async () => {
    if (!token || !reportId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiRequest(
        token,
        `/teacher/growth-reports/${reportId}/review`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = await res.json();
      setData(body);
    } catch (e: any) {
      setLoadError(e.message ?? "네트워크 오류");
    } finally {
      setLoading(false);
    }
  }, [token, reportId]);

  useEffect(() => { loadReview(); }, [loadReview]);

  // ── Submit review action ────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!token || !reportId || !action) return;
    if (action === "REQUEST_REANALYSIS" && !reasonCode) {
      Alert.alert("재분석 이유를 선택해주세요.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiRequest(
        token,
        `/teacher/growth-reports/${reportId}/review`,
        {
          method: "POST",
          body:   JSON.stringify({
            action,
            reason_code: action === "REQUEST_REANALYSIS" ? reasonCode : undefined,
            note:        note.trim() || undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      // 성공 → 이전 화면으로
      Alert.alert(
        action === "APPROVE" ? "승인 완료" : "재분석 요청 완료",
        action === "APPROVE"
          ? "리포트가 APPROVED 상태로 변경되었습니다."
          : "재분석이 요청되었습니다. GR3 분석 엔진이 처리합니다.",
        [{ text: "확인", onPress: () => router.back() }],
      );
    } catch (e: any) {
      setSubmitError(e.message ?? "네트워크 오류");
    } finally {
      setSubmitting(false);
    }
  }, [token, reportId, action, reasonCode, note]);

  // ── Loading / Error ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.primaryAction} />
        <Text style={styles.loadingText}>리포트 불러오는 중…</Text>
      </View>
    );
  }

  if (loadError || !data) {
    return (
      <View style={styles.center}>
        <LucideIcon name="alert-triangle" size={32} color={C.error} />
        <Text style={styles.errorText}>{loadError ?? "데이터를 불러올 수 없습니다."}</Text>
        <Pressable onPress={loadReview} style={styles.retryBtn}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  const isReviewEligible   = data.product_status === "REVIEW_REQUIRED";
  const reanalysisExhausted = data.teacher_reanalysis_count >= data.max_reanalysis;
  const alreadyReviewed    = !!data.teacher_review_action && !isReviewEligible;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <LucideIcon name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          리포트 검토 — {data.student.name ?? data.student.id}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status badge */}
        <View style={styles.statusRow}>
          <View style={[styles.badge, badgeStyle(data.product_status)]}>
            <Text style={styles.badgeText}>{data.product_status}</Text>
          </View>
          {data.report_period && (
            <Text style={styles.periodText}>{data.report_period} 리포트</Text>
          )}
        </View>

        {/* Already reviewed notice */}
        {alreadyReviewed && (
          <View style={styles.noticeBox}>
            <LucideIcon name="check-circle" size={16} color={C.success} />
            <Text style={styles.noticeText}>
              검토 완료: {data.teacher_review_action}
              {data.teacher_review_reason_code ? ` (${data.teacher_review_reason_code})` : ""}
            </Text>
          </View>
        )}

        {/* SNS Summary */}
        {data.sns_summary && (
          <Section title="SNS 요약">
            <Text style={styles.bodyText}>
              {typeof data.sns_summary === "string"
                ? data.sns_summary
                : data.sns_summary?.headline ?? JSON.stringify(data.sns_summary)}
            </Text>
          </Section>
        )}

        {/* Report Content */}
        {data.report_content && (
          <Section title="리포트 내용 (ENGINE 생성)">
            <View style={styles.contentNote}>
              <LucideIcon name="lock" size={12} color={C.textSecondary} />
              <Text style={styles.contentNoteText}>
                내용 직접 수정 불가 (APPROVE 또는 재분석 요청만 가능)
              </Text>
            </View>
            <Text style={styles.bodyText}>
              {typeof data.report_content === "string"
                ? data.report_content
                : JSON.stringify(data.report_content, null, 2)}
            </Text>
          </Section>
        )}

        {/* Grounding / Limitations */}
        {data.limitations && (
          <Section title="분석 한계">
            <Text style={styles.bodyText}>
              {typeof data.limitations === "string"
                ? data.limitations
                : JSON.stringify(data.limitations, null, 2)}
            </Text>
          </Section>
        )}

        {/* Reanalysis count */}
        {data.teacher_reanalysis_count > 0 && (
          <View style={styles.reanalysisInfo}>
            <Text style={styles.reanalysisInfoText}>
              재분석 요청 횟수: {data.teacher_reanalysis_count} / {data.max_reanalysis}
            </Text>
          </View>
        )}

        {/* Review actions — only for REVIEW_REQUIRED */}
        {isReviewEligible && (
          <Section title="검토 액션">
            {/* Action selector */}
            <View style={styles.actionRow}>
              <ActionButton
                label="✅ 승인"
                sublabel="APPROVE"
                selected={action === "APPROVE"}
                onPress={() => { setAction("APPROVE"); setReasonCode(null); }}
              />
              <ActionButton
                label="🔄 재분석 요청"
                sublabel="REQUEST_REANALYSIS"
                selected={action === "REQUEST_REANALYSIS"}
                disabled={reanalysisExhausted}
                onPress={() => setAction("REQUEST_REANALYSIS")}
              />
            </View>

            {reanalysisExhausted && (
              <Text style={styles.exhaustedText}>
                재분석 최대 횟수({data.max_reanalysis}회)에 도달했습니다.
              </Text>
            )}

            {/* Reason code — REQUEST_REANALYSIS only */}
            {action === "REQUEST_REANALYSIS" && (
              <>
                <Text style={styles.sectionLabel}>재분석 이유 (필수 권장)</Text>
                {REASON_CODES.map((code) => (
                  <Pressable
                    key={code}
                    style={[
                      styles.reasonItem,
                      reasonCode === code && styles.reasonItemSelected,
                    ]}
                    onPress={() => setReasonCode(code)}
                  >
                    <View style={[
                      styles.radioCircle,
                      reasonCode === code && styles.radioCircleSelected,
                    ]} />
                    <Text style={styles.reasonLabel}>
                      {REASON_CODE_LABELS[code]}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Optional note */}
            {action && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>
                  메모 (선택)
                </Text>
                <TextInput
                  style={styles.noteInput}
                  placeholder="선생님 메모를 남겨주세요 (선택)"
                  placeholderTextColor={C.textSecondary}
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={500}
                />
              </>
            )}

            {/* Submit error */}
            {submitError && (
              <View style={styles.errorRow}>
                <LucideIcon name="alert-circle" size={14} color={C.error} />
                <Text style={styles.submitErrorText}>{submitError}</Text>
              </View>
            )}

            {/* Submit button */}
            <Pressable
              style={[
                styles.submitBtn,
                (!action || submitting) && styles.submitBtnDisabled,
              ]}
              disabled={!action || submitting}
              onPress={handleSubmit}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>
                  {action === "APPROVE" ? "승인 완료" : "재분석 요청"}
                </Text>
              )}
            </Pressable>
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ActionButton({
  label,
  sublabel,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  sublabel: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.actionBtn,
        selected && styles.actionBtnSelected,
        disabled && styles.actionBtnDisabled,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.actionBtnLabel, selected && styles.actionBtnLabelSelected]}>
        {label}
      </Text>
      <Text style={styles.actionBtnSublabel}>{sublabel}</Text>
    </Pressable>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function badgeStyle(status: string) {
  if (status === "REVIEW_REQUIRED") return { backgroundColor: "#FFF3CD" };
  if (status === "APPROVED")        return { backgroundColor: "#D4EDDA" };
  if (status === "ANALYZING")       return { backgroundColor: "#CCE5FF" };
  return { backgroundColor: "#E2E3E5" };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:            { flex: 1, backgroundColor: "#F8F9FA" },
  center:          { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  loadingText:     { marginTop: 12, fontSize: 14, color: C.textSecondary },
  errorText:       { marginTop: 8, fontSize: 14, color: C.error, textAlign: "center" },
  retryBtn:        { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primaryAction, borderRadius: 8 },
  retryText:       { color: "#fff", fontWeight: "600" },

  header:          {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: "#E9ECEF",
  },
  backBtn:         { width: 38, height: 38, justifyContent: "center" },
  headerTitle:     { flex: 1, fontSize: 16, fontWeight: "700", color: C.text, textAlign: "center" },

  scroll:          { flex: 1 },
  scrollContent:   { padding: 16, gap: 12 },

  statusRow:       { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  badge:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText:       { fontSize: 11, fontWeight: "700", color: C.text },
  periodText:      { fontSize: 13, color: C.textSecondary },

  noticeBox:       {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#D4EDDA", borderRadius: 8, padding: 10,
  },
  noticeText:      { flex: 1, fontSize: 13, color: "#155724" },

  section:         {
    backgroundColor: "#fff", borderRadius: 12, padding: 16,
    ...Platform.select({
      ios:     { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3 },
      android: { elevation: 1 },
    }),
  },
  sectionTitle:    { fontSize: 14, fontWeight: "700", color: C.text, marginBottom: 10 },
  sectionLabel:    { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 6 },

  bodyText:        { fontSize: 13, color: C.text, lineHeight: 20 },
  contentNote:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  contentNoteText: { fontSize: 11, color: C.textSecondary, flex: 1 },

  reanalysisInfo:  { backgroundColor: "#FFF3CD", borderRadius: 8, padding: 10 },
  reanalysisInfoText: { fontSize: 12, color: "#856404" },
  exhaustedText:   { fontSize: 12, color: C.error, marginTop: 4 },

  actionRow:       { flexDirection: "row", gap: 10, marginBottom: 16 },
  actionBtn:       {
    flex: 1, borderRadius: 10, borderWidth: 1.5,
    borderColor: "#CED4DA", padding: 12, alignItems: "center",
    backgroundColor: "#fff",
  },
  actionBtnSelected:  { borderColor: C.primaryAction, backgroundColor: C.brandMist },
  actionBtnDisabled:  { opacity: 0.4 },
  actionBtnLabel:     { fontSize: 14, fontWeight: "700", color: C.text },
  actionBtnLabelSelected: { color: C.primaryAction },
  actionBtnSublabel:  { fontSize: 10, color: C.textSecondary, marginTop: 2 },

  reasonItem:      {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: "#F0F0F0",
  },
  reasonItemSelected: { backgroundColor: "#F0F4FF" },
  radioCircle:     {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: "#CED4DA", backgroundColor: "#fff",
  },
  radioCircleSelected: { borderColor: C.primaryAction, backgroundColor: C.primaryAction },
  reasonLabel:     { flex: 1, fontSize: 13, color: C.text },

  noteInput:       {
    borderWidth: 1, borderColor: "#CED4DA", borderRadius: 8,
    padding: 10, minHeight: 80, fontSize: 13, color: C.text,
    textAlignVertical: "top", backgroundColor: "#FAFAFA",
  },

  errorRow:        { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  submitErrorText: { flex: 1, fontSize: 12, color: C.error },

  submitBtn:       {
    marginTop: 16, paddingVertical: 14,
    borderRadius: 10, backgroundColor: C.primaryAction,
    alignItems: "center",
  },
  submitBtnDisabled: { backgroundColor: "#CED4DA" },
  submitBtnText:   { color: "#fff", fontSize: 15, fontWeight: "700" },
});
