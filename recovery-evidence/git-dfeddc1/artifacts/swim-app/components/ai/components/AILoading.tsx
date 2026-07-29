/**
 * AILoading — SwimNote AI UI Framework V1.0
 * PROCESSING / UPLOADING State: Shimmer Skeleton + Reduce Motion 대응
 *
 * - expo-linear-gradient + Reanimated translateX → Shimmer 효과
 * - PROCESSING 이탈 시 cancelAnimation → 누수 없음
 * - Reduce Motion 시 정적 Skeleton (Pulse도 최소화)
 * - JS setInterval 미사용
 *
 * 의존: AITheme, AIMotionPreset, expo-linear-gradient, Reanimated
 * 사용: Feature Content 컴포넌트
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { AIState } from '../core/AIContracts';
import {
  animateLoadingPulse,
  animateLoadingStop,
  animateShimmerStart,
  animateShimmerStop,
} from '../motion/AIMotionPreset';
import { useAIReducedMotion } from '../hooks/useAIReducedMotion';
import {
  AIThemeColor,
  AIThemeRadius,
  AIThemeSpacing,
  AIThemeTypography,
} from '../theme/AITheme';

// ─── Shimmer 폭 (화면 너비 대비 배수) ─────────────────────────────────────────
const SHIMMER_WIDTH = 200; // gradient 너비(px)

// ─── SkeletonLine — Shimmer 막대 ──────────────────────────────────────────────

interface SkeletonLineProps {
  widthPct:      number;   // 0~100
  shimmerX:      SharedValue<number>;
  reducedMotion: boolean;
}

function SkeletonLine({ widthPct, shimmerX, reducedMotion }: SkeletonLineProps) {
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }],
  }));

  return (
    <View style={[styles.skeletonLine, { width: `${widthPct}%` as any }]}>
      {!reducedMotion && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.shimmerWrapper, shimmerStyle]}
        >
          <LinearGradient
            colors={[
              'transparent',
              'rgba(255,255,255,0.65)',
              'transparent',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[StyleSheet.absoluteFill, { width: SHIMMER_WIDTH }]}
          />
        </Animated.View>
      )}
    </View>
  );
}

// ─── AILoading ────────────────────────────────────────────────────────────────

interface AILoadingProps {
  state:    AIState;
  message?: string;
}

export default function AILoading({
  state,
  message = 'AI가 작성 중입니다...',
}: AILoadingProps) {
  const visible       = state === 'PROCESSING' || state === 'UPLOADING';
  const reducedMotion = useAIReducedMotion();

  // Shimmer X: -SHIMMER_WIDTH → 화면 너비 (반복)
  const shimmerX      = useSharedValue(-SHIMMER_WIDTH);
  const pulseOpacity  = useSharedValue(1);

  useEffect(() => {
    if (visible) {
      if (reducedMotion) {
        // Reduce Motion: 약한 Pulse만
        animateLoadingPulse(pulseOpacity);
      } else {
        animateShimmerStart(shimmerX);
      }
    } else {
      animateShimmerStop(shimmerX);
      animateLoadingStop(pulseOpacity);
    }
    return () => {
      animateShimmerStop(shimmerX);
      animateLoadingStop(pulseOpacity);
    };
  }, [visible, reducedMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? pulseOpacity.value : 1,
  }));

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>

      {/* Skeleton Cards */}
      <Animated.View style={[styles.skeletonCard, pulseStyle]}>
        <SkeletonLine widthPct={75} shimmerX={shimmerX} reducedMotion={reducedMotion} />
        <SkeletonLine widthPct={55} shimmerX={shimmerX} reducedMotion={reducedMotion} />
        <SkeletonLine widthPct={90} shimmerX={shimmerX} reducedMotion={reducedMotion} />
        <SkeletonLine widthPct={40} shimmerX={shimmerX} reducedMotion={reducedMotion} />
      </Animated.View>

      <Animated.View style={[styles.skeletonCard, pulseStyle]}>
        <SkeletonLine widthPct={85} shimmerX={shimmerX} reducedMotion={reducedMotion} />
        <SkeletonLine widthPct={65} shimmerX={shimmerX} reducedMotion={reducedMotion} />
        <SkeletonLine widthPct={50} shimmerX={shimmerX} reducedMotion={reducedMotion} />
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex:           1,
    gap:            AIThemeSpacing.element,
    paddingVertical: AIThemeSpacing.element,
  },
  message: {
    ...AIThemeTypography.label,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
    marginBottom: AIThemeSpacing.tight,
  },
  skeletonCard: {
    borderRadius:    AIThemeRadius.card,
    backgroundColor: AIThemeColor.surfaceLight,
    padding:         AIThemeSpacing.element,
    gap:             AIThemeSpacing.tight,
    overflow:        'hidden',
  },
  skeletonLine: {
    height:          16,
    borderRadius:     8,
    backgroundColor: AIThemeColor.border,
    overflow:        'hidden',
  },
  shimmerWrapper: {
    overflow: 'hidden',
  },
});
