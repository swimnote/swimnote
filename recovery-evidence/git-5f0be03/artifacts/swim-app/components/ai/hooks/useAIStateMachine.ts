/**
 * useAIStateMachine — SwimNote AI UI Framework V1.0
 * State Machine 이벤트 디스패치 편의 Hook
 *
 * 의존: AIContext
 * 사용: Feature Content 컴포넌트, AI 컴포넌트들
 */

import { useAIContext } from '../core/AIContext';
import type { AIErrorInfo, AIState } from '../core/AIContracts';

export function useAIStateMachine() {
  const { state, error, dispatch } = useAIContext();

  return {
    state,
    error,

    // ── 전환 액션 ──────────────────────────────────────────
    open:              () => dispatch({ type: 'OPEN' }),
    requirePermission: () => dispatch({ type: 'PERMISSION_REQUIRED' }),
    grantPermission:   () => dispatch({ type: 'PERMISSION_GRANTED' }),
    startRecording:    () => dispatch({ type: 'START_RECORDING' }),
    stopRecording:     () => dispatch({ type: 'STOP_RECORDING' }),
    startUpload:       () => dispatch({ type: 'START_UPLOAD' }),
    submit:            () => dispatch({ type: 'SUBMIT' }),
    receiveResult:     () => dispatch({ type: 'RESULT_RECEIVED' }),
    edit:              () => dispatch({ type: 'EDIT' }),
    complete:          () => dispatch({ type: 'COMPLETE' }),
    close:             () => dispatch({ type: 'CLOSE' }),

    setError: (err: AIErrorInfo) => dispatch({ type: 'ERROR', error: err }),
    retry:    (target: AIState)  => dispatch({ type: 'RETRY', target }),

    // ── 상태 조회 편의 접근자 ─────────────────────────────
    is: (s: AIState) => state === s,
    isAny: (...states: AIState[]) => states.includes(state),
    isProcessing: state === 'PROCESSING',
    isRecording:  state === 'RECORDING',
    hasResult:    state === 'RESULT' || state === 'EDITING' || state === 'COMPLETE',
    hasError:     state === 'ERROR',
  };
}
