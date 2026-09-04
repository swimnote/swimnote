/**
 * StoryPageRenderer.tsx  —  V3 Editorial Design
 *
 * 1080×1920 (9:16) Story 이미지 캡처용 off-screen 렌더러.
 * - 360×640 view, captureRef pixelRatio 3 → 1080×1920
 * - 디자인 원칙: Editorial / Minimal / Premium
 *   사진 > 한줄평 > 브랜딩 순서
 * - 1~4장: 기존 V3 그대로 (2행 균등 그리드)
 * - 5~10장: aspectRatio 기반 Adaptive Collage
 *   penalty = Σ |log(photoAR / cellAR)| 최소 Template 선택
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

// ── 캔버스 크기 (pixelRatio 3 → 1080×1920) ───────────────────────────────
export const STORY_W = 360;
export const STORY_H = 640;

// Instagram UI 안전 여백 (실기기 검증값)
const SAFE_TOP    = 48;
const SAFE_BOTTOM = 80;
const FOOTER_H    = 38;

// Story 브랜드 팔레트
const NAVY  = "#1E3A5F";
const WHITE = "#FFFFFF";
const GAP   = 3; // 사진 셀 간격 (px)

// ── 날짜 포맷: "08.09  SAT" ──────────────────────────────────────────────
const WEEKDAYS_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}.${dd}  ${WEEKDAYS_EN[d.getDay()]}`;
}

// ── 공개 타입 ─────────────────────────────────────────────────────────────
export interface StoryPhoto {
  id:           string;
  uri:          string;          // 로컬 캐시 URI 또는 원본 URI
  width?:       number;          // Image.getSize()로 확보 (optional)
  height?:      number;
  aspectRatio?: number;          // width/height; 미확보 시 penalty=0 (fallback 1.0)
}

export interface StoryPageData {
  lessonDate: string;
  poolName:   string;
  photos?:    StoryPhoto[];
  bodyText:   string;
  pageNum:    number;
  totalPages: number;
}

// ══════════════════════════════════════════════════════════════════════════
// §1  1~4장: 기존 V3 그대로 (splitIntoRows)
// ══════════════════════════════════════════════════════════════════════════

function splitIntoRows(photos: StoryPhoto[]): StoryPhoto[][] {
  const n   = Math.min(photos.length, 4); // 이 함수는 n<=4 전용
  const arr = photos.slice(0, n);
  if (n <= 2) return [arr];
  const h = Math.ceil(n / 2);
  return [arr.slice(0, h), arr.slice(h)];
}

// ══════════════════════════════════════════════════════════════════════════
// §2  5~10장: Adaptive Collage (Template + penalty 선택)
// ══════════════════════════════════════════════════════════════════════════

interface ColDef { flex: number }
interface RowDef { flex: number; cols: ColDef[] }
interface CollageTemplate { id: string; rows: RowDef[] }

/** 균등 컬럼 배열 헬퍼 */
const cols = (n: number): ColDef[] => Array.from({ length: n }, () => ({ flex: 1 }));

/**
 * Template 정의 — 각 Template의 photo 수 = Σ(rows[i].cols.length)
 * 사진 블록 높이 ≈ 428px (안전영역 512 - 날짜42 - 한줄평+gap42)
 * 실제 셀 AR은 computeTemplateARs()로 런타임 계산
 *
 * 설계 원칙:
 *  - 2열 행: cellAR ≈ 1.27~1.70  (landscape)
 *  - 3열 행: cellAR ≈ 0.84~1.23  (near-square / near-landscape)
 *  - 4열 행: cellAR ≈ 0.41~0.62  (portrait)
 */
const TEMPLATES: Record<number, CollageTemplate[]> = {
  5: [
    // T5_W: 2+1+2 — 중앙 한 장이 넓은 landscape 셀 (가로 사진 위주)
    { id: "T5_W", rows: [
      { flex: 1.0,  cols: cols(2) },
      { flex: 0.65, cols: cols(1) },
      { flex: 1.0,  cols: cols(2) },
    ]},
    // T5_L: 2+3 — 상단 landscape, 하단 near-square
    { id: "T5_L", rows: [
      { flex: 1.0, cols: cols(2) },
      { flex: 1.0, cols: cols(3) },
    ]},
    // T5_P: 3+2 — 상단 portrait, 하단 landscape
    { id: "T5_P", rows: [
      { flex: 1.0, cols: cols(3) },
      { flex: 1.0, cols: cols(2) },
    ]},
  ],
  6: [
    // T6_L: 2+2+2 — 3행 모두 landscape 셀 (cellAR≈1.27)
    { id: "T6_L", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
    ]},
    // T6_P: 3+3 — 2행 portrait 셀
    { id: "T6_P", rows: [
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(3) },
    ]},
    // T6_M: 3+2+1 — 마지막 사진이 wide landscape
    { id: "T6_M", rows: [
      { flex: 1.0,  cols: cols(3) },
      { flex: 0.9,  cols: cols(2) },
      { flex: 0.65, cols: cols(1) },
    ]},
  ],
  7: [
    // T7_L: 2+3+2 — 1·3행 landscape, 2행 near-square
    { id: "T7_L", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(2) },
    ]},
    // T7_M: 2+2+3
    { id: "T7_M", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(3) },
    ]},
    // T7_P: 4+3 — portrait 셀
    { id: "T7_P", rows: [
      { flex: 1, cols: cols(4) },
      { flex: 1, cols: cols(3) },
    ]},
  ],
  8: [
    // T8_LL: 2+2+2+2 — 4행 모두 landscape (cellAR≈1.70)
    { id: "T8_LL", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
    ]},
    // T8_M: 2+3+3 — 상단 landscape, 하단 near-square
    { id: "T8_M", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(3) },
    ]},
    // T8_P: 4+4 — portrait 셀
    { id: "T8_P", rows: [
      { flex: 1, cols: cols(4) },
      { flex: 1, cols: cols(4) },
    ]},
  ],
  9: [
    // T9_L: 2+3+2+2 — landscape 위주 (4행)
    { id: "T9_L", rows: [
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(2) },
      { flex: 1, cols: cols(2) },
    ]},
    // T9_M: 3+3+3 — 균등 near-square
    { id: "T9_M", rows: [
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(3) },
    ]},
    // T9_P: 4+3+2 — portrait → near-square → landscape 순
    { id: "T9_P", rows: [
      { flex: 1, cols: cols(4) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(2) },
    ]},
  ],
  10: [
    // T10_L: 2+3+2+3 — 4행, landscape/near-square 교차
    //   2열행 cellAR≈1.58, 3열행 cellAR≈1.23 → 전체 landscape
    { id: "T10_L", rows: [
      { flex: 1.0,  cols: cols(2) },
      { flex: 0.85, cols: cols(3) },
      { flex: 1.0,  cols: cols(2) },
      { flex: 0.85, cols: cols(3) },
    ]},
    // T10_M: 3+4+3 — 3행, near-square / portrait / near-square
    { id: "T10_M", rows: [
      { flex: 1.0, cols: cols(3) },
      { flex: 1.1, cols: cols(4) },
      { flex: 1.0, cols: cols(3) },
    ]},
    // T10_P: 4+3+3 — portrait 셀 위주
    { id: "T10_P", rows: [
      { flex: 1, cols: cols(4) },
      { flex: 1, cols: cols(3) },
      { flex: 1, cols: cols(3) },
    ]},
  ],
};

/**
 * Template의 각 셀 AR을 (렌더 시점 근사값으로) 계산.
 * blockW=360, blockH=428(근사), gap=3
 * 반환: rows × cols 의 2D 배열 (AR값)
 */
function computeTemplateARs(
  t: CollageTemplate,
  blockW = STORY_W,
  blockH = 428,
  gap    = GAP,
): number[][] {
  const totalRowFlex = t.rows.reduce((s, r) => s + r.flex, 0);
  const rowGapTotal  = (t.rows.length - 1) * gap;
  const usableH      = blockH - rowGapTotal;

  return t.rows.map(row => {
    const rowH         = usableH * row.flex / totalRowFlex;
    const totalColFlex = row.cols.reduce((s, c) => s + c.flex, 0);
    const colGapTotal  = (row.cols.length - 1) * gap;
    const usableW      = blockW - colGapTotal;
    return row.cols.map(col => {
      const cellW = usableW * col.flex / totalColFlex;
      return rowH > 0 ? cellW / rowH : 1;
    });
  });
}

/**
 * 사진 목록과 Template 간 crop penalty 계산.
 * penalty = Σ |log(photoAR / cellAR)|
 * aspectRatio 미확보 사진은 fallback=1.0 사용 (penalty 기여 최소화)
 */
function templatePenalty(photos: StoryPhoto[], t: CollageTemplate): number {
  const cellARs = computeTemplateARs(t).flat();
  let total = 0;
  for (let i = 0; i < photos.length; i++) {
    const pAR = photos[i].aspectRatio ?? 1.0;
    const cAR = cellARs[i]           ?? 1.0;
    if (pAR > 0 && cAR > 0) {
      total += Math.abs(Math.log(pAR / cAR));
    }
  }
  return total;
}

/** 5~10장 사진에 대해 최적 Template 선택 */
function selectTemplate(photos: StoryPhoto[]): CollageTemplate {
  const n          = Math.min(photos.length, 10);
  const candidates = TEMPLATES[n];
  if (!candidates || candidates.length === 0) {
    // fallback: n열 1행
    return { id: "fallback", rows: [{ flex: 1, cols: cols(n) }] };
  }
  let best      = candidates[0];
  let bestScore = Infinity;
  for (const t of candidates) {
    const score = templatePenalty(photos, t);
    if (score < bestScore) { bestScore = score; best = t; }
  }
  return best;
}

// ── 렌더러 ────────────────────────────────────────────────────────────────
const StoryPageRenderer = forwardRef<View, { page: StoryPageData }>(
  ({ page }, ref) => {
    const hasPhotos  = (page.photos?.length ?? 0) > 0;
    const dateLabel  = formatDate(page.lessonDate);
    const photos     = page.photos ?? [];
    const n          = Math.min(photos.length, 10);
    const isAdaptive = n >= 5;

    // 1~4장 기존 로직
    const photoRows  = !isAdaptive && hasPhotos ? splitIntoRows(photos) : [];
    // 5~10장 adaptive template
    const template   = isAdaptive ? selectTemplate(photos.slice(0, n)) : null;

    return (
      <View ref={ref} style={s.canvas} collapsable={false}>

        {/* ── 안전영역 콘텐츠 ─────────────────────────────────────────── */}
        <View style={s.safeZone}>

          {/* 날짜 */}
          <View style={s.dateRow}>
            <Text style={s.dateText}>{dateLabel}</Text>
          </View>

          <View style={{ height: 10 }} />

          {/* 사진 블록 */}
          <View style={s.photoBlock}>
            {hasPhotos && !isAdaptive && photoRows.map((rowPhotos, rowIdx) => (
              <View
                key={rowIdx}
                style={[s.photoRow, rowIdx > 0 && { marginTop: GAP }]}
              >
                {rowPhotos.map((photo, colIdx) => (
                  <ExpoImage
                    key={photo.id}
                    source={{ uri: photo.uri }}
                    style={[s.photoCell, colIdx > 0 && { marginLeft: GAP }]}
                    contentFit="cover"
                    cachePolicy="memory"
                  />
                ))}
              </View>
            ))}

            {hasPhotos && isAdaptive && template && (() => {
              let idx = 0;
              return template.rows.map((row, ri) => {
                const rowPhotos = photos.slice(idx, idx + row.cols.length);
                idx += row.cols.length;
                return (
                  <View
                    key={ri}
                    style={[
                      { flex: row.flex, flexDirection: "row" },
                      ri > 0 && { marginTop: GAP },
                    ]}
                  >
                    {row.cols.map((col, ci) => {
                      const photo = rowPhotos[ci];
                      if (!photo) return null;
                      return (
                        <ExpoImage
                          key={photo.id}
                          source={{ uri: photo.uri }}
                          style={[
                            { flex: col.flex, backgroundColor: C.border },
                            ci > 0 && { marginLeft: GAP },
                          ]}
                          contentFit="cover"
                          cachePolicy="memory"
                        />
                      );
                    })}
                  </View>
                );
              });
            })()}
          </View>

          <View style={{ height: 12 }} />

          {/* AI 한줄평 */}
          {!!page.bodyText && (
            <View style={s.summaryWrap}>
              <Text style={s.summaryText} numberOfLines={5}>
                {page.bodyText}
              </Text>
            </View>
          )}

        </View>

        {/* ── Footer: 수영장 이름 (L) + SWIMNOTE (R) ───────────────────── */}
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
  canvas: {
    width:           STORY_W,
    height:          STORY_H,
    backgroundColor: WHITE,
    overflow:        "hidden",
  },
  safeZone: {
    position: "absolute",
    top:      SAFE_TOP,
    left:     0,
    right:    0,
    bottom:   SAFE_BOTTOM,
  },
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
  photoBlock: {
    flex: 1,
  },
  // 1~4장 전용
  photoRow: {
    flex:          1,
    flexDirection: "row",
  },
  photoCell: {
    flex:            1,
    backgroundColor: C.border,
  },
  summaryWrap: {
    paddingHorizontal: 20,
    paddingBottom:     8,
  },
  summaryText: {
    fontSize:   14,
    fontFamily: "Pretendard-Medium",
    color:      C.textStrong,
    lineHeight: 22,
  },
  footer: {
    position:          "absolute",
    bottom:            SAFE_BOTTOM - FOOTER_H,
    left:              0,
    right:             0,
    height:            FOOTER_H,
    paddingHorizontal: 20,
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
  },
  poolNameText: {
    fontSize:    12,
    fontFamily:  "Pretendard-SemiBold",
    color:       NAVY,
    flex:        1,
    marginRight: 8,
  },
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
