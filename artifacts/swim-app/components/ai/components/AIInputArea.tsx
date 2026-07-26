/**
 * AIInputArea — SwimNote AI UI Framework V1.0
 * State 반응형 입력 영역
 *
 * 상태별 레이아웃:
 *   INPUT    — TextInput 전체 표시, 음성 버튼 강조
 *   RECORDING — 파형 영역 확장, TextInput 최소화(숨김)
 *   EDITING   — TextInput 결과 편집 모드
 *   기타      — 비활성(읽기 전용)
 *
 * 의존: AITheme, AIVoiceWaveform, Reanimated
 * 사용: Feature Content 컴포넌트
 */

import React, { useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { AIState } from '../core/AIContracts';
import AIVoiceWaveform from './AIVoiceWaveform';
import { useAIReducedMotion } from '../hooks/useAIReducedMotion';
import {
  AIThemeColor,
  AIThemeDuration,
  AIThemeLayout,
  AIThemeRadius,
  AIThemeSpacing,
  AIThemeSpring,
  AIThemeTypography,
} from '../theme/AITheme';
import { AIPersonalityHaptic } from '../theme/AIPersonality';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AIInputAreaProps {
  value:         string;
  onChangeText:  (text: string) => void;
  state:         AIState;
  placeholder?:  string;
  onVoicePress:  () => void;
  /** Phase 3: expo-av metering 값 (0..1 배열) */
  amplitudes?:   number[];
}

// ─── AIInputArea ──────────────────────────────────────────────────────────────

export default function AIInputArea({
  value,
  onChangeText,
  state,
  placeholder = '여기에 입력하거나 음성으로 말씀하세요',
  onVoicePress,
  amplitudes,
}: AIInputAreaProps) {
  const reducedMotion = useAIReducedMotion();
  const isRecording   = state === 'RECORDING';
  const isEditing     = state === 'EDITING';
  const isInput       = state === 'INPUT';
  const isActive      = isInput || isRecording || isEditing;
  const isDisabled    = !isActive;

  // ── 파형 높이 (RECORDING 시 확장) ─────────────────────────────────────────
  // 초기값 0: CLOSED 상태에서 56으로 시작하면 56→0 spring이 불필요하게 실행됨
  const waveformHeight  = useSharedValue(0);
  const inputOpacity    = useSharedValue(1);
  const voiceRowHeight  = useSharedValue(0);

  useEffect(() => {
    const toWave    = isRecording ? AIThemeLayout.waveformHeight : 0;
    const toOpacity = isRecording ? 0 : 1;
    // RECORDING일 때도 "녹음 중단" 버튼이 보여야 하므로 isActive(INPUT/RECORDING/EDITING) → 56
    const toVoiceH  = isActive ? 56 : 0;

    console.log(
      `[AIInputArea] state=${state} isRecording=${isRecording} isActive=${isActive}` +
      ` → toWave=${toWave} toOpacity=${toOpacity} toVoiceH=${toVoiceH}` +
      ` (voiceRowHeight.cur=${voiceRowHeight.value})`,
    );

    if (reducedMotion) {
      waveformHeight.value = toWave;
      inputOpacity.value   = toOpacity;
      voiceRowHeight.value = toVoiceH;
    } else {
      waveformHeight.value  = withSpring(toWave, AIThemeSpring.smooth);
      inputOpacity.value    = withTiming(toOpacity, { duration: AIThemeDuration.fast });
      voiceRowHeight.value  = withSpring(toVoiceH, AIThemeSpring.smooth);
    }
    // RECORDING 중 모달이 닫히면 진행 중인 animation을 안전하게 정리
    return () => {
      cancelAnimation(waveformHeight);
      cancelAnimation(inputOpacity);
      cancelAnimation(voiceRowHeight);
    };
    // isActive 반드시 포함: OPENING→INPUT 전환 시 isActive가 false→true로 바뀌어도
    // isRecording이 false로 유지되면 effect가 재실행되지 않아 voiceRowHeight가 0에 고정됨
  }, [isActive, isRecording, reducedMotion]);

  // ── 입력창 비활성 시 fade ─────────────────────────────────────────────────
  const containerOpacity = useSharedValue(1);
  useEffect(() => {
    containerOpacity.value = withTiming(isDisabled ? 0.45 : 1, { duration: AIThemeDuration.fast });
    return () => { cancelAnimation(containerOpacity); };
  }, [isDisabled]);

  // ── Animated Styles ───────────────────────────────────────────────────────
  const waveStyle = useAnimatedStyle(() => ({ height: waveformHeight.value, overflow: 'hidden' as const }));
  const inputStyle = useAnimatedStyle(() => ({ opacity: inputOpacity.value }));
  const voiceStyle = useAnimatedStyle(() => ({ height: voiceRowHeight.value, overflow: 'hidden' as const }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: containerOpacity.value }));

  // ── 음성 버튼 핸들러 ──────────────────────────────────────────────────────
  const handleVoicePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(
        isRecording ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Medium
      ).catch(() => {});
    }
    onVoicePress();
  };

  return (
    <Animated.View style={[styles.container, containerStyle]}>

      {/* 파형 영역 — RECORDING 시만 높이 확장 */}
      <Animated.View style={waveStyle}>
        <AIVoiceWaveform
          amplitudes={amplitudes}
          active={isRecording}
          reducedMotion={reducedMotion}
        />
      </Animated.View>

      {/* 텍스트 입력창 — RECORDING 시 숨김 */}
      <Animated.View style={inputStyle}>
        <TextInput
          style={[styles.input, isEditing && styles.inputEditing]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={AIThemeColor.textSub}
          multiline
          editable={!isDisabled}
          textAlignVertical="top"
          autoCorrect={false}
        />
      </Animated.View>

      {/* 음성 버튼 — RECORDING 시 녹음 중단 버튼으로 변환 */}
      <Animated.View style={voiceStyle}>
        <Pressable
          style={[styles.voiceButton, isRecording && styles.voiceButtonActive]}
          onPress={handleVoicePress}
          disabled={isDisabled && !isRecording}
        >
          <Text style={styles.voiceIcon}>{isRecording ? '⏹' : '🎤'}</Text>
          <Text style={[styles.voiceLabel, isRecording && styles.voiceLabelActive]}>
            {isRecording ? '녹음 중단' : '음성 입력'}
          </Text>
        </Pressable>
      </Animated.View>

      {/* RECORDING 상태 하단 안내 */}
      {isRecording && (
        <View style={styles.recordingHint}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>녹음 중 — 말씀을 마치면 중단을 눌러주세요</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    gap: AIThemeSpacing.element,
  },
  input: {
    minHeight:       AIThemeLayout.inputMinHeight,
    borderRadius:    AIThemeRadius.input,
    backgroundColor: AIThemeColor.surfaceLight,
    borderWidth:     1,
    borderColor:     AIThemeColor.border,
    padding:         AIThemeSpacing.element,
    ...AIThemeTypography.input,
    color:           AIThemeColor.text,
  },
  inputEditing: {
    borderColor: AIThemeColor.primary,
    borderWidth: 1.5,
  },
  voiceButton: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:              AIThemeSpacing.tight,
    height:           56,
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
    fontSize: 20,
  },
  voiceLabel: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
  voiceLabelActive: {
    color: AIThemeColor.primary,
  },
  recordingHint: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:             AIThemeSpacing.tight,
  },
  recordingDot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: AIThemeColor.error,
  },
  recordingText: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
  },
});
