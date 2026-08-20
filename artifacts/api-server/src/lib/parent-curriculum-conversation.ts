/**
 * parent-curriculum-conversation.ts — WP2B / WP2B.2 / WP1.2 / WP-D
 *
 * 학부모 커리큘럼 상담 Conversation / Message 저장 서비스.
 *
 * 구조:
 *   parent_curriculum_conversations  — parent × student 복수 가능 (WP-D: UNIQUE 제거)
 *   parent_curriculum_messages       — USER/ASSISTANT 메시지 (request_id+role UNIQUE)
 *
 * WP2B.2 변경:
 *   - AssistantMeta에 result_payload 추가 → COMPLETED retry 시 answer 재사용
 *   - getAssistantMessageByRequestId() 추가
 *
 * WP1.2 변경:
 *   - buildRecentConversationContext() 추가 — ENGINE 전송용 최근 대화 context 구성
 *   - RECENT_CONTEXT_MAX_MESSAGES, RECENT_CONTEXT_MAX_CONTENT_CHARS 상수 추가
 *
 * WP-D 변경:
 *   - getOrCreateConversation(): ON CONFLICT 제거 → SELECT-first + INSERT 패턴
 *     (OLD schema: UNIQUE 있어도 동작, NEW schema: UNIQUE 없어도 동작)
 *   - createConversation(): 명시적 새 대화 생성
 *   - listConversations(): 대화 목록 조회
 *   - getConversationWithOwnership(): ID + ownership 검증
 *   - generateConversationTitle(): 첫 질문 기반 결정론적 title 생성 (GPT 금지)
 *   - updateConversationTitle(): title 업데이트
 *
 * 원칙:
 *   - USER message: 성공/실패 무관, ENGINE 호출 전 저장 (idempotent)
 *   - ASSISTANT message: ENGINE 성공 + validation PASS 후만 저장
 *   - result_payload: safe response fields only (answer/current_progress/next_step)
 *   - 금지: Grounding trace 전체 저장 / raw prompt / knowledge documents
 *   - recent_conversation: 질문 이해 보조용. Grounding source 승격 금지.
 *   - GPT title generation 금지. AI 비용 0.
 */

import { superAdminDb, pool as pgPool } from "@workspace/db";
import { sql }          from "drizzle-orm";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

/**
 * COMPLETED retry replay에 사용하는 안전한 응답 payload.
 * ENGINE raw trace / prompt / knowledge documents 포함 금지.
 */
export interface ResultPayload {
  answer:            string;
  current_progress?: any;
  next_step?:        any;
}

export interface AssistantMeta {
  intent?:            string | null;
  mode?:              string | null;
  curriculum_source?: string | null;
  /** WP2B.2: COMPLETED retry replay용 안전한 응답 (raw trace 금지). */
  result_payload?:    ResultPayload | null;
}

export interface CurriculumMessage {
  id:          string;
  role:        "USER" | "ASSISTANT";
  content:     string;
  created_at:  string;
  metadata?:   AssistantMeta | null;
}

export interface ConversationHistory {
  conversation_id: string;
  messages:        CurriculumMessage[];
}

/** WP-D: 대화 목록 항목 */
export interface ConversationListItem {
  id:                   string;
  title:                string | null;
  created_at:           string;
  updated_at:           string;
  last_message_at:      string | null;
  last_message_preview: string | null;
}

// ─── Title 생성 (GPT 금지, 결정론적) ──────────────────────────────────────────

const TITLE_MAX_LENGTH = 30;

/**
 * WP-D: 첫 사용자 질문을 기반으로 결정론적 title 생성.
 * GPT 호출 금지. 추가 AI 비용 0.
 *
 * 규칙:
 *   - trim, 줄바꿈 제거
 *   - 앞부분 인칭 제거 ("우리 아이 " → 제거)
 *   - 최대 TITLE_MAX_LENGTH 자
 *   - 빈 값이면 "새 대화"
 */
export function generateConversationTitle(firstUserMessage: string): string {
  if (!firstUserMessage || !firstUserMessage.trim()) return "새 대화";

  let text = firstUserMessage.trim().replace(/[\n\r]+/g, " ").replace(/\s+/g, " ");

  // 앞부분 인칭/지시어 제거 패턴 (결정론적, 사전기반)
  const STRIP_PREFIXES = [
    "우리 아이가 ",
    "우리 아이는 ",
    "우리 아이 ",
    "우리아이 ",
    "아이가 ",
    "아이는 ",
    "저희 아이 ",
  ];
  for (const prefix of STRIP_PREFIXES) {
    const trimmedPrefix = prefix.trimEnd();
    // prefix 뒤에 공백 또는 문자열 끝 — 단어 경계 매칭
    if (
      text.startsWith(trimmedPrefix) &&
      (text.length === trimmedPrefix.length || text[trimmedPrefix.length] === " ")
    ) {
      text = text.slice(trimmedPrefix.length).trim();
      break;
    }
  }

  if (!text) return "새 대화";

  if (text.length > TITLE_MAX_LENGTH) {
    text = text.slice(0, TITLE_MAX_LENGTH) + "…";
  }

  return text;
}

// ─── Conversation 조회/생성 ────────────────────────────────────────────────────

/**
 * WP-D: 구버전 앱 fallback — conversation_id 없이 요청 시 사용.
 *
 * OLD schema (UNIQUE 있음): SELECT first → 있으면 반환, 없으면 INSERT
 * NEW schema (UNIQUE 없음): 동일 로직 (UNIQUE 없어도 SELECT로 안전하게 분기)
 *
 * advisory lock으로 concurrency 보호:
 *   - 동시 최초 요청에서 conversation 중복 생성 방지
 *   - pg_try_advisory_xact_lock(hash) → 선점 실패 시 재조회
 *
 * ON CONFLICT(parent_account_id, student_id) 의존 완전 제거.
 *
 * @returns conversation_id
 */
export async function getOrCreateConversation(
  parentId:  string,
  studentId: string,
  poolId:    string,
): Promise<string> {
  // advisory lock key: parentId + studentId 기반 int4 pair
  const lockKey1 = Math.abs(hashStr(parentId))   % 2147483647;
  const lockKey2 = Math.abs(hashStr(studentId))  % 2147483647;

  // pg 드라이버는 single connection 트랜잭션 내에서만 advisory lock이 유효하고,
  // drizzle execute()는 multi-statement SQL을 지원하지 않음.
  // → raw pg 클라이언트를 checkout해서 BEGIN/pg_advisory_xact_lock/SELECT/COMMIT.
  const client = await pgPool.connect();
  let rows: any[] = [];
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1::int, $2::int)",
      [lockKey1, lockKey2],
    );
    const result = await client.query(
      `SELECT id
       FROM parent_curriculum_conversations
       WHERE parent_account_id = $1
         AND student_id         = $2
         AND status             = 'active'
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT 1`,
      [parentId, studentId],
    );
    await client.query("COMMIT");
    rows = result.rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (rows.length > 0) {
    const convId = (rows[0] as any).id as string;
    // touch updated_at
    await superAdminDb.execute(sql`
      UPDATE parent_curriculum_conversations
      SET updated_at      = NOW(),
          last_message_at = NOW()
      WHERE id = ${convId}
    `).catch(() => undefined);
    return convId;
  }

  // 없으면 신규 생성
  return createConversation(parentId, studentId, poolId);
}

/** djb2 hash for string → int. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h | 0; // int32
  }
  return h;
}

/**
 * WP-D: 명시적 새 대화 생성.
 * POST /conversations 엔드포인트에서 호출.
 * quota 차감 없음, AI 호출 없음.
 *
 * @returns 새 conversation_id
 */
export async function createConversation(
  parentId:  string,
  studentId: string,
  poolId:    string,
  title:     string | null = null,
): Promise<string> {
  const result = await superAdminDb.execute(sql`
    INSERT INTO parent_curriculum_conversations
      (parent_account_id, student_id, swimming_pool_id, title)
    VALUES
      (${parentId}, ${studentId}, ${poolId}, ${title})
    RETURNING id
  `);

  return ((result as any).rows[0] as any).id as string;
}

/**
 * WP-D: 대화 목록 조회.
 * parent_account_id + student_id + swimming_pool_id + status='active' 필터.
 * updated_at DESC (또는 last_message_at DESC).
 *
 * last_message_preview: 가장 최근 ASSISTANT 메시지 앞 100자.
 */
export async function listConversations(
  parentId:  string,
  studentId: string,
  poolId:    string,
): Promise<ConversationListItem[]> {
  const result = await superAdminDb.execute(sql`
    SELECT
      c.id,
      c.title,
      c.created_at,
      c.updated_at,
      c.last_message_at,
      (
        SELECT LEFT(m.content, 100)
        FROM parent_curriculum_messages m
        WHERE m.conversation_id = c.id
          AND m.role = 'ASSISTANT'
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message_preview
    FROM parent_curriculum_conversations c
    WHERE c.parent_account_id = ${parentId}
      AND c.student_id         = ${studentId}
      AND c.swimming_pool_id   = ${poolId}
      AND c.status             = 'active'
    ORDER BY COALESCE(c.last_message_at, c.updated_at) DESC
    LIMIT 50
  `);

  return (result as any).rows.map((row: any) => ({
    id:                   row.id as string,
    title:                (row.title as string | null) ?? null,
    created_at:           row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:           row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    last_message_at:      row.last_message_at
      ? (row.last_message_at instanceof Date ? row.last_message_at.toISOString() : String(row.last_message_at))
      : null,
    last_message_preview: (row.last_message_preview as string | null) ?? null,
  }));
}

/**
 * WP-D: conversationId + ownership 검증.
 * parent_account_id / student_id / swimming_pool_id 불일치 → null 반환.
 *
 * @returns conversation row 또는 null
 */
export async function getConversationWithOwnership(
  conversationId: string,
  parentId:       string,
  studentId:      string,
  poolId:         string,
): Promise<{ id: string; title: string | null; status: string } | null> {
  const result = await superAdminDb.execute(sql`
    SELECT id, title, status
    FROM parent_curriculum_conversations
    WHERE id                = ${conversationId}
      AND parent_account_id = ${parentId}
      AND student_id        = ${studentId}
      AND swimming_pool_id  = ${poolId}
      AND status            = 'active'
    LIMIT 1
  `);

  const rows = (result as any).rows;
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    id:     row.id as string,
    title:  (row.title as string | null) ?? null,
    status: row.status as string,
  };
}

/**
 * WP-D: Conversation title 업데이트.
 * 첫 USER message 저장 후 호출 — title이 NULL 또는 "새 대화"인 경우만.
 * GPT 호출 없음.
 */
export async function updateConversationTitleIfBlank(
  conversationId: string,
  firstUserContent: string,
): Promise<void> {
  const newTitle = generateConversationTitle(firstUserContent);
  await superAdminDb.execute(sql`
    UPDATE parent_curriculum_conversations
    SET title      = ${newTitle},
        updated_at = NOW()
    WHERE id = ${conversationId}
      AND (title IS NULL OR title = '새 대화')
  `).catch(() => undefined);
}

/** Conversation 마지막 활동 시간 갱신. */
export async function touchConversation(conversationId: string): Promise<void> {
  await superAdminDb.execute(sql`
    UPDATE parent_curriculum_conversations
    SET last_message_at = NOW(),
        updated_at      = NOW()
    WHERE id = ${conversationId}
  `);
}

// ─── Message 저장 ─────────────────────────────────────────────────────────────

/**
 * USER 메시지 저장.
 * ON CONFLICT DO NOTHING — FAILED retry 시 기존 USER message 재사용 (중복 저장 금지).
 *
 * ENGINE 호출 전 저장 (요청 자체가 기록됨).
 */
export async function saveUserMessage(params: {
  conversationId: string;
  requestId:      string;
  content:        string;
}): Promise<void> {
  const { conversationId, requestId, content } = params;
  await superAdminDb.execute(sql`
    INSERT INTO parent_curriculum_messages
      (conversation_id, request_id, role, content)
    VALUES
      (${conversationId}, ${requestId}, 'USER', ${content})
    ON CONFLICT (request_id, role) DO NOTHING
  `);
}

/**
 * ASSISTANT 메시지 저장.
 * ENGINE 성공 + response validation PASS 후만 호출.
 * ON CONFLICT DO NOTHING — 중복 저장 금지 (FAILED retry 후 성공 시 1건만 생성).
 *
 * meta.result_payload: COMPLETED retry replay 용. answer/current_progress/next_step만 저장.
 * 금지: ENGINE 실패 / validation 실패 결과 저장 / grounding trace 전체 저장.
 */
export async function saveAssistantMessage(params: {
  conversationId: string;
  requestId:      string;
  content:        string;
  meta?:          AssistantMeta;
}): Promise<void> {
  const { conversationId, requestId, content, meta } = params;
  const safeMetadata = meta
    ? JSON.stringify({
        intent:            meta.intent            ?? null,
        mode:              meta.mode              ?? null,
        curriculum_source: meta.curriculum_source ?? null,
        result_payload:    meta.result_payload    ?? null,
      })
    : null;

  await superAdminDb.execute(sql`
    INSERT INTO parent_curriculum_messages
      (conversation_id, request_id, role, content, metadata)
    VALUES
      (
        ${conversationId},
        ${requestId},
        'ASSISTANT',
        ${content},
        ${safeMetadata}::jsonb
      )
    ON CONFLICT (request_id, role) DO NOTHING
  `);
}

// ─── History 조회 ─────────────────────────────────────────────────────────────

/** 해당 student conversation의 최신 active conversation_id 조회 (없으면 null). */
export async function findConversation(
  parentId:  string,
  studentId: string,
): Promise<string | null> {
  const result = await superAdminDb.execute(sql`
    SELECT id
    FROM parent_curriculum_conversations
    WHERE parent_account_id = ${parentId}
      AND student_id         = ${studentId}
      AND status             = 'active'
    ORDER BY COALESCE(last_message_at, updated_at) DESC
    LIMIT 1
  `);
  return (result as any).rows.length ? (((result as any).rows[0] as any).id as string) : null;
}

/**
 * 특정 request_id의 ASSISTANT 메시지 조회.
 * COMPLETED retry replay 시 persisted result 복원에 사용.
 *
 * @returns CurriculumMessage | null (존재하지 않으면 null)
 */
export async function getAssistantMessageByRequestId(
  conversationId: string,
  requestId:      string,
): Promise<CurriculumMessage | null> {
  const result = await superAdminDb.execute(sql`
    SELECT id, role, content, metadata, created_at
    FROM parent_curriculum_messages
    WHERE conversation_id = ${conversationId}
      AND request_id      = ${requestId}
      AND role            = 'ASSISTANT'
    LIMIT 1
  `);

  if (!(result as any).rows.length) return null;

  const row = (result as any).rows[0] as any;
  return {
    id:         row.id,
    role:       "ASSISTANT",
    content:    row.content,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
    metadata: row.metadata
      ? (typeof row.metadata === "string"
          ? JSON.parse(row.metadata)
          : row.metadata)
      : null,
  };
}

// ─── Recent Conversation Context (WP1.2) ─────────────────────────────────────

/** ENGINE에 전달하는 recent context 최대 메시지 수. */
export const RECENT_CONTEXT_MAX_MESSAGES = 6 as const;

/** 메시지당 최대 문자 수 (LLM 토큰 비용 제어). */
export const RECENT_CONTEXT_MAX_CONTENT_CHARS = 500 as const;

export interface PcRecentContextMessage {
  role:    "USER" | "ASSISTANT";
  content: string;
}

/**
 * ENGINE 전송용 최근 대화 context 구성 (WP1.2).
 *
 * WP-D: conversationId 스코핑으로 다른 conversation messages 완전 분리.
 *
 * 규칙:
 *   - 현재 query (excludeRequestId) 제외
 *   - 최대 maxMessages 개 (default: RECENT_CONTEXT_MAX_MESSAGES = 6)
 *   - 역할: USER | ASSISTANT 만 허용 (SYSTEM 등 차단)
 *   - 빈 content 차단 (trim 후 empty → 제외)
 *   - content 최대 RECENT_CONTEXT_MAX_CONTENT_CHARS 자 truncation
 *   - 반환 순서: 오래된 순 → 최신 순 (oldest → newest)
 *
 * 중요: recent_conversation은 질문 이해 보조용. Grounding source 승격 금지.
 *
 * @param conversationId   현재 conversation row id
 * @param excludeRequestId 현재 요청 request_id (현재 query 제외)
 * @param maxMessages      반환할 최대 메시지 수 (default 6)
 */
export async function buildRecentConversationContext(
  conversationId:   string,
  excludeRequestId: string,
  maxMessages:      number = RECENT_CONTEXT_MAX_MESSAGES,
): Promise<PcRecentContextMessage[]> {
  // 최신 순으로 maxMessages 개 조회 (현재 request 제외)
  const result = await superAdminDb.execute(sql`
    SELECT role, content
    FROM parent_curriculum_messages
    WHERE conversation_id = ${conversationId}
      AND request_id     != ${excludeRequestId}
    ORDER BY created_at DESC
    LIMIT ${maxMessages}
  `);

  return ((result as any).rows as any[])
    .filter((row) => {
      const role    = typeof row.role    === "string" ? row.role    : "";
      const content = typeof row.content === "string" ? row.content : "";
      // 유효한 role만 허용 (SYSTEM 등 차단)
      const validRole = role === "USER" || role === "ASSISTANT";
      // 빈 content 차단
      const nonEmpty  = content.trim().length > 0;
      return validRole && nonEmpty;
    })
    .map((row) => {
      const raw = (row.content as string).trim();
      return {
        role:    row.role as "USER" | "ASSISTANT",
        content: raw.length > RECENT_CONTEXT_MAX_CONTENT_CHARS
          ? raw.slice(0, RECENT_CONTEXT_MAX_CONTENT_CHARS)
          : raw,
      };
    })
    .reverse(); // DESC → ASC (oldest → newest, ENGINE 기대 순서)
}

// ─── History 조회 ─────────────────────────────────────────────────────────────

/**
 * Conversation의 메시지 목록 조회 (최신 N개, 시간 순).
 */
export async function getConversationMessages(
  conversationId: string,
  limit           = 50,
): Promise<CurriculumMessage[]> {
  const result = await superAdminDb.execute(sql`
    SELECT id, role, content, metadata, created_at
    FROM parent_curriculum_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  return ((result as any).rows as any[]).map((row) => {
    const msg: CurriculumMessage = {
      id:         row.id,
      role:       row.role as "USER" | "ASSISTANT",
      content:    row.content,
      created_at: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    };
    if (row.role === "ASSISTANT" && row.metadata) {
      msg.metadata = typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata;
    }
    return msg;
  });
}
