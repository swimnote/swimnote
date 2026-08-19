/**
 * support-candidate-engine.ts — WP-CS24: Candidate Engine
 *
 * 역할:
 *   1. classifyQuery()       — DYNAMIC / POLICY / AMBIGUOUS / NORMAL 분류
 *   2. evaluateForCandidacy() — Query Log 항목 → Candidate 생성/업데이트
 *   3. groupCandidate()      — 기존 Candidate에 occurrence_count 증가 or 신규 생성
 *
 * 안전 원칙:
 *   - AUTO_ACTIVATE = 절대 금지 (status: PENDING 고정)
 *   - DYNAMIC / POLICY 질문 → static candidate 생성 금지
 *   - normalized_query 저장 (raw message 금지)
 *   - PII (학생명/전화/이메일) candidate canonical에 복사 금지
 *
 * 호출 방식:
 *   - fire-and-forget (await 금지) — HTTP response latency 영향 없게
 *   - 오류 무시 (best-effort)
 */

import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizeQuery, tokenize, stemKorean } from "./support-resolver.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CandidateClassification =
  | "NORMAL"
  | "DYNAMIC_DATA_REQUIRED"
  | "POLICY_REQUIRED"
  | "AMBIGUOUS"
  | "HUMAN_JUDGMENT_REQUIRED";

export type CandidateType = "UTTERANCE_EXTENSION" | "NEW_CANONICAL";
export type CandidateSourceType = "NO_MATCH" | "GPT_FALLBACK" | "HUMAN" | "ADMIN_CREATED";
export type CandidateStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED";

export interface QueryLogEntry {
  caseId:            string;
  normalizedQuery:   string;
  representativeQuery: string;
  resolutionSource:  string;
  matchedKnowledgeId?: string | null;
  matchConfidence?:  number | null;
  llmCalled:         boolean;
  humanRequested:    boolean;
  finalCaseState:    string;
  role:              string;
  mode:              string;
  poolId:            string | null;
}

// ── Dynamic query patterns (사용자 개인 데이터 조회 → Static Knowledge 불가) ──

const DYNAMIC_PATTERNS: RegExp[] = [
  /오늘.{0,5}출석/,
  /내.{0,5}보강/,
  /내.{0,5}결제/,
  /내.{0,5}문의/,
  /내.{0,5}승인/,
  /내.{0,5}엔타이틀/,
  /내.{0,5}구독.{0,5}상태/,
  /내.{0,5}x.{0,5}모드/,
  /내.{0,5}신청/,
  /특정.{0,5}회원/,
  /아이.{0,5}오늘/,
  /오늘.{0,5}수업.{0,5}있어/,
  /내.{0,5}처리.{0,5}상태/,
];

// ── Policy category keywords (공식 정책 Source 없으면 Approve 불가) ────────────

const POLICY_PATTERNS: RegExp[] = [
  /환불.{0,10}(얼마|받|신청|처리|되)/,
  /환불$/,
  /^환불/,
  /refund/i,
  /할인.{0,5}(얼마|되|받)/,
  /취소.{0,5}정책/,
  /계약.{0,5}조건/,
  /개인정보.{0,5}(처리|보관|삭제)/,
  /데이터.{0,5}보관/,
  /sla/i,
  /구독.{0,5}가격.{0,5}얼마/,
  /월.{0,3}(요금|비용|가격).{0,5}얼마/,
  /이용료.{0,5}얼마/,
];

// ── Ambiguous single-concept queries (여러 Intent로 갈 수 있음) ───────────────

const AMBIGUOUS_EXACT_SET = new Set([
  "가격", "사진", "보강", "결제", "안돼요", "알림", "수업", "문의",
  "오류", "error", "사진", "앨범", "문제", "도움", "도움말",
  "확인", "안됨", "실패", "오류남", "오류발생",
]);

// ── Classification ─────────────────────────────────────────────────────────────

export function classifyQuery(normalizedQuery: string): CandidateClassification {
  const q = normalizedQuery.trim();

  // 1. Dynamic: 사용자 개인 데이터 조회
  for (const p of DYNAMIC_PATTERNS) {
    if (p.test(q)) return "DYNAMIC_DATA_REQUIRED";
  }

  // 2. Policy: 정책/가격 정보 (공식 Source 없이 Candidate 승인 불가)
  for (const p of POLICY_PATTERNS) {
    if (p.test(q)) return "POLICY_REQUIRED";
  }

  // 3. Ambiguous: 단독 단어, 여러 Intent 가능
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && (q.length <= 4 || AMBIGUOUS_EXACT_SET.has(q))) {
    return "AMBIGUOUS";
  }

  return "NORMAL";
}

// ── Grouping: 기존 Candidate와 동일 의미인지 확인 ─────────────────────────────

/**
 * 같은 의미 Candidate 찾기.
 * 1순위: normalized_query exact match
 * 2순위: stemmed token overlap ≥ 80%
 */
async function findExistingCandidate(
  normalizedQuery: string
): Promise<{ id: string; occurrence_count: number; gpt_fallback_count: number; human_request_count: number; source_refs: string[] } | null> {
  // 1순위: exact normalized_query
  const exactResult = await superAdminDb.execute(sql`
    SELECT id, occurrence_count, gpt_fallback_count, human_request_count, source_refs
    FROM support_knowledge_candidates
    WHERE normalized_query = ${normalizedQuery}
      AND status = 'PENDING'
    LIMIT 1
  `) as any;

  if (exactResult.rows?.length > 0) {
    const r = exactResult.rows[0];
    return {
      id: r.id,
      occurrence_count: Number(r.occurrence_count),
      gpt_fallback_count: Number(r.gpt_fallback_count),
      human_request_count: Number(r.human_request_count),
      source_refs: Array.isArray(r.source_refs) ? r.source_refs : JSON.parse(r.source_refs ?? '[]'),
    };
  }

  // 2순위: stemmed token overlap ≥ 80%
  const qStems = tokenize(normalizedQuery).map(stemKorean).filter(s => s.length >= 2);
  if (qStems.length < 2) return null;

  // 최근 PENDING candidate 최대 200개 후보
  const candidateRows = await superAdminDb.execute(sql`
    SELECT id, normalized_query, occurrence_count, gpt_fallback_count,
           human_request_count, source_refs
    FROM support_knowledge_candidates
    WHERE status = 'PENDING'
    ORDER BY created_at DESC
    LIMIT 200
  `) as any;

  for (const row of (candidateRows.rows ?? [])) {
    const cStems = tokenize(String(row.normalized_query)).map(stemKorean).filter((s: string) => s.length >= 2);
    if (cStems.length === 0) continue;

    const qInC = qStems.filter(s => cStems.includes(s)).length;
    const cInQ = cStems.filter((s: string) => qStems.includes(s)).length;

    const overlapRatio = Math.min(
      qInC / qStems.length,
      cInQ / cStems.length
    );

    if (overlapRatio >= 0.8) {
      return {
        id: row.id,
        occurrence_count: Number(row.occurrence_count),
        gpt_fallback_count: Number(row.gpt_fallback_count),
        human_request_count: Number(row.human_request_count),
        source_refs: Array.isArray(row.source_refs) ? row.source_refs : JSON.parse(row.source_refs ?? '[]'),
      };
    }
  }

  return null;
}

// ── Candidate Type 결정 ────────────────────────────────────────────────────────

/**
 * 기존 Intent에 가까운 질문인지 확인 → UTTERANCE_EXTENSION vs NEW_CANONICAL
 */
async function detectCandidateType(normalizedQuery: string): Promise<{
  type: CandidateType;
  suggestedKnowledgeId: string | null;
  suggestedIntentId: string | null;
}> {
  // matchDirectAnswer의 fuzzy match와 유사 — 기존 intent 후보 확인
  const qStems = tokenize(normalizedQuery).map(stemKorean).filter(s => s.length >= 2);
  if (qStems.length === 0) {
    return { type: "NEW_CANONICAL", suggestedKnowledgeId: null, suggestedIntentId: null };
  }

  const likeClause = qStems.slice(0, 3)
    .map(s => `u.normalized_utterance ILIKE '%${s.replace(/'/g, "''")}%'`)
    .join(" OR ");

  const rows = await superAdminDb.execute(sql.raw(`
    SELECT u.knowledge_id, u.intent_id, ki.affected_roles, ki.affected_modes
    FROM support_intent_utterances u
    JOIN support_knowledge_items ki ON ki.id = u.knowledge_id
    WHERE u.status = 'active' AND ki.status = 'active'
      AND (${likeClause})
    ORDER BY u.weight DESC
    LIMIT 10
  `)) as any;

  if (!rows.rows?.length) {
    return { type: "NEW_CANONICAL", suggestedKnowledgeId: null, suggestedIntentId: null };
  }

  // 가장 많이 매칭된 knowledge_id 선택
  const first = rows.rows[0];
  return {
    type: "UTTERANCE_EXTENSION",
    suggestedKnowledgeId: first.knowledge_id ?? null,
    suggestedIntentId: first.intent_id ?? null,
  };
}

// ── ID generator ─────────────────────────────────────────────────────────────

function genCandId(): string {
  return `cand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Main entry: evaluateForCandidacy ─────────────────────────────────────────

/**
 * Resolution 결과를 분석해 Candidate를 생성/업데이트.
 *
 * 조건: resolution_source가 NO_MATCH 또는 GPT_FALLBACK (DIRECT_DB/FRONTEND_MAP 제외).
 * fire-and-forget으로 호출 — 오류 무시.
 */
export async function evaluateForCandidacy(entry: QueryLogEntry): Promise<void> {
  try {
    // 후보화 대상이 아닌 경우 skip
    const source = entry.resolutionSource;
    const shouldEvaluate =
      source === "LLM" ||
      source === "NO_MATCH" ||
      (source === "LLM" && entry.finalCaseState === "HUMAN_REQUIRED");

    if (!shouldEvaluate) return;

    // 빈 query 조기 차단 (normalizeQuery 호출 전)
    const rawQ = (entry.normalizedQuery ?? "").trim();
    if (!rawQ || rawQ.length < 2) return;

    const normalizedQ = normalizeQuery(rawQ);
    if (!normalizedQ || normalizedQ.length < 2) return;

    // 1. 분류
    const classification = classifyQuery(normalizedQ);

    // DYNAMIC, POLICY, AMBIGUOUS는 일반 후보 생성 금지
    // AMBIGUOUS는 candidate 자체를 기록하되 status/type만 특수 처리
    if (classification === "DYNAMIC_DATA_REQUIRED" || classification === "POLICY_REQUIRED") {
      // DYNAMIC/POLICY는 static candidate 생성 금지 (spec §8, §9, §10)
      // 단, 분류 기록만 남기기 위해 특수 candidate 생성 (PENDING/classification)
      // 실제 구현: DYNAMIC/POLICY candidate는 생성하되 approve 불가 처리
    }

    // 2. 기존 candidate 그룹핑
    const existing = await findExistingCandidate(normalizedQ);

    if (existing) {
      // occurrence_count 증가
      const newRefs = [...existing.source_refs, entry.caseId].slice(-10); // 최대 10개
      await superAdminDb.execute(sql`
        UPDATE support_knowledge_candidates
        SET occurrence_count     = ${existing.occurrence_count + 1},
            gpt_fallback_count   = ${existing.gpt_fallback_count + (entry.llmCalled ? 1 : 0)},
            human_request_count  = ${existing.human_request_count + (entry.humanRequested ? 1 : 0)},
            last_seen_at         = NOW(),
            source_refs          = ${JSON.stringify(newRefs)}::jsonb,
            updated_at           = NOW()
        WHERE id = ${existing.id}
      `);
      return;
    }

    // 3. 신규 candidate 생성
    // DYNAMIC/POLICY는 Candidate 생성 금지 (Static Knowledge 불가)
    if (classification === "DYNAMIC_DATA_REQUIRED" || classification === "POLICY_REQUIRED") {
      return; // 생성 금지
    }

    const { type, suggestedKnowledgeId, suggestedIntentId } = await detectCandidateType(normalizedQ);

    const sourceType: CandidateSourceType =
      entry.humanRequested ? "HUMAN"
        : entry.llmCalled   ? "GPT_FALLBACK"
        : "NO_MATCH";

    const risk: "LOW" | "MEDIUM" | "HIGH" = classification === "AMBIGUOUS" ? "MEDIUM" : "LOW";

    const candidateId = genCandId();
    await superAdminDb.execute(sql`
      INSERT INTO support_knowledge_candidates (
        id, candidate_type, classification, source_type,
        representative_query, normalized_query,
        suggested_intent_id, suggested_knowledge_id,
        occurrence_count, gpt_fallback_count, human_request_count,
        first_seen_at, last_seen_at,
        affected_roles, affected_modes, pool_scope, pool_id,
        risk, status, source_refs
      ) VALUES (
        ${candidateId},
        ${type},
        ${classification},
        ${sourceType},
        ${entry.representativeQuery.substring(0, 500)},
        ${normalizedQ},
        ${suggestedIntentId},
        ${suggestedKnowledgeId},
        1,
        ${entry.llmCalled ? 1 : 0},
        ${entry.humanRequested ? 1 : 0},
        NOW(), NOW(),
        ${JSON.stringify([entry.role])}::jsonb,
        ${JSON.stringify([entry.mode])}::jsonb,
        'global',
        NULL,
        ${risk},
        'PENDING',
        ${JSON.stringify([entry.caseId])}::jsonb
      )
      ON CONFLICT DO NOTHING
    `);
  } catch (err) {
    // best-effort — never throws
    console.error("[candidate-engine] evaluateForCandidacy 오류 (무시):", (err as Error).message?.substring(0, 100));
  }
}

// ── Log query to support_query_log ────────────────────────────────────────────

function genLogId(): string {
  return `sql_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function logSupportQuery(entry: QueryLogEntry): Promise<void> {
  try {
    const id = genLogId();
    await superAdminDb.execute(sql`
      INSERT INTO support_query_log (
        id, case_id, role, mode, pool_id,
        normalized_query,
        resolution_source, matched_knowledge_id, match_confidence,
        llm_called, human_requested, final_case_state
      ) VALUES (
        ${id}, ${entry.caseId}, ${entry.role}, ${entry.mode}, ${entry.poolId},
        ${normalizeQuery(entry.normalizedQuery)},
        ${entry.resolutionSource},
        ${entry.matchedKnowledgeId ?? null},
        ${entry.matchConfidence ?? null},
        ${entry.llmCalled},
        ${entry.humanRequested},
        ${entry.finalCaseState}
      )
    `);
  } catch (err) {
    // best-effort — never throws
  }
}

// ── Metrics query ─────────────────────────────────────────────────────────────

export interface LearningMetrics {
  support_queries_total: number;
  direct_db_total: number;
  direct_db_rate: number;
  deterministic_total: number;
  gpt_fallback_total: number;
  gpt_fallback_rate: number;
  human_request_total: number;
  human_request_rate: number;
  no_match_total: number;
  ambiguous_total: number;
  candidates_created: number;
  utterance_extension_candidates: number;
  new_canonical_candidates: number;
  dynamic_data_candidates: number;
  policy_required_candidates: number;
  candidates_approved: number;
  candidates_rejected: number;
  candidates_merged: number;
  utterances_added: number;
  canonicals_added: number;
}

export async function getLearningMetrics(): Promise<LearningMetrics> {
  const [logStats, candidateStats, utteranceStats, canonicalStats] = await Promise.all([
    superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE resolution_source = 'DIRECT_DB')::int AS direct_db,
        COUNT(*) FILTER (WHERE resolution_source = 'LLM')::int AS gpt_fallback,
        COUNT(*) FILTER (WHERE human_requested = true)::int AS human_req,
        COUNT(*) FILTER (WHERE resolution_source = 'NO_MATCH')::int AS no_match,
        COUNT(*) FILTER (WHERE resolution_source = 'AMBIGUOUS')::int AS ambiguous
      FROM support_query_log
    `),
    superAdminDb.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE candidate_type = 'UTTERANCE_EXTENSION')::int AS utterance_ext,
        COUNT(*) FILTER (WHERE candidate_type = 'NEW_CANONICAL')::int AS new_canonical,
        COUNT(*) FILTER (WHERE classification = 'DYNAMIC_DATA_REQUIRED')::int AS dynamic,
        COUNT(*) FILTER (WHERE classification = 'POLICY_REQUIRED')::int AS policy,
        COUNT(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
        COUNT(*) FILTER (WHERE status = 'MERGED')::int AS merged
      FROM support_knowledge_candidates
    `),
    // utterances added via CS24 promotion (created_at after today, source_candidate not null)
    superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM support_intent_utterances
      WHERE id LIKE 'promo_%'
    `),
    superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM support_knowledge_items
      WHERE id LIKE 'ki_promo_%'
    `),
  ]) as any[];

  const log = logStats.rows?.[0] ?? {};
  const cand = candidateStats.rows?.[0] ?? {};
  const utt = utteranceStats.rows?.[0] ?? {};
  const can = canonicalStats.rows?.[0] ?? {};

  const total = Number(log.total ?? 0);
  const directDb = Number(log.direct_db ?? 0);
  const gptFallback = Number(log.gpt_fallback ?? 0);
  const humanReq = Number(log.human_req ?? 0);

  return {
    support_queries_total:           total,
    direct_db_total:                  directDb,
    direct_db_rate:                   total > 0 ? Math.round((directDb / total) * 10000) / 100 : 0,
    deterministic_total:              0, // FRONTEND_MAP 포함 별도 집계
    gpt_fallback_total:               gptFallback,
    gpt_fallback_rate:                total > 0 ? Math.round((gptFallback / total) * 10000) / 100 : 0,
    human_request_total:              humanReq,
    human_request_rate:               total > 0 ? Math.round((humanReq / total) * 10000) / 100 : 0,
    no_match_total:                   Number(log.no_match ?? 0),
    ambiguous_total:                  Number(log.ambiguous ?? 0),
    candidates_created:               Number(cand.total ?? 0),
    utterance_extension_candidates:   Number(cand.utterance_ext ?? 0),
    new_canonical_candidates:         Number(cand.new_canonical ?? 0),
    dynamic_data_candidates:          Number(cand.dynamic ?? 0),
    policy_required_candidates:       Number(cand.policy ?? 0),
    candidates_approved:              Number(cand.approved ?? 0),
    candidates_rejected:              Number(cand.rejected ?? 0),
    candidates_merged:                Number(cand.merged ?? 0),
    utterances_added:                 Number(utt.cnt ?? 0),
    canonicals_added:                 Number(can.cnt ?? 0),
  };
}

// ── Promote: UTTERANCE_EXTENSION ─────────────────────────────────────────────

/**
 * UTTERANCE_EXTENSION 승인 → support_intent_utterances INSERT
 *
 * 안전장치:
 *   - candidate classification이 DYNAMIC/POLICY → 거부
 *   - knowledge_id의 affected_roles/modes 상속 (확대 금지)
 */
export async function promoteUtteranceExtension(params: {
  candidateId:  string;
  knowledgeId:  string;
  utterance:    string;
  approvedBy:   string;
}): Promise<{ ok: boolean; error?: string; utteranceId?: string }> {
  const { candidateId, knowledgeId, utterance, approvedBy } = params;

  // 1. Candidate 조회
  const candResult = await superAdminDb.execute(sql`
    SELECT id, classification, candidate_type, normalized_query, status
    FROM support_knowledge_candidates WHERE id = ${candidateId}
  `) as any;
  const cand = candResult.rows?.[0];
  if (!cand) return { ok: false, error: "CANDIDATE_NOT_FOUND" };
  if (cand.status !== "PENDING") return { ok: false, error: "CANDIDATE_NOT_PENDING" };
  if (cand.classification === "DYNAMIC_DATA_REQUIRED") return { ok: false, error: "DYNAMIC_DATA_APPROVE_BLOCKED" };
  if (cand.classification === "POLICY_REQUIRED") return { ok: false, error: "POLICY_APPROVE_BLOCKED" };

  // 2. Knowledge 조회 (role/mode 상속)
  const kiResult = await superAdminDb.execute(sql`
    SELECT id, intent_id, affected_roles, affected_modes, scope, pool_id, status
    FROM support_knowledge_items WHERE id = ${knowledgeId}
  `) as any;
  const ki = kiResult.rows?.[0];
  if (!ki) return { ok: false, error: "KNOWLEDGE_NOT_FOUND" };
  if (ki.status !== "active") return { ok: false, error: "KNOWLEDGE_NOT_ACTIVE" };

  // 3. utterance 삽입 (roles/modes 상속)
  const utteranceId = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const normalizedUtterance = normalizeQuery(utterance);
  const intentId = ki.intent_id ?? knowledgeId;

  await superAdminDb.execute(sql`
    INSERT INTO support_intent_utterances
      (id, intent_id, knowledge_id, utterance, normalized_utterance, weight, status)
    VALUES
      (${utteranceId}, ${intentId}, ${knowledgeId},
       ${utterance.substring(0, 500)}, ${normalizedUtterance}, 100, 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  // 4. Candidate 상태 → MERGED
  await superAdminDb.execute(sql`
    UPDATE support_knowledge_candidates
    SET status      = 'MERGED',
        approved_by = ${approvedBy},
        approved_at = NOW(),
        updated_at  = NOW()
    WHERE id = ${candidateId}
  `);

  return { ok: true, utteranceId };
}

// ── Promote: NEW_CANONICAL ────────────────────────────────────────────────────

/**
 * NEW_CANONICAL 승인 → support_knowledge_items INSERT (status=pending)
 * CS16 governance 절차를 통해 활성화 필요 — 여기서는 pending 생성만.
 */
export async function promoteNewCanonical(params: {
  candidateId:  string;
  itemType:     string;
  scope:        string;
  answer:       string;
  question:     string;
  title:        string;
  roles:        string[];
  modes:        string[];
  approvedBy:   string;
}): Promise<{ ok: boolean; error?: string; knowledgeId?: string }> {
  const { candidateId, itemType, scope, answer, question, title, roles, modes, approvedBy } = params;

  // 1. Candidate 조회
  const candResult = await superAdminDb.execute(sql`
    SELECT id, classification, candidate_type, status
    FROM support_knowledge_candidates WHERE id = ${candidateId}
  `) as any;
  const cand = candResult.rows?.[0];
  if (!cand) return { ok: false, error: "CANDIDATE_NOT_FOUND" };
  if (cand.status !== "PENDING") return { ok: false, error: "CANDIDATE_NOT_PENDING" };
  if (cand.classification === "DYNAMIC_DATA_REQUIRED") return { ok: false, error: "DYNAMIC_DATA_APPROVE_BLOCKED" };
  if (cand.classification === "POLICY_REQUIRED") return { ok: false, error: "POLICY_APPROVE_BLOCKED" };

  // 2. PII 간단 검사: 한국어 이름 패턴
  //    - [가-힣]{2,3}씨/님/선생님: "김민수씨", "홍길동님" 등
  //    - [가-힣]{2,3} + 공백 + 학생: "김민수 학생" 등 (이름+학생 패턴)
  //    범용 단어 "학부모", "연결된", "수업" 등은 씨/님/선생님 suffix가 없으므로 제외됨
  const PII_NAME_SUFFIX = /[가-힣]{2,3}(?:씨|님|선생님)/;
  const PII_NAME_STUDENT = /[가-힣]{2,3} 학생/; // "김민수 학생" — 공백+학생 패턴
  if (PII_NAME_SUFFIX.test(answer) || PII_NAME_STUDENT.test(answer)) {
    return { ok: false, error: "PII_DETECTED_IN_ANSWER" };
  }

  // 3. knowledge_items INSERT (status=pending → CS16 governance 필요)
  const kiId = `ki_promo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  await superAdminDb.execute(sql`
    INSERT INTO support_knowledge_items (
      id, item_type, scope,
      title, content, question, answer,
      affected_roles, affected_modes,
      answer_mode, status, revision
    ) VALUES (
      ${kiId}, ${itemType}, ${scope},
      ${title.substring(0, 200)},
      ${answer.substring(0, 5000)},
      ${question.substring(0, 500)},
      ${answer.substring(0, 5000)},
      ${JSON.stringify(roles)}::jsonb,
      ${JSON.stringify(modes)}::jsonb,
      'DIRECT_DB', 'pending', 1
    )
  `);

  // 4. Candidate → APPROVED
  await superAdminDb.execute(sql`
    UPDATE support_knowledge_candidates
    SET status      = 'APPROVED',
        approved_by = ${approvedBy},
        approved_at = NOW(),
        updated_at  = NOW()
    WHERE id = ${candidateId}
  `);

  return { ok: true, knowledgeId: kiId };
}
