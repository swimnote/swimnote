/**
 * useAIMotion — SwimNote AI UI Framework V1.0
 * 현재 State에 따른 Reanimated SharedValue + AnimatedStyle 제공
 *
 * 의존: AIContext, AIMotionPreset, useAIReducedMotion
 * 사용: AI 컴포넌트들 (카드 등장, 버튼 press 등)
 *
 * 범위: BaseAIModal 안 (AIProvider Context 필요)
 */

import { useEffect } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useAIContext } from '../core/AIContext';
import {
  animateButtonPress,
  animateButtonRelease,
  animateCardEnter,
  animateCardExit,
  animateLoadingPulse,
  animateLoadingStop,
  animatePermissionRequest,
  animatePermissionReturn,
} from '../motion/AIMotionPreset';
import { useAIReducedMotion } from './useAIReducedMotion';

export function useAIMotion() {
  const { state } = useAIContext();
  const reducedMotion = useAIReducedMotion();

  // ── 상태 파생값 ────────────────────────────────────────────────────────────
  const showInput   = ['INPUT', 'RECORDING', 'EDITING'].includes(state);
  const showResult  = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const showLoading = ['PROCESSING', 'UPLOADING'].includes(state);
  const isRecording = state === 'RECORDING';

  // ── Result Card SharedValues ───────────────────────────────────────────────
  const cardTranslateY = useSharedValue(16);
  const cardOpacity    = useSharedValue(0);

  useEffect(() => {
    if (showResult) {
      animateCardEnter(cardTranslateY, cardOpacity, reducedMotion);
    } else {
      animateCardExit(cardTranslateY, cardOpacity, reducedMotion);
    }
  }, [showResult, reducedMotion]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity:   cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  // ── Loading Pulse SharedValue ─────────────────────────────────────────────
  const loadingOpacity = useSharedValue(1);

  useEffect(() => {
    if (showLoading && !reducedMotion) {
      animateLoadingPulse(loadingOpacity);
    } else {
      animateLoadingStop(loadingOpacity);
    }
  }, [showLoading, reducedMotion]);

  const loadingAnimatedStyle = useAnimatedStyle(() => ({
    opacity: loadingOpacity.value,
  }));

  // ── Permission 모달 축소 SharedValue ──────────────────────────────────────
  const permissionScale = useSharedValue(1);

  useEffect(() => {
    if (state === 'PERMISSION') {
      animatePermissionRequest(permissionScale, reducedMotion);
    } else {
      animatePermissionReturn(permissionScale, reducedMotion);
    }
  }, [state === 'PERMISSION', reducedMotion]);

  const permissionAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: permissionScale.value }],
  }));

  // ── Button Press 팩토리 (각 버튼이 독립 SharedValue 사용) ─────────────────
  function useButtonPress() {
    const scale = useSharedValue(1);
    const buttonStyle = useAnimatedStyle(() => ({
      transform: [{ scale: scale.value }],
    }));
    return {
      buttonStyle,
      onPressIn:  () => animateButtonPress(scale, reducedMotion),
      onPressOut: () => animateButtonRelease(scale, reducedMotion),
    };
  }

  return {
    // 상태 파생
    showInput,
    showResult,
    showLoading,
    isRecording,
    reducedMotion,
    state,

    // 카드 애니메이션
    cardAnimatedStyle,

    // 로딩 애니메이션
    loadingAnimatedStyle,

    // Permission 애니메이션
    permissionAnimatedStyle,

    // 버튼 press 팩토리
    useButtonPress,
  };
}
