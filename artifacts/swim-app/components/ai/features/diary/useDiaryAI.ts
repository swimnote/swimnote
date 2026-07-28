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

// ─── WP1: Request Contract 타입 ──────────────────────────────────────────────

/**
 * POST /api/ai/diary/generate 요청 구조 (V1.0 Contract)
 * WP1: request_id + context.students[{ref,name}] 추가
 */
interface TeacherDiaryAIRequest {
  request_id:     string;
  schema_version: '1.0';
  feature:        'teacher_diary';
  locale:         'ko-KR';
  input: {
    text: string;
  };
  context: {
    pool_id:      string;
    class_id:     string;
    lesson_date:  string;
    /** V1 하위 호환 유지 — students[].ref 목록과 항상 동일 */
    student_refs: string[];
    /** WP1 신규: 학생 ref + 전체 이름 배열 (이름 변형 금지) */
    students: Array<{
      ref:  string;
      name: string;
    }>;
  };
}

// ─── WP2: AI Engine Response 타입 ────────────────────────────────────────────

/**
 * Legacy 호환 Flag — AI Engine이 request_id를 응답에 포함하지 않는 전환 기간용
 * - true : response.request_id가 없을 때 구형 응답으로 허용 (expectedRequestId 일치 여부 확인 후 적용)
 * - false: response.request_id 없음 → Contract 오류
 * AI Engine이 request_id 반환을 확정하면 false로 변경하거나 조건부 블록 전체를 제거합니다.
 */
const ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID = true;

/**
 * WP2: AI Engine 외부 응답 타입 — 모든 필드 optional (외부 응답은 신뢰할 수 없음)
 * Runtime Validation 후 NormalizedDiaryResult로 변환합니다.
 */
interface TeacherDiaryAIStudentResult {
  student_ref?: unknown;
  student_id?:  unknown;
  content?:     unknown;
  feedback?:    unknown;
}

interface TeacherDiaryAIResponse {
  request_id?:     unknown;
  schema_version?: unknown;
  result?: {
    common?:   unknown;
    students?: unknown;
  };
  usage?: {
    input_tokens?:  unknown;
    output_tokens?: unknown;
    total_tokens?:  unknown;
  };
}

/** WP2: 내부 정규화 타입 — 검증 통과 후 사용 */
interface NormalizedDiaryStudentResult {
  studentRef: string;
  content:    string;
}

interface NormalizedDiaryResult {
  common:   string;
  students: NormalizedDiaryStudentResult[];
  /** request_id — 응답에 있을 경우 */
  requestId?: string;
  usage?: {
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

// ─── WP1: Request ID 생성 ─────────────────────────────────────────────────────

/** fallback 카운터 — 모듈 수명 동안 단조 증가 */
let _diaryReqSeq = 0;

/**
 * Fallback ID: 시각 + 단조 카운터 + 충분한 난수 조합
 * crypto.randomUUID() 를 사용할 수 없는 환경에서만 호출됩니다.
 */
function _fallbackDiaryRequestId(): string {
  _diaryReqSeq += 1;
  const time = Date.now().toString(36);
  const seq  = _diaryReqSeq.toString(36).padStart(4, '0');
  const rand = Math.random().toString(36).slice(2, 12);
  return `diary_${time}_${seq}_${rand}`;
}

/**
 * WP1: 사용자 요청마다 고유한 request_id 생성
 * - Expo SDK 54 + Hermes: globalThis.crypto.randomUUID() 우선 사용
 * - 미지원 환경: 시각 + 카운터 + 난수 조합 fallback
 */
function createDiaryRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof (globalThis.crypto as Crypto).randomUUID === 'function'
  ) {
    return `diary_${(globalThis.crypto as Crypto).randomUUID()}`;
  }
  return _fallbackDiaryRequestId();
}

// ─── WP1: Request 사전 검증 ────────────────────────────────────────────────────

/**
 * AI 호출 전 최소 필드 검증 (이름·원문 의미 분석 금지)
 * @returns null = 정상 / string = 오류 메시지
 */
function validateDiaryRequest(
  requestId: string,
  text:      string,
  opts:      UseDiaryAIOptions,
): string | null {
  if (!requestId)    return '[VALIDATE] request_id가 비어 있습니다.';
  if (!text.trim())  return '[VALIDATE] input.text가 비어 있습니다.';
  if (!opts.classId) return '[VALIDATE] class_id가 없습니다.';
  if (!opts.date)    return '[VALIDATE] lesson_date가 없습니다.';

  const students = opts.students ?? [];
  if (students.length === 0) return '[VALIDATE] students 배열이 비어 있습니다.';

  for (const s of students) {
    if (!s.id)   return '[VALIDATE] students[].ref가 없습니다.';
    if (!s.name) return `[VALIDATE] students[].name이 없습니다. ref=${s.id}`;
  }

  // pool_id — swimming_pool_id?: string | null (optional). 없으면 경고만.
  if (!opts.poolId) {
    console.warn('[VALIDATE] pool_id가 없습니다. swimming_pool_id 미설정 가능성 — 빈값으로 전송합니다.');
  }

  return null;
}

// ─── WP2: Response 정규화 함수 ────────────────────────────────────────────────

type NormalizeResult =
  | { ok: true;  result: NormalizedDiaryResult }
  | { ok: false; contractError: string };

/**
 * WP2: AI Engine 응답 전체를 검증하고 NormalizedDiaryResult로 변환합니다.
 *
 * 처리 순서 (§6):
 * 1. 기본 구조 검증
 * 2. request_id 검증 (Legacy Flag 포함)
 * 3. common 타입 검증
 * 4. students 배열 검증
 * 5. 각 학생 필드 정상화 (student_ref ?? student_id, content ?? feedback)
 * 6. 알 수 없는 student_ref → 전체 오류
 * 7. 중복 student_ref → 전체 오류
 * 8. 빈 결과 검증 (common='' + students=[] → 오류)
 * 9. 전체 통과 → NormalizedDiaryResult 반환
 *
 * @param rawResponse   응답 JSON (unknown)
 * @param expectedRequestId 이 generateDiary() 호출에 사용한 request_id
 * @param currentRequestId  현재 활성 request_id (ooo request 차단용)
 * @param validStudentRefs  요청 시 전달한 학생 id Set
 */
function normalizeDiaryResponse(params: {
  rawResponse:        unknown;
  expectedRequestId:  string;
  currentRequestId:   string;
  validStudentRefs:   Set<string>;
}): NormalizeResult {
  const { rawResponse, expectedRequestId, currentRequestId, validStudentRefs } = params;

  // 1. 기본 구조
  if (typeof rawResponse !== 'object' || rawResponse === null) {
    return { ok: false, contractError: 'CONTRACT_INVALID_STRUCTURE: 응답이 객체가 아닙니다.' };
  }
  const resp = rawResponse as TeacherDiaryAIResponse;

  // 2. request_id 검증
  if (resp.request_id !== undefined) {
    // 응답에 request_id가 있으면 반드시 예상 ID와 일치해야 합니다.
    if (typeof resp.request_id !== 'string') {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_TYPE: request_id가 문자열이 아닙니다.' };
    }
    if (resp.request_id !== expectedRequestId) {
      return { ok: false, contractError: `CONTRACT_REQUEST_ID_MISMATCH: expected=${expectedRequestId} got=${resp.request_id}` };
    }
  } else {
    // request_id 없음
    if (!ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID) {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_MISSING: 응답에 request_id가 없습니다.' };
    }
    // Legacy 허용 — expectedRequestId가 여전히 현재 활성 ID인지 확인
    if (expectedRequestId !== currentRequestId) {
      return { ok: false, contractError: `CONTRACT_STALE_LEGACY_RESPONSE: expectedId=${expectedRequestId} currentId=${currentRequestId}` };
    }
  }

  // 3. result 구조 검증
  if (typeof resp.result !== 'object' || resp.result === null) {
    return { ok: false, contractError: 'CONTRACT_RESULT_MISSING: result 필드가 없거나 잘못된 타입입니다.' };
  }

  // 4. common 검증
  const rawCommon = resp.result.common;
  if (typeof rawCommon !== 'string') {
    return { ok: false, contractError: `CONTRACT_COMMON_TYPE: common이 문자열이 아닙니다. type=${typeof rawCommon}` };
  }
  const common = rawCommon;

  // 5. students 배열 검증
  const rawStudents = resp.result.students;
  if (rawStudents !== undefined && !Array.isArray(rawStudents)) {
    return { ok: false, contractError: 'CONTRACT_STUDENTS_NOT_ARRAY: students가 배열이 아닙니다.' };
  }
  const studentsArray: TeacherDiaryAIStudentResult[] = Array.isArray(rawStudents) ? rawStudents : [];

  // 6. 빈 결과 검증 — common='' + students=[] 동시 → 오류
  if (common === '' && studentsArray.length === 0) {
    return { ok: false, contractError: 'CONTRACT_EMPTY_RESULT: common과 students 모두 비어 있습니다.' };
  }

  // 7. 각 학생 필드 정상화 + ref/중복 검증
  const normalizedStudents: NormalizedDiaryStudentResult[] = [];
  const seenRefs = new Set<string>();

  for (let i = 0; i < studentsArray.length; i++) {
    const item = studentsArray[i];
    if (typeof item !== 'object' || item === null) {
      return { ok: false, contractError: `CONTRACT_STUDENT_NOT_OBJECT: students[${i}]가 객체가 아닙니다.` };
    }

    // student_ref 우선, 없으면 student_id
    const studentRef =
      typeof item.student_ref === 'string' && item.student_ref
        ? item.student_ref
        : typeof item.student_id === 'string' && item.student_id
          ? item.student_id
          : null;

    if (!studentRef) {
      return { ok: false, contractError: `CONTRACT_STUDENT_REF_MISSING: students[${i}]에 student_ref/student_id가 없습니다.` };
    }

    // content 우선, 없으면 feedback (§4 우선순위 수정)
    const content =
      typeof item.content === 'string'
        ? item.content
        : typeof item.feedback === 'string'
          ? item.feedback
          : null;

    if (content === null) {
      return { ok: false, contractError: `CONTRACT_STUDENT_CONTENT_TYPE: students[${i}] ref=${studentRef} content/feedback이 문자열이 아닙니다.` };
    }

    // 알 수 없는 student_ref → 전체 오류 (§9)
    if (!validStudentRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_UNKNOWN_STUDENT_REF: ref=${studentRef} 는 요청 학생 목록에 없습니다.` };
    }

    // 중복 student_ref → 전체 오류 (§10)
    if (seenRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_DUPLICATE_STUDENT_REF: ref=${studentRef} 가 응답에 중복 등장했습니다.` };
    }
    seenRefs.add(studentRef);

    normalizedStudents.push({ studentRef, content: content.trim() });
  }

  // usage 정규화 (optional — 존재하면 숫자 타입 보장)
  let usage: NormalizedDiaryResult['usage'];
  if (resp.usage !== undefined) {
    const u = resp.usage;
    usage = {
      input_tokens:  typeof u.input_tokens  === 'number' ? u.input_tokens  : 0,
      output_tokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
      total_tokens:  typeof u.total_tokens  === 'number' ? u.total_tokens  : 0,
    };
  }

  return {
    ok:     true,
    result: {
      common:    common,
      students:  normalizedStudents,
      requestId: typeof resp.request_id === 'string' ? resp.request_id : undefined,
      usage,
    },
  };
}

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
   * WP1: 현재 사용자 요청의 request_id
   * - handleSubmit() 호출마다 새로 생성 (사용자 액션 기준)
   * - generateDiary() 내부 자동 재시도에서는 동일 값 유지
   */
  const currentRequestIdRef = useRef<string>('');
  /**
   * [spec] 마지막 LLM usage — 향후 크레딧 시스템에서 사용 예정.
   * 현재 화면에는 표시하지 않습니다.
   */
  const lastUsageRef = useRef<NormalizedDiaryResult['usage'] | null>(null);

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

    // WP1: 사용자 액션마다 새 request_id 생성 (자동 retry는 생성하지 않음)
    currentRequestIdRef.current = createDiaryRequestId();
    console.log('[GENERATE-ID] 새 request_id 생성 — id:', currentRequestIdRef.current);

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

      // WP1: Request Body — TeacherDiaryAIRequest V1.0
      const studentsList = (options.students ?? []).map(s => ({ ref: s.id, name: s.name }));

      const requestBody: TeacherDiaryAIRequest = {
        request_id:     currentRequestIdRef.current,
        schema_version: '1.0',
        feature:        'teacher_diary',
        locale:         'ko-KR',
        input: {
          text: inputText.trim(),
        },
        context: {
          pool_id:      options.poolId    ?? '',
          class_id:     options.classId   ?? '',
          lesson_date:  options.date      ?? '',
          student_refs: studentsList.map(s => s.ref),
          students:     studentsList,
        },
      };

      // WP1: 사전 검증 — 학생 이름·원문 의미 분석 없음
      const validationError = validateDiaryRequest(currentRequestIdRef.current, inputText, options);
      if (validationError) {
        console.error('[GENERATE-VALIDATE]', validationError);
        machine.setError({
          origin:      'UNKNOWN',
          message:     '요청 정보가 올바르지 않습니다. 화면을 새로 고침 후 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // [LOG] WP1: 개인정보 미포함 구조 확인용 (학생 이름·원문 미출력 — WP3에서 전면 정리)
      console.log('[GENERATE-REQ] endpoint:', endpoint);
      console.log('[GENERATE-REQ] request_id:', requestBody.request_id);
      console.log('[GENERATE-REQ] pool_id:', requestBody.context.pool_id || '(없음 — WP1 경고 확인)');
      console.log('[GENERATE-REQ] class_id:', requestBody.context.class_id);
      console.log('[GENERATE-REQ] lesson_date:', requestBody.context.lesson_date);
      console.log('[GENERATE-REQ] student_count:', studentsList.length);
      console.log('[GENERATE-REQ] text_length:', requestBody.input.text.length);

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
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('PARSE_ERROR');
      }

      // ── Error Contract 처리 ─────────────────────────────────────────────
      const bodyIsErrorContract = typeof body === 'object' && body !== null && 'error' in body;
      if (!response.ok || bodyIsErrorContract) {
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

      // ── WP2: 성공 응답 정규화 (원자적) ──────────────────────────────────
      // generateDiary() 호출 시점의 request_id를 캡처 (ooo 응답 차단용)
      const expectedRequestId = currentRequestIdRef.current;
      const validStudentRefs  = new Set((options.students ?? []).map(s => s.id));

      console.log(`[GENERATE-3] HTTP 200 수신 — request_id=${expectedRequestId} student_refs=${validStudentRefs.size}`);

      const normalized = normalizeDiaryResponse({
        rawResponse:       body,
        expectedRequestId,
        currentRequestId:  currentRequestIdRef.current,
        validStudentRefs,
      });

      if (!normalized.ok) {
        // Contract 오류 — 자동 재시도 없음 (§16)
        console.error(`[GENERATE-CONTRACT-ERR] ${normalized.contractError}`);
        machine.setError({
          origin:      'UNKNOWN',
          message:     'AI 응답 형식이 올바르지 않습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      const norm = normalized.result;

      // [spec] request_id / usage 기록
      lastRequestIdRef.current = norm.requestId ?? expectedRequestId;
      lastUsageRef.current     = norm.usage ?? null;

      console.log(`[GENERATE-4] 정규화 완료 — common_len=${norm.common.length} students=${norm.students.length}`);

      // WP2: StudentDiaryNote 변환 (studentName은 options.students에서 조회)
      const studentLookup = new Map((options.students ?? []).map(s => [s.id, s.name]));
      const mappedStudents: StudentDiaryNote[] = norm.students.map(s => ({
        studentId:   s.studentRef,
        studentName: studentLookup.get(s.studentRef) ?? s.studentRef,
        note:        s.content,
      }));

      // 원자적 반영 — 모든 검증 통과 후 한 번에 State 변경 (§7)
      generatedStudentsRef.current = mappedStudents;
      setResultText(norm.common);

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
