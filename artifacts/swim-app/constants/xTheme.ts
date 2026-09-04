/**
 * SWIMNOTE X — 단일 디자인 토큰 소스
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  NAUTIC BLUE + YACHT BLUE  2-tone X Color System               │
 * │                                                                  │
 * │  NAUTIC BLUE  — 깊이 · 묵직함 · 브랜드 중심 · 강한 surface     │
 * │                 header / bottom nav / primary CTA               │
 * │                                                                  │
 * │  YACHT BLUE   — 세련됨 · 청색감 · elevated surface              │
 * │                 icon · selected state · secondary accent        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * 목표: 깊고 묵직한 블루인데, 한 단계 밝은 요트블루가 섞여서
 *       답답하지 않고 세련된 느낌 (프리미엄 자동차/요트 감성)
 *
 * 금지: neon, gaming, 과도한 gradient, dark futuristic, 화면별 hex 하드코딩
 */

export const X = {
  // ── 앱 구조 ──────────────────────────────────────────────────────────────
  /** X 모드 앱 배경 — 살짝 차가운 청색 톤 */
  background:         '#EEF3FA',
  backgroundStrong:   '#E4EDF8',

  // ── 서피스 ───────────────────────────────────────────────────────────────
  /** 카드/모달 배경 */
  surface:            '#FFFFFF',
  surfaceElevated:    '#F6F9FD',

  // ── NAUTIC BLUE — 헤더/탭/강조 영역 ─────────────────────────────────────
  /** Nautic Primary — header background, bottom nav, primary strong state */
  surfaceNavy:        '#1A4070',
  /** Nautic Strong — absolute darkest (tab bar border, deep shadow) */
  surfaceNavyStrong:  '#0E2A4E',
  /** Nautic Surface Elevated — button/chip surface ON nautic header */
  surfaceNavySoft:    '#1F4C80',
  /** AI 기능 카드 배경 */
  surfaceAI:          '#DCE9F8',

  // ── 프라이머리 = NAUTIC BLUE ──────────────────────────────────────────────
  /** Nautic Primary — main X identity (header bg, strong CTA) */
  primary:            '#1A4070',
  /** Nautic Strong — absolute darkest emphasis */
  primaryStrong:      '#0E2A4E',
  /** Nautic Pressed — press feedback */
  primaryPressed:     '#1F4C80',
  /** Nautic Light Surface — light bg on white screens */
  primarySoft:        '#E0EAF5',
  primarySoftest:     '#EEF3FA',

  // ── 액센트 = YACHT BLUE ───────────────────────────────────────────────────
  /** Yacht Primary — secondary accent, feature cards, active chips */
  accent:             '#2A5EA8',
  /** Yacht Deep — strongest yacht emphasis */
  accentStrong:       '#1D4880',
  /** Yacht Surface Light — chip/badge bg on white surface */
  accentSoft:         '#E8F2FC',
  /** Yacht Mid — borders, dividers on light */
  accentMid:          '#BACDE8',

  // ── AI 하이라이트 = YACHT SOFT ────────────────────────────────────────────
  /** Yacht Soft — AI icons, active secondary controls */
  ai:                 '#4878BC',
  /** Yacht Airsurface — AI card / message bg */
  aiSoft:             '#DBE9F8',
  aiMid:              '#A4C5EC',

  // ── 네이비 서피스 위 텍스트 ────────────────────────────────────────────────
  /** Cool off-white — reduces glare vs pure white; 9.0:1 on #1A4070 ✅ AA */
  textOnNavy:         '#F0F4FF',
  textOnNavySoft:     'rgba(255,255,255,0.80)',
  textOnNavyMuted:    'rgba(255,255,255,0.55)',
  textOnNavyFaint:    'rgba(255,255,255,0.35)',

  // ── 라이트 서피스 위 텍스트 ───────────────────────────────────────────────
  text:               '#14283D',
  textStrong:         '#1A4070',   // = Nautic Primary
  textSecondary:      '#4A6080',
  textMuted:          '#7A92A8',

  // ── 테두리 ───────────────────────────────────────────────────────────────
  border:             '#CAD6E8',
  borderStrong:       '#A6BEDA',
  divider:            '#E2EDF8',
  borderCard:         '#DCE8F4',

  // ── 바텀 탭 ──────────────────────────────────────────────────────────────
  // 탭바 배경 = surfaceNavy (Nautic Primary)
  // tabActive: 배경과 충분한 contrast → 흰색 유지
  tabActive:          '#FFFFFF',
  /** Yacht muted — inactive tab icon/text; #0E2A4E 위 ~4.1:1 contrast ✅ */
  tabInactive:        '#8AB0D4',

  // ── 배지 ─────────────────────────────────────────────────────────────────
  badge:              '#1A4070',
  badgeText:          '#FFFFFF',
  badgeSoft:          '#E0EAF5',
  badgeSoftText:      '#1D4880',

  // ── pending ───────────────────────────────────────────────────────────────
  pending:            '#B7791F',
  pendingLight:       '#F8EED8',
} as const;

/** mode 값으로 X 모드인지 확인하는 헬퍼 */
export function isXMode(mode: string | null | undefined): boolean {
  return mode === 'x' || mode === 'x_pending';
}

/** X 모드에서 헤더 배경색 */
export const X_HEADER_BG = X.surfaceNavy;
/** X 모드에서 탭바 액티브 컬러 */
export const X_TAB_ACTIVE = X.tabActive;
