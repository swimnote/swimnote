// ─── SWIMNOTE 디자인 시스템 — 색상 토큰 ──────────────────────────────────────
//
// NORMAL SWIMNOTE — Sage / Ocean Wave Palette (WP-N1 foundation)
//
//   Sage Strong  #4F6F67  — primary CTA, strong active, small active text (contrast 5.0:1 on surface ✅)
//   Sage Primary #6F9187  — brand accent, active icon, selected state (3.1:1 — large/icon only)
//   Sage Mid     #91ABA3  — secondary accent, icon surface, decorative
//   Sage Soft    #DDE7E3  — selected bg, chip bg, soft badge
//   Sage Mist    #ECF2F0  — section/surface soft bg
//
// TEXT HIERARCHY (4-tier — WP-N1 fix: textSecondary ≠ textMuted):
//   textStrong    #24302E  — large title, heading        (12.7:1 on bg ✅)
//   textPrimary   #35413F  — normal body                 ( 9.9:1 on surface ✅)
//   textSecondary #5E6B68  — supporting information      ( 5.0:1 on surface ✅)
//   textMuted     #74817E  — low priority / hint only    ( 3.5:1 — large/hint only ⚠️)
//
// ICON 3색 규칙:
//   파랑(#007AFF)  → 탐색·기본행동 (홈, 일정, 검색, 설정)
//   녹색(#00704A)  → 완료·긍정    (출석, 승인, 매출, 저장)
//   주황(#FF6F0F)  → 경고·알림    (결석, 지각, 대기, 삭제)

// ── Sage/Ocean Brand Palette (WP-N1) ─────────────────────────────────────────
const sageStrong  = "#4F6F67";   // Primary CTA, strong active, small accent text
const sagePrimary = "#6F9187";   // Brand accent, active icon, selected state
const sageMid     = "#91ABA3";   // Secondary accent, icon surface, decorative
const sageSoft    = "#DDE7E3";   // Selected bg, chip bg, soft badge
const sageMist    = "#ECF2F0";   // Section/surface soft bg

// ── Legacy mint tokens (호환 유지 — WP-N3에서 점진적 migration 예정) ──────────
const mint      = "#2EC4B6";
const navy      = "#0F2742";   // Legacy navy — C.primaryAction은 WP-N3까지 유지
const mintLight = "#E6FAF8";
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
  // Sage/Ocean brand
  sageStrong,
  sagePrimary,
  sageMid,
  sageSoft,
  sageMist,
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
  // ── 텍스트 (WP-N1: 4-tier hierarchy 정상화) ──────────────────────────────
  textStrong:     "#24302E",   // Large title / heading (was: #0F2742 navy)
  text:           "#35413F",   // Body text primary (was: #14283D navy)
  textPrimary:    "#35413F",   // Alias — semantic primary text
  textSecondary:  "#5E6B68",   // Supporting information (was: #64748B, now distinct)
  textMuted:      "#74817E",   // Low priority / hint only (was: #64748B = same as secondary — FIXED)
  textLink:       blue,        // 링크 텍스트 #2563EB

  // ── 배경 (WP-N1: Sage/Ocean tint 기반) ───────────────────────────────────
  background:     "#F4F7F6",   // Brand background (was: #F7F9FB — Sage Mist tone)
  backgroundSoft: "#ECF2F0",   // Sage Mist — section soft bg (was: #F1F4F7)

  // ── 서피스/카드 ───────────────────────────────────────────────────────────
  surface:        "#FBFCFC",   // Standard surface (WP-N1 new token)
  surfaceElevated:"#FFFFFF",   // Elevated surface / modal
  card:           "#FBFCFC",   // Card bg (was: #FFFFFF — now slightly warm, alias of surface)

  // ── 라인/경계 ─────────────────────────────────────────────────────────────
  border:         "#DDE7E3",   // Divider — Sage Soft (was: #E6EAF0)
  borderSoft:     "#ECF2F0",   // Subtle border — Sage Mist (WP-N1 new token)
  divider:        "#DDE7E3",   // Alias for border

  // ── Sage/Ocean Brand Tokens (WP-N1 신규) ─────────────────────────────────
  //
  //   Usage rules:
  //   brandStrong  → primaryAction CTA (WP-N3에서 적용 예정), small active text (4.5:1+ needed)
  //   brandPrimary → accent, active icon, selected state, medium/large accent
  //   brandMid     → secondary accent, icon surface bg, decorative
  //   brandSoft    → selected bg, chip bg, soft badge bg
  //   brandMist    → section soft bg, input focus ring bg
  //
  brandStrong:    sageStrong,   // #4F6F67
  brandPrimary:   sagePrimary,  // #6F9187
  brandMid:       sageMid,      // #91ABA3
  brandSoft:      sageSoft,     // #DDE7E3
  brandMist:      sageMist,     // #ECF2F0

  // Selected state (WP-N1 신규)
  selected:       sagePrimary,  // #6F9187 — active/selected indicator color
  selectedSoft:   sageSoft,     // #DDE7E3 — selected background

  // ── 기본 CTA (WP-N3: brandStrong 전환 완료) ──────────────────────────────
  //
  //   Primary Action: 저장/다음/등록/확인/완료 등 모든 주요 액션
  //   WP-N3 기준: Sage Strong (#4F6F67) — white label contrast 5.6:1 ✅ AA
  //
  primaryAction:        sageStrong,    // #4F6F67 — WP-N3 전환 완료
  primaryActionPressed: "#3D5750",     // Sage Strong (pressed, darker)
  primaryActionSoft:    sageSoft,      // #DDE7E3 — Sage Soft bg

  // ── 메인 액센트 mint legacy ────────────────────────────────────────────────
  // 기존 코드 호환 유지 — WP-N3에서 점진적 migration
  primary:        mint,         // #2EC4B6 (legacy — WP-N3에서 brandPrimary로 전환 예정)
  tint:           mint,         // #2EC4B6 (legacy alias)
  tintDark:       navy,         // #0F2742 (legacy alias)
  tintLight:      mintLight,    // #E6FAF8 (legacy alias)
  tabIconDefault: "#C7C7CC",
  tabIconSelected: mint,        // WP-N3에서 brandPrimary로 전환 예정

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
  poolAdmin:  mint,    // WP-N3에서 brandPrimary로 전환 예정
  parent:     mint,    // WP-N3에서 brandPrimary로 전환 예정

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
