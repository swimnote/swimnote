/**
 * (parent)/growth-report-questions.tsx — GR4: Growth Report 학부모 질문 화면
 *
 * - ENGINE이 생성한 질문 표시 (APP은 질문 창작 금지)
 * - SINGLE_CHOICE / MULTI_CHOICE 선택 UI
 * - 부분 저장 (partial save) + 완료 버튼
 * - CLOSED 상태 → read-only
 * - optional 안내 카피 (GR4 spec §20)
 * - 기존 저장 답변 hydrate
 */
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { LucideIcon } from "@/components/common/LucideIcon";
import { apiRequest, useAuth } from "@/context/AuthContext";

const C = Colors.light;

// ── 타입 ───────────────────────────────────────────────────────────────────────

type AnswerType = "SINGLE_CHOICE" | "MULTI_CHOICE";

interface Option {
  value: string;
  label?: string;
}

interface Question {
  question_id:                 string;
  engine_question_id:          string;
  metric_id:                   string;
  question_text:               string;
  answer_type:                 AnswerType;
  options:                     Option[];
  parent_confirmable_behavior: string | null;
  question_stage:              string | null;
  sequence:                    number;
  is_required:                 boolean;
  existing_answer:             string[];
  answered_at:                 string | null;
}

interface QuestionsResponse {
  success:             boolean;
  report_id:           string;
  product_status:      string;
  parent_input_status: string;
  parent_input_open_at:  string | null;
  parent_input_close_at: string | null;
  total_questions:     number;
  answered_questions:  number;
  questions:           Question[];
}

// ── 날짜 포맷 ──────────────────────────────────────────────────────────────────

function fmtDeadline(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일까지`;
}

// ── 옵션 label 추출 ────────────────────────────────────────────────────────────

function getOptionLabel(opt: Option): string {
  return opt.label ?? opt.value;
}

// ── OptionRow ──────────────────────────────────────────────────────────────────

function OptionRow({
  opt,
  selected,
  answerType,
  disabled,
  onToggle,
}: {
  opt: Option;
  selected: boolean;
  answerType: AnswerType;
  disabled: boolean;
  onToggle: () => void;
}) {
  const isRadio = answerType === "SINGLE_CHOICE";

  return (
    <Pressable
      style={[
        s.optRow,
        selected && s.optRowSelected,
        disabled && s.optRowDisabled,
      ]}
      onPress={disabled ? undefined : onToggle}
      disabled={disabled}
    >
      <View style={[s.optCheck, selected && s.optCheckSelected]}>
        {selected && (
          <LucideIcon
            name={isRadio ? "circle" : "check"}
            size={isRadio ? 8 : 10}
            color="#fff"
          />
        )}
      </View>
      <Text style={[s.optLabel, disabled && s.optLabelDisabled]}>
        {getOptionLabel(opt)}
      </Text>
    </Pressable>
  );
}

// ── QuestionCard ───────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  selectedValues,
  disabled,
  onChange,
}: {
  question:      Question;
  selectedValues: string[];
  disabled:      boolean;
  onChange:      (values: string[]) => void;
}) {
  function toggleOption(val: string) {
    if (question.answer_type === "SINGLE_CHOICE") {
      // radio: 이미 선택된 값 re-select → 유지 (deselect 하려면 빈 배열)
      onChange(selectedValues[0] === val ? [] : [val]);
    } else {
      // checkbox: toggle
      if (selectedValues.includes(val)) {
        onChange(selectedValues.filter((v) => v !== val));
      } else {
        onChange([...selectedValues, val]);
      }
    }
  }

  const normalizedOptions: Option[] = (question.options ?? []).map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );

  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.seqBadge}>
          <Text style={s.seqText}>{question.sequence}</Text>
        </View>
        <Text style={s.questionText}>{question.question_text}</Text>
      </View>

      {question.parent_confirmable_behavior ? (
        <Text style={s.behaviorHint}>{question.parent_confirmable_behavior}</Text>
      ) : null}

      <View style={s.optList}>
        {normalizedOptions.map((opt) => (
          <OptionRow
            key={opt.value}
            opt={opt}
            selected={selectedValues.includes(opt.value)}
            answerType={question.answer_type}
            disabled={disabled}
            onToggle={() => toggleOption(opt.value)}
          />
        ))}
      </View>

      {question.answer_type === "MULTI_CHOICE" && !disabled && (
        <Text style={s.multiHint}>복수 선택 가능</Text>
      )}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════════════════

export default function GrowthReportQuestionsScreen() {
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = params.reportId ?? "";

  const [data,    setData]    = useState<QuestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // 로컬 선택 상태 map: question_id → string[]
  const [localAnswers, setLocalAnswers] = useState<Record<string, string[]>>({});

  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [completing,  setCompleting]  = useState(false);

  const isReadOnly = data?.parent_input_status === "CLOSED";

  const PT = insets.top + (Platform.OS === "web" ? 67 : 12);

  // ── 데이터 로드 ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!reportId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const r = await apiRequest(token, `/parent/growth-reports/${reportId}/questions`);
      if (r.ok) {
        const d: QuestionsResponse = await r.json();
        setData(d);
        // hydrate 기존 답변
        const init: Record<string, string[]> = {};
        for (const q of d.questions) {
          init[q.question_id] = q.existing_answer ?? [];
        }
        setLocalAnswers(init);
      } else {
        const body = await r.json().catch(() => ({}));
        setError(body?.message ?? "질문을 불러올 수 없습니다.");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }
    setLoading(false);
  }, [reportId, token]);

  useEffect(() => { load(); }, [load]);

  // ── 부분 저장 ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!data || saving || isReadOnly) return;

    const answersPayload = Object.entries(localAnswers)
      .filter(([, vals]) => vals.length > 0)
      .map(([question_id, selected_values]) => ({ question_id, selected_values }));

    if (answersPayload.length === 0) {
      Alert.alert("안내", "선택한 답변이 없습니다.");
      return;
    }

    setSaving(true); setSaveError(null);
    try {
      const r = await apiRequest(
        token,
        `/parent/growth-reports/${reportId}/answers`,
        { method: "PUT", body: JSON.stringify({ answers: answersPayload }) },
      );
      if (r.ok) {
        // 저장 성공 — 서버 상태 재로드
        await load();
        Alert.alert("저장 완료", "답변이 저장되었습니다.");
      } else {
        const body = await r.json().catch(() => ({}));
        setSaveError(body?.message ?? "저장에 실패했습니다.");
      }
    } catch {
      setSaveError("네트워크 오류가 발생했습니다.");
    }
    setSaving(false);
  }

  // ── 완료 ─────────────────────────────────────────────────────────────────────

  async function handleComplete() {
    if (!data || completing || isReadOnly) return;

    Alert.alert(
      "답변 완료",
      "답변을 완료하시겠습니까?\n완료 후에는 답변을 수정할 수 없습니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "완료",
          onPress: async () => {
            setCompleting(true); setSaveError(null);
            try {
              // 1. 로컬 변경사항 먼저 저장 시도
              const answersPayload = Object.entries(localAnswers)
                .filter(([, vals]) => vals.length > 0)
                .map(([question_id, selected_values]) => ({ question_id, selected_values }));

              if (answersPayload.length > 0) {
                const saveRes = await apiRequest(
                  token,
                  `/parent/growth-reports/${reportId}/answers`,
                  { method: "PUT", body: JSON.stringify({ answers: answersPayload }) },
                );
                if (!saveRes.ok) {
                  const body = await saveRes.json().catch(() => ({}));
                  setSaveError(body?.message ?? "저장에 실패했습니다.");
                  setCompleting(false);
                  return;
                }
              }

              // 2. complete 액션
              const r = await apiRequest(
                token,
                `/parent/growth-reports/${reportId}/complete`,
                { method: "POST", body: JSON.stringify({}) },
              );
              if (r.ok) {
                Alert.alert(
                  "완료",
                  "답변이 완료되었습니다.\n성장 리포트 분석이 시작됩니다.",
                  [{ text: "확인", onPress: () => router.back() }],
                );
              } else {
                const body = await r.json().catch(() => ({}));
                setSaveError(body?.message ?? "완료 처리에 실패했습니다.");
              }
            } catch {
              setSaveError("네트워크 오류가 발생했습니다.");
            }
            setCompleting(false);
          },
        },
      ],
    );
  }

  // ── 렌더링 ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: PT }]}>
        <TopBar onBack={() => router.back()} title="성장 리포트 질문" />
        <ActivityIndicator color={C.tint} style={{ marginTop: 80 }} size="large" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[s.root, { paddingTop: PT }]}>
        <TopBar onBack={() => router.back()} title="성장 리포트 질문" />
        <View style={s.centerBox}>
          <LucideIcon name="alert-circle" size={36} color={C.textMuted} />
          <Text style={s.errorText}>{error ?? "데이터를 불러올 수 없습니다."}</Text>
          <Pressable style={s.retryBtn} onPress={load}>
            <Text style={s.retryBtnText}>다시 시도</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const deadline = fmtDeadline(data.parent_input_close_at);
  const canComplete = data.product_status === "QUESTION_AVAILABLE" && !isReadOnly;

  return (
    <View style={[s.root, { paddingTop: PT }]}>
      <TopBar onBack={() => router.back()} title="성장 리포트 질문" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 안내 배너 ── */}
        <View style={[s.infoBanner, isReadOnly && s.infoBannerClosed]}>
          <LucideIcon
            name={isReadOnly ? "lock" : "help-circle"}
            size={16}
            color={isReadOnly ? C.textMuted : C.tint}
          />
          <View style={{ flex: 1, gap: 2 }}>
            {isReadOnly ? (
              <Text style={s.infoText}>답변 기간이 종료되었습니다.</Text>
            ) : (
              <>
                <Text style={s.infoText}>
                  수영장에서 확인된 성장 모습을 가정에서의 모습과 함께 살펴보기 위한 선택 질문입니다.
                </Text>
                <Text style={s.infoHint}>
                  답변하지 않아도 성장리포트는 정상적으로 제공됩니다.
                </Text>
                {deadline ? (
                  <Text style={s.infoDeadline}>📅 답변 기간: {deadline}</Text>
                ) : null}
              </>
            )}
          </View>
        </View>

        {/* ── 진행 상태 ── */}
        {data.total_questions > 0 && (
          <View style={s.progressRow}>
            <Text style={s.progressText}>
              {data.answered_questions} / {data.total_questions} 질문 답변
            </Text>
            <View style={s.progressBar}>
              <View
                style={[
                  s.progressFill,
                  {
                    width: `${data.total_questions > 0
                      ? Math.round((data.answered_questions / data.total_questions) * 100)
                      : 0}%`,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* ── 질문 없는 경우 ── */}
        {data.questions.length === 0 && (
          <View style={s.centerBox}>
            <LucideIcon name="check-circle" size={36} color="#2E9B6F" />
            <Text style={s.emptyText}>등록된 질문이 없습니다.</Text>
          </View>
        )}

        {/* ── 질문 목록 ── */}
        {data.questions.map((q) => (
          <QuestionCard
            key={q.question_id}
            question={q}
            selectedValues={localAnswers[q.question_id] ?? []}
            disabled={isReadOnly}
            onChange={(vals) =>
              setLocalAnswers((prev) => ({ ...prev, [q.question_id]: vals }))
            }
          />
        ))}

        {/* ── 오류 메시지 ── */}
        {saveError ? (
          <View style={s.saveErrBanner}>
            <LucideIcon name="alert-triangle" size={14} color="#B91C1C" />
            <Text style={s.saveErrText}>{saveError}</Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── 하단 버튼 ── */}
      {!isReadOnly && data.questions.length > 0 && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          {/* 부분 저장 */}
          <Pressable
            style={[s.saveBtn, saving && s.btnDisabled]}
            onPress={handleSave}
            disabled={saving || completing}
          >
            {saving ? (
              <ActivityIndicator size="small" color={C.tint} />
            ) : (
              <Text style={s.saveBtnText}>답변 저장</Text>
            )}
          </Pressable>

          {/* 완료 — QUESTION_AVAILABLE일 때만 */}
          {canComplete && (
            <Pressable
              style={[s.completeBtn, completing && s.btnDisabled]}
              onPress={handleComplete}
              disabled={saving || completing}
            >
              {completing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={s.completeBtnText}>답변 완료</Text>
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────────

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={s.topBar}>
      <Pressable style={s.backBtn} onPress={onBack}>
        <LucideIcon name="chevron-left" size={22} color={C.text} />
      </Pressable>
      <Text style={s.topTitle}>{title}</Text>
    </View>
  );
}

// ── StyleSheet ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.background },
  topBar:  { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  topTitle:{ fontSize: 17, fontFamily: "Pretendard-Regular", color: C.text },

  scroll: { paddingHorizontal: 16, gap: 14, paddingTop: 8 },

  // 안내 배너
  infoBanner: {
    flexDirection: "row", gap: 10, alignItems: "flex-start",
    backgroundColor: C.tintLight, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  infoBannerClosed: { backgroundColor: "#F3F4F6", borderColor: C.border },
  infoText:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 20 },
  infoHint:     { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },
  infoDeadline: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.tint, lineHeight: 18, marginTop: 2 },

  // 진행 상태
  progressRow: { gap: 6 },
  progressText:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, textAlign: "right" },
  progressBar: { height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, overflow: "hidden" },
  progressFill:{ height: 4, backgroundColor: C.tint, borderRadius: 2 },

  // 카드
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader:   { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  seqBadge:     { width: 24, height: 24, borderRadius: 12, backgroundColor: C.tintLight, alignItems: "center", justifyContent: "center" },
  seqText:      { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.tint },
  questionText: { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, lineHeight: 22 },
  behaviorHint: { fontSize: 12, color: C.textSecondary, fontFamily: "Pretendard-Regular", lineHeight: 18, paddingHorizontal: 4 },
  multiHint:    { fontSize: 11, color: C.textMuted, fontFamily: "Pretendard-Regular" },

  // 옵션
  optList:    { gap: 8 },
  optRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: C.background,
  },
  optRowSelected: { borderColor: C.tint, backgroundColor: C.tintLight },
  optRowDisabled: { opacity: 0.55 },
  optCheck: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.background,
  },
  optCheckSelected: { backgroundColor: C.tint, borderColor: C.tint },
  optLabel:         { flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  optLabelDisabled: { color: C.textSecondary },

  // 오류
  saveErrBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#FECACA",
  },
  saveErrText:   { flex: 1, fontSize: 13, color: "#B91C1C", fontFamily: "Pretendard-Regular" },

  // 빈 상태
  centerBox:  { alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 48 },
  emptyText:  { fontSize: 15, color: C.textSecondary, fontFamily: "Pretendard-Regular" },
  errorText:  { fontSize: 15, color: C.textSecondary, fontFamily: "Pretendard-Regular" },
  retryBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primaryAction },
  retryBtnText:{ fontSize: 14, color: "#fff", fontFamily: "Pretendard-Regular" },

  // 하단 버튼
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", gap: 10,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.background,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  saveBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.background,
  },
  saveBtnText:    { fontSize: 15, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  completeBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.primaryAction,
  },
  completeBtnText: { fontSize: 15, fontFamily: "Pretendard-Regular", color: "#fff" },
  btnDisabled: { opacity: 0.5 },
});
