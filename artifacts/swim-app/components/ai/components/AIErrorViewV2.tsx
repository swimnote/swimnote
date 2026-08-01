/**
 * AIErrorViewV2 — SwimNote AI UI Framework V2.0
 * ERROR State: 오류 안내 화면
 *
 * V1 AIErrorView와의 차이:
 *   - useAIStateMachine() Context 의존 제거
 *   - onRetry / onClose 콜백을 props로 수신
 *   - Context 없이 어디서든 사용 가능
 *   - 진단 정보 토글 (production 포함 항상 표시)
 *
 * 의존: AITheme, DiaryAIService(타입만)
 * 사용: DiaryAIModalV2
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const [diagOpen, setDiagOpen] = useState(false);
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

  const d = error.diagInfo;

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{iconMap[error.origin] ?? '⚠️'}</Text>
      <Text style={styles.title}>오류가 발생했습니다</Text>
      <Text style={styles.message}>{error.message}</Text>

      {/* ── 진단 정보 토글 ─────────────────────────────────────── */}
      <Pressable
        style={styles.diagToggle}
        onPress={() => setDiagOpen(v => !v)}
      >
        <Text style={styles.diagToggleLabel}>
          진단 정보 보기 {diagOpen ? '▲' : '▼'}
        </Text>
      </Pressable>

      {diagOpen && (
        <ScrollView
          style={styles.diagBlock}
          contentContainerStyle={styles.diagContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <DiagRow label="causeCode"   value={error.causeCode ?? '—'} />
          <DiagRow label="HTTP status" value={d?.httpStatus != null ? String(d.httpStatus) : '—'} />
          <DiagRow label="endpoint"    value={d ? `${d.endpointHost}${d.endpointPath}` : '—'} />
          <DiagRow label="Content-Type" value={d?.contentTypeRaw || '—'} />
          <DiagRow label="resp keys"   value={d?.responseKeys || '—'} />
          <DiagRow label="contract"    value={d?.causeCode || error.causeCode || '—'} />
          {d?.responsePreview ? (
            <DiagRow label="body"      value={d.responsePreview} multiline />
          ) : null}
        </ScrollView>
      )}

      {/* ── 버튼 행 — 닫기 1개만 (헤더 X는 ERROR 상태에서 숨김) ── */}
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

function DiagRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <View style={diagStyles.row}>
      <Text style={diagStyles.label}>{label}</Text>
      <Text style={diagStyles.value} numberOfLines={multiline ? 6 : 1} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

const diagStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap:           6,
    paddingVertical: 2,
    flexWrap:      'wrap',
  },
  label: {
    fontSize:   10,
    color:      '#888',
    fontFamily: 'monospace',
    minWidth:   80,
  },
  value: {
    fontSize:    10,
    color:       '#222',
    fontFamily:  'monospace',
    flex:        1,
  },
});

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
  diagToggle: {
    paddingVertical:   6,
    paddingHorizontal: 12,
    borderRadius:      6,
    backgroundColor:   '#f0f0f0',
    alignSelf:         'center',
  },
  diagToggleLabel: {
    fontSize:   12,
    color:      '#555',
    fontFamily: 'monospace',
  },
  diagBlock: {
    width:     '100%',
    maxHeight: 160,
  },
  diagContent: {
    backgroundColor: '#f8f8f8',
    borderRadius:    6,
    padding:         10,
    gap:             2,
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
