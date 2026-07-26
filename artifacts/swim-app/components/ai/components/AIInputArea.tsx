/**
 * AIInputArea — SwimNote AI UI Framework V1.0
 * 텍스트 입력 + 음성 버튼 영역
 *
 * 의존: AITheme, AIContracts
 * 사용: Feature Content 컴포넌트
 *
 * TODO: 음성 녹음 상태 시 파형 애니메이션
 * TODO: 입력 시작 시 레이아웃 재배치 애니메이션
 * TODO: Reanimated height 애니메이션
 */

import React from 'react';
import {
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { AIState } from '../core/AIContracts';
import {
  AIThemeColor, AIThemeRadius, AIThemeSpacing, AIThemeTypography,
} from '../theme/AITheme';

interface AIInputAreaProps {
  value:        string;
  onChangeText: (text: string) => void;
  state:        AIState;
  placeholder?: string;
  onVoicePress: () => void;
  onVoiceRelease?: () => void;
}

export default function AIInputArea({
  value,
  onChangeText,
  state,
  placeholder = '여기에 입력하거나 음성으로 말씀하세요',
  onVoicePress,
}: AIInputAreaProps) {
  const isRecording = state === 'RECORDING';
  const isDisabled  = !['INPUT', 'RECORDING', 'EDITING'].includes(state);

  return (
    <View style={styles.container}>
      {/* 텍스트 입력창 */}
      <TextInput
        style={[styles.input, isDisabled && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={AIThemeColor.textSub}
        multiline
        editable={!isDisabled}
        // TODO: KeyboardController 연동
        // TODO: 입력 시작 시 height 애니메이션
      />

      {/* 음성 버튼 */}
      <Pressable
        style={[styles.voiceButton, isRecording && styles.voiceButtonActive]}
        onPress={onVoicePress}
        disabled={isDisabled}
        // TODO: Press 애니메이션, 햅틱
      >
        {/* TODO: 녹음 중 파형 애니메이션 */}
        <Text style={styles.voiceIcon}>{isRecording ? '⏹' : '🎤'}</Text>
        <Text style={styles.voiceLabel}>
          {isRecording ? '녹음 중...' : '음성 입력'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: AIThemeSpacing.element,
  },
  input: {
    minHeight:         160,
    borderRadius:      AIThemeRadius.input,
    backgroundColor:   AIThemeColor.surfaceLight,
    borderWidth:       1,
    borderColor:       AIThemeColor.border,
    padding:           AIThemeSpacing.element,
    ...AIThemeTypography.input,
    color:             AIThemeColor.text,
    textAlignVertical: 'top',
    // TODO: Reanimated animated style
  },
  inputDisabled: {
    opacity: 0.5,
  },
  voiceButton: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:             AIThemeSpacing.tight,
    height:          56,
    borderRadius:    AIThemeRadius.button,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
  },
  voiceButtonActive: {
    backgroundColor: AIThemeColor.aiGlow,
    borderColor:     AIThemeColor.primary,
  },
  voiceIcon: {
    fontSize: 22,
  },
  voiceLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
});
