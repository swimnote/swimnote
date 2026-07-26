/**
 * DiaryAIContent — SwimNote AI UI Framework V1.0 / Feature: Diary
 * AI 일지 작성 Content 컴포넌트 (State 반응형 레이아웃)
 * Phase 4: onInsert 콜백 + DiaryAIActionBar 내장
 *
 * 의존: useDiaryAI, AI 컴포넌트들, Reanimated
 * 사용: <BaseAIModal content={<DiaryAIContent onInsert={...} onClose={...} />} />
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native';
import { useAIContext } from '../../core/AIContext';
import AIErrorView from '../../components/AIErrorView';
import AIInputArea from '../../components/AIInputArea';
import AILoading from '../../components/AILoading';
import AIPermissionView from '../../components/AIPermissionView';
import AIResultArea from '../../components/AIResultArea';
import DiaryAIActionBar from './DiaryAIActionBar';
import { AIThemeColor, AIThemeDuration, AIThemeRadius, AIThemeSpacing, AIThemeTypography } from '../../theme/AITheme';
import { useDiaryAI } from './useDiaryAI';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DiaryAIContentProps {
  /** COMPLETE 시 결과 텍스트를 부모 textarea에 삽입 */
  onInsert?:        (text: string) => void;
  onClose:          () => void;
  existingContent?: string;
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
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
  onInsert,
  onClose,
  existingContent,
  studentId,
  classId,
  poolId,
}: DiaryAIContentProps) {
  const { state, error } = useAIContext();
  const insets = useSafeAreaInsets();

  const {
    inputText,
    setInputText,
    resultText,
    handleVoicePress,
    handleSubmit,
    handleInsert,
    machine,
  } = useDiaryAI({ existingContent, studentId, classId, poolId, onInsert });

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
  // display/pointerEvents는 useAnimatedStyle 안에서 조건부 문자열로 쓰면
  // native crash를 유발할 수 있으므로 opacity만 사용합니다.
  // INPUT 상태가 아닐 때는 opacity:0 + 레이아웃 유지로 처리합니다.
  const inputAnimStyle = useAnimatedStyle(() => ({
    opacity: inputOpacity.value,
  }));

  // ── 콘텐츠 영역 렌더링 ────────────────────────────────────────────────────
  const renderContent = () => {
    if (state === 'ERROR' && error) {
      return <AIErrorView error={error} onClose={onClose} />;
    }
    if (state === 'PERMISSION') {
      return <AIPermissionView types={['microphone']} onClose={onClose} />;
    }
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
  };

  return (
    <View style={styles.wrapper}>
      {/* 스크롤 콘텐츠 */}
      <View style={styles.contentArea}>
        {renderContent()}
      </View>

      {/* 고정 하단 ActionBar (safe area 포함) */}
      <View style={[styles.actionBarWrap, { paddingBottom: insets.bottom + AIThemeSpacing.element }]}>
        <DiaryAIActionBar
          inputText={inputText}
          onSubmit={handleSubmit}
          onInsert={handleInsert}
          onClose={onClose}
        />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  contentArea: {
    flex: 1,
  },
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
  actionBarWrap: {
    paddingHorizontal: AIThemeSpacing.section,
    paddingTop:        AIThemeSpacing.element,
    backgroundColor:   AIThemeColor.background,
    borderTopWidth:    1,
    borderTopColor:    AIThemeColor.border,
  },
});
