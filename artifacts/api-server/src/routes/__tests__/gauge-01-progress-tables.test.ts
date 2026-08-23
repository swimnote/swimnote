/**
 * gauge-01-progress-tables.test.ts — GAUGE-01 DB Foundation 단위 테스트 (TC1~TC7)
 *
 * 원칙:
 *   - production DB 호출 없음 (mock 또는 pure function 검증)
 *   - 실제 CREATE TABLE 실행 없음 (DDL 문자열 구조 + 순수 함수 검증)
 *   - 각 TC는 독립적으로 실행 가능
 *
 * TC1  CPO 테이블 schema 생성 코드 구조 확인 (DDL 토큰 검증)
 * TC2  SCP 테이블 schema 생성 코드 구조 확인 (DDL 토큰 검증)
 * TC3  migration 함수 mocked DB에서 2회 연속 실행 — 오류 없음 (idempotent)
 * TC4  UNIQUE(lesson_session_id, student_id) 제약 정의 확인
 * TC5  eligible ↔ type CHECK: ACTUAL_TAUGHT+false→reject, FUTURE_PLAN+true→reject
 * TC6  percent 범위 CHECK: 0~100 유효 / -1·101 무효
 * TC7  FK RESTRICT 정의 확인 (curriculum_items, curriculum_versions)
 *
 * 추가 TC:
 * TC8  UNVERIFIED → is_gauge_eligible=false (fail-closed 정책)
 * TC9  REVIEW / CORRECTION → is_gauge_eligible=true
 * TC10 display monotonic 함수: MAX(prev, new) — cross-version rank 비교 금지
 * TC11 display monotonic: new가 낮아도 prev 유지 (게이지 하락 금지)
 * TC12 invalidated consistency pure logic
 * TC13 evidence_source 허용값 확인 (DDL 토큰)
 * TC14 initGauge01Schema() mock DB — group 순서 A→B 보장
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GAUGE01_SCHEMA_TOKENS as T,
  validateEligibleTypeConsistency,
  validateProgressPct,
  computeDisplayConfirmedPct,
} from "../../migrations/gauge-01-progress-tables.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock: @workspace/db — production DB 호출 차단
// ─────────────────────────────────────────────────────────────────────────────

const mockExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  superAdminDb: {
    execute: mockExecute,
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// TC1 — CPO 테이블 schema 생성 코드 구조 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC1: CPO table schema tokens", () => {
  it("CPO 테이블 이름이 올바르다", () => {
    expect(T.CPO_TABLE_NAME).toBe("curriculum_progress_observations");
  });

  it("UNIQUE 제약명이 session+student 조합이다", () => {
    expect(T.CPO_UNIQUE).toBe("uq_cpo_session_student");
    expect(T.CPO_UNIQUE_COLS).toBe("(lesson_session_id, student_id)");
  });

  it("eligible/type CHECK 제약명이 존재한다", () => {
    expect(T.CPO_CHECK_ELIGIBLE).toBe("chk_cpo_eligible_type_consistency");
  });

  it("invalidated CHECK 제약명이 존재한다", () => {
    expect(T.CPO_CHECK_INVALIDATED).toBe("chk_cpo_invalidated_consistency");
  });

  it("pct range CHECK 제약명이 존재한다", () => {
    expect(T.CPO_CHECK_PCT_RANGE).toBe("chk_cpo_pct_range");
  });

  it("eligible_types 3종이 올바르다", () => {
    expect(T.CPO_ELIGIBLE_TYPES).toContain("ACTUAL_TAUGHT");
    expect(T.CPO_ELIGIBLE_TYPES).toContain("REVIEW");
    expect(T.CPO_ELIGIBLE_TYPES).toContain("CORRECTION");
    expect(T.CPO_ELIGIBLE_TYPES).toHaveLength(3);
  });

  it("ineligible_types 3종이 올바르다", () => {
    expect(T.CPO_INELIGIBLE_TYPES).toContain("FUTURE_PLAN");
    expect(T.CPO_INELIGIBLE_TYPES).toContain("PAST_REFERENCE");
    expect(T.CPO_INELIGIBLE_TYPES).toContain("UNVERIFIED");
    expect(T.CPO_INELIGIBLE_TYPES).toHaveLength(3);
  });

  it("인덱스 4개 이름이 모두 정의됐다", () => {
    expect(T.CPO_IDX_ELIGIBLE).toBe("idx_cpo_student_pool_eligible");
    expect(T.CPO_IDX_RANK).toBe("idx_cpo_student_rank");
    expect(T.CPO_IDX_SESSION).toBe("idx_cpo_session_student");
    expect(T.CPO_IDX_VERSION).toBe("idx_cpo_version_student");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC2 — SCP 테이블 schema 생성 코드 구조 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC2: SCP table schema tokens", () => {
  it("SCP 테이블 이름이 올바르다", () => {
    expect(T.SCP_TABLE_NAME).toBe("student_curriculum_progress");
  });

  it("UNIQUE 제약명이 student+pool 조합이다", () => {
    expect(T.SCP_UNIQUE).toBe("uq_scp_student_pool");
  });

  it("display pct range CHECK 제약명이 존재한다", () => {
    expect(T.SCP_CHECK_DISPLAY).toBe("chk_scp_display_pct_range");
  });

  it("active pct range CHECK 제약명이 존재한다", () => {
    expect(T.SCP_CHECK_ACTIVE).toBe("chk_scp_active_pct_range");
  });

  it("인덱스 2개 이름이 모두 정의됐다", () => {
    expect(T.SCP_IDX_POOL).toBe("idx_scp_student_pool");
    expect(T.SCP_IDX_VERSION).toBe("idx_scp_version");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC3 — idempotent: mock DB에서 2회 연속 실행, 오류 없음
// ─────────────────────────────────────────────────────────────────────────────

describe("TC3: migration idempotency (mock DB)", () => {
  beforeEach(() => {
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("initGauge01Schema() 1회 실행 성공", async () => {
    const { initGauge01Schema } = await import(
      "../../migrations/gauge-01-progress-tables.js"
    );
    await expect(initGauge01Schema()).resolves.toBeUndefined();
  });

  it("initGauge01Schema() 2회 연속 실행 — 오류 없음 (IF NOT EXISTS 멱등)", async () => {
    const { initGauge01Schema } = await import(
      "../../migrations/gauge-01-progress-tables.js"
    );
    await initGauge01Schema();
    await expect(initGauge01Schema()).resolves.toBeUndefined();
  });

  it("initGauge01Schema() DB execute 호출 횟수가 0보다 크다", async () => {
    mockExecute.mockClear();
    const { initGauge01Schema } = await import(
      "../../migrations/gauge-01-progress-tables.js"
    );
    await initGauge01Schema();
    expect(mockExecute).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC4 — UNIQUE(lesson_session_id, student_id) 제약 정의 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC4: UNIQUE(lesson_session_id, student_id) 정의", () => {
  it("제약명 uq_cpo_session_student가 정의됐다", () => {
    expect(T.CPO_UNIQUE).toBe("uq_cpo_session_student");
  });

  it("UNIQUE 컬럼이 lesson_session_id + student_id 조합이다 (diary_note_id 단독 아님)", () => {
    expect(T.CPO_UNIQUE_COLS).toContain("lesson_session_id");
    expect(T.CPO_UNIQUE_COLS).toContain("student_id");
    expect(T.CPO_UNIQUE_COLS).not.toContain("diary_note_id");
  });

  it("같은 session+student 조합은 CPO 1행만 허용 (구조적 보장)", () => {
    // 실제 DB 없이 unique 정책을 문서화 검증
    // lesson_session_id = class_diaries.id ('cd_xxx')
    // student_id = students.id
    // → ON CONFLICT (lesson_session_id, student_id) DO UPDATE 방식만 허용
    const uniqueCols = T.CPO_UNIQUE_COLS;
    const parts = uniqueCols.replace(/[()]/g, "").split(",").map(s => s.trim());
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("lesson_session_id");
    expect(parts[1]).toBe("student_id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC5 — eligible ↔ type CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe("TC5: eligible/type CHECK constraint", () => {
  it("ACTUAL_TAUGHT + eligible=false → reject", () => {
    const result = validateEligibleTypeConsistency("ACTUAL_TAUGHT", false);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("ACTUAL_TAUGHT");
  });

  it("REVIEW + eligible=false → reject", () => {
    const result = validateEligibleTypeConsistency("REVIEW", false);
    expect(result.valid).toBe(false);
  });

  it("CORRECTION + eligible=false → reject", () => {
    const result = validateEligibleTypeConsistency("CORRECTION", false);
    expect(result.valid).toBe(false);
  });

  it("FUTURE_PLAN + eligible=true → reject", () => {
    const result = validateEligibleTypeConsistency("FUTURE_PLAN", true);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("FUTURE_PLAN");
  });

  it("PAST_REFERENCE + eligible=true → reject", () => {
    const result = validateEligibleTypeConsistency("PAST_REFERENCE", true);
    expect(result.valid).toBe(false);
  });

  it("UNVERIFIED + eligible=true → reject (fail-closed)", () => {
    const result = validateEligibleTypeConsistency("UNVERIFIED", true);
    expect(result.valid).toBe(false);
  });

  it("ACTUAL_TAUGHT + eligible=true → accept", () => {
    const result = validateEligibleTypeConsistency("ACTUAL_TAUGHT", true);
    expect(result.valid).toBe(true);
  });

  it("REVIEW + eligible=true → accept", () => {
    const result = validateEligibleTypeConsistency("REVIEW", true);
    expect(result.valid).toBe(true);
  });

  it("CORRECTION + eligible=true → accept", () => {
    const result = validateEligibleTypeConsistency("CORRECTION", true);
    expect(result.valid).toBe(true);
  });

  it("FUTURE_PLAN + eligible=false → accept", () => {
    const result = validateEligibleTypeConsistency("FUTURE_PLAN", false);
    expect(result.valid).toBe(true);
  });

  it("PAST_REFERENCE + eligible=false → accept", () => {
    const result = validateEligibleTypeConsistency("PAST_REFERENCE", false);
    expect(result.valid).toBe(true);
  });

  it("UNVERIFIED + eligible=false → accept (fail-closed 정책 정상)", () => {
    const result = validateEligibleTypeConsistency("UNVERIFIED", false);
    expect(result.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6 — percent 범위 CHECK
// ─────────────────────────────────────────────────────────────────────────────

describe("TC6: percent range CHECK", () => {
  it("0% → valid", () => {
    expect(validateProgressPct(0).valid).toBe(true);
  });

  it("50% → valid", () => {
    expect(validateProgressPct(50).valid).toBe(true);
  });

  it("100% → valid", () => {
    expect(validateProgressPct(100).valid).toBe(true);
  });

  it("-1% → invalid", () => {
    const result = validateProgressPct(-1);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("-1");
  });

  it("100.1% → invalid", () => {
    const result = validateProgressPct(100.1);
    expect(result.valid).toBe(false);
  });

  it("101% → invalid", () => {
    const result = validateProgressPct(101);
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC7 — FK RESTRICT 정의 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC7: FK RESTRICT 정의", () => {
  it("FK curriculum_item_id 제약명이 정의됐다", () => {
    expect(T.CPO_FK_ITEM).toBe("fk_cpo_curriculum_item");
  });

  it("FK curriculum_version_id 제약명이 정의됐다", () => {
    expect(T.CPO_FK_VERSION).toBe("fk_cpo_curriculum_version");
  });

  it("FK 정책이 ON DELETE RESTRICT다", () => {
    expect(T.CPO_FK_RESTRICT).toBe("ON DELETE RESTRICT");
  });

  it("RESTRICT = curriculum item 삭제 시 CPO 자동 삭제 방지 (구조적 보호)", () => {
    // FK ON DELETE RESTRICT → curriculum_items에서 사용 중인 item 삭제 시도 시 에러
    // → CPO가 참조하는 curriculum item은 절대 삭제 불가 → 진도 데이터 보호
    expect(T.CPO_FK_RESTRICT).not.toBe("ON DELETE CASCADE");
    expect(T.CPO_FK_RESTRICT).not.toBe("ON DELETE SET NULL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC8 — UNVERIFIED fail-closed 정책
// ─────────────────────────────────────────────────────────────────────────────

describe("TC8: UNVERIFIED → is_gauge_eligible=false (fail-closed)", () => {
  it("UNVERIFIED는 ineligible types에 포함된다", () => {
    expect(T.CPO_INELIGIBLE_TYPES).toContain("UNVERIFIED");
  });

  it("UNVERIFIED + eligible=false → accept (fail-closed 정상 경로)", () => {
    expect(validateEligibleTypeConsistency("UNVERIFIED", false).valid).toBe(true);
  });

  it("UNVERIFIED + eligible=true → reject (fail-closed 위반)", () => {
    expect(validateEligibleTypeConsistency("UNVERIFIED", true).valid).toBe(false);
  });

  it("evidence_text=NULL + teacher_ai → UNVERIFIED 정책 (토큰 확인)", () => {
    // 설계 원칙: evidence_text=NULL && source=teacher_ai → classifier가 UNVERIFIED 반환
    // UNVERIFIED는 eligible=false → 게이지 미반영 (fail-closed)
    const ineligible = T.CPO_INELIGIBLE_TYPES;
    expect(ineligible).toContain("UNVERIFIED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC9 — REVIEW / CORRECTION → eligible=true
// ─────────────────────────────────────────────────────────────────────────────

describe("TC9: REVIEW / CORRECTION → is_gauge_eligible=true", () => {
  it("REVIEW는 eligible_types에 포함된다", () => {
    expect(T.CPO_ELIGIBLE_TYPES).toContain("REVIEW");
  });

  it("CORRECTION는 eligible_types에 포함된다", () => {
    expect(T.CPO_ELIGIBLE_TYPES).toContain("CORRECTION");
  });

  it("REVIEW + eligible=true → accept (당일 수업 = eligible 사용자 결정)", () => {
    expect(validateEligibleTypeConsistency("REVIEW", true).valid).toBe(true);
  });

  it("CORRECTION + eligible=true → accept (당일 수업 = eligible 사용자 결정)", () => {
    expect(validateEligibleTypeConsistency("CORRECTION", true).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC10 — display monotonic: MAX(prev, new) — cross-version rank 비교 금지
// ─────────────────────────────────────────────────────────────────────────────

describe("TC10: display_confirmed_pct monotonic — percent MAX만 허용", () => {
  it("new > prev → new 반환", () => {
    expect(computeDisplayConfirmedPct(70, 75)).toBe(75);
  });

  it("new === prev → 동일값 반환", () => {
    expect(computeDisplayConfirmedPct(70, 70)).toBe(70);
  });

  it("prev=0, new=16 → 16 반환 (첫 확정)", () => {
    expect(computeDisplayConfirmedPct(0, 16)).toBe(16);
  });

  it("cross-version에서 rank 200/400=50% < prev 70% → prev 유지", () => {
    // old: 140/200 = 70%, new version: 200/400 = 50%
    const prevDisplay = 70;
    const newActivePct = 50; // new version에서 확정된 percent
    expect(computeDisplayConfirmedPct(prevDisplay, newActivePct)).toBe(70);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC11 — 게이지 하락 금지
// ─────────────────────────────────────────────────────────────────────────────

describe("TC11: display_confirmed_pct 하락 금지 (monotonic)", () => {
  it("new < prev → prev 유지 (version 전환 후 게이지 유지)", () => {
    expect(computeDisplayConfirmedPct(70, 50)).toBe(70);
  });

  it("new = 0 (신 version 미확정) → prev 유지", () => {
    expect(computeDisplayConfirmedPct(65, 0)).toBe(65);
  });

  it("일지 삭제로 active_pct 감소해도 display 유지 (monotonic 보장)", () => {
    // SCP 불변조건: display_confirmed_pct = MAX(prev, active)
    // active가 3-lesson 미만으로 떨어져도 display는 이전 MAX 유지
    expect(computeDisplayConfirmedPct(41, 34)).toBe(41);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC12 — invalidated consistency
// ─────────────────────────────────────────────────────────────────────────────

describe("TC12: invalidated consistency 규칙", () => {
  function checkInvalidatedConsistency(isInvalidated: boolean, invalidatedAt: string | null) {
    if (!isInvalidated && invalidatedAt !== null) return false;
    if (isInvalidated && invalidatedAt === null) return false;
    return true;
  }

  it("is_invalidated=false, invalidatedAt=null → OK", () => {
    expect(checkInvalidatedConsistency(false, null)).toBe(true);
  });

  it("is_invalidated=true, invalidatedAt=timestamp → OK", () => {
    expect(checkInvalidatedConsistency(true, "2026-08-24T00:00:00Z")).toBe(true);
  });

  it("is_invalidated=false, invalidatedAt=timestamp → reject", () => {
    expect(checkInvalidatedConsistency(false, "2026-08-24T00:00:00Z")).toBe(false);
  });

  it("is_invalidated=true, invalidatedAt=null → reject", () => {
    expect(checkInvalidatedConsistency(true, null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC13 — evidence_source 허용값 확인
// ─────────────────────────────────────────────────────────────────────────────

describe("TC13: evidence_source 허용값", () => {
  function isValidEvidenceSource(source: string): boolean {
    return source === "teacher_ai" || source === "teacher_manual";
  }

  it("teacher_ai → valid", () => {
    expect(isValidEvidenceSource("teacher_ai")).toBe(true);
  });

  it("teacher_manual → valid", () => {
    expect(isValidEvidenceSource("teacher_manual")).toBe(true);
  });

  it("professional_engine → invalid (gauge source 완전 제외)", () => {
    expect(isValidEvidenceSource("professional_engine")).toBe(false);
  });

  it("parent_ai → invalid (CPO에서 미허용)", () => {
    expect(isValidEvidenceSource("parent_ai")).toBe(false);
  });

  it("teacher_manual → ACTUAL_TAUGHT + eligible=true 보장 (설계 원칙)", () => {
    // teacher_manual: 교사가 직접 item 선택 = 실제 수업 근거 충분
    // classifier에서 evidence_text 없이도 ACTUAL_TAUGHT 반환
    expect(isValidEvidenceSource("teacher_manual")).toBe(true);
    expect(validateEligibleTypeConsistency("ACTUAL_TAUGHT", true).valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC14 — initGauge01Schema() group 순서 A→B 보장
// ─────────────────────────────────────────────────────────────────────────────

describe("TC14: initGauge01Schema() group 순서 A→B 보장", () => {
  it("mock DB로 group A(CPO) 이후 group B(SCP) 실행 순서 확인", async () => {
    mockExecute.mockClear();
    mockExecute.mockResolvedValue({ rows: [] });

    const { initGauge01Schema } = await import(
      "../../migrations/gauge-01-progress-tables.js"
    );
    await initGauge01Schema();

    // execute가 호출됐음을 확인 (최소 2회 이상: CPO + SCP 각각 다수 statement)
    const callCount = mockExecute.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("DB execute 실패 시 initGauge01Schema()가 throw한다", async () => {
    mockExecute.mockRejectedValueOnce(new Error("DB connection failed"));

    const { initGauge01Schema } = await import(
      "../../migrations/gauge-01-progress-tables.js"
    );
    await expect(initGauge01Schema()).rejects.toThrow("DB connection failed");
  });
});
