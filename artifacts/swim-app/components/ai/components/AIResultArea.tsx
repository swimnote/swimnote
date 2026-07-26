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
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface AIResultAreaProps {
  result: string;
  state:  AIState;
}

// ─── AIResultArea ─────────────────────────────────────────────────────────────

export default function AIResultArea({ result, state }: AIResultAreaProps) {
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
  useAnimatedReaction(
    () => Math.floor(charIndex.value / BATCH_SIZE),
    (batch, prev) => {
      if (batch !== prev) {
        runOnJS(updateDisplayed)(batch * BATCH_SIZE);
      }
    },
  );

  // 결과 텍스트가 바뀌거나 visible 전환 시 타이핑 시작
  useEffect(() => {
    if (visible && result) {
      if (reducedMotion) {
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
    return () => cancelAnimation(charIndex);
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

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <Text style={styles.resultText}>
          {displayed}
          {/* 타이핑 커서 */}
          {!isComplete && <Text style={styles.cursor}>|</Text>}
        </Text>
      </ScrollView>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    flex:            1,
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
  scroll: {
    flex: 1,
  },
  resultText: {
    ...AIThemeTypography.result,
    color: AIThemeColor.text,
  },
  cursor: {
    color:    AIThemeColor.primary,
    opacity:  0.8,
  },
});
