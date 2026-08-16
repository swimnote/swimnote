/**
 * SWIMNOTE X — 단일 디자인 토큰 소스
 *
 * 모든 X 관련 색상은 여기서만 관리한다.
 * 개별 파일에 X_ACCENT 등을 하드코딩하지 않는다.
 *
 * 목표: 전문적·프리미엄·AI/데이터 기반·수영교육 플랫폼·신뢰감
 * 금지: neon, gaming, 과도한 gradient, dark futuristic, 과도한 glassmorphism
 */

export const X = {
  // ── 앱 구조 ──────────────────────────────────────────────────────────────
  /** X 모드 앱 배경 (Normal #F5F6FA보다 살짝 차가운 톤) */
  background:         '#F3F6FA',
  backgroundStrong:   '#EBF0F7',

  // ── 서피스 ───────────────────────────────────────────────────────────────
  /** 카드/모달 배경 */
  surface:            '#FFFFFF',
  surfaceElevated:    '#F8FAFC',
  /** X 헤더/강조 영역 — 딥 네이비 */
  surfaceNavy:        '#0F2742',
  surfaceNavyStrong:  '#0A1E30',
  surfaceNavySoft:    '#1A3655',
  /** AI 기능 카드 배경 */
  surfaceAI:          '#EBF4FB',

  // ── 프라이머리 (네이비) ───────────────────────────────────────────────────
  primary:            '#0F2742',
  primaryStrong:      '#0A1E30',
  primaryPressed:     '#162F4E',
  primarySoft:        '#E4EBF4',
  primarySoftest:     '#F0F4F9',

  // ── 액센트 (스틸 블루) ────────────────────────────────────────────────────
  accent:             '#355C7D',
  accentStrong:       '#23415C',
  accentSoft:         '#EEF4FA',
  accentMid:          '#D0DCE8',

  // ── AI 하이라이트 ─────────────────────────────────────────────────────────
  ai:                 '#2C6FAD',
  aiSoft:             '#E8F2FB',
  aiMid:              '#BAD7F0',

  // ── 네이비 서피스 위 텍스트 ────────────────────────────────────────────────
  textOnNavy:         '#FFFFFF',
  textOnNavySoft:     'rgba(255,255,255,0.80)',
  textOnNavyMuted:    'rgba(255,255,255,0.55)',
  textOnNavyFaint:    'rgba(255,255,255,0.35)',

  // ── 라이트 서피스 위 텍스트 ───────────────────────────────────────────────
  text:               '#14283D',
  textStrong:         '#0F2742',
  textSecondary:      '#4A6080',
  textMuted:          '#7A92A8',

  // ── 테두리 ───────────────────────────────────────────────────────────────
  border:             '#D0DCE8',
  borderStrong:       '#B4CADA',
  divider:            '#E8EFF6',
  borderCard:         '#E2EAF2',

  // ── 바텀 탭 ──────────────────────────────────────────────────────────────
  // 탭바 배경 = surfaceNavy (#0F2742).
  // tabActive는 배경과 충분한 contrast 필요 → 흰색
  tabActive:          '#FFFFFF',   // 액티브 탭 — 흰색 (contrast on navy bg)
  tabInactive:        '#5F89B0',   // 비활성 탭 — 중간 톤 (muted blue, not too dark)

  // ── 배지 ─────────────────────────────────────────────────────────────────
  badge:              '#0F2742',
  badgeText:          '#FFFFFF',
  badgeSoft:          '#E4EBF4',
  badgeSoftText:      '#23415C',

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
