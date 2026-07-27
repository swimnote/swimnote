/**
 * AIStateMachine — SwimNote AI UI Framework V1.0
 * State 전환 규칙 및 유효성 검사
 *
 * 의존: AIContracts
 * 사용: useAIStateMachine, AIContext
 */

import type { AIErrorInfo, AIState } from './AIContracts';

// ─── 유효한 전환 맵 ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<AIState, AIState[]> = {
  CLOSED:      ['OPENING'],
  OPENING:     ['PERMISSION', 'INPUT', 'ERROR'],
  PERMISSION:  ['INPUT', 'ERROR'],
  INPUT:       ['RECORDING', 'UPLOADING', 'PROCESSING', 'CLOSED'],
  RECORDING:   ['PROCESSING', 'INPUT', 'ERROR'],
  UPLOADING:   ['PROCESSING', 'INPUT', 'ERROR'],
  PROCESSING:  ['RESULT', 'ERROR'],
  RESULT:      ['EDITING', 'COMPLETE', 'INPUT'],
  EDITING:     ['COMPLETE', 'RESULT', 'ERROR'],
  COMPLETE:    ['CLOSED'],
  ERROR:       ['INPUT', 'PERMISSION', 'CLOSED'],
};

// ─── 전환 유효성 검사 ─────────────────────────────────────────────────────────

export function canTransition(from: AIState, to: AIState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── State Machine 이벤트 타입 ────────────────────────────────────────────────

export type AIEvent =
  | { type: 'OPEN' }
  | { type: 'PERMISSION_REQUIRED' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'START_UPLOAD' }
  | { type: 'SUBMIT' }
  | { type: 'RESULT_RECEIVED' }
  | { type: 'EDIT' }
  | { type: 'COMPLETE' }
  | { type: 'RETRY'; target: AIState }
  | { type: 'ERROR'; error: AIErrorInfo }
  | { type: 'CLOSE' };

// ─── Reducer ─────────────────────────────────────────────────────────────────

export interface AIStateMachineState {
  current: AIState;
  error: AIErrorInfo | null;
  history: AIState[];
}

export const initialStateMachineState: AIStateMachineState = {
  current: 'CLOSED',
  error: null,
  history: [],
};

export function aiStateReducer(
  state: AIStateMachineState,
  event: AIEvent,
): AIStateMachineState {
  const { current } = state;
  const ts = Date.now();

  // TODO: 각 이벤트별 세부 전환 로직 구현
  switch (event.type) {
    case 'OPEN':
      if (!canTransition(current, 'OPENING')) {
        console.log(`[AI-SM ${ts}] OPEN blocked: ${current} → OPENING invalid`);
        return state;
      }
      console.log(`[STATE] ${current} → OPENING`);
      console.log(`[AI-SM ${ts}] ${current} → OPENING (event: OPEN)`);
      return { ...state, current: 'OPENING', history: [...state.history, current] };

    case 'PERMISSION_REQUIRED':
      if (!canTransition(current, 'PERMISSION')) { console.log(`[AI-SM ${ts}] PERMISSION_REQUIRED blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → PERMISSION`);
      return { ...state, current: 'PERMISSION', history: [...state.history, current] };

    case 'PERMISSION_GRANTED':
      if (!canTransition(current, 'INPUT')) { console.log(`[AI-SM ${ts}] PERMISSION_GRANTED blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → INPUT (PERMISSION_GRANTED)`);
      return { ...state, current: 'INPUT', history: [...state.history, current] };

    case 'START_RECORDING':
      if (!canTransition(current, 'RECORDING')) { console.log(`[AI-SM ${ts}] START_RECORDING blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → RECORDING`);
      return { ...state, current: 'RECORDING', history: [...state.history, current] };

    case 'STOP_RECORDING':
      if (!canTransition(current, 'INPUT')) { console.log(`[AI-SM ${ts}] STOP_RECORDING blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → INPUT (STOP_RECORDING — STT 결과 대기, AI 자동 실행 없음)`);
      return { ...state, current: 'INPUT', history: [...state.history, current] };

    case 'START_UPLOAD':
      if (!canTransition(current, 'UPLOADING')) { console.log(`[AI-SM ${ts}] START_UPLOAD blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → UPLOADING`);
      return { ...state, current: 'UPLOADING', history: [...state.history, current] };

    case 'SUBMIT':
      if (!canTransition(current, 'PROCESSING')) { console.log(`[AI-SM ${ts}] SUBMIT blocked from ${current}`); return state; }
      console.log(`[STATE] ${current} → PROCESSING`);
      console.log(`[AI-SM ${ts}] ${current} → PROCESSING (SUBMIT)`);
      return { ...state, current: 'PROCESSING', history: [...state.history, current] };

    case 'RESULT_RECEIVED':
      if (!canTransition(current, 'RESULT')) { console.log(`[AI-SM ${ts}] RESULT_RECEIVED blocked from ${current}`); return state; }
      console.log(`[STATE] ${current} → RESULT`);
      console.log(`[AI-SM ${ts}] ${current} → RESULT`);
      return { ...state, current: 'RESULT', history: [...state.history, current] };

    case 'EDIT':
      if (!canTransition(current, 'EDITING')) { console.log(`[AI-SM ${ts}] EDIT blocked from ${current}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → EDITING`);
      return { ...state, current: 'EDITING', history: [...state.history, current] };

    case 'COMPLETE':
      if (!canTransition(current, 'COMPLETE')) { console.log(`[AI-SM ${ts}] COMPLETE blocked from ${current}`); return state; }
      console.log(`[STATE] ${current} → COMPLETE`);
      console.log(`[AI-SM ${ts}] ${current} → COMPLETE`);
      return { ...state, current: 'COMPLETE', history: [...state.history, current] };

    case 'RETRY':
      if (!canTransition(current, event.target)) { console.log(`[AI-SM ${ts}] RETRY blocked: ${current} → ${event.target}`); return state; }
      console.log(`[AI-SM ${ts}] ${current} → ${event.target} (RETRY)`);
      return { ...state, current: event.target, error: null, history: [...state.history, current] };

    case 'ERROR':
      console.log(`[AI-SM ${ts}] ${current} → ERROR:`, event.error?.origin, event.error?.message);
      return { ...state, current: 'ERROR', error: event.error, history: [...state.history, current] };

    case 'CLOSE':
      console.log(`[AI-SM ${ts}] ${current} → CLOSED (CLOSE)`);
      return { ...initialStateMachineState };

    default:
      return state;
  }
}
