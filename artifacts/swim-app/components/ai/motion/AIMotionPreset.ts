/**
 * AIMotionPreset — SwimNote AI UI Framework V1.0
 * 모든 AI 애니메이션 프리셋 단일 관리
 *
 * 의존: AITheme, AIPersonality (Feature import 금지)
 * 사용: useAIMotion, AI 컴포넌트들
 *
 * 구조: 각 카테고리별 animateXxx() 함수 export
 *   - SharedValue를 받아 직접 애니메이션 적용
 *   - reducedMotion 플래그로 접근성 분기
 *   - Feature 코드 없음
 */

import {
  cancelAnimation,
  Easing,
  runOnJS,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  AIPersonalityInteraction,
  AIPersonalityLoading,
  AIPersonalityTyping,
} from '../theme/AIPersonality';
import {
  AIThemeDuration,
  AIThemeGesture,
  AIThemeSpring,
} from '../theme/AITheme';

// ─── 타입 ──────────────────────────────────────────────────────────────────────

export type MotionCallback = () => void;

// ─── Modal ────────────────────────────────────────────────────────────────────

/**
 * modalOpen — 모달 시트 슬라이드 업 + 백드롭 페이드인
 * @param translateY SharedValue (SCREEN_HEIGHT → 0)
 * @param opacity    백드롭 SharedValue (0 → 1)
 */
export function animateModalOpen(
  translateY:   SharedValue<number>,
  opacity:      SharedValue<number>,
  reducedMotion:boolean,
): void {
  'worklet';
  if (reducedMotion) {
    translateY.value = 0;
    opacity.value    = 1;
  } else {
    opacity.value    = withTiming(1, { duration: AIThemeDuration.normal });
    translateY.value = withSpring(0, AIThemeSpring.gentle);
  }
}

/**
 * modalClose — 슬라이드 다운 + 백드롭 페이드아웃 후 콜백
 * JS 콜백을 받으므로 'worklet' 제외 — JS 스레드에서만 호출
 */
export function animateModalClose(
  translateY:    SharedValue<number>,
  opacity:       SharedValue<number>,
  screenHeight:  number,
  reducedMotion: boolean,
  onDone?:       MotionCallback,
): void {
  opacity.value = withTiming(0, { duration: AIThemeDuration.fast });
  if (reducedMotion) {
    translateY.value = screenHeight;
    if (onDone) onDone();
  } else {
    const done = onDone ? runOnJS(onDone) : undefined;
    translateY.value = withTiming(
      screenHeight,
      { duration: AIThemeDuration.normal, easing: Easing.in(Easing.quad) },
      done ? () => { done(); } : undefined,
    );
  }
}

/**
 * swipeDismiss — 스와이프 중 translateY + opacity 동기화
 */
export function applySwipeDrag(
  translateY: SharedValue<number>,
  opacity:    SharedValue<number>,
  dragY:      number,
): void {
  'worklet';
  const clamped = Math.max(0, dragY);
  translateY.value = clamped;
  opacity.value    = Math.max(0, 1 - clamped / AIThemeGesture.swipeDismissDistance);
}

/**
 * swipeCancel — 기준 미달 → Spring 원위치
 */
export function animateSwipeCancel(
  translateY: SharedValue<number>,
  opacity:    SharedValue<number>,
): void {
  'worklet';
  translateY.value = withSpring(0, AIThemeSpring.snappy);
  opacity.value    = withTiming(1, { duration: AIThemeDuration.fast });
}

// ─── Section (입력 ↔ 결과 영역 전환) ─────────────────────────────────────────

export function animateSectionExpand(
  height:        SharedValue<number>,
  targetHeight:  number,
  reducedMotion: boolean,
): void {
  'worklet';
  height.value = reducedMotion
    ? targetHeight
    : withSpring(targetHeight, AIThemeSpring.smooth);
}

export function animateSectionCollapse(
  height:        SharedValue<number>,
  targetHeight:  number,
  reducedMotion: boolean,
): void {
  'worklet';
  height.value = reducedMotion
    ? targetHeight
    : withSpring(targetHeight, AIThemeSpring.smooth);
}

// ─── Card ─────────────────────────────────────────────────────────────────────

/**
 * cardEnter — 결과 카드 펼쳐짐 (translateY + opacity)
 */
export function animateCardEnter(
  translateY:    SharedValue<number>,
  opacity:       SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) {
    translateY.value = 0;
    opacity.value    = 1;
  } else {
    opacity.value    = withTiming(1, { duration: AIThemeDuration.normal });
    translateY.value = withSpring(0, AIThemeSpring.smooth);
  }
}

export function animateCardExit(
  translateY:    SharedValue<number>,
  opacity:       SharedValue<number>,
  reducedMotion: boolean,
  onDone?:       MotionCallback,
): void {
  // JS 콜백 수신 — 'worklet' 제외, JS 스레드에서만 호출
  const done = onDone ? runOnJS(onDone) : undefined;
  opacity.value = withTiming(
    0,
    { duration: AIThemeDuration.fast },
    done ? () => { done(); } : undefined,
  );
  if (!reducedMotion) {
    translateY.value = withTiming(16, { duration: AIThemeDuration.fast });
  }
}

// ─── Button ───────────────────────────────────────────────────────────────────

export function animateButtonPress(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) return;
  scale.value = withSpring(
    AIPersonalityInteraction.buttonPressScale,
    AIThemeSpring.snappy,
  );
}

export function animateButtonRelease(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) return;
  scale.value = withSpring(1, AIThemeSpring.snappy);
}

/**
 * primaryButtonEnter — 버튼 활성화 시 scale bounce
 */
export function animatePrimaryButtonEnter(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) { scale.value = 1; return; }
  scale.value = withSequence(
    withTiming(1.04, { duration: 80 }),
    withSpring(1, AIThemeSpring.snappy),
  );
}

/**
 * disabledTransition — 비활성 → 활성 시 opacity 전환
 */
export function animateDisabledTransition(
  opacity:   SharedValue<number>,
  disabled:  boolean,
): void {
  'worklet';
  opacity.value = withTiming(disabled ? 0.4 : 1, { duration: AIThemeDuration.fast });
}

// ─── Loading / Shimmer ────────────────────────────────────────────────────────

/**
 * shimmerStart — LinearGradient translateX 무한 반복
 * @param x      SharedValue (화면 너비 기준 -1 → +1)
 */
export function animateShimmerStart(x: SharedValue<number>): void {
  'worklet';
  x.value = withRepeat(
    withTiming(1, {
      duration: AIPersonalityLoading.shimmerDurationMs,
      easing: Easing.linear,
    }),
    -1,
    false,
  );
}

export function animateShimmerStop(x: SharedValue<number>): void {
  'worklet';
  cancelAnimation(x);
  x.value = -1;
}

/**
 * loadingPulse — Skeleton opacity 반복 pulsing
 */
export function animateLoadingPulse(opacity: SharedValue<number>): void {
  'worklet';
  opacity.value = withRepeat(
    withSequence(
      withTiming(0.4, { duration: AIPersonalityLoading.pulseDurationMs / 2 }),
      withTiming(1.0, { duration: AIPersonalityLoading.pulseDurationMs / 2 }),
    ),
    -1,
    false,
  );
}

export function animateLoadingStop(opacity: SharedValue<number>): void {
  'worklet';
  cancelAnimation(opacity);
  opacity.value = 1;
}

// ─── Typing ───────────────────────────────────────────────────────────────────

/**
 * typingReveal — 글자 수 SharedValue를 0 → totalChars로 선형 증가
 * 실제 텍스트 자르기는 JS 쪽에서 useAnimatedReaction으로 처리
 */
export function animateTypingReveal(
  charIndex:     SharedValue<number>,
  totalChars:    number,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) {
    charIndex.value = totalChars;
    return;
  }
  charIndex.value = 0;
  charIndex.value = withDelay(
    AIPersonalityTyping.thinkingDelay,
    withTiming(totalChars, {
      duration: totalChars * AIPersonalityTyping.charIntervalMs,
      easing: Easing.linear,
    }),
  );
}

export function animateTypingSkip(
  charIndex:  SharedValue<number>,
  totalChars: number,
): void {
  'worklet';
  cancelAnimation(charIndex);
  charIndex.value = totalChars;
}

// ─── Permission ───────────────────────────────────────────────────────────────

/**
 * permissionRequest — 모달 살짝 축소 (권한 팝업 뜰 때)
 */
export function animatePermissionRequest(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) return;
  scale.value = withTiming(0.97, { duration: AIThemeDuration.fast });
}

export function animatePermissionReturn(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) return;
  scale.value = withSpring(1, AIThemeSpring.smooth);
}

// ─── Error ────────────────────────────────────────────────────────────────────

/**
 * inputErrorShake — 입력창 좌우 흔들기
 */
export function animateInputErrorShake(
  x:             SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  if (reducedMotion) { x.value = 0; return; }
  const amp = AIPersonalityInteraction.errorShakeAmplitude;
  x.value = withSequence(
    ...Array.from({ length: AIPersonalityInteraction.errorShakeCount * 2 }, (_, i) =>
      withTiming(i % 2 === 0 ? amp : -amp, { duration: 50 })
    ),
    withTiming(0, { duration: 50 }),
  );
}

export function animateErrorTransition(
  opacity:       SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  opacity.value = reducedMotion
    ? 1
    : withTiming(1, { duration: AIThemeDuration.normal });
}

export function animateErrorRecovery(
  opacity:       SharedValue<number>,
  reducedMotion: boolean,
): void {
  'worklet';
  opacity.value = reducedMotion
    ? 1
    : withTiming(1, { duration: AIThemeDuration.fast });
}

// ─── Result ───────────────────────────────────────────────────────────────────

/**
 * successBounce — 완료 시 scale bounce
 */
export function animateSuccessBounce(
  scale:         SharedValue<number>,
  reducedMotion: boolean,
  onDone?:       MotionCallback,
): void {
  // JS 콜백 수신 — 'worklet' 제외, JS 스레드에서만 호출
  if (reducedMotion) {
    scale.value = 1;
    if (onDone) onDone();
    return;
  }
  const done = onDone ? runOnJS(onDone) : undefined;
  scale.value = withSequence(
    withTiming(1.08, { duration: 120 }),
    withTiming(0.96, { duration:  80 }),
    withSpring(1, AIThemeSpring.snappy, done ? () => { done(); } : undefined),
  );
}

/**
 * completeTransition — COMPLETE 후 모달 닫기 (딜레이 포함)
 */
export function animateCompleteTransition(
  translateY:    SharedValue<number>,
  opacity:       SharedValue<number>,
  screenHeight:  number,
  reducedMotion: boolean,
  onDone?:       MotionCallback,
): void {
  // JS 콜백 수신 — 'worklet' 제외, JS 스레드에서만 호출
  const delay = reducedMotion ? 0 : 600;
  const done  = onDone ? runOnJS(onDone) : undefined;
  opacity.value    = withDelay(delay, withTiming(0, { duration: AIThemeDuration.fast }));
  translateY.value = withDelay(
    delay,
    withTiming(
      screenHeight,
      { duration: AIThemeDuration.normal },
      done ? () => { done(); } : undefined,
    ),
  );
}

// ─── Reduce Motion Fallbacks ──────────────────────────────────────────────────

/** opacity 전환만 사용하는 범용 페이드 */
export function animateReducedMotionFade(
  opacity:  SharedValue<number>,
  target:   number,
): void {
  'worklet';
  opacity.value = withTiming(target, { duration: AIThemeDuration.fast });
}

/** 레이아웃 즉시 전환 */
export function animateReducedMotionInstantLayout(
  ...values: Array<{ sv: SharedValue<number>; target: number }>
): void {
  'worklet';
  for (const { sv, target } of values) {
    sv.value = target;
  }
}
