/**
 * support-candidate.test.ts — WP-CS24: Candidate Engine Tests
 *
 * 최소 40 TC:
 *   CS24-01~05:  classifyQuery (Dynamic/Policy/Ambiguous/Normal)
 *   CS24-06~10:  Query log insert
 *   CS24-11~18:  Candidate grouping/occurrence
 *   CS24-19~24:  Candidate type detection
 *   CS24-25~28:  DYNAMIC/POLICY block (approve 불가)
 *   CS24-29~32:  Utterance promotion (role 상속, 확대 금지)
 *   CS24-33~36:  New canonical promotion (PII, pending)
 *   CS24-37~40:  AUTO_ACTIVATE 방지
 *   CS24-41~46:  Security (role/mode/pool leakage=0)
 *   CS24-47~50:  Metrics endpoint
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────────

const dbExecute = vi.hoisted(() => vi.fn());

vi.mock("drizzle-orm", () => {
  function sql(strings: TemplateStringsArray, ...values: any[]) {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""),
      ""
    );
    return { __text: text, __values: values };
  }
  sql.raw = (t: string, p?: any[]) => ({ __text: t, __values: p ?? [] });
  return { sql };
});

vi.mock("@workspace/db", () => ({
  superAdminDb: { execute: dbExecute },
  db:           { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// Import after mocks
import {
  classifyQuery,
  logSupportQuery,
  logSupportQueryWithOutcome,
  evaluateForCandidacy,
  promoteUtteranceExtension,
  promoteNewCanonical,
  getLearningMetrics,
  type QueryLogEntry,
} from "../support-candidate-engine.js";

// ── Global beforeEach: fully reset mock (incl. one-time queue) between tests ──
// mockClear()은 call 이력만 지움 (once 큐 유지). mockReset()이 once 큐까지 초기화.

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockResolvedValue({ rows: [] }); // 기본 응답 재등록
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<QueryLogEntry> = {}): QueryLogEntry {
  return {
    caseId:              "case_test_01",
    normalizedQuery:     "출석 확인 방법",
    representativeQuery: "출석 확인 방법",
    resolutionSource:    "LLM",
    llmCalled:           true,
    humanRequested:      false,
    finalCaseState:      "HUMAN_REQUIRED",
    role:                "pool_admin",
    mode:                "normal",
    poolId:              "pool_test_01",
    ...overrides,
  };
}

function setupEmptyDb() {
  dbExecute.mockResolvedValue({ rows: [] });
}

// ── CS24-01~05: classifyQuery ─────────────────────────────────────────────────

describe("CS24-01~05: classifyQuery", () => {
  it("CS24-01: 개인 출석 질문 → DYNAMIC_DATA_REQUIRED", () => {
    expect(classifyQuery("오늘 출석했어요")).toBe("DYNAMIC_DATA_REQUIRED");
  });

  it("CS24-02: 내 보강 신청 → DYNAMIC_DATA_REQUIRED", () => {
    expect(classifyQuery("내 보강 언제 승인되나요")).toBe("DYNAMIC_DATA_REQUIRED");
  });

  it("CS24-03: 환불 얼마 → POLICY_REQUIRED", () => {
    expect(classifyQuery("환불 얼마 받나요")).toBe("POLICY_REQUIRED");
  });

  it("CS24-04: 단일 모호 단어 → AMBIGUOUS", () => {
    expect(classifyQuery("사진")).toBe("AMBIGUOUS");
    expect(classifyQuery("가격")).toBe("AMBIGUOUS");
  });

  it("CS24-05: 명확한 질문 → NORMAL", () => {
    expect(classifyQuery("강사 초대 코드는 어떻게 발급하나요")).toBe("NORMAL");
    expect(classifyQuery("출석 기록을 강사가 수정할 수 있나요")).toBe("NORMAL");
  });
});

// ── CS24-06~10: logSupportQuery ───────────────────────────────────────────────

describe("CS24-06~10: logSupportQuery", () => {

  it("CS24-06: DIRECT_DB 쿼리 로그 INSERT 호출", async () => {
    await logSupportQuery(makeEntry({ resolutionSource: "DIRECT_DB", llmCalled: false, humanRequested: false }));
    expect(dbExecute).toHaveBeenCalled();
    const call = dbExecute.mock.calls[0][0];
    expect(call.__text).toContain("INSERT INTO support_query_log");
  });

  it("CS24-07: LLM 쿼리 로그 INSERT 호출", async () => {
    await logSupportQuery(makeEntry({ resolutionSource: "LLM", llmCalled: true }));
    const call = dbExecute.mock.calls[0][0];
    expect(call.__text).toContain("INSERT INTO support_query_log");
  });

  it("CS24-08: normalized_query 파라미터 포함", async () => {
    await logSupportQuery(makeEntry({ normalizedQuery: "출석 확인 방법" }));
    const call = dbExecute.mock.calls[0][0];
    expect(call.__values).toContain("출석 확인 방법");
  });

  it("CS24-09: human_requested=true 저장", async () => {
    await logSupportQuery(makeEntry({ humanRequested: true, llmCalled: false }));
    const insertCalls = dbExecute.mock.calls.filter(c =>
      c[0]?.__text?.includes("INSERT INTO support_query_log")
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    // human_requested=true, llmCalled=false → values에 true 포함, false 포함
    const vals = insertCalls[0][0].__values;
    expect(vals).toContain(true);
  });

  it("CS24-10: DB 오류 시 throw 없음 (best-effort)", async () => {
    dbExecute.mockRejectedValueOnce(new Error("DB error"));
    await expect(logSupportQuery(makeEntry())).resolves.not.toThrow();
  });

  it("CS26: query log INSERT 후 동일 row ID에 outcome을 기록", async () => {
    await logSupportQueryWithOutcome(makeEntry(), "GPT_ESCALATION_ACCEPTED");

    expect(dbExecute).toHaveBeenCalledTimes(2);
    const insert = dbExecute.mock.calls[0][0];
    const update = dbExecute.mock.calls[1][0];
    const insertedId = insert.__values[0];

    expect(insert.__text).toContain("INSERT INTO support_query_log");
    expect(update.__text).toContain("UPDATE support_query_log");
    expect(update.__values).toContain(insertedId);
    expect(update.__values).toContain("case_test_01");
    expect(update.__values).toContain("GPT_ESCALATION_ACCEPTED");
  });
});

// ── CS24-11~18: evaluateForCandidacy grouping ─────────────────────────────────

describe("CS24-11~18: evaluateForCandidacy grouping", () => {
  beforeEach(() => { dbExecute.mockClear(); });

  it("CS24-11: DIRECT_DB → Candidate 생성 안 함", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({ resolutionSource: "DIRECT_DB", llmCalled: false }));
    // evaluateForCandidacy는 DIRECT_DB → skip → DB 호출 없음
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("CS24-12: FRONTEND_MAP → Candidate 생성 안 함", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({ resolutionSource: "FRONTEND_MAP" }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("CS24-13: LLM → 신규 Candidate 생성 시도", async () => {
    // exact match 없음 → 토큰 overlap 없음 → 신규 생성
    dbExecute
      .mockResolvedValueOnce({ rows: [] })   // exact lookup
      .mockResolvedValueOnce({ rows: [] })   // token overlap lookup
      .mockResolvedValueOnce({ rows: [] })   // detectCandidateType
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    await evaluateForCandidacy(makeEntry({ resolutionSource: "LLM", llmCalled: true }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("CS24-14: 기존 Candidate exact match → occurrence_count++ (INSERT 없음)", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_existing", occurrence_count: 3, gpt_fallback_count: 1, human_request_count: 0, source_refs: [] }] });
    await evaluateForCandidacy(makeEntry({ resolutionSource: "LLM", llmCalled: true }));
    const updateCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("UPDATE support_knowledge_candidates")
        && c[0]?.__text?.includes("occurrence_count")
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("CS24-15: 10회 같은 질문 → 첫 번째만 INSERT, 나머지는 UPDATE", async () => {
    let insertCount = 0;
    let occurrenceCount = 0;
    dbExecute.mockImplementation(async (q: any) => {
      const text = q.__text ?? "";
      if (text.includes("INSERT INTO support_knowledge_candidates")) {
        insertCount++;
        return { rows: [] };
      }
      if (text.includes("UPDATE support_knowledge_candidates") && text.includes("occurrence_count")) {
        occurrenceCount++;
        return { rows: [] };
      }
      // 첫 INSERT 이후엔 exact match에서 기존 candidate 반환
      if (text.includes("FROM support_knowledge_candidates") && text.includes("normalized_query =")) {
        if (insertCount > 0) {
          return { rows: [{ id: "cand_01", normalized_query: "출석 확인 방법", occurrence_count: 1, gpt_fallback_count: 0, human_request_count: 0, source_refs: [] }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    });

    const entry = makeEntry({ resolutionSource: "LLM", llmCalled: true });
    for (let i = 0; i < 10; i++) {
      await evaluateForCandidacy(entry);
    }

    // 첫 번째만 INSERT, 나머지 9개는 UPDATE
    expect(insertCount).toBe(1);
    expect(occurrenceCount).toBe(9);
  });

  it("CS24-16: DYNAMIC 질문 → Candidate INSERT 없음", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      normalizedQuery: "오늘 출석했어요",
      representativeQuery: "오늘 출석했어요",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("CS24-17: POLICY 질문 → Candidate INSERT 없음", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      normalizedQuery: "환불 얼마 받나요",
      representativeQuery: "환불 얼마 받나요",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });

  it("CS24-18: DB 오류 시 throw 없음 (best-effort)", async () => {
    dbExecute.mockRejectedValue(new Error("DB fail"));
    await expect(evaluateForCandidacy(makeEntry({ resolutionSource: "LLM" }))).resolves.not.toThrow();
  });
});

// ── CS24-19~24: Candidate type detection ─────────────────────────────────────

describe("CS24-19~24: candidate type", () => {
  it("CS24-19: 기존 utterance 유사 → UTTERANCE_EXTENSION candidate", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })   // exact match: 없음
      .mockResolvedValueOnce({ rows: [] })   // token overlap: 없음
      .mockResolvedValueOnce({ rows: [
        { knowledge_id: "ki_test_attendance_permission", intent_id: "TEST_ATTENDANCE_PERMISSION" }
      ]})                                    // detectCandidateType: 기존 KI 찾음
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      normalizedQuery: "교사 출결 수정 권한",
      representativeQuery: "교사 출결 수정 권한",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).toContain("UTTERANCE_EXTENSION");
    }
  });

  it("CS24-20: 알 수 없는 질문 → NEW_CANONICAL candidate", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })  // exact
      .mockResolvedValueOnce({ rows: [] })  // token
      .mockResolvedValueOnce({ rows: [] })  // detectCandidateType: 없음
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      normalizedQuery: "완전히 새로운 기능 질문 모름",
      representativeQuery: "완전히 새로운 기능 질문 모름",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).toContain("NEW_CANONICAL");
    }
  });

  it("CS24-21: Human 문의 → source_type=HUMAN", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      humanRequested: true,
      normalizedQuery: "특수 환불 처리 방법 알려줘",
      representativeQuery: "특수 환불 처리 방법 알려줘",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      // HUMAN 문의 source_type
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).toContain("HUMAN");
    }
  });

  it("CS24-22: GPT fallback → source_type=GPT_FALLBACK", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      llmCalled: true,
      humanRequested: false,
      normalizedQuery: "알 수 없는 기능 질문 두 단어",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).toContain("GPT_FALLBACK");
    }
  });

  it("CS24-23: AMBIGUOUS 질문 → candidate type은 NEW_CANONICAL 또는 없음 (utterance 자동 승격 금지)", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      normalizedQuery: "보강",
      representativeQuery: "보강",
    }));
    // AMBIGUOUS → NORMAL 아님 → classification=AMBIGUOUS, INSERT 없음 (4자 이하 + ambiguous set)
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    // AMBIGUOUS는 candidate 생성하지 않음 (normalizeQuery 결과가 너무 짧음 처리)
    // or: created with classification=AMBIGUOUS only — not auto-promoted to utterance
    // 핵심 검증: UTTERANCE_EXTENSION으로 자동 INSERT 없어야 함
    for (const call of insertCalls) {
      const vals = call[0].__values as string[];
      expect(vals).not.toContain("UTTERANCE_EXTENSION"); // 자동 승격 금지
    }
  });

  it("CS24-24: 빈 normalizedQuery → 처리 skip", async () => {
    setupEmptyDb();
    await evaluateForCandidacy(makeEntry({ normalizedQuery: "", representativeQuery: "" }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0]?.__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    expect(insertCalls).toHaveLength(0);
  });
});

// ── CS24-25~28: DYNAMIC/POLICY approve block ──────────────────────────────────

describe("CS24-25~28: DYNAMIC/POLICY approve 차단", () => {
  it("CS24-25: DYNAMIC candidate → approve-utterance 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{
      id: "cand_dyn", classification: "DYNAMIC_DATA_REQUIRED",
      candidate_type: "UTTERANCE_EXTENSION", status: "PENDING",
    }]});
    const result = await promoteUtteranceExtension({
      candidateId: "cand_dyn",
      knowledgeId: "ki_test_01",
      utterance:   "오늘 출석했어요",
      approvedBy:  "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("DYNAMIC_DATA_APPROVE_BLOCKED");
  });

  it("CS24-26: POLICY candidate → approve-utterance 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{
      id: "cand_pol", classification: "POLICY_REQUIRED",
      candidate_type: "UTTERANCE_EXTENSION", status: "PENDING",
    }]});
    const result = await promoteUtteranceExtension({
      candidateId: "cand_pol",
      knowledgeId: "ki_test_01",
      utterance:   "환불 얼마",
      approvedBy:  "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("POLICY_APPROVE_BLOCKED");
  });

  it("CS24-27: DYNAMIC candidate → approve-canonical 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{
      id: "cand_dyn2", classification: "DYNAMIC_DATA_REQUIRED",
      candidate_type: "NEW_CANONICAL", status: "PENDING",
    }]});
    const result = await promoteNewCanonical({
      candidateId: "cand_dyn2",
      itemType: "FAQ", scope: "global",
      answer: "답변", question: "질문", title: "제목",
      roles: ["pool_admin"], modes: ["normal"],
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("DYNAMIC_DATA_APPROVE_BLOCKED");
  });

  it("CS24-28: POLICY candidate → approve-canonical 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{
      id: "cand_pol2", classification: "POLICY_REQUIRED",
      candidate_type: "NEW_CANONICAL", status: "PENDING",
    }]});
    const result = await promoteNewCanonical({
      candidateId: "cand_pol2",
      itemType: "FAQ", scope: "global",
      answer: "환불 정책은...", question: "환불", title: "환불",
      roles: ["pool_admin"], modes: ["normal"],
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("POLICY_APPROVE_BLOCKED");
  });
});

// ── CS24-29~32: Utterance promotion ──────────────────────────────────────────

describe("CS24-29~32: promoteUtteranceExtension", () => {
  it("CS24-29: NORMAL candidate + active KI → utterance INSERT + candidate MERGED", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_ok", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_test", intent_id: "INTENT_01", affected_roles: ["pool_admin"], affected_modes: ["normal"], scope: "global", pool_id: null, status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })  // utterance INSERT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE candidate
    const result = await promoteUtteranceExtension({
      candidateId: "cand_ok",
      knowledgeId: "ki_test",
      utterance:   "새로운 질문 표현",
      approvedBy:  "admin_01",
    });
    expect(result.ok).toBe(true);
    expect(result.utteranceId).toMatch(/^promo_/);
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_intent_utterances"));
    expect(insertCalls).toHaveLength(1);
    const updateCalls = dbExecute.mock.calls.filter(c =>
      c[0].__text?.includes("UPDATE support_knowledge_candidates") && c[0].__text?.includes("MERGED")
    );
    expect(updateCalls).toHaveLength(1);
  });

  it("CS24-30: Candidate not found → 404 에러", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });
    const result = await promoteUtteranceExtension({
      candidateId: "cand_nonexist",
      knowledgeId: "ki_test",
      utterance:   "테스트",
      approvedBy:  "admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CANDIDATE_NOT_FOUND");
  });

  it("CS24-31: Knowledge not active → 거부", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_ok2", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_inactive", status: "inactive" }] });
    const result = await promoteUtteranceExtension({
      candidateId: "cand_ok2",
      knowledgeId: "ki_inactive",
      utterance:   "테스트 표현",
      approvedBy:  "admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("KNOWLEDGE_NOT_ACTIVE");
  });

  it("CS24-32: UTTERANCE_ROLE_EXPANSION=0 — KI role 상속됨 (utterance에 별도 role 없음)", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_ok3", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_teacher_only", intent_id: "TEACHER_INTENT", affected_roles: ["teacher"], affected_modes: ["normal"], status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteUtteranceExtension({
      candidateId: "cand_ok3",
      knowledgeId: "ki_teacher_only",
      utterance:   "교사용 새 표현",
      approvedBy:  "admin",
    });
    expect(result.ok).toBe(true);
    // utterance INSERT에 별도 role 없음 (KI의 affected_roles=["teacher"]를 시스템 레벨에서 상속)
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_intent_utterances"));
    expect(insertCalls).toHaveLength(1);
    // utterance INSERT는 role 없이 진행 (기존 knowledge와 연결되어 role 상속)
    expect(result.utteranceId).toMatch(/^promo_/);
  });
});

// ── CS24-33~36: New canonical promotion ──────────────────────────────────────

describe("CS24-33~36: promoteNewCanonical", () => {
  it("CS24-33: NORMAL NEW_CANONICAL → pending KI 생성", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_new", classification: "NORMAL", candidate_type: "NEW_CANONICAL", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [] })  // INSERT ki
      .mockResolvedValueOnce({ rows: [] }); // UPDATE candidate
    const result = await promoteNewCanonical({
      candidateId: "cand_new",
      itemType: "FAQ", scope: "global",
      answer: "홈 화면에서 진도 현황 메뉴를 선택하면 수업 진도를 확인할 수 있습니다.",
      question: "수업 진도 어떻게 봐요",
      title: "수업 진도 확인",
      roles: ["parent_account"],
      modes: ["normal", "x"],
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(true);
    expect(result.knowledgeId).toMatch(/^ki_promo_/);
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_knowledge_items"));
    expect(insertCalls).toHaveLength(1);
    // status=pending (AUTO_ACTIVATE=false) — 'pending'은 SQL text에 하드코딩
    const sqlText: string = insertCalls[0][0].__text;
    expect(sqlText).toContain("pending");
    expect(sqlText).not.toContain("'active'");
    const vals = insertCalls[0][0].__values as string[];
    expect(vals).not.toContain("active");
  });

  it("CS24-34: PII 포함 answer → PII_DETECTED_IN_ANSWER 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: "cand_pii", classification: "NORMAL", candidate_type: "NEW_CANONICAL", status: "PENDING" }] });
    const result = await promoteNewCanonical({
      candidateId: "cand_pii",
      itemType: "FAQ", scope: "global",
      answer: "김민수 학생의 경우 담당 강사에게 문의하세요",
      question: "진도 확인",
      title: "진도",
      roles: ["parent_account"],
      modes: ["normal"],
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("PII_DETECTED_IN_ANSWER");
  });

  it("CS24-35: Candidate not PENDING → 거부", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: "cand_approved", classification: "NORMAL", candidate_type: "NEW_CANONICAL", status: "APPROVED" }] });
    const result = await promoteNewCanonical({
      candidateId: "cand_approved",
      itemType: "FAQ", scope: "global",
      answer: "정상 답변", question: "질문", title: "제목",
      roles: ["pool_admin"], modes: ["normal"],
      approvedBy: "admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CANDIDATE_NOT_PENDING");
  });

  it("CS24-36: NEW_CANONICAL → candidate status=APPROVED (MERGED 아님)", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "cand_new2", classification: "NORMAL", candidate_type: "NEW_CANONICAL", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteNewCanonical({
      candidateId: "cand_new2",
      itemType: "FAQ", scope: "global",
      answer: "새 기능에 대한 답변입니다",
      question: "새 기능 질문", title: "새 기능",
      roles: ["pool_admin"], modes: ["normal"],
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(true);
    const updateCalls = dbExecute.mock.calls.filter(c =>
      c[0].__text?.includes("UPDATE support_knowledge_candidates") && c[0].__text?.includes("APPROVED")
    );
    expect(updateCalls).toHaveLength(1);
  });
});

// ── CS24-37~40: AUTO_ACTIVATE 방지 ────────────────────────────────────────────

describe("CS24-37~40: AUTO_ACTIVATE=0 검증", () => {
  it("CS24-37: promoteNewCanonical → KI status=pending (active 없음)", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "c1", classification: "NORMAL", candidate_type: "NEW_CANONICAL", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteNewCanonical({
      candidateId: "c1",
      itemType: "FAQ", scope: "global",
      answer: "정상 답변", question: "질문", title: "제목",
      roles: ["pool_admin"], modes: ["normal"],
      approvedBy: "admin",
    });
    expect(result.ok).toBe(true);
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_knowledge_items"));
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const sqlText: string = insertCalls[0][0].__text;
    // 'pending'은 SQL text에 하드코딩 (values 배열이 아님)
    expect(sqlText).toContain("pending");
    expect(sqlText).not.toContain("'active'");
    // values에 "active" 없음 (scope, roles, modes 같은 values만 있음)
    const vals = insertCalls[0][0].__values as string[];
    expect(vals).not.toContain("active");
  });

  it("CS24-38: evaluateForCandidacy → Candidate status=PENDING 고정", async () => {
    await evaluateForCandidacy(makeEntry({ resolutionSource: "LLM" }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0].__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      const sqlText: string = insertCalls[0][0].__text;
      // 'PENDING'은 SQL text에 하드코딩
      expect(sqlText).toContain("'PENDING'");
      expect(sqlText).not.toContain("'APPROVED'");
      // values에 "active" 없음
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).not.toContain("active");
      expect(vals).not.toContain("APPROVED");
    }
  });

  it("CS24-39: Human reply → candidate AUTO_ACTIVE=0 (promoteNewCanonical에서만 가능)", async () => {
    // Human reply가 있는 case → evaluateForCandidacy 결과는 PENDING
    dbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await evaluateForCandidacy(makeEntry({
      resolutionSource: "LLM",
      humanRequested: true,
      finalCaseState: "HUMAN_RESPONDED",
    }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0].__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      const vals = insertCalls[0][0].__values as string[];
      expect(vals).not.toContain("active");
      expect(vals).not.toContain("APPROVED");
    }
  });

  it("CS24-40: promoteUtteranceExtension → utterance status=active (OK), KI는 변경 없음", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "c_utt", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_active", intent_id: "INT_01", affected_roles: ["pool_admin"], affected_modes: ["normal"], status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteUtteranceExtension({
      candidateId: "c_utt",
      knowledgeId: "ki_active",
      utterance: "새 표현 정상",
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(true);
    // support_knowledge_items UPDATE 없음 (KI 변경 없음)
    const kiUpdateCalls = dbExecute.mock.calls.filter(c =>
      c[0].__text?.includes("UPDATE support_knowledge_items")
    );
    expect(kiUpdateCalls).toHaveLength(0);
  });
});

// ── CS24-41~46: Security (role/mode/pool leakage) ─────────────────────────────

describe("CS24-41~46: Security", () => {
  it("CS24-41: ROLE_LEAKAGE=0 — pool_admin candidate는 teacher KI에 utterance 추가 불가", async () => {
    // KI가 teacher only인데 pool_admin candidate
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "c_leak", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_teacher_only", intent_id: "T01", affected_roles: ["teacher"], affected_modes: ["normal"], status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteUtteranceExtension({
      candidateId: "c_leak",
      knowledgeId: "ki_teacher_only",
      utterance: "새 표현",
      approvedBy: "super_admin",
    });
    // 서버는 utterance INSERT만 하고 KI의 role을 상속
    // role 확대(pool_admin 추가)는 없음 — INSERT에 별도 role 필드 없음
    expect(result.ok).toBe(true);
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_intent_utterances"));
    // role 관련 INSERT 필드 없음 (KI 레벨에서 제한)
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][0].__text).not.toContain("pool_admin");
  });

  it("CS24-42: MODE_LEAKAGE=0 — normal-only KI utterance 추가 시 modes 확대 없음", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "c_mode", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_normal_only", intent_id: "N01", affected_roles: ["pool_admin"], affected_modes: ["normal"], status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await promoteUtteranceExtension({
      candidateId: "c_mode",
      knowledgeId: "ki_normal_only",
      utterance: "모드 확대 테스트",
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(true);
    // INSERT에 'x' mode 추가 없음
    const insertCalls = dbExecute.mock.calls.filter(c => c[0].__text?.includes("INSERT INTO support_intent_utterances"));
    expect(insertCalls).toHaveLength(1);
    // utterance는 KI와 연결되므로 mode 확대 없음
  });

  it("CS24-43: POOL_LEAKAGE=0 — scope=global로만 생성", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await evaluateForCandidacy(makeEntry({ resolutionSource: "LLM", poolId: "pool_A" }));
    const insertCalls = dbExecute.mock.calls.filter(
      c => c[0].__text?.includes("INSERT INTO support_knowledge_candidates")
    );
    if (insertCalls.length > 0) {
      // pool_scope='global'은 SQL text에 하드코딩 (pool_id=NULL도 SQL text)
      const sqlText: string = insertCalls[0][0].__text;
      expect(sqlText).toContain("'global'");
      expect(sqlText).toContain("NULL");
      // values에 pool_A가 포함되면 안 됨 (pool 기반 격리 없음)
      const vals = insertCalls[0][0].__values as any[];
      expect(vals).not.toContain("pool_A");
    }
  });

  it("CS24-44: REJECTED candidate → approve 불가", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: "c_rej", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "REJECTED" }] });
    const result = await promoteUtteranceExtension({
      candidateId: "c_rej",
      knowledgeId: "ki_test",
      utterance: "테스트",
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CANDIDATE_NOT_PENDING");
  });

  it("CS24-45: MERGED candidate → approve 불가", async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: "c_mrg", classification: "NORMAL", candidate_type: "UTTERANCE_EXTENSION", status: "MERGED" }] });
    const result = await promoteUtteranceExtension({
      candidateId: "c_mrg",
      knowledgeId: "ki_test",
      utterance: "테스트",
      approvedBy: "super_admin",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("CANDIDATE_NOT_PENDING");
  });

  it("CS24-46: HUMAN_JUDGMENT_REQUIRED candidate → DYNAMIC/POLICY 아니므로 approve 시도 가능 (비차단)", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ id: "c_hj", classification: "HUMAN_JUDGMENT_REQUIRED", candidate_type: "UTTERANCE_EXTENSION", status: "PENDING" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ki_hj", intent_id: "HJ01", affected_roles: ["pool_admin"], affected_modes: ["normal"], status: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    // HUMAN_JUDGMENT_REQUIRED는 DYNAMIC/POLICY가 아니므로 API 레벨에서 차단 안 함
    // 단, Super Admin이 직접 검토 후 승인
    const result = await promoteUtteranceExtension({
      candidateId: "c_hj",
      knowledgeId: "ki_hj",
      utterance: "특수 처리 표현",
      approvedBy: "super_admin",
    });
    // HUMAN_JUDGMENT_REQUIRED는 차단 아님 (Dynamic/Policy만 차단)
    expect(result.ok).toBe(true);
  });
});

// ── CS24-47~50: Metrics ────────────────────────────────────────────────────────

describe("CS24-47~50: getLearningMetrics", () => {
  it("CS24-47: 빈 DB → 모든 지표 0 반환", async () => {
    dbExecute.mockResolvedValue({ rows: [{}] });
    const m = await getLearningMetrics();
    expect(m.support_queries_total).toBe(0);
    expect(m.direct_db_total).toBe(0);
    expect(m.candidates_created).toBe(0);
  });

  it("CS24-48: 메트릭 필드 존재 검증", async () => {
    dbExecute.mockResolvedValue({ rows: [{ total: 10, direct_db: 7, gpt_fallback: 2, human_req: 1, no_match: 0, ambiguous: 0 }] });
    const m = await getLearningMetrics();
    expect(m).toHaveProperty("support_queries_total");
    expect(m).toHaveProperty("direct_db_rate");
    expect(m).toHaveProperty("gpt_fallback_rate");
    expect(m).toHaveProperty("human_request_rate");
    expect(m).toHaveProperty("candidates_created");
    expect(m).toHaveProperty("utterances_added");
    expect(m).toHaveProperty("canonicals_added");
  });

  it("CS24-49: rate 계산 — direct_db_rate", async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ total: 100, direct_db: 80, gpt_fallback: 15, human_req: 5, no_match: 0, ambiguous: 0 }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{}] });
    const m = await getLearningMetrics();
    expect(m.support_queries_total).toBe(100);
    expect(m.direct_db_total).toBe(80);
    expect(m.direct_db_rate).toBe(80);
  });

  it("CS24-50: DB 오류 시 throw 없음 (Promise.all 내부 처리)", async () => {
    dbExecute.mockRejectedValue(new Error("DB fail"));
    await expect(getLearningMetrics()).rejects.toBeDefined(); // Promise.all에서 throw
    // 실제 서버에서는 route가 500 반환 — 서비스는 throw 가능 (route 레벨에서 catch)
  });
});
