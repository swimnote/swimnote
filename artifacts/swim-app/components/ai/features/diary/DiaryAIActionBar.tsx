/**
 * DiaryAIActionBar — SwimNote AI UI Framework V1.0 / Feature: Diary
 * 일지 AI 전용 ActionBar
 * BaseAIModal의 actionBar prop으로 주입됨
 *
 * 의존: AIActionBar, useAIStateMachine, useDiaryAI 결과
 * 사용: 일지 작성 화면
 */

import React from 'react';
import type { AIState } from '../../core/AIContracts';
import { useAIStateMachine } from '../../hooks/useAIStateMachine';
import AIActionBar from '../../components/AIActionBar';

interface DiaryAIActionBarProps {
  inputText:   string;
  /** Stage A 임시 삽입 완료 피드백 — 최종 삽입 정책 확정 후 제거 예정 */
  insertDone?: boolean;
  onSubmit:    () => void;
  onInsert:    () => void;
  onClose:     () => void;
}

export default function DiaryAIActionBar({
  inputText,
  insertDone = false,
  onSubmit,
  onInsert,
  onClose,
}: DiaryAIActionBarProps) {
  const { state } = useAIStateMachine();

  // State별 버튼 구성
  const config = getActionConfig(state, inputText, insertDone, onSubmit, onInsert, onClose);

  return (
    <AIActionBar
      state={state}
      onPrimary={config.onPrimary}
      onSecondary={config.onSecondary}
      primaryLabel={config.primaryLabel}
      secondaryLabel={config.secondaryLabel}
      primaryDisabled={config.primaryDisabled}
    />
  );
}

function getActionConfig(
  state: AIState,
  inputText: string,
  insertDone: boolean,
  onSubmit: () => void,
  onInsert: () => void,
  onClose: () => void,
) {
  switch (state) {
    case 'INPUT':
      return {
        primaryLabel:    'AI 작성',
        secondaryLabel:  '취소',
        onPrimary:       onSubmit,
        onSecondary:     onClose,
        primaryDisabled: !inputText.trim(),
      };
    case 'RECORDING':
      return {
        primaryLabel:    'AI 작성',
        secondaryLabel:  '취소',
        onPrimary:       onSubmit,
        onSecondary:     onClose,
        primaryDisabled: true,
      };
    case 'RESULT':
    case 'EDITING':
      return {
        // ⚠️ insertDone 시 "삽입 완료 ✓" 표시 — Stage A 임시 피드백
        primaryLabel:    insertDone ? '삽입 완료 ✓' : '일지에 삽입',
        secondaryLabel:  '다시 작성',
        onPrimary:       onInsert,
        onSecondary:     onSubmit,
        primaryDisabled: false,
      };
    case 'COMPLETE':
      return {
        primaryLabel:    '닫기',
        onPrimary:       onClose,
        primaryDisabled: false,
      };
    default:
      return {
        primaryLabel:    '닫기',
        onPrimary:       onClose,
        primaryDisabled: false,
      };
  }
}
