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
// AI Engine V1 Contract 확정: 응답에 request_id 에코가 보장됩니다.
// ★ false로 고정 — request_id 없는 응답은 즉시 CONTRACT_REQUEST_ID_MISSING 반환
const ALLOW_LEGACY_RESPONSE_WITHOUT_REQUEST_ID = false;

// ─── Contract 버전 관리 ───────────────────────────────────────────────────────
//
// 앱이 전송하는 contract_version — Request에 포함됩니다.
//
// WP6: '1.0' → '1.3' 업그레이드
//   contract 1.3이어야 서버에서 Phase 0(resolvePoolMode)가 실행되고
//   X pool에서 x_global template search / curriculum candidate search가 활성화됩니다.
//   contract 1.0은 poolMode 조회를 건너뛰므로 X mode가 미활성화됩니다.
export const APP_CONTRACT_VERSION = '1.3' as const;

/**
 * 앱이 수락하는 버전 집합.
 *
 * AI Engine이 발전해 새 버전을 추가할 경우 이 집합에 등록하십시오.
 * 집합에 없는 버전은 즉시 UNSUPPORTED_CONTRACT 오류를 반환합니다.
 *
 * ★ 금지: 미검증 버전을 조용히 통과시키거나 강제 캐스팅하지 마십시오.
 */
export const SUPPORTED_CONTRACT_VERSIONS = new Set<string>(['1.0', '1.3']);
export const SUPPORTED_SCHEMA_VERSIONS   = new Set<string>(['1.0']);
/**
 * engine_version은 AI Engine 연결 후 실제 값 확인 후 추가하십시오.
 * legacy 서버는 engine_version을 응답에 포함하지 않으므로 현재는 부재 시 통과.
 * AI Engine 응답에 포함되면 이 집합에 등록해야 앱이 수락합니다.
 */
export const SUPPORTED_ENGINE_VERSIONS   = new Set<string>(['v1', 'grounded_v1', 'legacy_v1']);

// ─── requestId 생성 ───────────────────────────────────────────────────────────

/**
 * UUID v4 폴백 생성기 (crypto.randomUUID 미지원 환경용)
 * RFC 4122 v4 포맷: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function _fallbackUUIDv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Teacher Diary 요청용 UUID v4 생성기.
 *
 * AI Engine V1 Contract: 순수 UUID v4만 허용합니다.
 * 형식 예시: 550e8400-e29b-41d4-a716-446655440000
 *
 * ★ 금지: diary_xxx / teacher_xxx / probe_xxx 등 모든 prefix 형식
 */
export function createDiaryRequestId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof (globalThis.crypto as Crypto).randomUUID === 'function'
  ) {
    return (globalThis.crypto as Crypto).randomUUID();
  }
  return _fallbackUUIDv4();
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
  /** AI Engine V1 pipeline 메타 정보 (로깅·POLISH_ONLY 처리·grounding 검증용) */
  meta?: {
    pipelineMode?:        string;
    engineBuild?:         string;
    templateIds?:         string[];
    knowledgeIds?:        string[];
    /** POLISH_ONLY 일 때 사용자 안내 표시 */
    generationMode?:      string;
    fallbackUsed?:        boolean;
    groundingValidation?: string;
  };
  usage?: {
    input_tokens?:  number;
    output_tokens?: number;
    total_tokens?:  number;
    /** AI Engine V1: 서버 측 생성 레이턴시 (ms) */
    latency_ms?:    number;
  };
}

interface NormalizedDiaryStudentResult {
  studentRef: string;
  content:    string;
}

interface TeacherDiaryAIRequest {
  contract_version: '1.0';    // 앱이 사용하는 Contract 버전
  request_id:       string;
  schema_version:   '1.0';
  feature:          'teacher_diary';
  locale:           'ko-KR';
  input: { text: string };
  context: {
    pool_id:      string;
    class_id:     string;
    lesson_date:  string;
    student_refs: string[];
    students:     Array<{ ref: string; name: string }>;
  };
}

/** AI Engine V1 Contract: student_ref + content 전용. student_id / feedback 제거됨. */
interface TeacherDiaryAIStudentResult {
  student_ref?: unknown;
  content?:     unknown;
}

interface TeacherDiaryAIResponse {
  contract_version?: unknown;
  request_id?:       unknown;
  schema_version?:   unknown;
  engine_version?:   unknown;
  feature?:          unknown;
  result?: {
    common?:   unknown;
    students?: unknown;
  };
  /** AI Engine V1 pipeline 메타 정보 */
  meta?: {
    pipeline_mode?:        unknown;
    engine_build?:         unknown;
    template_ids?:         unknown;
    knowledge_ids?:        unknown;
    generation_mode?:      unknown;
    fallback_used?:        unknown;
    grounding_validation?: unknown;
  };
  usage?: {
    input_tokens?:  unknown;
    output_tokens?: unknown;
    total_tokens?:  unknown;
    latency_ms?:    unknown;   // AI Engine V1: 서버 측 생성 레이턴시
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
  | { ok: false; contractError: string; stale?: true; unsupported?: true };

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

  // ── contract_version 검증 (응답에 포함된 경우) ─────────────────────────────
  // 응답에 contract_version이 없으면 legacy 허용 (전환 기간 호환성).
  // AI Engine이 발전해 새 버전을 추가하면 SUPPORTED_CONTRACT_VERSIONS에 등록하십시오.
  if (resp.contract_version !== undefined) {
    if (
      typeof resp.contract_version !== 'string' ||
      !SUPPORTED_CONTRACT_VERSIONS.has(resp.contract_version)
    ) {
      return {
        ok:            false,
        contractError: 'UNSUPPORTED_CONTRACT',
        unsupported:   true,
      };
    }
  }

  // ── schema_version 검증 (응답에 포함된 경우) ──────────────────────────────
  if (resp.schema_version !== undefined) {
    if (
      typeof resp.schema_version !== 'string' ||
      !SUPPORTED_SCHEMA_VERSIONS.has(resp.schema_version)
    ) {
      return {
        ok:            false,
        contractError: 'UNSUPPORTED_CONTRACT',
        unsupported:   true,
      };
    }
  }

  // ── engine_version 검증 (응답에 포함된 경우) ──────────────────────────────
  // AI Engine 연결 후 실제 engine_version 값을 SUPPORTED_ENGINE_VERSIONS에 등록하십시오.
  // legacy 서버는 engine_version을 포함하지 않으므로 부재 시 허용합니다.
  if (resp.engine_version !== undefined) {
    if (
      typeof resp.engine_version !== 'string' ||
      !SUPPORTED_ENGINE_VERSIONS.has(resp.engine_version)
    ) {
      return {
        ok:            false,
        contractError: 'UNSUPPORTED_CONTRACT',
        unsupported:   true,
      };
    }
  }

  // ── request_id 검증 ───────────────────────────────────────────────────────
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

    // V1 Contract: student_ref 필수. student_id / feedback 더 이상 지원하지 않습니다.
    const studentRef =
      typeof item.student_ref === 'string' && item.student_ref
        ? item.student_ref
        : null;

    if (!studentRef) {
      return { ok: false, contractError: `CONTRACT_STUDENT_REF_MISSING: students[${i}]` };
    }

    const content = typeof item.content === 'string' ? item.content : null;

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
      latency_ms:    typeof u.latency_ms    === 'number' ? u.latency_ms    : undefined,
    };
  }

  // ── meta 추출 (pipeline 정보 / POLISH_ONLY 처리 / grounding 검증용) ─────────
  let meta: NormalizedDiaryResult['meta'];
  if (resp.meta !== undefined && typeof resp.meta === 'object' && resp.meta !== null) {
    const m = resp.meta;
    meta = {
      pipelineMode:
        typeof m.pipeline_mode === 'string' ? m.pipeline_mode : undefined,
      engineBuild:
        typeof m.engine_build === 'string' ? m.engine_build : undefined,
      templateIds:
        Array.isArray(m.template_ids)
          ? (m.template_ids as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined,
      knowledgeIds:
        Array.isArray(m.knowledge_ids)
          ? (m.knowledge_ids as unknown[]).filter((x): x is string => typeof x === 'string')
          : undefined,
      generationMode:
        typeof m.generation_mode === 'string' ? m.generation_mode : undefined,
      fallbackUsed:
        typeof m.fallback_used === 'boolean' ? m.fallback_used : undefined,
      groundingValidation:
        typeof m.grounding_validation === 'string' ? m.grounding_validation : undefined,
    };
  }

  return {
    ok:     true,
    result: {
      common:    rawCommon,
      students:  normalizedStudents,
      requestId: typeof resp.request_id === 'string' ? resp.request_id : undefined,
      meta,
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

    // ── 422 GROUNDING_VALIDATION_FAILED ────────────────────────────────────
    // AI Engine이 grounding 검증 실패 시 반환. 자동 저장·삽입 금지.
    // retryable=true면 "다시 시도" 버튼을 제공합니다.
    if (httpStatus === 422) {
      if (serverCode === 'GROUNDING_VALIDATION_FAILED') {
        return {
          ok:    false,
          error: {
            origin:      'UNKNOWN',
            message:     '근거 검증을 통과하지 못했습니다. 입력을 조금 더 구체적으로 작성한 후 다시 시도해주세요.',
            retryable:   errorBody?.error?.retryable ?? true,
            retryTarget: 'INPUT',
            causeCode:   'GROUNDING_VALIDATION_FAILED',
          },
        };
      }
      return {
        ok:    false,
        error: {
          origin:      'NETWORK',
          message:     '요청을 처리할 수 없습니다. 다시 시도해주세요.',
          retryable:   errorBody?.error?.retryable ?? false,
          retryTarget: 'INPUT',
          causeCode:   serverCode,
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
    contract_version: APP_CONTRACT_VERSION,  // 앱이 지원하는 Contract 버전
    request_id:       requestId,
    schema_version:   '1.0',
    feature:          'teacher_diary',
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

    // UNSUPPORTED_CONTRACT — 앱이 지원하지 않는 버전의 응답
    // 사용자에게 앱 업데이트를 안내하고 retry를 차단합니다.
    if (normalized.unsupported) {
      console.error('[DiaryAIService] unsupported_contract', {
        request_id:    requestId,
        error_code:    normalized.contractError,
        pipeline_mode: mode,
      });
      return {
        ok:    false,
        error: {
          origin:      'UNKNOWN',
          message:     '앱이 이 버전의 AI 응답을 지원하지 않습니다. 앱을 최신 버전으로 업데이트해 주세요.',
          retryable:   false,
          retryTarget: null,
          causeCode:   'UNSUPPORTED_CONTRACT',
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

  // ── 성공 로그 (허용 필드만: PII 금지) ──────────────────────────────────────
  const resMeta = normalized.result.meta;
  if (__DEV__) {
    console.log('[DiaryAIService] generate_succeeded', {
      request_id:          requestId,
      pipeline_mode:       mode,
      generation_mode:     resMeta?.generationMode,
      grounding_validation: resMeta?.groundingValidation,
      template_ids_count:  resMeta?.templateIds?.length ?? 0,
      knowledge_ids_count: resMeta?.knowledgeIds?.length ?? 0,
      latency_ms:          normalized.result.usage?.latency_ms,
      has_common:          normalized.result.common.length > 0,
      student_count:       normalized.result.students.length,
    });
    // POLISH_ONLY 전용 안내 (Developer Log)
    if (resMeta?.generationMode === 'POLISH_ONLY') {
      console.log('[DiaryAIService] POLISH_ONLY: 입력 내용을 중심으로 문장을 정리했습니다.');
    }
  }

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
