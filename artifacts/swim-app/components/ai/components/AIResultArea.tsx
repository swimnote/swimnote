/**
 * AIResultArea — SwimNote AI UI Framework V1.0
 * AI 응답 카드 + 타이핑 효과
 *
 * - Reanimated charIndex SharedValue → 3글자 단위 배치 setState (per-char 금지)
 * - Reduce Motion 시 전체 텍스트 즉시 표시
 * - 카드 등장: translateY(16→0) + opacity(0→1) (cardEnter)
 * - RESULT/EDITING/COMPLETE에서만 표시
 *
 * 의존: AITheme, AIMotionPreset, Reanimated
 * 사용: Feature Content 컴포넌트
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { runOnJS } from 'react-native-reanimated';
import type { AIState } from '../core/AIContracts';
import { animateCardEnter, animateTypingReveal, animateTypingSkip } from '../motion/AIMotionPreset';
import { useAIReducedMotion } from '../hooks/useAIReducedMotion';
import {
  AIThemeColor,
  AIThemeRadius,
  AIThemeSpacing,
  AIThemeTypography,
} from '../theme/AITheme';

// ─── 배치 크기: setState를 N글자마다 한 번만 ────────────────────────────────
const BATCH_SIZE = 4;

// ─── Stage D 크래시 격리 테스트 플래그 ───────────────────────────────────────
// Stage C (machine.complete() 포함) 테스트에서 크래시 발생 시 true로 변경
// true → Reanimated 타이핑 애니메이션 + useAnimatedReaction 완전 비활성화
// (reducedMotion과 동일한 즉시 텍스트 표시 경로 사용)
const CRASH_TEST_DISABLE_ANIMATION = true;

// ─── Props ────────────────────────────────────────────────────────────────────

interface AIResultAreaProps {
  result:        string;
  state:         AIState;
  /** [WP5] 제공 시 Common Draft를 TextInput으로 표시하여 교사 수정 가능 */
  onChangeText?: (text: string) => void;
}

// ─── AIResultArea ─────────────────────────────────────────────────────────────

export default function AIResultArea({ result, state, onChangeText }: AIResultAreaProps) {
  const visible       = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const reducedMotion = useAIReducedMotion();

  // ── 타이핑 SharedValue ───────────────────────────────────────────────────
  const charIndex   = useSharedValue(0);
  const [displayed, setDisplayed] = useState('');


  // JS 쪽 텍스트 업데이트 (runOnJS 대상 — 배치 처리)
  const updateDisplayed = useCallback((n: number) => {
    setDisplayed(result.slice(0, Math.min(n, result.length)));
  }, [result]);

  // 배치 기반 reaction: 매 BATCH_SIZE 글자마다 setState
  // Stage D에서 CRASH_TEST_DISABLE_ANIMATION=true 이면 selector를 고정값(0)으로
  // 만들어 reaction이 절대 발화하지 않도록 함
  useAnimatedReaction(
    () => CRASH_TEST_DISABLE_ANIMATION ? 0 : Math.floor(charIndex.value / BATCH_SIZE),
    (batch, prev) => {
      'worklet';
      // CRASH_TEST_DISABLE_ANIMATION=true 일 때는 reaction이 절대 발화하지 않도록 함
      // (useEffect의 setDisplayed(result)를 덮어쓰는 버그 방지)
      if (CRASH_TEST_DISABLE_ANIMATION) return;
      if (batch !== prev) {
        runOnJS(updateDisplayed)(batch * BATCH_SIZE);
      }
    },
    [updateDisplayed],
  );

  // 결과 텍스트가 바뀌거나 visible 전환 시 타이핑 시작
  // Stage D: CRASH_TEST_DISABLE_ANIMATION=true 이면 즉시 표시 (animation 없음)
  useEffect(() => {
    if (visible && result) {
      if (reducedMotion || CRASH_TEST_DISABLE_ANIMATION) {
        charIndex.value = result.length;
        setDisplayed(result);
      } else {
        setDisplayed('');
        animateTypingReveal(charIndex, result.length, false);
      }
    } else {
      cancelAnimation(charIndex);
      charIndex.value = 0;
      setDisplayed('');
    }
    return () => {
      cancelAnimation(charIndex);
    };
  }, [result, visible, reducedMotion]);

  // ── 카드 등장 애니메이션 ─────────────────────────────────────────────────
  const cardTranslateY = useSharedValue(16);
  const cardOpacity    = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      animateCardEnter(cardTranslateY, cardOpacity, reducedMotion);
    } else {
      cardTranslateY.value = 16;
      cardOpacity.value    = 0;
    }
    return () => {
      cancelAnimation(cardTranslateY);
      cancelAnimation(cardOpacity);
    };
  }, [visible, reducedMotion]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity:   cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  if (!visible) return null;

  const isComplete = displayed.length >= result.length;

  return (
    <Animated.View style={[styles.card, cardStyle]}>
      {/* 헤더 */}
      <Animated.View style={styles.labelRow}>
        <Text style={styles.label}>AI 작성 결과</Text>

        {/* 타이핑 중 → Skip 버튼 */}
        {!isComplete && !reducedMotion && (
          <Pressable
            onPress={() => {
              animateTypingSkip(charIndex, result.length);
              setDisplayed(result);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.skipLabel}>건너뛰기</Text>
          </Pressable>
        )}
      </Animated.View>

      {/* 내용 텍스트 — [WP5] onChangeText 제공 시 TextInput(편집 가능), 없으면 Text(타이핑 애니메이션) */}
      {onChangeText ? (
        <TextInput
          style={[styles.resultText, styles.resultInput]}
          value={result}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          placeholder="(AI 작성 결과 없음)"
          placeholderTextColor={AIThemeColor.textSub}
        />
      ) : (
        <Text style={styles.resultText}>
          {displayed}
          {/* 타이핑 커서 */}
          {!isComplete && <Text style={styles.cursor}>|</Text>}
        </Text>
      )}
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius:    AIThemeRadius.card,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    padding:         AIThemeSpacing.element,
  },
  labelRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   AIThemeSpacing.tight,
  },
  label: {
    ...AIThemeTypography.label,
    color: AIThemeColor.primary,
  },
  skipLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  resultText: {
    ...AIThemeTypography.result,
    color: AIThemeColor.text,
  },
  /** [WP5] Common Draft 편집 시 TextInput 최소 높이 */
  resultInput: {
    minHeight: 80,
    paddingTop: 0,
    paddingBottom: 4,
  },
  cursor: {
    color:    AIThemeColor.primary,
    opacity:  0.8,
  },
});
