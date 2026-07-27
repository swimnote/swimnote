/**
 * useDiaryAI — SwimNote AI UI Framework V1.0 / Feature: Diary
 * 일지 AI 작성 비즈니스 로직
 *
 * 의존: useAIStateMachine, AIContracts
 * 사용: DiaryAIContent
 *
 * [원칙 2] 앱 화면으로부터 token / teacherId / classId / date / students[]를 받습니다.
 * [원칙 3] 모든 AI 작업(STT → 생성 → 결과 → 수정 → 삽입)은 이 Hook 내부에서 완결됩니다.
 * [원칙 5] machine.state 변화마다 onLockChange를 호출하여 dismiss 잠금 상태를 부모에 알립니다.
 * [원칙 6] handleInsert()에서만 onInsert(DiaryInsertResult)를 호출합니다.
 *
 * Phase 4: 실제 AI Engine API 연결 완료
 *   - POST /api/ai/diary/generate  → 일지 생성
 *   - POST /api/ai/whisper/transcribe → 음성 → 텍스트 변환
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

/** AI Engine 성공 응답 — POST /api/ai/diary/generate */
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

/** AI Engine 성공 응답 — POST /api/ai/whisper/transcribe */
interface WhisperTranscribeResponse {
  request_id: string;
  transcript: string;
}

/** AI Engine Error Contract */
interface AIEngineError {
  request_id: string;
  error: {
    code:      string;
    message:   string;
    retryable: boolean;
  };
}

// ─── Hook 옵션 ───────────────────────────────────────────────────────────────

interface UseDiaryAIOptions {
  /** 현재 일지 템플릿에 이미 입력된 내용 */
  existingContent?: string;
  // ── [원칙 2] 앱 화면 공급 데이터 ─────────────────────────────────────────
  token?:           string;
  teacherId?:       string;
  classId?:         string;
  date?:            string;
  students?:        StudentContext[];
  poolId?:          string;
  // ── [원칙 6] 최종 삽입 콜백 ──────────────────────────────────────────────
  /** COMPLETE 시 DiaryInsertResult를 부모에게 전달하는 콜백 */
  onInsert?:        (result: DiaryInsertResult) => void;
  /** 삽입 완료 후 모달을 닫는 콜백 */
  onClose?:         () => void;
  /**
   * [원칙 1·5] machine.state 변화 시 호출됩니다.
   * true  → dismiss 차단 (PROCESSING / UPLOADING / RECORDING / RESULT / EDITING)
   * false → dismiss 허용 (INPUT / PERMISSION / ERROR / COMPLETE / OPENING)
   */
  onLockChange?:    (locked: boolean) => void;
}

// ─── Dismiss 잠금 대상 States ─────────────────────────────────────────────────

/** 이 State에 있는 동안 백드롭·스와이프 dismiss를 차단합니다. [원칙 5] */
const LOCK_STATES: AIState[] = ['PROCESSING', 'UPLOADING', 'RECORDING', 'RESULT', 'EDITING'];

// ─── API Base URL ─────────────────────────────────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://swimnote.kr/api';

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDiaryAI(options: UseDiaryAIOptions = {}) {
  const machine  = useAIStateMachine();
  const recorder = useVoiceRecorder();

  const [inputText,  setInputText]  = useState('');
  const [resultText, setResultText] = useState('');

  /** 재작성 횟수 카운터 */
  const rewriteCountRef = useRef(0);

  /**
   * 마지막 AI 요청 ID — 오류 추적·문의·로그 확인에 사용됩니다.
   * [spec] request_id를 앱에서도 유지합니다.
   */
  const lastRequestIdRef = useRef<string | null>(null);

  /**
   * 마지막 LLM usage 정보 — 크레딧 시스템에서 사용 예정.
   * [spec] usage 정보는 버리지 말고 객체 그대로 유지합니다.
   */
  const lastUsageRef = useRef<DiaryGenerateResponse['usage'] | null>(null);

  /** "삽입 완료" 버튼 피드백 상태 (Stage A 임시) */
  const [insertDone, setInsertDone] = useState(false);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (insertTimerRef.current) clearTimeout(insertTimerRef.current);
    };
  }, []);

  // ─── 모달 마운트 시 CLOSED → OPENING → INPUT 자동 전환 ──────────────────
  useEffect(() => {
    machine.open(); // CLOSED → OPENING
  }, []);

  useEffect(() => {
    if (machine.state === 'OPENING') {
      machine.grantPermission(); // OPENING → INPUT
    }
  }, [machine.state]);

  // ─── [원칙 1·5] State 변화 → dismiss 잠금 상태 부모에 알림 ──────────────
  useEffect(() => {
    options.onLockChange?.(LOCK_STATES.includes(machine.state as AIState));
  }, [machine.state]);

  // ─── 음성 입력 ──────────────────────────────────────────────────────────

  const handleVoicePress = async () => {
    console.log(`[SM-QA] State: ${machine.state} | Event: VOICE_BUTTON_TAP | isRecording=${recorder.isRecording}`);

    if (machine.is('RECORDING')) {
      // ── 녹음 중지 → STT 변환 ────────────────────────────────────────────
      console.log('[SM-QA] State: RECORDING | Event: STOP_RECORDING | Next: INPUT | Function: recorder.stopRecording()');
      machine.stopRecording();                        // RECORDING → INPUT
      const uri = await recorder.stopRecording();     // 녹음 파일 URI 획득
      await processVoice(uri);                        // STT → setInputText
    } else {
      // ── 녹음 시작 — 권한 확인 포함 ───────────────────────────────────────
      console.log('[SM-QA] State: INPUT | Event: START_RECORDING | Function: recorder.startRecording()');
      const result = await recorder.startRecording();

      if (result === 'permission_denied') {
        console.log('[SM-QA] State: INPUT | Event: PERMISSION_REQUIRED | Next: PERMISSION');
        machine.requirePermission();
        return;
      }
      if (result === 'error') {
        machine.setError({
          origin:      'PERMISSION',
          message:     '마이크를 시작할 수 없습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }
      machine.startRecording(); // INPUT → RECORDING
    }
  };

  /**
   * processVoice — 녹음 파일 URI를 받아 Whisper STT 변환 후 inputText에 설정
   * POST /api/ai/whisper/transcribe
   *
   * [원칙 3] STT 완료 후 inputText만 채우고, AI 자동 실행 없음.
   * 사용자가 텍스트 확인 후 "AI 작성" 버튼을 탭해야 generateDiary() 실행.
   */
  const processVoice = async (uri: string | null) => {
    if (!uri) {
      console.warn('[VOICE] processVoice: URI 없음 — STT 스킵');
      return;
    }

    console.log('[VOICE-0] processVoice 시작 — uri:', uri);

    try {
      const endpoint = `${API_BASE}/ai/whisper/transcribe`;

      const formData = new FormData();
      formData.append('audio', {
        uri,
        name: 'recording.m4a',
        type: 'audio/m4a',
      } as any);

      console.log('[VOICE-1] Whisper API 요청 →', endpoint);

      // [원칙 2] 앱 화면에서 전달받은 token으로 Authorization 헤더 구성
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }

      const response = await fetch(endpoint, {
        method:  'POST',
        body:    formData,
        headers,
      });

      const body = await response.json() as WhisperTranscribeResponse | AIEngineError;

      // Error Contract 처리
      if (!response.ok || 'error' in body) {
        const err = (body as AIEngineError).error;
        const reqId = (body as AIEngineError).request_id ?? '?';
        console.error(`[VOICE-ERR] STT 실패 request_id=${reqId} code=${err?.code} retryable=${err?.retryable}`);
        machine.setError({
          origin:      'NETWORK',
          message:     err?.message ?? '음성 인식에 실패했습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      const { request_id, transcript } = body as WhisperTranscribeResponse;
      console.log(`[VOICE-2] STT 완료 request_id=${request_id} transcript_len=${transcript?.length ?? 0}`);

      if (transcript?.trim()) {
        setInputText(transcript.trim());
        console.log('[VOICE-3] inputText 설정 완료 — AI 자동 실행 없음');
      } else {
        console.warn('[VOICE-3] transcript 비어 있음 — 무음 또는 인식 불가');
      }
    } catch (e: any) {
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
    console.log('[REWRITE-CALL] handleSubmit() 진입 — state:', machine.state, 'inputText길이:', inputText.length);

    if (machine.state === 'RESULT' || machine.state === 'EDITING') {
      console.log('[REWRITE-2] RESULT 상태 → retry(INPUT) 선행');
      rewriteCountRef.current += 1;
      console.log('[REWRITE-COUNT] rewriteCountRef 증가 →', rewriteCountRef.current);
      machine.retry('INPUT');
    } else if (!inputText.trim()) {
      console.log('[REWRITE-1] 스킵 — INPUT 상태이고 inputText 없음');
      return;
    }

    console.log('[REWRITE-3] machine.submit() 호출');
    machine.submit();  // INPUT → PROCESSING
    console.log('[REWRITE-4] generateDiary() 시작');
    await generateDiary();
  };

  /**
   * generateDiary — 실제 AI Engine API 호출
   * POST /api/ai/diary/generate
   *
   * Request: { teacher_id, class_id, lesson_date, input_text, students[], existing_content? }
   * Response: { request_id, schema_version, feature, result: { common, students[] }, usage }
   */
  const generateDiary = async () => {
    try {
      const endpoint = `${API_BASE}/ai/diary/generate`;

      console.log('[GENERATE-1] generateDiary 시작 — rewriteCount:', rewriteCountRef.current);
      console.log('[GENERATE-2] context — classId:', options.classId, 'date:', options.date, 'students:', options.students?.length ?? 0);

      // [원칙 2] 앱 화면 공급 데이터를 요청 body로 구성
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
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }

      const response = await fetch(endpoint, {
        method:  'POST',
        headers,
        body:    JSON.stringify(requestBody),
      });

      const body = await response.json() as DiaryGenerateResponse | AIEngineError;

      // ── Error Contract 처리 ─────────────────────────────────────────────
      if (!response.ok || 'error' in body) {
        const err   = (body as AIEngineError).error;
        const reqId = (body as AIEngineError).request_id ?? '?';
        console.error(`[GENERATE-ERR] AI 생성 실패 request_id=${reqId} code=${err?.code} retryable=${err?.retryable}`);
        machine.setError({
          origin:      'NETWORK',
          message:     err?.message ?? 'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // ── 성공 응답 파싱 ─────────────────────────────────────────────────
      const data = body as DiaryGenerateResponse;

      // [spec] request_id 유지 — 오류 추적·문의에 사용
      lastRequestIdRef.current = data.request_id;

      // [spec] usage 유지 — 크레딧 시스템 예정
      lastUsageRef.current = data.usage;

      console.log(`[GENERATE-3] 완료 request_id=${data.request_id} tokens=${data.usage?.total_tokens ?? 0}`);
      console.log(`[GENERATE-4] result common_len=${data.result.common.length} students=${data.result.students.length}`);

      setResultText(data.result.common);

      // students[] 결과를 DiaryInsertResult 형식으로 변환하여 저장
      // (handleInsert 시 함께 전달)
      generatedStudentsRef.current = data.result.students.map(s => ({
        studentId:   s.student_id,
        studentName: (options.students ?? []).find(st => st.id === s.student_id)?.name ?? s.student_id,
        note:        s.content,
      }));

      console.log('[GENERATE-5] machine.receiveResult() 호출');
      machine.receiveResult();
      console.log('[GENERATE-6] machine.receiveResult() 완료');
    } catch (e: any) {
      console.error('[GENERATE-ERR] generateDiary 예외:', e?.message ?? e);
      machine.setError({
        origin:      'NETWORK',
        message:     'AI 생성에 실패했습니다. 네트워크를 확인해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  /**
   * AI Engine이 반환한 students[] 결과를 보관합니다.
   * handleInsert() 시점에 DiaryInsertResult.students로 전달됩니다.
   * 재작성 시 generateDiary()에서 덮어씁니다.
   */
  const generatedStudentsRef = useRef<StudentDiaryNote[]>([]);

  // ─── [원칙 6] 최종 삽입 — 모든 결과가 확정된 시점에만 onInsert 호출 ────

  const handleInsert = () => {
    console.log('[INSERT-1] 버튼 클릭 — handleInsert 진입');
    console.log('[INSERT-2] result 확인:', resultText ? `길이=${resultText.length}자` : '(없음)');
    console.log('[INSERT-2b] request_id:', lastRequestIdRef.current, '| usage:', JSON.stringify(lastUsageRef.current));

    if (options.onInsert && resultText) {
      // [원칙 6] DiaryInsertResult 단일 구조체로 전달
      const result: DiaryInsertResult = {
        commonDiary: resultText,
        students:    generatedStudentsRef.current,
      };

      console.log(`[INSERT-RESULT] 삽입 직전 commonDiary 길이=${result.commonDiary.length}, students=${result.students.length}명`);
      console.log('[INSERT-3] 부모 onInsert 시작');
      options.onInsert(result);
      console.log('[INSERT-4] 부모 onInsert 완료');

      console.log('[INSERT-6] modal close 시작');
      console.log('[MODAL-CLOSE-CALL] handleInsert → options.onClose() 호출');
      options.onClose?.();
      console.log('[INSERT-7] modal close 호출 완료');
    } else {
      console.log('[INSERT-3] onInsert 스킵 — hasOnInsert:', !!options.onInsert, 'hasResult:', !!resultText);
    }

    // ── STAGE C: machine.complete() 비활성화 (비교 실험) ─────────────────
    // console.log('[INSERT-5] machine complete 시작');
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
    /** 마지막 요청 ID (오류 추적용) */
    lastRequestId: lastRequestIdRef,
    /** 마지막 LLM usage (크레딧 시스템 예정) */
    lastUsage: lastUsageRef,
  };
}
