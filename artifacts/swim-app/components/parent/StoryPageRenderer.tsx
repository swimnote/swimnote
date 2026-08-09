/**
 * StoryPageRenderer.tsx  —  V3 Editorial Design
 *
 * 1080×1920 (9:16) Story 이미지 캡처용 off-screen 렌더러.
 * - 360×640 view, captureRef pixelRatio 3 → 1080×1920
 * - 디자인 원칙: Editorial / Minimal / Premium
 *   사진 > 한줄평 > 브랜딩 순서
 * - 카드 UI, 테두리, 과한 그림자, 이모지, 광고 문구 없음
 * - 담당 선생님 / 반 이름 제거 (외부 Instagram 사용자 기준 불필요)
 * - 수영장 이름 + SWIMNOTE footer (LEFT / RIGHT)
 */
import React, { forwardRef } from "react";
import {
  Image as RNImage,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Image as ExpoImage } from "expo-image";

// ── 캔버스 크기 (pixelRatio 3 → 1080×1920) ───────────────────────────────
export const STORY_W = 360;
export const STORY_H = 640;

// Instagram UI 안전 여백 (실기기 검증값)
// 상단 250px, 하단 130px 가림 → SAFE_TOP 48 / SAFE_BOTTOM 80
const SAFE_TOP    = 48;
const SAFE_BOTTOM = 80;
const FOOTER_H    = 38; // branding footer 높이

// Story 브랜드 팔레트
const NAVY  = "#1E3A5F"; // 핵심 브랜드 네이비
const WHITE = "#FFFFFF";

// ── 날짜 포맷: "08.09  SAT" ──────────────────────────────────────────────
const WEEKDAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd}  ${WEEKDAYS_EN[d.getDay()]}`;
}

// ── 사진 그리드 분할 (최대 10장, +N 없음) ─────────────────────────────────
// 1장: 1행1열 / 2장: 1행2열 / 3~4장: 2행(ceil/2) /
// 5~6장: 2행3열 / 7~8장: 2행4열 / 9~10장: 2행5열
function splitIntoRows(photos: StoryPhoto[]): StoryPhoto[][] {
  const n   = Math.min(photos.length, 10);
  const arr = photos.slice(0, n);
  if (n <= 2) return [arr];
  if (n <= 4) {
    const h = Math.ceil(n / 2);
    return [arr.slice(0, h), arr.slice(h)];
  }
  if (n <= 6) return [arr.slice(0, 3), arr.slice(3)];
  if (n <= 8) return [arr.slice(0, 4), arr.slice(4)];
  return [arr.slice(0, 5), arr.slice(5)]; // 9~10
}

// ── 공개 타입 ─────────────────────────────────────────────────────────────
export interface StoryPhoto {
  id:  string;
  uri: string; // 로컬 캐시 URI 또는 원본 URI
}

export interface StoryPageData {
  lessonDate: string; // "2026-08-09"
  poolName:   string; // 수영장 이름 (footer LEFT, 하드코딩 금지)
  photos?:    StoryPhoto[]; // 최대 10장
  bodyText:   string; // AI 한줄평 (50~90자 목표)
  pageNum:    number;
  totalPages: number;
}

// ── 렌더러 ────────────────────────────────────────────────────────────────
const StoryPageRenderer = forwardRef<View, { page: StoryPageData }>(
  ({ page }, ref) => {
    const hasPhotos  = (page.photos?.length ?? 0) > 0;
    const dateLabel  = formatDate(page.lessonDate);
    const photoRows  = hasPhotos ? splitIntoRows(page.photos ?? []) : [];

    return (
      <View ref={ref} style={s.canvas} collapsable={false}>

        {/* ── 안전영역 콘텐츠: date / photos / summary ──────────────────── */}
        <View style={s.safeZone}>

          {/* 날짜 — 상단 좌측, 심플 텍스트 (박스/pill 없음) */}
          <View style={s.dateRow}>
            <Text style={s.dateText}>{dateLabel}</Text>
          </View>

          <View style={{ height: 10 }} />

          {/* 사진 블록 — full-width, flex:1 (최대한 확대) */}
          <View style={s.photoBlock}>
            {photoRows.map((rowPhotos, rowIdx) => (
              <View
                key={rowIdx}
                style={[s.photoRow, rowIdx > 0 && { marginTop: 3 }]}
              >
                {rowPhotos.map((photo, colIdx) => (
                  <ExpoImage
                    key={photo.id}
                    source={{ uri: photo.uri }}
                    style={[s.photoCell, colIdx > 0 && { marginLeft: 3 }]}
                    contentFit="cover"
                  />
                ))}
              </View>
            ))}
          </View>

          <View style={{ height: 12 }} />

          {/* AI 한줄평 — 라벨 없음, 텍스트 직접 표시 */}
          {!!page.bodyText && (
            <View style={s.summaryWrap}>
              <Text style={s.summaryText} numberOfLines={5}>
                {page.bodyText}
              </Text>
            </View>
          )}

        </View>

        {/* ── Footer: 수영장 이름 (L) + SWIMNOTE (R) ───────────────────── */}
        {/* 카드 박스 없음, 배경색 없음 — 여백과 typography만으로 구분 */}
        <View style={s.footer}>
          <Text style={s.poolNameText} numberOfLines={1}>
            {page.poolName}
          </Text>
          <View style={s.swimnoteRow}>
            <RNImage
              source={require("../../assets/images/swimnote-logo.png")}
              style={s.swimnoteLogo}
              resizeMode="contain"
            />
            <Text style={s.swimnoteText}>SWIMNOTE</Text>
          </View>
        </View>

      </View>
    );
  },
);

StoryPageRenderer.displayName = "StoryPageRenderer";
export default StoryPageRenderer;

// ── 스타일 ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // 캔버스 — 흰 배경, 오버플로우 숨김
  canvas: {
    width:           STORY_W,
    height:          STORY_H,
    backgroundColor: WHITE,
    overflow:        "hidden",
  },

  // 안전영역 flex 컨테이너
  // top=SAFE_TOP(48), bottom=SAFE_BOTTOM(80) → height=512px
  safeZone: {
    position: "absolute",
    top:      SAFE_TOP,
    left:     0,
    right:    0,
    bottom:   SAFE_BOTTOM,
    // flex column (기본값)
  },

  // 날짜 행
  dateRow: {
    paddingHorizontal: 20,
    paddingTop:        14,
  },
  dateText: {
    fontSize:      13,
    fontFamily:    "Pretendard-SemiBold",
    color:         NAVY,
    lineHeight:    18,
    letterSpacing: 0.3,
  },

  // 사진 블록 — flex:1 (나머지 공간 전부)
  // paddingH 없음: 사진이 캔버스 전체 폭(360px) 사용
  photoBlock: {
    flex: 1,
  },

  // 사진 행 — 행별로 높이를 균등 분할 (flex:1)
  photoRow: {
    flex:          1,
    flexDirection: "row",
  },

  // 사진 셀 — 열별로 폭 균등 분할 (flex:1)
  // borderRadius 없음, 테두리 없음, 그림자 없음
  photoCell: {
    flex:            1,
    backgroundColor: "#E5E7EB",
  },

  // 한줄평
  summaryWrap: {
    paddingHorizontal: 20,
    paddingBottom:     8,
  },
  summaryText: {
    fontSize:   14,
    fontFamily: "Pretendard-Medium",
    color:      "#1E293B", // near-black, 높은 가독성
    lineHeight: 22,
    // left alignment (기본값)
  },

  // Footer — absolute, bottom=SAFE_BOTTOM-FOOTER_H 에 위치
  // box/배경색/버튼 형태 없음
  footer: {
    position:          "absolute",
    bottom:            SAFE_BOTTOM - FOOTER_H, // 80 - 38 = 42
    left:              0,
    right:             0,
    height:            FOOTER_H,
    paddingHorizontal: 20,
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
  },

  // 수영장 이름 (LEFT)
  // Pretendard SemiBold, 네이비, 너무 작거나 연하지 않게
  poolNameText: {
    fontSize:    12,
    fontFamily:  "Pretendard-SemiBold",
    color:       NAVY,
    flex:        1,
    marginRight: 8,
  },

  // SWIMNOTE (RIGHT)
  swimnoteRow: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           4,
  },
  swimnoteLogo: {
    width:   18,
    height:  18,
    opacity: 0.9,
  },
  swimnoteText: {
    fontSize:      12,
    fontFamily:    "Pretendard-Bold",
    color:         NAVY,
    letterSpacing: 0.5,
  },
});
