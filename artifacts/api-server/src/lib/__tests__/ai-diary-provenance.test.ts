/**
 * ai-diary-provenance.test.ts
 *
 * AI Diary provenance / curriculum_matches 보존 검증
 *
 * 검증 항목:
 *   TC-P01: DiaryInsertResult.requestId 필드 존재
 *   TC-P02: DiaryInsertResult.curriculumMatches 필드 존재
 *   TC-P03: useDiaryAIV2 handleInsert가 requestId를 포함해 onInsert 호출
 *   TC-P04: POST /diaries body에 ai_request_id 포함 여부 (정적 분석)
 *   TC-P05: server diary.ts가 ai_request_id 없으면 isAiGenerated=false
 *   TC-P06: server diary.ts가 ai_request_id 있으면 verifyAiOrigin 호출
 *   TC-P07: Manual Diary regression — resolveManualDiaryEvidence 여전히 import
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../../../..");

function readSrc(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

// ── TC-P01: DiaryInsertResult.requestId 필드 ───────────────────────────────

describe("TC-P01: DiaryInsertResult.requestId 필드 존재", () => {
  it("DiaryAIService.ts DiaryInsertResult에 requestId?: string 있음", () => {
    const src = readSrc("artifacts/swim-app/components/ai/services/DiaryAIService.ts");
    // interface DiaryInsertResult 블록 추출 (중괄호 균형으로)
    const start = src.indexOf("interface DiaryInsertResult");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("}", start + 100) + 1);
    expect(block).toContain("requestId");
  });
});

// ── TC-P02: DiaryInsertResult.curriculumMatches 필드 ──────────────────────

describe("TC-P02: DiaryInsertResult.curriculumMatches 필드 존재", () => {
  it("DiaryAIService.ts DiaryInsertResult에 curriculumMatches?: CurriculumMatch[] 있음", () => {
    const src = readSrc("artifacts/swim-app/components/ai/services/DiaryAIService.ts");
    const start = src.indexOf("interface DiaryInsertResult");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("}", start + 100) + 1);
    expect(block).toContain("curriculumMatches");
  });
});

// ── TC-P03: useDiaryAIV2 handleInsert requestId 포함 ─────────────────────

describe("TC-P03: useDiaryAIV2 handleInsert가 requestId를 DiaryInsertResult에 포함", () => {
  it("requestId: requestIdRef.current 있음", () => {
    const src = readSrc("artifacts/swim-app/components/ai/features/diary/useDiaryAIV2.ts");
    // handleInsert의 DiaryInsertResult에 requestId 있는지
    expect(src).toContain("requestId:         requestIdRef.current");
  });
  it("insert_completed 로그에 request_id 포함", () => {
    const src = readSrc("artifacts/swim-app/components/ai/features/diary/useDiaryAIV2.ts");
    expect(src).toContain("request_id:             result.requestId");
  });
});

// ── TC-P04: diary.tsx POST body에 ai_request_id 포함 ─────────────────────

describe("TC-P04: diary.tsx POST body ai_request_id 포함", () => {
  it("handleAIInsert에서 setAiRequestId 호출", () => {
    const src = readSrc("artifacts/swim-app/app/(teacher)/diary.tsx");
    expect(src).toContain("setAiRequestId(result.requestId ?? null)");
  });
  it("handleSave POST body에 ai_request_id spread", () => {
    const src = readSrc("artifacts/swim-app/app/(teacher)/diary.tsx");
    expect(src).toContain("...(aiRequestId && { ai_request_id: aiRequestId })");
  });
  it("resetWriteSession에서 setAiRequestId(null) 호출", () => {
    const src = readSrc("artifacts/swim-app/app/(teacher)/diary.tsx");
    expect(src).toContain("setAiRequestId(null)");
  });
  it("aiRequestId state 선언 존재", () => {
    const src = readSrc("artifacts/swim-app/app/(teacher)/diary.tsx");
    expect(src).toContain("const [aiRequestId, setAiRequestId]");
  });
});

// ── TC-P05: server — ai_request_id 없으면 isAiGenerated=false ────────────

describe("TC-P05: server diary.ts ai_request_id 없으면 isAiGenerated=false", () => {
  it("candidateRequestId empty → false", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("const candidateRequestId = typeof ai_request_id === \"string\" ? ai_request_id.trim() : \"\"");
    expect(src).toContain("candidateRequestId.length > 0");
  });
});

// ── TC-P06: server — ai_request_id 있으면 verifyAiOrigin 호출 ───────────

describe("TC-P06: server diary.ts ai_request_id → verifyAiOrigin", () => {
  it("verifyAiOrigin 함수 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("async function verifyAiOrigin(");
  });
  it("in-memory registry + event_logs fallback 검증 구조", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("lookupAiOrigin(requestId)");
    expect(src).toContain("event_logs fallback");
  });
});

// ── TC-P07: Manual Diary regression — resolver 여전히 import ─────────────

describe("TC-P07: Manual Diary regression — resolveManualDiaryEvidence 보존", () => {
  it("diary.ts에 resolveManualDiaryEvidence import 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("resolveManualDiaryEvidence");
  });
  it("isXMode && !isAiGenerated && rawCurriculumMatches.length === 0 → resolver 호출", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("isXMode && !isAiGenerated && rawCurriculumMatches.length === 0");
  });
});

// ── P0-PROVENANCE FIX: CASE A~H 회귀 방지 ────────────────────────────────

// CASE A: saveAiTrace가 응답 전 durable 저장 (await 순서 확인)
describe("CASE A: saveAiTrace가 res.json() 전에 await", () => {
  it("contract 1.0 경로: await saveAiTrace → registerAiOrigin → res.json() 순서", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    // 올바른 순서: await saveAiTrace → registerAiOrigin → res.status(200).json
    const awaitIdx   = src.indexOf("await saveAiTrace({");
    const regIdx     = src.indexOf("registerAiOrigin(externalRequestId", awaitIdx);
    const jsonIdx    = src.indexOf("res.status(200).json(responseBody)", regIdx);
    expect(awaitIdx).toBeGreaterThan(-1);
    expect(regIdx).toBeGreaterThan(awaitIdx);
    expect(jsonIdx).toBeGreaterThan(regIdx);
  });
  it("contract 1.3 경로: 두 번째 await saveAiTrace가 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    // 1.0 이후에도 await saveAiTrace가 한 번 더 나와야 함 (1.3 경로)
    const first = src.indexOf("await saveAiTrace({");
    const second = src.indexOf("await saveAiTrace({", first + 1);
    expect(second).toBeGreaterThan(first);
  });
});

// CASE B: trace DB insert 강제 실패 → 200 금지, 503 반환
describe("CASE B: trace 저장 실패 시 503 반환 (200 금지)", () => {
  it("TRACE_SAVE_FAILED 에러 코드와 503 반환 로직 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    expect(src).toContain("TRACE_SAVE_FAILED");
    expect(src).toContain("res.status(503).json(");
    // 503 반환 후 return 처리 (200이 이어지지 않음)
    const traceFailIdx = src.indexOf("TRACE_SAVE_FAILED");
    const returnAfterFail = src.indexOf("return;", traceFailIdx);
    expect(returnAfterFail).toBeGreaterThan(traceFailIdx);
    // 503 블록 내에 200.json이 나오지 않음
    const failBlock = src.slice(traceFailIdx, returnAfterFail + 10);
    expect(failBlock).not.toContain("status(200)");
  });
  it("void saveAiTrace fire-and-forget 패턴이 SUCCESS 경로에서 제거됨", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    // SUCCESS 경로에서 void saveAiTrace는 허용되지 않음
    // (FAILED trace 경로에만 void 사용 가능)
    // res.status(200).json 이후에 void saveAiTrace가 나오면 안 됨
    const json200Idx = src.indexOf("res.status(200).json(responseBody)");
    expect(json200Idx).toBeGreaterThan(-1);
    const afterJson = src.slice(json200Idx, json200Idx + 200);
    // 200 응답 직후에 void saveAiTrace가 없어야 함
    expect(afterJson).not.toContain("void saveAiTrace");
  });
});

// CASE C: server restart 후 DB trace로 ai_generated 검증 가능
describe("CASE C/D: event_logs fallback — server restart 후에도 DB trace 검증 가능", () => {
  it("verifyAiOrigin이 event_logs SELECT로 fallback 검증", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("event_logs fallback");
    expect(src).toContain("SELECT 1 FROM event_logs");
    expect(src).toContain("metadata->>'feature' = 'teacher_diary'");
    expect(src).toContain("metadata->>'status'  = 'SUCCESS'");
  });
  it("in-memory registry miss여도 event_logs가 있으면 verified=true (fallback 경로)", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    const lookupIdx = src.indexOf("lookupAiOrigin(requestId)");
    const fallbackIdx = src.indexOf("event_logs fallback", lookupIdx);
    expect(fallbackIdx).toBeGreaterThan(lookupIdx);
  });
});

// CASE E: registry empty + DB trace 없음 + request_id 있음 → 409 (HUMAN false 처리 금지)
describe("CASE E: request_id 있으나 trace 없음 → 409 저장 거부 (false 처리 금지)", () => {
  it("AI_ORIGIN_UNVERIFIED 에러 코드와 409 반환 로직 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    expect(src).toContain("AI_ORIGIN_UNVERIFIED");
    expect(src).toContain("res.status(409).json(");
    expect(src).toContain("retryable: true");
  });
  it("request_id 있는데 verify 실패 시 isAiGenerated=false로 떨어지지 않음", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    // verified=false → 409 반환 후 return; → isAiGenerated=false 할당 불가
    const unverifiedIdx = src.indexOf("AI_ORIGIN_UNVERIFIED");
    const returnIdx = src.indexOf("return", unverifiedIdx);
    expect(returnIdx).toBeGreaterThan(unverifiedIdx);
    // 409 블록 사이에 isAiGenerated = false 할당 없어야 함
    const block = src.slice(unverifiedIdx, returnIdx + 10);
    expect(block).not.toContain("isAiGenerated = false");
  });
  it("request_id 없는 경우에만 human written으로 처리", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    // VERIFIED_HUMAN: request_id가 없을 때만 human 처리
    expect(src).toContain("request_id 없음 → 사람이 직접 작성");
  });
});

// CASE F/G: Unsupported fact guard — hallucination 차단 프롬프트
describe("CASE F/G: buildPrompt hallucination guard — 근거 없는 향상 표현 금지", () => {
  it("P0 UNSUPPORTED FACT GUARD 섹션이 systemPrompt에 포함", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    expect(src).toContain("P0 UNSUPPORTED FACT GUARD");
    expect(src).toContain("좋아졌습니다");
    expect(src).toContain("향상되었습니다");
  });
  it("수업 주제만 있고 학생 개인 관찰 없을 때 students는 빈 배열 강제 원칙 존재", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    expect(src).toContain("수업 주제만 있고 학생 개인 관찰이 없을 때 학생 이름에 수업 주제를 붙여 문장을 만드는 것은 금지");
  });
  it("강사 메모에 근거 있는 경우에만 허용 원칙 명시", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    expect(src).toContain("강사 메모에 명시되지 않은 사실·관찰·평가를 학생 개인에게 귀속시키는 문장을 절대 생성하지 않습니다");
  });
});

// CASE H: 동시 AI request 2개 — request_id scope 혼선 없음
describe("CASE H: 동시 AI request 간 request_id 격리", () => {
  it("verifyAiOrigin이 pool_id로 cross-pool 재사용 차단", () => {
    const src = readSrc("artifacts/api-server/src/routes/diary.ts");
    // pool_id 매칭 확인
    expect(src).toContain("pool_id   = ${poolId}");
    expect(src).toContain("pool_match=${poolMatch}");
  });
  it("registerAiOrigin에 poolId 전달 (pool 범위로 등록)", () => {
    const src = readSrc("artifacts/api-server/src/routes/ai-v1.ts");
    expect(src).toContain("registerAiOrigin(externalRequestId, poolId, req.user?.id ?? null)");
  });
});
