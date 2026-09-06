/**
 * (parent)/growth-report-paid.tsx
 *
 * AI 인사이트 전략 리포트 — Product Hub
 * Stage 5: real history API + state-based CTA + name normalization
 *
 * route: /(parent)/growth-report-paid
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { useParent } from "@/context/ParentContext";

const C    = Colors.light;
const NAVY = "#0C1A2E";
const MINT = "#10B981";
const MUTED = "#6B7280";
const NEUTRAL_BORDER = "#E2E6EA";

// ─────────────────────────────────────────────────────────────
// Types & Contract
// ─────────────────────────────────────────────────────────────

type InsightReadiness = {
  lessonDataReady: boolean;
  lessonDataCount?: number;
  basicInfo: { birthDate: boolean };
  parentObservation: { answered: number; total: number };
  preflightConfirmed: boolean;
};

type HubState =
  | "NOT_STARTED"
  | "PREPARING"
  | "READY"
  | "PAYMENT_REQUIRED"
  | "PAID"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED";

type InsightReport = {
  id: string;
  issuedAt: string;
  analysisPeriod: string;
  status: HubState;
};

// InsightReport는 paid-insight/history에서 가져옴

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return <Text style={s.sectionLabel}>{label}</Text>;
}

function Pill({ label }: { label: string }) {
  return (
    <View style={s.pill}>
      <Text style={s.pillTxt}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ReadinessRow — icon-based status
// ─────────────────────────────────────────────────────────────

function ReadinessRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: "done" | "partial" | "empty";
}) {
  const iconName = state === "done" ? "check-circle" : state === "partial" ? "circle-dot" : "circle";
  const iconColor = state === "done" ? MINT : state === "partial" ? "#F59E0B" : NEUTRAL_BORDER;
  const valueColor = state === "done" ? MINT : state === "partial" ? "#F59E0B" : MUTED;

  return (
    <View style={s.readinessRow}>
      <Text style={s.readinessLabel}>{label}</Text>
      <View style={s.readinessRight}>
        <LucideIcon name={iconName as any} size={13} color={iconColor} />
        <Text style={[s.readinessValue, { color: valueColor }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// InfoMenuItem
// ─────────────────────────────────────────────────────────────

function InfoMenuItem({
  icon,
  title,
  desc,
  state,
  onPress,
}: {
  icon: string;
  title: string;
  desc: string;
  state: "done" | "partial" | "empty";
  onPress: () => void;
}) {
  const dotColor = state === "done" ? MINT : state === "partial" ? "#F59E0B" : NEUTRAL_BORDER;
  return (
    <Pressable
      style={({ pressed }) => [s.infoItem, { opacity: pressed ? 0.7 : 1 }]}
      onPress={onPress}
    >
      <View style={s.infoIconBox}>
        <LucideIcon name={icon as any} size={16} color={NAVY} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.infoTitle}>{title}</Text>
        <Text style={s.infoDesc}>{desc}</Text>
      </View>
      <View style={[s.statusDot, { backgroundColor: dotColor }]} />
      <LucideIcon name="chevron-right" size={15} color={C.textMuted} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────
// PaidInsightCtaSection — 상태 기반 CTA (§10)
// A. 데이터 준비 중  B. 추가 정보 입력 필요
// C. 리포트 발급 준비 완료  D. 결제 시스템 준비 중
// ─────────────────────────────────────────────────────────────

function PaidInsightCtaSection({
  lessonDataReady,
  obsDone,
  obsTotal,
  onCheckReadiness,
}: {
  lessonDataReady: boolean;
  obsDone: number;
  obsTotal: number;
  onCheckReadiness: () => void;
}) {
  // A: 수업 데이터 없음
  if (!lessonDataReady) {
    return (
      <View style={s.ctaSection}>
        <View style={{ gap: 4 }}>
          <Text style={s.ctaStateLabel}>데이터 준비 중</Text>
          <Text style={s.ctaStateDesc}>수업 기록이 더 쌓이면 리포트를 만들 수 있어요.</Text>
        </View>
        <View style={[s.ctaBtn, { backgroundColor: NAVY + "40" }]}>
          <Text style={s.ctaBtnTxt}>수업 기록 필요</Text>
        </View>
      </View>
    );
  }

  // B: 수업 데이터 있고, 관찰정보 미완료
  if (obsTotal > 0 && obsDone < obsTotal) {
    return (
      <View style={s.ctaSection}>
        <View style={{ gap: 4 }}>
          <Text style={s.ctaStateLabel}>추가 정보 입력 필요</Text>
          <Text style={s.ctaStateDesc}>학부모 관찰정보를 입력하면 더 정확한 분석이 가능해요. ({obsDone}/{obsTotal}개 완료)</Text>
        </View>
        <Pressable style={s.ctaBtn} onPress={onCheckReadiness}>
          <Text style={s.ctaBtnTxt}>준비 상태 확인</Text>
        </Pressable>
      </View>
    );
  }

  // C: 발급 준비 완료 (수업 있고, 관찰정보 없거나 완료) → 결제 연결 전
  // D: 결제 시스템 준비 중 — 실제 Store 연결 전 상태
  return (
    <View style={s.ctaSection}>
      <View style={s.priceRow}>
        <Text style={s.priceName}>AI 인사이트 전략 리포트</Text>
        <Text style={s.priceAmount}>79,000원 · 1회</Text>
      </View>
      <View style={{ gap: 8 }}>
        <Pressable style={s.ctaBtn} onPress={onCheckReadiness}>
          <Text style={s.ctaBtnTxt}>발급 준비 확인</Text>
        </Pressable>
        <Text style={s.ctaPaymentNote}>결제 시스템 연동 준비 중 · 곧 이용 가능해요</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// BottomSheet wrapper
// ─────────────────────────────────────────────────────────────

function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.sheetOverlay} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={s.sheetHandle} />
        {children}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// ReportPreviewSheet
// ─────────────────────────────────────────────────────────────

const REPORT_SECTIONS = [
  "현재 성장 요약",
  "행동·학습 강점",
  "반복되는 성장 패턴",
  "잘 되는 조건",
  "집중·자기조절 및 학습 반응",
  "수영 기술 및 운동학습 진행",
  "수업 전략",
  "다음 성장 방향",
  "가정에서의 지원 방법",
];

function ReportPreviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <Text style={s.sheetTitle}>어떤 리포트가 나오나요?</Text>

        {/* 행동 추적 → 성장 방향 */}
        <View style={s.sheetValueBlock}>
          <Text style={s.sheetValueTitle}>
            행동을 추적해,{"\n"}성장의 방향까지 찾아냅니다
          </Text>
          <Text style={s.sheetValueBody}>
            AI 인사이트 전략 리포트는{"\n"}
            단순히 무엇을 잘했는지를 정리하지 않습니다.{"\n\n"}
            수업 속 행동과 변화의 흐름을 추적하여
          </Text>
          <View style={s.sheetBullets}>
            {[
              "어떤 방식으로 배우는지",
              "어떤 조건에서 더 잘 성장하는지",
              "어떤 부분이 반복해서 강점으로 나타나는지",
              "어떤 환경과 접근이 긍정적으로 작용하는지",
              "앞으로 무엇을 우선하면 더 좋은 성장으로 이어질지",
            ].map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={s.bulletDot} />
                <Text style={s.bulletTxt}>{b}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.sheetValueBody, { marginTop: 10 }]}>까지 연결해 보여줍니다.</Text>
        </View>

        {/* 수영은 분석의 재료 */}
        <View style={[s.sheetValueBlock, { marginTop: 10 }]}>
          <Text style={s.sheetValueTitle}>
            수영은 분석의 재료,{"\n"}리포트는 아이의 성장 전체를 봅니다
          </Text>
          <Text style={s.sheetValueBody}>
            수영 수업은 아이의 다양한 행동과 반응이 반복적으로 나타나는 환경입니다.{"\n\n"}
            새로운 과제를 받아들이는 방식, 집중이 유지되는 조건, 실패 이후 다시 적응하는 과정, 성공했을 때 나타나는 변화, 교사의 피드백에 반응하는 방식 등 수업 안에서 나타나는 여러 행동 단서를 지속적으로 관찰하고 추적할 수 있습니다.{"\n\n"}
            AI 인사이트 전략 리포트는 이러한 수영 수업 데이터를 분석 재료로 활용해
          </Text>
          <View style={s.sheetBullets}>
            {[
              "학습 방식",
              "집중과 자기조절",
              "자신감과 도전 반응",
              "회복과 적응",
              "운동학습",
              "신체협응",
              "학습태도",
              "성장 패턴",
            ].map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={s.bulletDot} />
                <Text style={s.bulletTxt}>{b}</Text>
              </View>
            ))}
          </View>
          <Text style={[s.sheetValueBody, { marginTop: 10 }]}>등 아이의 학습과 성장 전 영역을 함께 평가합니다.</Text>
        </View>

        {/* 8개 섹션 목록 */}
        <Text style={[s.sheetSubLabel, { marginTop: 20 }]}>리포트 구성</Text>
        {REPORT_SECTIONS.map((sec, i) => (
          <View key={i} style={s.previewRow}>
            <View style={s.previewDot} />
            <Text style={s.previewRowTxt}>{sec}</Text>
          </View>
        ))}

        {/* 분석 철학 */}
        <View style={s.sheetNote}>
          <Text style={s.sheetNoteTxt}>
            모든 항목을 억지로 채우는 방식이 아니라, 누적 데이터에서 근거가 확인되는 성장 신호를 선별해 깊이 있게 분석합니다.
          </Text>
        </View>

        {/* 분석 프로세스 step */}
        <Text style={[s.sheetSubLabel, { marginTop: 20 }]}>분석 방식</Text>
        <View style={s.stepList}>
          {[
            "전문 평가체계 참고",
            "약 330개 평가 후보항목",
            "수업 중 행동 단서 수집",
            "행동 단서 분해·추적",
            "누적 성장 패턴 분석",
            "학부모 관찰정보 결합",
            "SWIMNOTE AI 추론 + OpenAI GPT 활용 교차 검증",
            "성장 방향 인사이트 도출",
            "AI 인사이트 전략 리포트",
          ].map((step, i, arr) => (
            <View key={i} style={s.stepRow}>
              <View style={s.stepLeft}>
                <View style={[s.stepDot, i === arr.length - 1 && { backgroundColor: NAVY }]} />
                {i < arr.length - 1 && <View style={s.stepLine} />}
              </View>
              <Text style={[s.stepTxt, i === arr.length - 1 && { color: NAVY, fontWeight: "600" }]}>
                {step}
              </Text>
            </View>
          ))}
        </View>

        {/* 전문 평가체계 */}
        <View style={[s.sheetNote, { marginTop: 12 }]}>
          <Text style={[s.sheetNoteTxt, { fontWeight: "600", marginBottom: 6 }]}>
            전문 평가체계를 AI 분석으로 연결합니다
          </Text>
          <Text style={s.sheetNoteTxt}>
            AI 인사이트 전략 리포트는 아동·학습·행동·운동 분야에서 사용되는 전문적인 평가 지표와 관찰 기준을 참고합니다.{"\n\n"}
            SWIMNOTE AI는 실제 수업에서 나타나는 행동과 반응을 작은 단서 단위로 분해하고, 시간에 따라 반복되는 패턴과 변화를 추적합니다.{"\n\n"}
            여기에 학부모 관찰정보와 누적 성장 데이터를 결합하고, OpenAI GPT를 활용한 교차 검증 단계를 거쳐 아이에게 의미 있는 성장 인사이트를 정리합니다.
          </Text>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────
// PreflightSheet
// ─────────────────────────────────────────────────────────────

function PreflightSheet({
  visible,
  onClose,
  readiness,
}: {
  visible: boolean;
  onClose: () => void;
  readiness: InsightReadiness;
}) {
  const basicDone  = Object.values(readiness.basicInfo).filter(Boolean).length;
  const basicTotal = Object.keys(readiness.basicInfo).length;
  const obsDone    = readiness.parentObservation.answered;
  const obsTotal   = readiness.parentObservation.total;

  function CheckRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
    return (
      <View style={s.checkRow}>
        <LucideIcon name={ok ? "check-circle" : "circle"} size={14} color={ok ? MINT : NEUTRAL_BORDER} />
        <Text style={s.checkLabel}>{label}</Text>
        <Text style={[s.checkValue, { color: ok ? C.text : MUTED }]}>{value}</Text>
      </View>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={s.sheetTitle}>발급 전 확인</Text>
      <View style={s.preflightRows}>
        <CheckRow label="수업·성장 데이터" value={readiness.lessonDataReady ? "준비됨" : "데이터 없음"} ok={readiness.lessonDataReady} />
        <CheckRow label="아이 기본정보"    value={`${basicDone}/${basicTotal}`}                           ok={basicDone === basicTotal} />
        <CheckRow label="학부모 관찰정보"  value={obsTotal > 0 ? `${obsDone}/${obsTotal}` : "미입력"}     ok={obsDone > 0} />
      </View>
      <View style={s.preflightPrice}>
        <Text style={s.preflightProduct}>AI 인사이트 전략 리포트</Text>
        <Text style={s.preflightAmount}>79,000원 · 1회</Text>
      </View>
      <View style={s.ctaDisabled}>
        <Text style={s.ctaDisabledTxt}>발급 준비가 완료되었습니다</Text>
      </View>
      <Text style={s.ctaHint}>결제 시스템 연동 준비 중 · 곧 이용 가능해요</Text>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────

export default function InsightReportHub() {
  const insets   = useSafeAreaInsets();
  const { token } = useAuth();
  const { selectedStudent, students } = useParent();
  const params = useLocalSearchParams<{ studentId?: string }>();

  // Resolve target student: param > selectedStudent > first child
  const targetStudentId = params.studentId || selectedStudent?.id || students[0]?.id;

  // ── 실제 readiness 상태 (수업 데이터 유무) ──
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [lessonDataReady,  setLessonDataReady]  = useState(false);
  const [lessonDataCount,  setLessonDataCount]  = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!token || !targetStudentId) { setReadinessLoading(false); return; }
    apiRequest(token, `/parent/students/${targetStudentId}/growth-report-status`)
      .then(async r => {
        if (!r.ok) return;
        const d = await r.json();
        // NOT_AVAILABLE = 수업 데이터 없음; 그 외 = 데이터 존재
        const hasData = d.status && d.status !== "NOT_AVAILABLE";
        setLessonDataReady(hasData);
        // lesson_count if available in response
        if (typeof d.lesson_count === "number") setLessonDataCount(d.lesson_count);
      })
      .catch(() => {})
      .finally(() => setReadinessLoading(false));
  }, [token, targetStudentId]);

  // readiness: 실제 데이터 기반 (수업·생년월일) — 관찰정보는 질문 API에서 동적으로 결정
  const student = students.find(s => s.id === targetStudentId) ?? selectedStudent;
  const readiness: InsightReadiness = {
    lessonDataReady,
    lessonDataCount,
    basicInfo: {
      birthDate: !!(student?.birth_date),
    },
    parentObservation: { answered: 0, total: 0 }, // 질문 API에서 갱신
    preflightConfirmed: false,
  };

  // ── 실제 Paid Insight 이력 로드 ──────────────────────────────────────────
  const [reports,        setReports]        = useState<InsightReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  useEffect(() => {
    if (!token || !targetStudentId) return;
    setReportsLoading(true);
    apiRequest(token, `/parent/students/${targetStudentId}/paid-insight/history`)
      .then(async r => {
        if (!r.ok) return;
        const d = await r.json();
        const rows: InsightReport[] = (d.reports ?? []).map((row: any) => ({
          id:             row.report_id ?? row.id,
          issuedAt:       row.issued_at
            ? new Date(row.issued_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
            : "",
          analysisPeriod: row.analysis_period ?? "",
          status:         mapPaidInsightState(row.paid_insight_state ?? "NOT_STARTED"),
        }));
        setReports(rows);
      })
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  }, [token, targetStudentId]);

  function mapPaidInsightState(state: string): HubState {
    switch (state) {
      case "OPEN":                return "PREPARING";
      case "QUESTION_AVAILABLE":  return "PREPARING";
      case "READY_FOR_ANALYSIS":  return "READY";
      case "ANALYZING":           return "ANALYZING";
      case "REVIEW_REQUIRED":     return "ANALYZING";
      case "PUBLISHED":           return "COMPLETED";
      case "FAILED":              return "FAILED";
      default:                    return "NOT_STARTED";
    }
  }

  const [showPreview,     setShowPreview]     = useState(false);
  const [showPreflight,   setShowPreflight]   = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);

  const basicDone  = readiness.basicInfo.birthDate ? 1 : 0;
  const basicTotal = 1;
  const obsDone    = readiness.parentObservation.answered;
  const obsTotal   = readiness.parentObservation.total;

  function readinessState(ok: boolean, done?: number, total?: number): "done" | "partial" | "empty" {
    if (ok && done === undefined) return "done";
    if (done !== undefined && total !== undefined) {
      if (done === total && total > 0) return "done";
      if (done > 0) return "partial";
      return "empty";
    }
    return ok ? "done" : "empty";
  }

  const basicState = readinessState(false, basicDone, basicTotal);
  const obsState   = readinessState(false, obsDone, obsTotal > 0 ? obsTotal : undefined);

  const DATA_SOURCES = [
    "누적 수업 기록",
    "수영 교육과정 진행",
    "반복된 성장·변화 신호",
    "수업 중 성공 조건",
    "교사 관찰 내용",
    "학부모가 제공한 추가 정보",
    "이전 AI 인사이트 전략 리포트",
  ];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── 헤더 — 짧은 제목 ── */}
      <View style={[s.header, { backgroundColor: NAVY }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>인사이트 리포트</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── A. Hero ── */}
        <View style={[s.heroCard, { backgroundColor: NAVY }]}>
          <Text style={s.heroTitle}>AI 인사이트 전략 리포트</Text>
          <Text style={s.heroDesc}>
            수업 기록과 누적 성장 데이터,{"\n"}
            학부모가 제공한 관찰정보를 함께 분석해{"\n\n"}
            아이에게 반복해서 나타나는 행동 단서와{"\n"}
            배우는 방식, 잘 되는 조건, 변화의 흐름을 추적합니다.{"\n\n"}
            그 과정에서 성장에 긍정적으로 작용할 수 있는{"\n"}
            인사이트를 찾아{"\n"}
            현재보다 더 좋은 방향으로 성장할 수 있도록 돕습니다.
          </Text>

          {/* 핵심 카피 */}
          <View style={s.heroCopyBlock}>
            <Text style={s.heroCopy}>행동의 단서를 분해하고 추적해,{"\n"}더 나은 성장 방향을 찾아냅니다.</Text>
          </View>
          <Text style={s.heroSubCopy}>
            수영은 분석을 위한 재료를 찾는 과정입니다.{"\n"}리포트는 수영기술을 넘어 학습과 성장 전 영역을 함께 살펴봅니다.
          </Text>

          <View style={s.pillRow}>
            <Pill label="1회 심층 분석" />
            <Pill label="누적 데이터 기반" />
            <Pill label="여러 성장 영역 종합" />
            <Pill label="근거 있는 항목만" />
          </View>
        </View>

        {/* ── B. 분석 준비 ── */}
        <View style={s.section}>
          <SectionLabel label="분석 준비" />
          <View style={s.card}>
            <ReadinessRow label="수업·성장 데이터" value={readiness.lessonDataReady ? "준비됨" : "없음"} state={readiness.lessonDataReady ? "done" : "empty"} />
            <ReadinessRow label="아이 기본정보"    value={readiness.basicInfo.birthDate ? "확인됨" : "미확인"} state={basicState} />
            <ReadinessRow label="학부모 관찰정보"  value={obsTotal > 0 ? `${obsDone}/${obsTotal}개 답변` : "문항 없음"} state={obsTotal > 0 ? obsState : "done"} />
            <ReadinessRow label="발급 전 확인"     value={readiness.preflightConfirmed ? "완료" : "미완료"} state={readiness.preflightConfirmed ? "done" : "empty"} />
          </View>
          <Pressable style={s.outlineBtn} onPress={() => setShowPreflight(true)}>
            <Text style={s.outlineBtnTxt}>준비 상태 확인</Text>
            <LucideIcon name="chevron-right" size={14} color={NAVY} />
          </Pressable>
        </View>

        {/* ── C. 정보 준비 ── */}
        <View style={s.section}>
          <SectionLabel label="정보 준비" />
          <View style={s.card}>
            <InfoMenuItem
              icon="user"
              title="아이 기본정보"
              desc="분석에 참고할 기본 정보를 확인합니다."
              state={basicState}
              onPress={() => {}}
            />
            <View style={s.divider} />
            <InfoMenuItem
              icon="message-square"
              title="학부모 관찰정보"
              desc="수업 밖에서 보이는 아이의 변화와 특징을 보충합니다."
              state={obsTotal > 0 ? obsState : "done"}
              onPress={() => {}}
            />
          </View>
        </View>

        {/* ── D. 분석에 활용되는 정보 ── */}
        <View style={s.section}>
          <Pressable
            style={s.accordionHeader}
            onPress={() => setShowDataSources(v => !v)}
          >
            <Text style={s.accordionLabel}>분석에 활용되는 정보</Text>
            <LucideIcon name={showDataSources ? "chevron-up" : "chevron-down"} size={15} color={MUTED} />
          </Pressable>

          {showDataSources && (
            <View style={s.accordionBody}>
              {DATA_SOURCES.map((src, i) => (
                <View key={i} style={s.sourceRow}>
                  <View style={s.sourceDot} />
                  <Text style={s.sourceTxt}>{src}</Text>
                </View>
              ))}

              {/* 330개 평가항목 */}
              <View style={s.infoBox}>
                <Text style={s.infoBoxTitle}>330개 심층 평가항목</Text>
                <Text style={s.infoBoxBody}>
                  수영기술, 운동학습, 집중·자기조절, 학습태도, 자신감, 회복탄력성, 신체협응, 균형·운동능력 등 아이의 학습과 성장에 관련된 약 330개의 평가 후보항목을 폭넓게 살펴봅니다.
                </Text>
                <Text style={[s.infoBoxBody, { marginTop: 8, color: MUTED }]}>
                  모든 항목에 일괄적으로 점수를 매기는 방식이 아닙니다.{"\n\n"}수업에서 실제로 나타나는 행동 단서와 변화의 흐름을 분해하고 추적한 뒤, 아이에게 의미 있게 나타나는 영역을 선별하여 리포트에 반영합니다.
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* ── E. 리포트 구성 미리보기 ── */}
        <View style={[s.section, { paddingTop: 0 }]}>
          <Pressable style={s.previewCard} onPress={() => setShowPreview(true)}>
            <View style={{ flex: 1 }}>
              <Text style={s.previewCardTitle}>어떤 리포트가 나오나요?</Text>
              <Text style={s.previewCardSub}>
                성장 신호부터 다음 수업 전략까지{"\n"}어떤 방식으로 분석되는지 확인해보세요.
              </Text>
            </View>
            <LucideIcon name="chevron-right" size={18} color={NAVY} />
          </Pressable>
        </View>

        {/* ── F. 상태 기반 CTA (§10 A/B/C/D) ── */}
        <PaidInsightCtaSection
          lessonDataReady={readiness.lessonDataReady}
          obsDone={obsDone}
          obsTotal={obsTotal}
          onCheckReadiness={() => setShowPreflight(true)}
        />

        {/* ── G. 내 리포트 ── */}
        <View style={s.section}>
          <SectionLabel label="내 리포트" />
          {reportsLoading ? (
            <View style={s.emptyCard}>
              <ActivityIndicator size="small" color={NAVY} />
            </View>
          ) : reports.length === 0 ? (
            <View style={s.emptyCard}>
              <LucideIcon name="inbox" size={28} color={MUTED} />
              <Text style={s.emptyTxt}>
                아직 발급된 AI 인사이트 전략 리포트가 없습니다.
              </Text>
            </View>
          ) : (
            reports.map(r => (
              <View key={r.id} style={s.card}>
                <Text style={s.reportDate}>{r.issuedAt}</Text>
                <Text style={s.reportPeriod}>{r.analysisPeriod}</Text>
              </View>
            ))
          )}
        </View>

        {/* ── H. 지원 ── */}
        <View style={s.supportSection}>
          <Text style={s.supportLabel}>도움이 필요하신가요?</Text>
          <Text style={s.supportDesc}>결제 · 발급 · 리포트 문의</Text>
          <Pressable
            style={s.supportBtn}
            onPress={() => router.push("/(parent)/support-chat" as any)}
          >
            <Text style={s.supportBtnTxt}>문의하기</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ReportPreviewSheet visible={showPreview}   onClose={() => setShowPreview(false)} />
      <PreflightSheet     visible={showPreflight} onClose={() => setShowPreflight(false)} readiness={readiness} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: "#F8F9FB" },
  scroll: { flex: 1 },

  // Header
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 12 },
  backBtn:     { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "#fff" },

  // Hero
  heroCard:       { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 32 },
  heroTitle:      { fontSize: 22, fontFamily: "Pretendard-Regular", fontWeight: "700", color: "#fff", marginBottom: 14 },
  heroDesc:       { fontSize: 14, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.72)", lineHeight: 22, marginBottom: 20 },
  heroCopyBlock:  { borderLeftWidth: 2, borderLeftColor: "rgba(255,255,255,0.3)", paddingLeft: 14, marginBottom: 22 },
  heroCopy:       { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "rgba(255,255,255,0.92)", lineHeight: 24 },
  heroSubCopy:    { fontSize: 13, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.62)", lineHeight: 20, marginTop: 10 },
  pillRow:        { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pill:           { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  pillTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.85)" },

  // Section
  section:      { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 },

  // Card (neutral)
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: NEUTRAL_BORDER },

  // Readiness
  readinessRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NEUTRAL_BORDER },
  readinessLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  readinessRight: { flexDirection: "row", alignItems: "center", gap: 5 },
  readinessValue: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  outlineBtn:    { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 10, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: NAVY + "33" },
  outlineBtnTxt: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY },

  // Info items
  infoItem:   { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  infoIconBox:{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: NAVY + "0A", flexShrink: 0 },
  infoTitle:  { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600", color: C.text },
  infoDesc:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  divider:    { height: StyleSheet.hairlineWidth, backgroundColor: NEUTRAL_BORDER, marginHorizontal: 16 },

  // Accordion
  accordionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NEUTRAL_BORDER },
  accordionLabel:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED },
  accordionBody:   { paddingBottom: 8, gap: 8 },
  sourceRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceDot:       { width: 4, height: 4, borderRadius: 2, backgroundColor: MUTED },
  sourceTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // 330 info box
  infoBox:      { backgroundColor: "#fff", borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: NEUTRAL_BORDER, marginTop: 8 },
  infoBoxTitle: { fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY, marginBottom: 6 },
  infoBoxBody:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 18 },

  // Preview card
  previewCard:     { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 14, padding: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: NEUTRAL_BORDER, gap: 12 },
  previewCardTitle:{ fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY, marginBottom: 4 },
  previewCardSub:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, lineHeight: 18 },

  // Price / CTA
  ctaSection: { marginHorizontal: 20, marginTop: 20, backgroundColor: "#fff", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: NEUTRAL_BORDER, padding: 20, gap: 16 },
  priceRow:   { gap: 3 },
  priceName:  { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  priceAmount:{ fontSize: 20, fontFamily: "Pretendard-Regular", fontWeight: "700", color: NAVY },
  ctaBtn:         { backgroundColor: NAVY, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ctaBtnTxt:      { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "#fff" },
  ctaStateLabel:  { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY },
  ctaStateDesc:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED, lineHeight: 20 },
  ctaPaymentNote: { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, textAlign: "center" as const },

  // My reports
  emptyCard: { backgroundColor: "#fff", borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: NEUTRAL_BORDER, paddingVertical: 36, alignItems: "center", gap: 10 },
  emptyTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED },
  reportDate:{ fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text, padding: 16 },
  reportPeriod: { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED, paddingHorizontal: 16, paddingBottom: 16 },

  // Support
  supportSection: { marginHorizontal: 20, marginTop: 32, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: NEUTRAL_BORDER, paddingTop: 24, alignItems: "center", gap: 4 },
  supportLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  supportDesc:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  supportBtn:     { marginTop: 10, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: NEUTRAL_BORDER },
  supportBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED },

  // BottomSheet
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "82%", paddingHorizontal: 24, paddingTop: 8 },
  sheetHandle:  { width: 36, height: 4, backgroundColor: NEUTRAL_BORDER, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle:   { fontSize: 17, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY, marginBottom: 16 },
  sheetSubLabel:{ fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },

  // Preview sheet
  sheetValueBlock: { backgroundColor: "#F8F9FB", borderRadius: 12, padding: 16, marginBottom: 8 },
  sheetValueTitle: { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: NAVY, marginBottom: 10, lineHeight: 24 },
  sheetValueBody:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },
  sheetBullets:    { marginTop: 12, gap: 6 },
  bulletRow:       { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  bulletDot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: NAVY, marginTop: 6 },
  bulletTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },

  previewRow:    { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NEUTRAL_BORDER },
  previewDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: MINT, flexShrink: 0 },
  previewRowTxt: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },

  sheetNote:    { backgroundColor: "#F8F9FB", borderRadius: 12, padding: 14, marginTop: 12 },
  sheetNoteTxt: { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 19 },

  // Step UI
  stepList: { gap: 0, paddingLeft: 2 },
  stepRow:  { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepLeft: { alignItems: "center", width: 14, paddingTop: 3 },
  stepDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: NEUTRAL_BORDER },
  stepLine: { width: 1, flex: 1, minHeight: 24, backgroundColor: NEUTRAL_BORDER, marginVertical: 3 },
  stepTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, paddingBottom: 20, flex: 1 },

  // Preflight sheet
  preflightRows:   { gap: 0, marginBottom: 20 },
  checkRow:        { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: NEUTRAL_BORDER },
  checkLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  checkValue:      { fontSize: 13, fontFamily: "Pretendard-Regular" },
  preflightPrice:  { backgroundColor: "#F8F9FB", borderRadius: 12, padding: 16, gap: 4, marginBottom: 16 },
  preflightProduct:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  preflightAmount: { fontSize: 18, fontFamily: "Pretendard-Regular", fontWeight: "700", color: NAVY },
  ctaDisabled:     { backgroundColor: NEUTRAL_BORDER, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ctaDisabledTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: MUTED },
  ctaHint:         { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, textAlign: "center", marginTop: 8 },
});
