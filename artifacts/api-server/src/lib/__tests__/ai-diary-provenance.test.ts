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
