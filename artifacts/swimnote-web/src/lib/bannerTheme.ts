/**
 * bannerTheme.ts — WEB 배너 색상 공통 헬퍼
 *
 * APP(swim-app/lib/bannerTheme.ts)과 동일한 저장 형식 해석:
 *   preset:  "teal" | "purple" | "orange" | "blue" | "green" | "red" | "pink"
 *   custom:  "custom:#BGCOLOR:#TEXTCOLOR"
 *
 * APP BANNER_PRESETS와 동일한 색상값 사용 (두 플랫폼 동일 렌더링 보장).
 */

// APP 기준 프리셋 색상 (swim-app/lib/bannerTheme.ts BANNER_PRESETS와 동일값)
export const BANNER_PRESETS: Record<string, { bg: string; text: string }> = {
  teal:   { bg: "#EEF9FB", text: "#163842" },
  purple: { bg: "#EDE9FE", text: "#4C1D95" },
  orange: { bg: "#FFF7ED", text: "#9A3412" },
  blue:   { bg: "#DBEAFE", text: "#1E40AF" },
  green:  { bg: "#D1FAE5", text: "#065F46" },
  red:    { bg: "#FEE2E2", text: "#991B1B" },
  pink:   { bg: "#FCE7F3", text: "#831843" },
};

// WEB 구버전 레거시 프리셋 (Intro.tsx 이전 THEME_MAP) — fallback 유지
const LEGACY_PRESETS: Record<string, { bg: string; text: string }> = {
  navy:   { bg: "#1B3A5C", text: "#fff" },
  sage:   { bg: "#4A7C5F", text: "#fff" },
  mint:   { bg: "#3DB9C4", text: "#1B3A5C" },
  coral:  { bg: "#E07B5F", text: "#fff" },
  dark:   { bg: "#1A1A2E", text: "#fff" },
};

export const BANNER_PRESET_KEYS = Object.keys(BANNER_PRESETS);

// Super Admin 칩 UI용 accent 색상
export const BANNER_PRESET_ACCENTS: Record<string, string> = {
  teal: "#1683A3", purple: "#7C3AED", orange: "#F97316",
  blue: "#2563EB", green: "#059669", red: "#DC2626", pink: "#DB2777",
};

/** #RRGGBB 형식 검증 */
export function isValidHex(hex: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * color_theme 문자열을 { bg, text } 로 변환.
 *
 * APP/WEB/Public 세 곳 모두 동일한 로직 적용:
 *   preset  → BANNER_PRESETS 조회 (APP과 동일한 값)
 *   custom  → "custom:#BGCOLOR:#TEXTCOLOR" 파싱
 *   기타     → legacy preset 시도 → teal 기본값
 */
export function parseBannerTheme(colorTheme: string): { bg: string; text: string } {
  if (!colorTheme) return BANNER_PRESETS.teal;

  if (colorTheme.startsWith("custom:")) {
    const parts = colorTheme.split(":");
    const bg   = parts[1] ?? "#1B3A5C";
    const text = parts[2] ?? "#FFFFFF";
    return {
      bg:   isValidHex(bg)   ? bg   : "#1B3A5C",
      text: isValidHex(text) ? text : "#FFFFFF",
    };
  }

  return BANNER_PRESETS[colorTheme]
    ?? LEGACY_PRESETS[colorTheme]
    ?? BANNER_PRESETS.teal;
}

/** custom 색상을 color_theme 저장 형식으로 직렬화 */
export function serializeCustomTheme(bg: string, text: string): string {
  return `custom:${bg}:${text}`;
}

/** WCAG 상대 휘도 */
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 대비율 (1~21). 3 미만이면 가독성 경고 권장 */
export function contrastRatio(bg: string, text: string): number {
  if (!isValidHex(bg) || !isValidHex(text)) return 1;
  const l1 = relativeLuminance(bg) + 0.05;
  const l2 = relativeLuminance(text) + 0.05;
  return l1 > l2 ? l1 / l2 : l2 / l1;
}
