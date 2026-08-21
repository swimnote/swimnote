/**
 * support-nano-resolver.ts — WP-SUPPORT-NANO-01
 *
 * 저비용 AI가 candidate KI를 한 번에 해석·선별·정리.
 *
 * 목표:
 *   - 1 logical support request → 1 AI call
 *   - selected_knowledge_ids 추적 가능 (§9)
 *   - grounded 여부 검증 가능
 *   - insufficient 분리 가능
 *
 * 절대 금지:
 *   - Professional Engine / Curriculum / Diary / Growth 수정
 *   - DB migration
 *   - vector DB 도입
 *   - 상위 모델 escalation
 *   - DB 전체 dump
 *   - 2회 이상 AI 호출 (1 logical request = 1 AI call)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { type EvidenceItem } from "./support-resolver.js";
import type OpenAI from "openai";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * §9 structured output contract.
 * - selected_knowledge_ids: 실제 답변 근거 KI ID 목록 (candidate 외 임의 ID 금지)
 * - answer: 한국어 답변
 * - confidence: HIGH | MEDIUM | LOW
 * - insufficient_knowledge: true → 근거 없음 (selected_knowledge_ids는 빈 배열)
 */
export interface NanoOutput {
  selected_knowledge_ids: string[];
  answer:                 string;
  confidence:             "HIGH" | "MEDIUM" | "LOW";
  insufficient_knowledge: boolean;
}

/** 최근 대화 턴 (PII 금지 — 본문은 Nano 프롬프트에만 전달, DB 저장 금지) */
export interface RecentMessage {
  role:    "user" | "ai";
  content: string;
}

// ── Recent context ────────────────────────────────────────────────────────────

/**
 * 최근 2~3턴 대화 가져오기.
 * 전체 history dump 금지 — maxTurns 엄수.
 * DB 오류 시 empty 반환 (non-fatal).
 */
export async function buildRecentContext(
  caseId:   string,
  maxTurns: number = 3
): Promise<RecentMessage[]> {
  try {
    const rows = (await superAdminDb.execute(sql`
      SELECT author_role, content
      FROM support_ticket_replies
      WHERE case_id = ${caseId}
        AND author_role IN ('user', 'ai')
        AND content IS NOT NULL
        AND content != ''
      ORDER BY created_at DESC
      LIMIT ${maxTurns * 2}
    `)) as any;
    return ((rows.rows ?? []) as any[])
      .reverse()
      .slice(0, maxTurns * 2)
      .map((r: any) => ({
        role:    (r.author_role === "user" ? "user" : "ai") as "user" | "ai",
        content: String(r.content ?? "").slice(0, 400),
      }));
  } catch {
    return [];
  }
}

// ── Nano call ─────────────────────────────────────────────────────────────────

const NANO_SYSTEM_BASE = `당신은 SwimNote 앱의 AI 고객지원 도우미입니다.

[필수 규칙]
- 아래 제공된 SwimNote 근거 자료(Knowledge Items) 범위 안에서만 답변합니다.
- 근거에 없는 메뉴, 정책, 기능, 가격을 창작하거나 추측하지 않습니다.
- 환불 실행, 계정 변경, 구독 변경 등의 직접 실행은 하지 않습니다.
- 개인정보(이름, 전화, 이메일)를 수집하거나 언급하지 않습니다.
- 근거 자료가 없거나 부족하면 insufficient_knowledge=true, confidence=LOW, selected_knowledge_ids=[]로 응답합니다.
- 답변은 한국어로 작성합니다.
- selected_knowledge_ids에는 실제 답변 근거로 사용한 KI ID만 포함합니다.
- selected_knowledge_ids에 제공되지 않은 ID를 임의로 만들어내지 않습니다.
- 여러 KI가 관련된 경우 근거 범위 내에서 통합 답변을 생성합니다.

[응답 JSON 형식 — 반드시 이 형식만 반환]
{
  "selected_knowledge_ids": ["ki_xxx"],
  "answer": "사용자에게 전달할 한국어 답변",
  "confidence": "HIGH",
  "insufficient_knowledge": false
}`;

export interface NanoParams {
  openai:     OpenAI;
  query:      string;         // 현재 질문 (raw — Nano 프롬프트 전달용, DB 저장 금지)
  role:       string;
  mode:       string;
  candidates: EvidenceItem[];
  recentMsgs: RecentMessage[];
  model:      string;         // AI_MODEL.SUPPORT
  timeoutMs:  number;
}

export interface NanoResult {
  output:       NanoOutput;
  inputTokens:  number | null;
  outputTokens: number | null;
  totalTokens:  number | null;
  error:        string | null;  // null = success
}

/**
 * §3 원칙: 1 logical request → 1 AI call.
 * candidates를 한 번에 해석·선별·정리.
 * candidates가 없으면 호출하지 않는다 (호출부에서 보장).
 */
export async function nanoResolve(params: NanoParams): Promise<NanoResult> {
  const { openai, query, role, mode, candidates, recentMsgs, model, timeoutMs } = params;

  // §6: Canonical source = support_knowledge_items
  // utterance/facets는 이미 retrieval에서 사용됨 — Nano에게는 KI content만 전달
  // WP-NANO-03: 토큰 예산 보호 — answer는 300자 이하로 제한 (fallback 20개 × 300 ≈ 6,000자)
  const candidateBlock = candidates
    .map((e, i) => `[KI-${i + 1}] id=${e.id}\n제목: ${e.title}\n내용: ${e.answer.slice(0, 300)}`)
    .join("\n\n---\n\n");

  // §7: 최근 2~3턴만 사용, 전체 history dump 금지
  const contextBlock = recentMsgs.length > 0
    ? recentMsgs.map((m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content}`).join("\n")
    : null;

  const userContent = contextBlock
    ? `[이전 대화 (최근 ${recentMsgs.length}턴)]\n${contextBlock}\n\n[현재 질문]\n${query}`
    : query;

  const systemContent = `${NANO_SYSTEM_BASE}

[사용자 역할] ${role}
[앱 모드] ${mode}

[SwimNote 근거 자료 — 이 목록 외 KI ID 사용 금지]
${candidateBlock}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const completion = await openai.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user",   content: userContent   },
        ],
        response_format: { type: "json_object" },
        temperature:     0.2,
        max_tokens:      512,
      },
      { signal: controller.signal }
    );
    clearTimeout(timer);

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }

    const output: NanoOutput = {
      selected_knowledge_ids: Array.isArray(parsed.selected_knowledge_ids)
        ? (parsed.selected_knowledge_ids as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      answer: typeof parsed.answer === "string" && parsed.answer.trim()
        ? parsed.answer.trim()
        : "답변을 완료하지 못했습니다. 상담사 연결을 추천드립니다.",
      confidence: (["HIGH", "MEDIUM", "LOW"] as const).includes(parsed.confidence)
        ? parsed.confidence as "HIGH" | "MEDIUM" | "LOW"
        : "LOW",
      insufficient_knowledge: parsed.insufficient_knowledge === true,
    };

    return {
      output,
      inputTokens:  completion.usage?.prompt_tokens     ?? null,
      outputTokens: completion.usage?.completion_tokens ?? null,
      totalTokens:  completion.usage?.total_tokens      ?? null,
      error:        null,
    };
  } catch (e: any) {
    clearTimeout(timer);
    const isTimeout =
      controller.signal.aborted ||
      e?.name === "AbortError" ||
      String(e?.message ?? "").toLowerCase().includes("aborted");

    return {
      output: {
        selected_knowledge_ids: [],
        answer:                 "일시적인 오류로 자동 답변을 완료하지 못했습니다. 담당자에게 직접 문의하시려면 [직접 문의하기] 버튼을 이용해 주세요.",
        confidence:             "LOW",
        insufficient_knowledge: true,
      },
      inputTokens:  null,
      outputTokens: null,
      totalTokens:  null,
      error:        isTimeout ? "TIMEOUT" : "LLM_ERROR",
    };
  }
}

// ── Server Validator ──────────────────────────────────────────────────────────

export interface ValidationResult {
  ok:     boolean;
  reason: string | null;
}

/**
 * §10 서버 validator:
 *   1. answer가 비어 있지 않은지
 *   2. selected KI ID가 candidate 목록 안에 존재하는지 (candidate 밖 ID 금지)
 *   3. insufficient=true + selected_ids 비어있지 않으면 모순 → selected_ids 비움
 */
export function validateNanoOutput(
  output:       NanoOutput,
  candidateIds: Set<string>
): ValidationResult {
  // 1. answer must be present
  if (!output.answer.trim()) {
    return { ok: false, reason: "EMPTY_ANSWER" };
  }

  // 2. selected IDs must be within candidate set
  const invalidIds = output.selected_knowledge_ids.filter(
    (id) => !candidateIds.has(id)
  );
  if (invalidIds.length > 0) {
    // Strip invalid IDs and flag; do not accept fabricated IDs
    output.selected_knowledge_ids = output.selected_knowledge_ids.filter(
      (id) => candidateIds.has(id)
    );
    // If all were invalid → treat as insufficient
    if (output.selected_knowledge_ids.length === 0) {
      output.insufficient_knowledge = true;
    }
    return { ok: false, reason: `INVALID_KI_IDS:${invalidIds.join(",")}` };
  }

  // 3. insufficient=true + selected_ids non-empty → contradiction → clear IDs
  if (output.insufficient_knowledge && output.selected_knowledge_ids.length > 0) {
    output.selected_knowledge_ids = [];
  }

  return { ok: true, reason: null };
}
