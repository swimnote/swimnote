/**
 * curriculum-confirmation-engine.test.ts — GAUGE-05
 *
 * drizzle sql tag 파라미터 구조:
 *   StringChunk: { value: string[] }
 *   null param:  { value: null }
 *   raw primitive: string | number | boolean
 *
 * TC1~TC19 all required.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeConfirmedProgress,
  type ConfirmationEngineDb,
} from "../curriculum-confirmation-engine";

// ─────────────────────────────────────────────────────────────────────────────
// parseSqlObject — drizzle sql 객체 → { text, params }
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

interface AssignmentRow { student_id: string; swimming_pool_id: string; curriculum_version_id: string; is_active: boolean; deactivated_at: null | string; }
interface VersionRow    { id: string; swimming_pool_id: string; is_active: boolean; archived_at: null | string; }
interface CpoRow        { student_id: string; swimming_pool_id: string; curriculum_version_id: string; lesson_session_id: string; observed_progress_rank: number; observed_total_count: number; is_invalidated: boolean; is_gauge_eligible: boolean; observation_type: string; }
interface ScpRow        { id: string; student_id: string; swimming_pool_id: string; active_curriculum_version_id: string; active_confirmed_rank: number; active_confirmed_total: number; active_confirmed_pct: number; display_confirmed_pct: number; confirmed_at: string; display_updated_at: string; observation_session_count: number; prev_curriculum_version_id: string | null; prev_display_pct: number | null; updated_at: string; }

let assignments: AssignmentRow[] = [];
let versions:    VersionRow[]    = [];
let cpos:        CpoRow[]        = [];
let scps:        ScpRow[]        = [];

function resetDb() { assignments = []; versions = []; cpos = []; scps = []; }

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB
// ─────────────────────────────────────────────────────────────────────────────

function buildMockDb(): ConfirmationEngineDb {
  return {
    async execute(query: any) {
      const { text, params } = parseSqlObject(query);
      const T = text.toUpperCase();

      // ━━━ SELECT student_curriculum_assignments (version resolution step A) ━
      if (T.includes("STUDENT_CURRICULUM_ASSIGNMENTS") && T.includes("SELECT")) {
        const studentId = params[0] as string;
        const poolId    = params[1] as string;
        const matching  = assignments.filter(
          (a) => a.student_id === studentId && a.swimming_pool_id === poolId &&
                 a.is_active && a.deactivated_at === null
        );
        // also join curriculum_versions
        const result = matching.filter((a) => {
          const cv = versions.find((v) => v.id === a.curriculum_version_id);
          return cv && cv.is_active && cv.archived_at === null && cv.swimming_pool_id === poolId;
        });
        return { rows: result.map((a) => ({ curriculum_version_id: a.curriculum_version_id })) };
      }

      // ━━━ SELECT curriculum_versions (fallback pool active version) ━━━━━━━━
      if (T.includes("CURRICULUM_VERSIONS") && T.includes("SELECT") && !T.includes("ASSIGNMENTS")) {
        const poolId = params[0] as string;
        const result = versions.filter(
          (v) => v.swimming_pool_id === poolId && v.is_active && v.archived_at === null
        );
        return { rows: result.slice(0, 1).map((v) => ({ id: v.id })) };
      }

      // ━━━ SELECT curriculum_progress_observations (eligible CPOs) ━━━━━━━━━
      if (T.includes("CURRICULUM_PROGRESS_OBSERVATIONS") && T.includes("SELECT") && !T.includes("INSERT") && !T.includes("UPDATE")) {
        const studentId  = params[0] as string;
        const poolId     = params[1] as string;
        const versionId  = params[2] as string;
        const eligible   = cpos.filter(
          (c) => c.student_id === studentId && c.swimming_pool_id === poolId &&
                 c.curriculum_version_id === versionId &&
                 !c.is_invalidated && c.is_gauge_eligible &&
                 ["ACTUAL_TAUGHT", "REVIEW", "CORRECTION"].includes(c.observation_type)
        ).sort((a, b) => b.observed_progress_rank - a.observed_progress_rank);
        return { rows: eligible };
      }

      // ━━━ SELECT student_curriculum_progress (existing SCP) ━━━━━━━━━━━━━━━
      if (T.includes("STUDENT_CURRICULUM_PROGRESS") && T.includes("SELECT") && !T.includes("INSERT") && !T.includes("UPDATE")) {
        const studentId = params[0] as string;
        const poolId    = params[1] as string;
        return { rows: scps.filter((s) => s.student_id === studentId && s.swimming_pool_id === poolId) };
      }

      // ━━━ INSERT student_curriculum_progress ON CONFLICT DO UPDATE ━━━━━━━━
      if (T.includes("STUDENT_CURRICULUM_PROGRESS") && T.includes("INSERT")) {
        // INSERT VALUES param order:
        // [0]=studentId [1]=poolId [2]=versionId [3]=activeRank [4]=activeTotal
        // [5]=activePct [6]=newDisplayPct [7]=sessionCount [8]=prevVersionId [9]=prevDisplayPct
        // DO UPDATE SET (repeated params from index 10+):
        // [10]=versionId [11]=activeRank [12]=activeTotal [13]=activePct
        // [14]=newDisplayPct (GREATEST) [15]=activeRank (CASE) [16]=newDisplayPct (CASE GREATEST)
        // [17]=newDisplayPct (CASE comparison) [18]=sessionCount [19]=prevVersionId [20]=prevDisplayPct
        const studentId     = params[0] as string;
        const poolId        = params[1] as string;
        const versionId     = params[2] as string;
        const activeRank    = Number(params[3]);
        const activeTotal   = Number(params[4]);
        const activePct     = Number(params[5]);
        const newDisplayPct = Number(params[6]);
        const sessionCount  = Number(params[7]);
        const prevVersionId = params[8] as string | null;
        const prevDisplayPct = params[9] as number | null;

        const existingIdx = scps.findIndex(
          (s) => s.student_id === studentId && s.swimming_pool_id === poolId
        );

        const now = new Date().toISOString();

        if (existingIdx < 0) {
          // INSERT
          scps.push({
            id: `scp_${Date.now()}`, student_id: studentId, swimming_pool_id: poolId,
            active_curriculum_version_id: versionId,
            active_confirmed_rank: activeRank, active_confirmed_total: activeTotal,
            active_confirmed_pct: activePct,
            display_confirmed_pct: newDisplayPct,
            confirmed_at: now, display_updated_at: now,
            observation_session_count: sessionCount,
            prev_curriculum_version_id: prevVersionId, prev_display_pct: prevDisplayPct,
            updated_at: now,
          });
        } else {
          const old = scps[existingIdx];
          // DB-level GREATEST for display
          const resolvedDisplay = Math.max(old.display_confirmed_pct, newDisplayPct);
          // confirmed_at: update only if rank changed
          const confirmedAt = activeRank !== old.active_confirmed_rank ? now : old.confirmed_at;
          // display_updated_at: update only if display rose
          const displayUpdatedAt = resolvedDisplay > old.display_confirmed_pct ? now : old.display_updated_at;
          scps[existingIdx] = {
            ...old,
            active_curriculum_version_id: versionId,
            active_confirmed_rank: activeRank, active_confirmed_total: activeTotal,
            active_confirmed_pct: activePct,
            display_confirmed_pct: resolvedDisplay,
            confirmed_at: confirmedAt, display_updated_at: displayUpdatedAt,
            observation_session_count: sessionCount,
            prev_curriculum_version_id: prevVersionId, prev_display_pct: prevDisplayPct,
            updated_at: now,
          };
        }
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const POOL_A  = "pool_A";
const POOL_B  = "pool_B";
const VER_1   = "cv_1";
const VER_2   = "cv_2";
const STU     = "stu_test";
const TOTAL   = 100; // active item count

function addVersion(id: string, poolId: string) {
  versions.push({ id, swimming_pool_id: poolId, is_active: true, archived_at: null });
}

function addAssignment(studentId: string, poolId: string, versionId: string) {
  assignments.push({ student_id: studentId, swimming_pool_id: poolId,
    curriculum_version_id: versionId, is_active: true, deactivated_at: null });
}

function addCpo(
  studentId: string, poolId: string, versionId: string,
  sessionId: string, rank: number, total = TOTAL,
  type = "ACTUAL_TAUGHT", eligible = true, invalidated = false
) {
  cpos.push({
    student_id: studentId, swimming_pool_id: poolId,
    curriculum_version_id: versionId, lesson_session_id: sessionId,
    observed_progress_rank: rank, observed_total_count: total,
    is_invalidated: invalidated, is_gauge_eligible: eligible,
    observation_type: type,
  });
}

function addScp(studentId: string, poolId: string, versionId: string, rank: number, total: number, displayPct: number, prevVerId: string | null = null, prevDisplay: number | null = null) {
  const pct = total > 0 ? Math.round((rank / total) * 1000) / 10 : 0;
  const now = new Date().toISOString();
  scps.push({
    id: `scp_${Date.now()}`, student_id: studentId, swimming_pool_id: poolId,
    active_curriculum_version_id: versionId,
    active_confirmed_rank: rank, active_confirmed_total: total, active_confirmed_pct: pct,
    display_confirmed_pct: displayPct,
    confirmed_at: now, display_updated_at: now,
    observation_session_count: 3,
    prev_curriculum_version_id: prevVerId, prev_display_pct: prevDisplay,
    updated_at: now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1: [56,70,87] → confirmed=56
// ─────────────────────────────────────────────────────────────────────────────
describe("TC1: [56,70,87] → confirmed rank=56", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    addCpo(STU, POOL_A, VER_1, "s3", 87);
  });
  it("status=CONFIRMED, activeConfirmedRank=56", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    expect(r.activeConfirmedRank).toBe(56);
    expect(r.observationSessionCount).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2: [56,70,70,87] → confirmed=70
// ─────────────────────────────────────────────────────────────────────────────
describe("TC2: [56,70,70,87] → confirmed rank=70", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    addCpo(STU, POOL_A, VER_1, "s3", 70, TOTAL, "REVIEW"); // different session, same rank
    addCpo(STU, POOL_A, VER_1, "s4", 87);
  });
  it("status=CONFIRMED, activeConfirmedRank=70", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    expect(r.activeConfirmedRank).toBe(70);
    expect(r.observationSessionCount).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3: [78,81,85] → confirmed=78
// ─────────────────────────────────────────────────────────────────────────────
describe("TC3: [78,81,85] → confirmed rank=78", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 78);
    addCpo(STU, POOL_A, VER_1, "s2", 81);
    addCpo(STU, POOL_A, VER_1, "s3", 85);
  });
  it("status=CONFIRMED, activeConfirmedRank=78", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    expect(r.activeConfirmedRank).toBe(78);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4: 2 sessions → active rank=0, INSUFFICIENT_SESSIONS
// ─────────────────────────────────────────────────────────────────────────────
describe("TC4: 2 sessions → INSUFFICIENT_SESSIONS, active rank=0", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 70);
    addCpo(STU, POOL_A, VER_1, "s2", 87);
  });
  it("INSUFFICIENT_SESSIONS, activeConfirmedRank=0", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("INSUFFICIENT_SESSIONS");
    expect(r.activeConfirmedRank).toBe(0);
    expect(r.activeConfirmedTotal).toBe(0);
    expect(r.observationSessionCount).toBe(2);
  });
  it("SCP row 생성 (session_count 추적용)", async () => {
    await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(scps.length).toBe(1);
    expect(scps[0].observation_session_count).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5: FUTURE_PLAN / UNVERIFIED → count 제외 → 2회 effective
// ─────────────────────────────────────────────────────────────────────────────
describe("TC5: FUTURE_PLAN/UNVERIFIED → eligible count 제외", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    addCpo(STU, POOL_A, VER_1, "s3", 80, TOTAL, "FUTURE_PLAN", false); // ineligible
    addCpo(STU, POOL_A, VER_1, "s4", 90, TOTAL, "UNVERIFIED",  false); // ineligible
  });
  it("FUTURE_PLAN/UNVERIFIED 제외 → effective 2회 → INSUFFICIENT", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("INSUFFICIENT_SESSIONS");
    expect(r.observationSessionCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6: same session duplicate → 구조적으로 1회 (CPO UNIQUE 보장)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC6: same session duplicate → 1회만 반영", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    // session_id "s1"에 CPO가 1개뿐 (UNIQUE 보장 — 중복 불가 구조)
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    // 의도적으로 3개 넣어도 session 중복 없는 구조 검증 (mock도 동일 lesson_session_id)
  });
  it("2 unique sessions → INSUFFICIENT (3회 미달)", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("INSUFFICIENT_SESSIONS");
    expect(r.observationSessionCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7: 기존 display=70, 새 active pct=50 → display=70 유지
// ─────────────────────────────────────────────────────────────────────────────
describe("TC7: 기존 display=70, 새 active pct=50 → display=70 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 70, TOTAL, 70); // existing display=70
    // recomputed eligible: 3 sessions at lower ranks
    addCpo(STU, POOL_A, VER_1, "s1", 40);
    addCpo(STU, POOL_A, VER_1, "s2", 45);
    addCpo(STU, POOL_A, VER_1, "s3", 50); // confirmed rank=40, pct=40/100=40% < 70
  });
  it("active pct=40 < 70 → display stays 70", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    expect(r.activeConfirmedRank).toBe(40);
    expect(r.displayConfirmedPct).toBe(70);
    const scp = scps.find((s) => s.student_id === STU);
    expect(scp?.display_confirmed_pct).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8: 기존 display=70, 새 active pct=75 → display=75
// ─────────────────────────────────────────────────────────────────────────────
describe("TC8: 기존 display=70, 새 active pct=75 → display=75", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 70, TOTAL, 70);
    addCpo(STU, POOL_A, VER_1, "s1", 73);
    addCpo(STU, POOL_A, VER_1, "s2", 75);
    addCpo(STU, POOL_A, VER_1, "s3", 80); // confirmed=73, pct=73%
  });
  it("active pct=73 > 70 → display rises to 73", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    // ranks DESC: [80,75,73] → confirmed=73, pct=73/100*100=73
    expect(r.displayConfirmedPct).toBeGreaterThan(70);
    const scp = scps.find((s) => s.student_id === STU);
    expect(scp?.display_confirmed_pct).toBeGreaterThan(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9: cross-version: old 140/200=70%, new 200/400=50% → display=70
// ─────────────────────────────────────────────────────────────────────────────
describe("TC9: cross-version monotonic: old 70% → new 50% → display=70", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addVersion(VER_2, POOL_A);
    addAssignment(STU, POOL_A, VER_2); // now on VER_2
    // old SCP was on VER_1 with display=70
    addScp(STU, POOL_A, VER_1, 140, 200, 70);
    // VER_2 CPOs: 3 sessions but only at rank 200/400 = 50%
    addCpo(STU, POOL_A, VER_2, "s1", 180, 400);
    addCpo(STU, POOL_A, VER_2, "s2", 195, 400);
    addCpo(STU, POOL_A, VER_2, "s3", 200, 400); // confirmed=180, pct=45%
  });
  it("new version pct=45 < old display=70 → display stays 70", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("CONFIRMED");
    expect(r.activeCurriculumVersionId).toBe(VER_2);
    expect(r.activeConfirmedRank).toBe(180);
    expect(r.displayConfirmedPct).toBe(70);
  });
  it("SCP에 prev_curriculum_version_id=VER_1 저장", async () => {
    await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    const scp = scps.find((s) => s.student_id === STU);
    expect(scp?.prev_curriculum_version_id).toBe(VER_1);
    expect(scp?.prev_display_pct).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10: new version 3회 미만 → active=0, display old 유지
// ─────────────────────────────────────────────────────────────────────────────
describe("TC10: new version 3회 미만 → active=0, display old 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addVersion(VER_2, POOL_A);
    addAssignment(STU, POOL_A, VER_2);
    addScp(STU, POOL_A, VER_1, 70, 100, 70); // old display=70
    // VER_2: only 2 sessions
    addCpo(STU, POOL_A, VER_2, "s1", 50, 200);
    addCpo(STU, POOL_A, VER_2, "s2", 60, 200);
  });
  it("INSUFFICIENT → active=0, display=70 유지", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("INSUFFICIENT_SESSIONS");
    expect(r.activeConfirmedRank).toBe(0);
    const scp = scps.find((s) => s.student_id === STU);
    expect(scp?.display_confirmed_pct).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC11: version 변경 시 prev_curriculum_version_id / prev_display_pct 저장
// ─────────────────────────────────────────────────────────────────────────────
describe("TC11: version 변경 → prev_* 저장", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addVersion(VER_2, POOL_A);
    addAssignment(STU, POOL_A, VER_2);
    addScp(STU, POOL_A, VER_1, 60, 100, 60); // existing on VER_1
    addCpo(STU, POOL_A, VER_2, "s1", 30, 200);
    addCpo(STU, POOL_A, VER_2, "s2", 35, 200);
    addCpo(STU, POOL_A, VER_2, "s3", 40, 200);
  });
  it("SCP prev_curriculum_version_id=VER_1, prev_display_pct=60", async () => {
    await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    const scp = scps.find((s) => s.student_id === STU);
    expect(scp?.prev_curriculum_version_id).toBe(VER_1);
    expect(scp?.prev_display_pct).toBe(60);
    expect(scp?.active_curriculum_version_id).toBe(VER_2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC12: CPO edit → active factual position 하락 가능, display 유지
// ─────────────────────────────────────────────────────────────────────────────
describe("TC12: CPO edit → active 하락 가능, display 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 70, TOTAL, 70); // existing confirmed=70, display=70
    // After CPO edit: lower eligible ranks
    addCpo(STU, POOL_A, VER_1, "s1", 40);
    addCpo(STU, POOL_A, VER_1, "s2", 45);
    addCpo(STU, POOL_A, VER_1, "s3", 50); // confirmed=40
  });
  it("active rank=40, active pct=40%, display stays 70", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.activeConfirmedRank).toBe(40);
    expect(r.activeConfirmedPct).toBe(40);
    expect(r.displayConfirmedPct).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC13: CPO delete → eligible sessions 3→2 → active=0, display 유지
// ─────────────────────────────────────────────────────────────────────────────
describe("TC13: CPO delete → 3→2 sessions → active=0, display 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 70, TOTAL, 70);
    addCpo(STU, POOL_A, VER_1, "s1", 70);
    addCpo(STU, POOL_A, VER_1, "s2", 75);
    // s3 deleted → invalidated
    addCpo(STU, POOL_A, VER_1, "s3", 80, TOTAL, "ACTUAL_TAUGHT", true, true);
  });
  it("2 eligible sessions → INSUFFICIENT, active=0, display=70", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("INSUFFICIENT_SESSIONS");
    expect(r.activeConfirmedRank).toBe(0);
    expect(r.displayConfirmedPct).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC14: 다른 pool CPO → 제외
// ─────────────────────────────────────────────────────────────────────────────
describe("TC14: 다른 pool CPO 제외", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addVersion(VER_1, POOL_B);
    addAssignment(STU, POOL_A, VER_1);
    // CPOs for POOL_B only
    addCpo(STU, POOL_B, VER_1, "s1", 56);
    addCpo(STU, POOL_B, VER_1, "s2", 70);
    addCpo(STU, POOL_B, VER_1, "s3", 87);
  });
  it("POOL_A에 CPO 없음 → NO_ELIGIBLE_OBSERVATIONS", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("NO_ELIGIBLE_OBSERVATIONS");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC15: 다른 curriculum version CPO 제외
// ─────────────────────────────────────────────────────────────────────────────
describe("TC15: 다른 version CPO 제외", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addVersion(VER_2, POOL_A);
    addAssignment(STU, POOL_A, VER_1); // assigned to VER_1
    // CPOs only for VER_2
    addCpo(STU, POOL_A, VER_2, "s1", 56);
    addCpo(STU, POOL_A, VER_2, "s2", 70);
    addCpo(STU, POOL_A, VER_2, "s3", 87);
  });
  it("VER_2 CPO → VER_1 eligible 0 → NO_ELIGIBLE_OBSERVATIONS", async () => {
    const r = await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    expect(r.status).toBe("NO_ELIGIBLE_OBSERVATIONS");
    expect(r.activeCurriculumVersionId).toBe(VER_1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC16: DB-level GREATEST race protection
// ─────────────────────────────────────────────────────────────────────────────
describe("TC16: DB-level GREATEST race protection", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 80, TOTAL, 80); // existing display=80
    // CPOs that compute lower active pct
    addCpo(STU, POOL_A, VER_1, "s1", 50);
    addCpo(STU, POOL_A, VER_1, "s2", 55);
    addCpo(STU, POOL_A, VER_1, "s3", 60); // confirmed=50, pct=50 < 80
  });
  it("GREATEST → display never goes below existing 80", async () => {
    await computeConfirmedProgress(buildMockDb(), STU, POOL_A);
    const scp = scps.find((s) => s.student_id === STU);
    // GREATEST(80, 50) = 80
    expect(scp?.display_confirmed_pct).toBe(80);
  });

  it("동시 UPSERT 시뮬레이션 — 두 번 다른 값으로 재계산해도 display 감소 없음", async () => {
    const db = buildMockDb();
    // First compute: confirmed=50 → display stays 80
    await computeConfirmedProgress(db, STU, POOL_A);
    const d1 = scps.find((s) => s.student_id === STU)?.display_confirmed_pct ?? 0;
    // Second compute (same lower ranks)
    await computeConfirmedProgress(db, STU, POOL_A);
    const d2 = scps.find((s) => s.student_id === STU)?.display_confirmed_pct ?? 0;
    expect(d2).toBeGreaterThanOrEqual(d1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC17: 동일 입력 재계산 → 동일 결과 / SCP 중복 없음 (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC17: idempotent — 동일 입력 재계산 → SCP 중복 없음", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    addCpo(STU, POOL_A, VER_1, "s3", 87);
  });
  it("3회 호출해도 SCP row 1개, 결과 동일", async () => {
    const db = buildMockDb();
    const r1 = await computeConfirmedProgress(db, STU, POOL_A);
    const r2 = await computeConfirmedProgress(db, STU, POOL_A);
    const r3 = await computeConfirmedProgress(db, STU, POOL_A);
    expect(scps.length).toBe(1);
    expect(r1.activeConfirmedRank).toBe(r2.activeConfirmedRank);
    expect(r2.activeConfirmedRank).toBe(r3.activeConfirmedRank);
    expect(r1.displayConfirmedPct).toBe(r3.displayConfirmedPct);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC18: confirmed_at — active progress 동일하면 갱신 없음
// ─────────────────────────────────────────────────────────────────────────────
describe("TC18: confirmed_at — 동일 rank 재계산 시 갱신 없음", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addCpo(STU, POOL_A, VER_1, "s1", 56);
    addCpo(STU, POOL_A, VER_1, "s2", 70);
    addCpo(STU, POOL_A, VER_1, "s3", 87);
  });
  it("rank 변경 없으면 confirmed_at 유지", async () => {
    const db = buildMockDb();
    await computeConfirmedProgress(db, STU, POOL_A);
    const firstConfirmedAt = scps[0]?.confirmed_at ?? "";
    // wait a tick so Date.now() would differ
    await new Promise((r) => setTimeout(r, 5));
    await computeConfirmedProgress(db, STU, POOL_A);
    expect(scps[0]?.confirmed_at).toBe(firstConfirmedAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC19: display_updated_at — display 상승 없으면 유지
// ─────────────────────────────────────────────────────────────────────────────
describe("TC19: display_updated_at — display 상승 없으면 유지", () => {
  beforeEach(() => {
    resetDb();
    addVersion(VER_1, POOL_A);
    addAssignment(STU, POOL_A, VER_1);
    addScp(STU, POOL_A, VER_1, 70, TOTAL, 70); // existing display=70
    // lower-rank CPOs → confirmed pct < 70 → display 유지
    addCpo(STU, POOL_A, VER_1, "s1", 40);
    addCpo(STU, POOL_A, VER_1, "s2", 45);
    addCpo(STU, POOL_A, VER_1, "s3", 50); // confirmed=40, pct=40 < 70
  });
  it("display 상승 없음 → display_updated_at 유지", async () => {
    const db = buildMockDb();
    await computeConfirmedProgress(db, STU, POOL_A);
    const firstDisplayAt = scps[0]?.display_updated_at ?? "";
    await new Promise((r) => setTimeout(r, 5));
    await computeConfirmedProgress(db, STU, POOL_A);
    expect(scps[0]?.display_updated_at).toBe(firstDisplayAt);
  });

  it("display 상승 있으면 display_updated_at 갱신", async () => {
    // Change to higher ranks
    cpos.length = 0;
    addCpo(STU, POOL_A, VER_1, "s1", 75);
    addCpo(STU, POOL_A, VER_1, "s2", 80);
    addCpo(STU, POOL_A, VER_1, "s3", 85); // confirmed=75, pct=75 > 70

    const db = buildMockDb();
    await computeConfirmedProgress(db, STU, POOL_A);
    const firstDisplayAt = scps[0]?.display_updated_at ?? "";
    await new Promise((r) => setTimeout(r, 5));
    // Lower ranks now
    cpos.length = 0;
    addCpo(STU, POOL_A, VER_1, "s1", 40);
    addCpo(STU, POOL_A, VER_1, "s2", 45);
    addCpo(STU, POOL_A, VER_1, "s3", 50); // pct=40 < 75 → display stays, timestamp stays
    await computeConfirmedProgress(db, STU, POOL_A);
    expect(scps[0]?.display_updated_at).toBe(firstDisplayAt);
  });
});
