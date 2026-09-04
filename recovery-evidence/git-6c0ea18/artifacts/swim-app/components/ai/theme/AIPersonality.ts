/**
 * AIPersonality — SwimNote AI UI Framework V1.0
 * AI의 행동적 특성 정의 (시각 테마와 분리)
 * "어떻게 느껴지는가" — 타이핑 속도, 딜레이, 햅틱 패턴 등
 *
 * 의존: 없음
 * 사용: useAIMotion, AI 컴포넌트들
 */

// ─── Typing ───────────────────────────────────────────────────────────────────

export const AIPersonalityTyping = {
  /** 글자 하나 표시 간격 (ms) */
  charIntervalMs:   20,
  /** 문장 부호 이후 추가 딜레이 (ms) */
  punctuationDelay: 80,
  /** 응답 시작 전 "생각하는" 딜레이 (ms) */
  thinkingDelay:   600,
} as const;

// ─── Haptic ───────────────────────────────────────────────────────────────────

export const AIPersonalityHaptic = {
  /** 버튼 press */
  buttonPress:   'light'   as const,
  /** 녹음 시작/종료 */
  recordToggle:  'medium'  as const,
  /** AI 응답 완료 */
  resultReady:   'medium'  as const,
  /** 일지 삽입 완료 */
  complete:      'heavy'   as const,
  /** 오류 발생 */
  error:         'medium'  as const,
} as const;

// ─── Motion Style ─────────────────────────────────────────────────────────────

/** 전체적인 모션 느낌 */
export type AIMotionStyle = 'expressive' | 'calm' | 'minimal';

export const AIPersonalityMotionStyle: AIMotionStyle = 'calm';

// ─── Interaction ─────────────────────────────────────────────────────────────

export const AIPersonalityInteraction = {
  /** 버튼 press scale */
  buttonPressScale: 0.96,
  /** 오류 시 shake 진폭 (px) */
  errorShakeAmplitude: 8,
  /** 오류 시 shake 횟수 */
  errorShakeCount: 3,
} as const;

// ─── Loading ──────────────────────────────────────────────────────────────────

export const AIPersonalityLoading = {
  /** Shimmer 애니메이션 주기 (ms) */
  shimmerDurationMs: 1200,
  /** Pulse 애니메이션 주기 (ms) */
  pulseDurationMs:    900,
} as const;
