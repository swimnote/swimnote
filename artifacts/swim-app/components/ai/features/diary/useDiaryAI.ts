/**
 * useDiaryAI — SwimNote AI UI Framework V1.0 / Feature: Diary
 * 일지 AI 작성 비즈니스 로직
 *
 * [원칙 2] 앱 화면으로부터 token / teacherId / classId / date / students[]를 받습니다.
 * [원칙 3] 모든 AI 작업(STT → 생성 → 결과 → 수정 → 삽입)은 이 Hook 내부에서 완결됩니다.
 * [원칙 5] machine.state 변화마다 onLockChange를 호출하여 dismiss 잠금 상태를 부모에 알립니다.
 * [원칙 6] handleInsert()에서만 onInsert(DiaryInsertResult)를 호출합니다.
 *
 * Phase 4 연결 완료:
 *   - POST /api/ai/diary/generate       — Teacher Diary 생성
 *   - POST /api/ai/whisper/transcribe   — 음성 → 텍스트
 *
 * [P8] Timeout / Retry / Cancel 정책:
 *   - Teacher Diary timeout: 60초
 *   - Whisper timeout: 60초
 *   - 자동 retry: retryable=true 또는 네트워크 오류 시 최대 1회 (자동)
 *   - 사용자 직접 재시도: AIErrorView "다시 시도" 버튼 → machine.retry('INPUT')
 *   - 언마운트(모달 닫기) 시 진행 중 요청 즉시 취소
 *   - 중복 호출 방지: isInFlightRef
 */

import { useEffect, useRef, useState } from 'react';
import { useAIStateMachine } from '../../hooks/useAIStateMachine';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import type { AIState } from '../../core/AIContracts';

// ─── 공개 타입 계약 ──────────────────────────────────────────────────────────

/** [원칙 6] 최종 삽입 시 AI 모달이 앱 화면으로 전달하는 결과 구조체 */
export interface DiaryInsertResult {
  /** 공통 일지 텍스트 → setCommonContent */
  commonDiary: string;
  /** 학생별 일지 목록 → studentId 기준으로 setStudentNotes */
  students:    StudentDiaryNote[];
}

export interface StudentDiaryNote {
  studentId:   string;
  studentName: string;
  note:        string;
}

/** [원칙 2] 앱 화면이 AI 모달로 공급하는 학생 컨텍스트 */
export interface StudentContext {
  id:   string;
  name: string;
}

// ─── AI Engine Response 타입 ─────────────────────────────────────────────────

/** POST /api/ai/diary/generate 성공 응답 */
interface DiaryGenerateResponse {
  request_id:     string;
  schema_version: string;
  feature:        string;
  result: {
    common:   string;
    students: { student_id: string; content: string }[];
  };
  usage: {
    input_tokens:  number;
    output_tokens: number;
    total_tokens:  number;
  };
}

/** POST /api/ai/whisper/transcribe 성공 응답 */
interface WhisperTranscribeResponse {
  request_id: string;
  transcript: string;
}

/** AI Engine Error Contract */
interface AIEngineError {
  request_id?: string;
  error: {
    code:      string;
    message:   string;
    retryable: boolean;
  };
}

// ─── Hook 옵션 ───────────────────────────────────────────────────────────────

interface UseDiaryAIOptions {
  existingContent?: string;
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  students?:        StudentContext[];
  poolId?:          string;
  onInsert?:        (result: DiaryInsertResult) => void;
  onClose?:         () => void;
  /**
   * [원칙 1·5] machine.state 변화 시 호출됩니다.
   * true  → dismiss 차단
   * false → dismiss 허용
   */
  onLockChange?:    (locked: boolean) => void;
}

// ─── Dismiss 잠금 대상 States ─────────────────────────────────────────────────

const LOCK_STATES: AIState[] = ['PROCESSING', 'UPLOADING', 'RECORDING', 'RESULT', 'EDITING'];

// ─── 상수 ────────────────────────────────────────────────────────────────────

/** [P8] API 호출 Timeout — 60초 */
const TIMEOUT_MS = 60_000;

/** [P8] 자동 retry 최대 횟수 */
const MAX_AUTO_RETRY = 1;

/** [P8] 자동 retry 전 대기 시간 */
const AUTO_RETRY_DELAY_MS = 800;

/** AI Engine Production Base URL — https://swimnote.ai.kr */
const AI_ENGINE_BASE = process.env.EXPO_PUBLIC_AI_ENGINE_URL ?? 'https://swimnote.ai.kr';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDiaryAI(options: UseDiaryAIOptions = {}) {
  const machine  = useAIStateMachine();
  const recorder = useVoiceRecorder();

  const [inputText,  setInputText]  = useState('');
  const [resultText, setResultText] = useState('');

  // ── [P8] Abort / Timeout / In-flight refs ──────────────────────────────
  /** generateDiary 진행 중 AbortController */
  const generateAbortRef   = useRef<AbortController | null>(null);
  /** processVoice 진행 중 AbortController */
  const voiceAbortRef      = useRef<AbortController | null>(null);
  /** 중복 호출 방지 — generateDiary 진행 중 true */
  const isInFlightRef      = useRef(false);
  /** 컴포넌트 마운트 여부 — 언마운트 후 setState 방지 */
  const isMountedRef       = useRef(true);
  /** 자동 retry 횟수 카운터 — 사용자 새 요청 시 초기화 */
  const autoRetryCountRef  = useRef(0);

  // ── 재작성 횟수 카운터 (더미 구분용 → Phase 4에서는 로그 전용) ─────────
  const rewriteCountRef = useRef(0);

  // ── [spec] request_id / usage 유지 ────────────────────────────────────
  /**
   * [spec] 마지막 AI 요청 ID — 오류 추적·문의·로그 확인에 사용됩니다.
   */
  const lastRequestIdRef = useRef<string | null>(null);
  /**
   * [spec] 마지막 LLM usage — 향후 크레딧 시스템에서 사용 예정.
   * 현재 화면에는 표시하지 않습니다.
   */
  const lastUsageRef = useRef<DiaryGenerateResponse['usage'] | null>(null);

  /** AI Engine students[] 결과 보관 — handleInsert 시 DiaryInsertResult.students로 전달 */
  const generatedStudentsRef = useRef<StudentDiaryNote[]>([]);

  /** "삽입 완료" 버튼 피드백 (Stage A 임시) */
  const [insertDone, setInsertDone] = useState(false);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── [P8] 언마운트 시 진행 중 요청 전부 취소 ───────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      generateAbortRef.current?.abort('unmount');
      voiceAbortRef.current?.abort('unmount');
      if (insertTimerRef.current) clearTimeout(insertTimerRef.current);
    };
  }, []);

  // ── 모달 마운트 시 CLOSED → OPENING → INPUT 자동 전환 ──────────────────
  useEffect(() => {
    machine.open();
  }, []);

  useEffect(() => {
    if (machine.state === 'OPENING') {
      machine.grantPermission();
    }
  }, [machine.state]);

  // ── [원칙 1·5] State 변화 → dismiss 잠금 부모에 알림 ─────────────────
  useEffect(() => {
    options.onLockChange?.(LOCK_STATES.includes(machine.state as AIState));
  }, [machine.state]);

  // ─── 음성 입력 ──────────────────────────────────────────────────────────

  const handleVoicePress = async () => {
    console.log(`[SM-QA] State: ${machine.state} | Event: VOICE_BUTTON_TAP | isRecording=${recorder.isRecording}`);

    if (machine.is('RECORDING')) {
      console.log('[SM-QA] RECORDING | Event: STOP_RECORDING');
      machine.stopRecording();
      const uri = await recorder.stopRecording();
      await processVoice(uri);
    } else {
      console.log('[SM-QA] INPUT | Event: START_RECORDING');
      const result = await recorder.startRecording();
      if (result === 'permission_denied') {
        machine.requirePermission();
        return;
      }
      if (result === 'error') {
        machine.setError({
          origin: 'PERMISSION',
          message: '마이크를 시작할 수 없습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }
      machine.startRecording();
    }
  };

  /**
   * processVoice — 녹음 URI → POST /api/ai/whisper/transcribe → inputText 설정
   * [P8] 60초 timeout, 언마운트 취소
   */
  const processVoice = async (uri: string | null) => {
    if (!uri) {
      console.warn('[VOICE] URI 없음 — STT 스킵');
      return;
    }

    // 이전 voice 요청 취소
    voiceAbortRef.current?.abort('new-request');
    const controller = new AbortController();
    voiceAbortRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);

    console.log('[VOICE-0] processVoice 시작 — uri:', uri);

    try {
      const endpoint = `${AI_ENGINE_BASE}/api/ai/whisper/transcribe`;
      const formData = new FormData();
      formData.append('audio', { uri, name: 'recording.m4a', type: 'audio/m4a' } as any);

      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

      console.log('[VOICE-1] Whisper API 요청 →', endpoint);

      const response = await fetch(endpoint, {
        method: 'POST',
        body:   formData,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const body = await response.json() as WhisperTranscribeResponse | AIEngineError;

      if (!response.ok || 'error' in body) {
        const err   = (body as AIEngineError).error;
        const reqId = (body as AIEngineError).request_id ?? '?';
        console.error(`[VOICE-ERR] STT 실패 request_id=${reqId} code=${err?.code} retryable=${err?.retryable}`);
        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'NETWORK',
          message:     err?.message ?? '음성 인식에 실패했습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      const { request_id, transcript } = body as WhisperTranscribeResponse;
      console.log(`[VOICE-2] STT 완료 request_id=${request_id} len=${transcript?.length ?? 0}`);

      if (transcript?.trim()) {
        setInputText(transcript.trim());
        console.log('[VOICE-3] inputText 설정 완료 — AI 자동 실행 없음');
      } else {
        console.warn('[VOICE-3] transcript 비어 있음');
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const reason = (controller.signal as any).reason;

      if (e?.name === 'AbortError' && reason === 'unmount') {
        console.log('[VOICE-ABORT] unmount으로 인한 취소');
        return;
      }
      if (e?.name === 'AbortError' && reason === 'timeout') {
        console.error('[VOICE-TIMEOUT] 60초 초과');
        machine.setError({
          origin:      'TIMEOUT',
          message:     '음성 인식 시간이 초과되었습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      console.error('[VOICE-ERR] processVoice 예외:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     '음성 인식에 실패했습니다. 다시 시도해주세요.',
        retryTarget: 'INPUT',
      });
    } finally {
      await recorder.deleteRecording(uri);
      console.log('[VOICE-4] 임시 녹음 파일 삭제 완료');
    }
  };

  // ─── 텍스트 제출 / 다시 작성 ────────────────────────────────────────────

  const handleSubmit = async () => {
    // [P8] 중복 호출 방지
    if (isInFlightRef.current) {
      console.log('[REWRITE-CALL] handleSubmit() 스킵 — 이미 진행 중');
      return;
    }

    console.log('[REWRITE-CALL] handleSubmit() 진입 — state:', machine.state, 'inputText길이:', inputText.length);

    if (machine.state === 'RESULT' || machine.state === 'EDITING') {
      console.log('[REWRITE-2] RESULT/EDITING → retry(INPUT) 선행');
      rewriteCountRef.current  += 1;
      autoRetryCountRef.current = 0; // 새 사용자 요청 → 자동 retry 카운터 초기화
      machine.retry('INPUT');
    } else if (!inputText.trim()) {
      console.log('[REWRITE-1] 스킵 — inputText 없음');
      return;
    } else {
      autoRetryCountRef.current = 0; // 최초 제출 시도 → 자동 retry 카운터 초기화
    }

    machine.submit(); // INPUT → PROCESSING

    isInFlightRef.current = true;
    try {
      await generateDiary();
    } finally {
      isInFlightRef.current = false;
    }
  };

  /**
   * generateDiary — POST /api/ai/diary/generate 실제 호출
   *
   * [P8] 60초 timeout, 언마운트 취소, 자동 retry 1회 (retryable=true 또는 네트워크 오류)
   * [P6] students[] 매칭: 알 수 없는 student_id, 빈 content, 중복 제거
   */
  const generateDiary = async () => {
    // 이전 generateDiary 요청 취소 (재호출 보호)
    generateAbortRef.current?.abort('new-request');
    const controller = new AbortController();
    generateAbortRef.current = controller;

    const timeoutId = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);

    console.log('[GENERATE-1] generateDiary 시작 — rewriteCount:', rewriteCountRef.current);
    console.log('[GENERATE-2] context — classId:', options.classId, 'date:', options.date, 'students:', options.students?.length ?? 0);

    try {
      const endpoint = `${AI_ENGINE_BASE}/api/ai/diary/generate`;

      const requestBody = {
        teacher_id:       options.teacherId   ?? '',
        class_id:         options.classId     ?? '',
        lesson_date:      options.date        ?? '',
        input_text:       inputText.trim(),
        students:         (options.students ?? []).map(s => ({
          student_id:   s.id,
          student_name: s.name,
        })),
        existing_content: options.existingContent ?? '',
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      };
      if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

      const response = await fetch(endpoint, {
        method:  'POST',
        headers,
        body:    JSON.stringify(requestBody),
        signal:  controller.signal,
      });

      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      // ── JSON 파싱 오류 처리 ────────────────────────────────────────────
      let body: DiaryGenerateResponse | AIEngineError;
      try {
        body = await response.json();
      } catch {
        throw new Error('PARSE_ERROR');
      }

      // ── Error Contract 처리 ─────────────────────────────────────────────
      if (!response.ok || 'error' in body) {
        const err   = (body as AIEngineError).error;
        const reqId = (body as AIEngineError).request_id ?? '?';

        console.error(`[GENERATE-ERR] AI 실패 request_id=${reqId} code=${err?.code} retryable=${err?.retryable} status=${response.status}`);

        // 401 — 인증 오류 (retry 불가)
        if (response.status === 401) {
          machine.setError({
            origin:      'UNKNOWN',
            message:     '인증이 만료되었습니다. 다시 로그인해주세요.',
            retryTarget: null,
          });
          return;
        }

        // retryable=true → 자동 retry 1회
        if (err?.retryable && autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
          autoRetryCountRef.current += 1;
          console.log(`[GENERATE-AUTO-RETRY] retryable=true — 자동 재시도 (${autoRetryCountRef.current}/${MAX_AUTO_RETRY})`);
          await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
          if (!isMountedRef.current) return;
          await generateDiary();
          return;
        }

        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'NETWORK',
          message:     err?.message ?? 'AI 생성에 실패했습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // ── 성공 응답 파싱 ─────────────────────────────────────────────────
      const data = body as DiaryGenerateResponse;

      // [spec] request_id / usage 유지
      lastRequestIdRef.current = data.request_id;
      lastUsageRef.current     = data.usage;

      console.log(`[GENERATE-3] 성공 request_id=${data.request_id} tokens=${data.usage?.total_tokens ?? 0}`);
      console.log(`[GENERATE-4] result common_len=${data.result.common.length} students_raw=${data.result.students.length}`);

      // ── [P6] students[] 매칭 — 유효성 필터 ───────────────────────────
      const validStudentIds = new Set((options.students ?? []).map(s => s.id));
      const seenStudentIds  = new Set<string>();
      const mappedStudents: StudentDiaryNote[] = [];

      for (const s of (data.result.students ?? [])) {
        // student_id 없음
        if (!s.student_id) {
          console.warn('[GENERATE-STUDENT] student_id 없음 — 건너뜀');
          continue;
        }
        // 알 수 없는 student_id (현재 수업에 없음)
        if (!validStudentIds.has(s.student_id)) {
          console.warn(`[GENERATE-STUDENT] 알 수 없는 student_id=${s.student_id} — 건너뜀`);
          continue;
        }
        // 빈 content
        if (!s.content?.trim()) {
          console.warn(`[GENERATE-STUDENT] student_id=${s.student_id} content 비어 있음 — 건너뜀`);
          continue;
        }
        // 중복 student_id (첫 번째만 사용)
        if (seenStudentIds.has(s.student_id)) {
          console.warn(`[GENERATE-STUDENT] 중복 student_id=${s.student_id} — 건너뜀`);
          continue;
        }
        seenStudentIds.add(s.student_id);

        const studentName = (options.students ?? []).find(st => st.id === s.student_id)?.name ?? s.student_id;
        mappedStudents.push({
          studentId:   s.student_id,
          studentName,
          note:        s.content.trim(),
        });
      }

      console.log(`[GENERATE-STUDENT] 매칭 결과: ${mappedStudents.length}/${data.result.students.length}명 (invalid/unknown/empty/duplicate 제외)`);
      generatedStudentsRef.current = mappedStudents;

      setResultText(data.result.common);

      console.log('[GENERATE-5] machine.receiveResult() 호출');
      machine.receiveResult(); // PROCESSING → RESULT
      console.log('[GENERATE-6] machine.receiveResult() 완료');
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const reason = (controller.signal as any).reason;

      // 언마운트에 의한 취소 — 상태 업데이트 없음
      if (e?.name === 'AbortError' && reason === 'unmount') {
        console.log('[GENERATE-ABORT] unmount으로 인한 취소 — 상태 업데이트 없음');
        return;
      }

      // 60초 Timeout
      if (e?.name === 'AbortError' && reason === 'timeout') {
        console.error('[GENERATE-TIMEOUT] 60초 초과');

        // timeout도 retryable 대상 — 1회 자동 retry
        if (autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
          autoRetryCountRef.current += 1;
          console.log(`[GENERATE-AUTO-RETRY] timeout — 자동 재시도 (${autoRetryCountRef.current}/${MAX_AUTO_RETRY})`);
          await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
          if (!isMountedRef.current) return;
          await generateDiary();
          return;
        }

        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'TIMEOUT',
          message:     'AI 생성 시간이 초과되었습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // JSON 파싱 오류
      if (e?.message === 'PARSE_ERROR') {
        console.error('[GENERATE-ERR] 응답 JSON 파싱 실패 request_id:', lastRequestIdRef.current);
        machine.setError({
          origin:      'UNKNOWN',
          message:     '서버 응답 형식이 올바르지 않습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // 네트워크 오류 → 자동 retry 1회
      if (autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
        autoRetryCountRef.current += 1;
        console.log(`[GENERATE-AUTO-RETRY] 네트워크 오류 — 자동 재시도 (${autoRetryCountRef.current}/${MAX_AUTO_RETRY})`);
        console.error('[GENERATE-ERR] 예외:', e?.message ?? e);
        await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
        if (!isMountedRef.current) return;
        await generateDiary();
        return;
      }

      console.error('[GENERATE-ERR] 최종 실패 request_id:', lastRequestIdRef.current, 'msg:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── [원칙 6] 최종 삽입 ────────────────────────────────────────────────

  const handleInsert = () => {
    console.log('[INSERT-1] handleInsert 진입');
    console.log('[INSERT-2] result 길이:', resultText.length, 'request_id:', lastRequestIdRef.current);
    console.log('[INSERT-2b] usage:', JSON.stringify(lastUsageRef.current));

    if (options.onInsert && resultText) {
      const result: DiaryInsertResult = {
        commonDiary: resultText,
        students:    generatedStudentsRef.current,
      };

      console.log(`[INSERT-RESULT] commonDiary=${result.commonDiary.length}자 students=${result.students.length}명`);
      options.onInsert(result);
      console.log('[INSERT-3] onInsert 완료');

      console.log('[MODAL-CLOSE-CALL] handleInsert → options.onClose()');
      options.onClose?.();
    } else {
      console.log('[INSERT-SKIP] onInsert 없음 또는 resultText 없음');
    }

    // STAGE C: machine.complete() 비활성화
    // machine.complete();
  };

  return {
    inputText,
    setInputText,
    resultText,
    setResultText,
    insertDone,
    handleVoicePress,
    handleSubmit,
    handleInsert,
    machine,
    /** [spec] 마지막 request_id (오류 추적용) */
    lastRequestId: lastRequestIdRef,
    /** [spec] 마지막 usage (크레딧 시스템 예정) */
    lastUsage: lastUsageRef,
  };
}
