/**
 * AIActionBar — SwimNote AI UI Framework V1.0
 * 모달 하단 고정 액션 버튼 영역
 *
 * 의존: AITheme
 * 사용: Feature ActionBar 컴포넌트 또는 직접 사용
 *
 * TODO: 버튼 Press / Spring 애니메이션
 * TODO: 햅틱 피드백 연동
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AIActionBarProps } from '../core/AIContracts';
import {
  AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography,
} from '../theme/AITheme';

export default function AIActionBar({
  state,
  onPrimary,
  onSecondary,
  primaryLabel   = '확인',
  secondaryLabel = '취소',
  primaryDisabled = false,
}: AIActionBarProps) {
  return (
    <View style={styles.container}>
      {/* 보조 버튼 (RESULT 상태: "다시 작성") */}
      {onSecondary && (
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            console.log('[REWRITE CLICK] Pressable touched — label:', secondaryLabel, 'state:', state);
            onSecondary();
          }}
          // TODO: Press 애니메이션
        >
          <Text style={styles.secondaryLabel}>{secondaryLabel}</Text>
        </Pressable>
      )}

      {/* 주 버튼 (RESULT 상태: "일지에 삽입") */}
      <Pressable
        style={[
          styles.primaryButton,
          primaryDisabled && styles.primaryButtonDisabled,
          !onSecondary && styles.primaryButtonFull,
        ]}
        onPress={() => {
          console.log('[INSERT CLICK] Pressable touched — label:', primaryLabel, 'state:', state, 'disabled:', primaryDisabled);
          onPrimary?.();
        }}
        disabled={primaryDisabled}
        // TODO: Press 애니메이션, 햅틱
      >
        <Text style={styles.primaryLabel}>{primaryLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap:           AIThemeSpacing.tight,
  },
  secondaryButton: {
    flex:            1,
    height:          52,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  secondaryLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  primaryButton: {
    flex:            1,
    height:          52,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  primaryButtonFull: {
    flex: 1,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    ...AIThemeTypography.label,
    color:      '#FFFFFF',
    fontWeight: '600',
  },
});
