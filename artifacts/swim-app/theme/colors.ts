// ─── SWIMNOTE 디자인 시스템 — 색상 토큰 ──────────────────────────────────────
//
// NORMAL SWIMNOTE — Clear Pool Palette (WP-N7S 최종 확정)
//
//   Brand Strong  #1683A3  — primary CTA, strong active, small active text
//   Brand Primary #25B7CF  — brand accent, active icon, selected state
//   Brand Mid     #6BD2DE  — secondary accent, icon surface, decorative
//   Brand Soft    #D9F2F6  — selected bg, chip bg, soft badge
//   Brand Mist    #EEF9FB  — section/surface soft bg
//
// TEXT HIERARCHY (4-tier — WP-N1 fix: textSecondary ≠ textMuted):
//   textStrong    #163842  — large title, heading        (WCAG AA ✅ on bg)
//   textPrimary   #243D47  — normal body                 (WCAG AA ✅ on surface)
//   textSecondary #526C78  — supporting information      (WCAG AA large ✅)
//   textMuted     #6D8898  — low priority / hint only    (large/hint only ⚠️)
//
// ICON 3색 규칙:
//   파랑(#007AFF)  → 탐색·기본행동 (홈, 일정, 검색, 설정)
//   녹색(#00704A)  → 완료·긍정    (출석, 승인, 매출, 저장)
//   주황(#FF6F0F)  → 경고·알림    (결석, 지각, 대기, 삭제)

// ── Clear Pool Brand Palette (WP-N7S) ────────────────────────────────────────
const cpStrong  = "#1683A3";   // Primary CTA, strong active, small accent text
const cpPrimary = "#25B7CF";   // Brand accent, active icon, selected state
const cpMid     = "#6BD2DE";   // Secondary accent, icon surface, decorative
const cpSoft    = "#D9F2F6";   // Selected bg, chip bg, soft badge
const cpMist    = "#EEF9FB";   // Section/surface soft bg

// ── Legacy tokens (WP-N1~N6 호환 유지 — source shifted to Clear Pool) ────────
const mint      = "#25B7CF";   // ← Clear Pool Primary (was #2EC4B6 mint)
const navy      = "#0F2742";   // Legacy navy — tintDark 호환
const mintLight = "#D9F2F6";   // ← Clear Pool Soft (was #E6FAF8)
const orange    = "#F97316";
const blue      = "#2563EB";

// ── Icon system ───────────────────────────────────────────────────────────────
const iconBlue     = "#007AFF";
const iconGreen    = "#00704A";
const iconOrange   = "#FF6F0F";
const iconBlueBg   = "#EAF4FF";
const iconGreenBg  = "#E6F5EF";
const iconOrangeBg = "#FFF2E8";

// ── Palette export (for external access) ─────────────────────────────────────
export const palette = {
  // Clear Pool brand
  cpStrong,
  cpPrimary,
  cpMid,
  cpSoft,
  cpMist,
  // Legacy (호환 유지)
  mint,
  navy,
  mintLight,
  orange,
  blue,
  // Icons
  iconBlue,
  iconGreen,
  iconOrange,
  iconBlueBg,
  iconGreenBg,
  iconOrangeBg,
} as const;

const light = {
  // ── 텍스트 (4-tier hierarchy — Clear Pool 계열) ───────────────────────────
  textStrong:     "#163842",   // Large title / heading — Clear Pool deep
  text:           "#243D47",   // Body text primary
  textPrimary:    "#243D47",   // Alias — semantic primary text
  textSecondary:  "#526C78",   // Supporting information
  textMuted:      "#6D8898",   // Low priority / hint only
  textTertiary:   "#6D8898",   // Alias for textMuted (backward compat)
  textLink:       blue,        // 링크 텍스트 #2563EB

  // ── 배경 (Clear Pool tint 기반) ───────────────────────────────────────────
  background:     "#F5FAFB",   // Clear Pool bg
  backgroundSoft: "#EEF9FB",   // Clear Pool Mist — section soft bg

  // ── 서피스/카드 ───────────────────────────────────────────────────────────
  surface:        "#FFFFFF",   // Standard surface
  surfaceElevated:"#FFFFFF",   // Elevated surface / modal
  card:           "#FFFFFF",   // Card bg

  // ── 라인/경계 ─────────────────────────────────────────────────────────────
  border:         "#D9F2F6",   // Divider — Clear Pool Soft
  borderSoft:     "#EEF9FB",   // Subtle border — Clear Pool Mist
  divider:        "#D9F2F6",   // Alias for border

  // ── Clear Pool Brand Tokens (WP-N7S 확정) ────────────────────────────────
  //
  //   Usage rules:
  //   brandStrong  → primaryAction CTA, small active text (AA for large)
  //   brandPrimary → accent, active icon, selected state, medium/large accent
  //   brandMid     → secondary accent, icon surface bg, decorative
  //   brandSoft    → selected bg, chip bg, soft badge bg
  //   brandMist    → section soft bg, input focus ring bg
  //
  brandStrong:    cpStrong,    // #1683A3
  brandPrimary:   cpPrimary,   // #25B7CF
  brandMid:       cpMid,       // #6BD2DE
  brandSoft:      cpSoft,      // #D9F2F6
  brandMist:      cpMist,      // #EEF9FB

  // Selected state
  selected:       cpPrimary,   // #25B7CF — active/selected indicator color
  selectedSoft:   cpSoft,      // #D9F2F6 — selected background

  // ── 기본 CTA (WP-N3 기준: brandStrong) ───────────────────────────────────
  //
  //   Primary Action: 저장/다음/등록/확인/완료 등 모든 주요 액션
  //   WP-N7S: Clear Pool Strong (#1683A3)
  //
  primaryAction:        cpStrong,      // #1683A3
  primaryActionPressed: "#116285",     // Clear Pool Strong (pressed, darker)
  primaryActionSoft:    cpSoft,        // #D9F2F6 — Clear Pool Soft bg

  // ── 메인 액센트 (레거시 → Clear Pool로 이전) ──────────────────────────────
  primary:        mint,         // #25B7CF (Clear Pool Primary)
  tint:           mint,         // #25B7CF (Clear Pool Primary)
  tintDark:       navy,         // #0F2742 (legacy)
  tintLight:      mintLight,    // #D9F2F6 (Clear Pool Soft)
  tabIconDefault: "#C7C7CC",
  tabIconSelected: mint,        // #25B7CF — Clear Pool Primary

  // ── 버튼 컬러 (레거시 — 신규 코드는 primaryAction 사용) ──────────────────
  button:          orange,
  buttonSecondary: blue,

  // ── 아이콘 3색 시스템 ─────────────────────────────────────────────────────
  iconBlue,
  iconGreen,
  iconOrange,
  iconBlueBg,
  iconGreenBg,
  iconOrangeBg,
  // Legacy category aliases
  iconSchedule: iconBlue,
  iconMember:   iconOrange,
  iconInfo:     iconGreen,

  // ── 파스텔 카드 구분색 (FEATURE_FIXED — 변경 금지) ───────────────────────
  lavender:  "#EEDDF5",
  sky:       "#DCEEFF",
  butter:    "#FFF1BF",
  peach:     "#F9DEDA",
  pinkSoft:  "#F6D8E1",
  mintSoft:  "#E6FAF8",

  // ── 상태 컬러 (SEMANTIC_PROTECTED — 변경 금지) ────────────────────────────
  success:  "#2E9B6F",
  warning:  "#E4A93A",
  error:    "#D96C6C",
  info:     blue,

  // ── 출결 상태 (SEMANTIC_PROTECTED) ───────────────────────────────────────
  present:  "#2E9B6F",
  absent:   "#D96C6C",
  late:     "#E4A93A",

  // ── 회원 상태 (SEMANTIC_PROTECTED) ───────────────────────────────────────
  approved:   "#2E9B6F",
  pending:    "#E4A93A",
  rejected:   "#D96C6C",
  trial:      "#8B5CF6",
  active:     "#2E9B6F",
  expired:    "#C7C7CC",
  suspended:  "#E4A93A",
  cancelled:  "#D96C6C",

  // ── 역할 컬러 (배지/인디케이터용) ────────────────────────────────────────
  superAdmin: "#7C3AED",
  poolAdmin:  mint,    // #25B7CF — Clear Pool Primary
  parent:     mint,    // #25B7CF — Clear Pool Primary

  // ── 비활성/장애 ───────────────────────────────────────────────────────────
  disabled:     "#EBEBEB",
  disabledText: "#C7C7CC",

  // ── 그림자 ────────────────────────────────────────────────────────────────
  shadow: "rgba(0,0,0,0.06)",

  // ── SWIMNOTE X 전용 토큰 (legacy — xTheme.ts가 single source) ────────────
  xBase:         "#111827",
  xSurface:      "#1B2433",
  xAccent:       "#355C7D",
  xAccentStrong: "#23415C",
  xAccentLight:  "#E9EEF3",
  xPending:      "#B7791F",
  xPendingLight: "#F8EED8",
} as const;

const Colors = {
  light,
} as const;

export type ColorScheme = typeof light;

export default Colors;
