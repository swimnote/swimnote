/**
 * gap-registry.test.ts — WP-CS11: Support Gap Classification Tests
 *
 * GAP-01 ~ GAP-15: 75개 coverage record 전수 분류 검증
 *
 * 판정 규칙:
 *   - COVERED_ACTIVE: production ACTIVE 소스로 primary intent 해결 가능
 *   - COVERED_PENDING: PENDING 소스가 있으나 미활성
 *   - PARTIAL: WHERE_IS(FM) 또는 STATE_CHECK(DB_STATE) 보조 카테고리만 커버됨
 *   - MISSING: 어떤 ACTIVE 소스도 없음
 */

import { describe, it, expect } from "vitest";
import {
  SUPPORT_GAP_REGISTRY,
  GAP_STATISTICS,
  GAP_BY_COVERAGE_ID,
  UNCLASSIFIED_COVERAGE_RECORDS,
  getGapsByReadiness,
  getRecordsNeedingFaq,
  getRecordsNeedingSolution,
  getRecordsNeedingFmUpdate,
  type GapRecord,
  type GapReadiness,
} from "../../config/support/support-gap.v1.js";
import { SUPPORT_COVERAGE_REGISTRY } from "../../config/support/support-coverage.v1.js";

// ── GAP-01: UNCLASSIFIED = 0 ──────────────────────────────────────────────────

describe("GAP-01: UNCLASSIFIED_COVERAGE_RECORDS = 0", () => {
  it("미분류 coverage records가 없어야 함", () => {
    expect(UNCLASSIFIED_COVERAGE_RECORDS).toHaveLength(0);
  });

  it("SUPPORT_COVERAGE_REGISTRY의 모든 coverage_id가 GAP_REGISTRY에 있어야 함", () => {
    const coverageIds = SUPPORT_COVERAGE_REGISTRY.map((r) => r.coverage_id);
    const gapIds = new Set(SUPPORT_GAP_REGISTRY.map((r) => r.coverage_id));
    const missing = coverageIds.filter((id) => !gapIds.has(id));
    expect(missing).toHaveLength(0);
  });

  it("GAP_REGISTRY에 중복 coverage_id가 없어야 함", () => {
    const ids = SUPPORT_GAP_REGISTRY.map((r) => r.coverage_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── GAP-02: Total count = 75 ──────────────────────────────────────────────────

describe("GAP-02: GAP_REGISTRY total = 75", () => {
  it("SUPPORT_GAP_REGISTRY 총 75개 레코드", () => {
    expect(SUPPORT_GAP_REGISTRY).toHaveLength(75);
  });

  it("GAP_STATISTICS.TOTAL_GAP_RECORDS = 75", () => {
    expect(GAP_STATISTICS.TOTAL_GAP_RECORDS).toBe(75);
  });

  it("SUPPORT_COVERAGE_REGISTRY와 GAP_REGISTRY 수가 동일해야 함", () => {
    expect(SUPPORT_GAP_REGISTRY).toHaveLength(SUPPORT_COVERAGE_REGISTRY.length);
  });
});

// ── GAP-03: COVERED_ACTIVE count ≥ 7 ─────────────────────────────────────────

describe("GAP-03: COVERED_ACTIVE count ≥ 7", () => {
  it("COVERED_ACTIVE 레코드가 최소 7개 이상이어야 함", () => {
    const active = getGapsByReadiness("COVERED_ACTIVE");
    expect(active.length).toBeGreaterThanOrEqual(7);
  });

  it("GAP_STATISTICS.COVERED_ACTIVE_COUNT = 7", () => {
    expect(GAP_STATISTICS.COVERED_ACTIVE_COUNT).toBe(7);
    expect(GAP_STATISTICS.COVERED_ACTIVE_COUNT).toBe(
      getGapsByReadiness("COVERED_ACTIVE").length
    );
  });

  it("COVERED_ACTIVE records have at least one active_source", () => {
    const active = getGapsByReadiness("COVERED_ACTIVE");
    for (const rec of active) {
      expect(rec.active_sources.length).toBeGreaterThan(0);
    }
  });

  it("COVERED_ACTIVE records have no gap_reasons", () => {
    const active = getGapsByReadiness("COVERED_ACTIVE");
    for (const rec of active) {
      expect(rec.gap_reasons).toHaveLength(0);
    }
  });
});

// ── GAP-04: COVERED_PENDING count ≥ 1 ────────────────────────────────────────

describe("GAP-04: COVERED_PENDING count ≥ 1", () => {
  it("COVERED_PENDING 레코드가 최소 1개 이상이어야 함", () => {
    const pending = getGapsByReadiness("COVERED_PENDING");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("GAP_STATISTICS.COVERED_PENDING_COUNT = 1", () => {
    expect(GAP_STATISTICS.COVERED_PENDING_COUNT).toBe(1);
    expect(GAP_STATISTICS.COVERED_PENDING_COUNT).toBe(
      getGapsByReadiness("COVERED_PENDING").length
    );
  });

  it("X_SUBSCRIPTION_HOW_TO는 COVERED_PENDING이어야 함", () => {
    const rec = GAP_BY_COVERAGE_ID.get("X_SUBSCRIPTION_HOW_TO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_PENDING");
    expect(rec!.pending_sources.length).toBeGreaterThan(0);
  });

  it("COVERED_PENDING records have pending_sources and empty active_sources", () => {
    const pending = getGapsByReadiness("COVERED_PENDING");
    for (const rec of pending) {
      expect(rec.pending_sources.length).toBeGreaterThan(0);
      expect(rec.active_sources).toHaveLength(0);
    }
  });
});

// ── GAP-05: PARTIAL count matches statistics ──────────────────────────────────

describe("GAP-05: PARTIAL count matches statistics", () => {
  it("GAP_STATISTICS.PARTIAL_COUNT = 46", () => {
    expect(GAP_STATISTICS.PARTIAL_COUNT).toBe(46);
  });

  it("실제 PARTIAL count = 통계치", () => {
    const partialRecords = getGapsByReadiness("PARTIAL");
    expect(partialRecords.length).toBe(GAP_STATISTICS.PARTIAL_COUNT);
  });

  it("PARTIAL records have at least one active_source or pending_source", () => {
    const partials = getGapsByReadiness("PARTIAL");
    for (const rec of partials) {
      const hasSomeSource =
        rec.active_sources.length > 0 || rec.pending_sources.length > 0;
      expect(hasSomeSource).toBe(true);
    }
  });

  it("PARTIAL records have at least one gap_reason", () => {
    const partials = getGapsByReadiness("PARTIAL");
    for (const rec of partials) {
      expect(rec.gap_reasons.length).toBeGreaterThan(0);
    }
  });
});

// ── GAP-06: MISSING count matches statistics ──────────────────────────────────

describe("GAP-06: MISSING count matches statistics", () => {
  it("GAP_STATISTICS.MISSING_COUNT = 21", () => {
    expect(GAP_STATISTICS.MISSING_COUNT).toBe(21);
  });

  it("실제 MISSING count = 통계치", () => {
    const missingRecords = getGapsByReadiness("MISSING");
    expect(missingRecords.length).toBe(GAP_STATISTICS.MISSING_COUNT);
  });

  it("MISSING records have no active_sources", () => {
    const missing = getGapsByReadiness("MISSING");
    for (const rec of missing) {
      expect(rec.active_sources).toHaveLength(0);
    }
  });

  it("MISSING records have at least one gap_reason", () => {
    const missing = getGapsByReadiness("MISSING");
    for (const rec of missing) {
      expect(rec.gap_reasons.length).toBeGreaterThan(0);
    }
  });
});

// ── GAP-07: Readiness sum = 75 ────────────────────────────────────────────────

describe("GAP-07: All readiness counts sum to 75", () => {
  it("COVERED_ACTIVE + COVERED_PENDING + PARTIAL + MISSING = 75", () => {
    const sum =
      GAP_STATISTICS.COVERED_ACTIVE_COUNT +
      GAP_STATISTICS.COVERED_PENDING_COUNT +
      GAP_STATISTICS.PARTIAL_COUNT +
      GAP_STATISTICS.MISSING_COUNT;
    expect(sum).toBe(75);
  });

  it("실제 레코드 합산도 75", () => {
    const actualSum =
      getGapsByReadiness("COVERED_ACTIVE").length +
      getGapsByReadiness("COVERED_PENDING").length +
      getGapsByReadiness("PARTIAL").length +
      getGapsByReadiness("MISSING").length;
    expect(actualSum).toBe(75);
  });
});

// ── GAP-08: P0 MISSING records ────────────────────────────────────────────────

describe("GAP-08: P0 MISSING records are identified", () => {
  const P0_MISSING_EXPECTED = [
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
  ];

  it("GAP_STATISTICS.P0_MISSING_COUNT = 10", () => {
    expect(GAP_STATISTICS.P0_MISSING_COUNT).toBe(10);
  });

  it("모든 P0 MISSING coverage_id가 GAP_REGISTRY에 MISSING으로 분류됨", () => {
    for (const id of P0_MISSING_EXPECTED) {
      const gap = GAP_BY_COVERAGE_ID.get(id);
      expect(gap, `${id} must be in GAP_REGISTRY`).toBeDefined();
      expect(gap!.overall_readiness, `${id} must be MISSING`).toBe("MISSING");
    }
  });

  it("P0 coverage records 중 MISSING이 10개", () => {
    // P0 priority records from SUPPORT_COVERAGE_REGISTRY
    const p0Ids = new Set(
      SUPPORT_COVERAGE_REGISTRY
        .filter((r) => r.priority === "P0")
        .map((r) => r.coverage_id)
    );
    const p0Missing = SUPPORT_GAP_REGISTRY.filter(
      (r) => p0Ids.has(r.coverage_id) && r.overall_readiness === "MISSING"
    );
    expect(p0Missing.length).toBe(GAP_STATISTICS.P0_MISSING_COUNT);
  });
});

// ── GAP-09: ACTIVE knowledge items coverage ───────────────────────────────────

describe("GAP-09: ACTIVE knowledge items cover expected records", () => {
  const KI_SWIMNOTE_INTRO_EXPECTED = [
    "AUTH_LOGIN_HOW_TO",
    "AI_SUPPORT_HOW_TO",
    "SWIMNOTE_INTRO",
  ];
  const KI_X_MODE_INTRO_EXPECTED = [
    "X_MODE_INTRO",
    "X_ACTIVATION_CHECK",
  ];

  it("ki_swimnote_intro는 COVERED_ACTIVE 레코드에만 active_source로 나타나야 함", () => {
    const withKiSwim = SUPPORT_GAP_REGISTRY.filter((r) =>
      r.active_sources.some((s) => s.includes("ki_swimnote_intro"))
    );
    for (const rec of withKiSwim) {
      expect(rec.overall_readiness).toBe("COVERED_ACTIVE");
    }
    expect(withKiSwim.length).toBeGreaterThanOrEqual(KI_SWIMNOTE_INTRO_EXPECTED.length);
  });

  it("ki_x_mode_intro는 COVERED_ACTIVE 레코드에만 active_source로 나타나야 함", () => {
    const withKiX = SUPPORT_GAP_REGISTRY.filter((r) =>
      r.active_sources.some((s) => s.includes("ki_x_mode_intro"))
    );
    for (const rec of withKiX) {
      expect(rec.overall_readiness).toBe("COVERED_ACTIVE");
    }
    expect(withKiX.length).toBeGreaterThanOrEqual(KI_X_MODE_INTRO_EXPECTED.length);
  });

  it("ki_swimnote_intro refs가 기대 coverage_id를 모두 커버해야 함", () => {
    for (const id of KI_SWIMNOTE_INTRO_EXPECTED) {
      const rec = GAP_BY_COVERAGE_ID.get(id);
      expect(rec).toBeDefined();
      const hasRef = rec!.active_sources.some((s) => s.includes("ki_swimnote_intro"));
      expect(hasRef, `${id} should have ki_swimnote_intro as source`).toBe(true);
    }
  });

  it("ki_x_mode_intro refs가 기대 coverage_id를 모두 커버해야 함", () => {
    for (const id of KI_X_MODE_INTRO_EXPECTED) {
      const rec = GAP_BY_COVERAGE_ID.get(id);
      expect(rec).toBeDefined();
      const hasRef = rec!.active_sources.some((s) => s.includes("ki_x_mode_intro"));
      expect(hasRef, `${id} should have ki_x_mode_intro as source`).toBe(true);
    }
  });
});

// ── GAP-10: DB_STATE coverage ─────────────────────────────────────────────────

describe("GAP-10: DB_STATE active sources are correctly classified", () => {
  it("BILLING_SUBSCRIPTION_STATUS는 DB_STATE:subscription을 active_source로 가져야 함", () => {
    const rec = GAP_BY_COVERAGE_ID.get("BILLING_SUBSCRIPTION_STATUS");
    expect(rec).toBeDefined();
    expect(rec!.active_sources).toContain("DB_STATE:subscription");
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
  });

  it("BILLING_CANCELLED_BUT_ACTIVE는 DB_STATE:subscription을 active_source로 가져야 함", () => {
    const rec = GAP_BY_COVERAGE_ID.get("BILLING_CANCELLED_BUT_ACTIVE");
    expect(rec).toBeDefined();
    expect(rec!.active_sources).toContain("DB_STATE:subscription");
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
  });

  it("X_ACTIVATION_CHECK는 DB_STATE:x_mode을 active_source로 가져야 함", () => {
    const rec = GAP_BY_COVERAGE_ID.get("X_ACTIVATION_CHECK");
    expect(rec).toBeDefined();
    expect(rec!.active_sources).toContain("DB_STATE:x_mode");
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
  });

  it("DB_STATE active source를 가진 COVERED_ACTIVE 레코드가 통계치와 일치해야 함", () => {
    const dbStatePrimary = SUPPORT_GAP_REGISTRY.filter(
      (r) =>
        r.active_sources.some((s) => s.startsWith("DB_STATE:")) &&
        r.overall_readiness === "COVERED_ACTIVE"
    );
    expect(dbStatePrimary.length).toBe(GAP_STATISTICS.DB_STATE_PRIMARY_ACTIVE_COUNT);
    expect(GAP_STATISTICS.DB_STATE_PRIMARY_ACTIVE_COUNT).toBe(3);
  });

  it("GAP_STATISTICS.DB_STATE_ACTIVE_DOMAINS에 3개 도메인이 있어야 함", () => {
    expect(GAP_STATISTICS.DB_STATE_ACTIVE_DOMAINS).toHaveLength(3);
    expect(GAP_STATISTICS.DB_STATE_ACTIVE_DOMAINS).toContain("subscription");
    expect(GAP_STATISTICS.DB_STATE_ACTIVE_DOMAINS).toContain("x_mode");
    expect(GAP_STATISTICS.DB_STATE_ACTIVE_DOMAINS).toContain("growth_report");
  });
});

// ── GAP-11: Frontend Map coverage ────────────────────────────────────────────

describe("GAP-11: PARTIAL records with FM exact coverage", () => {
  it("PARTIAL records that have FM active_source have WHERE_IS = ACTIVE in category_readiness", () => {
    const partialWithFm = SUPPORT_GAP_REGISTRY.filter(
      (r) =>
        r.overall_readiness === "PARTIAL" &&
        r.active_sources.some((s) => s.startsWith("FRONTEND_MAP:"))
    );
    for (const rec of partialWithFm) {
      expect(
        rec.category_readiness["WHERE_IS"],
        `${rec.coverage_id} should have WHERE_IS=ACTIVE when FM exact match`
      ).toBe("ACTIVE");
    }
  });

  it("FM exact 소스를 가진 레코드가 통계치와 일치해야 함", () => {
    const exactFmCount = SUPPORT_GAP_REGISTRY.filter((r) =>
      r.active_sources.some((s) => s.startsWith("FRONTEND_MAP:"))
    ).length;
    expect(exactFmCount).toBe(GAP_STATISTICS.FM_EXACT_COVERED_COUNT);
  });

  it("FM keyword 소스만 가진 레코드 수가 통계치와 일치해야 함", () => {
    const keywordFmCount = SUPPORT_GAP_REGISTRY.filter((r) =>
      r.active_sources.some((s) => s.startsWith("FM_KEYWORD:")) &&
      !r.active_sources.some((s) => s.startsWith("FRONTEND_MAP:"))
    ).length;
    expect(keywordFmCount).toBe(GAP_STATISTICS.FM_KEYWORD_POSSIBLE_COUNT);
  });

  it("NEEDS_FM_UPDATE_COUNT = 18", () => {
    const actualNeedsFm = getRecordsNeedingFmUpdate();
    expect(actualNeedsFm.length).toBe(GAP_STATISTICS.NEEDS_FM_UPDATE_COUNT);
  });
});

// ── GAP-12: KNOWN_ISSUE domain records are all MISSING ───────────────────────

describe("GAP-12: KNOWN_ISSUE domain records = MISSING (no active incidents)", () => {
  const KNOWN_ISSUE_IDS = [
    "KNOWN_ISSUE_SERVER_API",
    "KNOWN_ISSUE_AI_PROVIDER",
    "KNOWN_ISSUE_PUSH",
    "KNOWN_ISSUE_BILLING",
  ];

  it("모든 KNOWN_ISSUE 도메인 레코드가 MISSING이어야 함 (active incidents = 0)", () => {
    for (const id of KNOWN_ISSUE_IDS) {
      const rec = GAP_BY_COVERAGE_ID.get(id);
      expect(rec, `${id} must be in GAP_REGISTRY`).toBeDefined();
      expect(rec!.overall_readiness, `${id} must be MISSING`).toBe("MISSING");
    }
  });

  it("KNOWN_ISSUE 레코드는 needs_known_issue_candidate = true여야 함", () => {
    for (const id of KNOWN_ISSUE_IDS) {
      const rec = GAP_BY_COVERAGE_ID.get(id);
      expect(rec!.needs_known_issue_candidate).toBe(true);
    }
  });

  it("ACTIVE_INCIDENTS = 0", () => {
    expect(GAP_STATISTICS.ACTIVE_INCIDENTS).toBe(0);
  });
});

// ── GAP-13: Candidate needs are consistent ────────────────────────────────────

describe("GAP-13: Candidate needs counts match statistics", () => {
  it("NEEDS_FAQ_CANDIDATE_COUNT = 53", () => {
    expect(GAP_STATISTICS.NEEDS_FAQ_CANDIDATE_COUNT).toBe(53);
    expect(getRecordsNeedingFaq()).toHaveLength(GAP_STATISTICS.NEEDS_FAQ_CANDIDATE_COUNT);
  });

  it("NEEDS_SOLUTION_CANDIDATE_COUNT = 29", () => {
    expect(GAP_STATISTICS.NEEDS_SOLUTION_CANDIDATE_COUNT).toBe(29);
    expect(getRecordsNeedingSolution()).toHaveLength(
      GAP_STATISTICS.NEEDS_SOLUTION_CANDIDATE_COUNT
    );
  });

  it("NEEDS_RULE_CANDIDATE_COUNT = 0 (no records need RULE items yet)", () => {
    const needsRule = SUPPORT_GAP_REGISTRY.filter((r) => r.needs_rule_candidate);
    expect(needsRule).toHaveLength(0);
    expect(GAP_STATISTICS.NEEDS_RULE_CANDIDATE_COUNT).toBe(0);
  });

  it("COVERED_ACTIVE records should NOT need FAQ/solution candidates (already covered)", () => {
    const active = getGapsByReadiness("COVERED_ACTIVE");
    for (const rec of active) {
      expect(rec.needs_faq_candidate, `${rec.coverage_id} should not need FAQ`).toBe(false);
      expect(rec.needs_knowledge_candidate, `${rec.coverage_id} should not need knowledge`).toBe(false);
      expect(rec.needs_solution_candidate, `${rec.coverage_id} should not need solution`).toBe(false);
    }
  });
});

// ── GAP-14: GapRecord structural integrity ────────────────────────────────────

describe("GAP-14: GapRecord structural integrity", () => {
  const VALID_READINESS = new Set<GapReadiness>([
    "COVERED_ACTIVE",
    "COVERED_PENDING",
    "PARTIAL",
    "MISSING",
  ]);

  it("모든 레코드의 overall_readiness가 유효한 값이어야 함", () => {
    for (const rec of SUPPORT_GAP_REGISTRY) {
      expect(
        VALID_READINESS.has(rec.overall_readiness),
        `${rec.coverage_id} has invalid readiness: ${rec.overall_readiness}`
      ).toBe(true);
    }
  });

  it("모든 레코드의 category_readiness가 비어있지 않아야 함", () => {
    for (const rec of SUPPORT_GAP_REGISTRY) {
      expect(
        Object.keys(rec.category_readiness).length,
        `${rec.coverage_id} must have at least one category`
      ).toBeGreaterThan(0);
    }
  });

  it("모든 레코드의 active_sources 형식이 올바른 prefix를 가져야 함", () => {
    const validPrefixes = [
      "KNOWLEDGE:",
      "FRONTEND_MAP:",
      "FM_KEYWORD:",
      "DB_STATE:",
    ];
    for (const rec of SUPPORT_GAP_REGISTRY) {
      for (const source of rec.active_sources) {
        const valid = validPrefixes.some((p) => source.startsWith(p));
        expect(valid, `${rec.coverage_id} has invalid active_source: ${source}`).toBe(true);
      }
    }
  });

  it("MISSING readiness는 active_sources = [] 이어야 함", () => {
    const missing = getGapsByReadiness("MISSING");
    for (const rec of missing) {
      expect(rec.active_sources).toHaveLength(0);
    }
  });

  it("GAP_BY_COVERAGE_ID Map size = 75", () => {
    expect(GAP_BY_COVERAGE_ID.size).toBe(75);
  });
});

// ── GAP-15: Key individual records spot-check ─────────────────────────────────

describe("GAP-15: Key individual records spot-check", () => {
  it("SWIMNOTE_INTRO: COVERED_ACTIVE, ki_swimnote_intro source", () => {
    const rec = GAP_BY_COVERAGE_ID.get("SWIMNOTE_INTRO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
    expect(rec!.active_sources).toContain("KNOWLEDGE:ki_swimnote_intro");
    expect(rec!.deterministic_possible).toBe(true);
    expect(rec!.needs_faq_candidate).toBe(false);
  });

  it("X_MODE_INTRO: COVERED_ACTIVE, ki_x_mode_intro source", () => {
    const rec = GAP_BY_COVERAGE_ID.get("X_MODE_INTRO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
    expect(rec!.active_sources).toContain("KNOWLEDGE:ki_x_mode_intro");
    expect(rec!.deterministic_possible).toBe(true);
  });

  it("X_SUBSCRIPTION_HOW_TO: COVERED_PENDING, ki_seed_subscription_x_features pending", () => {
    const rec = GAP_BY_COVERAGE_ID.get("X_SUBSCRIPTION_HOW_TO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_PENDING");
    expect(rec!.pending_sources.some((s) => s.includes("ki_seed_subscription_x_features"))).toBe(true);
    expect(rec!.active_sources).toHaveLength(0);
  });

  it("BILLING_SUBSCRIPTION_STATUS: COVERED_ACTIVE, DB_STATE:subscription", () => {
    const rec = GAP_BY_COVERAGE_ID.get("BILLING_SUBSCRIPTION_STATUS");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
    expect(rec!.active_sources).toContain("DB_STATE:subscription");
    expect(rec!.category_readiness["STATE_CHECK"]).toBe("ACTIVE");
    expect(rec!.deterministic_possible).toBe(true);
  });

  it("AUTH_LOGIN_HOW_TO: COVERED_ACTIVE, FM:LOGIN + ki_swimnote_intro", () => {
    const rec = GAP_BY_COVERAGE_ID.get("AUTH_LOGIN_HOW_TO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("COVERED_ACTIVE");
    expect(rec!.active_sources).toContain("FRONTEND_MAP:LOGIN");
    expect(rec!.active_sources).toContain("KNOWLEDGE:ki_swimnote_intro");
    expect(rec!.category_readiness["HOW_TO"]).toBe("ACTIVE");
    expect(rec!.category_readiness["WHERE_IS"]).toBe("ACTIVE");
  });

  it("ATTENDANCE_HOW_TO: PARTIAL, FM WHERE_IS only", () => {
    const rec = GAP_BY_COVERAGE_ID.get("ATTENDANCE_HOW_TO");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("PARTIAL");
    expect(rec!.active_sources).toContain("FRONTEND_MAP:ADMIN_ATTENDANCE");
    expect(rec!.category_readiness["HOW_TO"]).toBe("MISSING");
    expect(rec!.category_readiness["WHERE_IS"]).toBe("ACTIVE");
    expect(rec!.needs_faq_candidate).toBe(true);
  });

  it("AUTH_POOL_ACCESS_DENIED: MISSING, no FM screen, no knowledge", () => {
    const rec = GAP_BY_COVERAGE_ID.get("AUTH_POOL_ACCESS_DENIED");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("MISSING");
    expect(rec!.active_sources).toHaveLength(0);
    expect(rec!.deterministic_possible).toBe(false);
  });

  it("KNOWN_ISSUE_SERVER_API: MISSING, needs_known_issue_candidate = true", () => {
    const rec = GAP_BY_COVERAGE_ID.get("KNOWN_ISSUE_SERVER_API");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("MISSING");
    expect(rec!.needs_known_issue_candidate).toBe(true);
    expect(rec!.needs_faq_candidate).toBe(false);
    expect(rec!.needs_solution_candidate).toBe(false);
  });

  it("DIARY_AI_FAILED: PARTIAL, FM WHERE_IS, needs SOLUTION + known_issue_candidate", () => {
    const rec = GAP_BY_COVERAGE_ID.get("DIARY_AI_FAILED");
    expect(rec).toBeDefined();
    expect(rec!.overall_readiness).toBe("PARTIAL");
    expect(rec!.needs_solution_candidate).toBe(true);
    expect(rec!.needs_known_issue_candidate).toBe(true);
    expect(rec!.category_readiness["AI_FAILURE"]).toBe("MISSING");
  });
});
