/**
 * (parent)/growth-report-paid.tsx
 *
 * AI 인사이트 전략 리포트 — Product Hub
 * PHASE 1: UI/IA Shell (fixture data, no API/payment)
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

const C = Colors.light;
const NAVY  = "#0C1A2E";
const MINT  = "#10B981";
const MINT_BG = "#10B98114";
const MUTED = "#6B7280";

// ─────────────────────────────────────────────────────────────
// Types & Contract
// ─────────────────────────────────────────────────────────────

/** PHASE 2+에서 실제 API response로 교체. */
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
// PHASE 1 Fixture (개발용 — PHASE 2+에서 API로 교체)
// ─────────────────────────────────────────────────────────────

const FIXTURE_READINESS: InsightReadiness = {
  lessonDataReady: true,
  lessonDataCount: undefined,
  basicInfo: { birthDate: true, height: false, weight: false },
  parentObservation: { answered: 0, total: 6 },
  preflightConfirmed: false,
};

const FIXTURE_HUB_STATE: HubState = "NOT_STARTED";
const FIXTURE_REPORTS: InsightReport[] = [];

// ─────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <Text style={s.sectionLabel}>{label}</Text>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={s.pill}>
      <Text style={s.pillTxt}>{label}</Text>
    </View>
  );
}

function ReadinessRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={s.readinessRow}>
      <Text style={s.readinessLabel}>{label}</Text>
      <View style={s.readinessValueWrap}>
        <View style={[s.readinessDot, { backgroundColor: ok ? MINT : C.border }]} />
        <Text style={[s.readinessValue, { color: ok ? MINT : MUTED }]}>{value}</Text>
      </View>
    </View>
  );
}

function InfoMenuItem({
  icon,
  title,
  desc,
  status,
  onPress,
}: {
  icon: string;
  title: string;
  desc: string;
  status?: "done" | "partial" | "empty";
  onPress: () => void;
}) {
  const dotColor = status === "done" ? MINT : status === "partial" ? "#F59E0B" : C.border;
  return (
    <Pressable
      style={({ pressed }) => [s.infoItem, { opacity: pressed ? 0.75 : 1 }]}
      onPress={onPress}
    >
      <View style={[s.infoIconBox, { backgroundColor: NAVY + "0D" }]}>
        <LucideIcon name={icon as any} size={17} color={NAVY} />
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
      <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={s.sheetHandle} />
        {children}
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// Preview BottomSheet content
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
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
        <Text style={s.sheetTitle}>리포트 구성</Text>
        {REPORT_SECTIONS.map((sec, i) => (
          <View key={i} style={s.previewRow}>
            <View style={s.previewDot} />
            <Text style={s.previewRowTxt}>{sec}</Text>
          </View>
        ))}
        <View style={[s.sheetNote, { marginTop: 16 }]}>
          <Text style={s.sheetNoteTxt}>
            모든 항목을 억지로 채우는 방식이 아니라, 누적 데이터에서 근거가 확인되는 성장 신호를 선별해 깊이 있게 분석합니다.
          </Text>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Preflight BottomSheet content
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
  const basicDone = Object.values(readiness.basicInfo).filter(Boolean).length;
  const basicTotal = Object.keys(readiness.basicInfo).length;
  const obsDone = readiness.parentObservation.answered;
  const obsTotal = readiness.parentObservation.total;

  function CheckRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
    return (
      <View style={s.checkRow}>
        <LucideIcon name={ok ? "check-circle" : "circle"} size={14} color={ok ? MINT : C.border} />
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
        <CheckRow label="아이 기본정보" value={`${basicDone}/${basicTotal}`} ok={basicDone === basicTotal} />
        <CheckRow label="학부모 관찰정보" value={obsTotal > 0 ? `${obsDone}/${obsTotal}` : "미입력"} ok={obsDone > 0} />
      </View>

      <View style={s.preflightPrice}>
        <Text style={s.preflightProduct}>AI 인사이트 전략 리포트</Text>
        <Text style={s.preflightAmount}>29,000원 · 1회</Text>
      </View>

      {/* 결제 버튼 — PHASE 5까지 비활성 */}
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

  // PHASE 1: fixture
  const readiness = FIXTURE_READINESS;
  const hubState = FIXTURE_HUB_STATE;
  const reports = FIXTURE_REPORTS;

  const [showPreview, setShowPreview] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);

  // Readiness helpers
  const basicDone = Object.values(readiness.basicInfo).filter(Boolean).length;
  const basicTotal = Object.keys(readiness.basicInfo).length;
  const obsDone = readiness.parentObservation.answered;
  const obsTotal = readiness.parentObservation.total;

  const basicStatus: "done" | "partial" | "empty" =
    basicDone === basicTotal ? "done" : basicDone > 0 ? "partial" : "empty";
  const obsStatus: "done" | "partial" | "empty" =
    obsDone === obsTotal && obsTotal > 0 ? "done" : obsDone > 0 ? "partial" : "empty";

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
      {/* ── 헤더 ── */}
      <View style={[s.header, { backgroundColor: NAVY }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <LucideIcon name="chevron-left" size={22} color="#fff" />
        </Pressable>
        <Text style={s.headerTitle}>AI 인사이트 전략 리포트</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── A. Product Intro ── */}
        <View style={[s.introCard, { backgroundColor: NAVY }]}>
          <Text style={s.introTitle}>AI 인사이트 전략 리포트</Text>
          <Text style={s.introDesc}>
            수업 기록과 누적 성장 데이터,{"\n"}
            학부모가 제공한 관찰정보를 함께 분석해{"\n"}
            아이의 성장 신호와 잘 되는 조건,{"\n"}
            다음 성장 전략을 더 깊게 분석합니다.
          </Text>
          <View style={s.pillRow}>
            <Pill label="1회 심층 분석" />
            <Pill label="누적 데이터 기반" />
            <Pill label="여러 성장 영역 종합" />
            <Pill label="근거 있는 항목만" />
          </View>
        </View>

        {/* ── B. 분석 준비 상태 ── */}
        <View style={s.section}>
          <SectionLabel label="분석 준비" />
          <View style={s.readinessCard}>
            <ReadinessRow
              label="수업·성장 데이터"
              value={readiness.lessonDataReady ? "준비됨" : "데이터 없음"}
              ok={readiness.lessonDataReady}
            />
            <ReadinessRow
              label="아이 기본정보"
              value={`${basicDone}/${basicTotal}`}
              ok={basicDone === basicTotal}
            />
            <ReadinessRow
              label="학부모 관찰정보"
              value={obsTotal > 0 ? `${obsDone}/${obsTotal}` : "미입력"}
              ok={obsDone > 0}
            />
            <ReadinessRow
              label="발급 전 확인"
              value={readiness.preflightConfirmed ? "완료" : "미완료"}
              ok={readiness.preflightConfirmed}
            />
          </View>
          <Pressable
            style={[s.readinessBtn, { borderColor: NAVY }]}
            onPress={() => setShowPreflight(true)}
          >
            <Text style={[s.readinessBtnTxt, { color: NAVY }]}>준비 상태 확인</Text>
            <LucideIcon name="chevron-right" size={14} color={NAVY} />
          </Pressable>
        </View>

        {/* ── C. 정보 준비 ── */}
        <View style={s.section}>
          <SectionLabel label="정보 준비" />
          <View style={s.infoCard}>
            <InfoMenuItem
              icon="user"
              title="아이 기본정보"
              desc="분석에 참고할 기본 정보를 확인합니다."
              status={basicStatus}
              onPress={() => {
                // PHASE 2에서 저장 연결 — 현재 읽기 전용 sheet (미구현)
              }}
            />
            <View style={s.divider} />
            <InfoMenuItem
              icon="message-square"
              title="학부모 관찰정보"
              desc="수업 밖에서 보이는 아이의 변화와 특징을 보충합니다."
              status={obsStatus}
              onPress={() => {
                // PHASE 3에서 입력 flow 연결
              }}
            />
          </View>
        </View>

        {/* ── D. 분석에 활용되는 정보 ── */}
        <View style={s.section}>
          <Pressable
            style={s.accordionRow}
            onPress={() => setShowDataSources(v => !v)}
          >
            <Text style={s.accordionLabel}>분석에 활용되는 정보</Text>
            <LucideIcon
              name={showDataSources ? "chevron-up" : "chevron-down"}
              size={15}
              color={MUTED}
            />
          </Pressable>
          {showDataSources && (
            <View style={s.sourceList}>
              {DATA_SOURCES.map((src, i) => (
                <View key={i} style={s.sourceRow}>
                  <View style={s.sourceDot} />
                  <Text style={s.sourceTxt}>{src}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── E. 리포트 구성 미리보기 ── */}
        <View style={[s.section, { paddingTop: 0 }]}>
          <Pressable
            style={s.previewBtn}
            onPress={() => setShowPreview(true)}
          >
            <LucideIcon name="file-text" size={16} color={NAVY} />
            <Text style={s.previewBtnTxt}>어떤 리포트가 나오나요?</Text>
            <LucideIcon name="chevron-right" size={14} color={MUTED} />
          </Pressable>
        </View>

        {/* ── F. 발급 전 확인 / 가격 ── */}
        <View style={s.ctaSection}>
          <View style={s.priceRow}>
            <Text style={s.priceName}>AI 인사이트 전략 리포트</Text>
            <Text style={s.priceAmount}>29,000원 · 1회</Text>
          </View>
          <Pressable
            style={s.ctaBtn}
            onPress={() => setShowPreflight(true)}
          >
            <Text style={s.ctaBtnTxt}>발급 준비 확인</Text>
          </Pressable>
        </View>

        {/* ── G. 내 리포트 ── */}
        <View style={s.section}>
          <SectionLabel label="내 리포트" />
          {reports.length === 0 ? (
            <View style={s.emptyCard}>
              <LucideIcon name="inbox" size={32} color={C.border} />
              <Text style={s.emptyTxt}>
                아직 발급된 AI 인사이트 전략 리포트가 없습니다.
              </Text>
            </View>
          ) : (
            reports.map(r => (
              <View key={r.id} style={s.reportItem}>
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

      {/* ── BottomSheets ── */}
      <ReportPreviewSheet visible={showPreview} onClose={() => setShowPreview(false)} />
      <PreflightSheet
        visible={showPreflight}
        onClose={() => setShowPreflight(false)}
        readiness={readiness}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:           { flex: 1, backgroundColor: C.background },
  scroll:         { flex: 1 },

  // Header
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 12 },
  backBtn:        { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle:    { fontSize: 16, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "#fff" },

  // Intro
  introCard:      { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 28 },
  introTitle:     { fontSize: 22, fontFamily: "Pretendard-Regular", fontWeight: "700", color: "#fff", marginBottom: 12 },
  introDesc:      { fontSize: 14, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.75)", lineHeight: 22, marginBottom: 20 },
  pillRow:        { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill:           { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  pillTxt:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: "rgba(255,255,255,0.88)" },

  // Section
  section:        { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel:   { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },

  // Readiness
  readinessCard:  { backgroundColor: C.card, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 16, borderWidth: 1, borderColor: C.border },
  readinessRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  readinessLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },
  readinessValueWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  readinessDot:   { width: 7, height: 7, borderRadius: 4 },
  readinessValue: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  readinessBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  readinessBtnTxt:{ fontSize: 13, fontFamily: "Pretendard-Regular", fontWeight: "600" },

  // Info items
  infoCard:       { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: "hidden" },
  infoItem:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  infoIconBox:    { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  infoTitle:      { fontSize: 14, fontFamily: "Pretendard-Regular", fontWeight: "600", color: C.text },
  infoDesc:       { fontSize: 12, fontFamily: "Pretendard-Regular", color: C.textSecondary },
  statusDot:      { width: 8, height: 8, borderRadius: 4 },
  divider:        { height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginHorizontal: 16 },

  // Accordion
  accordionRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  accordionLabel: { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED },
  sourceList:     { paddingBottom: 8, gap: 8 },
  sourceRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  sourceDot:      { width: 4, height: 4, borderRadius: 2, backgroundColor: MUTED },
  sourceTxt:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // Preview button
  previewBtn:     { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: C.border },
  previewBtnTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: NAVY, flex: 1 },

  // CTA section
  ctaSection:     { marginHorizontal: 20, marginTop: 28, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 20, gap: 16 },
  priceRow:       { gap: 4 },
  priceName:      { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED },
  priceAmount:    { fontSize: 20, fontFamily: "Pretendard-Regular", fontWeight: "700", color: NAVY },
  ctaBtn:         { backgroundColor: NAVY, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ctaBtnTxt:      { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: "#fff" },

  // My reports
  emptyCard:      { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingVertical: 36, alignItems: "center", gap: 10 },
  emptyTxt:       { fontSize: 13, fontFamily: "Pretendard-Regular", color: MUTED, textAlign: "center" },
  reportItem:     { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16 },
  reportDate:     { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  reportPeriod:   { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },

  // Support
  supportSection: { marginHorizontal: 20, marginTop: 32, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 24, alignItems: "center", gap: 4 },
  supportLabel:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.text },
  supportDesc:    { fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  supportBtn:     { marginTop: 10, paddingHorizontal: 20, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  supportBtnTxt:  { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary },

  // BottomSheet
  sheetOverlay:   { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet:          { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "75%", paddingHorizontal: 24, paddingTop: 8 },
  sheetHandle:    { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: "center", marginBottom: 16 },
  sheetTitle:     { fontSize: 17, fontFamily: "Pretendard-Regular", fontWeight: "600", color: C.text, marginBottom: 16 },
  sheetNote:      { backgroundColor: C.backgroundSoft, borderRadius: 10, padding: 14 },
  sheetNoteTxt:   { fontSize: 13, fontFamily: "Pretendard-Regular", color: C.textSecondary, lineHeight: 20 },

  // Preview sheet
  previewRow:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  previewDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: MINT },
  previewRowTxt:  { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text },

  // Preflight sheet
  preflightRows:  { gap: 2, marginBottom: 20 },
  checkRow:       { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  checkLabel:     { fontSize: 14, fontFamily: "Pretendard-Regular", color: C.text, flex: 1 },
  checkValue:     { fontSize: 13, fontFamily: "Pretendard-Regular" },
  preflightPrice: { backgroundColor: C.backgroundSoft, borderRadius: 12, padding: 16, gap: 4, marginBottom: 16 },
  preflightProduct:{ fontSize: 12, fontFamily: "Pretendard-Regular", color: MUTED },
  preflightAmount: { fontSize: 18, fontFamily: "Pretendard-Regular", fontWeight: "700", color: NAVY },
  ctaDisabled:    { backgroundColor: C.border, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ctaDisabledTxt: { fontSize: 15, fontFamily: "Pretendard-Regular", fontWeight: "600", color: C.textMuted },
  ctaHint:        { fontSize: 11, fontFamily: "Pretendard-Regular", color: MUTED, textAlign: "center", marginTop: 8 },
});
