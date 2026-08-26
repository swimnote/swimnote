/**
 * GrowthReportFeedImage.tsx
 *
 * MONTHLY 성장 리포트 전용 Feed Visual Renderer.
 *
 * 역할:
 *   - GrowthReportFeedCard 안에서 직접 렌더링 (live View)
 *   - generateFeedImageAsset()에서 off-screen 캡처 대상
 *
 * 설계 원칙:
 *   - canonical source (sns_summary + summary_text) 사용 — 별도 AI 호출 금지
 *   - PDF V3 디자인 언어 공유 (NAVY, AQUA, mist bg, typography hierarchy)
 *   - PDF 레이아웃 복사 금지 — feed-specific composition
 *   - 빈 섹션 렌더 금지
 *   - 커리큘럼 진도는 optional (없으면 해당 행 미노출)
 *   - LOCKED PDF 수정 금지
 */

import React, { forwardRef } from "react";
import { View, Text } from "react-native";

// ─── 색상 상수 (PDF V3와 공유) ──────────────────────────────────────────────
const NAVY       = "#0F2742";  // Deep Navy — header bg, 강조 텍스트
const NAVY_DEEP  = "#091D33";  // 더 어두운 네이비
const AQUA       = "#25B7CF";  // Clear Pool Primary — accent, bullet, bar
const AQUA_DIM   = "#1a97af";  // progress bar fill
const AQUA_MIST  = "#EEF9FB";  // Clear Pool Mist — body bg
const AQUA_SOFT  = "#D9F2F6";  // divider
const WHITE      = "#FFFFFF";
const TEXT_NAVY  = "#0D2E5A";  // section heading
const TEXT_BODY  = "#1A2E44";  // body text
const TEXT_SEC   = "#526C78";  // secondary / meta
const TEXT_MUTED = "#7A90A8";  // muted / hint

// ─── section label 매핑 (feed용 — PDF보다 간결) ─────────────────────────────
const FEED_SECTION_LABELS: Record<string, string> = {
  core_growth:             "이번 달 가장 좋았던 모습",
  swimming_progress:       "이번 달 수영에서 배운 것",
  behavioral_strengths:    "수업에서 좋았던 모습",
  longitudinal_comparison: "지난달보다 이렇게 이어졌어요",
  success_conditions:      "이럴 때 더 잘하고 있어요",
  parent_support:          "집에서는 이렇게 함께해주세요",
  teacher_guidance:        "수업에서 이어갈 내용",
  next_growth_direction:   "앞으로 이렇게 만들어갈게요",
};

// ─── Props ───────────────────────────────────────────────────────────────────
export interface GrowthReportFeedImageData {
  reportId:     string;
  reportPeriod: string;  // "YYYY-MM"
  studentName:  string;
  poolName?:    string;

  // canonical source (sns_summary)
  headline:    string;
  keyPoints:   string[];  // max 3 used
  summaryText: string;

  // curriculum progress (optional — from CurriculumProgressData)
  curriculumPct?: number;   // 0-100
  hasEnoughData?: boolean;  // observation_session_count >= 3

  // growth sections (optional — non-empty only)
  growthSections?: Array<{ key: string; text: string }>;
}

interface Props {
  data: GrowthReportFeedImageData;
  /** 캡처용 off-screen 렌더 시 사용할 고정 너비 (기본: undefined = 100%) */
  captureWidth?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────
export const GrowthReportFeedImage = forwardRef<View, Props>(
  function GrowthReportFeedImage({ data, captureWidth }, ref) {
    const {
      reportPeriod, studentName, poolName,
      headline, keyPoints, summaryText,
      curriculumPct, hasEnoughData,
      growthSections,
    } = data;

    // 날짜 포맷
    const [year, mon] = (reportPeriod ?? "").split("-");
    const dateLabel = year && mon ? `${year}년 ${Number(mon)}월` : reportPeriod ?? "";

    // 커리큘럼 표시 여부
    const showCurriculum =
      hasEnoughData !== false &&
      typeof curriculumPct === "number" &&
      curriculumPct > 0;
    const pctInt = showCurriculum ? Math.round(curriculumPct!) : 0;
    const barFill = `${Math.min(100, pctInt)}%`;

    // summary 앞부분 (80자 정도)
    const shortSummary = (summaryText ?? "").slice(0, 100).trim();
    const summaryHasTail = (summaryText ?? "").length > 100;

    // growth points: growthSections 우선, 없으면 keyPoints fallback
    const pointsFromSections = (growthSections ?? []).slice(0, 3);
    const useKeyPointFallback = pointsFromSections.length === 0;
    const keyPointsToShow = keyPoints.slice(0, 3);

    const containerStyle = captureWidth
      ? { width: captureWidth }
      : { width: "100%" as const };

    return (
      <View ref={ref} style={containerStyle}>

        {/* ── ZONE A: NAVY HEADER ─────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: NAVY,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 16,
          }}
        >
          {/* 브랜드 라인 */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            {/* 좌: 브랜드 */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 3,
                  height: 14,
                  borderRadius: 2,
                  backgroundColor: AQUA,
                }}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Pretendard-SemiBold",
                  color: "#A8CEDE",
                  letterSpacing: 0.5,
                }}
              >
                SwimNote AI
              </Text>
            </View>

            {/* 우: 리포트 타입 */}
            <Text
              style={{
                fontSize: 10,
                fontFamily: "Pretendard-Medium",
                color: "#7FA8C9",
                letterSpacing: 0.8,
              }}
            >
              MONTHLY 성장리포트
            </Text>
          </View>

          {/* 월 + 학생 */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                fontSize: 26,
                fontFamily: "Pretendard-Bold",
                color: "#E8F4FF",
                letterSpacing: -0.5,
                lineHeight: 32,
              }}
            >
              {dateLabel}
            </Text>
            <View style={{ alignItems: "flex-end", gap: 2 }}>
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Pretendard-SemiBold",
                  color: "#E8F4FF",
                  lineHeight: 20,
                }}
              >
                {studentName}
              </Text>
              {poolName ? (
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: "Pretendard-Regular",
                    color: "#7FA8C9",
                    lineHeight: 16,
                  }}
                  numberOfLines={1}
                >
                  {poolName}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* AQUA 구분선 (NAVY → BODY transition) */}
        <View style={{ height: 2, backgroundColor: AQUA }} />

        {/* ── ZONE B: CONTENT BODY ────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: AQUA_MIST,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 20,
            gap: 0,
          }}
        >
          {/* ── B1: 이번 달 한눈에 보기 ─────────────────────────────── */}
          <SectionHeading label="이번 달 한눈에 보기" />
          <View
            style={{
              height: 1,
              backgroundColor: AQUA_SOFT,
              marginTop: 5,
              marginBottom: 10,
            }}
          />

          {/* headline — 핵심 1문장 */}
          {headline ? (
            <Text
              style={{
                fontSize: 14,
                fontFamily: "Pretendard-SemiBold",
                color: NAVY,
                lineHeight: 22,
                marginBottom: 7,
                letterSpacing: -0.2,
              }}
            >
              {headline}
            </Text>
          ) : null}

          {/* summary 앞부분 */}
          {shortSummary ? (
            <Text
              style={{
                fontSize: 13,
                fontFamily: "Pretendard-Regular",
                color: TEXT_SEC,
                lineHeight: 20,
                marginBottom: summaryHasTail ? 0 : 0,
              }}
              numberOfLines={3}
            >
              {shortSummary}{summaryHasTail ? "…" : ""}
            </Text>
          ) : null}

          {/* ── B2: 커리큘럼 진도 ───────────────────────────────────── */}
          {showCurriculum ? (
            <>
              <ThinDivider />
              <View style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: "Pretendard-Medium",
                      color: TEXT_MUTED,
                    }}
                  >
                    현재 커리큘럼 진도
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Pretendard-Bold",
                      color: AQUA_DIM,
                    }}
                  >
                    {pctInt}%
                  </Text>
                </View>
                {/* Progress bar */}
                <View
                  style={{
                    height: 3,
                    backgroundColor: AQUA_SOFT,
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: "100%" as const,
                      width: barFill as `${number}%`,
                      backgroundColor: AQUA,
                      borderRadius: 2,
                    }}
                  />
                </View>
              </View>
            </>
          ) : null}

          {/* ── B3: 이번 달 성장 포인트 ─────────────────────────────── */}
          {useKeyPointFallback ? (
            keyPointsToShow.length > 0 ? (
              <>
                <ThinDivider />
                <SectionHeading label="이번 달 성장 포인트" />
                <View style={{ marginTop: 8, gap: 8 }}>
                  {keyPointsToShow.map((pt, idx) => (
                    <GrowthPointRow key={idx} text={pt} />
                  ))}
                </View>
              </>
            ) : null
          ) : (
            pointsFromSections.length > 0 ? (
              <>
                <ThinDivider />
                <SectionHeading label="이번 달 성장 포인트" />
                <View style={{ marginTop: 8, gap: 10 }}>
                  {pointsFromSections.map((sec, idx) => (
                    <GrowthSectionRow
                      key={idx}
                      label={FEED_SECTION_LABELS[sec.key] ?? sec.key}
                      text={sec.text}
                    />
                  ))}
                </View>
              </>
            ) : null
          )}
        </View>
      </View>
    );
  },
);

// ─── 소형 컴포넌트 ────────────────────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontFamily: "Pretendard-SemiBold",
        color: TEXT_MUTED,
        letterSpacing: 0.4,
      }}
    >
      {label}
    </Text>
  );
}

function ThinDivider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: AQUA_SOFT,
        marginVertical: 14,
      }}
    />
  );
}

function GrowthPointRow({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: AQUA,
          marginTop: 7,
          flexShrink: 0,
        }}
      />
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Pretendard-Regular",
          color: TEXT_SEC,
          lineHeight: 20,
          flex: 1,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}

function GrowthSectionRow({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          style={{
            width: 3,
            height: 3,
            borderRadius: 2,
            backgroundColor: AQUA,
            marginTop: 1,
          }}
        />
        <Text
          style={{
            fontSize: 11,
            fontFamily: "Pretendard-SemiBold",
            color: TEXT_NAVY,
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Pretendard-Regular",
          color: TEXT_SEC,
          lineHeight: 19,
          paddingLeft: 9,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}
