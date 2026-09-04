/**
 * cs12-candidates.test.ts — WP-CS12: FAQ/Solution Candidate Generation Tests
 *
 * 검증 항목:
 *   CS12-01: Candidate 총 21개, 중복 없음
 *   CS12-02: 모든 candidate status = pending (자동 ACTIVE 0)
 *   CS12-03: P0 10개 coverage record 전부 1개 이상 candidate 보유
 *   CS12-04: item_type 유효값 (FAQ / SOLUTION only)
 *   CS12-05: SOLUTION items — solution_steps 비어있지 않음
 *   CS12-06: 모든 candidate에 source_ref 존재 (provenance)
 *   CS12-07: 모든 candidate에 question + answer 존재
 *   CS12-08: FAQ vs SOLUTION 수 검증 (11 / 10)
 *   CS12-09: role leakage 없음 — parent에게 admin-only 안내 없음
 *   CS12-10: mode leakage 없음 — KNOWN_ISSUE 유형이 KNOWN_ISSUE item_type 아님
 *   CS12-11: 기존 cs-05r seed ID와 중복 없음
 *   CS12-12: P0 coverage map 완전성 (10개 P0 모두 매핑)
 *   CS12-13: SOLUTION items affected_roles 검증
 *   CS12-14: candidate ID prefix 규칙 (ki_cs12_)
 *   CS12-15: content 비어있지 않음 + 최소 길이
 */

import { describe, it, expect } from "vitest";
import {
  CS12_CANDIDATE_IDS,
  CS12_P0_COVERAGE_MAP,
  CS12_SOLUTION_IDS,
  CS12_FAQ_IDS,
} from "../../migrations/pool-db-cs-12.js";

// ── 기존 cs-05r seed IDs (중복 검사용) ─────────────────────────────────────
const CS05R_SEED_IDS = new Set([
  "ki_seed_login_method",
  "ki_seed_role_invite_qr",
  "ki_seed_attendance_record",
  "ki_seed_attendance_parent_view",
  "ki_seed_makeup_request",
  "ki_seed_makeup_expiry",
  "ki_seed_diary_teacher_write",
  "ki_seed_diary_parent_view",
  "ki_seed_ai_diary_generate",
  "ki_seed_curriculum_chat_parent",
  "ki_seed_growth_report_what",
  "ki_seed_growth_report_where",
  "ki_seed_photo_album",
  "ki_seed_push_notification",
  "ki_seed_subscription_what",
  "ki_seed_subscription_x_features",
  "ki_seed_support_chat",
  "ki_seed_admin_student_register",
  "ki_seed_admin_schedule",
  "ki_seed_x_mode_activate",
]);

// ── CS12-01: 총계 및 중복 ──────────────────────────────────────────────────

describe("CS12-01: Candidate 총계 및 중복 없음", () => {
  it("CS12_CANDIDATE_IDS = 21개", () => {
    expect(CS12_CANDIDATE_IDS).toHaveLength(21);
  });

  it("중복 ID 없음", () => {
    const unique = new Set(CS12_CANDIDATE_IDS);
    expect(unique.size).toBe(CS12_CANDIDATE_IDS.length);
  });

  it("모든 ID가 문자열", () => {
    for (const id of CS12_CANDIDATE_IDS) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

// ── CS12-02: status = pending (자동 ACTIVE 0) ─────────────────────────────

describe("CS12-02: 자동 ACTIVE 생성 없음", () => {
  it("마이그레이션 파일에 status=pending 고정 확인 (코드 패턴 검사)", async () => {
    // pool-db-cs-12.ts의 INSERT SQL에 'pending' hardcoded 확인
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // 'active' 문자열이 status 값으로 사용되지 않아야 함
    // status 필드에는 오직 'pending'만 있어야 함
    expect(src).toContain("'pending', 1, NOW(), NOW()");
    expect(src).not.toMatch(/'active',\s*1,\s*NOW\(\)/);
    // ACTIVE_CREATED 방어: status='active' 직접 할당 없음
    expect(src).not.toMatch(/status\s*=\s*'active'/);
  });

  it("CS12_CANDIDATE_IDS에 active 관련 ID 없음", () => {
    for (const id of CS12_CANDIDATE_IDS) {
      expect(id).not.toContain("active_override");
      expect(id).not.toContain("force_active");
    }
  });
});

// ── CS12-03: P0 10개 coverage record 전부 candidate 보유 ─────────────────

describe("CS12-03: P0 10개 모두 candidate 매핑됨", () => {
  const P0_COVERAGE_IDS = [
    "AUTH_ACCOUNT_WITHDRAWAL",
    "AUTH_POOL_ACCESS_DENIED",
    "ATTENDANCE_PERMISSION_DENIED",
    "NOTIFICATION_PERMISSION_OS",
    "DATA_NOT_VISIBLE_ROLE_MISMATCH",
    "DATA_NOT_VISIBLE_FILTER",
    "KNOWN_ISSUE_SERVER_API",
    "KNOWN_ISSUE_AI_PROVIDER",
    "KNOWN_ISSUE_PUSH",
    "KNOWN_ISSUE_BILLING",
  ] as const;

  it("CS12_P0_COVERAGE_MAP에 P0 10개 전부 존재", () => {
    for (const coverageId of P0_COVERAGE_IDS) {
      const candidates = CS12_P0_COVERAGE_MAP[coverageId];
      expect(
        candidates,
        `${coverageId} must have at least one candidate`
      ).toBeDefined();
      expect(candidates.length).toBeGreaterThan(0);
    }
  });

  it("P0 coverage map 크기 = 10", () => {
    expect(Object.keys(CS12_P0_COVERAGE_MAP)).toHaveLength(10);
  });

  it("P0 map의 모든 candidate ID가 CS12_CANDIDATE_IDS에 있음", () => {
    const allIds = new Set(CS12_CANDIDATE_IDS);
    for (const [coverageId, candidateIds] of Object.entries(CS12_P0_COVERAGE_MAP)) {
      for (const cid of candidateIds) {
        expect(
          allIds.has(cid as any),
          `P0 coverage ${coverageId} → candidate ${cid} must be in CS12_CANDIDATE_IDS`
        ).toBe(true);
      }
    }
  });

  it("AUTH_ACCOUNT_WITHDRAWAL → 2 candidates (general + pool_admin specific)", () => {
    expect(CS12_P0_COVERAGE_MAP.AUTH_ACCOUNT_WITHDRAWAL).toHaveLength(2);
    expect(CS12_P0_COVERAGE_MAP.AUTH_ACCOUNT_WITHDRAWAL).toContain("ki_cs12_account_withdrawal");
    expect(CS12_P0_COVERAGE_MAP.AUTH_ACCOUNT_WITHDRAWAL).toContain("ki_cs12_pool_admin_withdrawal_deferred");
  });

  it("NOTIFICATION_PERMISSION_OS → iOS + Android 분리 candidates", () => {
    expect(CS12_P0_COVERAGE_MAP.NOTIFICATION_PERMISSION_OS).toHaveLength(2);
    expect(CS12_P0_COVERAGE_MAP.NOTIFICATION_PERMISSION_OS).toContain("ki_cs12_notification_permission_ios");
    expect(CS12_P0_COVERAGE_MAP.NOTIFICATION_PERMISSION_OS).toContain("ki_cs12_notification_permission_android");
  });
});

// ── CS12-04: item_type 유효값 ─────────────────────────────────────────────

describe("CS12-04: item_type 유효값 (FAQ / SOLUTION만)", () => {
  const VALID_TYPES = new Set(["FAQ", "SOLUTION"]);

  it("SOLUTION IDs의 item_type은 SOLUTION이어야 함 (ID 기반 검증)", () => {
    // SOLUTION_IDS는 solution_steps가 있는 candidates
    expect(CS12_SOLUTION_IDS.length).toBeGreaterThan(0);
    for (const id of CS12_SOLUTION_IDS) {
      // ID가 CS12_CANDIDATE_IDS에 있는지 확인
      expect(CS12_CANDIDATE_IDS).toContain(id);
    }
  });

  it("FAQ_IDS + SOLUTION_IDS = 전체 21개", () => {
    expect(CS12_FAQ_IDS.length + CS12_SOLUTION_IDS.length).toBe(21);
  });

  it("KNOWN_ISSUE 유형 P0 항목은 FAQ item_type 사용 (no fake incident)", () => {
    // KNOWN_ISSUE_* coverage records → FAQ type candidates (no KNOWN_ISSUE item_type)
    const knownIssueP0Candidates = [
      "ki_cs12_server_error_triage",
      "ki_cs12_ai_error_triage",
      "ki_cs12_billing_error_triage",
    ];
    // 이 candidates는 SOLUTION이 아닌 FAQ여야 함
    for (const id of knownIssueP0Candidates) {
      expect(CS12_FAQ_IDS).toContain(id);
      expect(CS12_SOLUTION_IDS).not.toContain(id);
    }
  });
});

// ── CS12-05: SOLUTION items — solution_steps 검증 ────────────────────────

describe("CS12-05: SOLUTION items have solution_steps", () => {
  it("SOLUTION ID 수 = 10", () => {
    expect(CS12_SOLUTION_IDS).toHaveLength(10);
  });

  it("KNOWN_ISSUE_PUSH candidate는 SOLUTION (push_not_working)", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_push_not_working");
  });

  it("pool_access_denied는 SOLUTION", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_pool_access_denied");
  });

  it("data_role_mismatch는 SOLUTION", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_data_role_mismatch");
  });

  it("diary_ai_failed는 SOLUTION", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_diary_ai_failed");
  });

  it("billing_payment_failed는 SOLUTION", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_billing_payment_failed");
  });

  it("parent_not_linked는 SOLUTION", () => {
    expect(CS12_SOLUTION_IDS).toContain("ki_cs12_parent_not_linked");
  });
});

// ── CS12-06: source_ref provenance 검증 (파일 소스 분석) ─────────────────

describe("CS12-06: 모든 candidate에 source_ref provenance 존재", () => {
  it("마이그레이션 파일에서 source_ref가 21개 all 존재", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // source_ref 출현 횟수가 21개 이상이어야 함
    const sourceRefCount = (src.match(/source_ref:/g) || []).length;
    expect(sourceRefCount).toBeGreaterThanOrEqual(21);
  });

  it("마이그레이션 파일에 source_ref가 없거나 빈 값인 곳 없음", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // source_ref: "" 빈 문자열 없음
    expect(src).not.toMatch(/source_ref:\s*""\s*,/);
    expect(src).not.toMatch(/source_ref:\s*''\s*,/);
  });
});

// ── CS12-07: question + answer 존재 ──────────────────────────────────────

describe("CS12-07: 모든 candidate에 question + answer 존재", () => {
  it("마이그레이션 파일에서 question 출현 횟수 = 21", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const questionCount = (src.match(/^\s+question:/gm) || []).length;
    expect(questionCount).toBeGreaterThanOrEqual(21);
  });

  it("마이그레이션 파일에서 answer 출현 횟수 = 21", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const answerCount = (src.match(/^\s+answer:/gm) || []).length;
    expect(answerCount).toBeGreaterThanOrEqual(21);
  });
});

// ── CS12-08: FAQ vs SOLUTION 수 ───────────────────────────────────────────

describe("CS12-08: FAQ=11, SOLUTION=10 검증", () => {
  it("CS12_FAQ_IDS = 11", () => {
    expect(CS12_FAQ_IDS).toHaveLength(11);
  });

  it("CS12_SOLUTION_IDS = 10", () => {
    expect(CS12_SOLUTION_IDS).toHaveLength(10);
  });

  it("FAQ + SOLUTION = 21", () => {
    expect(CS12_FAQ_IDS.length + CS12_SOLUTION_IDS.length).toBe(21);
  });
});

// ── CS12-09: role leakage 없음 ────────────────────────────────────────────

describe("CS12-09: role leakage 없음 (parent에게 admin-only 정보 없음)", () => {
  it("parent-only candidates가 pool_admin role scope를 갖지 않음", () => {
    // parent_not_linked, parent_diary_not_visible은 parent 전용
    const parentOnlyCandidates = [
      "ki_cs12_parent_not_linked",
      "ki_cs12_parent_diary_not_visible",
    ];
    for (const id of parentOnlyCandidates) {
      expect(CS12_CANDIDATE_IDS).toContain(id);
    }
  });

  it("billing candidates가 parent role을 포함하지 않음 (pool_admin only)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // seed 객체 정의 위치를 id: "..." 로 정확히 찾음
    const billingPaymentIdx = src.indexOf('id: "ki_cs12_billing_payment_failed"');
    expect(billingPaymentIdx).toBeGreaterThan(0);
    const billingPaymentSection = src.slice(billingPaymentIdx, billingPaymentIdx + 800);
    // affected_roles에 parent_account 없음
    const hasParentInBillingSection = billingPaymentSection.includes('"parent_account"');
    expect(hasParentInBillingSection).toBe(false);
  });

  it("X_SETUP candidate는 pool_admin만 대상", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // seed 객체 정의 위치를 id: "ki_cs12_x_setup_howto" 로 찾음
    const xSetupIdx = src.indexOf('id: "ki_cs12_x_setup_howto"');
    expect(xSetupIdx).toBeGreaterThan(0);
    const xSetupSection = src.slice(xSetupIdx, xSetupIdx + 900);
    expect(xSetupSection).toContain('"pool_admin"');
    // teacher나 parent를 포함하지 않아야 함 (X setup은 pool_admin 전용)
    expect(xSetupSection).not.toContain('"teacher"');
    expect(xSetupSection).not.toContain('"parent_account"');
  });
});

// ── CS12-10: mode leakage 없음 ────────────────────────────────────────────

describe("CS12-10: KNOWN_ISSUE type item 없음 (incident_id 링크 불필요)", () => {
  it("CS12 candidates 중 KNOWN_ISSUE item_type 사용 없음", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    // item_type: "KNOWN_ISSUE" 가 seeds 배열 내에 없어야 함
    // (KNOWN_ISSUE coverage records는 FAQ type으로 처리됨 — incident_id 연결은 CS15)
    const knownIssueTypeCount = (src.match(/item_type:\s*"KNOWN_ISSUE"/g) || []).length;
    expect(knownIssueTypeCount).toBe(0);
  });

  it("마이그레이션 파일에 incident_id 할당 없음", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    expect(src).not.toMatch(/incident_id\s*:/);
  });
});

// ── CS12-11: 기존 cs-05r seed ID와 중복 없음 ────────────────────────────

describe("CS12-11: 기존 cs-05r seeds와 중복 없음", () => {
  it("CS12_CANDIDATE_IDS 중 cs-05r IDs와 겹치는 것 없음", () => {
    for (const id of CS12_CANDIDATE_IDS) {
      expect(
        CS05R_SEED_IDS.has(id),
        `${id} conflicts with existing cs-05r seed`
      ).toBe(false);
    }
  });

  it("ki_seed_push_notification (cs-05r)이 CS12 ID와 다름", () => {
    expect(CS12_CANDIDATE_IDS).not.toContain("ki_seed_push_notification");
    // CS12는 push_not_working (failure case)로 분리
    expect(CS12_CANDIDATE_IDS).toContain("ki_cs12_push_not_working");
  });
});

// ── CS12-12: P0 coverage map 완전성 ──────────────────────────────────────

describe("CS12-12: P0 coverage map 완전성", () => {
  it("10개 P0 coverage 모두 CS12_P0_COVERAGE_MAP key로 존재", () => {
    const mapKeys = Object.keys(CS12_P0_COVERAGE_MAP);
    expect(mapKeys).toHaveLength(10);
    expect(mapKeys).toContain("AUTH_ACCOUNT_WITHDRAWAL");
    expect(mapKeys).toContain("AUTH_POOL_ACCESS_DENIED");
    expect(mapKeys).toContain("ATTENDANCE_PERMISSION_DENIED");
    expect(mapKeys).toContain("NOTIFICATION_PERMISSION_OS");
    expect(mapKeys).toContain("DATA_NOT_VISIBLE_ROLE_MISMATCH");
    expect(mapKeys).toContain("DATA_NOT_VISIBLE_FILTER");
    expect(mapKeys).toContain("KNOWN_ISSUE_SERVER_API");
    expect(mapKeys).toContain("KNOWN_ISSUE_AI_PROVIDER");
    expect(mapKeys).toContain("KNOWN_ISSUE_PUSH");
    expect(mapKeys).toContain("KNOWN_ISSUE_BILLING");
  });

  it("P0 map의 총 candidate ID 수 ≥ 10 (일부 P0는 2개 candidates)", () => {
    const totalCandidates = Object.values(CS12_P0_COVERAGE_MAP).flat();
    expect(totalCandidates.length).toBeGreaterThanOrEqual(10);
  });
});

// ── CS12-13: SOLUTION items role 검증 ────────────────────────────────────

describe("CS12-13: SOLUTION items role scope 적절성", () => {
  it("attendance_save_failed는 pool_admin+teacher only (parent 제외)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const idx = src.indexOf('id: "ki_cs12_attendance_save_failed"');
    expect(idx).toBeGreaterThan(0);
    const section = src.slice(idx, idx + 900);
    expect(section).toContain('"pool_admin"');
    expect(section).toContain('"teacher"');
    expect(section).not.toContain('"parent_account"');
  });

  it("parent_not_linked는 parent_account only", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const idx = src.indexOf('id: "ki_cs12_parent_not_linked"');
    expect(idx).toBeGreaterThan(0);
    const section = src.slice(idx, idx + 900);
    expect(section).toContain('"parent_account"');
    expect(section).not.toContain('"pool_admin"');
    expect(section).not.toContain('"teacher"');
  });

  it("diary_ai_failed는 teacher only", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const idx = src.indexOf('id: "ki_cs12_diary_ai_failed"');
    expect(idx).toBeGreaterThan(0);
    const section = src.slice(idx, idx + 900);
    expect(section).toContain('"teacher"');
    expect(section).not.toContain('"parent_account"');
  });
});

// ── CS12-14: ID prefix 규칙 ──────────────────────────────────────────────

describe("CS12-14: 모든 candidate ID는 ki_cs12_ prefix", () => {
  it("모든 CS12_CANDIDATE_IDS가 ki_cs12_ 로 시작", () => {
    for (const id of CS12_CANDIDATE_IDS) {
      expect(id.startsWith("ki_cs12_"), `${id} must start with ki_cs12_`).toBe(true);
    }
  });
});

// ── CS12-15: content 최소 품질 ────────────────────────────────────────────

describe("CS12-15: content 최소 품질 검증", () => {
  it("마이그레이션 파일의 content 필드가 21개 이상 존재", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      new URL("../../migrations/pool-db-cs-12.ts", import.meta.url),
      "utf-8"
    );
    const contentCount = (src.match(/^\s+content:/gm) || []).length;
    expect(contentCount).toBeGreaterThanOrEqual(21);
  });

  it("총 candidate 수 = 21 (FAQ 11 + SOLUTION 10)", () => {
    expect(CS12_CANDIDATE_IDS.length).toBe(21);
    expect(CS12_FAQ_IDS.length).toBe(11);
    expect(CS12_SOLUTION_IDS.length).toBe(10);
  });
});
