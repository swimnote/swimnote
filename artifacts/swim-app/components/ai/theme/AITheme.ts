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

// ─── Gesture (Swipe Dismiss 임계값) ──────────────────────────────────────────

export const AIThemeGesture = {
  /** 이 거리 이상 아래로 드래그 시 닫기 (px) */
  swipeDismissDistance: 120,
  /** 이 속도 이상의 플릭 시 닫기 (px/s) */
  swipeDismissVelocity: 700,
  /** 닫기 취소 후 원위치 시 사용할 Spring 임계 (px) */
  swipeCancelDistance:  60,
} as const;

// ─── Layout (State별 영역 비율) ───────────────────────────────────────────────

export const AIThemeLayout = {
  /** RECORDING 시 파형 영역 높이 (px) */
  waveformHeight:    120,
  /** INPUT 상태 최소 입력창 높이 (px) */
  inputMinHeight:    180,
  /** INPUT 상태 최대 입력창 높이 (px) — 이 이상은 TextInput 내부 스크롤 */
  inputMaxHeight:    320,
  /** PROCESSING/RESULT 시 상단 요약 높이 (px) */
  summaryHeight:      56,
} as const;
