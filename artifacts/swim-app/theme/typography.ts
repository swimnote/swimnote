// ─── 스윔노트 디자인 시스템 — Typography 토큰 ────────────────────────────────
// fontFamily 문자열을 컴포넌트에 직접 작성하지 않습니다.
// textStyle preset을 spread하여 사용합니다.
//
// 주의: 탭 바 Text에 fontFamily Pretendard 사용 시 iOS에서 한글 받침
//       세로 클리핑 발생 → lineHeight를 반드시 명시합니다.

export const fontFamily = {
  regular:  "Pretendard-Regular",
  semibold: "Pretendard-SemiBold",
  bold:     "Pretendard-Bold",
} as const;

// ── 사이즈 스케일 ────────────────────────────────────────────────────────────
export const fontSize = {
  xs:   10,
  sm:   11,
  base: 12,
  md:   13,
  body: 14,
  sub:  15,
  lg:   17,
  xl:   20,
  xxl:  24,
} as const;

export const lineHeight = {
  xs:   14,
  sm:   16,
  base: 18,
  md:   19,
  body: 21,
  sub:  22,
  lg:   24,
  xl:   28,
  xxl:  32,
} as const;

// ── 조합 preset ──────────────────────────────────────────────────────────────
export const textStyle = {
  caption:     { fontFamily: fontFamily.regular,  fontSize: fontSize.sm,   lineHeight: lineHeight.sm   },
  body:        { fontFamily: fontFamily.regular,  fontSize: fontSize.body, lineHeight: lineHeight.body },
  bodyMedium:  { fontFamily: fontFamily.semibold, fontSize: fontSize.body, lineHeight: lineHeight.body },
  label:       { fontFamily: fontFamily.regular,  fontSize: fontSize.md,   lineHeight: lineHeight.md   },
  labelMedium: { fontFamily: fontFamily.semibold, fontSize: fontSize.md,   lineHeight: lineHeight.md   },
  base:        { fontFamily: fontFamily.regular,  fontSize: fontSize.base, lineHeight: lineHeight.base },
  sub:         { fontFamily: fontFamily.regular,  fontSize: fontSize.sub,  lineHeight: lineHeight.sub  },
  title:       { fontFamily: fontFamily.semibold, fontSize: fontSize.lg,   lineHeight: lineHeight.lg   },
  heading:     { fontFamily: fontFamily.bold,     fontSize: fontSize.xl,   lineHeight: lineHeight.xl   },
  sectionTitle:{ fontFamily: fontFamily.semibold, fontSize: fontSize.md,   lineHeight: lineHeight.md   },
  badge:       { fontFamily: fontFamily.regular,  fontSize: fontSize.xs,   lineHeight: lineHeight.xs   },
} as const;

export type TextStyleKey = keyof typeof textStyle;
