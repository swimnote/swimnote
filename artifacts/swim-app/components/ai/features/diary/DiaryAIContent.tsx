/**
 * DiaryAIContent — SwimNote AI UI Framework V1.0 / Feature: Diary
 * AI 일지 작성 Content 컴포넌트
 * BaseAIModal의 content prop으로 주입됨
 *
 * 의존: useDiaryAI, AIInputArea, AIResultArea, AILoading, AIErrorView, AIPermissionView
 * 사용: 일지 작성 화면에서 <BaseAIModal content={<DiaryAIContent />} />
 *
 * TODO: State별 레이아웃 전환 애니메이션
 */

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useAIContext } from '../../core/AIContext';
import AIErrorView from '../../components/AIErrorView';
import AIInputArea from '../../components/AIInputArea';
import AILoading from '../../components/AILoading';
import AIPermissionView from '../../components/AIPermissionView';
import AIResultArea from '../../components/AIResultArea';
import { AIThemeSpacing } from '../../theme/AITheme';
import { useDiaryAI } from './useDiaryAI';

interface DiaryAIContentProps {
  existingContent?: string;
  studentId?:       string;
  classId?:         string;
  poolId?:          string;
  onClose:          () => void;
}

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
  } = useDiaryAI({ existingContent, studentId, classId, poolId });

  // ERROR State
  if (state === 'ERROR' && error) {
    return <AIErrorView error={error} onClose={onClose} />;
  }

  // PERMISSION State
  if (state === 'PERMISSION') {
    return <AIPermissionView types={['microphone']} onClose={onClose} />;
  }

  // PROCESSING / UPLOADING State
  if (state === 'PROCESSING' || state === 'UPLOADING') {
    return <AILoading state={state} message="일지를 작성하고 있습니다..." />;
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* 입력 영역 */}
      <AIInputArea
        value={inputText}
        onChangeText={setInputText}
        state={state}
        placeholder="수업 내용을 간단히 입력하거나 음성으로 말씀하세요"
        onVoicePress={handleVoicePress}
      />

      {/* 결과 영역 */}
      <AIResultArea
        result={resultText}
        state={state}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap:            AIThemeSpacing.element,
    paddingVertical: AIThemeSpacing.element,
    flexGrow:        1,
  },
});
