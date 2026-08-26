/**
 * GrowthReportFullFeed.tsx
 *
 * Instagram-inspired full report renderer for the parent home feed.
 *
 * 핵심 원칙 (spec §1, §2):
 *   - truncation/line clamp/max-height/overflow hidden 전면 금지
 *   - 부모가 "가정에서 함께해요"까지 피드에서 직접 읽을 수 있어야 함
 *   - Instagram feed 구조/리듬 오마주 — 시각적 복제 금지
 *   - SWIMNOTE NAVY/AQUA 브랜드 톤 유지
 *
 * Typography system (4 levels — spec §4):
 *   T1: section title  — 15px SemiBold #0D2E5A
 *   T2: body text      — 14px Regular  #1A2E44
 *   T3: metadata/label — 12px Regular  #526C78
 *   T4: action/footer  — 12px Regular  #7A90A8
 *
 * Data:
 *   - fetchDetail() → GET /parent/growth-reports/:id (AI calls = 0, 저장 데이터 read)
 *   - PDF V3 renderer 무변경 (spec §14)
 *   - AI 추가 호출 금지 (spec §15)
 *
 * 금지:
 *   - API 수정 / DB 수정 / Render 배포 / OTA / PDF V3 수정
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { apiRequest, useAuth } from "@/context/AuthContext";
import { LucideIcon } from "@/components/common/LucideIcon";
import type { CurriculumProgressData } from "@/components/CurriculumProgressGauge";
import type { GrowthReportFeedItem } from "@/components/parent/GrowthReportFeedCard";

// ─── Logo asset ───────────────────────────────────────────────────────────────
// 실제 SwimNote AI REPORT 가로형 로고 사용 (spec §3)
const LOGO_IMG = require("@/assets/images/swimnote-ai-report-logo.png");

// ─── 색상 (PDF V3 공유 팔레트) ────────────────────────────────────────────────
const NAVY        = "#0D2E5A";   // T1 section title, header brand
const AQUA        = "#25B7CF";   // accent line, progress bar, bullet
const AQUA_SOFT   = "#D9F2F6";   // hairline divider, progress bg
const AQUA_MIST   = "#EEF9FB";   // summary block bg, parent_support bg
const CARD_BG     = "#FFFFFF";
const BODY_TEXT   = "#1A2E44";   // T2 body
const META_TEXT   = "#526C78";   // T3 metadata
const MUTED_TEXT  = "#7A90A8";   // T4 action
const BORDER_CLR  = "#E8F0F7";   // hairline divider
const AQUA_DIM    = "#1a97af";   // progress bar pct text

// ─── Typography (4 levels) ────────────────────────────────────────────────────
const T = {
  sectionTitle: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: NAVY } as const,
  body:         { fontSize: 14, fontFamily: "Pretendard-Regular",  color: BODY_TEXT, lineHeight: 22 } as const,
  meta:         { fontSize: 12, fontFamily: "Pretendard-Regular",  color: META_TEXT } as const,
  action:       { fontSize: 12, fontFamily: "Pretendard-Regular",  color: MUTED_TEXT } as const,
};

// ─── Section labels (feed-specific — spec §5) ─────────────────────────────────
const SECTION_LABELS: Record<string, string> = {
  core_growth:             "핵심 성장",
  swimming_progress:       "수영 교육과정 진행",
  behavioral_strengths:    "행동 강점",
  longitudinal_comparison: "이전 기간 비교",
  success_conditions:      "성공 조건",
  teacher_guidance:        "교사 관찰 메모",
  next_growth_direction:   "다음 수업 방향",
  parent_support:          "가정에서 함께해요",
};

// Section order (parent_support always last — spec §12)
const SECTION_ORDER = [
  "core_growth",
  "swimming_progress",
  "behavioral_strengths",
  "longitudinal_comparison",
  "success_conditions",
  "teacher_guidance",
  "next_growth_direction",
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReportSection { text: string; }
interface ReportContent {
  summary_text: string;
  sections: Partial<Record<string, ReportSection>>;
}
interface GrowthReportDetail {
  report_id:      string;
  report_period:  string;
  published_at:   string;
  report_content: ReportContent;
  sns_summary:    { headline: string; key_points: string[] } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmptySection(text?: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  // "이번 기간 해당 내용 없음" 유사 placeholder (spec §10)
  if (/^[\(\（]?이번\s*(달|기간|수업)?\s*(해당)?\s*(내용|사항)?\s*(없음|없어요|없습니다)[\)\）]?\.?$/.test(t)) return true;
  return false;
}

function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}

// ─── Component ────────────────────────────────────────────────────────────────
interface Props {
  item:          GrowthReportFeedItem;
  studentName?:  string;
  poolName?:     string;
  progressData?: CurriculumProgressData | null;
}

export function GrowthReportFullFeed({ item, studentName, poolName, progressData }: Props) {
  const { token } = useAuth();
  const mounted   = useRef(true);

  const [detail,  setDetail]  = useState<GrowthReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const fetchDetail = useCallback(async () => {
    if (!item.growth_report_id) return;
    setLoading(true);
    setFailed(false);
    try {
      const res  = await apiRequest(token, `/parent/growth-reports/${encodeURIComponent(item.growth_report_id)}`);
      const data = await res.json();
      if (!mounted.current) return;
      if (res.ok && data.report_content) {
        setDetail(data as GrowthReportDetail);
      } else {
        setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [token, item.growth_report_id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // 커리큘럼 진도 (optional)
  const pct = progressData?.display_confirmed_pct;
  const hasProgress =
    (progressData?.observation_session_count ?? 0) >= 3 &&
    typeof pct === "number" && pct > 0;
  const pctInt = hasProgress ? Math.round(pct!) : 0;

  // 날짜 포맷
  const periodLabel = formatPeriod(item.report_period);

  // metadata row: 월 · 학생 · 수영장 · 진도
  const metaParts = [
    periodLabel,
    studentName,
    poolName,
    hasProgress ? `진도 ${pctInt}%` : null,
  ].filter(Boolean) as string[];

  function handleDetailPress() {
    router.push(`/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.growth_report_id)}`);
  }

  return (
    <View style={{ backgroundColor: CARD_BG }}>

      {/* ── COMPACT HEADER (spec §3) ──────────────────────────────── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: BORDER_CLR,
        }}
      >
        {/* ROW 1: 로고 + 리포트 레이블 */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Image
            source={LOGO_IMG}
            style={{ height: 22, width: 130 }}
            resizeMode="contain"
          />
          <View
            style={{
              backgroundColor: AQUA_MIST,
              borderRadius: 20,
              paddingHorizontal: 9,
              paddingVertical: 3,
              borderWidth: 1,
              borderColor: AQUA_SOFT,
            }}
          >
            <Text style={{ ...T.action, color: AQUA_DIM, fontFamily: "Pretendard-SemiBold", letterSpacing: 0.4 }}>
              월간 리포트
            </Text>
          </View>
        </View>

        {/* ROW 2: metadata (월 · 학생 · 수영장 · 진도) */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            marginTop: 7,
            gap: 0,
          }}
        >
          {metaParts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <Text style={{ ...T.meta, color: AQUA_SOFT, marginHorizontal: 5 }}>·</Text>
              )}
              <Text style={{ ...T.meta }}>{part}</Text>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* ── CONTENT ───────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ paddingVertical: 36, alignItems: "center" }}>
          <ActivityIndicator size="small" color={AQUA} />
        </View>
      ) : failed ? (
        <FailState onRetry={fetchDetail} onDetail={handleDetailPress} />
      ) : detail ? (
        <ReportBody
          detail={detail}
          hasProgress={hasProgress}
          pctInt={pctInt}
          onDetailPress={handleDetailPress}
        />
      ) : null}

    </View>
  );
}

// ─── Report Body ──────────────────────────────────────────────────────────────
function ReportBody({
  detail, hasProgress, pctInt, onDetailPress,
}: {
  detail: GrowthReportDetail;
  hasProgress: boolean;
  pctInt: number;
  onDetailPress: () => void;
}) {
  const { report_content } = detail;
  const sections = report_content?.sections ?? {};

  // non-empty body sections (SECTION_ORDER — parent_support excluded from loop)
  const bodySections = SECTION_ORDER
    .map((key) => ({ key, text: sections[key]?.text ?? "" }))
    .filter((s) => !isEmptySection(s.text));

  const parentSupportText = sections["parent_support"]?.text ?? "";
  const hasParentSupport  = !isEmptySection(parentSupportText);
  const hasSummary        = !isEmptySection(report_content.summary_text);

  return (
    <View>
      {/* ── 이번 달 한눈에 보기 (summary — subtle bg, spec §8) ────── */}
      {hasSummary && (
        <View
          style={{
            backgroundColor: AQUA_MIST,
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 16,
          }}
        >
          <SectionTitle label="이번 달 한눈에 보기" />
          <Text style={{ ...T.body, marginTop: 8 }}>
            {report_content.summary_text}
          </Text>
        </View>
      )}

      {/* ── 커리큘럼 진도 (optional) ──────────────────────────────── */}
      {hasProgress && (
        <>
          <ContentHairline />
          <View style={{ paddingHorizontal: 20, paddingVertical: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ ...T.meta }}>커리큘럼 진도</Text>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: AQUA_DIM }}>
                {pctInt}%
              </Text>
            </View>
            <View style={{ height: 2, backgroundColor: AQUA_SOFT, borderRadius: 1, overflow: "hidden" }}>
              <View
                style={{
                  height: "100%" as const,
                  width: `${Math.min(100, pctInt)}%` as `${number}%`,
                  backgroundColor: AQUA,
                  borderRadius: 1,
                }}
              />
            </View>
          </View>
        </>
      )}

      {/* ── Body sections (non-empty, SECTION_ORDER) ──────────────── */}
      {bodySections.map((sec, idx) => (
        <React.Fragment key={sec.key}>
          <ContentHairline />
          <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 }}>
            <SectionTitle label={SECTION_LABELS[sec.key] ?? sec.key} />
            <Text style={{ ...T.body, marginTop: 8 }}>
              {sec.text}
            </Text>
          </View>
        </React.Fragment>
      ))}

      {/* ── 가정에서 함께해요 (parent_support — 최종 section, spec §12) */}
      {hasParentSupport && (
        <>
          <ContentHairline />
          <View
            style={{
              backgroundColor: AQUA_MIST,
              borderTopWidth: 1,
              borderTopColor: AQUA_SOFT,
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: 18,
            }}
          >
            <SectionTitle label="가정에서 함께해요" />
            <Text style={{ ...T.body, marginTop: 8 }}>
              {parentSupportText}
            </Text>
          </View>
        </>
      )}

      {/* ── Action Bar (spec §13) ─────────────────────────────────── */}
      <ActionBar onDetailPress={onDetailPress} />
    </View>
  );
}

// ─── Section Title (통일 스타일 — spec §5) ────────────────────────────────────
function SectionTitle({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 3, height: 15, borderRadius: 2, backgroundColor: AQUA }} />
      <Text style={{ ...T.sectionTitle }}>{label}</Text>
    </View>
  );
}

// ─── Hairline divider ─────────────────────────────────────────────────────────
function ContentHairline() {
  return <View style={{ height: 1, backgroundColor: BORDER_CLR }} />;
}

// ─── Action Bar (Instagram-inspired, spec §13) ────────────────────────────────
function ActionBar({ onDetailPress }: { onDetailPress: () => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderTopWidth: 1,
        borderTopColor: BORDER_CLR,
        backgroundColor: CARD_BG,
      }}
    >
      <ActionIcon icon="heart"          />
      <ActionIcon icon="message-circle" />
      <View style={{ flex: 1 }} />
      {/* PDF / 공유 */}
      <ActionIcon icon="download"  />
      {/* 상세 페이지 진입 (별도 기능 전용 — spec §13) */}
      <Pressable
        onPress={onDetailPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 3,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 8,
          backgroundColor: pressed ? AQUA_MIST : "transparent",
        })}
      >
        <Text style={{ ...T.action, color: AQUA_DIM, fontFamily: "Pretendard-SemiBold" }}>
          PDF·공유
        </Text>
        <LucideIcon name="chevron-right" size={12} color={AQUA_DIM} />
      </Pressable>
    </View>
  );
}

function ActionIcon({ icon }: { icon: string }) {
  return (
    <View style={{ padding: 7 }}>
      <LucideIcon name={icon} size={19} color={MUTED_TEXT} />
    </View>
  );
}

// ─── Fail state ───────────────────────────────────────────────────────────────
function FailState({ onRetry, onDetail }: { onRetry: () => void; onDetail: () => void }) {
  return (
    <View style={{ padding: 24, alignItems: "center", gap: 10 }}>
      <Text style={{ ...T.meta, textAlign: "center" }}>
        리포트를 불러오지 못했습니다.
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={onRetry}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: AQUA_MIST }}
        >
          <Text style={{ ...T.action, color: AQUA_DIM, fontFamily: "Pretendard-SemiBold" }}>다시 시도</Text>
        </Pressable>
        <Pressable
          onPress={onDetail}
          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: AQUA_MIST }}
        >
          <Text style={{ ...T.action, color: AQUA_DIM, fontFamily: "Pretendard-SemiBold" }}>상세 보기</Text>
        </Pressable>
      </View>
    </View>
  );
}
