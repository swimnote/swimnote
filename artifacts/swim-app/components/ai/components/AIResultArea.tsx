/**
 * AIResultArea — SwimNote AI UI Framework V1.0
 * AI 응답 출력 카드
 *
 * 의존: AITheme
 * 사용: Feature Content 컴포넌트
 *
 * TODO: 타이핑 효과 (AIPersonality.charIntervalMs)
 * TODO: 카드 펼침 애니메이션 (cardMotion.reveal)
 * TODO: 스트리밍 응답 height 확장 (streamMotion)
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AIState } from '../core/AIContracts';
import {
  AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography,
} from '../theme/AITheme';

interface AIResultAreaProps {
  result: string;
  state:  AIState;
}

export default function AIResultArea({ result, state }: AIResultAreaProps) {
  const visible = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);

  if (!visible) return null;

  return (
    // TODO: Animated.View + cardMotion.reveal 적용
    <View style={styles.card}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>AI 작성 결과</Text>
        {/* TODO: 복사 버튼 */}
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* TODO: 타이핑 효과로 글자 순차 표시 */}
        <Text style={styles.resultText}>{result}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex:              1,
    borderRadius:      AIThemeRadius.card,
    backgroundColor:   AIThemeColor.surfaceLight,
    borderWidth:       1,
    borderColor:       AIThemeColor.border,
    padding:           AIThemeSpacing.element,
    // TODO: Reanimated animated style (height 확장)
  },
  labelRow: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    marginBottom:    AIThemeSpacing.tight,
  },
  label: {
    ...AIThemeTypography.label,
    color: AIThemeColor.primary,
  },
  scroll: {
    flex: 1,
  },
  resultText: {
    ...AIThemeTypography.result,
    color: AIThemeColor.text,
  },
});
