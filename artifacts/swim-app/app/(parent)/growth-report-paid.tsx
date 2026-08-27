/**
 * (parent)/growth-report-paid.tsx
 *
 * AI 인사이트 전략 리포트 — Product Hub
 * PHASE 1 UI Polish: Navy/White/Neutral, content reinforced
 *
 * route: /(parent)/growth-report-paid
 */

import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";

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
  basicInfo: { birthDate: boolean; height: boolean; weight: boolean };
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

// ─────────────────────────────────────────────────────────────
// PHASE 1 Fixture
// ─────────────────────────────────────────────────────────────

const FIXTURE_READINESS: InsightReadiness = {
  lessonDataReady: true,
  lessonDataCount: undefined,
  basicInfo: { birthDate: true, height: false, weight: false },
  parentObservation: { answered: 0, total: 6 },
  preflightConfirmed: false,
};

const FIXTURE_REPORTS: InsightReport[] = [];

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
  "수영 기술 및 학습 진행",
  "행동·학습 강점",
  "반복되는 성장 패턴",
  "잘 되는 조건",
  "수업 전략",
  "다음 성장 방향",
  "가정에서의 지원 방법",
];

function ReportPreviewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
        <Text style={s.sheetTitle}>어떤 리포트가 나오나요?</Text>

        {/* 행동·학습 분석 가치 */}
        <View style={s.sheetValueBlock}>
          <Text style={s.sheetValueTitle}>
            수영 기록을 넘어,{"\n"}아이가 배우는 방식까지
          </Text>
          <Text style={s.sheetValueBody}>
            일반적인 수영 리포트가 영법이나 기록 중심으로 끝나는 것과 달리,{"\n"}
            AI 인사이트 전략 리포트는 수업 중 반복되는 행동,{"\n"}
            새로운 과제를 받아들이는 방식, 집중과 자기조절,{"\n"}
            성공했을 때의 조건, 어려움 이후 다시 적응하는 과정까지{"\n"}
            누적 수업 데이터 안에서 함께 살펴봅니다.
          </Text>
          <View style={s.sheetBullets}>
            {[
              "무엇을 잘했는가",
              "어떤 조건에서 더 잘 배우는가",
              "어떤 방식으로 성장하고 있는가",
              "다음 수업에서 무엇을 우선해야 하는가",
            ].map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={s.bulletDot} />
                <Text style={s.bulletTxt}>{b}</Text>
              </View>
            ))}
          </View>
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
            "SWIMNOTE 누적 수업·성장 데이터 분석",
            "학부모 관찰정보 결합",
            "SWIMNOTE AI 추론",
            "OpenAI GPT 활용 교차 검증",
            "근거 있는 항목만 선별",
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
            AI 인사이트 전략 리포트의 평가항목은 SWIMNOTE가 임의로 만든 질문만으로 구성하지 않습니다.{"\n\n"}
            아동·학습·행동·운동 분야에서 사용되는 전문적인 평가 지표와 관찰 기준을 참고하고,{"\n\n"}
            SWIMNOTE AI가 실제 수업 기록과 누적 성장 데이터를 분석한 뒤, OpenAI GPT를 활용한 교차 검증 단계를 거쳐 근거가 있는 내용만 부모용 인사이트로 정리합니다.
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
        <Text style={s.preflightAmount}>29,000원 · 1회</Text>
      </View>
      <View style={s.ctaDisabled}>
        <Text style={s.ctaDisabledTxt}>결제하고 분석 시작</Text>
      </View>
      <Text style={s.ctaHint}>결제 기능은 준비 중입니다.</Text>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────

export default function InsightReportHub() {
  const insets = useSafeAreaInsets();

  const readiness = FIXTURE_READINESS;
  const reports   = FIXTURE_REPORTS;

  const [showPreview,     setShowPreview]     = useState(false);
  const [showPreflight,   setShowPreflight]   = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);

  const basicDone  = Object.values(readiness.basicInfo).filter(Boolean).length;
  const basicTotal = Object.keys(readiness.basicInfo).length;
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
  const obsState   = readinessState(false, obsDone,   obsTotal);

  const DATA_SOURCES = [
    "누적 수업 기록",
    "수영 교육과정 진행",
    "반복된 성장·변화 신호",
    "수업 중 성공 조건",
    "교사 관찰 내용",
    "학부모가 제공한 추가 정보",
    "이전 AI 성장 리포트",
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
            학부모가 제공한 관찰정보를 함께 분석해{"\n"}
            아이의 성장 신호와 잘 되는 조건,{"\n"}
            다음 성장 전략을 더 깊게 분석합니다.
          </Text>

          {/* 핵심 카피 */}
          <View style={s.heroCopyBlock}>
            <Text style={s.heroCopy}>평가항목은 넓게,{"\n"}리포트에는 근거 있는 내용만.</Text>
          </View>

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
            <ReadinessRow label="아이 기본정보"    value={`${basicDone}/${basicTotal}`}                  state={basicState} />
            <ReadinessRow label="학부모 관찰정보"  value={obsTotal > 0 ? `${obsDone}/${obsTotal}` : "미입력"} state={obsState} />
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
              onPress={() => { /* PHASE 2에서 연결 */ }}
            />
            <View style={s.divider} />
            <InfoMenuItem
              icon="message-square"
              title="학부모 관찰정보"
              desc="수업 밖에서 보이는 아이의 변화와 특징을 보충합니다."
              state={obsState}
              onPress={() => { /* PHASE 3에서 연결 */ }}
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
                  수영기술, 운동학습, 집중·자기조절, 학습태도, 자신감, 회복탄력성, 신체협응, 균형·운동능력 등 아이의 성장과 관련된 약 330개의 평가 후보항목을 폭넓게 검토합니다.
                </Text>
                <Text style={[s.infoBoxBody, { marginTop: 8, color: MUTED }]}>
                  330개 항목 모두에 점수를 매기는 방식이 아닙니다. 실제 수업 기록과 누적 데이터에서 근거가 확인되는 항목만 선별해 아이에게 의미 있는 성장 신호를 리포트에 반영합니다.
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

        {/* ── F. 가격 / CTA ── */}
        <View style={s.ctaSection}>
          <View style={s.priceRow}>
            <Text style={s.priceName}>AI 인사이트 전략 리포트</Text>
            <Text style={s.priceAmount}>29,000원 · 1회</Text>
          </View>
          <Pressable style={s.ctaBtn} onPress={() => setShowPreflight(true)}>
            <Text style={s.ctaBtnTxt}>발급 준비 확인</Text>
          </Pressable>
        </View>

        {/* ── G. 내 리포트 ── */}
        <View style={s.section}>
          <SectionLabel label="내 리포트" />
          {reports.length === 0 ? (
            <View style={s.emptyCard}>
              <LucideIcon name="inbox" size={28} color={MUTED} />
              <Text style={s.emptyTxt}>
                아직 발급된 리포트가 없습니다.
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
  ctaBtn:     { backgroundColor: NAVY, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ctaBtnTxt:  { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "#fff" },

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
