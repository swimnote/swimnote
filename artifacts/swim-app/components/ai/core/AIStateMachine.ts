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
        console.log(`[SM-QA] State: ${current} | Event: OPEN | Next: BLOCKED (invalid transition)`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: OPEN | Next: OPENING | Function: machine.open()`);
      return { ...state, current: 'OPENING', history: [...state.history, current] };

    case 'PERMISSION_REQUIRED':
      if (!canTransition(current, 'PERMISSION')) {
        console.log(`[SM-QA] State: ${current} | Event: PERMISSION_REQUIRED | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: PERMISSION_REQUIRED | Next: PERMISSION | Function: machine.requirePermission()`);
      return { ...state, current: 'PERMISSION', history: [...state.history, current] };

    case 'PERMISSION_GRANTED':
      if (!canTransition(current, 'INPUT')) {
        console.log(`[SM-QA] State: ${current} | Event: PERMISSION_GRANTED | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: PERMISSION_GRANTED | Next: INPUT | Function: machine.grantPermission()`);
      return { ...state, current: 'INPUT', history: [...state.history, current] };

    case 'START_RECORDING':
      if (!canTransition(current, 'RECORDING')) {
        console.log(`[SM-QA] State: ${current} | Event: START_RECORDING | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: START_RECORDING | Next: RECORDING | Function: machine.startRecording()`);
      return { ...state, current: 'RECORDING', history: [...state.history, current] };

    case 'STOP_RECORDING':
      if (!canTransition(current, 'INPUT')) {
        console.log(`[SM-QA] State: ${current} | Event: STOP_RECORDING | Next: BLOCKED`);
        return state;
      }
      // ★ 핵심: STOP_RECORDING → INPUT (PROCESSING 아님) — AI 자동 실행 없음
      console.log(`[SM-QA] State: ${current} | Event: STOP_RECORDING | Next: INPUT | Function: processVoice() — STT만, AI 자동 실행 없음`);
      return { ...state, current: 'INPUT', history: [...state.history, current] };

    case 'START_UPLOAD':
      if (!canTransition(current, 'UPLOADING')) {
        console.log(`[SM-QA] State: ${current} | Event: START_UPLOAD | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: START_UPLOAD | Next: UPLOADING | Function: machine.startUpload()`);
      return { ...state, current: 'UPLOADING', history: [...state.history, current] };

    case 'SUBMIT':
      if (!canTransition(current, 'PROCESSING')) {
        console.log(`[SM-QA] State: ${current} | Event: SUBMIT | Next: BLOCKED — TRANSITIONS[${current}]에 PROCESSING 없음`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: SUBMIT | Next: PROCESSING | Function: machine.submit() → generateDiary()`);
      return { ...state, current: 'PROCESSING', history: [...state.history, current] };

    case 'RESULT_RECEIVED':
      if (!canTransition(current, 'RESULT')) {
        console.log(`[SM-QA] State: ${current} | Event: RESULT_RECEIVED | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: RESULT_RECEIVED | Next: RESULT | Function: machine.receiveResult()`);
      return { ...state, current: 'RESULT', history: [...state.history, current] };

    case 'EDIT':
      if (!canTransition(current, 'EDITING')) {
        console.log(`[SM-QA] State: ${current} | Event: EDIT | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: EDIT | Next: EDITING | Function: machine.edit()`);
      return { ...state, current: 'EDITING', history: [...state.history, current] };

    case 'COMPLETE':
      if (!canTransition(current, 'COMPLETE')) {
        console.log(`[SM-QA] State: ${current} | Event: COMPLETE | Next: BLOCKED`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: COMPLETE | Next: COMPLETE | Function: machine.complete()`);
      return { ...state, current: 'COMPLETE', history: [...state.history, current] };

    case 'RETRY':
      if (!canTransition(current, event.target)) {
        console.log(`[SM-QA] State: ${current} | Event: RETRY(${event.target}) | Next: BLOCKED — invalid transition`);
        return state;
      }
      console.log(`[SM-QA] State: ${current} | Event: RETRY(${event.target}) | Next: ${event.target} | Function: machine.retry('${event.target}')`);
      return { ...state, current: event.target, error: null, history: [...state.history, current] };

    case 'ERROR':
      console.log(`[SM-QA] State: ${current} | Event: ERROR | Next: ERROR | origin: ${event.error?.origin} message: ${event.error?.message}`);
      return { ...state, current: 'ERROR', error: event.error, history: [...state.history, current] };

    case 'CLOSE':
      console.log(`[SM-QA] State: ${current} | Event: CLOSE | Next: CLOSED | Function: machine.close() → initialStateMachineState`);
      return { ...initialStateMachineState };

    default:
      return state;
  }
}
