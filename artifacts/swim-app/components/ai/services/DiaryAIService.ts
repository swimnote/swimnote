/**
 * DiaryAIService — SwimNote AI UI Framework V2.0
 * 일지 AI API 호출·검증·정규화 전담 Service
 *
 * ★ 이 파일은 React를 일절 import하지 않습니다.
 *   useState, useEffect, useRef, dispatch 등 React 구조가 없습니다.
 *   UI 상태 변경은 이 파일의 책임이 아닙니다.
 *
 * 담당:
 *   - POST /api/ai/diary/generate  (일지 생성)
 *   - POST /api/ai/whisper/transcribe (STT)
 *   - 요청 사전 검증 (validateDiaryRequest)
 *   - 응답 정규화 (normalizeDiaryResponse)
 *   - 오류 변환 (DiaryServiceError 구조체 반환)
 *
 * 비담당:
 *   - HTTP 전송·URL·헤더·timeout → TeacherDiaryAIClient 담당
 *   - GPT 직접 호출, DB 검색, 프롬프트 생성 → AI Engine 담당
 *   - AbortController 생성·관리 → Hook 담당
 *   - 자동 retry 결정 → Hook 담당
 *   - React 상태 변경 → Modal/Hook 담당
 *
 * 호출 경로:
 *   DiaryAIModalV2 → useDiaryAIV2 → DiaryAIService → TeacherDiaryAIClient → AI Engine
 *
 * 의존: TeacherDiaryAIClient (HTTP 계층만), leaf node for React/Expo
 * 사용: useDiaryAIV2
 */

import {
  sendRequest,
  getAIDiaryMode,
  getDiaryEndpoint,
  type AIDiaryMode,
  type AIClientFailure,
  type AIClientResult,
} from '../clients/TeacherDiaryAIClient';

// ─── Whisper STT API 기반 URL ─────────────────────────────────────────────────
//
// ★ 앱 API Server URL과 AI Engine URL을 혼동하지 마십시오.
//   Whisper STT는 SWIMNOTE API Server(Render.com)의 책임입니다.
//   AI Engine URL(TeacherDiaryAIClient)과 별도로 관리합니다.
//
// EXPO_PUBLIC_AI_ENGINE_URL 설정이 있으면 사용하고, 없으면 Render.com 직접 연결.
const SWIMNOTE_API_SERVER_BASE: string =
  (process.env.EXPO_PUBLIC_AI_ENGINE_URL as string | undefined) ??
  'https://swimnote-api.onrender.com';

// ─── 타임아웃 ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 60_000;

// ─── Legacy 호환 Flag ─────────────────────────────────────────────────────────
// AI Engine이 request_id를 응답에 포함하지 않는 전환 기간용 허용 플래그
// AI Engine 응답에 request_id가 확정되면 false로 변경합니다.
const ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID = true;

// ─── requestId 생성 ───────────────────────────────────────────────────────────

let _diaryReqSeq = 0;

function _fallbackDiaryRequestId(): string {
  _diaryReqSeq += 1;
  const time = Date.now().toString(36);
  const seq  = _diaryReqSeq.toString(36).padStart(4, '0');
  const rand = Math.random().toString(36).slice(2, 12);
  return `diary_${time}_${seq}_${rand}`;
}

export function createDiaryRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof (globalThis.crypto as Crypto).randomUUID === 'function'
  ) {
    return `diary_${(globalThis.crypto as Crypto).randomUUID()}`;
  }
  return _fallbackDiaryRequestId();
}

// ─── 공개 타입 ────────────────────────────────────────────────────────────────

/** V2 모달 상태 — Service의 retryTarget에서도 사용 */
export type DiaryAIStateV2 =
  | 'INPUT'
  | 'RECORDING'
  | 'TRANSCRIBING'
  | 'PERMISSION'
  | 'SEARCHING'
  | 'GENERATING'
  | 'RESULT'
  | 'ERROR';

/** 앱 화면이 AI 모달로 공급하는 학생 컨텍스트 */
export interface StudentContext {
  id:   string;
  name: string;
}

/** 학생별 일지 노트 (삽입 시 전달) */
export interface StudentDiaryNote {
  studentId:   string;
  studentName: string;
  note:        string;
}

/** onInsert 콜백으로 앱 화면에 전달하는 최종 결과 */
export interface DiaryInsertResult {
  commonDiary: string;
  students:    StudentDiaryNote[];
}

/** Service 오류 구조체 — Hook이 상태 전환에 사용 */
export interface DiaryServiceError {
  origin:      'NETWORK' | 'TIMEOUT' | 'PERMISSION' | 'UNKNOWN';
  message:     string;
  /** Hook이 자동 retry를 결정할 때 사용 */
  retryable:   boolean;
  /** 사용자가 "다시 시도" 탭 시 복귀할 상태. null = 모달 닫기 */
  retryTarget: DiaryAIStateV2 | null;
  /** 디버그용 내부 코드 */
  causeCode?:  string;
}

// ─── 생성 API 파라미터 / 결과 ─────────────────────────────────────────────────

export interface DiaryGenerateParams {
  requestId:    string;
  inputText:    string;
  token?:       string;
  poolId:       string;
  classId:      string;
  date:         string;
  students:     StudentContext[];
  signal:       AbortSignal;
  /**
   * 진행 단계 콜백 — 서버가 SSE/진행 이벤트를 전송하면 Hook이 상태 전환에 사용.
   * 현재는 서버가 단일 HTTP 응답만 제공하므로 즉시 호출됩니다.
   * 향후 AI Engine SSE 연결 시 실제 서버 이벤트에 맞춰 호출 시점을 변경하십시오.
   */
  onProgress?:  (phase: 'SEARCHING' | 'GENERATING') => void;
}

export type DiaryGenerateResult =
  | { ok: true;  result: NormalizedDiaryResult }
  | { ok: false; error:  DiaryServiceError };

// ─── STT API 파라미터 / 결과 ──────────────────────────────────────────────────

export interface DiaryVoiceParams {
  uri:    string;
  token?: string;
  signal: AbortSignal;
}

export type DiaryVoiceResult =
  | { ok: true;  transcript: string }
  | { ok: false; error:      DiaryServiceError };

// ─── 내부 타입 ────────────────────────────────────────────────────────────────

export interface NormalizedDiaryResult {
  common:    string;
  students:  NormalizedDiaryStudentResult[];
  requestId?: string;
  usage?: {
    input_tokens:  number;
    output_tokens: number;
    total_tokens:  number;
  };
}

interface NormalizedDiaryStudentResult {
  studentRef: string;
  content:    string;
}

interface TeacherDiaryAIRequest {
  request_id:     string;
  schema_version: '1.0';
  feature:        'teacher_diary';
  locale:         'ko-KR';
  input: { text: string };
  context: {
    pool_id:      string;
    class_id:     string;
    lesson_date:  string;
    student_refs: string[];
    students:     Array<{ ref: string; name: string }>;
  };
}

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
  meta?:  unknown;  // AI Engine grounded pipeline 메타 정보 (향후 활용)
  usage?: {
    input_tokens?:  unknown;
    output_tokens?: unknown;
    total_tokens?:  unknown;
  };
}

interface AIEngineError {
  request_id?: string;
  error: {
    code:      string;
    message:   string;
    retryable: boolean;
  };
}

type NormalizeResult =
  | { ok: true;  result: NormalizedDiaryResult }
  | { ok: false; contractError: string; stale?: true };

// ─── 사전 검증 ────────────────────────────────────────────────────────────────

export function validateDiaryRequest(
  requestId: string,
  text:      string,
  params: {
    classId?:  string;
    date?:     string;
    students?: StudentContext[];
    poolId?:   string;
  },
): string | null {
  if (!requestId)    return '[VALIDATE] request_id가 비어 있습니다.';
  if (!text.trim())  return '[VALIDATE] input.text가 비어 있습니다.';
  if (!params.classId) return '[VALIDATE] class_id가 없습니다.';
  if (!params.date)    return '[VALIDATE] lesson_date가 없습니다.';

  const students = params.students ?? [];
  if (students.length === 0) return '[VALIDATE] students 배열이 비어 있습니다.';

  for (let i = 0; i < students.length; i++) {
    if (!students[i].id)   return `[VALIDATE] students[${i}].id가 없습니다.`;
    if (!students[i].name) return `[VALIDATE] students[${i}].name이 없습니다.`;
  }

  if (!params.poolId) {
    return '[VALIDATE] pool_id(swimming_pool_id)가 없습니다. AI 일지 기능을 사용할 수 없습니다.';
  }

  return null;
}

// ─── 응답 정규화 ──────────────────────────────────────────────────────────────

export function normalizeDiaryResponse(params: {
  rawResponse:       unknown;
  expectedRequestId: string;
  currentRequestId:  string;
  validStudentRefs:  Set<string>;
}): NormalizeResult {
  const { rawResponse, expectedRequestId, currentRequestId, validStudentRefs } = params;

  if (typeof rawResponse !== 'object' || rawResponse === null) {
    return { ok: false, contractError: 'CONTRACT_INVALID_STRUCTURE' };
  }
  const resp = rawResponse as TeacherDiaryAIResponse;

  // request_id 검증
  if (resp.request_id !== undefined) {
    if (typeof resp.request_id !== 'string') {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_TYPE' };
    }
    if (resp.request_id !== expectedRequestId) {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_MISMATCH' };
    }
  } else {
    if (!ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID) {
      return { ok: false, contractError: 'CONTRACT_REQUEST_ID_MISSING' };
    }
    if (expectedRequestId !== currentRequestId) {
      return { ok: false, contractError: 'CONTRACT_STALE_LEGACY_RESPONSE', stale: true };
    }
  }

  if (typeof resp.result !== 'object' || resp.result === null) {
    return { ok: false, contractError: 'CONTRACT_RESULT_MISSING' };
  }

  const rawCommon = resp.result.common;
  if (typeof rawCommon !== 'string') {
    return { ok: false, contractError: `CONTRACT_COMMON_TYPE: type=${typeof rawCommon}` };
  }

  const rawStudents = resp.result.students;
  if (rawStudents !== undefined && !Array.isArray(rawStudents)) {
    return { ok: false, contractError: 'CONTRACT_STUDENTS_NOT_ARRAY' };
  }
  const studentsArray: TeacherDiaryAIStudentResult[] = Array.isArray(rawStudents) ? rawStudents : [];

  const normalizedStudents: NormalizedDiaryStudentResult[] = [];
  const seenRefs = new Set<string>();

  for (let i = 0; i < studentsArray.length; i++) {
    const item = studentsArray[i];
    if (typeof item !== 'object' || item === null) {
      return { ok: false, contractError: `CONTRACT_STUDENT_NOT_OBJECT: students[${i}]` };
    }

    const studentRef =
      typeof item.student_ref === 'string' && item.student_ref
        ? item.student_ref
        : typeof item.student_id === 'string' && item.student_id
          ? item.student_id
          : null;

    if (!studentRef) {
      return { ok: false, contractError: `CONTRACT_STUDENT_REF_MISSING: students[${i}]` };
    }

    const content =
      typeof item.content === 'string'
        ? item.content
        : typeof item.feedback === 'string'
          ? item.feedback
          : null;

    if (content === null) {
      return { ok: false, contractError: `CONTRACT_STUDENT_CONTENT_TYPE: index=${i}` };
    }

    if (!validStudentRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_UNKNOWN_STUDENT_REF: index=${i}` };
    }

    if (seenRefs.has(studentRef)) {
      return { ok: false, contractError: `CONTRACT_DUPLICATE_STUDENT_REF: index=${i}` };
    }
    seenRefs.add(studentRef);

    const trimmedContent = content.trim();
    if (!trimmedContent) continue;
    normalizedStudents.push({ studentRef, content: trimmedContent });
  }

  if (rawCommon === '' && normalizedStudents.length === 0) {
    return { ok: false, contractError: 'CONTRACT_EMPTY_RESULT' };
  }

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
      common:    rawCommon,
      students:  normalizedStudents,
      requestId: typeof resp.request_id === 'string' ? resp.request_id : undefined,
      usage,
    },
  };
}

// ─── translateClientError ─────────────────────────────────────────────────────
//
// AIClientFailure → DiaryGenerateResult 변환
// HTTP 상태 코드 / 실패 이유별로 사용자 메시지와 retryable 여부를 결정합니다.

function translateClientError(
  failure:   AIClientFailure,
  requestId: string,
): DiaryGenerateResult {
  const { reason, httpStatus, body, mode, endpointHost } = failure;

  // ── timeout ─────────────────────────────────────────────────────────────
  if (reason === 'TIMEOUT') {
    return {
      ok:    false,
      error: {
        origin:      'TIMEOUT',
        message:     '일지 작성 시간이 초과되었습니다. 다시 시도해 주세요.',
        retryable:   true,
        retryTarget: 'INPUT',
        causeCode:   'CLIENT_TIMEOUT',
      },
    };
  }

  // ── content-type mismatch (HTML SPA fallback 등) ─────────────────────────
  if (reason === 'CONTENT_TYPE') {
    console.error('[DiaryAIService] content_type_error', {
      request_id:    requestId,
      error_code:    reason,
      http_status:   httpStatus,
      endpoint_host: endpointHost,
      pipeline_mode: mode,
    });
    return {
      ok:    false,
      error: {
        origin:      'NETWORK',
        message:     '응답 형식 오류가 발생했습니다. 다시 시도해주세요.',
        retryable:   true,
        retryTarget: 'INPUT',
        causeCode:   `CONTENT_TYPE_${httpStatus ?? 0}`,
      },
    };
  }

  // ── JSON parse 실패 ─────────────────────────────────────────────────────
  if (reason === 'PARSE_ERROR') {
    console.error('[DiaryAIService] parse_error', {
      request_id:    requestId,
      error_code:    reason,
      http_status:   httpStatus,
      endpoint_host: endpointHost,
      pipeline_mode: mode,
    });
    return {
      ok:    false,
      error: {
        origin:      'UNKNOWN',
        message:     '응답 형식 오류가 발생했습니다. 다시 시도해주세요.',
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   'RESPONSE_PARSE_ERROR',
      },
    };
  }

  // ── HTTP 오류 (4xx / 5xx) ────────────────────────────────────────────────
  if (reason === 'HTTP_ERROR' && httpStatus !== null) {
    const errorBody  = body as Partial<AIEngineError> | null;
    const serverCode = errorBody?.error?.code ?? `HTTP_${httpStatus}`;

    console.error('[DiaryAIService] http_error', {
      request_id:    requestId,
      error_code:    serverCode,
      http_status:   httpStatus,
      endpoint_host: endpointHost,
      pipeline_mode: mode,
    });

    if (httpStatus === 401 || httpStatus === 403) {
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     '인증이 만료되었습니다. 앱을 재시작한 후 다시 로그인해 주세요.',
          retryable:   false,
          retryTarget: null,
          causeCode:   `AUTH_${httpStatus}_${serverCode}`,
        },
      };
    }

    if (httpStatus === 429) {
      return {
        ok:    false,
        error: {
          origin:      'NETWORK',
          message:     '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
          retryable:   true,
          retryTarget: 'INPUT',
          causeCode:   serverCode,
        },
      };
    }

    if (httpStatus === 504) {
      return {
        ok:    false,
        error: {
          origin:      'TIMEOUT',
          message:     '일지 생성이 너무 오래 걸렸습니다. 다시 시도해 주세요.',
          retryable:   true,
          retryTarget: 'INPUT',
          causeCode:   serverCode,
        },
      };
    }

    if (httpStatus >= 500) {
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     `서버 오류가 발생했습니다 (${httpStatus}). 잠시 후 다시 시도해 주세요.`,
          retryable:   errorBody?.error?.retryable ?? true,
          retryTarget: 'INPUT',
          causeCode:   serverCode,
        },
      };
    }

    return {
      ok:    false,
      error: {
        origin:      'NETWORK',
        message:     `요청 처리 실패 (${httpStatus}). 다시 시도해주세요.`,
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   serverCode,
      },
    };
  }

  // ── 네트워크 오류 (fetch throw) ─────────────────────────────────────────
  console.error('[DiaryAIService] network_error', {
    request_id:    requestId,
    error_code:    failure.errorDetail,
    endpoint_host: endpointHost,
    pipeline_mode: mode,
  });
  return {
    ok:    false,
    error: {
      origin:      'NETWORK',
      message:     '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.',
      retryable:   true,
      retryTarget: 'INPUT',
      causeCode:   failure.errorDetail ?? 'NETWORK_ERROR',
    },
  };
}

// ─── generateDiary ────────────────────────────────────────────────────────────

export async function generateDiary(p: DiaryGenerateParams): Promise<DiaryGenerateResult> {
  const {
    requestId, inputText, token, poolId, classId, date,
    students, signal, onProgress,
  } = p;

  // ── 1. 앱 파라미터 검증 ──────────────────────────────────────────────────
  const validationError = validateDiaryRequest(requestId, inputText, {
    classId, date, students, poolId,
  });
  if (validationError) {
    if (__DEV__) console.error('[DiaryAIService] validate_error', { requestId, error_code: validationError });
    return {
      ok:    false,
      error: {
        origin:      'UNKNOWN',
        message:     '요청 정보가 올바르지 않습니다. 화면을 새로 고침 후 다시 시도해주세요.',
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   validationError,
      },
    };
  }

  // ── 2. Request body 조립 ─────────────────────────────────────────────────
  const validStudentRefs = new Set(students.map(s => s.id));
  const studentsList     = students.map(s => ({ ref: s.id, name: s.name }));

  const requestBody: TeacherDiaryAIRequest = {
    request_id:     requestId,
    schema_version: '1.0',
    feature:        'teacher_diary',
    locale:         'ko-KR',
    input:   { text: inputText.trim() },
    context: {
      pool_id:      poolId,
      class_id:     classId,
      lesson_date:  date,
      student_refs: studentsList.map(s => s.ref),
      students:     studentsList,
    },
  };

  // ── 3. Feature flag 결정 ─────────────────────────────────────────────────
  const mode: AIDiaryMode = getAIDiaryMode();

  // ── 4. 엔드포인트 host (로깅용) ──────────────────────────────────────────
  let endpointHost = '(unknown)';
  try {
    endpointHost = getDiaryEndpoint(mode).host;
  } catch { /* grounded + URL 미설정 — sendRequest에서 처리 */ }

  // ── 5. 요청 시작 로그 (PII 미포함) ──────────────────────────────────────
  // 금지: 학생 이름, 교사 입력 원문, JWT, 전체 payload
  // 허용: request_id, endpoint_host, status, student_count, text_length, pipeline_mode
  console.log('[DiaryAIService] generate_request', {
    request_id:    requestId,
    endpoint_host: endpointHost,
    student_count: students.length,
    text_length:   inputText.trim().length,
    pipeline_mode: mode,
  });

  // ── 6. 진행 상태 알림 ────────────────────────────────────────────────────
  // 현재 서버는 단일 HTTP 응답만 제공 (SSE 미지원).
  // AI Engine SSE 연결 시 실제 이벤트에 맞춰 onProgress 호출 시점을 변경하십시오.
  onProgress?.('SEARCHING');

  // ── 7. HTTP 전송 (TeacherDiaryAIClient 위임) ─────────────────────────────
  let clientResult: AIClientResult;
  try {
    clientResult = await sendRequest({
      body:      requestBody,
      token,
      signal,
      timeoutMs: TIMEOUT_MS,
      mode,
    });
  } catch (e) {
    // AbortError (unmount / new-request) — Hook으로 re-throw
    throw e;
  }

  // ── 8. 응답 수신 로그 (PII 미포함) ──────────────────────────────────────
  console.log('[DiaryAIService] generate_response', {
    request_id:    requestId,
    endpoint_host: clientResult.endpointHost,
    ok:            clientResult.ok,
    http_status:   clientResult.ok ? clientResult.httpStatus : (clientResult.httpStatus ?? 'N/A'),
    pipeline_mode: mode,
    ...(clientResult.ok ? {} : { error_code: clientResult.reason }),
  });

  // ── 9. Client 오류 변환 ──────────────────────────────────────────────────
  if (!clientResult.ok) {
    return translateClientError(clientResult, requestId);
  }

  // ── 10. 응답 Contract 검증 ───────────────────────────────────────────────
  const normalized = normalizeDiaryResponse({
    rawResponse:       clientResult.body,
    expectedRequestId: requestId,
    currentRequestId:  requestId,
    validStudentRefs,
  });

  if (!normalized.ok) {
    if (normalized.stale) {
      if (__DEV__) console.log('[DiaryAIService] stale_response', { request_id: requestId });
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     '이전 요청의 응답입니다. 다시 시도해주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   'STALE_RESPONSE',
        },
      };
    }
    console.error('[DiaryAIService] contract_error', {
      request_id:    requestId,
      error_code:    normalized.contractError,
      pipeline_mode: mode,
    });
    return {
      ok:    false,
      error: {
        origin:      'UNKNOWN',
        message:     '결과 생성에 실패했습니다. 다시 시도해주세요.',
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   normalized.contractError,
      },
    };
  }

  if (__DEV__) console.log('[DiaryAIService] generate_succeeded', {
    request_id:    requestId,
    has_common:    normalized.result.common.length > 0,
    student_count: normalized.result.students.length,
    pipeline_mode: mode,
  });

  return { ok: true, result: normalized.result };
}

// ─── processVoice (Whisper STT) ───────────────────────────────────────────────
//
// ★ Whisper STT는 SWIMNOTE API Server(Render.com)의 책임입니다.
//   AI Engine URL(TeacherDiaryAIClient)과 별도로 SWIMNOTE_API_SERVER_BASE를 사용합니다.

export async function processVoice(p: DiaryVoiceParams): Promise<DiaryVoiceResult> {
  const { uri, token, signal } = p;

  if (!uri) {
    return {
      ok:    false,
      error: {
        origin:      'UNKNOWN',
        message:     '녹음 파일을 찾을 수 없습니다. 다시 시도해주세요.',
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   'NO_URI',
      },
    };
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutController = new AbortController();
  timeoutId = setTimeout(() => timeoutController.abort('timeout'), TIMEOUT_MS);

  const onAbort = () => timeoutController.abort(signal.reason ?? 'external');
  signal.addEventListener('abort', onAbort, { once: true });

  if (__DEV__) console.log('[DiaryAIService] stt_started');

  try {
    const formData = new FormData();
    formData.append('audio', { uri, name: 'recording.m4a', type: 'audio/m4a' } as any);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${SWIMNOTE_API_SERVER_BASE}/api/ai/whisper/transcribe`, {
      method:  'POST',
      body:    formData,
      headers,
      signal:  timeoutController.signal,
    });

    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);

    interface WhisperResponse { request_id: string; transcript: string; }
    const body = await response.json() as WhisperResponse | AIEngineError;

    if (!response.ok || 'error' in body) {
      const err   = (body as AIEngineError).error;
      const reqId = (body as AIEngineError).request_id ?? '?';
      if (__DEV__) console.error('[DiaryAIService] stt_failed', { request_id: reqId, error_code: err?.code });
      return {
        ok:    false,
        error: {
          origin:      'NETWORK',
          message:     '음성 인식에 실패했습니다. 다시 시도해 주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   err?.code,
        },
      };
    }

    const { transcript } = body as WhisperResponse;
    if (__DEV__) console.log('[DiaryAIService] stt_completed', { transcript_length: transcript?.length ?? 0 });

    if (!transcript?.trim()) {
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     '음성이 인식되지 않았습니다. 조금 더 크게 다시 말씀해 주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   'EMPTY_TRANSCRIPT',
        },
      };
    }

    return { ok: true, transcript: transcript.trim() };

  } catch (e: any) {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);

    const reason = (timeoutController.signal as any).reason ?? signal.reason;

    if (e?.name === 'AbortError' && (reason === 'unmount' || reason === 'new-request')) {
      throw e;
    }
    if (e?.name === 'AbortError' && reason === 'timeout') {
      return {
        ok:    false,
        error: {
          origin:      'TIMEOUT',
          message:     '음성 변환 시간이 초과되었습니다. 다시 시도해 주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   'TIMEOUT',
        },
      };
    }

    if (__DEV__) console.error('[DiaryAIService] stt_error', { error_code: e?.message });
    return {
      ok:    false,
      error: {
        origin:      'NETWORK',
        message:     '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.',
        retryable:   false,
        retryTarget: 'INPUT',
        causeCode:   e?.message ?? 'NETWORK_ERROR',
      },
    };
  }
}
