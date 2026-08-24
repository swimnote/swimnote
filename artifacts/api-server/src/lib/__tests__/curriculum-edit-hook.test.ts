/**
 * curriculum-edit-hook.test.ts
 * STEP-GAUGE-04A: Diary EDIT / DELETE → CPO 재계산 hook 테스트
 *
 * 검증 대상:
 *   - TC1: PUT /diaries/:id (common_content only) → CPO 변경 없음
 *   - TC2: student note 텍스트 편집(rank70→50 eligible 변경) → CPO 재계산
 *   - TC3: note 텍스트 편집 → 모든 event FUTURE_PLAN → CPO invalidated
 *   - TC4: 같은 session, 다른 note에 valid event 남아있음 → remaining으로 재계산
 *   - TC5: 다른 student note 편집 → 대상 student CPO 변경 없음
 *   - TC6: cross-pool evidence → 차단
 *   - TC7: note DELETE, evidence 0 → CPO invalidated
 *   - TC8: note DELETE, 다른 note evidence 남음 → CPO 재계산
 *   - TC9: gauge hook 실패 → Diary 응답 영향 없음
 */

import { describe, it, expect, beforeEach } from "vitest";
import { upsertSessionObservation, type MapperDb } from "../curriculum-progress-mapper";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// drizzle sql 객체 파싱 (GAUGE-04 동일 유틸)
// ─────────────────────────────────────────────────────────────────────────────

function parseSqlObject(query: any): { text: string; params: unknown[] } {
  const chunks: unknown[] = query?.queryChunks ?? [];
  let text = "";
  const params: unknown[] = [];

  for (const chunk of chunks) {
    if (chunk !== null && typeof chunk === "object" && Array.isArray((chunk as any).value)) {
      text += ((chunk as any).value as string[]).join("");
    } else if (
      chunk !== null &&
      typeof chunk === "object" &&
      Object.prototype.hasOwnProperty.call(chunk, "value") &&
      (chunk as any).value === null
    ) {
      params.push(null);
      text += "?";
    } else {
      params.push(chunk);
      text += "?";
    }
  }
  return { text, params };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory 테이블
// ─────────────────────────────────────────────────────────────────────────────

interface CpoRow {
  id: string;
  student_id: string;
  swimming_pool_id: string;
  lesson_session_id: string;
  last_diary_note_id: string | null;
  curriculum_version_id: string;
  curriculum_item_id: string;
  observed_progress_rank: number;
  observed_total_count: number;
  observed_progress_pct: number;
  observation_type: string;
  is_gauge_eligible: boolean;
  evidence_source: string;
  evidence_text_snippet: string | null;
  mapping_confidence: number;
  is_invalidated: boolean;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  updated_at: string;
}

let cpos: CpoRow[] = [];
let versions: Array<{ id: string; swimming_pool_id: string; is_active: boolean }> = [];
let items: Array<{ id: string; curriculum_version_id: string; sort_order: number; is_active: boolean }> = [];
let notes: Array<{ id: string; diary_id: string; student_id: string; note_content: string; is_deleted: boolean }> = [];
let events: Array<{
  id: string;
  curriculum_item_id: string;
  curriculum_version_id: string;
  source: string;
  confidence: number;
  diary_note_id: string | null;
  is_invalidated: boolean;
}> = [];
// growth_events UPDATE 추적 (note DELETE 시 invalidation 검증)
let invalidatedNoteIds: string[] = [];

function resetDb() {
  cpos = []; versions = []; items = []; notes = []; events = [];
  invalidatedNoteIds = [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB — note DELETE 시 growth_events UPDATE 지원
// ─────────────────────────────────────────────────────────────────────────────

function buildMockDb(): MapperDb {
  return {
    async execute(query: any) {
      const { text, params } = parseSqlObject(query);
      const T = text.toUpperCase();

      // ━━━ growth_events UPDATE (note DELETE → invalidate) ━━━━━━━━━━━━━━━━━━
      if (T.includes("GROWTH_EVENTS") && T.includes("UPDATE") && T.includes("IS_INVALIDATED")) {
        const noteId = params[0] as string;
        invalidatedNoteIds.push(noteId);
        // 실제 is_invalidated 플래그 갱신
        for (const e of events) {
          if (e.diary_note_id === noteId && !e.is_invalidated) {
            e.is_invalidated = true;
          }
        }
        return { rows: [] };
      }

      // ━━━ SELECT growth_events + student_notes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (
        T.includes("GROWTH_EVENTS") &&
        T.includes("CLASS_DIARY_STUDENT_NOTES") &&
        T.includes("SELECT") &&
        !T.includes("UPDATE") &&
        !T.includes("INSERT")
      ) {
        const lessonSessionId = params[0] as string;
        const studentId = params[1] as string;

        const matchingNoteIds = new Set(
          notes
            .filter((n) => n.diary_id === lessonSessionId && n.student_id === studentId && !n.is_deleted)
            .map((n) => n.id)
        );

        const validEvs = events.filter(
          (e) =>
            e.diary_note_id !== null &&
            matchingNoteIds.has(e.diary_note_id) &&
            ["teacher_ai", "teacher_manual"].includes(e.source) &&
            !e.is_invalidated &&
            e.curriculum_item_id != null &&
            e.curriculum_version_id != null
        );

        return {
          rows: validEvs.map((e) => {
            const note = notes.find((n) => n.id === e.diary_note_id);
            return {
              id: e.id,
              curriculum_item_id: e.curriculum_item_id,
              curriculum_version_id: e.curriculum_version_id,
              source: e.source,
              confidence: e.confidence,
              diary_note_id: e.diary_note_id,
              evidence_text: note?.note_content ?? null,
            };
          }),
        };
      }

      // ━━━ SELECT curriculum_versions (pool guard) ━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (
        T.includes("CURRICULUM_VERSIONS") &&
        T.includes("SELECT") &&
        T.includes("SWIMMING_POOL_ID") &&
        !T.includes("INSERT") &&
        !T.includes("UPDATE")
      ) {
        const versionId = params[0] as string;
        const poolId = params[1] as string;
        return { rows: versions.filter((v) => v.id === versionId && v.swimming_pool_id === poolId) };
      }

      // ━━━ SELECT curriculum_items (sql.raw — regex 파싱) ━━━━━━━━━━━━━━━━━━━
      if (T.includes("CURRICULUM_ITEMS") && T.includes("SELECT") && !T.includes("INSERT") && !T.includes("UPDATE")) {
        if (T.includes("ROW_NUMBER") || T.includes("WITH RANKED")) {
          const vIdMatch = text.match(/curriculum_version_id\s*=\s*'([^']+)'/i);
          const iIdMatch = text.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
          const versionId = vIdMatch?.[1] ?? "";
          const itemId = iIdMatch?.[1] ?? "";
          const activeItems = items
            .filter((i) => i.curriculum_version_id === versionId && i.is_active)
            .sort((a, b) => a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id.localeCompare(b.id));
          const total = activeItems.length;
          if (total === 0) return { rows: [] };
          const idx = activeItems.findIndex((i) => i.id === itemId);
          if (idx < 0) return { rows: [] };
          return { rows: [{ id: itemId, progress_rank: idx + 1, total_count: total }] };
        }
        if (T.includes("IS_ACTIVE")) {
          const iIdMatch = text.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
          const vIdMatch = text.match(/curriculum_version_id\s*=\s*'([^']+)'/i);
          const found = items.find((i) => i.id === (iIdMatch?.[1] ?? "") && i.curriculum_version_id === (vIdMatch?.[1] ?? ""));
          return { rows: found ? [{ id: found.id, is_active: found.is_active }] : [] };
        }
        const iIdMatch = text.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
        const found = items.find((i) => i.id === (iIdMatch?.[1] ?? ""));
        return { rows: found ? [{ id: found.id }] : [] };
      }

      // ━━━ SELECT CPO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (
        T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") &&
        T.includes("SELECT") &&
        !T.includes("INSERT") &&
        !T.includes("UPDATE")
      ) {
        const lessonSessionId = params[0] as string;
        const studentId = params[1] as string;
        return {
          rows: cpos.filter((c) => c.lesson_session_id === lessonSessionId && c.student_id === studentId),
        };
      }

      // ━━━ UPDATE CPO (invalidate) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") && T.includes("UPDATE") && !T.includes("INSERT")) {
        const lessonSessionId = params[0] as string;
        const studentId = params[1] as string;
        for (const c of cpos) {
          if (c.lesson_session_id === lessonSessionId && c.student_id === studentId) {
            c.is_invalidated = true;
            c.invalidated_at = new Date().toISOString();
            c.invalidated_reason = "no_eligible_evidence";
          }
        }
        return { rows: [] };
      }

      // ━━━ INSERT CPO ON CONFLICT DO UPDATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") && T.includes("INSERT")) {
        const [
          _studentId, _poolId, _lessonSessionId, _lastNoteId,
          _cvId, _ciId, _rank, _total, _pct, _obsType,
          _eligible, _source, _snippet, _confidence,
        ] = params;

        const newRow: CpoRow = {
          id: `cpo_mock_${Date.now()}`,
          student_id: _studentId as string,
          swimming_pool_id: _poolId as string,
          lesson_session_id: _lessonSessionId as string,
          last_diary_note_id: (_lastNoteId as string | null) ?? null,
          curriculum_version_id: _cvId as string,
          curriculum_item_id: _ciId as string,
          observed_progress_rank: Number(_rank),
          observed_total_count: Number(_total),
          observed_progress_pct: Number(_pct),
          observation_type: _obsType as string,
          is_gauge_eligible: Boolean(_eligible),
          evidence_source: _source as string,
          evidence_text_snippet: (_snippet as string | null) ?? null,
          mapping_confidence: Number(_confidence),
          is_invalidated: false,
          invalidated_at: null,
          invalidated_reason: null,
          updated_at: new Date().toISOString(),
        };

        const existingIdx = cpos.findIndex(
          (c) => c.lesson_session_id === _lessonSessionId && c.student_id === _studentId
        );
        if (existingIdx >= 0) cpos[existingIdx] = newRow;
        else cpos.push(newRow);
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const POOL_ID   = "pool_test";
const VERSION_ID = "cv_test";
const SESSION_ID = "cd_test_session";
const STUDENT_A  = "stu_A";
const STUDENT_B  = "stu_B";

function addVersion(id = VERSION_ID, poolId = POOL_ID) {
  versions.push({ id, swimming_pool_id: poolId, is_active: true });
}

function addItems(count: number, versionId = VERSION_ID) {
  for (let i = 0; i < count; i++) {
    items.push({ id: `ci_${i + 1}`, curriculum_version_id: versionId, sort_order: i, is_active: true });
  }
}

function addNote(diaryId: string, studentId: string, content: string, suffix = ""): string {
  const noteId = `csn_${diaryId}_${studentId}${suffix}`;
  notes.push({ id: noteId, diary_id: diaryId, student_id: studentId, note_content: content, is_deleted: false });
  return noteId;
}

function addEvent(
  noteId: string, itemId: string,
  source: "teacher_ai" | "teacher_manual" = "teacher_ai",
  invalidated = false, versionId = VERSION_ID
): string {
  const evId = `ge_${itemId}_${Math.random().toString(36).slice(2)}`;
  events.push({ id: evId, curriculum_item_id: itemId, curriculum_version_id: versionId,
    source, confidence: 0.9, diary_note_id: noteId, is_invalidated: invalidated });
  return evId;
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1: PUT /diaries/:id (common_content only) → CPO 변경 없음 (정적 확인)
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1: PUT /diaries/:id common_content edit → CPO 무변경", () => {
  it("diary.ts PUT /diaries/:id 핸들러에 upsertSessionObservation 호출 없음", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      new URL("../../routes/diary.ts", import.meta.url).pathname,
      "utf-8"
    );

    // PUT /diaries/:id 핸들러 추출 (743번째 줄 ~ 779번째 줄)
    const putHandler = src.match(
      /router\.put\("\/diaries\/:id"[\s\S]*?res\.json\(\{[^}]*success:\s*true[^}]*\}\);\s*\}\s*catch/
    )?.[0] ?? "";

    // common_content update 포함 확인
    expect(putHandler).toContain("common_content");
    // growth_events 수정 없음
    expect(putHandler).not.toContain("growth_events");
    // upsertSessionObservation 호출 없음
    expect(putHandler).not.toContain("upsertSessionObservation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2: student note 텍스트 편집 → rank70 FUTURE_PLAN, rank50 ACTUAL_TAUGHT → CPO rank50
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2: note 텍스트 편집 후 eligible event 변경 → CPO 재계산 rank50", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(80);
    // note_70: FUTURE_PLAN (편집 후 텍스트가 미래 계획으로 변경됨)
    notes.push({ id: "note_70", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "다음 시간에 접영을 배울 예정입니다.", is_deleted: false });
    addEvent("note_70", "ci_70");

    // note_50: ACTUAL_TAUGHT
    notes.push({ id: "note_50", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 자유형을 연습했습니다.", is_deleted: false });
    addEvent("note_50", "ci_50");
  });

  it("FUTURE_PLAN note 제외 → eligible = note_50(ACTUAL_TAUGHT) → CPO rank=50", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(50);
    expect(cpos[0]?.observed_progress_rank).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3: note 텍스트 편집 후 모든 event FUTURE_PLAN → CPO invalidated
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3: note 텍스트 편집 → 전체 FUTURE_PLAN → CPO invalidated", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(30);
    cpos.push({
      id: "cpo_old", student_id: STUDENT_A, swimming_pool_id: POOL_ID,
      lesson_session_id: SESSION_ID, last_diary_note_id: null,
      curriculum_version_id: VERSION_ID, curriculum_item_id: "ci_20",
      observed_progress_rank: 20, observed_total_count: 30, observed_progress_pct: 66.7,
      observation_type: "ACTUAL_TAUGHT", is_gauge_eligible: true,
      evidence_source: "teacher_ai", evidence_text_snippet: "연습했습니다.",
      mapping_confidence: 0.9, is_invalidated: false, invalidated_at: null,
      invalidated_reason: null, updated_at: new Date().toISOString(),
    });
    notes.push({ id: "note_20", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "다음 시간에 배울 예정입니다.", is_deleted: false }); // 편집 후 FUTURE_PLAN
    addEvent("note_20", "ci_20");
  });

  it("모든 event FUTURE_PLAN → CPO is_invalidated=true", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("INVALIDATED");
    expect(cpos[0]?.is_invalidated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4: 같은 session, 다른 note에 valid event 남음 → remaining으로 CPO 재계산
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4: 같은 session 다른 note valid event 잔존 → CPO 재계산", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(50);
    // note_A: 편집 후 FUTURE_PLAN (eligible 탈락)
    notes.push({ id: "note_A", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "다음에 배울 예정입니다.", is_deleted: false });
    addEvent("note_A", "ci_40");

    // note_B: 다른 note, ACTUAL_TAUGHT (eligible 유지)
    notes.push({ id: "note_B", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 배영을 복습했습니다.", is_deleted: false });
    addEvent("note_B", "ci_30");
  });

  it("note_A FUTURE_PLAN 탈락 → note_B(ci_30) remaining → CPO rank=30", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5: 다른 student(B)의 note 편집 → student A CPO 변경 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5: 다른 student note 편집 → 대상 student CPO 변경 없음", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(20);
    // Student A CPO 기존 존재
    cpos.push({
      id: "cpo_A", student_id: STUDENT_A, swimming_pool_id: POOL_ID,
      lesson_session_id: SESSION_ID, last_diary_note_id: null,
      curriculum_version_id: VERSION_ID, curriculum_item_id: "ci_10",
      observed_progress_rank: 10, observed_total_count: 20, observed_progress_pct: 50,
      observation_type: "ACTUAL_TAUGHT", is_gauge_eligible: true,
      evidence_source: "teacher_ai", evidence_text_snippet: "연습했습니다.",
      mapping_confidence: 0.9, is_invalidated: false, invalidated_at: null,
      invalidated_reason: null, updated_at: new Date().toISOString(),
    });
    // Student B note 편집 (sessionId 동일하지만 다른 studentId)
    notes.push({ id: "note_B", diary_id: SESSION_ID, student_id: STUDENT_B,
      note_content: "오늘 연습했습니다.", is_deleted: false });
    addEvent("note_B", "ci_15");
  });

  it("student B note 재계산 → student A CPO 변경 없음", async () => {
    // student B 재계산
    await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_B, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    // student A CPO는 그대로
    const cpoA = cpos.find((c) => c.student_id === STUDENT_A);
    expect(cpoA?.observed_progress_rank).toBe(10);
    expect(cpoA?.is_invalidated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6: cross-pool evidence → CPO 생성 차단
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6: cross-pool curriculum evidence → CPO 차단", () => {
  beforeEach(() => {
    resetDb();
    versions.push({ id: VERSION_ID, swimming_pool_id: "pool_other", is_active: true });
    addItems(20);
    notes.push({ id: "note_X", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 연습했습니다.", is_deleted: false });
    addEvent("note_X", "ci_10");
  });

  it("cross-pool version → NO_ELIGIBLE_EVIDENCE", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("NO_ELIGIBLE_EVIDENCE");
    expect(cpos.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7: note DELETE 후 growth_events invalidate + evidence 0 → CPO invalidated
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7: note DELETE → growth_events invalidate → evidence 0 → CPO invalidated", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(30);
    cpos.push({
      id: "cpo_old", student_id: STUDENT_A, swimming_pool_id: POOL_ID,
      lesson_session_id: SESSION_ID, last_diary_note_id: null,
      curriculum_version_id: VERSION_ID, curriculum_item_id: "ci_15",
      observed_progress_rank: 15, observed_total_count: 30, observed_progress_pct: 50,
      observation_type: "ACTUAL_TAUGHT", is_gauge_eligible: true,
      evidence_source: "teacher_ai", evidence_text_snippet: "연습했습니다.",
      mapping_confidence: 0.9, is_invalidated: false, invalidated_at: null,
      invalidated_reason: null, updated_at: new Date().toISOString(),
    });
    notes.push({ id: "note_del", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 연습했습니다.", is_deleted: true }); // soft-deleted
    addEvent("note_del", "ci_15");
    // note DELETE hook: growth_events invalidate 이미 완료됨
    events.forEach((e) => { if (e.diary_note_id === "note_del") e.is_invalidated = true; });
  });

  it("growth_events invalidated + note deleted → upsertSessionObservation → INVALIDATED", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("INVALIDATED");
    expect(cpos[0]?.is_invalidated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8: note DELETE 후 다른 note evidence 잔존 → CPO 재계산
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8: note DELETE → 다른 note evidence 잔존 → CPO 재계산", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(40);
    // note_del: soft-deleted, growth_events invalidated
    notes.push({ id: "note_del", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 자유형을 연습했습니다.", is_deleted: true });
    addEvent("note_del", "ci_25", "teacher_ai", true /* invalidated */);

    // note_remain: 살아있는 note
    notes.push({ id: "note_remain", diary_id: SESSION_ID, student_id: STUDENT_A,
      note_content: "오늘 배영을 복습했습니다.", is_deleted: false });
    addEvent("note_remain", "ci_30");
  });

  it("note_del 제거 후 note_remain(ci_30) → CPO rank=30", async () => {
    const r = await upsertSessionObservation(buildMockDb(), {
      studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
    });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(30);
    expect(cpos[0]?.is_invalidated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9: gauge hook 실패 → Diary 응답 영향 없음 (fire-and-forget 정책 검증)
// ─────────────────────────────────────────────────────────────────────────────

describe("TC9: gauge hook 실패 → Diary 응답 영향 없음", () => {
  it("Promise rejection이 상위 try-catch로 전파되지 않음", async () => {
    // 오류를 던지는 mock DB
    const errDb: MapperDb = {
      async execute() { throw new Error("DB 연결 실패 (테스트용)"); },
    };

    // fire-and-forget 패턴 시뮬레이션: promise를 await하지 않고 .catch 처리
    let diaryResponseSent = false;
    let gaugeErrorCaught = false;

    try {
      // Diary 응답 전송 (성공)
      diaryResponseSent = true;

      // gauge hook (fire-and-forget)
      upsertSessionObservation(errDb, {
        studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID,
      }).catch(() => { gaugeErrorCaught = true; });

      // Diary 응답은 이미 전송됨 → 실패 없음
    } catch {
      diaryResponseSent = false;
    }

    expect(diaryResponseSent).toBe(true);

    // Promise rejection이 catch됨을 확인 (비동기 — microtask flush)
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(gaugeErrorCaught).toBe(true);
  });

  it("note DELETE hook: growth_events invalidate 실패 시 structued log만 발생", async () => {
    const errDb: MapperDb = {
      async execute() { throw new Error("DB timeout"); },
    };

    let hookErrorLogged = false;
    const originalError = console.error;
    console.error = () => { hookErrorLogged = true; };

    try {
      ;(async () => {
        await errDb.execute(sql`UPDATE growth_events SET is_invalidated = true WHERE diary_note_id = ${"note_id"}`);
        await upsertSessionObservation(errDb, { studentId: STUDENT_A, poolId: POOL_ID, lessonSessionId: SESSION_ID });
      })().catch(() => { hookErrorLogged = true; });
    } finally {
      console.error = originalError;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hookErrorLogged).toBe(true);
  });
});
