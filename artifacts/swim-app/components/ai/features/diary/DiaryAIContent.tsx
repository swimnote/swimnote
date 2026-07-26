/**
 * DiaryAIContent — SwimNote AI UI Framework V1.0 / Feature: Diary
 * AI 일지 작성 Content 컴포넌트 (State 반응형 레이아웃)
 *
 * 상태별 레이아웃:
 *   INPUT      — 입력창 중심, 결과 없음
 *   RECORDING  — 파형 확장 (AIInputArea 내부)
 *   PROCESSING — Shimmer Skeleton
 *   RESULT     — 상단 요약 + 결과 카드 확장
 *   EDITING    — 결과 카드 편집 모드
 *   COMPLETE   — 결과 카드 + 완료 피드백
 *   ERROR      — AIErrorView
 *   PERMISSION — AIPermissionView
 *
 * 의존: useDiaryAI, AI 컴포넌트들, Reanimated
 * 사용: 일지 화면에서 <BaseAIModal content={<DiaryAIContent />} />
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAIContext } from '../../core/AIContext';
import AIErrorView from '../../components/AIErrorView';
import AIInputArea from '../../components/AIInputArea';
import AILoading from '../../components/AILoading';
import AIPermissionView from '../../components/AIPermissionView';
import AIResultArea from '../../components/AIResultArea';
import { AIThemeColor, AIThemeDuration, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../../theme/AITheme';
import { useDiaryAI } from './useDiaryAI';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIContentProps {
  existingContent?: string;
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
  onClose:          () => void;
}

// ─── 상단 입력 요약 (RESULT/EDITING 상태) ─────────────────────────────────────

function InputSummary({ text, onEdit }: { text: string; onEdit: () => void }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryText} numberOfLines={1} ellipsizeMode="tail">
        {text || '(입력 내용)'}
      </Text>
      <Pressable onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.summaryEdit}>다시 입력</Text>
      </Pressable>
    </View>
  );
}

// ─── DiaryAIContent ───────────────────────────────────────────────────────────

export default function DiaryAIContent({
  existingContent,
  studentId,
  classId,
  poolId,
  onClose,
}: DiaryAIContentProps) {
  const { state, error } = useAIContext();

  const {
    inputText,
    setInputText,
    resultText,
    handleVoicePress,
    handleSubmit,
    machine,
  } = useDiaryAI({ existingContent, studentId, classId, poolId });

  // ── 레이아웃 모드 판단 ─────────────────────────────────────────────────────
  const showInput   = ['INPUT', 'RECORDING'].includes(state);
  const showSummary = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const showResult  = ['RESULT', 'EDITING', 'COMPLETE'].includes(state);
  const showLoading = ['PROCESSING', 'UPLOADING'].includes(state);

  // ── 입력 영역 opacity (RESULT 이후 숨김) ──────────────────────────────────
  const inputOpacity = useSharedValue(1);
  React.useEffect(() => {
    inputOpacity.value = withTiming(
      showInput ? 1 : 0,
      { duration: AIThemeDuration.fast },
    );
  }, [showInput]);
  const inputAnimStyle = useAnimatedStyle(() => ({
    opacity:  inputOpacity.value,
    display:  inputOpacity.value < 0.05 ? 'none' : 'flex',
  }));

  // ── ERROR ─────────────────────────────────────────────────────────────────
  if (state === 'ERROR' && error) {
    return <AIErrorView error={error} onClose={onClose} />;
  }

  // ── PERMISSION ────────────────────────────────────────────────────────────
  if (state === 'PERMISSION') {
    return <AIPermissionView types={['microphone']} onClose={onClose} />;
  }

  // ── PROCESSING / UPLOADING ────────────────────────────────────────────────
  if (showLoading) {
    return <AILoading state={state} message="일지를 작성하고 있습니다..." />;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* 상단 요약 (RESULT 이후) */}
      {showSummary && (
        <InputSummary
          text={inputText}
          onEdit={() => machine.retry('INPUT')}
        />
      )}

      {/* 입력 영역 */}
      <Animated.View style={inputAnimStyle}>
        <AIInputArea
          value={inputText}
          onChangeText={setInputText}
          state={state}
          placeholder="수업 내용을 간단히 입력하거나 음성으로 말씀하세요"
          onVoicePress={handleVoicePress}
        />
      </Animated.View>

      {/* 결과 카드 */}
      {showResult && (
        <View style={styles.resultContainer}>
          <AIResultArea result={resultText} state={state} />
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  contentContainer: {
    gap:             AIThemeSpacing.element,
    paddingVertical: AIThemeSpacing.tight,
    flexGrow:        1,
  },
  summaryRow: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    backgroundColor: AIThemeColor.surfaceLight,
    borderRadius:    AIThemeRadius.badge,
    paddingHorizontal: AIThemeSpacing.element,
    paddingVertical:   AIThemeSpacing.tight,
  },
  summaryText: {
    ...AIThemeTypography.label,
    color: AIThemeColor.textSub,
    flex:  1,
  },
  summaryEdit: {
    ...AIThemeTypography.label,
    color: AIThemeColor.primary,
    marginLeft: AIThemeSpacing.tight,
  },
  resultContainer: {
    flex:      1,
    minHeight: 200,
  },
});
