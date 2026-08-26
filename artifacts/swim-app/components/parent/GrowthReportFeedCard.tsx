/**
 * GrowthReportFeedCard — Feed Entry Point
 *
 * Phase 3B (Instagram-inspired full report):
 *   - GrowthReportFullFeed로 위임 (전체 내용, truncation 없음)
 *   - 카드 shell: 가로 여백 + 카드 border + 세로 margin
 *   - GrowthReportFeedImage (preview) 완전 제거 — 피드에서 직접 전체 내용 표시
 *
 * DO NOT TOUCH: PDF V3 / API / DB / Render / OTA / AI engine
 */

import React from "react";
import { View } from "react-native";
import { GrowthReportFullFeed } from "@/components/parent/GrowthReportFullFeed";
import type { CurriculumProgressData } from "@/components/CurriculumProgressGauge";

// ─── 색상 ─────────────────────────────────────────────────────────────────────
const NAVY     = "#0D2E5A";
const AQUA_SOFT = "#D9F2F6";

// ─── 외부에서 사용하는 타입 (home.tsx import용) ───────────────────────────────
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
export function GrowthReportFeedCard({ item, studentName, poolName, progressData }: Props) {
  return (
    <View
      style={{
        marginHorizontal: 0,   // 피드 전폭 사용 (Instagram 스타일)
        marginBottom: 12,
        backgroundColor: "#FFFFFF",
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: AQUA_SOFT,
        // 가벼운 shadow
        shadowColor: NAVY,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      <GrowthReportFullFeed
        item={item}
        studentName={studentName}
        poolName={poolName}
        progressData={progressData}
      />
    </View>
  );
}
