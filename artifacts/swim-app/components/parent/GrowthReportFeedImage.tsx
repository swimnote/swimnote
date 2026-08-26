/**
 * GrowthReportFeedImage.tsx
 *
 * MONTHLY 성장 리포트 전용 Feed Visual Renderer.
 *
 * Phase 3A: 디자인 미세조정
 *   - "이번 달 한눈에 보기" 섹션 레이블 제거 → AQUA left-accent 헤드라인 블록으로 대체
 *   - growth points: 서브 레이블 제거, 최대 2개, 짧은 excerpt 스타일
 *   - 불필요한 divider 1개 제거 (body 위/아래 padding으로 대체)
 *   - "MONTHLY 성장리포트" → "리포트" 필badge (짧게)
 *   - 전체 padding 다이어트 → 카드 높이 단축
 *   - headline 14 → 15px, body padding 축소
 *
 * 역할:
 *   - GrowthReportFeedCard 안에서 직접 렌더링 (live View)
 *   - generateFeedImageAsset()에서 off-screen 캡처 대상
 *
 * 금지:
 *   - PDF V3 수정 금지
 *   - API / DB / AI 호출 금지
 *   - Production write 금지
 */

import React, { forwardRef } from "react";
import { View, Text } from "react-native";

// ─── 색상 상수 (PDF V3와 공유) ──────────────────────────────────────────────
const NAVY       = "#0F2742";
const AQUA       = "#25B7CF";
const AQUA_DIM   = "#1a97af";
const AQUA_MIST  = "#EEF9FB";
const AQUA_SOFT  = "#D9F2F6";
const WHITE      = "#FFFFFF";
const TEXT_NAVY  = "#0D2E5A";
const TEXT_SEC   = "#526C78";
const TEXT_MUTED = "#7A90A8";

// ─── Props ───────────────────────────────────────────────────────────────────
export interface GrowthReportFeedImageData {
  reportId:     string;
  reportPeriod: string;
  studentName:  string;
  poolName?:    string;

  headline:    string;
  keyPoints:   string[];  // max 2 used for feed (was 3)
  summaryText: string;

  curriculumPct?: number;
  hasEnoughData?: boolean;

  growthSections?: Array<{ key: string; text: string }>;
}

interface Props {
  data: GrowthReportFeedImageData;
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

    // summary: 최대 2줄 분량 (약 72자)
    const shortSummary = (summaryText ?? "").slice(0, 90).trim();
    const summaryTail  = (summaryText ?? "").length > 90;

    // growth points: sections 우선, 없으면 keyPoints fallback — 최대 2개
    const pointsFromSections = (growthSections ?? []).slice(0, 2);
    const useKeyPointFallback = pointsFromSections.length === 0;
    const keyPointsToShow = keyPoints.slice(0, 2);
    const hasGrowthPoints =
      useKeyPointFallback ? keyPointsToShow.length > 0 : pointsFromSections.length > 0;

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
            paddingTop: 16,
            paddingBottom: 14,
          }}
        >
          {/* 브랜드 행 */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 2,
                  height: 12,
                  borderRadius: 1,
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

            {/* 리포트 pill 배지 */}
            <View
              style={{
                backgroundColor: "rgba(37,183,207,0.18)",
                borderRadius: 20,
                paddingHorizontal: 9,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontFamily: "Pretendard-SemiBold",
                  color: "#6ED8EB",
                  letterSpacing: 0.6,
                }}
              >
                월간 리포트
              </Text>
            </View>
          </View>

          {/* 월 + 학생/수영장 */}
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
                    fontSize: 10,
                    fontFamily: "Pretendard-Regular",
                    color: "#7FA8C9",
                    lineHeight: 15,
                  }}
                  numberOfLines={1}
                >
                  {poolName}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* AQUA 구분선 */}
        <View style={{ height: 2, backgroundColor: AQUA }} />

        {/* ── ZONE B: CONTENT BODY ────────────────────────────────────── */}
        <View
          style={{
            backgroundColor: AQUA_MIST,
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 16,
          }}
        >
          {/* ── B1: Headline block (AQUA left-accent, 섹션 레이블 제거) ── */}
          {headline ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "stretch",
                marginBottom: 8,
              }}
            >
              <View
                style={{
                  width: 3,
                  backgroundColor: AQUA,
                  borderRadius: 2,
                  marginRight: 10,
                }}
              />
              <Text
                style={{
                  fontSize: 15,
                  fontFamily: "Pretendard-SemiBold",
                  color: NAVY,
                  lineHeight: 22,
                  flex: 1,
                  letterSpacing: -0.2,
                }}
              >
                {headline}
              </Text>
            </View>
          ) : null}

          {/* summary: 최대 2줄 */}
          {shortSummary ? (
            <Text
              style={{
                fontSize: 13,
                fontFamily: "Pretendard-Regular",
                color: TEXT_SEC,
                lineHeight: 20,
                marginLeft: 13,  // AQUA bar + gap 정렬
                marginBottom: 0,
              }}
              numberOfLines={2}
            >
              {shortSummary}{summaryTail ? "…" : ""}
            </Text>
          ) : null}

          {/* ── B2: 커리큘럼 진도 ───────────────────────────────────── */}
          {showCurriculum ? (
            <>
              <HairlineDivider />
              <View style={{ gap: 5 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontFamily: "Pretendard-Regular",
                      color: TEXT_MUTED,
                      letterSpacing: 0.3,
                    }}
                  >
                    커리큘럼 진도
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: "Pretendard-Bold",
                      color: AQUA_DIM,
                    }}
                  >
                    {pctInt}%
                  </Text>
                </View>
                <View
                  style={{
                    height: 2,
                    backgroundColor: AQUA_SOFT,
                    borderRadius: 1,
                    overflow: "hidden",
                  }}
                >
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
          ) : null}

          {/* ── B3: Growth excerpts (레이블 없음, 순수 텍스트 스타일) ── */}
          {hasGrowthPoints ? (
            <>
              <HairlineDivider />
              <View style={{ gap: 7 }}>
                {useKeyPointFallback
                  ? keyPointsToShow.map((pt, idx) => (
                      <ExcerptRow key={idx} text={pt} />
                    ))
                  : pointsFromSections.map((sec, idx) => (
                      <ExcerptRow key={idx} text={sec.text} />
                    ))}
              </View>
            </>
          ) : null}
        </View>
      </View>
    );
  },
);

// ─── Sub-components ───────────────────────────────────────────────────────────

function HairlineDivider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: AQUA_SOFT,
        marginVertical: 12,
      }}
    />
  );
}

/** excerpt 스타일 성장 포인트 — 레이블 없음, 짧은 2줄 */
function ExcerptRow({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 7 }}>
      <View
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: AQUA,
          marginTop: 8,
          flexShrink: 0,
        }}
      />
      <Text
        style={{
          fontSize: 13,
          fontFamily: "Pretendard-Regular",
          color: TEXT_SEC,
          lineHeight: 21,
          flex: 1,
        }}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}
