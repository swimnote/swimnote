/**
 * GrowthReportFeedCard — Premium Feed Card
 *
 * Phase 2 구조:
 *   Pressable shell
 *     └── GrowthReportFeedImage  (canonical visual — contains all report content)
 *     └── ActionBar              (좋아요 / 댓글 / Instagram / PDF — placeholder)
 *
 * 데이터 흐름:
 *   GrowthReportFeedItem (feed API)
 *     → GrowthReportFeedImageData (buildFeedImageData)
 *     → GrowthReportFeedImage (live view in card)
 *
 * Fallback: preview 데이터 없으면 MinimalFallback 표시.
 *
 * DO NOT TOUCH: PDF V3 renderer, AI engine, API, DB, OTA
 */

import React from "react";
import { Pressable, View, Text } from "react-native";
import { router } from "expo-router";
import { LucideIcon } from "@/components/common/LucideIcon";
import Colors from "@/constants/colors";
import { GrowthReportFeedImage } from "@/components/parent/GrowthReportFeedImage";
import { buildFeedImageData } from "@/utils/generateFeedImageAsset";
import type { CurriculumProgressData } from "@/components/CurriculumProgressGauge";

const C = Colors.light;

// ─── 색상 상수 ────────────────────────────────────────────────────────────────
const NAVY      = "#0F2742";
const AQUA_SOFT = "#D9F2F6";
const WHITE     = "#FFFFFF";

// ─── Props ───────────────────────────────────────────────────────────────────
export interface GrowthReportFeedItem {
  type:             "GROWTH_REPORT";
  id:               string;
  growth_report_id: string;
  student_id:       string;
  report_period:    string;
  published_at:     string;
  created_at:       string;
  title:            string;
  preview: {
    summary_text?: string;
    headline?:     string;
    key_points?:   string[];
  };
  share_safe: boolean;
}

interface Props {
  item:          GrowthReportFeedItem;
  studentName?:  string;
  poolName?:     string;
  progressData?: CurriculumProgressData | null;
}

// ─── Component ───────────────────────────────────────────────────────────────
export function GrowthReportFeedCard({
  item, studentName, poolName, progressData,
}: Props) {
  const hasPreview =
    !!(item.preview?.headline || item.preview?.summary_text || (item.preview?.key_points ?? []).length > 0);

  // canonical data → feed image data
  const imageData = buildFeedImageData({
    reportId:     item.growth_report_id,
    reportPeriod: item.report_period,
    studentName:  studentName ?? "",
    poolName,
    summaryText:  item.preview?.summary_text ?? "",
    headline:     item.preview?.headline ?? "",
    keyPoints:    item.preview?.key_points ?? [],
    curriculumPct:           progressData?.display_confirmed_pct,
    observationSessionCount: progressData?.observation_session_count,
    // sections: 피드 API는 full sections 미포함 — key_points fallback 사용
  });

  function handlePress() {
    router.push(
      `/(parent)/growth-report-detail?reportId=${encodeURIComponent(item.growth_report_id)}`,
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${imageData.reportPeriod} 성장리포트 보기`}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 20,
        overflow: "hidden",
        backgroundColor: WHITE,
        shadowColor: NAVY,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 14,
        elevation: 3,
        opacity: pressed ? 0.93 : 1,
      })}
    >
      {/* ── Main Visual ─────────────────────────────────────────────── */}
      {hasPreview ? (
        <GrowthReportFeedImage data={imageData} />
      ) : (
        <MinimalFallback item={item} />
      )}

      {/* ── Action Bar ──────────────────────────────────────────────── */}
      <ActionBar />
    </Pressable>
  );
}

// ─── Fallback (preview 없을 때) ───────────────────────────────────────────────
function MinimalFallback({ item }: { item: GrowthReportFeedItem }) {
  const [, mon] = (item.report_period ?? "").split("-");
  const label = mon ? `${Number(mon)}월 성장리포트` : item.title;
  return (
    <View
      style={{
        backgroundColor: "#EEF9FB",
        paddingHorizontal: 20,
        paddingVertical: 20,
        alignItems: "center",
        gap: 6,
      }}
    >
      <LucideIcon name="file-text" size={22} color={NAVY} />
      <Text
        style={{
          fontSize: 14,
          fontFamily: "Pretendard-SemiBold",
          color: NAVY,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Pretendard-Regular",
          color: C.textMuted,
        }}
      >
        자세히 보기를 탭하세요
      </Text>
    </View>
  );
}

// ─── Action Bar ───────────────────────────────────────────────────────────────
function ActionBar() {
  return (
    <View
      style={{
        backgroundColor: WHITE,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderTopWidth: 1,
        borderTopColor: AQUA_SOFT,
      }}
    >
      <ActionItem icon="heart"           label="좋아요"    />
      <ActionItem icon="message-circle"  label="댓글"      />
      <View style={{ flex: 1 }} />
      <ActionItem icon="instagram"       label="Instagram" />
      <ActionItem icon="download"        label="PDF"       />
    </View>
  );
}

function ActionItem({ icon, label }: { icon: string; label: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}
    >
      <LucideIcon name={icon} size={17} color={C.textMuted} />
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Pretendard-Regular",
          color: C.textMuted,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
