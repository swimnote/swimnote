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
 *   - GPT 직접 호출, DB 직접 검색, 프롬프트 생성
 *     → SWIMNOTE AI Engine이 담당
 *   - AbortController 생성·관리 → Hook이 담당
 *   - 자동 retry 결정 → Hook이 담당
 *   - React 상태 변경 → Modal/Hook이 담당
 *
 * 의존: 없음 (leaf node — React, Expo 미사용)
 * 사용: useDiaryAIV2
 */

// ─── AI 엔진 기본 URL ─────────────────────────────────────────────────────────

const AI_ENGINE_BASE: string =
  (process.env.EXPO_PUBLIC_AI_ENGINE_URL as string | undefined) ??
  ((process.env.EXPO_PUBLIC_API_URL as string | undefined)?.replace(/\/api\/?$/, '') ?? 'https://swimnote-api.onrender.com');

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
   * 진행 단계 콜백 — 서버가 진행 이벤트를 전송하면 Hook이 상태 전환에 사용.
   * 현재는 서버가 이벤트를 전송하지 않으므로 Hook 측 타이머로 대체.
   * 향후 SSE/WebSocket 연결 시 이 콜백을 통해 SEARCHING→GENERATING 전환 가능.
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

// ─── generateDiary ────────────────────────────────────────────────────────────

export async function generateDiary(p: DiaryGenerateParams): Promise<DiaryGenerateResult> {
  const {
    requestId, inputText, token, poolId, classId, date,
    students, signal, onProgress,
  } = p;

  // 사전 검증
  const validationError = validateDiaryRequest(requestId, inputText, {
    classId, date, students, poolId,
  });
  if (validationError) {
    if (__DEV__) console.error('[DiaryAIService] validate_error', { requestId, code: validationError });
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

  // 타임아웃 — signal과 결합
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutController = new AbortController();
  timeoutId = setTimeout(() => timeoutController.abort('timeout'), TIMEOUT_MS);

  // signal을 직접 넘길 수 없는 경우 abort 이벤트로 연결
  const onAbort = () => timeoutController.abort(signal.reason ?? 'external');
  signal.addEventListener('abort', onAbort, { once: true });

  // onProgress 호출 — 현재는 진입 즉시 SEARCHING 알림 (서버 이벤트 대기 없음)
  onProgress?.('SEARCHING');

  if (__DEV__) console.log('[DiaryAIService] generate_started', { requestId, student_count: students.length });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${AI_ENGINE_BASE}/api/ai/diary/generate`, {
      method:  'POST',
      headers,
      body:    JSON.stringify(requestBody),
      signal:  timeoutController.signal,
    });

    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);

    // 응답 텍스트 읽기
    let responseText: string;
    try {
      responseText = await response.text();
    } catch {
      throw new Error('NETWORK_STREAM_ERROR');
    }

    if (!response.ok) {
      let errorBody: unknown;
      try { errorBody = JSON.parse(responseText); } catch { /* non-JSON */ }

      const isErrorContract =
        typeof errorBody === 'object' && errorBody !== null && 'error' in errorBody;

      if (isErrorContract) {
        const err   = (errorBody as AIEngineError).error;
        const reqId = (errorBody as AIEngineError).request_id ?? '?';
        if (__DEV__) console.error('[DiaryAIService] generate_failed', { request_id: reqId, code: err?.code, status: response.status });

        if (response.status === 401 || response.status === 403) {
          return {
            ok:    false,
            error: {
              origin:      'UNKNOWN',
              message:     '로그인 정보가 만료되었습니다. 다시 로그인해 주세요.',
              retryable:   false,
              retryTarget: null,
              causeCode:   err?.code,
            },
          };
        }

        if (response.status === 429) {
          return {
            ok:    false,
            error: {
              origin:      'NETWORK',
              message:     '요청이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
              retryable:   false,
              retryTarget: 'INPUT',
              causeCode:   err?.code,
            },
          };
        }

        return {
          ok:    false,
          error: {
            origin:      'NETWORK',
            message:     '네트워크 연결을 확인한 후 다시 시도해주세요.',
            retryable:   err?.retryable ?? false,
            retryTarget: 'INPUT',
            causeCode:   err?.code,
          },
        };
      }

      // non-JSON 오류 응답 (502 HTML 등)
      if (__DEV__) console.error('[DiaryAIService] generate_failed', { status: response.status, code: 'HTTP_ERROR_NON_JSON' });
      return {
        ok:    false,
        error: {
          origin:      'NETWORK',
          message:     '네트워크 연결을 확인한 후 다시 시도해주세요.',
          retryable:   true,
          retryTarget: 'INPUT',
          causeCode:   `HTTP_${response.status}`,
        },
      };
    }

    // 성공 응답 파싱
    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch {
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     'AI 일지 결과를 불러오지 못했습니다. 다시 시도해주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   'CONTRACT_RESPONSE_PARSE_ERROR',
        },
      };
    }

    const normalized = normalizeDiaryResponse({
      rawResponse:       body,
      expectedRequestId: requestId,
      currentRequestId:  requestId, // Hook이 stale 판정도 하지만 Service도 1차 방어
      validStudentRefs,
    });

    if (!normalized.ok) {
      if (normalized.stale) {
        if (__DEV__) console.log('[DiaryAIService] stale_response', { requestId });
        // stale은 Hook이 처리하도록 특별 오류 코드로 반환
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
      if (__DEV__) console.error('[DiaryAIService] contract_error', { requestId, code: normalized.contractError });
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     'AI 일지 결과를 불러오지 못했습니다. 다시 시도해주세요.',
          retryable:   false,
          retryTarget: 'INPUT',
          causeCode:   normalized.contractError,
        },
      };
    }

    if (__DEV__) console.log('[DiaryAIService] generate_succeeded', {
      requestId,
      has_common:    normalized.result.common.length > 0,
      student_count: normalized.result.students.length,
    });

    return { ok: true, result: normalized.result };

  } catch (e: any) {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onAbort);

    const reason = (timeoutController.signal as any).reason ?? signal.reason;

    if (e?.name === 'AbortError' && reason === 'unmount') {
      if (__DEV__) console.log('[DiaryAIService] generate_aborted', { reason: 'unmount' });
      // AbortError를 그대로 throw해서 Hook의 catch로 전달
      throw e;
    }
    if (e?.name === 'AbortError' && reason === 'new-request') {
      if (__DEV__) console.log('[DiaryAIService] generate_aborted', { reason: 'new-request' });
      throw e;
    }
    if (e?.name === 'AbortError' && reason === 'timeout') {
      if (__DEV__) console.error('[DiaryAIService] generate_timeout', { requestId });
      return {
        ok:    false,
        error: {
          origin:      'TIMEOUT',
          message:     '일지 작성 시간이 초과되었습니다. 다시 시도해 주세요.',
          retryable:   true,
          retryTarget: 'INPUT',
          causeCode:   'TIMEOUT',
        },
      };
    }

    if (__DEV__) console.error('[DiaryAIService] generate_error', { requestId, error: e?.message });
    return {
      ok:    false,
      error: {
        origin:      'NETWORK',
        message:     '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.',
        retryable:   true,
        retryTarget: 'INPUT',
        causeCode:   e?.message ?? 'NETWORK_ERROR',
      },
    };
  }
}

// ─── processVoice (Whisper STT) ───────────────────────────────────────────────

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

    const response = await fetch(`${AI_ENGINE_BASE}/api/ai/whisper/transcribe`, {
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
      if (__DEV__) console.error('[DiaryAIService] stt_failed', { request_id: reqId, code: err?.code });
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

    if (__DEV__) console.error('[DiaryAIService] stt_error', { error: e?.message });
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
