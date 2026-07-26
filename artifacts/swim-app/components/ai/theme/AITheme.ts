/**
 * AITheme — SwimNote AI UI Framework V1.0
 * AI 전용 디자인 토큰 (앱 전체 테마와 분리)
 *
 * 의존: 없음
 * 사용: 모든 AI 컴포넌트
 */

// ─── Duration ─────────────────────────────────────────────────────────────────

export const AIThemeDuration = {
  fast:   150,
  normal: 300,
  slow:   500,
} as const;

// ─── Spring Config ────────────────────────────────────────────────────────────

export const AIThemeSpring = {
  /** 빠른 반응 — 버튼 press */
  snappy: { damping: 15, stiffness: 200, mass: 1 },
  /** 자연스러운 전환 — 레이아웃 재배치 */
  smooth: { damping: 20, stiffness: 120, mass: 1 },
  /** 부드러운 등장 — 모달 open/close */
  gentle: { damping: 25, stiffness:  80, mass: 1 },
} as const;

// ─── Radius ───────────────────────────────────────────────────────────────────

export const AIThemeRadius = {
  modal:   24,
  card:    16,
  button:  12,
  input:   12,
  badge:    8,
} as const;

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const AIThemeSpacing = {
  section:  24,
  element:  16,
  tight:     8,
  micro:     4,
} as const;

// ─── Blur ─────────────────────────────────────────────────────────────────────

export const AIThemeBlur = {
  backdrop: 20,
  card:     10,
} as const;

// ─── Color ────────────────────────────────────────────────────────────────────

export const AIThemeColor = {
  primary:      '#3B82F6',  // AI 액션 색상
  background:   '#FFFFFF',
  surfaceLight: '#F8FAFC',
  surfaceDark:  '#1E293B',
  text:         '#0F172A',
  textSub:      '#64748B',
  border:       '#E2E8F0',
  // 피드백
  success:      '#10B981',
  error:        '#EF4444',
  warning:      '#F59E0B',
  // AI 특화
  aiGlow:       'rgba(59, 130, 246, 0.15)',
  aiPulse:      'rgba(59, 130, 246, 0.08)',
} as const;

// ─── Typography ───────────────────────────────────────────────────────────────

export const AIThemeTypography = {
  input: {
    fontSize:   17,
    lineHeight: 26,
    fontWeight: '400' as const,
  },
  result: {
    fontSize:   16,
    lineHeight: 26,
    fontWeight: '400' as const,
  },
  label: {
    fontSize:   13,
    lineHeight: 18,
    fontWeight: '500' as const,
  },
  heading: {
    fontSize:   17,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
} as const;

// ─── Z-Index ──────────────────────────────────────────────────────────────────

export const AIThemeZIndex = {
  backdrop: 100,
  modal:    101,
  toast:    102,
} as const;

// ─── Easing ───────────────────────────────────────────────────────────────────

/** Spring 외 반복 애니메이션(shimmer 등)에 사용 */
export const AIThemeEasing = {
  linear:   [0, 0, 1, 1]    as [number, number, number, number],
  easeOut:  [0, 0, 0.2, 1]  as [number, number, number, number],
  easeIn:   [0.4, 0, 1, 1]  as [number, number, number, number],
} as const;
