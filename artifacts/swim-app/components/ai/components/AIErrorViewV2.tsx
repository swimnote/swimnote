/**
 * AIErrorViewV2 — SwimNote AI UI Framework V2.0
 * ERROR State: 오류 안내 화면
 *
 * V1 AIErrorView와의 차이:
 *   - useAIStateMachine() Context 의존 제거
 *   - onRetry / onClose 콜백을 props로 수신
 *   - Context 없이 어디서든 사용 가능
 *
 * 의존: AITheme, DiaryAIService(타입만)
 * 사용: DiaryAIModalV2
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DiaryAIStateV2, DiaryServiceError } from '../services/DiaryAIService';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

interface AIErrorViewV2Props {
  error:     DiaryServiceError;
  /** 다시 시도 — retryTarget 상태로 복귀 */
  onRetry:   (target: DiaryAIStateV2) => void;
  /** 닫기 */
  onClose:   () => void;
}

export default function AIErrorViewV2({ error, onRetry, onClose }: AIErrorViewV2Props) {
  const canRetry = error.retryTarget !== null;

  const handleRetry = () => {
    if (error.retryTarget) {
      onRetry(error.retryTarget);
    } else {
      onClose();
    }
  };

  const iconMap: Record<DiaryServiceError['origin'], string> = {
    NETWORK:    '📡',
    TIMEOUT:    '⏱️',
    PERMISSION: '🎤',
    UNKNOWN:    '⚠️',
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{iconMap[error.origin] ?? '⚠️'}</Text>
      <Text style={styles.title}>오류가 발생했습니다</Text>
      <Text style={styles.message}>{error.message}</Text>

      {__DEV__ && error.causeCode ? (
        <Text style={styles.debugCode}>[DEV] {error.causeCode}</Text>
      ) : null}

      <View style={styles.buttonRow}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeLabel}>닫기</Text>
        </Pressable>
        {canRetry && (
          <Pressable style={styles.retryButton} onPress={handleRetry}>
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
    color: AIThemeColor.text,
  },
  message: {
    ...AIThemeTypography.result,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
  },
  debugCode: {
    fontSize:  11,
    color:     AIThemeColor.textSub,
    opacity:   0.5,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
    marginTop:     AIThemeSpacing.element,
    width:         '100%',
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
