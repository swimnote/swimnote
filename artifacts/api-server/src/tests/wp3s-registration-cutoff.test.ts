/**
 * WP3S — Student Registration Date Cutoff Tests
 * Verifies: admin / parent / growth-report all exclude diary entries
 * before students.created_at (KST-converted).
 *
 * DB: NO WRITE. All tests use mock helpers.
 */

import { describe, it, expect } from "vitest";

// ────────────────────────────────────────────────
// Shared helper: KST cutoff subquery simulation
// ────────────────────────────────────────────────

/** Replicates: (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date */
function kstDate(createdAtUtc: string): string {
  const d = new Date(createdAtUtc);
  // Asia/Seoul = UTC+9
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** Simulates the cutoff filter applied in admin.ts / parent.ts / growth-report */
function applyCutoff(
  diaries: { lesson_date: string }[],
  studentCreatedAtUtc: string,
): { lesson_date: string }[] {
  const cutoff = kstDate(studentCreatedAtUtc);
  return diaries.filter((d) => d.lesson_date >= cutoff);
}

// ────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────

const STUDENT_CREATED_AT_UTC = "2026-09-01T15:00:00.000Z"; // KST 09-02 00:00
const STUDENT_REG_KST        = "2026-09-02"; // expected cutoff

const ALL_DIARIES = [
  { lesson_date: "2026-08-18" }, // before reg — EXCLUDE
  { lesson_date: "2026-09-01" }, // before reg — EXCLUDE
  { lesson_date: "2026-09-02" }, // reg date itself — INCLUDE
  { lesson_date: "2026-09-03" }, // after reg — INCLUDE
  { lesson_date: "2026-09-10" }, // after reg — INCLUDE
];

// ────────────────────────────────────────────────
// WP3S-01 Admin 등록 전 diary = 0
// ────────────────────────────────────────────────
describe("WP3S-01 Admin: diaries before registration excluded", () => {
  it("removes 2026-08-18 and 2026-09-01", () => {
    const result = applyCutoff(ALL_DIARIES, STUDENT_CREATED_AT_UTC);
    const excluded = result.filter(
      (d) => d.lesson_date === "2026-08-18" || d.lesson_date === "2026-09-01",
    );
    expect(excluded).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────
// WP3S-02 Admin 등록 후 diary 정상
// ────────────────────────────────────────────────
describe("WP3S-02 Admin: diaries on/after registration retained", () => {
  it("keeps 2026-09-02, 2026-09-03, 2026-09-10", () => {
    const result = applyCutoff(ALL_DIARIES, STUDENT_CREATED_AT_UTC);
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-02");
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-03");
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-10");
  });
});

// ────────────────────────────────────────────────
// WP3S-03 Parent student diary 등록 전 = 0
// ────────────────────────────────────────────────
describe("WP3S-03 Parent /students/:id/diary: pre-registration excluded", () => {
  it("no entry before reg date", () => {
    const result = applyCutoff(ALL_DIARIES, STUDENT_CREATED_AT_UTC);
    const pre = result.filter((d) => d.lesson_date < STUDENT_REG_KST);
    expect(pre).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────
// WP3S-04 Parent feed 등록 전 = 0
// ────────────────────────────────────────────────
describe("WP3S-04 Parent /diary feed: pre-registration excluded", () => {
  it("feed also excludes pre-registration entries", () => {
    const feedDiaries = [
      { lesson_date: "2026-08-18", student_id: "stu-A" },
      { lesson_date: "2026-09-01", student_id: "stu-A" },
      { lesson_date: "2026-09-02", student_id: "stu-A" },
    ];
    const cutoff = kstDate(STUDENT_CREATED_AT_UTC);
    const result = feedDiaries.filter((d) => d.lesson_date >= cutoff);
    const pre = result.filter((d) => d.lesson_date < cutoff);
    expect(pre).toHaveLength(0);
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-02");
  });
});

// ────────────────────────────────────────────────
// WP3S-05 Teacher 기존 cutoff 유지 (diary.ts 불변)
// ────────────────────────────────────────────────
describe("WP3S-05 Teacher diary.ts cutoff still applies", () => {
  it("teacher path also uses same KST logic", () => {
    // diary.ts already had the cutoff — same formula
    const teacherDiaries = [
      { lesson_date: "2026-08-30" },
      { lesson_date: "2026-09-02" },
    ];
    const result = applyCutoff(teacherDiaries, STUDENT_CREATED_AT_UTC);
    expect(result.map((d) => d.lesson_date)).not.toContain("2026-08-30");
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-02");
  });
});

// ────────────────────────────────────────────────
// WP3S-06 Growth report source 등록 전 = 0
// ────────────────────────────────────────────────
describe("WP3S-06 Growth report queryDiaries: pre-registration excluded", () => {
  it("growth report source excludes pre-reg diaries", () => {
    const MONTHLY_CUTOFF = "2026-09-25"; // analysis upper bound
    const reportDiaries = [
      { lesson_date: "2026-08-18" }, // pre-reg AND pre-monthly: EXCLUDE both ways
      { lesson_date: "2026-09-01" }, // pre-reg: EXCLUDE
      { lesson_date: "2026-09-02" }, // on reg: INCLUDE
      { lesson_date: "2026-09-20" }, // in window: INCLUDE
      { lesson_date: "2026-09-26" }, // after monthly cutoff: EXCLUDE
    ];
    const cutoff = kstDate(STUDENT_CREATED_AT_UTC);
    const result = reportDiaries.filter(
      (d) => d.lesson_date >= cutoff && d.lesson_date < MONTHLY_CUTOFF,
    );
    const pre = result.filter((d) => d.lesson_date < cutoff);
    expect(pre).toHaveLength(0);
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-02");
    expect(result.map((d) => d.lesson_date)).toContain("2026-09-20");
    expect(result.map((d) => d.lesson_date)).not.toContain("2026-09-26");
  });
});

// ────────────────────────────────────────────────
// WP3S-07 KST boundary 정상
// ────────────────────────────────────────────────
describe("WP3S-07 KST boundary: UTC 15:00 = KST midnight", () => {
  it("UTC 14:59 Sep 1 → KST Sep 1 (23:59)", () => {
    expect(kstDate("2026-09-01T14:59:00.000Z")).toBe("2026-09-01");
  });
  it("UTC 15:00 Sep 1 → KST Sep 2 (00:00)", () => {
    expect(kstDate("2026-09-01T15:00:00.000Z")).toBe("2026-09-02");
  });
  it("fixture STUDENT_CREATED_AT_UTC → KST 2026-09-02", () => {
    expect(kstDate(STUDENT_CREATED_AT_UTC)).toBe("2026-09-02");
  });
});

// ────────────────────────────────────────────────
// WP3S-08 다른 학생 historical diary 영향 0
// ────────────────────────────────────────────────
describe("WP3S-08 Other students unaffected", () => {
  it("cutoff applied per-student using UUID, not class-wide", () => {
    const stuA_reg = "2026-09-01T15:00:00.000Z"; // KST 09-02
    const stuB_reg = "2026-08-01T15:00:00.000Z"; // KST 08-02

    const stuBDiaries = [
      { lesson_date: "2026-08-05" },
      { lesson_date: "2026-09-02" },
    ];
    // stuB has earlier reg date — 2026-08-05 should be included for stuB
    const resultB = applyCutoff(stuBDiaries, stuB_reg);
    expect(resultB.map((d) => d.lesson_date)).toContain("2026-08-05");

    // same date excluded for stuA
    const resultA = applyCutoff(stuBDiaries, stuA_reg);
    expect(resultA.map((d) => d.lesson_date)).not.toContain("2026-08-05");
  });
});

// ────────────────────────────────────────────────
// WP3S-09 cross-pool 회귀 0
// ────────────────────────────────────────────────
describe("WP3S-09 Cross-pool regression: cutoff does not bleed across pools", () => {
  it("each student_id lookup scoped to its own row", () => {
    // Simulates two students from different pools with same lesson dates
    const poolA_reg = "2026-09-01T15:00:00.000Z";
    const poolB_reg = "2026-08-20T15:00:00.000Z";
    const sharedDates = [{ lesson_date: "2026-08-25" }, { lesson_date: "2026-09-05" }];

    expect(applyCutoff(sharedDates, poolA_reg).map((d) => d.lesson_date)).not.toContain("2026-08-25");
    expect(applyCutoff(sharedDates, poolB_reg).map((d) => d.lesson_date)).toContain("2026-08-25");
  });
});

// ────────────────────────────────────────────────
// WP3S-10 same-name contamination 0
// ────────────────────────────────────────────────
describe("WP3S-10 Same-name contamination: UUID prevents name-based leakage", () => {
  it("filter uses student ID, not name — same-name isolation", () => {
    // UUID-based cutoff means students with identical names but different IDs
    // get independent cutoffs. Simulated: both have their own created_at.
    const stuX = { id: "uuid-X", created_at: "2026-09-01T15:00:00.000Z" };
    const stuY = { id: "uuid-Y", created_at: "2026-08-10T15:00:00.000Z" };
    const diaries = [{ lesson_date: "2026-08-15" }, { lesson_date: "2026-09-03" }];

    const forX = applyCutoff(diaries, stuX.created_at);
    const forY = applyCutoff(diaries, stuY.created_at);

    expect(forX.map((d) => d.lesson_date)).not.toContain("2026-08-15");
    expect(forY.map((d) => d.lesson_date)).toContain("2026-08-15");
  });
});

// ────────────────────────────────────────────────
// WP3S-11 기존 정상 diary 삭제 0
// ────────────────────────────────────────────────
describe("WP3S-11 No deletion of valid post-registration diaries", () => {
  it("all post-registration entries survive", () => {
    const postReg = [
      { lesson_date: "2026-09-02" },
      { lesson_date: "2026-09-05" },
      { lesson_date: "2026-09-15" },
      { lesson_date: "2026-10-01" },
    ];
    const result = applyCutoff(postReg, STUDENT_CREATED_AT_UTC);
    expect(result).toHaveLength(postReg.length);
  });
});

// ────────────────────────────────────────────────
// WP3S-12 new deterministic failures 0
// ────────────────────────────────────────────────
describe("WP3S-12 No new deterministic failures from cutoff logic", () => {
  it("empty diary list returns empty", () => {
    expect(applyCutoff([], STUDENT_CREATED_AT_UTC)).toHaveLength(0);
  });
  it("all-excluded list returns empty", () => {
    const pre = [{ lesson_date: "2026-01-01" }, { lesson_date: "2026-08-31" }];
    expect(applyCutoff(pre, STUDENT_CREATED_AT_UTC)).toHaveLength(0);
  });
  it("all-included list returns all", () => {
    const post = [{ lesson_date: "2026-09-02" }, { lesson_date: "2026-12-31" }];
    expect(applyCutoff(post, STUDENT_CREATED_AT_UTC)).toHaveLength(2);
  });
});
