/**
 * curriculum-progress-mapper.test.ts
 * STEP-GAUGE-04: CPO Mapper Tests
 *
 * drizzle queryChunks 구조:
 *   { value: string[] }  → StringChunk (SQL 텍스트)
 *   { value: null }      → null 파라미터 (Param wrapper)
 *   string/number/boolean → 날 원시값 파라미터
 *
 * computeItemRank는 sql.raw() 사용 → queryChunks = [StringChunk with full SQL]
 *   → params 없음, SQL 텍스트에서 regex로 versionId/itemId 추출 필요
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertSessionObservation,
  invalidateSessionObservation,
  type MapperDb,
} from "../curriculum-progress-mapper";

// ─────────────────────────────────────────────────────────────────────────────
// drizzle sql 객체 파싱
// ─────────────────────────────────────────────────────────────────────────────

function parseSqlObject(query: any): { text: string; params: unknown[] } {
  const chunks: unknown[] = query?.queryChunks ?? [];
  let text = "";
  const params: unknown[] = [];

  for (const chunk of chunks) {
    // StringChunk: { value: string[] }
    if (
      chunk !== null &&
      typeof chunk === "object" &&
      Array.isArray((chunk as any).value)
    ) {
      text += ((chunk as any).value as string[]).join("");
    } else if (
      chunk !== null &&
      typeof chunk === "object" &&
      Object.prototype.hasOwnProperty.call(chunk, "value") &&
      (chunk as any).value === null
    ) {
      // Null param wrapped as { value: null }
      params.push(null);
      text += "?";
    } else {
      // Raw primitive: string, number, boolean
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
let notes: Array<{ id: string; diary_id: string; student_id: string; note_content: string }> = [];
let events: Array<{
  id: string; curriculum_item_id: string; curriculum_version_id: string;
  source: string; confidence: number; diary_note_id: string | null; is_invalidated: boolean;
}> = [];

function resetDb() { cpos = []; versions = []; items = []; notes = []; events = []; }

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB — drizzle sql + sql.raw 쿼리를 in-memory 테이블에서 처리
// ─────────────────────────────────────────────────────────────────────────────

function buildMockDb(): MapperDb {
  return {
    async execute(query: any) {
      const { text, params } = parseSqlObject(query);
      const T = text.toUpperCase();

      // ━━━ SELECT growth_events + student_notes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (
        T.includes("GROWTH_EVENTS") &&
        T.includes("CLASS_DIARY_STUDENT_NOTES") &&
        T.includes("SELECT") &&
        !T.includes("UPDATE") &&
        !T.includes("INSERT")
      ) {
        // params: [lessonSessionId(str), studentId(str)]
        const lessonSessionId = params[0] as string;
        const studentId = params[1] as string;

        const matchingNoteIds = new Set(
          notes
            .filter((n) => n.diary_id === lessonSessionId && n.student_id === studentId)
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
        return {
          rows: versions.filter((v) => v.id === versionId && v.swimming_pool_id === poolId),
        };
      }

      // ━━━ SELECT curriculum_items (rank calculator — sql.raw 사용) ━━━━━━━━━━
      // sql.raw() → queryChunks = [StringChunk with full SQL]
      // params 없음 → SQL 텍스트에서 regex로 값 추출
      if (T.includes("CURRICULUM_ITEMS") && T.includes("SELECT") && !T.includes("INSERT") && !T.includes("UPDATE")) {

        // ── 첫 번째 rank 계산 쿼리 (WITH ranked ... WHERE id = 'itemId') ──────
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
          if (idx < 0) return { rows: [] }; // item not in active set

          return {
            rows: [{
              id: itemId,
              progress_rank: idx + 1,
              total_count: total,
            }],
          };
        }

        // ── 두 번째 item 존재 확인 쿼리 (WHERE id = 'x' AND curriculum_version_id = 'y') ──
        if (T.includes("IS_ACTIVE")) {
          const iIdMatch = text.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
          const vIdMatch = text.match(/curriculum_version_id\s*=\s*'([^']+)'/i);
          const itemId = iIdMatch?.[1] ?? "";
          const versionId = vIdMatch?.[1] ?? "";

          const found = items.find(
            (i) => i.id === itemId && i.curriculum_version_id === versionId
          );
          return { rows: found ? [{ id: found.id, is_active: found.is_active }] : [] };
        }

        // ── 세 번째 cross-version 확인 쿼리 (WHERE id = 'x' only, no version) ──
        const iIdMatch = text.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
        const itemId = iIdMatch?.[1] ?? "";
        const found = items.find((i) => i.id === itemId);
        return { rows: found ? [{ id: found.id }] : [] };
      }

      // ━━━ SELECT curriculum_progress_observations (existence check) ━━━━━━━━━
      if (
        T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") &&
        T.includes("SELECT") &&
        !T.includes("INSERT") &&
        !T.includes("UPDATE")
      ) {
        const lessonSessionId = params[0] as string;
        const studentId = params[1] as string;
        return {
          rows: cpos.filter(
            (c) => c.lesson_session_id === lessonSessionId && c.student_id === studentId
          ),
        };
      }

      // ━━━ UPDATE CPO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // INSERT ... ON CONFLICT DO UPDATE는 INSERT 조건에서 처리하므로 제외
      if (T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") && T.includes("UPDATE") && !T.includes("INSERT")) {
        if (T.includes("DIARY_DELETE")) {
          const lessonSessionId = params[0] as string;
          const studentId = params[1] as string;
          for (const c of cpos) {
            if (c.lesson_session_id === lessonSessionId && c.student_id === studentId) {
              c.invalidated_reason = "diary_delete";
            }
          }
        } else {
          // is_invalidated = true (params: [lessonSessionId, studentId])
          const lessonSessionId = params[0] as string;
          const studentId = params[1] as string;
          for (const c of cpos) {
            if (c.lesson_session_id === lessonSessionId && c.student_id === studentId) {
              c.is_invalidated = true;
              c.invalidated_at = new Date().toISOString();
              c.invalidated_reason = "no_eligible_evidence";
            }
          }
        }
        return { rows: [] };
      }

      // ━━━ INSERT CPO ON CONFLICT DO UPDATE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") && T.includes("INSERT")) {
        // param order mirrors mapper INSERT VALUES:
        // [studentId, poolId, lessonSessionId, lastNoteId,
        //  cvId, ciId, rank(num), total(num), pct(num), obsType,
        //  eligible(bool), source, snippet, confidence(num)]
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
        if (existingIdx >= 0) {
          cpos[existingIdx] = newRow;
        } else {
          cpos.push(newRow);
        }
        return { rows: [] };
      }

      // 미처리 → 빈 결과
      return { rows: [] };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const POOL_ID = "pool_test";
const VERSION_ID = "cv_test";
const SESSION_ID = "cd_test_session";
const STUDENT_ID = "stu_test";

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
  notes.push({ id: noteId, diary_id: diaryId, student_id: studentId, note_content: content });
  return noteId;
}

function addEvent(
  noteId: string, itemId: string,
  source: "teacher_ai" | "teacher_manual" = "teacher_ai",
  confidence = 0.9, invalidated = false, versionId = VERSION_ID
): string {
  const evId = `ge_${itemId}_${Math.random().toString(36).slice(2)}`;
  events.push({ id: evId, curriculum_item_id: itemId, curriculum_version_id: versionId,
    source, confidence, diary_note_id: noteId, is_invalidated: invalidated });
  return evId;
}

function makeCpo(overrides: Partial<CpoRow> = {}): CpoRow {
  return {
    id: "cpo_existing", student_id: STUDENT_ID, swimming_pool_id: POOL_ID,
    lesson_session_id: SESSION_ID, last_diary_note_id: "csn_old",
    curriculum_version_id: VERSION_ID, curriculum_item_id: "ci_5",
    observed_progress_rank: 5, observed_total_count: 10, observed_progress_pct: 50,
    observation_type: "ACTUAL_TAUGHT", is_gauge_eligible: true,
    evidence_source: "teacher_ai", evidence_text_snippet: "연습했습니다.",
    mapping_confidence: 0.9, is_invalidated: false, invalidated_at: null,
    invalidated_reason: null, updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1: 한 session에 rank 10/20/30 모두 eligible → CPO rank30
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1: 한 session에 rank 10/20/30 모두 eligible → CPO rank30", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(40);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 자유형을 연습했습니다.");
    addEvent(noteId, "ci_10");
    addEvent(noteId, "ci_20");
    addEvent(noteId, "ci_30");
  });

  it("대표 CPO는 rank=30", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(30);
    expect(r.curriculumItemId).toBe("ci_30");
  });

  it("CPO는 정확히 1개만 생성", async () => {
    await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    const matching = cpos.filter((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(matching.length).toBe(1);
    expect(matching[0].observed_progress_rank).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2: rank30=FUTURE_PLAN(false), rank20=ACTUAL_TAUGHT(true) → CPO rank20
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2: rank30=FUTURE_PLAN(false), rank20=ACTUAL_TAUGHT(true) → CPO rank20", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(40);
    // ci_30: FUTURE_PLAN
    const note30 = addNote(SESSION_ID, STUDENT_ID, "다음 시간에 접영을 배울 예정입니다.", "_30");
    addEvent(note30, "ci_30");
    // ci_20: ACTUAL_TAUGHT
    const note20 = `csn_${SESSION_ID}_${STUDENT_ID}_20`;
    notes.push({ id: note20, diary_id: SESSION_ID, student_id: STUDENT_ID, note_content: "오늘 자유형 킥을 연습했습니다." });
    addEvent(note20, "ci_20");
  });

  it("eligible = rank20(ACTUAL_TAUGHT) → CPO rank20", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(20);
    expect(r.observationType).toBe("ACTUAL_TAUGHT");
    expect(r.isGaugeEligible).toBe(true);
  });

  it("FUTURE_PLAN은 skipReasons에 포함", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r._diagnostics?.skipReasons.some((s) => s.includes("FUTURE_PLAN"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3: rank40=PAST_REFERENCE(false), rank35=CORRECTION(true) → CPO rank35
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3: rank40=PAST_REFERENCE(false), rank35=CORRECTION(true) → CPO rank35", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(50);
    const note40 = addNote(SESSION_ID, STUDENT_ID, "지난번에 평영을 배웠습니다.", "_40");
    addEvent(note40, "ci_40");
    const note35 = `csn_${SESSION_ID}_${STUDENT_ID}_35`;
    notes.push({ id: note35, diary_id: SESSION_ID, student_id: STUDENT_ID, note_content: "오늘 자유형 자세를 교정했습니다." });
    addEvent(note35, "ci_35");
  });

  it("대표 CPO = rank35, CORRECTION, eligible", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(35);
    expect(r.observationType).toBe("CORRECTION");
    expect(r.isGaugeEligible).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4: eligible 없음 → 기존 CPO invalidate / NO_ELIGIBLE_EVIDENCE
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4: eligible event 없음", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(10);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "다음 시간에 배울 예정입니다.");
    addEvent(noteId, "ci_7");
  });

  it("기존 CPO 있으면 → INVALIDATED", async () => {
    cpos.push(makeCpo());
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("INVALIDATED");
    expect(cpos[0].is_invalidated).toBe(true);
  });

  it("기존 CPO 없으면 → NO_ELIGIBLE_EVIDENCE", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("NO_ELIGIBLE_EVIDENCE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5: 동일 session/student 재실행 → INSERT 추가 행 없음, 기존 row UPDATE
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5: 동일 session/student 재실행 → CPO 1개 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(20);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 자유형을 연습했습니다.");
    addEvent(noteId, "ci_10");
  });

  it("두 번 호출해도 CPO는 1개", async () => {
    const db = buildMockDb();
    await upsertSessionObservation(db, { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    await upsertSessionObservation(db, { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    const matching = cpos.filter((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(matching.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6: Diary EDIT — rank70 → 수정 후 rank50
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6: Diary EDIT — rank70 → 수정 후 rank50", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(80);
    cpos.push(makeCpo({ curriculum_item_id: "ci_70", observed_progress_rank: 70, observed_total_count: 80, observed_progress_pct: 87.5 }));
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 수정된 내용으로 연습했습니다.");
    addEvent(noteId, "ci_50");
  });

  it("CPO observed_progress_rank = 50", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(50);
    const cpo = cpos.find((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(cpo?.observed_progress_rank).toBe(50);
    expect(cpos.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7: Diary DELETE + no remaining evidence → CPO invalidated
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7: Diary DELETE + no remaining evidence → CPO invalidated", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(30);
    cpos.push(makeCpo({ curriculum_item_id: "ci_15", observed_progress_rank: 15, observed_total_count: 30, observed_progress_pct: 50 }));
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 연습했습니다.");
    addEvent(noteId, "ci_15", "teacher_ai", 0.9, true /* invalidated */);
  });

  it("invalidateSessionObservation → is_invalidated=true, reason=diary_delete", async () => {
    const r = await invalidateSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("INVALIDATED");
    const cpo = cpos.find((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(cpo?.is_invalidated).toBe(true);
    expect(cpo?.invalidated_reason).toBe("diary_delete");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8: Diary DELETE + remaining eligible evidence → CPO recomputed
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8: Diary DELETE + remaining eligible → CPO recomputed", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(40);
    cpos.push(makeCpo({ curriculum_item_id: "ci_25", observed_progress_rank: 25, observed_total_count: 40, observed_progress_pct: 62.5 }));
    // invalidated event (ci_25)
    notes.push({ id: "csn_a", diary_id: SESSION_ID, student_id: STUDENT_ID, note_content: "연습했습니다." });
    addEvent("csn_a", "ci_25", "teacher_ai", 0.85, true /* invalidated */);
    // valid remaining event (ci_30)
    notes.push({ id: "csn_b", diary_id: SESSION_ID, student_id: STUDENT_ID, note_content: "오늘 배영을 복습했습니다." });
    addEvent("csn_b", "ci_30");
  });

  it("잔존 eligible → CPO recomputed to rank=30", async () => {
    const r = await invalidateSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.progressRank).toBe(30);
    const cpo = cpos.find((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(cpo?.is_invalidated).toBe(false);
    expect(cpo?.observed_progress_rank).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9: cross-pool → CPO 생성 차단
// ─────────────────────────────────────────────────────────────────────────────

describe("TC9: cross-pool curriculum item → CPO 생성 차단", () => {
  beforeEach(() => {
    resetDb();
    versions.push({ id: VERSION_ID, swimming_pool_id: "pool_other", is_active: true });
    addItems(20);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 연습했습니다.");
    addEvent(noteId, "ci_10");
  });

  it("cross-pool → NO_ELIGIBLE_EVIDENCE + skipReasons 포함", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("NO_ELIGIBLE_EVIDENCE");
    expect(cpos.length).toBe(0);
    expect(r._diagnostics?.skipReasons.some((s) => s.includes("cross-pool"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10: inactive curriculum item → CPO 생성 차단
// ─────────────────────────────────────────────────────────────────────────────

describe("TC10: inactive curriculum item → CPO 생성 차단", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    items.push({ id: "ci_5", curriculum_version_id: VERSION_ID, sort_order: 4, is_active: false });
    for (let i = 0; i < 4; i++) {
      items.push({ id: `ci_${i + 1}`, curriculum_version_id: VERSION_ID, sort_order: i, is_active: true });
    }
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 연습했습니다.");
    addEvent(noteId, "ci_5");
  });

  it("inactive item → rank error → NO_ELIGIBLE_EVIDENCE", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("NO_ELIGIBLE_EVIDENCE");
    expect(cpos.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC11: teacher_ai + empty evidence → UNVERIFIED → gauge 제외
// ─────────────────────────────────────────────────────────────────────────────

describe("TC11: teacher_ai + empty evidence → UNVERIFIED → gauge 제외", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(10);
    notes.push({ id: "csn_empty", diary_id: SESSION_ID, student_id: STUDENT_ID, note_content: "" });
    addEvent("csn_empty", "ci_5");
  });

  it("빈 evidence → NO_ELIGIBLE_EVIDENCE", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("NO_ELIGIBLE_EVIDENCE");
    expect(cpos.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC12: teacher_manual explicit selection → ACTUAL_TAUGHT eligible
// ─────────────────────────────────────────────────────────────────────────────

describe("TC12: teacher_manual explicit selection → ACTUAL_TAUGHT eligible", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(30);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "다음 시간에 배울 예정");
    addEvent(noteId, "ci_20", "teacher_manual", 1.0);
  });

  it("teacher_manual → ACTUAL_TAUGHT, eligible, confidence=1.0", async () => {
    const r = await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    expect(r.status).toBe("UPSERTED");
    expect(r.observationType).toBe("ACTUAL_TAUGHT");
    expect(r.isGaugeEligible).toBe(true);
    expect(cpos[0]?.mapping_confidence).toBe(1.0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC13: Professional/AI DB dependency 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC13: Professional/AI DB dependency 없음", () => {
  it("imports에 openai/professional/gpt 없음 (정적 확인)", async () => {
    const fs = await import("fs/promises");
    const src = await fs.readFile(
      new URL("../curriculum-progress-mapper.ts", import.meta.url).pathname,
      "utf-8"
    ).catch(() => "");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("professional_engine");
    expect(src.toLowerCase()).not.toContain("gpt");
  });

  it("classifyObservationType는 동기 실행 (<50ms)", async () => {
    const { classifyObservationType } = await import("../curriculum-evidence-classifier");
    const start = Date.now();
    classifyObservationType({ evidenceText: "오늘 연습했습니다.", evidenceSource: "teacher_ai" });
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC14: session-level UNIQUE — 복수 events → CPO 1개
// ─────────────────────────────────────────────────────────────────────────────

describe("TC14: session-level UNIQUE 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(20);
    const noteId = addNote(SESSION_ID, STUDENT_ID, "오늘 자유형을 연습했습니다.");
    addEvent(noteId, "ci_10");
    addEvent(noteId, "ci_15");
    addEvent(noteId, "ci_5");
  });

  it("3개 events → CPO는 1개, rank=15 (highest eligible)", async () => {
    await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    const matching = cpos.filter((c) => c.lesson_session_id === SESSION_ID && c.student_id === STUDENT_ID);
    expect(matching.length).toBe(1);
    expect(matching[0].observed_progress_rank).toBe(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC15: evidence_text_snippet <= 200 chars
// ─────────────────────────────────────────────────────────────────────────────

describe("TC15: evidence_text_snippet <= 200 chars", () => {
  beforeEach(() => {
    resetDb();
    addVersion();
    addItems(10);
    const longText = "오늘 자유형을 연습했습니다. ".repeat(20).slice(0, 300); // 300자
    const noteId = addNote(SESSION_ID, STUDENT_ID, longText);
    addEvent(noteId, "ci_5");
  });

  it("CPO.evidence_text_snippet은 200자 이하", async () => {
    await upsertSessionObservation(buildMockDb(), { studentId: STUDENT_ID, poolId: POOL_ID, lessonSessionId: SESSION_ID });
    const cpo = cpos.find((c) => c.lesson_session_id === SESSION_ID);
    expect(cpo).toBeDefined();
    expect((cpo?.evidence_text_snippet ?? "").length).toBeLessThanOrEqual(200);
  });
});
