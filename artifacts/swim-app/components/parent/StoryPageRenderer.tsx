/**
 * StoryPageRenderer.tsx
 *
 * 1080×1920 (9:16) Story 이미지를 캡처하기 위한 렌더러.
 * - 실제 화면에는 보이지 않는 off-screen View
 * - 360×640 크기 (pixelRatio 3 → 1080×1920)
 * - 실제 피드 데이터를 그대로 사용
 * - 터치 UI(좋아요/댓글/공유 버튼) 완전 제거
 */
import React, { forwardRef } from "react";
import {
  Image as RNImage,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import Colors from "@/constants/colors";

const C = Colors.light;

// Story 캔버스 크기 (pixelRatio 3 적용 → 1080×1920)
export const STORY_W = 360;
export const STORY_H = 640;

// Instagram UI safe area: 상단 250px, 하단 130px (Story Creator UI 가림)
// → 실제 콘텐츠 안전 영역: 640 - (상단여유 24) - (하단여유 80) = 536px
const SAFE_TOP = 24;
const SAFE_BOTTOM = 80;
const CONTENT_H = STORY_H - SAFE_TOP - SAFE_BOTTOM; // 536px

// 사진 영역 최대 높이 (첫 페이지)
export const MAX_PHOTO_H = 200;

// 워터마크 높이
const WATERMARK_H = 36;

// 텍스트 영역 최대 높이 계산 (첫 페이지: 사진 영역 제외)
export const MAX_TEXT_H_PAGE1 = CONTENT_H - MAX_PHOTO_H - WATERMARK_H - 72; // 헤더(날짜/선생님) 72px
export const MAX_TEXT_H_LATER = CONTENT_H - WATERMARK_H - 52; // 헤더(날짜만) 52px

// fontSize, lineHeight (실제 피드와 동일)
export const TEXT_FONT_SIZE = 13;
export const TEXT_LINE_H = 20;

export interface StoryPhoto {
  id: string;
  uri: string; // 로컬 캐시 URI 또는 원본 URI
}

export interface StoryPageData {
  // 헤더 정보
  lessonDate: string;   // "2026-08-08"
  teacherName: string;
  classGroupName?: string | null;
  // 사진 (첫 페이지에만)
  photos?: StoryPhoto[];
  // 이 페이지에 표시할 본문 텍스트
  bodyText: string;
  // 페이지 번호 정보 (N장일 때)
  pageNum: number;
  totalPages: number;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekdays[d.getDay()]})`;
}

const StoryPageRenderer = forwardRef<View, { page: StoryPageData }>(
  ({ page }, ref) => {
    const isFirstPage = page.pageNum === 1;
    const hasPhotos = isFirstPage && (page.photos?.length ?? 0) > 0;
    const showPageIndicator = page.totalPages > 1;
    const dateLabel = formatDate(page.lessonDate);

    return (
      <View ref={ref} style={styles.canvas} collapsable={false}>
        {/* 배경 */}
        <View style={styles.bg} />

        {/* 안전 영역 콘텐츠 */}
        <View style={styles.contentArea}>

          {/* ── 헤더 ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.dateText}>{dateLabel}</Text>
              <Text style={styles.teacherText} numberOfLines={1}>
                {page.teacherName} 선생님
                {page.classGroupName ? `  ·  ${page.classGroupName}` : ""}
              </Text>
            </View>
            {showPageIndicator && (
              <View style={styles.pageBadge}>
                <Text style={styles.pageBadgeText}>
                  {page.pageNum} / {page.totalPages}
                </Text>
              </View>
            )}
          </View>

          {/* ── 구분선 ── */}
          <View style={styles.divider} />

          {/* ── 사진 영역 (첫 페이지만) ── */}
          {hasPhotos && (
            <View style={styles.photoRow}>
              {(page.photos ?? []).slice(0, 4).map((photo, idx) => (
                <ExpoImage
                  key={photo.id}
                  source={{ uri: photo.uri }}
                  style={[
                    styles.photo,
                    (page.photos ?? []).length === 1 && styles.photoFull,
                    (page.photos ?? []).length === 2 && styles.photoHalf,
                    (page.photos ?? []).length >= 3 && styles.photoThird,
                  ]}
                  contentFit="cover"
                />
              ))}
              {(page.photos ?? []).length > 4 && (
                <View style={[styles.photo, styles.photoThird, styles.moreOverlay]}>
                  <Text style={styles.moreText}>+{(page.photos ?? []).length - 4}</Text>
                </View>
              )}
            </View>
          )}

          {/* ── 본문 ── */}
          {!!page.bodyText && (
            <View style={styles.bodyWrap}>
              <Text style={styles.bodyText}>{page.bodyText}</Text>
            </View>
          )}
        </View>

        {/* ── 워터마크 (FeedCard 외부 하단) ── */}
        <View style={styles.watermark}>
          <RNImage
            source={require("../../assets/images/swimnote-logo.png")}
            style={styles.watermarkLogo}
            resizeMode="contain"
          />
          <Text style={styles.watermarkText}>SWIMNOTE</Text>
        </View>
      </View>
    );
  }
);

StoryPageRenderer.displayName = "StoryPageRenderer";
export default StoryPageRenderer;

const styles = StyleSheet.create({
  canvas: {
    width: STORY_W,
    height: STORY_H,
    backgroundColor: C.background,
    position: "relative",
    overflow: "hidden",
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.background,
  },
  contentArea: {
    position: "absolute",
    top: SAFE_TOP,
    left: 0,
    right: 0,
    bottom: SAFE_BOTTOM + WATERMARK_H,
    backgroundColor: C.card,
    marginHorizontal: 12,
    borderRadius: 18,
    padding: 14,
    gap: 8,
    shadowColor: "#00000018",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  headerLeft: { flex: 1, gap: 3 },
  dateText: {
    fontSize: 13,
    fontFamily: "Pretendard-Regular",
    color: C.text,
    lineHeight: 18,
  },
  teacherText: {
    fontSize: 11,
    fontFamily: "Pretendard-Regular",
    color: C.textSecondary,
    lineHeight: 16,
  },
  pageBadge: {
    backgroundColor: "#EEF2FF",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 8,
  },
  pageBadgeText: {
    fontSize: 10,
    fontFamily: "Pretendard-Regular",
    color: "#6366F1",
  },
  divider: { height: 1, backgroundColor: C.border },

  // 사진
  photoRow: {
    flexDirection: "row",
    gap: 4,
    height: MAX_PHOTO_H,
  },
  photo: {
    height: MAX_PHOTO_H,
    borderRadius: 10,
    backgroundColor: C.border,
  },
  photoFull: { flex: 1 },
  photoHalf: { flex: 1 },
  photoThird: { flex: 1 },
  moreOverlay: {
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Pretendard-Regular",
  },

  // 본문
  bodyWrap: { flex: 1, overflow: "hidden" },
  bodyText: {
    fontSize: TEXT_FONT_SIZE,
    fontFamily: "Pretendard-Regular",
    color: C.text,
    lineHeight: TEXT_LINE_H,
  },

  // 워터마크
  watermark: {
    position: "absolute",
    bottom: SAFE_BOTTOM - WATERMARK_H,
    left: 0,
    right: 0,
    height: WATERMARK_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  watermarkLogo: { width: 20, height: 20, opacity: 0.8 },
  watermarkText: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    color: C.textMuted,
    letterSpacing: 1,
    opacity: 0.8,
  },
});
