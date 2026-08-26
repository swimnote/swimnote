/**
 * GrowthReportFeedCard — Premium Feed Card (Phase 3A)
 *
 * 구조:
 *   Pressable shell
 *     └── GrowthReportFeedImage  (canonical visual)
 *     └── ActionBar              (아이콘 전용, 텍스트 레이블 제거)
 *
 * Phase 3A 변경:
 *   - Action bar: 텍스트 레이블 제거 → 아이콘만 + "전체 보기 →" CTA
 *   - 카드 shadow 미세조정 (덜 무겁게)
 *   - Fallback 유지
 *
 * DO NOT TOUCH: PDF V3 / API / DB / Render / OTA / Instagram integration
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

const NAVY      = "#0F2742";
const AQUA      = "#25B7CF";
const AQUA_SOFT = "#D9F2F6";
const AQUA_MIST = "#EEF9FB";
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
        // 가볍게 조정된 shadow (덜 무겁게)
        shadowColor: NAVY,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 3,
        opacity: pressed ? 0.93 : 1,
      })}
    >
      {hasPreview ? (
        <GrowthReportFeedImage data={imageData} />
      ) : (
        <MinimalFallback item={item} />
      )}
      <ActionBar onPress={handlePress} />
    </Pressable>
  );
}

// ─── Fallback ─────────────────────────────────────────────────────────────────
function MinimalFallback({ item }: { item: GrowthReportFeedItem }) {
  const [, mon] = (item.report_period ?? "").split("-");
  const label = mon ? `${Number(mon)}월 성장리포트` : item.title;
  return (
    <View
      style={{
        backgroundColor: AQUA_MIST,
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
    </View>
  );
}

// ─── Action Bar ───────────────────────────────────────────────────────────────
// Phase 3A: 아이콘 전용 (텍스트 레이블 제거), "전체 보기 →" CTA
function ActionBar({ onPress }: { onPress: () => void }) {
  return (
    <View
      style={{
        backgroundColor: WHITE,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: AQUA_SOFT,
      }}
    >
      {/* 좌: 소셜 아이콘들 */}
      <IconBtn icon="heart"          />
      <IconBtn icon="message-circle" />

      <View style={{ flex: 1 }} />

      {/* 전체 보기 CTA */}
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          opacity: pressed ? 0.7 : 1,
          marginRight: 8,
        })}
      >
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Pretendard-SemiBold",
            color: AQUA,
            letterSpacing: 0.2,
          }}
        >
          전체 보기
        </Text>
        <LucideIcon name="chevron-right" size={13} color={AQUA} />
      </Pressable>

      {/* 우: 내보내기 아이콘들 */}
      <IconBtn icon="instagram" />
      <IconBtn icon="download"  />
    </View>
  );
}

function IconBtn({ icon }: { icon: string }) {
  return (
    <View style={{ padding: 7 }}>
      <LucideIcon name={icon} size={18} color={C.textMuted} />
    </View>
  );
}
