/**
 * AILoading — SwimNote AI UI Framework V1.0
 * 처리 중 로딩 표시 (Skeleton / Shimmer / Pulse)
 *
 * 의존: AITheme, AIPersonality
 * 사용: Feature Content 컴포넌트
 *
 * TODO: LinearGradient Shimmer 애니메이션
 * TODO: Pulse 애니메이션 (AIPersonality.pulseDurationMs)
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { AIState } from '../core/AIContracts';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

interface AILoadingProps {
  state: AIState;
  message?: string;
}

export default function AILoading({
  state,
  message = 'AI가 작성 중입니다...',
}: AILoadingProps) {
  const visible = ['PROCESSING', 'UPLOADING'].includes(state);

  if (!visible) return null;

  return (
    <View style={styles.container}>
      {/* TODO: Shimmer Skeleton 카드로 교체 */}
      <ActivityIndicator size="large" color={AIThemeColor.primary} />
      <Text style={styles.message}>{message}</Text>

      {/* Skeleton 플레이스홀더 */}
      <View style={styles.skeletonCard}>
        <View style={[styles.skeletonLine, { width: '80%' }]} />
        <View style={[styles.skeletonLine, { width: '60%' }]} />
        <View style={[styles.skeletonLine, { width: '90%' }]} />
        {/* TODO: Shimmer 애니메이션 */}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    gap:            AIThemeSpacing.element,
    paddingVertical: AIThemeSpacing.section,
  },
  message: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  skeletonCard: {
    width:           '100%',
    borderRadius:    AIThemeRadius.card,
    backgroundColor: AIThemeColor.surfaceLight,
    padding:         AIThemeSpacing.element,
    gap:             AIThemeSpacing.tight,
  },
  skeletonLine: {
    height:          16,
    borderRadius:     8,
    backgroundColor: AIThemeColor.border,
    // TODO: Shimmer animated style
  },
});
