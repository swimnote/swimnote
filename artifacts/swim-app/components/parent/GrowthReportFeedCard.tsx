/**
 * GrowthReportFeedCard — Feed shell (REDESIGN FROM ZERO)
 *
 * 역할: 피드 전폭 white 게시물 컨테이너.
 * 내부 UI는 GrowthReportFullFeed에 완전 위임.
 *
 * shadow/card/radius 없음 — Instagram 스타일 피드 전폭 divider 구조.
 * PDF V3 / API / DB / Render / OTA 수정 금지.
 */

import React from "react";
import { View } from "react-native";
import { GrowthReportFullFeed } from "@/components/parent/GrowthReportFullFeed";
import type { CurriculumProgressData } from "@/components/CurriculumProgressGauge";

const DIVIDER = "#EBF1F7";

// ─── 외부 공유 타입 ───────────────────────────────────────────────────────────
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

export function GrowthReportFeedCard({ item, studentName, poolName, progressData }: Props) {
  return (
    <View style={{
      backgroundColor: "#FFFFFF",
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: DIVIDER,
      marginBottom: 24,
    }}>
      <GrowthReportFullFeed
        item={item}
        studentName={studentName}
        poolName={poolName}
        progressData={progressData}
      />
    </View>
  );
}
