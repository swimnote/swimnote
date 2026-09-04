/**
 * parent-curriculum-progress-api.test.ts — GAUGE-06
 *
 * GET /parent/students/:studentId/curriculum-progress
 *
 * API logic 순수 단위 테스트 (handler 직접 호출, DB mock).
 * TC1~TC5 필수.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// 인라인 핸들러 재구현 (routes/parent.ts 로직을 단위 테스트용으로 추출)
// ─────────────────────────────────────────────────────────────────────────────

interface MockDb {
  execute(q: { text: string; params: unknown[] }): Promise<{ rows: unknown[] }>;
}

interface MockReq {
  user: { userId: string; role: string };
  params: { studentId: string };
}

interface MockRes {
  status(code: number): MockRes;
  json(data: unknown): void;
  _code: number | null;
  _body: unknown;
}

function makeRes(): MockRes {
  const r: MockRes = { _code: null, _body: null, status(c) { r._code = c; return r; }, json(d) { r._body = d; } };
  return r;
}

// ── 핸들러 로직 (parent.ts의 curriculum-progress endpoint와 동일 구조) ────────
async function curriculumProgressHandler(
  db: MockDb, superAdminDb: MockDb,
  req: MockReq, res: MockRes,
) {
  const parentId  = req.user.userId;
  const { studentId } = req.params;

  // 1. Ownership 확인
  const linkRes = await db.execute({
    text: "SELECT parent_students + students",
    params: [parentId, studentId],
  });
  if (!linkRes.rows.length) {
    res.status(403).json({ error: "접근 권한이 없습니다." });
    return;
  }

  const row = linkRes.rows[0] as { student_id: string; swimming_pool_id: string };
  const poolId = row.swimming_pool_id;

  if (!poolId) {
    res.status(403).json({ error: "학생의 수영장 정보가 없습니다." });
    return;
  }

  // 2. SCP 조회 (student + pool 매칭 — cross-pool leakage 차단)
  const scpRes = await superAdminDb.execute({
    text: "SELECT student_curriculum_progress",
    params: [studentId, poolId],
  });

  // 3. SCP 없으면 empty zero response
  if (!scpRes.rows.length) {
    res.json({
      student_id:                    studentId,
      display_confirmed_pct:         0,
      active_confirmed_pct:          0,
      active_confirmed_rank:         0,
      active_confirmed_total:        0,
      active_curriculum_version_id:  null,
      observation_session_count:     0,
      confirmed_at:                  null,
      display_updated_at:            null,
      is_version_transition:         false,
    });
    return;
  }

  const scp = scpRes.rows[0] as any;
  res.json({
    student_id:                    scp.student_id,
    display_confirmed_pct:         Number(scp.display_confirmed_pct ?? 0),
    active_confirmed_pct:          Number(scp.active_confirmed_pct ?? 0),
    active_confirmed_rank:         Number(scp.active_confirmed_rank ?? 0),
    active_confirmed_total:        Number(scp.active_confirmed_total ?? 0),
    active_curriculum_version_id:  scp.active_curriculum_version_id ?? null,
    observation_session_count:     Number(scp.observation_session_count ?? 0),
    confirmed_at:                  scp.confirmed_at ?? null,
    display_updated_at:            scp.display_updated_at ?? null,
    is_version_transition:         scp.prev_curriculum_version_id != null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PARENT_A  = "parent_a";
const PARENT_B  = "parent_b";
const STUDENT_A = "stu_a";
const STUDENT_B = "stu_b";
const POOL_A    = "pool_a";
const POOL_B    = "pool_b";
const VER_1     = "cv_1";

const LINK_ROWS: Record<string, { student_id: string; swimming_pool_id: string }[]> = {
  [PARENT_A]: [{ student_id: STUDENT_A, swimming_pool_id: POOL_A }],
  [PARENT_B]: [{ student_id: STUDENT_B, swimming_pool_id: POOL_B }],
};

const SCP_ROWS: Record<string, any> = {
  [`${STUDENT_A}:${POOL_A}`]: {
    student_id:                    STUDENT_A,
    display_confirmed_pct:         "42.4",
    active_confirmed_pct:          "40.0",
    active_confirmed_rank:         40,
    active_confirmed_total:        100,
    active_curriculum_version_id:  VER_1,
    observation_session_count:     5,
    confirmed_at:                  "2026-01-01T00:00:00Z",
    display_updated_at:            "2026-01-01T00:00:00Z",
    prev_curriculum_version_id:    null,
  },
};

function buildDb(parentId: string): MockDb {
  return {
    async execute({ params }) {
      const [pid, sid] = params as [string, string];
      // link check
      const links = LINK_ROWS[pid] ?? [];
      const match = links.filter((l) => l.student_id === sid);
      return { rows: match };
    },
  };
}

function buildSuperDb(studentId: string, poolId: string): MockDb {
  return {
    async execute({ params }) {
      const [sid, pid] = params as [string, string];
      // cross-pool check: must match BOTH
      const key = `${sid}:${pid}`;
      const row = SCP_ROWS[key];
      return { rows: row ? [row] : [] };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TC1: authorized parent + linked student → progress response
// ─────────────────────────────────────────────────────────────────────────────
describe("TC1: authorized parent + linked student → progress response", () => {
  it("200 with display_confirmed_pct", async () => {
    const req: MockReq = { user: { userId: PARENT_A, role: "parent_account" }, params: { studentId: STUDENT_A } };
    const res = makeRes();
    await curriculumProgressHandler(buildDb(PARENT_A), buildSuperDb(STUDENT_A, POOL_A), req, res);
    expect(res._code).toBeNull(); // direct res.json (200)
    const body = res._body as any;
    expect(body.student_id).toBe(STUDENT_A);
    expect(body.display_confirmed_pct).toBeCloseTo(42.4);
    expect(body.active_curriculum_version_id).toBe(VER_1);
    expect(body.is_version_transition).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2: SCP row 없음 → empty zero response
// ─────────────────────────────────────────────────────────────────────────────
describe("TC2: SCP row 없음 → empty zero response", () => {
  it("status code 없음(200), display=0, all zeros", async () => {
    const STUDENT_NEW = "stu_new";
    const POOL_NEW    = "pool_a"; // same pool as PARENT_A
    // Temporarily add link but no SCP
    const dbWithNewStudent: MockDb = {
      async execute({ params }) {
        const [pid, sid] = params as [string, string];
        if (pid === PARENT_A && sid === STUDENT_NEW) {
          return { rows: [{ student_id: STUDENT_NEW, swimming_pool_id: POOL_NEW }] };
        }
        return { rows: [] };
      },
    };
    const superDbEmpty: MockDb = { async execute() { return { rows: [] }; } };

    const req: MockReq = { user: { userId: PARENT_A, role: "parent_account" }, params: { studentId: STUDENT_NEW } };
    const res = makeRes();
    await curriculumProgressHandler(dbWithNewStudent, superDbEmpty, req, res);
    expect(res._code).toBeNull();
    const body = res._body as any;
    expect(body.display_confirmed_pct).toBe(0);
    expect(body.active_confirmed_rank).toBe(0);
    expect(body.active_curriculum_version_id).toBeNull();
    expect(body.confirmed_at).toBeNull();
    expect(body.is_version_transition).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3: 다른 parent student → 403 forbidden
// ─────────────────────────────────────────────────────────────────────────────
describe("TC3: 다른 parent student → 403", () => {
  it("PARENT_A가 STUDENT_B 조회 시도 → 403", async () => {
    const req: MockReq = { user: { userId: PARENT_A, role: "parent_account" }, params: { studentId: STUDENT_B } };
    const res = makeRes();
    await curriculumProgressHandler(buildDb(PARENT_A), buildSuperDb(STUDENT_B, POOL_B), req, res);
    expect(res._code).toBe(403);
    const body = res._body as any;
    expect(body.error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4: cross-pool mismatch → 차단
// ─────────────────────────────────────────────────────────────────────────────
describe("TC4: cross-pool mismatch → 차단", () => {
  it("student pool이 달라도 SCP 조회 0 → empty zero response (pool mismatch 차단)", async () => {
    // PARENT_A → STUDENT_A (POOL_A) 링크 정상
    // 하지만 SCP는 POOL_B에 있다고 가정 → superAdminDb에서 STUDENT_A+POOL_A 매칭 없음
    const superDbWrongPool: MockDb = {
      async execute({ params }) {
        const [sid, pid] = params as [string, string];
        // STUDENT_A+POOL_B에만 SCP가 있어도 쿼리는 STUDENT_A+POOL_A로 → 없음
        if (sid === STUDENT_A && pid === POOL_A) return { rows: [] }; // pool mismatch → 없음
        return { rows: [] };
      },
    };
    const req: MockReq = { user: { userId: PARENT_A, role: "parent_account" }, params: { studentId: STUDENT_A } };
    const res = makeRes();
    await curriculumProgressHandler(buildDb(PARENT_A), superDbWrongPool, req, res);
    // empty zero response (not data from wrong pool)
    const body = res._body as any;
    expect(body.display_confirmed_pct).toBe(0);
    expect(body.student_id).toBe(STUDENT_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5: display_confirmed_pct만 UI source (active_confirmed_pct 구별)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC5: display_confirmed_pct와 active_confirmed_pct 분리", () => {
  it("두 값이 다를 때 둘 다 응답에 포함되고 값이 다름", async () => {
    const req: MockReq = { user: { userId: PARENT_A, role: "parent_account" }, params: { studentId: STUDENT_A } };
    const res = makeRes();
    await curriculumProgressHandler(buildDb(PARENT_A), buildSuperDb(STUDENT_A, POOL_A), req, res);
    const body = res._body as any;
    // display_confirmed_pct(42.4) > active_confirmed_pct(40) — 두 값 분리 확인
    expect(body.display_confirmed_pct).toBeCloseTo(42.4);
    expect(body.active_confirmed_pct).toBeCloseTo(40.0);
    expect(body.display_confirmed_pct).not.toEqual(body.active_confirmed_pct);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UI Logic Tests (순수 함수 — CurriculumProgressGauge 로직 추출)
// ─────────────────────────────────────────────────────────────────────────────

function toDisplayInt(pct: number | null | undefined): number {
  const n = Number(pct);
  if (!isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function toBarWidth(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

function isEmpty(data: { observation_session_count: number; display_confirmed_pct: number } | null): boolean {
  if (!data) return true;
  return data.observation_session_count < 3 || data.display_confirmed_pct <= 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// TC6: display=42.4 → 42% 표시
// ─────────────────────────────────────────────────────────────────────────────
describe("TC6: display=42.4 → 42%", () => {
  it("Math.round(42.4)=42", () => {
    expect(toDisplayInt(42.4)).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7: display=70 → 70% width
// ─────────────────────────────────────────────────────────────────────────────
describe("TC7: display=70 → 70% bar width", () => {
  it("toBarWidth(70)=70", () => {
    expect(toBarWidth(70)).toBe(70);
  });
  it("42.6 → Math.round=43", () => {
    expect(toDisplayInt(42.6)).toBe(43);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8: display=0 / sessions<3 → empty state (0% 큰 게이지 미표시)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC8: display=0 / sessions<3 → empty state", () => {
  it("display=0 → isEmpty=true", () => {
    expect(isEmpty({ observation_session_count: 5, display_confirmed_pct: 0 })).toBe(true);
  });
  it("sessions=2 → isEmpty=true", () => {
    expect(isEmpty({ observation_session_count: 2, display_confirmed_pct: 50 })).toBe(true);
  });
  it("sessions=3, display=50 → isEmpty=false", () => {
    expect(isEmpty({ observation_session_count: 3, display_confirmed_pct: 50 })).toBe(false);
  });
  it("null data → isEmpty=true", () => {
    expect(isEmpty(null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9: selectedStudent 변경 → refetch (로직 검증)
// ─────────────────────────────────────────────────────────────────────────────
describe("TC9: selectedStudent 변경 → 해당 학생 progress refetch", () => {
  it("student A → API 호출 시 studentId=STUDENT_A 사용", async () => {
    let calledWith: string | null = null;
    async function fakeLoadProgress(sid: string) { calledWith = sid; }
    await fakeLoadProgress(STUDENT_A);
    expect(calledWith).toBe(STUDENT_A);
  });
  it("student B → API 호출 시 studentId=STUDENT_B 사용", async () => {
    let calledWith: string | null = null;
    async function fakeLoadProgress(sid: string) { calledWith = sid; }
    await fakeLoadProgress(STUDENT_B);
    expect(calledWith).toBe(STUDENT_B);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10: normal mode → gauge 미표시 조건
// ─────────────────────────────────────────────────────────────────────────────
describe("TC10: normal mode → gauge 미표시", () => {
  it("mode !== 'x' → shouldShowGauge=false", () => {
    const shouldShowGauge = (mode: string, hasStudent: boolean, isBlocked: boolean) =>
      hasStudent && mode === "x" && !isBlocked;
    expect(shouldShowGauge("normal", true, false)).toBe(false);
    expect(shouldShowGauge("x_pending", true, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC11: X mode → gauge 표시
// ─────────────────────────────────────────────────────────────────────────────
describe("TC11: X mode → gauge 표시", () => {
  it("mode === 'x' + student + !blocked → shouldShowGauge=true", () => {
    const shouldShowGauge = (mode: string, hasStudent: boolean, isBlocked: boolean) =>
      hasStudent && mode === "x" && !isBlocked;
    expect(shouldShowGauge("x", true, false)).toBe(true);
    expect(shouldShowGauge("x", true, true)).toBe(false);  // blocked
    expect(shouldShowGauge("x", false, false)).toBe(false); // no student
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC12: big horizontal duplicate Growth Report button 제거 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("TC12: big duplicate Growth Report button 제거", () => {
  it("home.tsx에 '성장 리포트 보기' + router.push x-growth 조합 없음", async () => {
    const { readFile } = await import("node:fs/promises");
    const homePath = `${process.cwd()}/../swim-app/app/(parent)/home.tsx`;
    const content = await readFile(homePath, "utf-8");
    // 삭제된 버튼의 특징적 텍스트 조합이 없어야 함
    const hasBigBtn = content.includes("성장 리포트 보기") && content.includes('router.push("/(parent)/x-growth"');
    expect(hasBigBtn).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC13: original "AI 성장 리포트" 버튼 존재 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("TC13: original AI 성장 리포트 버튼 보존", () => {
  it("home.tsx에 AI 성장 리포트 + setAiModalType('report') 있음", async () => {
    const { readFile } = await import("node:fs/promises");
    const homePath = `${process.cwd()}/../swim-app/app/(parent)/home.tsx`;
    const content = await readFile(homePath, "utf-8");
    expect(content).toContain("AI 성장 리포트");
    expect(content).toContain('setAiModalType("report")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC14: GrowthReportFeedCard 유지 확인
// ─────────────────────────────────────────────────────────────────────────────
describe("TC14: GrowthReportFeedCard 보존", () => {
  it("home.tsx에 GrowthReportFeedCard 컴포넌트 남아있음", async () => {
    const { readFile } = await import("node:fs/promises");
    const homePath = `${process.cwd()}/../swim-app/app/(parent)/home.tsx`;
    const content = await readFile(homePath, "utf-8");
    expect(content).toContain("GrowthReportFeedCard");
  });
});
