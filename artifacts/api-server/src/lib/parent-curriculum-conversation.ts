/**
 * parent-curriculum-conversation.ts — WP2B / WP2B.2
 *
 * 학부모 커리큘럼 상담 Conversation / Message 저장 서비스.
 *
 * 구조:
 *   parent_curriculum_conversations  — parent × student = 1개 (UNIQUE)
 *   parent_curriculum_messages       — USER/ASSISTANT 메시지 (request_id+role UNIQUE)
 *
 * WP2B.2 변경:
 *   - AssistantMeta에 result_payload 추가 → COMPLETED retry 시 answer 재사용
 *   - getAssistantMessageByRequestId() 추가
 *
 * 원칙:
 *   - USER message: 성공/실패 무관, ENGINE 호출 전 저장 (idempotent)
 *   - ASSISTANT message: ENGINE 성공 + validation PASS 후만 저장
 *   - result_payload: safe response fields only (answer/current_progress/next_step)
 *   - 금지: Grounding trace 전체 저장 / raw prompt / knowledge documents
 */

import { superAdminDb } from "@workspace/db";
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

// ─── Conversation 조회/생성 ────────────────────────────────────────────────────

/**
 * parent × student 기준으로 Conversation을 찾거나 새로 생성.
 * 같은 parent가 같은 student를 다시 열면 기존 conversation 재사용.
 *
 * @returns conversation_id
 */
export async function getOrCreateConversation(
  parentId:  string,
  studentId: string,
  poolId:    string,
): Promise<string> {
  const result = await superAdminDb.execute(sql`
    INSERT INTO parent_curriculum_conversations
      (parent_account_id, student_id, swimming_pool_id)
    VALUES
      (${parentId}, ${studentId}, ${poolId})
    ON CONFLICT (parent_account_id, student_id)
    DO UPDATE SET
      updated_at      = NOW(),
      last_message_at = NOW()
    RETURNING id
  `);

  return (result.rows[0] as any).id as string;
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

/** 해당 student conversation의 conversation_id 조회 (없으면 null). */
export async function findConversation(
  parentId:  string,
  studentId: string,
): Promise<string | null> {
  const result = await superAdminDb.execute(sql`
    SELECT id
    FROM parent_curriculum_conversations
    WHERE parent_account_id = ${parentId}
      AND student_id         = ${studentId}
    LIMIT 1
  `);
  return result.rows.length ? ((result.rows[0] as any).id as string) : null;
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

  if (!result.rows.length) return null;

  const row = result.rows[0] as any;
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

  return (result.rows as any[]).map((row) => {
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
