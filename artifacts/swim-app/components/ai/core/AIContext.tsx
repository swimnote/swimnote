/**
 * AIContext — SwimNote AI UI Framework V1.0
 * AI Modal 전역 상태 컨텍스트
 * 범위: BaseAIModal 내부에서만 유효 (Provider로 감쌈)
 *
 * 의존: AIContracts, AIStateMachine
 * 사용: useAIModal, useAIStateMachine, AI 컴포넌트들
 */

import React, { createContext, useContext, useReducer } from 'react';
import type { AICreditInfo, AIErrorInfo, AIFeatureType, AIState } from './AIContracts';
import {
  aiStateReducer,
  initialStateMachineState,
  type AIEvent,
  type AIStateMachineState,
} from './AIStateMachine';

// ─── Context Shape ────────────────────────────────────────────────────────────

interface AIContextValue {
  // State Machine
  machineState: AIStateMachineState;
  dispatch: React.Dispatch<AIEvent>;
  // 편의 접근자
  state: AIState;
  error: AIErrorInfo | null;
  // Feature 정보
  featureType: AIFeatureType;
  // Credit
  credit: AICreditInfo | null | undefined;
  // TODO: 추가 상태 (isAnimating, inputText 등)
}

const AIContext = createContext<AIContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface AIProviderProps {
  children: React.ReactNode;
  featureType: AIFeatureType;
  credit?: AICreditInfo;
}

export function AIProvider({ children, featureType, credit }: AIProviderProps) {
  const [machineState, dispatch] = useReducer(aiStateReducer, initialStateMachineState);

  const value: AIContextValue = {
    machineState,
    dispatch,
    state: machineState.current,
    error: machineState.error,
    featureType,
    credit,
  };

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
}

// ─── Consumer Hook ────────────────────────────────────────────────────────────

export function useAIContext(): AIContextValue {
  const ctx = useContext(AIContext);
  if (!ctx) {
    throw new Error('useAIContext must be used within <AIProvider>');
  }
  return ctx;
}
