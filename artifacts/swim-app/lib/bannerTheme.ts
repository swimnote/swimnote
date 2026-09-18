/**
 * bannerTheme.ts — 배너 색상 공통 파서/헬퍼
 *
 * 사용처:
 *   - ParentPromoStrip (학부모 홈 가로 배너)
 *   - ParentPromoBanner (학부모 홈 광고 배너)
 *   - strip-banner.tsx Super Admin 미리보기
 *   - 향후 WEB Super Admin / 공개 홈페이지 배너
 *
 * 저장 형식:
 *   preset:  "teal" | "purple" | "orange" | "blue" | "green" | "red" | "pink"
 *   custom:  "custom:#BGCOLOR:#TEXTCOLOR"  (예: "custom:#163A5F:#FFFFFF")
 */

// ── Preset 배경+텍스트 색상 ───────────────────────────────────────────────────
// ParentPromoStrip THEME_MAP 기준 값과 동일하게 유지 (backward compat 필수)
export const BANNER_PRESETS: Record<string, { backgroundColor: string; textColor: string }> = {
  teal:   { backgroundColor: "#EEF9FB", textColor: "#163842" },
  purple: { backgroundColor: "#EDE9FE", textColor: "#4C1D95" },
  orange: { backgroundColor: "#FFF7ED", textColor: "#9A3412" },
  blue:   { backgroundColor: "#DBEAFE", textColor: "#1E40AF" },
  green:  { backgroundColor: "#D1FAE5", textColor: "#065F46" },
  red:    { backgroundColor: "#FEE2E2", textColor: "#991B1B" },
  pink:   { backgroundColor: "#FCE7F3", textColor: "#831843" },
};

// Super Admin 칩 UI용 accent 색상 (strip-banner.tsx THEME_COLORS와 동일)
export const BANNER_PRESET_ACCENTS: Record<string, string> = {
  teal: "#1683A3", purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669",  red: "#DC2626",  pink: "#DB2777",
};

export const BANNER_PRESET_KEYS = Object.keys(BANNER_PRESETS);

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** #RRGGBB 형식 검증 */
export function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/** 상대 휘도 (WCAG 2.1 기준) */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 배경색에 따라 가독성 좋은 글자색 자동 추천 */
export function autoTextColor(bgHex: string): string {
  if (!isValidHex(bgHex)) return "#FFFFFF";
  return relativeLuminance(bgHex) > 0.35 ? "#111827" : "#FFFFFF";
}

/** WCAG 대비율 (1~21). 4.5 미만 = AA 미달 경고 권장 */
export function contrastRatio(bg: string, text: string): number {
  if (!isValidHex(bg) || !isValidHex(text)) return 1;
  const l1 = relativeLuminance(bg) + 0.05;
  const l2 = relativeLuminance(text) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}

// ── 핵심 파서 ─────────────────────────────────────────────────────────────────

/**
 * color_theme 문자열을 { backgroundColor, textColor } 로 변환.
 *
 * - preset ("teal" 등)  → BANNER_PRESETS 에서 조회
 * - custom format        → "custom:#BGCOLOR:#TEXTCOLOR" 파싱
 * - 알 수 없는 값         → teal 기본값 (기존 배너 호환)
 */
export function parseBannerTheme(colorTheme: string): { backgroundColor: string; textColor: string } {
  if (colorTheme?.startsWith("custom:")) {
    // "custom:#163A5F:#FFFFFF".split(":") = ["custom", "#163A5F", "#FFFFFF"]
    const parts = colorTheme.split(":");
    const bg   = parts[1] ?? "#1B3A5C";
    const text = parts[2] ?? autoTextColor(bg);
    return {
      backgroundColor: isValidHex(bg)   ? bg   : "#1B3A5C",
      textColor:       isValidHex(text) ? text : autoTextColor(isValidHex(bg) ? bg : "#1B3A5C"),
    };
  }
  return BANNER_PRESETS[colorTheme] ?? BANNER_PRESETS.teal;
}

/** custom 색상을 color_theme 필드 저장 형식으로 직렬화 */
export function serializeCustomTheme(bg: string, text: string): string {
  return `custom:${bg}:${text}`;
}
