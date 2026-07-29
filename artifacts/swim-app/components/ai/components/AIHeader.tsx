/**
 * AIHeader — SwimNote AI UI Framework V1.0
 * 모달 상단 헤더: 타이틀 + 닫기 버튼
 *
 * 의존: AITheme
 * 사용: BaseAIModal
 *
 * TODO: 스와이프 핸들 추가
 * TODO: 닫기 버튼 Press 애니메이션
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AIThemeColor, AIThemeSpacing, AIThemeTypography } from '../theme/AITheme';

interface AIHeaderProps {
  title: string;
  onClose: () => void;
}

export default function AIHeader({ title, onClose }: AIHeaderProps) {
  return (
    <View style={styles.container}>
      {/* 스와이프 핸들 */}
      <View style={styles.handle} />

      <View style={styles.row}>
        {/* 닫기 버튼 — 좌측, 크게 */}
        <Pressable
          style={styles.closeButton}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          // TODO: Press 애니메이션
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>

        <Text style={styles.title}>{title}</Text>

        {/* 우측 여백 균형용 */}
        <View style={styles.spacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop:        AIThemeSpacing.element,
    paddingHorizontal: AIThemeSpacing.section,
    paddingBottom:     AIThemeSpacing.tight,
  },
  handle: {
    width:           40,
    height:           4,
    borderRadius:     2,
    backgroundColor: AIThemeColor.border,
    alignSelf:       'center',
    marginBottom:    AIThemeSpacing.element,
  },
  row: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width:           44,
    height:          44,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    22,
    backgroundColor: AIThemeColor.surfaceLight,
  },
  closeText: {
    fontSize:  18,
    color:     AIThemeColor.textSub,
    lineHeight: 22,
  },
  title: {
    ...AIThemeTypography.heading,
    color: AIThemeColor.text,
    flex:  1,
    textAlign: 'center',
  },
  spacer: {
    width: 44,
  },
});
