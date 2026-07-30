/**
 * useDiaryAIV2 — SwimNote AI UI Framework V2.0
 * 일지 AI 전용 Hook — 상태관리 + 생명주기 전담
 *
 * 담당:
 *   - DiaryAIStateV2 상태 관리 (단순 useState, Context 없음)
 *   - AbortController 생성·교체·해제
 *   - requestId 생성 및 stale response 판정
 *   - 자동 retry 결정 (최대 1회, Hook 레벨)
 *   - Service 호출 + 결과 → React state 반영
 *   - 모달 재오픈 시 reset()
 *   - dismiss 잠금 여부(isLocked) 계산
 *
 * 비담당:
 *   - API 호출, 응답 검증, 정규화 → DiaryAIService
 *   - 레이아웃 렌더링 → DiaryAIModalV2
 *
 * 의존: DiaryAIService, useVoiceRecorder
 * 사용: DiaryAIModalV2
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import {
  createDiaryRequestId,
  generateDiary,
  processVoice as svcProcessVoice,
  type DiaryAIStateV2,
  type DiaryGenerateParams,
  type DiaryInsertResult,
  type DiaryServiceError,
  type StudentContext,
  type StudentDiaryNote,
} from '../../services/DiaryAIService';

// ─── 재수출 — 모달이 별도 import 없이 사용하도록 ───────────────────────────────
export type {
  DiaryAIStateV2,
  DiaryInsertResult,
  DiaryServiceError,
  StudentContext,
  StudentDiaryNote,
} from '../../services/DiaryAIService';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** 자동 retry 최대 횟수 */
const MAX_AUTO_RETRY = 1;
/** 자동 retry 전 대기(ms) */
const AUTO_RETRY_DELAY_MS = 800;
/**
 * SEARCHING → GENERATING 자동 전환 시간(ms)
 * 서버가 진행 이벤트를 보내지 않는 동안 클라이언트 타이머로 전환합니다.
 * 서버가 onProgress 콜백을 호출하면 이 타이머보다 먼저 전환됩니다.
 */
const SEARCHING_TO_GENERATING_MS = 2_500;

/** dismiss 잠금 대상 상태 */
const LOCK_STATES: DiaryAIStateV2[] = [
  'RECORDING', 'TRANSCRIBING', 'SEARCHING', 'GENERATING', 'RESULT',
];

// ─── Hook 옵션 ────────────────────────────────────────────────────────────────

export interface UseDiaryAIV2Options {
  existingContent?: string;
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  students?:        StudentContext[];
  poolId?:          string;
  /** AI 작업 완전 확정 시 호출 — commonDiary + students[] 전달 */
  onInsert?:        (result: DiaryInsertResult) => void;
  /** 모달 닫기 요청 */
  onClose?:         () => void;
}

// ─── Hook 반환 타입 ───────────────────────────────────────────────────────────

export interface DiaryAIV2HookResult {
  /** 현재 V2 상태 */
  v2State:              DiaryAIStateV2;
  /** 현재 오류 정보 */
  currentError:         DiaryServiceError | null;
  /** 텍스트 입력 */
  inputText:            string;
  setInputText:         (t: string) => void;
  /** 전체 공통 일지 결과 */
  resultText:           string;
  setResultText:        (t: string) => void;
  /** 학생별 일지 결과 */
  generatedStudents:    StudentDiaryNote[];
  setGeneratedStudents: (s: StudentDiaryNote[]) => void;
  /** RESULT/EDITING/COMPLETE에서 "삽입 완료" 피드백 */
  insertDone:           boolean;
  /** AI 작성 / 다시 생성 제출 */
  handleSubmit:         () => Promise<void>;
  /** 음성 녹음 시작 / 중지 */
  handleVoicePress:     () => Promise<void>;
  /** 결과 삽입 */
  handleInsert:         () => void;
  /** "수정하기" — RESULT → INPUT 복귀 (inputText 유지) */
  handleEditInput:      () => void;
  /** 외부에서 오류 직접 설정 + ERROR 전환 (AIPermissionViewV2 등) */
  handleSetError:       (error: DiaryServiceError) => void;
  /** 닫기 (입력 중이면 Alert) */
  handleClose:          () => void;
  /** 오류에서 재시도 */
  handleRetry:          (target: DiaryAIStateV2) => void;
  /** 모든 상태 초기화 (모달 재오픈 시 호출) */
  reset:                () => void;
  /** true = 백드롭 탭 / Android Back 비활성화 */
  isLocked:             boolean;
  /** 음성 녹음 진행 시간 (ms) — 녹음 중 UI 표시 */
  recordingDurationMs:  number;
}

// ─── useDiaryAIV2 ─────────────────────────────────────────────────────────────

export function useDiaryAIV2(options: UseDiaryAIV2Options = {}): DiaryAIV2HookResult {
  const recorder = useVoiceRecorder();

  // ── UI 상태 (단순 useState — Context 없음) ─────────────────────────────────
  const [v2State,           setV2State]           = useState<DiaryAIStateV2>('INPUT');
  const [currentError,      setCurrentError]      = useState<DiaryServiceError | null>(null);
  const [inputText,         setInputText]         = useState('');
  const [resultText,        setResultText]        = useState('');
  const [generatedStudents, setGeneratedStudents] = useState<StudentDiaryNote[]>([]);
  const [insertDone,        setInsertDone]        = useState(false);

  // ── 안정성 refs ────────────────────────────────────────────────────────────
  /** 생성 API AbortController */
  const generateAbortRef  = useRef<AbortController | null>(null);
  /** 음성 STT AbortController */
  const voiceAbortRef     = useRef<AbortController | null>(null);
  /** 언마운트 후 setState 방지 */
  const isMountedRef      = useRef(true);
  /** 중복 제출 차단 */
  const isInFlightRef     = useRef(false);
  /** stale response 판정용 현재 requestId */
  const requestIdRef      = useRef('');
  /** insert 중복 방지 */
  const isInsertingRef    = useRef(false);
  /** insertDone 초기화 타이머 */
  const insertTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 제출 시점의 inputText 스냅샷 (retry 시 동일 텍스트 사용) */
  const submittedTextRef  = useRef('');

  // ── 언마운트 정리 ──────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      generateAbortRef.current?.abort('unmount');
      voiceAbortRef.current?.abort('unmount');
      if (insertTimerRef.current) clearTimeout(insertTimerRef.current);
    };
  }, []);

  // ── reset ─────────────────────────────────────────────────────────────────
  /** 모달 재오픈 시 모든 상태·ref를 초기화합니다 */
  const reset = useCallback(() => {
    generateAbortRef.current?.abort('new-request');
    voiceAbortRef.current?.abort('new-request');
    generateAbortRef.current = null;
    voiceAbortRef.current    = null;
    isInFlightRef.current    = false;
    isInsertingRef.current   = false;
    requestIdRef.current     = '';
    submittedTextRef.current = '';
    if (insertTimerRef.current) {
      clearTimeout(insertTimerRef.current);
      insertTimerRef.current = null;
    }
    setV2State('INPUT');
    setCurrentError(null);
    setInputText('');
    setResultText('');
    setGeneratedStudents([]);
    setInsertDone(false);
  }, []);

  // ── handleClose ────────────────────────────────────────────────────────────
  const handleClose = useCallback(() => {
    const hasDirtyInput = v2State === 'INPUT' && inputText.trim().length > 0;
    if (!hasDirtyInput) {
      options.onClose?.();
      return;
    }
    Alert.alert(
      '작성 내용이 있습니다',
      '화면을 닫으면 입력한 내용이 사라집니다.',
      [
        { text: '계속 작성', style: 'cancel' },
        { text: '닫기', style: 'destructive', onPress: () => options.onClose?.() },
      ],
    );
  }, [v2State, inputText, options.onClose]);

  // ── handleRetry ────────────────────────────────────────────────────────────
  const handleRetry = useCallback((target: DiaryAIStateV2) => {
    setCurrentError(null);
    setV2State(target);
  }, []);

  // ── _executeGenerate (내부 — retry 포함) ───────────────────────────────────
  const _executeGenerate = useCallback(async (
    reqId:       string,
    controller:  AbortController,
    retryCount:  number,
  ): Promise<void> => {
    const params: DiaryGenerateParams = {
      requestId:   reqId,
      inputText:   submittedTextRef.current,
      token:       options.token,
      poolId:      options.poolId       ?? '',
      classId:     options.classId      ?? '',
      date:        options.date         ?? '',
      students:    options.students     ?? [],
      signal:      controller.signal,
      // onProgress → Hook이 이미 SEARCHING 상태로 설정했으므로 여기서는 GENERATING 전환용
      onProgress: (phase) => {
        if (!isMountedRef.current) return;
        if (requestIdRef.current !== reqId) return;
        if (phase === 'GENERATING') setV2State('GENERATING');
      },
    };

    const result = await generateDiary(params);

    if (!isMountedRef.current) return;
    if (requestIdRef.current !== reqId) {
      if (__DEV__) console.log('[useDiaryAIV2] stale_response_ignored', { reqId });
      return;
    }

    if (!result.ok) {
      const svcErr = result.error;

      if (svcErr.retryable && retryCount < MAX_AUTO_RETRY) {
        if (__DEV__) console.log('[useDiaryAIV2] auto_retry', { reqId, retryCount: retryCount + 1 });
        await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
        if (!isMountedRef.current || controller.signal.aborted) return;
        await _executeGenerate(reqId, controller, retryCount + 1);
        return;
      }

      if (__DEV__) console.error('[useDiaryAIV2] generate_failed', { reqId, origin: svcErr.origin, causeCode: svcErr.causeCode });
      setCurrentError(svcErr);
      setV2State('ERROR');
      return;
    }

    const { common, students } = result.result;
    const studentLookup = new Map((options.students ?? []).map(s => [s.id, s.name]));

    setResultText(common);
    setGeneratedStudents(students.map(s => ({
      studentId:   s.studentRef,
      studentName: studentLookup.get(s.studentRef) ?? s.studentRef,
      note:        s.content,
    })));
    setV2State('RESULT');
    if (__DEV__) console.log('[useDiaryAIV2] generate_succeeded', { reqId, student_count: students.length });
  }, [options.token, options.poolId, options.classId, options.date, options.students]);

  // ── handleSubmit ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (isInFlightRef.current) {
      if (__DEV__) console.log('[useDiaryAIV2] submit_skipped: already_in_flight');
      return;
    }

    const text = inputText.trim();
    if (!text) {
      if (__DEV__) console.log('[useDiaryAIV2] submit_skipped: empty_input');
      return;
    }

    // 새 requestId 발급
    const reqId = createDiaryRequestId();
    requestIdRef.current     = reqId;
    submittedTextRef.current = text;

    // 이전 요청 취소
    generateAbortRef.current?.abort('new-request');
    const controller = new AbortController();
    generateAbortRef.current = controller;

    isInFlightRef.current = true;
    setCurrentError(null);
    setV2State('SEARCHING');

    if (__DEV__) console.log('[useDiaryAIV2] submit_started', { reqId, state: v2State });

    // SEARCHING → GENERATING 자동 전환 타이머
    // 서버가 onProgress 콜백을 보내오면 이 타이머보다 먼저 전환됩니다
    const generatingTimer = setTimeout(() => {
      if (isMountedRef.current && requestIdRef.current === reqId) {
        setV2State(prev => prev === 'SEARCHING' ? 'GENERATING' : prev);
      }
    }, SEARCHING_TO_GENERATING_MS);

    try {
      await _executeGenerate(reqId, controller, 0);
    } catch (e: any) {
      // AbortError(unmount/new-request) — 상태 변경 없이 조용히 종료
      if (__DEV__ && e?.name !== 'AbortError') {
        console.error('[useDiaryAIV2] handleSubmit unexpected error:', e?.message);
      }
    } finally {
      clearTimeout(generatingTimer);
      isInFlightRef.current = false;
    }
  }, [inputText, v2State, _executeGenerate]);

  // ── _processVoice (내부) ──────────────────────────────────────────────────
  const _processVoice = useCallback(async (uri: string | null) => {
    if (!uri) {
      if (isMountedRef.current) setV2State('INPUT');
      return;
    }

    voiceAbortRef.current?.abort('new-request');
    const controller = new AbortController();
    voiceAbortRef.current = controller;

    try {
      const result = await svcProcessVoice({ uri, token: options.token, signal: controller.signal });

      if (!isMountedRef.current) return;

      if (!result.ok) {
        setCurrentError(result.error);
        setV2State('ERROR');
        return;
      }

      setInputText(result.transcript);
      setV2State('INPUT');
      if (__DEV__) console.log('[useDiaryAIV2] stt_completed', { transcript_length: result.transcript.length });

    } catch (e: any) {
      if (!isMountedRef.current) return;
      // AbortError(unmount/new-request) — 조용히 종료
      if (e?.name === 'AbortError') {
        if (__DEV__) console.log('[useDiaryAIV2] stt_aborted', { reason: controller.signal.reason });
        return;
      }
      if (__DEV__) console.error('[useDiaryAIV2] stt_unexpected_error:', e?.message);
    } finally {
      await recorder.deleteRecording(uri);
      if (__DEV__) console.log('[useDiaryAIV2] stt_recording_deleted');
    }
  }, [options.token, recorder]);

  // ── handleVoicePress ──────────────────────────────────────────────────────
  const handleVoicePress = useCallback(async () => {
    if (__DEV__) console.log('[useDiaryAIV2] voice_tap', { state: v2State, isRecording: recorder.isRecording });

    if (v2State === 'RECORDING') {
      // 녹음 중지 → STT
      setV2State('TRANSCRIBING');
      const uri = await recorder.stopRecording();
      await _processVoice(uri);
    } else {
      // 녹음 시작
      const result = await recorder.startRecording();
      if (result === 'permission_denied') {
        setV2State('PERMISSION');
        return;
      }
      if (result === 'error') {
        setCurrentError({
          origin:      'PERMISSION',
          message:     '마이크를 시작할 수 없습니다. 다시 시도해주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
        });
        setV2State('ERROR');
        return;
      }
      setV2State('RECORDING');
    }
  }, [v2State, recorder, _processVoice]);

  // ── handleSetError ────────────────────────────────────────────────────────
  /** 외부에서 오류를 직접 설정하고 ERROR 상태로 전환 (AIPermissionViewV2 콜백 등) */
  const handleSetError = useCallback((error: DiaryServiceError) => {
    if (__DEV__) console.log('[useDiaryAIV2] handleSetError:', error.causeCode ?? error.origin);
    setCurrentError(error);
    setV2State('ERROR');
  }, []);

  // ── handleEditInput ────────────────────────────────────────────────────────
  /** RESULT → INPUT 복귀 (inputText 유지 — 교사가 입력을 수정 후 재생성) */
  const handleEditInput = useCallback(() => {
    if (__DEV__) console.log('[useDiaryAIV2] edit_input: RESULT → INPUT');
    setV2State('INPUT');
  }, []);

  // ── handleInsert ──────────────────────────────────────────────────────────
  const handleInsert = useCallback(() => {
    if (isInsertingRef.current) {
      if (__DEV__) console.log('[useDiaryAIV2] insert_skipped: duplicate');
      return;
    }

    const hasContent = Boolean(resultText) || generatedStudents.length > 0;
    if (!options.onInsert || !hasContent) {
      if (__DEV__) console.log('[useDiaryAIV2] insert_skipped', { has_onInsert: Boolean(options.onInsert), has_content: hasContent });
      return;
    }

    isInsertingRef.current = true;

    const result: DiaryInsertResult = {
      commonDiary: resultText,
      students:    generatedStudents,
    };
    options.onInsert(result);
    if (__DEV__) console.log('[useDiaryAIV2] insert_completed', { student_count: result.students.length });

    // 삽입 완료 피드백 (2초 후 자동 해제)
    setInsertDone(true);
    insertTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) setInsertDone(false);
    }, 2_000);

    options.onClose?.();
  }, [resultText, generatedStudents, options.onInsert, options.onClose]);

  // ── isLocked ──────────────────────────────────────────────────────────────
  const isLocked = LOCK_STATES.includes(v2State);

  return {
    v2State,
    currentError,
    inputText,
    setInputText,
    resultText,
    setResultText,
    generatedStudents,
    setGeneratedStudents,
    insertDone,
    handleSubmit,
    handleVoicePress,
    handleInsert,
    handleEditInput,
    handleSetError,
    handleClose,
    handleRetry,
    reset,
    isLocked,
    recordingDurationMs: recorder.durationMs,
  };
}
