/**
 * AIErrorView — SwimNote AI UI Framework V1.0
 * ERROR State 표시 + 재시도 / 닫기 액션
 *
 * 의존: AITheme, useAIStateMachine
 * 사용: Feature Content 컴포넌트
 *
 * TODO: errorFade 애니메이션으로 등장
 * TODO: errorShake 애니메이션 (복구 불가 오류)
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AIErrorInfo } from '../core/AIContracts';
import { useAIStateMachine } from '../hooks/useAIStateMachine';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

interface AIErrorViewProps {
  error: AIErrorInfo;
  onClose: () => void;
}

export default function AIErrorView({ error, onClose }: AIErrorViewProps) {
  const { retry } = useAIStateMachine();

  const canRetry = error.retryTarget !== null;

  return (
    // TODO: Animated.View + feedbackMotion.errorFade
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>오류가 발생했습니다</Text>
      <Text style={styles.message}>{error.message}</Text>

      <View style={styles.buttonRow}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeLabel}>닫기</Text>
        </Pressable>

        {canRetry && error.retryTarget && (
          <Pressable
            style={styles.retryButton}
            onPress={() => retry(error.retryTarget!)}
            // TODO: Press 애니메이션
          >
            <Text style={styles.retryLabel}>다시 시도</Text>
          </Pressable>
        )}
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
    padding:        AIThemeSpacing.section,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    ...AIThemeTypography.heading,
    color: AIThemeColor.error,
  },
  message: {
    ...AIThemeTypography.result,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
    marginTop:     AIThemeSpacing.element,
  },
  closeButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  closeLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  retryButton: {
    flex:            1,
    height:          48,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  retryLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '600',
  },
});
