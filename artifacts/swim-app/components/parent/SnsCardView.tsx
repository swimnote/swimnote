/**
 * SnsCardView.tsx — GR9: 9:16 SNS Share Card
 *
 * spec §22, §23, §16:
 *   - 9:16 비율 (Instagram Story 호환)
 *   - sns_summary.headline + key_points 그대로 사용 (APP 재작성/추가 금지)
 *   - supporting_claim_ids 미노출 (spec §14)
 *   - SWIMNOTE branding + pool name (spec §20, §21)
 *   - 학생 실명 미강제 (보수적 방향, spec §19)
 *   - 점수/게이지/진단 없음 (spec §37)
 *   - 내부 분석정보 없음 (spec §18)
 *
 * 사용법:
 *   const ref = useRef(null);
 *   <SnsCardView ref={ref} ... />
 *   const uri = await captureRef(ref, { format: 'png', quality: 1 });
 */
import React, { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  View,
} from "react-native";

// ── 상수 ─────────────────────────────────────────────────────────────────────

// 9:16 논리적 크기 (captureRef quality=1 시 고해상도 출력)
export const SNS_CARD_WIDTH  = 360;
export const SNS_CARD_HEIGHT = 640;  // 360 × 16/9 ≈ 640

const NAVY   = "#0D2E5A";
const MINT   = "#3ECFBA";
const WHITE  = "#FFFFFF";
const LIGHT  = "#EAF4FF";

// ── 기간 포맷 ─────────────────────────────────────────────────────────────────

function formatPeriodShort(period: string): string {
  const [y, m] = period.split("-");
  return y && m ? `${y}년 ${Number(m)}월` : period;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface SnsCardViewProps {
  reportPeriod:  string;
  headline:      string;
  keyPoints:     string[];   // ENGINE 값 그대로, APP이 추가/변경 금지
  poolName?:     string;
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────

/**
 * SnsCardView — forwardRef로 viewShot captureRef 호환
 * Rendered off-screen by the parent; parent calls captureRef(ref).
 */
const SnsCardView = forwardRef<View, SnsCardViewProps>(function SnsCardView(
  { reportPeriod, headline, keyPoints, poolName },
  ref,
) {
  const periodLabel = formatPeriodShort(reportPeriod);
  // ENGINE key_points 그대로 — 최대 4개만 표시 (카드 크기 제한, spec §23)
  const visiblePoints = keyPoints.slice(0, 4);

  return (
    <View ref={ref} style={card.root} collapsable={false}>
      {/* ── 배경 그라디언트 효과 (순수 View 기반) ── */}
      <View style={card.bgTop} />
      <View style={card.bgBottom} />

      {/* ── 상단: 브랜드 + 수영장 ── */}
      <View style={card.topRow}>
        <View style={card.brandBadge}>
          <View style={card.brandDot} />
          <Text style={card.brandName}>SWIMNOTE</Text>
        </View>
        {!!poolName && (
          <Text style={card.poolName} numberOfLines={1}>{poolName}</Text>
        )}
      </View>

      {/* ── 중앙: 메인 콘텐츠 ── */}
      <View style={card.centerBlock}>
        <Text style={card.subtitle}>우리 아이 성장리포트</Text>
        <Text style={card.period}>{periodLabel}</Text>

        {/* 구분선 */}
        <View style={card.divider} />

        {/* headline — ENGINE 값 그대로 (spec §17, §38) */}
        <Text style={card.headline}>{headline}</Text>

        {/* key_points — ENGINE 순서 그대로 (spec §38) */}
        {visiblePoints.length > 0 && (
          <View style={card.keyPointsContainer}>
            {visiblePoints.map((point, i) => (
              <View key={i} style={card.keyPointRow}>
                <View style={card.keyPointDot} />
                <Text style={card.keyPointText} numberOfLines={3}>{point}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── 하단: SWIMNOTE branding (spec §21) ── */}
      <View style={card.footer}>
        <Text style={card.footerBrand}>SWIMNOTE</Text>
        <Text style={card.footerTagline}>수영 피드백의 시대.</Text>
      </View>
    </View>
  );
});

export default SnsCardView;

// ── 스타일 ────────────────────────────────────────────────────────────────────

const card = StyleSheet.create({
  root: {
    width:           SNS_CARD_WIDTH,
    height:          SNS_CARD_HEIGHT,
    backgroundColor: NAVY,
    position:        "relative",
    overflow:        "hidden",
    padding:         28,
    justifyContent:  "space-between",
  },

  // 배경 장식 (그라디언트 효과 — Pure View)
  bgTop: {
    position:        "absolute",
    top:             -60,
    right:           -60,
    width:           200,
    height:          200,
    borderRadius:    100,
    backgroundColor: "rgba(62,207,186,0.12)",
  },
  bgBottom: {
    position:        "absolute",
    bottom:          -80,
    left:            -40,
    width:           240,
    height:          240,
    borderRadius:    120,
    backgroundColor: "rgba(62,207,186,0.08)",
  },

  // 상단
  topRow: {
    flexDirection: "row",
    alignItems:    "center",
    justifyContent: "space-between",
    flexWrap:      "wrap",
    gap:           8,
  },
  brandBadge: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
  },
  brandDot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: MINT,
  },
  brandName: {
    fontSize:      12,
    fontWeight:    "700",
    color:         MINT,
    letterSpacing: 1.8,
  },
  poolName: {
    fontSize:  11,
    color:     "rgba(255,255,255,0.55)",
    maxWidth:  160,
    textAlign: "right",
  },

  // 중앙 콘텐츠
  centerBlock: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 20,
  },
  subtitle: {
    fontSize:      12,
    color:         "rgba(255,255,255,0.55)",
    fontWeight:    "600",
    letterSpacing: 0.5,
    marginBottom:  4,
  },
  period: {
    fontSize:   28,
    fontWeight: "700",
    color:      WHITE,
    marginBottom: 16,
    lineHeight:  34,
  },
  divider: {
    width:           36,
    height:          3,
    borderRadius:    2,
    backgroundColor: MINT,
    marginBottom:    20,
  },
  headline: {
    fontSize:     16,
    fontWeight:   "600",
    color:        WHITE,
    lineHeight:   26,
    marginBottom: 20,
  },

  // key points
  keyPointsContainer: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius:    12,
    padding:         16,
    gap:             10,
  },
  keyPointRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           10,
  },
  keyPointDot: {
    width:           5,
    height:          5,
    borderRadius:    3,
    backgroundColor: MINT,
    marginTop:       7,
    flexShrink:      0,
  },
  keyPointText: {
    fontSize:  13,
    color:     "rgba(255,255,255,0.88)",
    lineHeight: 20,
    flex:      1,
  },

  // 하단 branding
  footer: {
    borderTopWidth:  1,
    borderTopColor:  "rgba(255,255,255,0.12)",
    paddingTop:      16,
  },
  footerBrand: {
    fontSize:      11,
    fontWeight:    "700",
    color:         MINT,
    letterSpacing: 1.5,
  },
  footerTagline: {
    fontSize: 10,
    color:    "rgba(255,255,255,0.40)",
    marginTop: 2,
  },
});
