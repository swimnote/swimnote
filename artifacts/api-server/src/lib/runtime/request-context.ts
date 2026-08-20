/**
 * request-context.ts — AI Data Runtime 공통 RequestContext (RT1)
 *
 * Production behavior 변경 없음.
 * 기존 route에서 import 금지 (RT2 이후 단계적 연결).
 *
 * 보안 원칙:
 *   - tenant_id는 client 제공값을 권위로 사용 금지.
 *     각 route가 서버에서 검증한 pool_id만 주입 가능.
 *   - input_text는 runtime memory에만 보존.
 *     event_logs diagnostics 저장 금지.
 */

// ── Domain ────────────────────────────────────────────────────────────────────

export type RuntimeDomain =
  | "SUPPORT"
  | "CURRICULUM"
  | "DIARY"
  | "GROWTH_REPORT";

export type RuntimeMode = "normal" | "x";

// ── RequestContext ─────────────────────────────────────────────────────────────

export interface RequestContext {
  /** 요청 식별자. route에서 검증된 UUID. */
  readonly request_id: string;

  /** AI 기능 도메인. */
  readonly domain: RuntimeDomain;

  /**
   * 서버가 검증한 pool_id.
   * client 제공값을 그대로 넣지 않는다.
   * tenant 격리의 근거.
   */
  readonly tenant_id: string;

  /** DB에서 확인된 actor 내부 ID. */
  readonly actor_id: string;

  /** JWT에서 읽은 role. */
  readonly actor_role: string;

  /**
   * 사용자 원문. runtime 메모리에서만 사용.
   * diagnostics/event_logs 저장 금지.
   */
  readonly input_text: string;

  /** 정규화된 검색 쿼리. diagnostics 저장 허용. */
  readonly normalized_query: string;

  /** 수영장 운영 모드. */
  readonly mode: RuntimeMode;

  /** domain-specific 추가 정보. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Builder options ────────────────────────────────────────────────────────────

export interface BuildRequestContextOptions {
  request_id:       string;
  domain:           RuntimeDomain;
  /**
   * 반드시 서버에서 검증된 pool_id를 전달한다.
   * 빈 문자열 또는 undefined → 오류 발생.
   */
  verified_tenant_id: string;
  actor_id:         string;
  actor_role:       string;
  input_text:       string;
  mode:             RuntimeMode;
  metadata?:        Record<string, unknown>;
}

// ── Normalization helper ───────────────────────────────────────────────────────

/**
 * 간단한 공통 쿼리 정규화.
 *
 * - 소문자 변환
 * - 앞뒤 공백 제거
 * - 중복 공백 단일화
 *
 * 도메인별 심층 정규화(조사 분리 등)는 각 Retriever 책임.
 */
export function normalizeQueryBase(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * RequestContext 생성.
 *
 * 검증 규칙:
 *   1. verified_tenant_id는 비어 있어선 안 된다.
 *   2. request_id는 비어 있어선 안 된다.
 *   3. input_text는 비어 있어선 안 된다.
 */
export function buildRequestContext(opts: BuildRequestContextOptions): RequestContext {
  if (!opts.verified_tenant_id || opts.verified_tenant_id.trim() === "") {
    throw new Error(
      "RequestContext: verified_tenant_id is required. " +
      "Pass the server-verified pool_id, never the raw client value."
    );
  }
  if (!opts.request_id || opts.request_id.trim() === "") {
    throw new Error("RequestContext: request_id is required.");
  }
  if (!opts.input_text || opts.input_text.trim() === "") {
    throw new Error("RequestContext: input_text is required.");
  }

  return Object.freeze({
    request_id:       opts.request_id.trim(),
    domain:           opts.domain,
    tenant_id:        opts.verified_tenant_id.trim(),
    actor_id:         opts.actor_id,
    actor_role:       opts.actor_role,
    input_text:       opts.input_text,
    normalized_query: normalizeQueryBase(opts.input_text),
    mode:             opts.mode,
    metadata:         opts.metadata ? Object.freeze({ ...opts.metadata }) : undefined,
  });
}
