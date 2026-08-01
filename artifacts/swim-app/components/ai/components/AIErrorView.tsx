/**
 * AIErrorView — AI 오류 화면
 * 6개 진단 항목을 즉시 표시:
 *   1. 실제 Request URL
 *   2. HTTP Status
 *   3. Content-Type
 *   4. Response Body (JSON 전체, 최대 2000자)
 *   5. JSON 최상위 key 목록
 *   6. 실패한 Contract 검사 이름
 */

import React from 'react';
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
  const canRetry = error.retryTarget !== null;

  const hasDiag =
    error.endpoint      !== undefined ||
    error.httpStatus    !== undefined ||
    error.contentType   !== undefined ||
    error.responseBody  !== undefined ||
    error.responseKeys  !== undefined ||
    error.contractCheck !== undefined ||
    error.causeCode     !== undefined;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.title}>오류가 발생했습니다</Text>
      <Text style={styles.message}>{error.message}</Text>

      {hasDiag && (
        <ScrollView style={styles.diagBox} contentContainerStyle={styles.diagContent}>

          {/* 1. Request URL */}
          <DiagRow index={1} label="Request URL" value={error.endpoint ?? '—'} />

          {/* 2. HTTP Status */}
          <DiagRow index={2} label="HTTP Status" value={error.httpStatus !== undefined ? String(error.httpStatus) : '—'} />

          {/* 3. Content-Type */}
          <DiagRow index={3} label="Content-Type" value={error.contentType ?? '—'} />

          {/* 4. Response Body */}
          <View style={styles.diagSection}>
            <Text style={styles.diagIndexLabel}>④ Response Body</Text>
            <Text style={styles.diagBodyText} selectable>
              {error.responseBody ?? '—'}
            </Text>
          </View>

          {/* 5. JSON 최상위 key 목록 */}
          <DiagRow
            index={5}
            label="JSON keys"
            value={
              error.responseKeys !== undefined
                ? (error.responseKeys.length > 0 ? error.responseKeys.join(', ') : '(empty)')
                : '—'
            }
          />

          {/* 6. 실패한 Contract 검사 이름 */}
          <DiagRow index={6} label="Contract check" value={error.contractCheck ?? error.causeCode ?? '—'} />

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

function DiagRow({ index, label, value }: { index: number; label: string; value: string }) {
  return (
    <View style={styles.diagRow}>
      <Text style={styles.diagIndex}>{'①②③④⑤⑥'.charAt(index - 1)}</Text>
      <Text style={styles.diagLabel}>{label}</Text>
      <Text style={styles.diagValue} selectable numberOfLines={3} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:           1,
    alignItems:     'stretch',
    justifyContent: 'center',
    gap:            AIThemeSpacing.element,
    padding:        AIThemeSpacing.section,
  },
  icon: {
    fontSize: 40,
    textAlign: 'center',
  },
  title: {
    ...AIThemeTypography.heading,
    color:     AIThemeColor.error,
    textAlign: 'center',
  },
  message: {
    ...AIThemeTypography.result,
    color:     AIThemeColor.textSub,
    textAlign: 'center',
  },
  diagBox: {
    maxHeight:       220,
    backgroundColor: '#0F172A',
    borderRadius:    10,
    marginTop:       4,
  },
  diagContent: {
    padding: 12,
    gap:     8,
  },
  diagRow: {
    flexDirection: 'row',
    gap:           6,
    alignItems:    'flex-start',
  },
  diagSection: {
    gap: 4,
  },
  diagIndex: {
    fontSize:    12,
    color:       '#64748B',
    width:       16,
    marginTop:   1,
  },
  diagLabel: {
    fontSize:    11,
    color:       '#94A3B8',
    fontFamily:  'Pretendard-Regular',
    width:       90,
    marginTop:   1,
  },
  diagValue: {
    fontSize:    11,
    color:       '#E2E8F0',
    fontFamily:  'Pretendard-Regular',
    flex:        1,
  },
  diagIndexLabel: {
    fontSize:    11,
    color:       '#94A3B8',
    fontFamily:  'Pretendard-Regular',
    marginBottom: 2,
  },
  diagBodyText: {
    fontSize:        10,
    color:           '#CBD5E1',
    fontFamily:      'Pretendard-Regular',
    backgroundColor: '#1E293B',
    borderRadius:    6,
    padding:         8,
    lineHeight:      15,
  },
  buttonRow: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
    marginTop:     4,
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
