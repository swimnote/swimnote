/**
 * WP-CS26 — Autonomous support escalation helpers.
 *
 * Sequence metadata is stored only in support_cases.context_json:
 * no raw messages, phone numbers, or permanent cross-conversation counters.
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizeQuery } from "./support-resolver.js";

export type GptEscalationStatus = "NONE" | "OFFERED" | "PROCESSING" | "RESPONDED";

export interface SupportSequence {
  last_topic_key: string | null;
  same_intent_streak: number;
  inquiry_offered: boolean;
  gpt_status: GptEscalationStatus;
  gpt_request_id?: string | null;
  retrieved_knowledge_ids?: string[];
  knowledge_revisions?: Record<string, number>;
  previous_answers_used?: number;
  updated_at?: string;
}

const EMPTY_SEQUENCE: SupportSequence = {
  last_topic_key: null,
  same_intent_streak: 0,
  inquiry_offered: false,
  gpt_status: "NONE",
};

function asSequence(value: unknown): SupportSequence {
  const v = value as Partial<SupportSequence> | null;
  if (!v || typeof v !== "object") return { ...EMPTY_SEQUENCE };
  return {
    ...EMPTY_SEQUENCE,
    ...v,
    same_intent_streak: Number.isFinite(Number(v.same_intent_streak))
      ? Math.max(0, Number(v.same_intent_streak))
      : 0,
    gpt_status: ["NONE", "OFFERED", "PROCESSING", "RESPONDED"].includes(String(v.gpt_status))
      ? v.gpt_status as GptEscalationStatus
      : "NONE",
  };
}

/**
 * Matched knowledge/direct-answer IDs are stable intent keys. An unmatched
 * question deliberately uses its complete normalized form: unlike a broad
 * NO_MATCH bucket, this cannot turn unrelated questions into a 3-turn streak.
 */
export function buildSupportTopicKey(params: {
  sourceType?: string | null;
  sourceId?: string | null;
  normalizedQuery: string;
}): string {
  if (params.sourceId) {
    return `${params.sourceType ?? "MATCH"}:${params.sourceId}`;
  }
  return `NO_MATCH:${normalizeQuery(params.normalizedQuery)}`;
}

export function nextSupportSequence(
  currentContext: unknown,
  topicKey: string,
  hasOpenHumanCase: boolean
): SupportSequence {
  const current = asSequence((currentContext as any)?.cs26_sequence);
  const sameTopic = current.last_topic_key === topicKey;
  const streak = sameTopic ? current.same_intent_streak + 1 : 1;

  // An existing human case is the end of the autonomous flow. Do not offer
  // another escalation or allow a second ticket from the same conversation.
  if (hasOpenHumanCase) {
    return {
      ...current,
      last_topic_key: topicKey,
      same_intent_streak: streak,
      inquiry_offered: false,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...current,
    last_topic_key: topicKey,
    same_intent_streak: streak,
    inquiry_offered: streak >= 3 && current.gpt_status !== "RESPONDED",
    gpt_status: streak >= 3 && current.gpt_status === "NONE" ? "OFFERED" : current.gpt_status,
    updated_at: new Date().toISOString(),
  };
}

export function getSupportSequence(context: unknown): SupportSequence {
  return asSequence((context as any)?.cs26_sequence);
}

/** Store only sequence metadata; raw user messages remain in the case thread. */
export async function saveSupportSequence(caseId: string, sequence: SupportSequence): Promise<void> {
  await (superAdminDb as any).execute(sql`
    UPDATE support_cases
    SET context_json = COALESCE(context_json, '{}'::jsonb)
      || jsonb_build_object('cs26_sequence', ${JSON.stringify(sequence)}::jsonb),
        updated_at = NOW()
    WHERE id = ${caseId}
  `);
}

/** Removes common contact details before a bounded conversation excerpt reaches GPT. */
export function redactConversationForGrounding(value: string): string {
  return value
    .replace(/\b(?:\+?82[-\s]?)?0?1[0-9][-\s]?\d{3,4}[-\s]?\d{4}\b/g, "[연락처]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[이메일]")
    .slice(0, 800);
}