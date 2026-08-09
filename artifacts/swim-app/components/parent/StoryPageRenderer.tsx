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
// → 실제 콘텐츠 안전 영역: 640 - (상단여유 48) - (하단여유 80) = 512px
// SAFE_TOP 48: Instagram 상단 UI와 날짜 잘림 방지 (실기기 검증 후 24→48)
const SAFE_TOP = 48;
const SAFE_BOTTOM = 80;
const CONTENT_H = STORY_H - SAFE_TOP - SAFE_BOTTOM; // 512px

// 워터마크 높이 (로고 확대에 맞게 36→50)
const WATERMARK_H = 50;

// ── 동적 사진 그리드 헬퍼 ────────────────────────────────────────────────────
// 사진 개수에 따라 행별로 분할 (최대 10장, +N 없음)
// 1장: 1행 1열 / 2장: 1행 2열 / 3~4장: 2행 / 5~6장: 2행 3열 /
// 7~8장: 2행 4열 / 9~10장: 2행 5열
function splitIntoRows(photos: StoryPhoto[]): StoryPhoto[][] {
  const n = Math.min(photos.length, 10);
  const arr = photos.slice(0, n);
  if (n <= 2) return [arr];
  if (n <= 4) { const h = Math.ceil(n / 2); return [arr.slice(0, h), arr.slice(h)]; }
  if (n <= 6) return [arr.slice(0, 3), arr.slice(3)];
  if (n <= 8) return [arr.slice(0, 4), arr.slice(4)];
  return [arr.slice(0, 5), arr.slice(5)]; // 9~10
}

// 사진 개수별 행 높이 — 사진 우선, 사진이 많을수록 작아짐
function getPhotoRowHeight(n: number): number {
  if (n === 1) return 220;
  if (n === 2) return 160;
  if (n <= 4) return 105;
  if (n <= 6) return 92;
  if (n <= 8) return 80;
  return 70; // 9~10
}

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

          {/* ── 사진 영역 (최대 10장, 동적 그리드, +N 없음) ── */}
          {hasPhotos && (() => {
            const ph = page.photos ?? [];
            const rowH = getPhotoRowHeight(Math.min(ph.length, 10));
            return (
              <View style={{ gap: 4 }}>
                {splitIntoRows(ph).map((rowPhotos, rowIdx) => (
                  <View key={rowIdx} style={{ flexDirection: "row", gap: 4, height: rowH }}>
                    {rowPhotos.map(photo => (
                      <ExpoImage
                        key={photo.id}
                        source={{ uri: photo.uri }}
                        style={{ flex: 1, borderRadius: 8, backgroundColor: C.border }}
                        contentFit="cover"
                      />
                    ))}
                  </View>
                ))}
              </View>
            );
          })()}

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
    fontFamily: "Pretendard-Bold",
    color: C.text,
    lineHeight: 18,
  },
  teacherText: {
    fontSize: 11,
    fontFamily: "Pretendard-Medium",
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

  // 본문
  bodyWrap: { flex: 1, overflow: "hidden" },
  bodyText: {
    fontSize: TEXT_FONT_SIZE,
    fontFamily: "Pretendard-Medium",
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
    gap: 8,
  },
  watermarkLogo: { width: 28, height: 28, opacity: 0.8 },
  watermarkText: {
    fontSize: 20,
    fontFamily: "Pretendard-Medium",
    color: C.textMuted,
    letterSpacing: 1,
    opacity: 0.8,
  },
});
