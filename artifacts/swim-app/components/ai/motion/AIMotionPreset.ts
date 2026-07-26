/**
 * AIMotionPreset — SwimNote AI UI Framework V1.0
 * 모든 AI 애니메이션 프리셋 단일 관리
 *
 * 의존: AITheme, AIPersonality
 * 사용: useAIMotion, AI 컴포넌트들
 *
 * TODO: Reanimated 4 withSpring / withTiming 실제 구현
 */

import { AIThemeDuration, AIThemeSpring } from '../theme/AITheme';
import { AIPersonalityInteraction } from '../theme/AIPersonality';

// ─── Modal ────────────────────────────────────────────────────────────────────

export const modalMotion = {
  /** 모달 등장 — scale + opacity */
  open: {
    initialScale:   0.92,
    initialOpacity: 0,
    spring: AIThemeSpring.gentle,
    // TODO: withSpring(1, AIThemeSpring.gentle) 구현
  },
  /** 모달 퇴장 */
  close: {
    targetScale:   0.92,
    targetOpacity: 0,
    duration: AIThemeDuration.normal,
    // TODO: withTiming 구현
  },
  /** 백드롭 dim */
  backdrop: {
    targetOpacity: 0.5,
    duration: AIThemeDuration.normal,
  },
} as const;

// ─── Section (입력창 ↔ 응답창 전환) ──────────────────────────────────────────

export const sectionMotion = {
  expand: {
    spring: AIThemeSpring.smooth,
    // TODO: height withSpring 구현
  },
  collapse: {
    spring: AIThemeSpring.smooth,
  },
} as const;

// ─── Card ─────────────────────────────────────────────────────────────────────

export const cardMotion = {
  /** 응답 카드 펼쳐짐 */
  reveal: {
    initialTranslateY: 16,
    initialOpacity:     0,
    spring: AIThemeSpring.smooth,
    // TODO: 구현
  },
  /** 카드 사라짐 */
  dismiss: {
    targetOpacity: 0,
    duration: AIThemeDuration.fast,
  },
} as const;

// ─── Button ───────────────────────────────────────────────────────────────────

export const buttonMotion = {
  press: {
    scale: AIPersonalityInteraction.buttonPressScale,
    spring: AIThemeSpring.snappy,
    // TODO: useAnimatedStyle + GestureDetector 구현
  },
} as const;

// ─── Loading ──────────────────────────────────────────────────────────────────

export const loadingMotion = {
  /** Shimmer — LinearGradient 이동 */
  shimmer: {
    // TODO: withRepeat + withTiming 구현
  },
  /** Pulse — opacity 반복 */
  pulse: {
    minOpacity: 0.4,
    maxOpacity: 1.0,
    // TODO: withRepeat 구현
  },
} as const;

// ─── Typing ───────────────────────────────────────────────────────────────────

export const typingMotion = {
  /** 글자 순차 표시 */
  // TODO: interval 기반 문자열 slice 구현
} as const;

// ─── Feedback ─────────────────────────────────────────────────────────────────

export const feedbackMotion = {
  /** 성공 — scale bounce */
  success: {
    scale: [1, 1.12, 0.96, 1.04, 1],
    spring: AIThemeSpring.snappy,
    // TODO: withSequence 구현
  },
  /** 오류 — 좌우 shake */
  errorShake: {
    amplitude: AIPersonalityInteraction.errorShakeAmplitude,
    count:     AIPersonalityInteraction.errorShakeCount,
    // TODO: withSequence + withTiming 구현
  },
  /** 전체 실패 — fade */
  errorFade: {
    targetOpacity: 0,
    duration: AIThemeDuration.normal,
    // TODO: withTiming 구현
  },
} as const;

// ─── Stream (결과 영역 height 자연스럽게 확장) ────────────────────────────────

export const streamMotion = {
  /** 스트리밍 응답에 따라 height 확장 */
  expand: {
    spring: AIThemeSpring.gentle,
    // TODO: 구현
  },
} as const;

// ─── Permission ───────────────────────────────────────────────────────────────

export const permissionMotion = {
  /** 권한 팝업 시 모달 살짝 후퇴 */
  backdropPush: {
    targetScale:  0.97,
    duration: AIThemeDuration.fast,
    // TODO: 구현
  },
} as const;
