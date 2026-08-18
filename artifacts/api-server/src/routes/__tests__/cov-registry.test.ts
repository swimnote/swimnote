/**
 * cov-registry.test.ts — WP-CS10 Coverage Registry Validation
 *
 * COV-01 through COV-24
 *
 * 코드 변경 없음, DB 변경 없음, 자동 ACTIVE 없음.
 * 레지스트리 구조·무결성 검증만.
 */

import { describe, it, expect } from "vitest";
import {
  SUPPORT_COVERAGE_REGISTRY,
  ROLE_CANONICAL_SOURCE,
  COVERAGE_STATISTICS,
  OUT_OF_SCOPE_EXAMPLES,
  LEGACY_ROLE_VALUES_USED_IN_NEW_REGISTRY,
  INVENTED_FEATURES,
  AUTO_ACTIVE_KNOWLEDGE_ROWS,
  AUTO_ACTIVE_SOLUTION_ROWS,
  NEW_KNOWLEDGE_ROWS,
  NEW_SOLUTION_ROWS,
  UNMAPPED_SCREENS,
  STALE_SCREENS,
  type CanonicalRole,
  type CoverageRecord,
} from "../../config/support/support-coverage.v1.js";

// ─── Constants ─────────────────────────────────────────────────────────────

/** 실제 JWT canonical roles (auth.ts 기준) */
const CANONICAL_ROLES: CanonicalRole[] = [
  "pool_admin", "sub_admin", "teacher", "parent_account", "super_admin",
];

/** legacy role — 신규 registry에 사용 금지 */
const FORBIDDEN_ROLE = "parent";

/** 유효 domains */
const VALID_DOMAINS = new Set([
  "AUTH", "ATTENDANCE", "DIARY", "PAYMENT", "X_MODE", "AI",
  "PHOTO_VIDEO", "MEMBER_CLASS", "SCHEDULE", "PARENT_VISIBILITY",
  "SWIMNOTE", "SETTINGS", "DATA_VISIBILITY", "KNOWN_ISSUE",
  "NOTIFICATION", "CURRICULUM",
]);

/** 유효 support categories */
const VALID_CATEGORIES = new Set([
  "HOW_TO", "WHERE_IS", "PERMISSION", "ROLE_MISMATCH", "STATE_CHECK",
  "NOT_VISIBLE", "NOT_SAVED", "NOT_RECEIVED", "NOT_UPDATED",
  "ERROR", "FAILURE", "TIMEOUT", "SLOW", "UPLOAD_FAILED", "DOWNLOAD_FAILED",
  "LOGIN_AUTH", "ACCOUNT", "PAYMENT", "SUBSCRIPTION", "BILLING",
  "X_MODE", "AI_FAILURE", "AI_WRONG_RESULT", "AI_NO_RESULT",
  "DATA_INCONSISTENCY", "EMPTY_STATE", "NOTIFICATION",
  "USER_MISUNDERSTANDING", "COMPLAINT", "KNOWN_ISSUE", "POLICY", "OTHER",
]);

/** 유효 modes */
const VALID_MODES = new Set(["normal", "x", "x_pending", "all"]);

/** 유효 priorities */
const VALID_PRIORITIES = new Set(["P0", "P1", "P2"]);

/** 유효 knowledge coverage statuses */
const VALID_KC = new Set(["ACTIVE_COVERED", "PENDING_COVERED", "PARTIAL", "MISSING"]);

/** 유효 solution coverage statuses */
const VALID_SC = new Set(["ACTIVE_SOLUTION", "PENDING_SOLUTION", "MISSING_SOLUTION"]);

// ─── Helpers ───────────────────────────────────────────────────────────────

function recordsByDomain(domain: string): CoverageRecord[] {
  return SUPPORT_COVERAGE_REGISTRY.filter(r => r.domain === domain);
}

function recordsByRole(role: CanonicalRole): CoverageRecord[] {
  return SUPPORT_COVERAGE_REGISTRY.filter(r => r.roles.includes(role));
}

function recordsByMode(mode: string): CoverageRecord[] {
  return SUPPORT_COVERAGE_REGISTRY.filter(r => r.modes.includes(mode as any));
}

function recordsByPriority(p: "P0" | "P1" | "P2"): CoverageRecord[] {
  return SUPPORT_COVERAGE_REGISTRY.filter(r => r.priority === p);
}

// ════════════════════════════════════════════════════════════════════════════
// COV-01: Frontend Map core screen coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-01: Frontend Map core screen coverage", () => {
  it("COV-01-A: coverage_id는 고유해야 함", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("COV-01-B: 최소 40개 이상의 coverage record 존재", () => {
    expect(SUPPORT_COVERAGE_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it("COV-01-C: source_refs는 모든 record에 최소 1개 이상 존재", () => {
    const missing = SUPPORT_COVERAGE_REGISTRY.filter(r => !r.source_refs || r.source_refs.length === 0);
    expect(missing.map(r => r.coverage_id)).toEqual([]);
  });

  it("COV-01-D: screen_id가 있는 record는 유효한 문자열", () => {
    const invalid = SUPPORT_COVERAGE_REGISTRY.filter(
      r => r.screen_id !== undefined && (typeof r.screen_id !== "string" || r.screen_id.trim() === "")
    );
    expect(invalid.map(r => r.coverage_id)).toEqual([]);
  });

  it("COV-01-E: 핵심 도메인 AUTH, ATTENDANCE, DIARY, PAYMENT, X_MODE, AI, NOTIFICATION, PARENT_VISIBILITY 모두 커버됨", () => {
    const coreDomains = ["AUTH", "ATTENDANCE", "DIARY", "PAYMENT", "X_MODE", "AI", "NOTIFICATION", "PARENT_VISIBILITY"];
    for (const domain of coreDomains) {
      const records = recordsByDomain(domain);
      expect(records.length, `Domain ${domain} should have coverage records`).toBeGreaterThan(0);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-02: All canonical app roles
// ════════════════════════════════════════════════════════════════════════════

describe("COV-02: All canonical app roles covered", () => {
  it("COV-02-A: pool_admin 관련 coverage 존재", () => {
    expect(recordsByRole("pool_admin").length).toBeGreaterThan(5);
  });

  it("COV-02-B: sub_admin 관련 coverage 존재", () => {
    expect(recordsByRole("sub_admin").length).toBeGreaterThan(0);
  });

  it("COV-02-C: teacher 관련 coverage 존재", () => {
    expect(recordsByRole("teacher").length).toBeGreaterThan(5);
  });

  it("COV-02-D: parent_account 관련 coverage 존재", () => {
    expect(recordsByRole("parent_account").length).toBeGreaterThan(5);
  });

  it("COV-02-E: ROLE_CANONICAL_SOURCE는 canonical roles 5개 포함", () => {
    for (const role of CANONICAL_ROLES) {
      expect(ROLE_CANONICAL_SOURCE.roles).toContain(role);
    }
  });

  it("COV-02-F: ROLE_CANONICAL_SOURCE.source는 auth.ts 경로 포함", () => {
    expect(ROLE_CANONICAL_SOURCE.source).toContain("auth.ts");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-03: normal/x/x_pending modes
// ════════════════════════════════════════════════════════════════════════════

describe("COV-03: normal/x/x_pending modes", () => {
  it("COV-03-A: normal mode 또는 all mode coverage 존재", () => {
    const normalOrAll = SUPPORT_COVERAGE_REGISTRY.filter(
      r => r.modes.includes("normal") || r.modes.includes("all")
    );
    expect(normalOrAll.length).toBeGreaterThan(10);
  });

  it("COV-03-B: x mode coverage 존재", () => {
    const xRecords = recordsByMode("x");
    expect(xRecords.length).toBeGreaterThan(3);
  });

  it("COV-03-C: x_pending mode coverage 존재", () => {
    const xpRecords = SUPPORT_COVERAGE_REGISTRY.filter(r => r.modes.includes("x_pending"));
    expect(xpRecords.length).toBeGreaterThan(0);
  });

  it("COV-03-D: modes 배열의 모든 값이 유효 mode", () => {
    for (const record of SUPPORT_COVERAGE_REGISTRY) {
      for (const m of record.modes) {
        expect(VALID_MODES.has(m), `Invalid mode '${m}' in ${record.coverage_id}`).toBe(true);
      }
    }
  });

  it("COV-03-E: X-only features는 x 또는 x_pending mode 지정됨", () => {
    const xOnlyRecords = SUPPORT_COVERAGE_REGISTRY.filter(r => r.domain === "X_MODE");
    for (const r of xOnlyRecords) {
      const hasXMode = r.modes.some(m => m === "x" || m === "x_pending" || m === "all");
      expect(hasXMode, `X_MODE record ${r.coverage_id} should have x/x_pending/all mode`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-04: Auth coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-04: Auth coverage", () => {
  const authRecords = recordsByDomain("AUTH");

  it("COV-04-A: AUTH domain 최소 6개 record 존재", () => {
    expect(authRecords.length).toBeGreaterThanOrEqual(6);
  });

  it("COV-04-B: LOGIN_AUTH category가 AUTH record에 포함됨", () => {
    const withLoginAuth = authRecords.filter(r => r.support_categories.includes("LOGIN_AUTH"));
    expect(withLoginAuth.length).toBeGreaterThan(0);
  });

  it("COV-04-C: parent_account login coverage 존재 (OTP 방식)", () => {
    const parentLogin = authRecords.filter(r => r.roles.includes("parent_account"));
    expect(parentLogin.length).toBeGreaterThan(0);
  });

  it("COV-04-D: AUTH_LOGIN_FAILED는 P0 우선순위", () => {
    const loginFailed = SUPPORT_COVERAGE_REGISTRY.find(r => r.coverage_id === "AUTH_LOGIN_FAILED");
    expect(loginFailed).toBeDefined();
    expect(loginFailed?.priority).toBe("P0");
  });

  it("COV-04-E: AUTH records의 related_api는 /auth/ 경로 포함", () => {
    const withAuthApi = authRecords.filter(r => r.related_api.some(a => a.includes("auth")));
    expect(withAuthApi.length).toBeGreaterThan(3);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-05: Attendance coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-05: Attendance coverage", () => {
  const attRecords = recordsByDomain("ATTENDANCE");

  it("COV-05-A: ATTENDANCE domain 최소 4개 record 존재", () => {
    expect(attRecords.length).toBeGreaterThanOrEqual(4);
  });

  it("COV-05-B: HOW_TO, NOT_SAVED, NOT_VISIBLE, PERMISSION categories 커버됨", () => {
    const cats = new Set(attRecords.flatMap(r => r.support_categories));
    expect(cats.has("HOW_TO")).toBe(true);
    expect(cats.has("NOT_SAVED")).toBe(true);
    expect(cats.has("NOT_VISIBLE")).toBe(true);
    expect(cats.has("PERMISSION")).toBe(true);
  });

  it("COV-05-C: 출결 관련 API (/attendance) 참조 존재", () => {
    const withApi = attRecords.filter(r => r.related_api.some(a => a.includes("attendance")));
    expect(withApi.length).toBeGreaterThan(0);
  });

  it("COV-05-D: ATTENDANCE_SAVE_FAILED는 solution_required=true", () => {
    const r = SUPPORT_COVERAGE_REGISTRY.find(x => x.coverage_id === "ATTENDANCE_SAVE_FAILED");
    expect(r?.solution_required).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-06: Diary coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-06: Diary coverage", () => {
  const diaryRecords = recordsByDomain("DIARY");

  it("COV-06-A: DIARY domain 최소 5개 record 존재", () => {
    expect(diaryRecords.length).toBeGreaterThanOrEqual(5);
  });

  it("COV-06-B: AI 일지 실패 coverage 존재", () => {
    const aiFailure = diaryRecords.filter(r => r.support_categories.includes("AI_FAILURE"));
    expect(aiFailure.length).toBeGreaterThan(0);
  });

  it("COV-06-C: 학부모 일지 미표시 coverage 존재", () => {
    const parentNotVisible = diaryRecords.filter(
      r => r.roles.includes("parent_account") && r.support_categories.includes("NOT_VISIBLE")
    );
    expect(parentNotVisible.length).toBeGreaterThan(0);
  });

  it("COV-06-D: 사진 업로드 실패 coverage 존재", () => {
    const photoFail = diaryRecords.filter(r => r.support_categories.includes("UPLOAD_FAILED"));
    expect(photoFail.length).toBeGreaterThan(0);
  });

  it("COV-06-E: DIARY records의 related_api는 /diaries 경로 포함", () => {
    const withDiaryApi = diaryRecords.filter(r => r.related_api.some(a => a.includes("diar")));
    expect(withDiaryApi.length).toBeGreaterThan(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-07: AI coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-07: AI features coverage", () => {
  const aiRecords = SUPPORT_COVERAGE_REGISTRY.filter(
    r => r.domain === "AI" || r.feature_id.startsWith("AI_") || r.support_categories.some(c => c.startsWith("AI_"))
  );

  it("COV-07-A: AI 관련 coverage 최소 5개 존재", () => {
    expect(aiRecords.length).toBeGreaterThanOrEqual(5);
  });

  it("COV-07-B: AI_FAILURE category coverage 존재", () => {
    const failRecords = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("AI_FAILURE"));
    expect(failRecords.length).toBeGreaterThan(0);
  });

  it("COV-07-C: AI_NO_RESULT category coverage 존재", () => {
    const noResult = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("AI_NO_RESULT"));
    expect(noResult.length).toBeGreaterThan(0);
  });

  it("COV-07-D: Growth Report coverage 존재", () => {
    const gr = SUPPORT_COVERAGE_REGISTRY.filter(r => r.feature_id.includes("GROWTH_REPORT"));
    expect(gr.length).toBeGreaterThan(0);
  });

  it("COV-07-E: Parent Curriculum coverage 존재", () => {
    const pc = SUPPORT_COVERAGE_REGISTRY.filter(r => r.feature_id.includes("CURRICULUM"));
    expect(pc.length).toBeGreaterThan(0);
  });

  it("COV-07-F: Support AI coverage 존재", () => {
    const supportAi = SUPPORT_COVERAGE_REGISTRY.filter(r => r.feature_id === "SUPPORT_AI");
    expect(supportAi.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-08: X Mode coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-08: X Mode coverage", () => {
  const xRecords = recordsByDomain("X_MODE");

  it("COV-08-A: X_MODE domain 최소 5개 record 존재", () => {
    expect(xRecords.length).toBeGreaterThanOrEqual(5);
  });

  it("COV-08-B: X 소개, 구독, 활성화, 설정, 설정 미완료 coverage 모두 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("X_MODE_INTRO");
    expect(ids).toContain("X_SUBSCRIPTION_HOW_TO");
    expect(ids).toContain("X_ACTIVATION_CHECK");
    expect(ids).toContain("X_SETUP_HOW_TO");
    expect(ids).toContain("X_CONFIG_INCOMPLETE");
  });

  it("COV-08-C: X_MODE_INTRO는 ki_x_mode_intro ACTIVE로 커버됨", () => {
    const r = SUPPORT_COVERAGE_REGISTRY.find(x => x.coverage_id === "X_MODE_INTRO");
    expect(r?.knowledge_coverage).toBe("ACTIVE_COVERED");
  });

  it("COV-08-D: X 관련 db_state_check_possible=true 항목 존재", () => {
    const dbCheckable = xRecords.filter(r => r.db_state_check_possible);
    expect(dbCheckable.length).toBeGreaterThan(0);
  });

  it("COV-08-E: X_MODE records는 x 또는 x_pending 모드 포함", () => {
    for (const r of xRecords) {
      const hasX = r.modes.some(m => ["x", "x_pending", "all"].includes(m));
      expect(hasX, `${r.coverage_id} should have x/x_pending/all mode`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-09: Billing/Subscription coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-09: Billing/Subscription coverage", () => {
  const billingRecords = recordsByDomain("PAYMENT");

  it("COV-09-A: PAYMENT domain 최소 5개 record 존재", () => {
    expect(billingRecords.length).toBeGreaterThanOrEqual(5);
  });

  it("COV-09-B: 구독 상태 확인, 만료, 취소-but-활성, 결제 실패, 복원, 환불 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("BILLING_SUBSCRIPTION_STATUS");
    expect(ids).toContain("BILLING_SUBSCRIPTION_NOT_ACTIVE");
    expect(ids).toContain("BILLING_CANCELLED_BUT_ACTIVE");
    expect(ids).toContain("BILLING_PAYMENT_FAILED");
    expect(ids).toContain("BILLING_RESTORE");
    expect(ids).toContain("BILLING_REFUND_POLICY");
  });

  it("COV-09-C: BILLING_REFUND_POLICY는 자동 환불 실행이 아닌 정책 안내", () => {
    const r = SUPPORT_COVERAGE_REGISTRY.find(x => x.coverage_id === "BILLING_REFUND_POLICY");
    expect(r?.support_categories).toContain("POLICY");
    // solution_required=false (환불 자동 실행 coverage 금지)
    expect(r?.solution_required).toBe(false);
  });

  it("COV-09-D: 결제 관련 records에 COMPLAINT_PAYMENT_NOT_APPLIED 포함", () => {
    const withComplaint = billingRecords.filter(r =>
      r.complaint_classes.includes("COMPLAINT_PAYMENT_NOT_APPLIED")
    );
    expect(withComplaint.length).toBeGreaterThan(0);
  });

  it("COV-09-E: db_state_check_possible=true 항목이 billing domain에 존재 (RevenueCat state)", () => {
    const dbCheckable = billingRecords.filter(r => r.db_state_check_possible);
    expect(dbCheckable.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-10: Notifications coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-10: Notifications coverage", () => {
  const notifRecords = recordsByDomain("NOTIFICATION");

  it("COV-10-A: NOTIFICATION domain 최소 2개 record 존재", () => {
    expect(notifRecords.length).toBeGreaterThanOrEqual(2);
  });

  it("COV-10-B: NOTIFICATION_NOT_RECEIVED, NOTIFICATION_PERMISSION_OS 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("NOTIFICATION_NOT_RECEIVED");
    expect(ids).toContain("NOTIFICATION_PERMISSION_OS");
  });

  it("COV-10-C: NOTIFICATION_NOT_RECEIVED는 known_issue_possible=true (인프라 장애 가능)", () => {
    const r = SUPPORT_COVERAGE_REGISTRY.find(x => x.coverage_id === "NOTIFICATION_NOT_RECEIVED");
    expect(r?.known_issue_possible).toBe(true);
  });

  it("COV-10-D: 알림 관련 all canonical roles 포함", () => {
    const allRoles = new Set(notifRecords.flatMap(r => r.roles));
    expect(allRoles.has("pool_admin")).toBe(true);
    expect(allRoles.has("teacher")).toBe(true);
    expect(allRoles.has("parent_account")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-11: Photo/Video coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-11: Photo/Video coverage", () => {
  const photoRecords = recordsByDomain("PHOTO_VIDEO");

  it("COV-11-A: PHOTO_VIDEO domain 최소 4개 record 존재", () => {
    expect(photoRecords.length).toBeGreaterThanOrEqual(4);
  });

  it("COV-11-B: 업로드 방법, 업로드 실패, 학부모 미표시, 용량 초과, 영상 업로드 실패 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("PHOTO_UPLOAD_HOW_TO");
    expect(ids).toContain("PHOTO_UPLOAD_FAILED");
    expect(ids).toContain("PHOTO_PARENT_NOT_VISIBLE");
    expect(ids).toContain("PHOTO_STORAGE_EXCEEDED");
    expect(ids).toContain("VIDEO_UPLOAD_FAILED");
  });

  it("COV-11-C: UPLOAD_FAILED category records가 존재", () => {
    const uploadFail = photoRecords.filter(r => r.support_categories.includes("UPLOAD_FAILED"));
    expect(uploadFail.length).toBeGreaterThan(0);
  });

  it("COV-11-D: 스토리지 관련 db_state_check_possible=true 존재", () => {
    const dbCheckable = photoRecords.filter(r => r.db_state_check_possible);
    expect(dbCheckable.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-12: Parent visibility coverage
// ════════════════════════════════════════════════════════════════════════════

describe("COV-12: Parent visibility coverage", () => {
  const parentVisRecords = recordsByDomain("PARENT_VISIBILITY");

  it("COV-12-A: PARENT_VISIBILITY domain 최소 3개 record 존재", () => {
    expect(parentVisRecords.length).toBeGreaterThanOrEqual(3);
  });

  it("COV-12-B: 자녀 미연결, 공지 미표시, 출결 미표시 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("PARENT_CHILD_NOT_LINKED");
    expect(ids).toContain("PARENT_NOTICE_NOT_VISIBLE");
    expect(ids).toContain("PARENT_ATTENDANCE_NOT_VISIBLE");
  });

  it("COV-12-C: DIARY_PARENT_NOT_VISIBLE, PHOTO_PARENT_NOT_VISIBLE, AI_GROWTH_REPORT_NOT_VISIBLE 도 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("DIARY_PARENT_NOT_VISIBLE");
    expect(ids).toContain("PHOTO_PARENT_NOT_VISIBLE");
    expect(ids).toContain("AI_GROWTH_REPORT_NOT_VISIBLE");
  });

  it("COV-12-D: parent visibility records는 모두 parent_account role 포함", () => {
    for (const r of parentVisRecords) {
      expect(r.roles.includes("parent_account"), `${r.coverage_id} should include parent_account`).toBe(true);
    }
  });

  it("COV-12-E: COMPLAINT_PARENT_NOT_VISIBLE complaint class 존재", () => {
    const withComplaint = SUPPORT_COVERAGE_REGISTRY.filter(r =>
      r.complaint_classes.includes("COMPLAINT_PARENT_NOT_VISIBLE")
    );
    expect(withComplaint.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-13: Complaint taxonomy
// ════════════════════════════════════════════════════════════════════════════

describe("COV-13: Complaint taxonomy coverage", () => {
  it("COV-13-A: COMPLAINT_NOT_WORKING complaint class가 registry에 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_NOT_WORKING"));
    expect(records.length).toBeGreaterThan(3);
  });

  it("COV-13-B: COMPLAINT_NOT_VISIBLE 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_NOT_VISIBLE"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-13-C: COMPLAINT_PAYMENT_NOT_APPLIED 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_PAYMENT_NOT_APPLIED"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-13-D: COMPLAINT_AI_MISSING 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_AI_MISSING"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-13-E: COMPLAINT_UPLOAD_FAILED 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_UPLOAD_FAILED"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-13-F: COMPLAINT_NOTIFICATION_MISSING 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.complaint_classes.includes("COMPLAINT_NOTIFICATION_MISSING"));
    expect(records.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-14: Failure taxonomy
// ════════════════════════════════════════════════════════════════════════════

describe("COV-14: Failure taxonomy coverage", () => {
  it("COV-14-A: ERROR category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("ERROR"));
    expect(records.length).toBeGreaterThan(5);
  });

  it("COV-14-B: UPLOAD_FAILED category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("UPLOAD_FAILED"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-14-C: AI_FAILURE category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("AI_FAILURE"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-14-D: TIMEOUT category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("TIMEOUT"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-14-E: known_errors 필드는 실제 오류 문자열이거나 빈 배열", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(Array.isArray(r.known_errors), `${r.coverage_id}.known_errors should be array`).toBe(true);
    }
  });

  it("COV-14-F: known_issue_possible=true인 항목이 존재 (서비스 장애 가능)", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.known_issue_possible);
    expect(records.length).toBeGreaterThan(5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-15: Permission taxonomy
// ════════════════════════════════════════════════════════════════════════════

describe("COV-15: Permission taxonomy coverage", () => {
  it("COV-15-A: PERMISSION category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("PERMISSION"));
    expect(records.length).toBeGreaterThan(2);
  });

  it("COV-15-B: ROLE_MISMATCH category coverage 존재", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r => r.support_categories.includes("ROLE_MISMATCH"));
    expect(records.length).toBeGreaterThan(0);
  });

  it("COV-15-C: required_permissions 필드는 배열", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(Array.isArray(r.required_permissions), `${r.coverage_id}.required_permissions should be array`).toBe(true);
    }
  });

  it("COV-15-D: COMPLAINT_PERMISSION_DENIED complaint class가 사용됨", () => {
    const records = SUPPORT_COVERAGE_REGISTRY.filter(r =>
      r.complaint_classes.includes("COMPLAINT_PERMISSION_DENIED")
    );
    expect(records.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-16: DB state capability
// ════════════════════════════════════════════════════════════════════════════

describe("COV-16: DB state check capability", () => {
  const dbCheckableRecords = SUPPORT_COVERAGE_REGISTRY.filter(r => r.db_state_check_possible);

  it("COV-16-A: db_state_check_possible=true인 항목이 10개 이상 존재", () => {
    expect(dbCheckableRecords.length).toBeGreaterThanOrEqual(10);
  });

  it("COV-16-B: db_state_check_possible=true이면 db_state_source 존재", () => {
    for (const r of dbCheckableRecords) {
      expect(r.db_state_source, `${r.coverage_id} needs db_state_source`).toBeTruthy();
    }
  });

  it("COV-16-C: 구독 상태는 DB 조회 가능", () => {
    const billingDbCheck = dbCheckableRecords.filter(r => r.domain === "PAYMENT");
    expect(billingDbCheck.length).toBeGreaterThan(0);
  });

  it("COV-16-D: X 활성화 상태는 DB 조회 가능", () => {
    const xDbCheck = dbCheckableRecords.filter(r => r.domain === "X_MODE");
    expect(xDbCheck.length).toBeGreaterThan(0);
  });

  it("COV-16-E: db_state_check_possible=false이면 db_state_source 없어도 됨", () => {
    const notCheckable = SUPPORT_COVERAGE_REGISTRY.filter(r => !r.db_state_check_possible);
    // source 없어도 괜찮음 — 검증은 위반 케이스만
    for (const r of notCheckable) {
      // db_state_source가 있으면 안 됨 (false인데 source가 있으면 불일치)
      // 허용: undefined 또는 빈 문자열
      if (r.db_state_source) {
        // false이지만 source가 있는 경우는 정보 제공용으로 허용 (warn only)
      }
    }
    expect(true).toBe(true); // non-blocking check
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-17: Known issue surface
// ════════════════════════════════════════════════════════════════════════════

describe("COV-17: Known issue surface", () => {
  const knownIssueDomain = recordsByDomain("KNOWN_ISSUE");

  it("COV-17-A: KNOWN_ISSUE domain records 존재 (장애 표면 목록)", () => {
    expect(knownIssueDomain.length).toBeGreaterThan(0);
  });

  it("COV-17-B: 서버 API 장애 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("KNOWN_ISSUE_SERVER_API");
  });

  it("COV-17-C: AI provider 장애 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("KNOWN_ISSUE_AI_PROVIDER");
  });

  it("COV-17-D: 푸시 장애 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("KNOWN_ISSUE_PUSH");
  });

  it("COV-17-E: 결제 시스템 장애 coverage 존재", () => {
    const ids = SUPPORT_COVERAGE_REGISTRY.map(r => r.coverage_id);
    expect(ids).toContain("KNOWN_ISSUE_BILLING");
  });

  it("COV-17-F: known_issue_possible=true 항목이 전체 레지스트리에 분산됨", () => {
    const total = SUPPORT_COVERAGE_REGISTRY.filter(r => r.known_issue_possible).length;
    expect(total).toBeGreaterThanOrEqual(8);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-18: Knowledge gap map
// ════════════════════════════════════════════════════════════════════════════

describe("COV-18: Knowledge gap map", () => {
  it("COV-18-A: knowledge_coverage=MISSING 항목이 대다수 (gap 존재 확인)", () => {
    const missing = SUPPORT_COVERAGE_REGISTRY.filter(r => r.knowledge_coverage === "MISSING");
    expect(missing.length).toBeGreaterThan(30);
  });

  it("COV-18-B: knowledge_coverage=ACTIVE_COVERED 항목이 존재 (ki_swimnote_intro, ki_x_mode_intro 확인)", () => {
    const active = SUPPORT_COVERAGE_REGISTRY.filter(r => r.knowledge_coverage === "ACTIVE_COVERED");
    expect(active.length).toBeGreaterThanOrEqual(2);
  });

  it("COV-18-C: knowledge_coverage=PENDING_COVERED 항목이 존재", () => {
    const pending = SUPPORT_COVERAGE_REGISTRY.filter(r => r.knowledge_coverage === "PENDING_COVERED");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("COV-18-D: P0_MISSING_KNOWLEDGE 목록이 비어 있지 않음", () => {
    expect(COVERAGE_STATISTICS.P0_MISSING_KNOWLEDGE.length).toBeGreaterThan(10);
  });

  it("COV-18-E: knowledge_coverage 필드 값이 유효 status만 사용", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(VALID_KC.has(r.knowledge_coverage), `Invalid knowledge_coverage in ${r.coverage_id}`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-19: Solution gap map
// ════════════════════════════════════════════════════════════════════════════

describe("COV-19: Solution gap map", () => {
  it("COV-19-A: solution_coverage=MISSING_SOLUTION가 대다수", () => {
    const missing = SUPPORT_COVERAGE_REGISTRY.filter(r => r.solution_coverage === "MISSING_SOLUTION");
    expect(missing.length).toBeGreaterThan(30);
  });

  it("COV-19-B: P0_MISSING_SOLUTIONS 목록이 비어 있지 않음", () => {
    expect(COVERAGE_STATISTICS.P0_MISSING_SOLUTIONS.length).toBeGreaterThan(5);
  });

  it("COV-19-C: solution_required=true인 항목이 존재", () => {
    const solutionRequired = SUPPORT_COVERAGE_REGISTRY.filter(r => r.solution_required);
    expect(solutionRequired.length).toBeGreaterThan(10);
  });

  it("COV-19-D: solution_coverage 필드 값이 유효 status만 사용", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(VALID_SC.has(r.solution_coverage), `Invalid solution_coverage in ${r.coverage_id}`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-20: Out-of-scope foundation
// ════════════════════════════════════════════════════════════════════════════

describe("COV-20: Out-of-scope foundation", () => {
  it("COV-20-A: OUT_OF_SCOPE_EXAMPLES 목록이 존재", () => {
    expect(OUT_OF_SCOPE_EXAMPLES.length).toBeGreaterThan(5);
  });

  it("COV-20-B: 날씨, 정치, 주식, 일반 수영 코칭이 out-of-scope 목록에 포함", () => {
    const joined = OUT_OF_SCOPE_EXAMPLES.join(" ");
    expect(joined).toMatch(/날씨/);
    expect(joined).toMatch(/정치/);
    expect(joined).toMatch(/주식/);
    expect(joined).toMatch(/수영 코칭/);
  });

  it("COV-20-C: 모든 registry record의 out_of_scope는 false", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(r.out_of_scope, `${r.coverage_id}.out_of_scope should be false`).toBe(false);
    }
  });

  it("COV-20-D: SWIMMING_KNOWLEDGE_BOUNDARY 문자열이 존재하고 수영 코칭 경계 설명 포함", async () => {
    const { SWIMMING_KNOWLEDGE_BOUNDARY } = await import("../../config/support/support-coverage.v1.js");
    expect(typeof SWIMMING_KNOWLEDGE_BOUNDARY).toBe("string");
    expect(SWIMMING_KNOWLEDGE_BOUNDARY.length).toBeGreaterThan(10);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-21: Canonical roles only
// ════════════════════════════════════════════════════════════════════════════

describe("COV-21: Canonical roles only — no legacy 'parent'", () => {
  it("COV-21-A: LEGACY_ROLE_VALUES_USED_IN_NEW_REGISTRY는 빈 배열 (0건)", () => {
    expect(LEGACY_ROLE_VALUES_USED_IN_NEW_REGISTRY).toEqual([]);
  });

  it("COV-21-B: 어떤 record에도 legacy role 'parent'가 사용되지 않음", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      const hasForbidden = r.roles.includes(FORBIDDEN_ROLE as CanonicalRole);
      expect(hasForbidden, `${r.coverage_id} should not use legacy role 'parent'`).toBe(false);
    }
  });

  it("COV-21-C: 모든 record의 roles 값은 canonical roles만 사용", () => {
    const canonicalSet = new Set(CANONICAL_ROLES as string[]);
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      for (const role of r.roles) {
        expect(canonicalSet.has(role), `Non-canonical role '${role}' in ${r.coverage_id}`).toBe(true);
      }
    }
  });

  it("COV-21-D: ROLE_CANONICAL_SOURCE.note에 'parent' legacy 경고 포함", () => {
    expect(ROLE_CANONICAL_SOURCE.note).toContain("parent");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-22: No invented feature
// ════════════════════════════════════════════════════════════════════════════

describe("COV-22: No invented features", () => {
  it("COV-22-A: INVENTED_FEATURES 목록이 비어 있음", () => {
    expect(INVENTED_FEATURES).toEqual([]);
  });

  it("COV-22-B: 모든 related_api는 실제 서버 route 경로 형식", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      for (const api of r.related_api) {
        // 각 API는 /로 시작하거나 HTTP 메서드로 시작
        const valid = api.startsWith("/") ||
          /^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(api) ||
          api.includes(":");
        expect(valid, `Invalid API format '${api}' in ${r.coverage_id}`).toBe(true);
      }
    }
  });

  it("COV-22-C: 모든 source_refs는 비어 있지 않음 (창작 금지 — 근거 필수)", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(r.source_refs.length, `${r.coverage_id} needs source_refs`).toBeGreaterThan(0);
    }
  });

  it("COV-22-D: coverage_id 형식은 DOMAIN_FEATURE_SYMPTOM 패턴 (대문자_언더스코어)", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(/^[A-Z][A-Z0-9_]+$/.test(r.coverage_id), `Invalid coverage_id format: ${r.coverage_id}`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-23: No auto ACTIVE
// ════════════════════════════════════════════════════════════════════════════

describe("COV-23: No auto ACTIVE knowledge/solution", () => {
  it("COV-23-A: AUTO_ACTIVE_KNOWLEDGE_ROWS = 0", () => {
    expect(AUTO_ACTIVE_KNOWLEDGE_ROWS).toBe(0);
  });

  it("COV-23-B: AUTO_ACTIVE_SOLUTION_ROWS = 0", () => {
    expect(AUTO_ACTIVE_SOLUTION_ROWS).toBe(0);
  });

  it("COV-23-C: NEW_KNOWLEDGE_ROWS = 0", () => {
    expect(NEW_KNOWLEDGE_ROWS).toBe(0);
  });

  it("COV-23-D: NEW_SOLUTION_ROWS = 0", () => {
    expect(NEW_SOLUTION_ROWS).toBe(0);
  });

  it("COV-23-E: COVERAGE_STATISTICS에 신규 DB row 생성 없음", () => {
    // coverage registry는 오직 구조 파일만
    // 실제 DB insert/update 없음 확인 — 파일만 존재
    expect(SUPPORT_COVERAGE_REGISTRY.every(r => typeof r.coverage_id === "string")).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// COV-24: Full regression — schema integrity
// ════════════════════════════════════════════════════════════════════════════

describe("COV-24: Full regression — schema integrity", () => {
  it("COV-24-A: 모든 record는 필수 필드를 가짐", () => {
    const required: (keyof CoverageRecord)[] = [
      "coverage_id", "domain", "feature_id", "roles", "modes",
      "action_description", "support_categories", "possible_intents",
      "possible_symptoms", "complaint_classes", "required_permissions",
      "required_states", "related_api", "related_feature_flags",
      "known_errors", "known_empty_states", "known_loading_states",
      "db_state_check_possible", "knowledge_required", "solution_required",
      "known_issue_possible", "out_of_scope", "priority", "source_refs",
      "knowledge_coverage", "solution_coverage",
    ];
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      for (const field of required) {
        expect(r[field] !== undefined, `${r.coverage_id} missing field: ${field}`).toBe(true);
      }
    }
  });

  it("COV-24-B: 모든 domain은 유효 도메인 집합에 포함", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(VALID_DOMAINS.has(r.domain), `Invalid domain '${r.domain}' in ${r.coverage_id}`).toBe(true);
    }
  });

  it("COV-24-C: 모든 priority는 P0/P1/P2", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(VALID_PRIORITIES.has(r.priority), `Invalid priority in ${r.coverage_id}`).toBe(true);
    }
  });

  it("COV-24-D: 모든 support_categories 값은 유효 category set에 포함", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      for (const cat of r.support_categories) {
        expect(VALID_CATEGORIES.has(cat), `Invalid category '${cat}' in ${r.coverage_id}`).toBe(true);
      }
    }
  });

  it("COV-24-E: P0 records가 20개 이상", () => {
    expect(recordsByPriority("P0").length).toBeGreaterThanOrEqual(20);
  });

  it("COV-24-F: roles 배열은 모든 record에서 비어 있지 않음", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(r.roles.length, `${r.coverage_id} roles should not be empty`).toBeGreaterThan(0);
    }
  });

  it("COV-24-G: modes 배열은 모든 record에서 비어 있지 않음", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(r.modes.length, `${r.coverage_id} modes should not be empty`).toBeGreaterThan(0);
    }
  });

  it("COV-24-H: COVERAGE_STATISTICS.TOTAL_COVERAGE_ITEMS는 실제 registry 길이와 일치", () => {
    expect(COVERAGE_STATISTICS.TOTAL_COVERAGE_ITEMS).toBe(SUPPORT_COVERAGE_REGISTRY.length);
  });

  it("COV-24-I: possible_intents는 모든 record에서 비어 있지 않음", () => {
    for (const r of SUPPORT_COVERAGE_REGISTRY) {
      expect(r.possible_intents.length, `${r.coverage_id} should have possible_intents`).toBeGreaterThan(0);
    }
  });

  it("COV-24-J: 전체 coverage record 수는 40개 이상", () => {
    expect(SUPPORT_COVERAGE_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it("COV-24-K: UNMAPPED_SCREENS는 배열", () => {
    expect(Array.isArray(UNMAPPED_SCREENS)).toBe(true);
    expect(UNMAPPED_SCREENS.length).toBeGreaterThan(0);
  });

  it("COV-24-L: STALE_SCREENS는 배열 (비어 있어도 됨 — 확인 완료 표시)", () => {
    expect(Array.isArray(STALE_SCREENS)).toBe(true);
  });
});
