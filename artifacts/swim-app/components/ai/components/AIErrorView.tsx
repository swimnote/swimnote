/**
 * AIErrorView — SwimNote AI UI Framework V1.0
 * ERROR State 표시 + 재시도 / 닫기 액션
 * + 진단 정보 표시 (causeCode / httpStatus / endpoint / responseKeys / requestId / validationStage)
 *
 * 의존: AITheme, useAIStateMachine
 * 사용: Feature Content 컴포넌트
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AIErrorInfo } from '../core/AIContracts';
import { useAIStateMachine } from '../hooks/useAIStateMachine';
import { AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

interface AIErrorViewProps {
  error: AIErrorInfo;
  onClose: () => void;
}

export default function AIErrorView({ error, onClose }: AIErrorViewProps) {
  const { retry } = useAIStateMachine();
  const [showDiag, setShowDiag] = useState(false);

  const canRetry = error.retryTarget !== null;

  const hasDiag =
    error.causeCode !== undefined ||
    error.httpStatus !== undefined ||
    error.endpoint !== undefined ||
    error.responseKeys !== undefined ||
    error.requestId !== undefined ||
    error.validationStage !== undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>오류가 발생했습니다</Text>
      <Text style={styles.message}>{error.message}</Text>

      {hasDiag && (
        <Pressable
          style={styles.diagToggle}
          onPress={() => setShowDiag(v => !v)}
        >
          <Text style={styles.diagToggleLabel}>
            {showDiag ? '진단 정보 닫기 ▲' : '진단 정보 보기 ▼'}
          </Text>
        </Pressable>
      )}

      {showDiag && hasDiag && (
        <ScrollView style={styles.diagBox} contentContainerStyle={styles.diagContent}>
          {error.causeCode !== undefined && (
            <DiagRow label="causeCode" value={error.causeCode} />
          )}
          {error.httpStatus !== undefined && (
            <DiagRow label="HTTP status" value={String(error.httpStatus)} />
          )}
          {error.endpoint !== undefined && (
            <DiagRow label="endpoint" value={endpointPath(error.endpoint)} />
          )}
          {error.responseKeys !== undefined && (
            <DiagRow label="response keys" value={error.responseKeys.join(', ') || '(empty)'} />
          )}
          {error.requestId !== undefined && (
            <DiagRow label="request_id" value={error.requestId} />
          )}
          {error.validationStage !== undefined && (
            <DiagRow label="validation" value={error.validationStage} />
          )}
        </ScrollView>
      )}

      <View style={styles.buttonRow}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeLabel}>닫기</Text>
        </Pressable>

        {canRetry && error.retryTarget && (
          <Pressable
            style={styles.retryButton}
            onPress={() => retry(error.retryTarget!)}
          >
            <Text style={styles.retryLabel}>다시 시도</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagRow}>
      <Text style={styles.diagLabel}>{label}</Text>
      <Text style={styles.diagValue} selectable>{value}</Text>
    </View>
  );
}

/** URL에서 path 부분만 추출 (민감 정보 없음) */
function endpointPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
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
  diagToggle: {
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  diagToggleLabel: {
    fontSize: 12,
    color: '#64748B',
    fontFamily: 'Pretendard-Regular',
  },
  diagBox: {
    maxHeight: 160,
    width: '100%',
    backgroundColor: '#0F172A',
    borderRadius: 10,
    marginTop: 2,
  },
  diagContent: {
    padding: 12,
    gap: 6,
  },
  diagRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  diagLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontFamily: 'Pretendard-Regular',
    minWidth: 90,
  },
  diagValue: {
    fontSize: 11,
    color: '#E2E8F0',
    fontFamily: 'Pretendard-Regular',
    flex: 1,
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
