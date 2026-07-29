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

/** AI Engine Production Base URL — swimnote.kr (Render.com API 서버) */
const AI_ENGINE_BASE = process.env.EXPO_PUBLIC_AI_ENGINE_URL ?? 'https://swimnote.kr';

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

  for (let i = 0; i < students.length; i++) {
    if (!students[i].id)   return `[VALIDATE] students[${i}].ref가 없습니다.`;
    if (!students[i].name) return `[VALIDATE] students[${i}].name이 없습니다.`;
  }

  // pool_id — AI Engine 필수 필드. 없으면 요청 차단.
  if (!opts.poolId) {
    return '[VALIDATE] pool_id(swimming_pool_id)가 없습니다. AI 일지 기능을 사용할 수 없습니다.';
  }

  return null;
}

// ─── WP2: Response 정규화 함수 ────────────────────────────────────────────────

type NormalizeResult =
  | { ok: true;  result: NormalizedDiaryResult }
  | { ok: false; contractError: string; stale?: true };

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
      // stale 판정은 normalizeDiaryResponse 호출 전 외부에서 이미 완료됩니다.
      // 여기서는 현재 활성 요청의 응답인데 서버 ID가 다른 경우 → 순수 Contract 오류.
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_MISMATCH' };
    }
  } else {
    // request_id 없음
    if (!ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID) {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_MISSING' };
    }
    // Legacy 허용 — expectedRequestId가 여전히 현재 활성 ID인지 확인
    if (expectedRequestId !== currentRequestId) {
      return { ok: false, contractError: 'CONTRACT_STALE_LEGACY_RESPONSE', stale: true };
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

  // 6. 각 학생 필드 정상화 + ref/중복 검증
  // 빈 content 학생은 필터 후 제거하므로 CONTRACT_EMPTY_RESULT 검사는 루프 이후에 수행합니다.
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
      return { ok: false, contractError: `CONTRACT_STUDENT_CONTENT_TYPE: index=${i}` };
    }

    // 알 수 없는 student_ref → 전체 오류 (§9)
    if (!validStudentRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_UNKNOWN_STUDENT_REF: index=${i}` };
    }

    // 중복 student_ref → 전체 오류 (§10)
    if (seenRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_DUPLICATE_STUDENT_REF: index=${i}` };
    }
    seenRefs.add(studentRef);

    const trimmedContent = content.trim();
    if (!trimmedContent) continue;   // 빈 content → 이중 방어, 이 학생 결과 skip
    normalizedStudents.push({ studentRef, content: trimmedContent });
  }

  // 6-b. 빈 결과 검증 — 빈 content 필터 후 common='' + students=[] 동시 → 오류
  if (common === '' && normalizedStudents.length === 0) {
    return { ok: false, contractError: 'CONTRACT_EMPTY_RESULT: common과 students 모두 비어 있습니다.' };
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
  /** [WP갭1] 학생별 Draft 표시용 state — DiaryAIContent에서 교사 수정 가능 */
  const [generatedStudents, setGeneratedStudents] = useState<StudentDiaryNote[]>([]);

  /** "삽입 완료" 버튼 피드백 (Stage A 임시) */
  const [insertDone, setInsertDone] = useState(false);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** [WP11] Insert 중복 실행 방지 */
  const isInsertingRef = useRef(false);

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
    if (__DEV__) console.log('[DIARY-AI] voice_tap', { state: machine.state, isRecording: recorder.isRecording });

    if (machine.is('RECORDING')) {
      machine.stopRecording();
      const uri = await recorder.stopRecording();
      await processVoice(uri);
    } else {
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
   *
   * [WP3] 상태 전환:
   *   INPUT → UPLOADING (fetch 전) — 로딩 UI 표시 + Submit 버튼 차단
   *   UPLOADING → INPUT  (성공)   — machine.retry('INPUT') 후 transcript 반영
   *   UPLOADING → ERROR  (실패)   — machine.setError() (UPLOADING → ERROR 유효)
   *
   * [P8] 60초 timeout, 언마운트 취소
   * [WP3] new-request abort → 새 processVoice가 machine state를 관리, 조용히 return
   */
  const processVoice = async (uri: string | null) => {
    if (!uri) {
      if (__DEV__) console.warn('[DIARY-AI] stt_skipped: no_uri');
      return;
    }

    // 이전 voice 요청 취소 (new-request)
    voiceAbortRef.current?.abort('new-request');
    const controller = new AbortController();
    voiceAbortRef.current = controller;

    // [WP3] INPUT → UPLOADING: 로딩 shimmer 표시, Submit 버튼 차단
    // RECORDING 상태가 아직 INPUT으로 전환 전이면 no-op (전환 후 재시도 필요 없음 — 이후 경로에서 처리)
    machine.startUpload();

    const timeoutId = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);

    if (__DEV__) console.log('[DIARY-AI] stt_started');

    try {
      const endpoint = `${AI_ENGINE_BASE}/api/ai/whisper/transcribe`;
      const formData = new FormData();
      formData.append('audio', { uri, name: 'recording.m4a', type: 'audio/m4a' } as any);

      // Content-Type 수동 지정 금지 — React Native가 FormData boundary를 자동 생성
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

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
        if (__DEV__) console.error('[DIARY-AI] stt_failed', { request_id: reqId, code: err?.code, retryable: err?.retryable });
        if (!isMountedRef.current) return;
        // UPLOADING → ERROR (UPLOADING: ['PROCESSING','INPUT','ERROR'] 유효)
        machine.setError({
          origin:      'NETWORK',
          message:     '음성 인식에 실패했습니다. 다시 시도해 주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      const { request_id, transcript } = body as WhisperTranscribeResponse;
      if (__DEV__) console.log('[DIARY-AI] stt_completed', { request_id, transcript_length: transcript?.length ?? 0 });

      if (transcript?.trim()) {
        // [WP3] 성공: UPLOADING → INPUT 복귀 후 transcript 반영
        machine.retry('INPUT');
        setInputText(transcript.trim());
      } else {
        // [WP3] 빈 transcript — 사용자 피드백 표시 (기존: console.warn만 → 피드백 없음)
        if (__DEV__) console.warn('[DIARY-AI] stt_empty_transcript');
        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'UNKNOWN',
          message:     '음성이 인식되지 않았습니다. 조금 더 크게 다시 말씀해 주세요.',
          retryTarget: 'INPUT',
        });
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const reason = (controller.signal as any).reason;

      if (e?.name === 'AbortError' && reason === 'unmount') {
        if (__DEV__) console.log('[DIARY-AI] stt_aborted', { reason: 'unmount' });
        return;
      }
      // [WP3] new-request abort — 조용히 return. 새 processVoice가 machine state를 관리.
      // setError 금지: 새 요청의 UPLOADING 상태를 덮어쓰면 안 됨.
      if (e?.name === 'AbortError' && reason === 'new-request') {
        if (__DEV__) console.log('[DIARY-AI] stt_aborted', { reason: 'new-request' });
        return;
      }
      if (e?.name === 'AbortError' && reason === 'timeout') {
        if (__DEV__) console.error('[DIARY-AI] stt_timeout');
        machine.setError({
          origin:      'TIMEOUT',
          message:     '음성 변환 시간이 초과되었습니다. 다시 시도해 주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      if (__DEV__) console.error('[DIARY-AI] stt_error', { error: e?.message });
      machine.setError({
        origin:      'NETWORK',
        message:     '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.',
        retryTarget: 'INPUT',
      });
    } finally {
      await recorder.deleteRecording(uri);
      if (__DEV__) console.log('[DIARY-AI] stt_recording_deleted');
    }
  };

  // ─── 텍스트 제출 / 다시 작성 ────────────────────────────────────────────

  const handleSubmit = async () => {
    // [P8] 중복 호출 방지
    if (isInFlightRef.current) {
      if (__DEV__) console.log('[DIARY-AI] submit_skipped: already_in_flight');
      return;
    }

    // WP1: 사용자 액션마다 새 request_id 생성 (자동 retry는 생성하지 않음)
    currentRequestIdRef.current = createDiaryRequestId();
    if (__DEV__) console.log('[DIARY-AI] submit_started', { request_id: currentRequestIdRef.current, state: machine.state });

    if (machine.state === 'RESULT' || machine.state === 'EDITING') {
      rewriteCountRef.current  += 1;
      autoRetryCountRef.current = 0; // 새 사용자 요청 → 자동 retry 카운터 초기화
      machine.retry('INPUT');
    } else if (!inputText.trim()) {
      if (__DEV__) console.log('[DIARY-AI] submit_skipped: empty_input');
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

    if (__DEV__) {
      if (__DEV__) console.log('[DIARY-AI] request_started', {
        request_id:    currentRequestIdRef.current,
        retry_count:   rewriteCountRef.current,
        student_count: options.students?.length ?? 0,
        input_length:  inputText.trim().length,
      });
    }

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
        if (__DEV__) console.error('[DIARY-AI] validate_error', { request_id: currentRequestIdRef.current, code: validationError });
        machine.setError({
          origin:      'UNKNOWN',
          message:     '요청 정보가 올바르지 않습니다. 화면을 새로 고침 후 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      if (__DEV__) {
        if (__DEV__) console.log('[DIARY-AI] request_sending', {
          request_id:        requestBody.request_id,
          pool_id_present:   Boolean(requestBody.context.pool_id),
          class_id_present:  Boolean(requestBody.context.class_id),
          student_count:     studentsList.length,
          input_length:      requestBody.input.text.length,
        });
      }

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

      // ── WP3: 응답 텍스트 읽기 (스트림 오류 → 네트워크 retry 대상) ─────
      let responseText: string;
      try {
        responseText = await response.text();
      } catch {
        throw new Error('NETWORK_STREAM_ERROR');
      }

      // ── HTTP 에러 처리 ───────────────────────────────────────────────────
      if (!response.ok) {
        let errorBody: unknown;
        try { errorBody = JSON.parse(responseText); } catch { /* non-JSON error page */ }

        const bodyIsErrorContract =
          typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody;

        if (bodyIsErrorContract) {
          const err   = (errorBody as AIEngineError).error;
          const reqId = (errorBody as AIEngineError).request_id ?? '?';
          if (__DEV__) console.error('[DIARY-AI] request_failed', { request_id: reqId, code: err?.code, status: response.status });

          if (response.status === 401 || response.status === 403) {
            machine.setError({
              origin:      'UNKNOWN',
              message:     '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.',
              retryTarget: null,
            });
            return;
          }

          if (response.status === 429) {
            machine.setError({
              origin:      'NETWORK',
              message:     '요청이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
              retryTarget: 'INPUT',
            });
            return;
          }

          if (err?.retryable && autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
            autoRetryCountRef.current += 1;
            if (__DEV__) console.log('[DIARY-AI] request_retry', { request_id: currentRequestIdRef.current, retry_count: autoRetryCountRef.current, reason: 'retryable' });
            await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
            if (!isMountedRef.current) return;
            await generateDiary();
            return;
          }

          if (!isMountedRef.current) return;
          machine.setError({
            origin:      'NETWORK',
            message:     '네트워크 연결을 확인한 후 다시 시도해주세요.',
            retryTarget: 'INPUT',
          });
          return;
        }

        // non-JSON 오류 응답 (502 HTML 등) — 네트워크 재시도 대상
        if (__DEV__) console.error('[DIARY-AI] request_failed', { status: response.status, code: 'HTTP_ERROR_NON_JSON' });
        if (autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
          autoRetryCountRef.current += 1;
          if (__DEV__) console.log('[DIARY-AI] request_retry', { request_id: currentRequestIdRef.current, retry_count: autoRetryCountRef.current, reason: 'http_error' });
          await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
          if (!isMountedRef.current) return;
          await generateDiary();
          return;
        }
        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'NETWORK',
          message:     '네트워크 연결을 확인한 후 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // ── WP3: 성공 응답 JSON 파싱 (실패 → Contract 오류, 자동 재시도 없음) ─
      // 요청 전송 시 사용한 request_id를 기준으로 stale 판정합니다.
      // currentRequestIdRef.current는 응답을 받는 사이에 변경될 수 있습니다.
      const expectedRequestId = requestBody.request_id;
      const validStudentRefs  = new Set((options.students ?? []).map(s => s.id));
      let body: unknown;
      try {
        body = JSON.parse(responseText);
      } catch {
        // HTTP 200이지만 JSON 파싱 불가 → Contract 오류
        if (__DEV__) console.error('[DIARY-AI] contract_error', { request_id: expectedRequestId, code: 'CONTRACT_RESPONSE_PARSE_ERROR', status: response.status });
        machine.setError({
          origin:      'UNKNOWN',
          message:     'AI 일지 결과를 불러오지 못했습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // ── §5-A: stale 판정 — 요청 전송 시 ID와 현재 활성 ID 비교 ──────────
      // 응답을 받는 사이 새 Submit이 발생했으면 현재 요청은 old request → 조용히 폐기.
      // (resp.request_id 기준이 아닌 expectedRequestId 기준으로 판단합니다.)
      if (expectedRequestId !== currentRequestIdRef.current) {
        if (__DEV__) console.log('[DIARY-AI] stale_response_ignored', { request_id: expectedRequestId, current_id: currentRequestIdRef.current });
        return;
      }

      // ── WP2: 성공 응답 정규화 (원자적) ──────────────────────────────────
      if (__DEV__) console.log('[DIARY-AI] response_received', { request_id: expectedRequestId, status: response.status, student_refs: validStudentRefs.size });

      const normalized = normalizeDiaryResponse({
        rawResponse:       body,
        expectedRequestId,
        currentRequestId:  currentRequestIdRef.current,
        validStudentRefs,
      });

      if (!normalized.ok) {
        if (normalized.stale) {
          // 오래된 응답 — 조용히 폐기, 현재 State 변경 없음 (§15)
          if (__DEV__) console.log('[DIARY-AI] stale_response_ignored', { request_id: expectedRequestId, current_id: currentRequestIdRef.current });
          return;
        }
        // Contract 오류 — 자동 재시도 없음 (§16)
        if (__DEV__) console.error('[DIARY-AI] contract_error', { request_id: expectedRequestId, code: normalized.contractError });
        machine.setError({
          origin:      'UNKNOWN',
          message:     'AI 일지 결과를 불러오지 못했습니다. 다시 시도해주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      const norm = normalized.result;

      // [spec] request_id / usage 기록
      lastRequestIdRef.current = norm.requestId ?? expectedRequestId;
      lastUsageRef.current     = norm.usage ?? null;

      if (__DEV__) {
        if (__DEV__) console.log('[DIARY-AI] request_succeeded', {
          request_id:    lastRequestIdRef.current,
          has_common:    norm.common.length > 0,
          student_count: norm.students.length,
        });
      }

      // WP2: StudentDiaryNote 변환 (studentName은 options.students에서 조회)
      const studentLookup = new Map((options.students ?? []).map(s => [s.id, s.name]));
      const mappedStudents: StudentDiaryNote[] = norm.students.map(s => ({
        studentId:   s.studentRef,
        studentName: studentLookup.get(s.studentRef) ?? s.studentRef,
        note:        s.content,
      }));

      // 원자적 반영 — 모든 검증 통과 후 한 번에 State 변경 (§7)
      generatedStudentsRef.current = mappedStudents;
      if (isMountedRef.current) setGeneratedStudents(mappedStudents);
      setResultText(norm.common);
      machine.receiveResult(); // PROCESSING → RESULT

    } catch (e: any) {
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;

      const reason = (controller.signal as any).reason;

      // 새 요청으로 인한 취소 — 조용히 종료, 현재 State 변경 없음
      if (e?.name === 'AbortError' && reason === 'new-request') {
        if (__DEV__) console.log('[DIARY-AI] request_aborted', { reason: 'new-request' });
        return;
      }

      // 언마운트에 의한 취소 — State 변경 없음
      if (e?.name === 'AbortError' && reason === 'unmount') {
        if (__DEV__) console.log('[DIARY-AI] request_aborted', { reason: 'unmount' });
        return;
      }

      // 60초 Timeout — 자동 retry 1회
      if (e?.name === 'AbortError' && reason === 'timeout') {
        if (autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
          autoRetryCountRef.current += 1;
          if (__DEV__) console.log('[DIARY-AI] request_retry', { request_id: currentRequestIdRef.current, retry_count: autoRetryCountRef.current, reason: 'timeout' });
          await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
          if (!isMountedRef.current) return;
          await generateDiary();
          return;
        }
        if (!isMountedRef.current) return;
        machine.setError({
          origin:      'TIMEOUT',
          message:     '일지 작성 시간이 초과되었습니다. 다시 시도해 주세요.',
          retryTarget: 'INPUT',
        });
        return;
      }

      // 네트워크 오류 (fetch 실패, DNS 실패, NETWORK_STREAM_ERROR 등) — 자동 retry 1회
      if (autoRetryCountRef.current < MAX_AUTO_RETRY && isMountedRef.current) {
        autoRetryCountRef.current += 1;
        if (__DEV__) console.log('[DIARY-AI] request_retry', { request_id: currentRequestIdRef.current, retry_count: autoRetryCountRef.current, reason: 'network', error: e?.message });
        await new Promise<void>(r => setTimeout(r, AUTO_RETRY_DELAY_MS));
        if (!isMountedRef.current) return;
        await generateDiary();
        return;
      }

      if (__DEV__) console.error('[DIARY-AI] request_failed', { request_id: currentRequestIdRef.current, code: 'NETWORK_ERROR', error: e?.message });
      machine.setError({
        origin:      'NETWORK',
        message:     '네트워크 연결을 확인한 후 다시 시도해주세요.',
        retryTarget: 'INPUT',
      });
    }
  };

  // ─── [원칙 6] 최종 삽입 ────────────────────────────────────────────────

  const handleInsert = () => {
    // [WP11] 중복 Insert 방지
    if (isInsertingRef.current) {
      if (__DEV__) console.log('[DIARY-AI] insert_skipped: duplicate');
      return;
    }

    if (__DEV__) {
      if (__DEV__) console.log('[DIARY-AI] insert_started', {
        request_id:     lastRequestIdRef.current,
        common_length:  resultText.length,
        student_count:  generatedStudentsRef.current.length,
        total_tokens:   lastUsageRef.current?.total_tokens ?? 0,
      });
    }

    // [WP6] Common이 비어도 Student Draft가 있으면 Insert 허용
    // WP5에서 TextInput 편집이 가능해져 교사가 Common을 지운 경우에도 Student 노트를 삽입할 수 있어야 함
    const hasContent = Boolean(resultText) || generatedStudents.length > 0;

    if (options.onInsert && hasContent) {
      isInsertingRef.current = true;
      const result: DiaryInsertResult = {
        commonDiary: resultText,
        students:    generatedStudents, // state 사용 — 교사가 수정한 값 반영
      };

      options.onInsert(result);
      if (__DEV__) console.log('[DIARY-AI] insert_completed', { student_count: result.students.length });
      machine.complete(); // RESULT/EDITING → COMPLETE (State Machine 흐름 완성)
      options.onClose?.();
    } else {
      if (__DEV__) console.log('[DIARY-AI] insert_skipped', { has_onInsert: Boolean(options.onInsert), has_content: hasContent });
    }
  };

  return {
    inputText,
    setInputText,
    resultText,
    setResultText,
    /** [WP갭1] 학생별 Draft state — DiaryAIContent 표시 및 교사 수정용 */
    generatedStudents,
    setGeneratedStudents,
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
