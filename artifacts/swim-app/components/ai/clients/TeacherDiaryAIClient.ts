/**
 * TeacherDiaryAIClient.ts — Teacher Diary AI API HTTP 전담 클라이언트
 *
 * 책임:
 *   - Feature flag 판정 (legacy | grounded)
 *   - Base URL 조합 (env vars → legacy fallback)
 *   - Authorization Header 설정
 *   - HTTP POST 전송 + AbortSignal timeout 적용
 *   - Content-Type 검증 (non-JSON 차단)
 *   - JSON 파싱
 *   - HTTP / Network 오류 분류 반환
 *
 * 비책임:
 *   - 앱 파라미터 검증            → DiaryAIService
 *   - 응답 Contract 검증          → DiaryAIService (normalizeDiaryResponse)
 *   - DiaryServiceError 변환      → DiaryAIService
 *   - React 상태 변경             → Hook (useDiaryAIV2)
 *   - AbortSignal 생성            → Hook
 *   - request_id 생성             → DiaryAIService
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Feature Flag: EXPO_PUBLIC_SWIMNOTE_AI_MODE
 *   'legacy'   — 현재 SWIMNOTE API Server (Render.com) → rollback 전용
 *   'grounded' — SWIMNOTE AI Engine → 실기기 E2E 승인 후 Production 전환
 *   기본값: 'legacy' (AI Engine 최종 URL 수신 전까지)
 *
 * Grounded URL 환경변수:
 *   EXPO_PUBLIC_SWIMNOTE_AI_BASE_URL   — AI Engine base (예: https://ai.swimnote.kr)
 *   EXPO_PUBLIC_SWIMNOTE_AI_DIARY_PATH — diary generate path (기본: /api/ai/diary/generate)
 *
 * ★ 금지:
 *   - 신규 Engine 실패 시 사용자에게 알리지 않고 legacy로 자동 우회
 *   - grounded 실패를 정상 AI 결과로 위장
 *   - fallback 결과에 pipeline_mode=grounded 표시
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── Feature Flag ──────────────────────────────────────────────────────────────

export type AIDiaryMode = 'legacy' | 'grounded';

/**
 * ★ Teacher Diary 운영 모드: 코드 수준 고정 = 'grounded'
 *
 * 환경변수(EXPO_PUBLIC_SWIMNOTE_AI_MODE)와 무관하게 항상 grounded를 반환합니다.
 * legacy로 바뀌는 모든 경로(env var, 누락, OTA baked-in 값)를 차단합니다.
 */
export function getAIDiaryMode(): AIDiaryMode {
  return 'grounded';
}

// ── URL 설정 ──────────────────────────────────────────────────────────────────

/**
 * Legacy path — Teacher Diary에서 절대 호출 금지.
 * 이 경로로의 요청은 LEGACY_PATH_BLOCKED 오류를 throw합니다.
 */
const LEGACY_BASE = 'https://swimnote-api.onrender.com';
const LEGACY_PATH = '/api/ai/diary/generate';

/**
 * ★ Grounded V1 고정 엔드포인트
 *
 * 운영 Teacher Diary의 유일한 권한 경로입니다.
 * 환경변수로 override 불가 — 코드 수준 고정값이 우선합니다.
 */
const GROUNDED_BASE = 'https://swimnote-api.onrender.com';
const GROUNDED_PATH = '/api/v1/teacher-diary/generate';

/** Teacher Diary에서 절대 호출해서는 안 되는 legacy path 목록 */
const BLOCKED_LEGACY_PATHS = new Set([
  '/api/ai/diary/generate',
]);

export interface DiaryEndpoint {
  base: string;
  path: string;
  url:  string;
  host: string;   // 로깅용 — scheme/path 제외한 hostname만
}

/**
 * mode에 따라 엔드포인트 정보를 반환합니다.
 *
 * ★ legacy path가 결과 URL에 포함되면 즉시 LEGACY_PATH_BLOCKED를 throw합니다.
 *   자동 fallback 없음. 네트워크 실패 시 legacy fallback 없음.
 */
export function getDiaryEndpoint(mode: AIDiaryMode): DiaryEndpoint {
  let base: string;
  let path: string;

  if (mode === 'grounded') {
    base = GROUNDED_BASE.replace(/\/+$/, '');
    path = GROUNDED_PATH.startsWith('/') ? GROUNDED_PATH : `/${GROUNDED_PATH}`;
  } else {
    // legacy — 정상 실행 경로에서는 절대 도달하지 않아야 함
    base = LEGACY_BASE;
    path = LEGACY_PATH;
  }

  const url  = `${base}${path}`;
  const host = base.replace(/^https?:\/\//, '').split('/')[0]!;

  // ★ legacy path 차단: URL 생성 단계에서 즉시 throw
  for (const blocked of BLOCKED_LEGACY_PATHS) {
    if (path === blocked || url.includes(blocked)) {
      throw new Error(
        `[TeacherDiaryAIClient] LEGACY_PATH_BLOCKED: Teacher Diary는 ` +
        `${blocked} 경로를 호출할 수 없습니다. ` +
        `운영 경로: ${GROUNDED_BASE}${GROUNDED_PATH}`,
      );
    }
  }

  return { base, path, url, host };
}

// ── Client I/O 타입 ───────────────────────────────────────────────────────────

export interface AIClientRequest {
  /** E1 Contract request body — JSON으로 직렬화하여 전송 */
  body:      unknown;
  /** 앱 JWT — Bearer 토큰으로 전달 */
  token?:    string;
  /** 외부 AbortSignal (Hook 또는 Service가 제공) */
  signal:    AbortSignal;
  /** HTTP 타임아웃 (ms) */
  timeoutMs: number;
  /** Feature flag: legacy | grounded */
  mode:      AIDiaryMode;
}

export type AIClientFailureReason =
  | 'NETWORK'       // fetch 자체 throw (네트워크 단절 등)
  | 'TIMEOUT'       // AbortSignal timeout 만료
  | 'CONTENT_TYPE'  // 응답이 application/json 아님 (HTML SPA fallback 등)
  | 'PARSE_ERROR'   // Content-Type은 JSON이나 JSON.parse 실패
  | 'HTTP_ERROR';   // 4xx / 5xx HTTP 응답

export interface AIClientSuccess {
  ok:           true;
  httpStatus:   number;
  body:         unknown;      // JSON.parse 성공 body
  mode:         AIDiaryMode;
  endpointHost: string;       // 로깅용
}

export interface AIClientFailure {
  ok:           false;
  reason:       AIClientFailureReason;
  /** 네트워크 오류(fetch throw) 시 null */
  httpStatus:   number | null;
  /** JSON parse 성공 시 오류 body, 아니면 null */
  body:         unknown | null;
  mode:         AIDiaryMode;
  endpointHost: string;
  /** 로깅용 상세 — PII 미포함 */
  errorDetail:  string;
}

export type AIClientResult = AIClientSuccess | AIClientFailure;

// ── sendRequest ───────────────────────────────────────────────────────────────

/**
 * Teacher Diary AI API에 POST 요청을 전송합니다.
 *
 * @throws AbortError — signal.reason === 'unmount' | 'new-request' 일 때
 *   DiaryAIService가 이 오류를 받아 상위로 re-throw합니다.
 */
export async function sendRequest(req: AIClientRequest): Promise<AIClientResult> {
  const { body, token, signal, timeoutMs, mode } = req;

  // ── 엔드포인트 결정 ──────────────────────────────────────────────────────
  let endpoint: DiaryEndpoint;
  try {
    endpoint = getDiaryEndpoint(mode);
  } catch (e: any) {
    return {
      ok:           false,
      reason:       'NETWORK',
      httpStatus:   null,
      body:         null,
      mode,
      endpointHost: '(config_error)',
      errorDetail:  e.message ?? 'ENDPOINT_CONFIG_ERROR',
    };
  }

  // ── timeout AbortController — 외부 signal과 결합 ─────────────────────────
  const timeoutCtrl = new AbortController();
  const timerId     = setTimeout(() => timeoutCtrl.abort('timeout'), timeoutMs);
  const onExtAbort  = () => timeoutCtrl.abort(signal.reason ?? 'external');
  signal.addEventListener('abort', onExtAbort, { once: true });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // ── 진단: 서버 도달 여부 확인용 pre-flight log (fire-and-forget) ──────────
  const _reqId = (body as any)?.request_id ?? 'unknown';
  console.log('[TeacherDiaryAIClient] fetch_start', {
    request_id:    _reqId,
    mode,
    endpoint_url:  endpoint.url,
    endpoint_host: endpoint.host,
    has_token:     Boolean(token),
  });
  try {
    fetch('https://swimnote-api.onrender.com/api/ai/diary/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts:            Date.now(),
        request_id:    _reqId,
        pipeline_mode: mode,
        endpoint_host: endpoint.host,
        endpoint_path: endpoint.path,
        client_reason: 'PRE_FLIGHT',
      }),
    }).catch(() => {});
  } catch { /* 무시 */ }

  // ── fetch 직전 legacy path 최종 차단 ────────────────────────────────────
  // getDiaryEndpoint에서 이미 throw되지만, 방어적 이중 차단
  if (endpoint.path === '/api/ai/diary/generate' || endpoint.url.includes('/api/ai/diary/generate')) {
    throw new Error(
      `[TeacherDiaryAIClient] LEGACY_PATH_BLOCKED: fetch 직전 차단. ` +
      `Teacher Diary는 /api/ai/diary/generate를 호출할 수 없습니다.`,
    );
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  let response: Response;
  try {
    response = await fetch(endpoint.url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
      signal:  timeoutCtrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timerId);
    signal.removeEventListener('abort', onExtAbort);

    const abortReason = (timeoutCtrl.signal as any).reason ?? signal.reason;

    // external abort (unmount / new-request) — re-throw, DiaryAIService가 처리
    if (e?.name === 'AbortError' && (abortReason === 'unmount' || abortReason === 'new-request')) {
      throw e;
    }

    // timeout
    if (e?.name === 'AbortError' && abortReason === 'timeout') {
      return {
        ok:           false,
        reason:       'TIMEOUT',
        httpStatus:   null,
        body:         null,
        mode,
        endpointHost: endpoint.host,
        errorDetail:  'fetch_timeout',
      };
    }

    // 일반 네트워크 오류
    const safeMsg = String(e?.message ?? 'fetch_failed').replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
    console.error('[TeacherDiaryAIClient] fetch_failed', {
      request_id:    _reqId,
      error_name:    e?.name,
      error_message: safeMsg,
      error_stack:   String(e?.stack ?? '').slice(0, 200),
      endpoint_url:  endpoint.url,
    });
    try {
      fetch('https://swimnote-api.onrender.com/api/ai/diary/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts:            Date.now(),
          request_id:    _reqId,
          pipeline_mode: mode,
          endpoint_host: endpoint.host,
          endpoint_path: endpoint.path,
          client_reason: 'NETWORK',
          cause_code:    safeMsg.slice(0, 100),
        }),
      }).catch(() => {});
    } catch { /* 무시 */ }
    return {
      ok:           false,
      reason:       'NETWORK',
      httpStatus:   null,
      body:         null,
      mode,
      endpointHost: endpoint.host,
      errorDetail:  safeMsg,
    };
  }

  clearTimeout(timerId);
  signal.removeEventListener('abort', onExtAbort);

  // ── 응답 body 읽기 ───────────────────────────────────────────────────────
  let responseText: string;
  try {
    responseText = await response.text();
  } catch {
    return {
      ok:           false,
      reason:       'NETWORK',
      httpStatus:   response.status,
      body:         null,
      mode,
      endpointHost: endpoint.host,
      errorDetail:  'response_stream_error',
    };
  }

  // ── Content-Type 검증 ────────────────────────────────────────────────────
  const contentType = response.headers.get('content-type') ?? '';
  const isJson      = contentType.includes('application/json');

  if (!isJson) {
    // non-JSON — HTML SPA fallback, 프록시 오류 페이지 등
    // body_preview에 학생 이름/일지 원문이 들어갈 가능성 없음 (서버 자체 HTML)
    const snippet = responseText.slice(0, 40).replace(/\s+/g, ' ').trim();
    return {
      ok:           false,
      reason:       'CONTENT_TYPE',
      httpStatus:   response.status,
      body:         null,
      mode,
      endpointHost: endpoint.host,
      errorDetail:  `ct=${contentType} status=${response.status} preview=[${snippet}]`,
    };
  }

  // ── JSON 파싱 ────────────────────────────────────────────────────────────
  let parsedBody: unknown = null;
  let parseOk             = false;
  if (responseText) {
    try {
      parsedBody = JSON.parse(responseText);
      parseOk    = true;
    } catch { /* 아래에서 처리 */ }
  }

  if (!parseOk) {
    return {
      ok:           false,
      reason:       'PARSE_ERROR',
      httpStatus:   response.status,
      body:         null,
      mode,
      endpointHost: endpoint.host,
      errorDetail:  `json_parse_failed status=${response.status}`,
    };
  }

  // ── HTTP 오류 (4xx / 5xx) ─────────────────────────────────────────────────
  if (!response.ok) {
    return {
      ok:           false,
      reason:       'HTTP_ERROR',
      httpStatus:   response.status,
      body:         parsedBody,   // 오류 body (error.code 등)
      mode,
      endpointHost: endpoint.host,
      errorDetail:  `http_${response.status}`,
    };
  }

  // ── 성공 ────────────────────────────────────────────────────────────────
  return {
    ok:           true,
    httpStatus:   response.status,
    body:         parsedBody,
    mode,
    endpointHost: endpoint.host,
  };
}
