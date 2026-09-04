/**
 * ai-origin-registry.ts — AI diary origin 서버 검증 레지스트리
 *
 * WP9-P1 — Server-side verification of ai_request_id before diary save.
 *
 * 배경:
 *   - request_id는 APP(DiaryAIService.createDiaryRequestId)이 UUID v4로 생성
 *   - AI generation 서버(ai-v1.ts)는 request_id를 수신하고 응답에 echo
 *   - saveAiTrace는 event_logs에 기록하지만 void(fire-and-forget) 방식
 *   - diary save(POST /diaries)가 AI response 직후 도달 → race condition 가능
 *   → 해결: res.json() 직전 in-memory registry에 동기 등록
 *
 * 설계 원칙:
 *   - 새 테이블/migration 없음
 *   - 새 service layer/framework 없음
 *   - registerAiOrigin: AI generation 핸들러에서 응답 직전 동기 호출
 *   - lookupAiOrigin: diary save 핸들러에서 in-memory 확인
 *   - event_logs fallback: registry miss(프로세스 재시작, 멀티인스턴스) 처리
 *
 * TTL:
 *   - 기본 2시간 — teacher가 AI 결과를 수정 후 저장하는 시간 커버
 *   - 만료 후 event_logs fallback으로 전환
 *
 * 멀티인스턴스 대응:
 *   - registry miss → event_logs fallback → 정상 동작
 *   - 단일 인스턴스: registry hit → race condition 없음
 *
 * Cross-pool 보호:
 *   - registry entry에 poolId 포함 → 검증 시 poolId 비교 필수
 *   - event_logs fallback도 pool_id 조건 포함
 *
 * 1:N 관계:
 *   - 실제 product flow: 1 AI request → 1 diary save (1:1)
 *   - 교사가 동일 결과로 재시도 시 동일 request_id 재사용 → 허용 (unique constraint 없음)
 *   - registry entry 삭제 없음 → TTL까지 재검증 가능
 */

export interface AiOriginEntry {
  /** AI generation이 발생한 수영장 pool_id */
  poolId:   string;
  /** AI generation을 요청한 teacher user_id (actorId) */
  actorId:  string | null;
  /** 등록 시각 (Date.now()) */
  ts:       number;
}

/** TTL: 2시간 (교사 일지 작성 → 저장 주기 커버) */
const REGISTRY_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * in-memory registry
 * key:   externalRequestId (UUID v4, APP 생성)
 * value: AiOriginEntry
 */
const _registry = new Map<string, AiOriginEntry>();

/**
 * AI origin 등록 — ai-v1.ts의 res.json() 직전에 동기 호출.
 *
 * 호출 시점 제약:
 *   - res.json() BEFORE → 응답 전 등록으로 race condition 방지
 *   - 동일 request_id로 재호출 시 덮어씀 (재시도 안전)
 *
 * @param requestId  externalRequestId (client UUID v4)
 * @param poolId     AI generation 요청의 수영장 pool_id
 * @param actorId    AI generation 요청 teacher의 user_id (없으면 null)
 */
export function registerAiOrigin(
  requestId: string,
  poolId:    string,
  actorId:   string | null,
): void {
  if (!requestId || !poolId) return;
  _pruneExpired();
  _registry.set(requestId, { poolId, actorId, ts: Date.now() });
}

/**
 * AI origin 조회 — in-memory registry에서 확인.
 *
 * @param requestId  검증할 request_id
 * @returns AiOriginEntry (hit) | null (miss 또는 만료)
 */
export function lookupAiOrigin(requestId: string): AiOriginEntry | null {
  const entry = _registry.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.ts > REGISTRY_TTL_MS) {
    _registry.delete(requestId);
    return null;
  }
  return entry;
}

/** 만료 entry 정리 — registerAiOrigin 호출 시 트리거 */
function _pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of _registry) {
    if (now - v.ts > REGISTRY_TTL_MS) _registry.delete(k);
  }
}

/** 테스트/검증용: registry size 반환 */
export function _registrySize(): number {
  return _registry.size;
}

/** 테스트/검증용: registry 전체 초기화 */
export function _clearRegistry(): void {
  _registry.clear();
}
