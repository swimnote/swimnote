/**
 * generateFeedImageAsset.ts
 *
 * GrowthReportFeedImage를 off-screen 렌더링 후 PNG로 캡처하는 유틸.
 *
 * 출력:
 *   { reportId, localUri, width, height, mimeType }
 *
 * 향후 R2/storage 업로드 파이프라인에서 localUri를 사용 가능.
 *
 * 제약:
 *   - Production upload/storage 연결은 이번 Step에서 하지 않음
 *   - PDF V3 수정 금지 — 완전 독립 renderer
 *   - AI 재호출 금지 — canonical source만 사용
 */

import React from "react";
import { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import type { GrowthReportFeedImageData } from "@/components/parent/GrowthReportFeedImage";

// ─── 출력 타입 ───────────────────────────────────────────────────────────────

export interface FeedImageAsset {
  reportId:  string;
  localUri:  string;
  width:     number;
  height:    number;
  mimeType:  "image/png";
}

// ─── 에러 ────────────────────────────────────────────────────────────────────

export class FeedImageAssetError extends Error {
  constructor(
    public code: "CAPTURE_FAILED" | "INVALID_REF" | "NO_DATA",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "FeedImageAssetError";
  }
}

// ─── 캡처 설정 ───────────────────────────────────────────────────────────────

/** 피드 이미지 출력 해상도 — 1080px 기준 (Instagram-compatible) */
export const FEED_IMAGE_WIDTH  = 1080;
/** 4:5 portrait 비율 */
export const FEED_IMAGE_HEIGHT = 1350;

// ─── 캡처 함수 ───────────────────────────────────────────────────────────────

/**
 * off-screen React ref를 ViewShot으로 캡처하여 PNG URI 반환.
 *
 * 사용 패턴:
 *
 *   const imageRef = useRef<View>(null);
 *   // ... render <GrowthReportFeedImage ref={imageRef} data={...} captureWidth={FEED_IMAGE_WIDTH} />
 *   const asset = await captureGrowthReportFeedImage(imageRef, reportId);
 *
 * @param ref     GrowthReportFeedImage 컴포넌트의 ref
 * @param reportId 리포트 ID (출력에 포함)
 */
export async function captureGrowthReportFeedImage(
  ref: React.RefObject<View>,
  reportId: string,
): Promise<FeedImageAsset> {
  if (!ref.current) {
    throw new FeedImageAssetError("INVALID_REF", "GrowthReportFeedImage ref가 준비되지 않았습니다.");
  }

  let localUri: string;
  try {
    localUri = await captureRef(ref, {
      format:  "png",
      quality: 1.0,
      result:  "tmpfile",
      // snapshotContentContainer: false — 기본값 사용
    });
  } catch (err) {
    throw new FeedImageAssetError(
      "CAPTURE_FAILED",
      "피드 이미지 캡처에 실패했습니다.",
      err,
    );
  }

  return {
    reportId,
    localUri,
    width:    FEED_IMAGE_WIDTH,
    height:   FEED_IMAGE_HEIGHT,
    mimeType: "image/png",
  };
}

// ─── 헬퍼: GrowthReportFeedImageData 생성 ────────────────────────────────────

export interface BuildFeedImageDataParams {
  reportId:      string;
  reportPeriod:  string;
  studentName:   string;
  poolName?:     string;
  summaryText:   string;
  headline:      string;
  keyPoints:     string[];
  curriculumPct?: number;
  observationSessionCount?: number;
  /** 실제 섹션 데이터 — 있을 경우 key_points 대신 사용 */
  sections?: Record<string, { text?: string }>;
}

/**
 * API 응답으로부터 GrowthReportFeedImageData를 생성.
 * canonical source (sns_summary + summary_text) 사용 — 새 AI 호출 금지.
 */
export function buildFeedImageData(params: BuildFeedImageDataParams): GrowthReportFeedImageData {
  const {
    reportId, reportPeriod, studentName, poolName,
    summaryText, headline, keyPoints,
    curriculumPct, observationSessionCount,
    sections,
  } = params;

  // non-empty sections → growth points
  const FEED_SECTION_ORDER = [
    "swimming_progress",
    "longitudinal_comparison",
    "core_growth",
    "behavioral_strengths",
    "parent_support",
  ] as const;

  const growthSections: Array<{ key: string; text: string }> = sections
    ? FEED_SECTION_ORDER
        .reduce<Array<{ key: string; text: string }>>((acc, key) => {
          const text = (sections[key]?.text ?? "").trim();
          if (text) acc.push({ key, text });
          return acc;
        }, [])
        .slice(0, 3)
    : [];

  return {
    reportId,
    reportPeriod,
    studentName,
    poolName,
    headline,
    keyPoints,
    summaryText,
    curriculumPct,
    hasEnoughData: (observationSessionCount ?? 0) >= 3,
    growthSections,
  };
}
