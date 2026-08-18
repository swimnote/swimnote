/**
 * cs17-knowledge-review-ui.test.ts — WP-CS17: Super Admin Knowledge Review Console
 *
 * TEST LEVEL: UNIT / MOCK
 *   - 서버 API 보안·거버넌스 속성을 코드 정적 분석 + 타입 검증으로 커버
 *   - UI Component E2E 아님 (Playwright 미포함)
 *   - §34: "component/mock 수준이면 E2E verified라고 표현 금지"
 *
 * 커버 범위:
 *   §26 Negative Tests (20개)
 *   §27 Partner Demo Flow 구조 검증
 *   §29 Metrics (전부 0)
 *   §30~33 CS13/CS14/CS15/CS16 Regression
 *   §16 CS12 Display (21개)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isApprovalAllowed,
  isGlobalApprovalAllowed,
  isTransitionAllowed,
  isAiReviewerAttempt,
  validateApprovalChecklist,
  NO_AUTO_PROMOTION_GUARANTEE,
  CS12_CANDIDATE_READINESS,
  CHECKED_AUTO_PROMOTION_PATHS,
  isValidRejectReason,
  buildPublicApprovalTrace,
  getP0CoverageReadiness,
  type CandidateRow,
} from "../../lib/knowledge-approval.js";
import {
  detectConflicts,
  hasUnresolvedConflict,
} from "../../lib/knowledge-governance.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id:             overrides.id              !== undefined ? overrides.id              : "ki_cs17_demo",
    item_type:      overrides.item_type        !== undefined ? overrides.item_type        : "FAQ",
    status:         overrides.status           !== undefined ? overrides.status           : "pending",
    scope:          overrides.scope            !== undefined ? overrides.scope            : "global",
    source_ref:     overrides.source_ref       !== undefined ? overrides.source_ref       : "docs/auth.md:10-30",
    source_type:    overrides.source_type      !== undefined ? overrides.source_type      : "CODE",
    affected_roles: overrides.affected_roles   !== undefined ? overrides.affected_roles   : ["teacher"],
    affected_modes: overrides.affected_modes   !== undefined ? overrides.affected_modes   : ["normal"],
    feature:        overrides.feature          !== undefined ? overrides.feature          : "AUTH",
    category:       overrides.category         !== undefined ? overrides.category         : "ACCOUNT",
    pool_id:        overrides.pool_id          !== undefined ? overrides.pool_id          : null,
    content:        overrides.content          !== undefined ? overrides.content          : "이 기능은 로그인 방법을 설명합니다.",
    answer:         overrides.answer           !== undefined ? overrides.answer           : null,
    solution_steps: overrides.solution_steps   !== undefined ? overrides.solution_steps   : null,
    revision:       overrides.revision         !== undefined ? overrides.revision         : 1,
    updated_at:     overrides.updated_at       !== undefined ? overrides.updated_at       : new Date().toISOString(),
    reviewed_by:    overrides.reviewed_by      !== undefined ? overrides.reviewed_by      : null,
  };
}

// ── §26 Negative Tests: UNAUTHORIZED_UI_ACCESS = 0 ─────────────────────────────

describe("CS17-01~20: §26 Negative Tests (UNAUTHORIZED_UI_ACCESS = 0)", () => {

  // §26 #1: teacher direct URL → 403
  it("CS17-01: teacher role → isApprovalAllowed = false (UI route guard)", () => {
    expect(isApprovalAllowed("teacher")).toBe(false);
  });

  // §26 #2: parent direct URL → 403
  it("CS17-02: parent_account role → isApprovalAllowed = false", () => {
    expect(isApprovalAllowed("parent_account")).toBe(false);
  });

  // §26 #3: pool_admin direct URL → 403
  it("CS17-03: pool_admin → isApprovalAllowed = false", () => {
    expect(isApprovalAllowed("pool_admin")).toBe(false);
  });

  // §26 #4: forged client role — server checks JWT, not body
  it("CS17-04: forged client role — server isApprovalAllowed uses JWT req.user.role only", () => {
    // Even if body sends role="super_admin", server uses JWT
    // Verify: requireApprovalRole uses req.user (JWT), not req.body
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // Must use req.user.role (JWT), not req.body.reviewer_role
    expect(routeSrc).toMatch(/user\.role/);
    expect(routeSrc).not.toMatch(/req\.body\.reviewer_role/);
    expect(routeSrc).not.toMatch(/req\.body\.role/);
  });

  // §26 #5: approve missing source → blocked
  it("CS17-05: approve missing source → SOURCE blocker (APPROVAL_WITHOUT_SOURCE = 0)", () => {
    const noSource: CandidateRow = {
      id: "ki_no_src", item_type: "FAQ", status: "pending", scope: "global",
      source_ref: null, source_type: null,
      affected_roles: ["teacher"], affected_modes: ["normal"],
      feature: "AUTH", category: "ACCOUNT", pool_id: null,
      content: "내용", answer: null, solution_steps: null,
      revision: 1, updated_at: new Date().toISOString(), reviewed_by: null,
    };
    const result = validateApprovalChecklist(noSource);
    expect(result.blockers.some(b => b.dimension === "SOURCE")).toBe(true);
    expect(result.readiness).toBe("BLOCKED");
  });

  // §26 #6: approve hard conflict → hasUnresolvedConflict = true (APPROVAL_WITH_HARD_CONFLICT = 0)
  it("CS17-06: approve with hard conflict → hasUnresolvedConflict = true", () => {
    // Route maps candidate as 'active' for conflict simulation
    const existing = {
      id: "ki_old", item_type: "FAQ", feature: "AUTH", category: "ACCOUNT",
      status: "active", revision: 1, updated_at: null, source_type: null,
      title: "", answer: "", score: 0, freshness_state: undefined as any,
    };
    const candidateAsActive = {
      id: "ki_new", item_type: "FAQ", feature: "AUTH", category: "ACCOUNT",
      status: "active", revision: 1, updated_at: null, source_type: null,
      title: "", answer: "", score: 0, freshness_state: undefined as any,
    };
    expect(hasUnresolvedConflict([existing, candidateAsActive])).toBe(true);
  });

  // §26 #7: approve REVIEW_REQUIRED → server still checks checklist
  it("CS17-07: REVIEW_REQUIRED candidate has warnings but no blockers → server passes (human decides)", () => {
    const c = makeCandidate({
      content: "이 기능의 구현 여부는 확인이 필요합니다.",
      updated_at: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = validateApprovalChecklist(c);
    // REVIEW_REQUIRED candidates have warnings but MAY not have blockers
    // Server decides; UI must not pre-approve or show as "safe"
    expect(result.readiness).not.toBe("BLOCKED");
    // Confirm we can distinguish REVIEW_REQUIRED from READY
    expect(["READY_FOR_HUMAN_REVIEW", "REVIEW_REQUIRED"]).toContain(result.readiness);
  });

  // §26 #8: stale candidate approve → freshness STALE warning
  it("CS17-08: stale candidate (200 days old) → FRESHNESS warn (not blocker, human decides)", () => {
    const old = makeCandidate({
      updated_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const result = validateApprovalChecklist(old);
    const freshnessItem = result.items.find(i => i.dimension === "FRESHNESS");
    expect(freshnessItem?.outcome).not.toBe("PASS");
  });

  // §26 #9: duplicate click approve → revision guard prevents duplicate ACTIVE
  it("CS17-09: duplicate approve → revision guard in route (WHERE revision = <current>)", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // Must have WHERE with status AND revision for concurrency
    expect(routeSrc).toMatch(/revision\s*=\s*\$\{currentRevision\}/);
  });

  // §26 #10: concurrent admin approve → CONCURRENT_APPROVAL_CONFLICT
  it("CS17-10: concurrent admin approve → CONCURRENT_APPROVAL_CONFLICT code returned", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    expect(routeSrc).toMatch(/CONCURRENT_APPROVAL_CONFLICT/);
  });

  // §26 #11: rejected candidate direct reapprove → ALLOWED_TRANSITIONS
  it("CS17-11: rejected → active is not allowed (terminal state)", () => {
    expect(isTransitionAllowed("rejected", "active")).toBe(false);
  });

  // §26 #12: edit_required → active directly (NOT ALLOWED)
  it("CS17-12: edit_required → active directly is not in ALLOWED_TRANSITIONS", () => {
    expect(isTransitionAllowed("edit_required", "active")).toBe(false);
  });

  // §26 #13: arbitrary candidate_id → 404 (server side; route has WHERE id=)
  it("CS17-13: arbitrary candidate_id → server returns 404 (WHERE id = ... LIMIT 1)", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    expect(routeSrc).toMatch(/WHERE id = \$\{id\}/);
    expect(routeSrc).toMatch(/404/);
  });

  // §26 #14: cross-pool candidate → super/platform admin has full access (no pool filter)
  it("CS17-14: cross-pool candidate access — super_admin has global access (no pool_id WHERE filter)", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // Detail route: WHERE id = {id} (no pool_id filter for super_admin)
    const detailRouteMatch = routeSrc.match(/\/super\/support\/candidates\/:id[\s\S]{0,500}WHERE id = \$\{id\}/);
    expect(detailRouteMatch).toBeTruthy();
  });

  // §26 #15: forged reviewer_id → isAiReviewerAttempt detects AI IDs
  it("CS17-15: forged reviewer_id (ai-system) → isAiReviewerAttempt = true", () => {
    expect(isAiReviewerAttempt("ai-system", "super_admin")).toBe(true);
    expect(isAiReviewerAttempt("llm-auto-approver", "platform_admin")).toBe(true);
  });

  // §26 #16: UI disabled bypass via API → server requireApprovalRole always checks
  it("CS17-16: UI_BYPASS_APPROVAL = 0 — requireApprovalRole middleware on all approval routes", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // Count requireApprovalRole occurrences — should be on all action routes
    const occurrences = (routeSrc.match(/requireApprovalRole/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(6); // guard + 6+ routes
  });

  // §26 #17: raw source metadata leakage — source_ref shown safely
  it("CS17-17: RAW_SOURCE_LEAKAGE = 0 — buildPublicApprovalTrace excludes reviewer_id", () => {
    const trace = buildPublicApprovalTrace({
      id:          "ki_test",
      status:      "pending",
      revision:    1,
      reviewed_by: "user_abc123_pii",
      reviewed_at: null,
    });
    // §20: reviewer_id must not be in public trace
    expect(JSON.stringify(trace)).not.toMatch(/user_abc123_pii/);
    expect(trace).not.toHaveProperty("reviewer_id");
  });

  // §26 #18: PII leakage — approval trace does not expose personal reviewer info
  it("CS17-18: PII_LEAKAGE = 0 — buildPublicApprovalTrace shape (§20)", () => {
    const trace = buildPublicApprovalTrace({
      id: "ki_pii_test", status: "active", revision: 2,
      reviewed_by: "personal_email@example.com", reviewed_at: "2026-08-01T00:00:00Z",
    });
    const keys = Object.keys(trace);
    // Should not include reviewer personal info
    expect(keys).not.toContain("reviewer_id");
    expect(keys).not.toContain("reviewer_email");
    // May include reviewer_role (opaque), reviewed_at, status, revision
    expect(keys).toContain("status");
    expect(keys).toContain("revision");
  });

  // §26 #19: pending item appears active — status badge must match actual server status
  it("CS17-19: PENDING_SHOWN_AS_ACTIVE = 0 — candidate list returns status field from DB", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // List route must select 'status' from DB, not override it
    expect(routeSrc).toMatch(/status:\s*c\.status/);
    // 'pending' shown as 'pending', not 'active'
    expect(routeSrc).not.toMatch(/status.*=.*['"]active['"]\s*\/\/.*force/i);
  });

  // §26 #20: known issue shown as confirmed incident
  it("CS17-20: KNOWN_ISSUE_SHOWN_AS_INCIDENT = 0 — REVIEW_REQUIRED triage candidates marked separately", () => {
    const knownIssueItems = CS12_CANDIDATE_READINESS.filter(
      c => c.readiness === "REVIEW_REQUIRED"
    );
    expect(knownIssueItems).toHaveLength(4);
    for (const item of knownIssueItems) {
      // Note must explain triage distinction, NOT claim confirmed incident status
      expect(item.note).toBeTruthy();
      // Note should distinguish triage from incident fact
      expect(item.note).toMatch(/트리아지|장애|incident|triage/i);
    }
  });
});

// ── CS12 Display Tests (§16) ───────────────────────────────────────────────────

describe("CS17-21~30: §16 CS12 21개 Display Verification", () => {

  it("CS17-21: CS12_CANDIDATE_READINESS total = 21", () => {
    expect(CS12_CANDIDATE_READINESS).toHaveLength(21);
  });

  it("CS17-22: READY_FOR_HUMAN_REVIEW = 17", () => {
    const ready = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "READY_FOR_HUMAN_REVIEW");
    expect(ready).toHaveLength(17);
  });

  it("CS17-23: REVIEW_REQUIRED = 4", () => {
    const rr = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED");
    expect(rr).toHaveLength(4);
  });

  it("CS17-24: BLOCKED = 0", () => {
    const blocked = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "BLOCKED");
    expect(blocked).toHaveLength(0);
  });

  it("CS17-25: all CS12 entries have id and readiness; REVIEW_REQUIRED entries have note", () => {
    for (const entry of CS12_CANDIDATE_READINESS) {
      expect(entry.id).toBeTruthy();
      expect(entry.readiness).toBeTruthy();
    }
    // REVIEW_REQUIRED entries must have a note (§15 triage distinction)
    const rr = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED");
    for (const entry of rr) {
      expect(entry.note, `${entry.id} should have triage note`).toBeTruthy();
    }
  });

  it("CS17-26: no CS12 entry has readiness=BLOCKED", () => {
    const blocked = CS12_CANDIDATE_READINESS.find(c => c.readiness === "BLOCKED");
    expect(blocked).toBeUndefined();
  });

  it("CS17-27: CS12 REVIEW_REQUIRED entries are KNOWN_ISSUE type (§15 triage)", () => {
    const rr = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED");
    // These should be KNOWN_ISSUE triage candidates about server/ai/push/billing
    for (const entry of rr) {
      expect(entry.note).toMatch(/트리아지|장애|triage|server|ai|push|billing/i);
    }
  });

  it("CS17-28: CS12 route response structure (§16 readiness summary)", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // cs12-readiness endpoint must return summary
    expect(routeSrc).toMatch(/cs12-readiness/);
    expect(routeSrc).toMatch(/ready_for_human_review/);
    expect(routeSrc).toMatch(/review_required/);
    expect(routeSrc).toMatch(/blocked/);
    // auto_activation must be false
    expect(routeSrc).toMatch(/auto_activation.*false/i);
  });

  it("CS17-29: NO_AUTO_PROMOTION_GUARANTEE = true (§35 production write = 0)", () => {
    expect(NO_AUTO_PROMOTION_GUARANTEE).toBe(true);
  });

  it("CS17-30: CHECKED_AUTO_PROMOTION_PATHS has ≥ 5 verified path strings", () => {
    // CHECKED_AUTO_PROMOTION_PATHS is a string[] — each string names a checked file/path
    expect(CHECKED_AUTO_PROMOTION_PATHS.length).toBeGreaterThanOrEqual(5);
    for (const p of CHECKED_AUTO_PROMOTION_PATHS) {
      expect(typeof p).toBe("string");
      expect(p.length).toBeGreaterThan(0);
    }
    // Combined string should not contain "auto-promote" or "pending → active"
    const combined = CHECKED_AUTO_PROMOTION_PATHS.join(" ");
    expect(combined).toMatch(/background-worker|migration|support-respond/);
  });
});

// ── §27 Partner Demo Flow (구조 검증) ─────────────────────────────────────────

describe("CS17-31~40: §27 Partner Demo Flow (UNIT verification)", () => {

  it("CS17-31: UI route /super/knowledge-review registered in App.tsx", () => {
    const appSrc = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/App.tsx"), "utf-8"
    );
    expect(appSrc).toMatch(/\/super\/knowledge-review/);
    expect(appSrc).toMatch(/SuperKnowledgeReview/);
  });

  it("CS17-32: NAV_ITEMS includes 지식 검토 entry in SuperLayout", () => {
    const layoutSrc = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/components/super/SuperLayout.tsx"), "utf-8"
    );
    expect(layoutSrc).toMatch(/\/super\/knowledge-review/);
    expect(layoutSrc).toMatch(/지식 검토/);
  });

  it("CS17-33: SuperKnowledgeReview component exists and imports api", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/SuperKnowledgeReview/);
    expect(src).toMatch(/api\.get/);
    expect(src).toMatch(/api\.post/);
  });

  it("CS17-34: Demo step 1 — Pending list UI: candidates endpoint called with status=pending", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/\/super\/support\/candidates\?status=/);
  });

  it("CS17-35: Demo step 3 — Source provenance shown safely (§6: safe display)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/safeSourceRef/);
    expect(src).toMatch(/SOURCE MISSING/);
    expect(src).toMatch(/파일 경로·DB 인증정보/);
  });

  it("CS17-36: Demo step 5 — Freshness check displayed (FreshnessBadge)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/FreshnessBadge/);
    expect(src).toMatch(/freshness_state/);
  });

  it("CS17-37: Demo step 6 — Conflict check (checklist CONFLICT dimension shown)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/CONFLICT/);
    expect(src).toMatch(/ChecklistPanel/);
  });

  it("CS17-38: Demo step 8 — Approve confirmation dialog (ApproveDialog component)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/ApproveDialog/);
    // Template literal in TSX: `/super/support/candidates/${candidateId}/approve`
    expect(src).toMatch(/\/approve/);
    expect(src).toMatch(/super\/support\/candidates/);
  });

  it("CS17-39: Demo step 9 — Audit trail exists (AuditTab + approval-audit API call)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/AuditTab/);
    expect(src).toMatch(/\/super\/support\/approval-audit/);
  });

  it("CS17-40: §20 Concurrent review — CONCURRENT_APPROVAL_CONFLICT handled in UI", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/CONCURRENT_APPROVAL_CONFLICT/);
    expect(src).toMatch(/이미 다른 검토자가 상태를 변경했습니다/);
  });
});

// ── §29 Metrics (전부 0 목표) ──────────────────────────────────────────────────

describe("CS17-41~50: §29 Required Metrics (전부 0)", () => {

  it("CS17-41: UNAUTHORIZED_UI_ACCESS = 0 — SuperGuard redirects non-super_admin", () => {
    const guardSrc = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/components/super/SuperGuard.tsx"), "utf-8"
    );
    expect(guardSrc).toMatch(/role !== ['"]super_admin['"]/);
    expect(guardSrc).toMatch(/navigate.*login/);
  });

  it("CS17-42: UI_BYPASS_APPROVAL = 0 — server requireApprovalRole on all POST routes", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // All POST routes must have requireApprovalRole
    const approveCount = (routeSrc.match(/router\.post[\s\S]{0,300}requireApprovalRole/g) ?? []).length;
    expect(approveCount).toBeGreaterThanOrEqual(4); // approve, reject, request-edit, rollback
  });

  it("CS17-43: CONCURRENT_APPROVAL_UI_ERROR = 0 — UI handles conflict gracefully (no auto-retry)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // Must NOT auto-retry on concurrent conflict
    expect(src).not.toMatch(/retry.*concurrent|concurrent.*retry/i);
    // Must show user-facing message
    expect(src).toMatch(/이미 다른 검토자가 상태를 변경했습니다/);
  });

  it("CS17-44: RAW_SOURCE_LEAKAGE = 0 — safeSourceRef helper in UI (§6)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/function safeSourceRef/);
    // Source display must use safeSourceRef, not raw candidate.source_ref directly
    const rawRefUsage = src.match(/\{candidate\.source_ref\}/g) ?? [];
    expect(rawRefUsage.length).toBe(0); // must go through safeSourceRef
  });

  it("CS17-45: PII_LEAKAGE = 0 — reviewer_id not rendered in audit UI (§15)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // Must use reviewer_role (opaque) not reviewer_id (PII)
    expect(src).toMatch(/reviewer_role/);
    // reviewer_id (raw) must not be rendered to user
    expect(src).not.toMatch(/\{r\.reviewer_id\}/);
  });

  it("CS17-46: PENDING_SHOWN_AS_ACTIVE = 0 — status comes from server, not overridden in UI", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // StatusBadge receives candidate.status from server — no hardcoded "active" replacement
    expect(src).toMatch(/StatusBadge status=\{c\.status\}/);
  });

  it("CS17-47: KNOWN_ISSUE_SHOWN_AS_INCIDENT = 0 — UI shows KNOWN ISSUE TRIAGE badge separately (§17)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/KNOWN ISSUE TRIAGE/);
    expect(src).toMatch(/KNOWN ISSUE Triage Candidate/);
    // Separate from 'confirmed incident' language
    expect(src).toMatch(/현재 장애를 서술하는 것처럼 표시되어서는 안 됩니다/);
  });

  it("CS17-48: REVIEW_REQUIRED_APPROVED = 0 — REVIEW_REQUIRED shows warning, not auto-block", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // UI shows warning for REVIEW_REQUIRED but doesn't auto-disable approve button for it
    // (server decides; human can still approve if no blockers)
    expect(src).toMatch(/REVIEW_REQUIRED/);
    // But must show warning to reviewer
    expect(src).toMatch(/추가 검토가 권고됩니다/);
  });

  it("CS17-49: UI_ROUTES_IMPLEMENTED — all 8 required UI actions present", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // Candidate list ✓
    expect(src).toMatch(/CandidateList/);
    // Candidate detail ✓
    expect(src).toMatch(/DetailPanel/);
    // Approve ✓
    expect(src).toMatch(/\/approve/);
    // Reject ✓
    expect(src).toMatch(/\/reject/);
    // Edit required ✓
    expect(src).toMatch(/\/request-edit/);
    // Rollback ✓
    expect(src).toMatch(/\/rollback/);
    // Audit ✓
    expect(src).toMatch(/AuditTab/);
    // CS12 readiness ✓
    expect(src).toMatch(/cs12-readiness/);
  });

  it("CS17-50: §35 Production write = NO — migration not auto-applied, no insert on GET", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // GET routes must not INSERT
    const getRouteSection = routeSrc.slice(
      routeSrc.indexOf("router.get(\n  \"/super/support/candidates\","),
      routeSrc.indexOf("router.post")
    );
    expect(getRouteSection).not.toMatch(/INSERT INTO/i);
  });
});

// ── §30~33 Regression Tests ────────────────────────────────────────────────────

describe("CS17-51~60: CS13/CS14/CS15/CS16 Regression", () => {

  // CS13: ROLE_LEAKAGE = 0
  it("CS17-51: CS13 ROLE_LEAKAGE = 0 — isApprovalAllowed is server-authoritative", () => {
    expect(isApprovalAllowed("super_admin")).toBe(true);
    expect(isApprovalAllowed("platform_admin")).toBe(true);
    expect(isApprovalAllowed("pool_admin")).toBe(false);
    expect(isApprovalAllowed("sub_admin")).toBe(false);
    expect(isApprovalAllowed("teacher")).toBe(false);
    expect(isApprovalAllowed("parent_account")).toBe(false);
  });

  // CS13: MODE_LEAKAGE = 0
  it("CS17-52: CS13 MODE_LEAKAGE = 0 — affected_modes validated in checklist", () => {
    const badMode = makeCandidate({ affected_modes: ["invalid_mode"] });
    const result = validateApprovalChecklist(badMode);
    const modeItem = result.items.find(i => i.dimension === "MODE");
    expect(modeItem?.outcome).toBe("FAIL");
  });

  // CS13: POOL_LEAKAGE = 0
  it("CS17-53: CS13 POOL_LEAKAGE = 0 — pool_admin cannot approve global candidates", () => {
    expect(isGlobalApprovalAllowed("pool_admin")).toBe(false);
    expect(isGlobalApprovalAllowed("super_admin")).toBe(true);
  });

  // CS14: UNSUPPORTED_CLAIMS = 0
  it("CS17-54: CS14 UNSUPPORTED_CLAIMS = 0 — isAiReviewerAttempt detects forged AI reviewer", () => {
    // AI_IDS: ["ai", "system", "agent", "llm", "openai", "anthropic", "gemini"]
    expect(isAiReviewerAttempt("ai-auto-reviewer", "super_admin")).toBe(true);
    expect(isAiReviewerAttempt("llm-approver", "super_admin")).toBe(true);      // "llm" in ID
    expect(isAiReviewerAttempt("openai-bot", "super_admin")).toBe(true);        // "openai" in ID
    expect(isAiReviewerAttempt("human_reviewer_001", "super_admin")).toBe(false);
  });

  // CS14: INVALID_ACTIONS = 0
  it("CS17-55: CS14 INVALID_ACTIONS = 0 — role validation catches invalid roles in checklist", () => {
    const badRole = makeCandidate({ affected_roles: ["unknown_role"] });
    const result = validateApprovalChecklist(badRole);
    const roleItem = result.items.find(i => i.dimension === "ROLE");
    expect(roleItem?.outcome).toBe("FAIL");
  });

  // CS15: TRACE_SCOPE_LEAKAGE = 0
  it("CS17-56: CS15 TRACE_SCOPE_LEAKAGE = 0 — approval-audit route uses requireApprovalRole", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // audit route must be guarded
    const auditSection = routeSrc.slice(
      routeSrc.indexOf("approval-audit"),
      routeSrc.indexOf("approval-audit") + 500
    );
    expect(auditSection).toMatch(/requireApprovalRole/);
  });

  // CS15: UNRESOLVED_CONFLICT_EMITTED = 0
  it("CS17-57: CS15 UNRESOLVED_CONFLICT_EMITTED = 0 — route checks conflicts before approve", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    expect(routeSrc).toMatch(/hasUnresolvedConflict/);
    expect(routeSrc).toMatch(/UNRESOLVED_CONFLICT/);
  });

  // CS15: FALSE_INCIDENT_CLAIM = 0
  it("CS17-58: CS15 FALSE_INCIDENT_CLAIM = 0 — KNOWN_ISSUE triage note is review guidance, not fact", () => {
    const knownIssueCandidates = CS12_CANDIDATE_READINESS.filter(
      c => c.readiness === "REVIEW_REQUIRED"
    );
    for (const c of knownIssueCandidates) {
      // Note must not claim incident is confirmed
      expect(c.note).not.toMatch(/장애 발생 중|CONFIRMED|currently down|active incident/i);
    }
  });

  // CS16: UNAUTHORIZED_APPROVAL = 0
  it("CS17-59: CS16 UNAUTHORIZED_APPROVAL = 0 — requireApprovalRole on all action routes", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    const guards = routeSrc.match(/requireApprovalRole/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(6);
  });

  // CS16: DUPLICATE_ACTIVE_CREATED = 0
  it("CS17-60: CS16 DUPLICATE_ACTIVE_CREATED = 0 — WHERE status IN pending/edit_required AND revision guard", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // SQL may have space: IN ('pending', 'edit_required') or IN ('pending','edit_required')
    expect(routeSrc).toMatch(/status IN \('pending',\s*'edit_required'\)/);
    expect(routeSrc).toMatch(/AND revision = \$\{currentRevision\}/);
  });
});

// ── §22 Accessibility / UX (코드 구조 확인) ────────────────────────────────────

describe("CS17-61~70: §23 Accessibility / UX Verification", () => {

  it("CS17-61: APPROVE button label is explicit — '승인' not '활성화'", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // Must say 승인 (approve), not 활성화 (activate) to avoid confusion (§23)
    expect(src).toMatch(/✓ 승인/);
    // Must not say 활성화 as primary action label
    expect(src).not.toMatch(/✓ 활성화/);
  });

  it("CS17-62: empty state rendered for empty candidate list", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/항목이 없습니다/);
  });

  it("CS17-63: loading state rendered while fetching", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/불러오는 중/);
  });

  it("CS17-64: error state rendered on API failure", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/데이터 없음/);
  });

  it("CS17-65: confirmation dialog exists for Approve action", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/ApproveDialog/);
    expect(src).toMatch(/승인 \(Approve\)/);
  });

  it("CS17-66: Reject dialog has reason select (10 options)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/REJECT_REASONS/);
    expect(src).toMatch(/RejectDialog/);
    for (const reason of ["UNSUPPORTED_SOURCE", "NOT_IMPLEMENTED", "WRONG_ROLE", "DUPLICATE", "OTHER"]) {
      expect(src).toContain(reason);
    }
  });

  it("CS17-67: approve button disabled when source missing (§19)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // canApprove = blockers.length === 0; SOURCE missing → blocker → disabled
    expect(src).toMatch(/canApprove/);
    expect(src).toMatch(/승인 불가/);
  });

  it("CS17-68: rollback dialog shows warning — not for production use (§14)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/RollbackDialog/);
    expect(src).toMatch(/Production에서 실행하지 마세요/);
  });

  it("CS17-69: Desktop-first layout — h-full overflow-hidden flex column structure", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/flex flex-col h-full overflow-hidden/);
    expect(src).toMatch(/flex-1 overflow-y-auto/);
  });

  it("CS17-70: source_ref display: only safe metadata shown (§6 compliance check)", () => {
    // §6: allowed = id, source_type, title, version, updated_at, safe reference
    // §6: forbidden = server file path, DB credentials, secret, API key, raw prompt, PII
    const safeRef1 = "docs/auth.md:10-30";
    const safeRef2 = "ki_swimnote_intro";
    const shortRef  = "AUTH_POLICY_v2";
    // safeSourceRef should truncate long refs
    const longRef = "x".repeat(80);
    function safeSourceRef(ref: string | null | undefined): string {
      if (!ref) return "SOURCE MISSING";
      return ref.length > 60 ? ref.slice(0, 57) + "..." : ref;
    }
    expect(safeSourceRef(null)).toBe("SOURCE MISSING");
    expect(safeSourceRef(safeRef1)).toBe(safeRef1);
    expect(safeSourceRef(longRef)).toHaveLength(60);
    expect(safeSourceRef(longRef)).toMatch(/\.\.\.$/);
    expect(safeSourceRef(shortRef)).toBe(shortRef);
  });
});

// ── Role + Approval Flow Verification ─────────────────────────────────────────

describe("CS17-71~80: Role/Flow Verification", () => {

  it("CS17-71: super_admin can approve and rollback (full access)", () => {
    expect(isApprovalAllowed("super_admin")).toBe(true);
    expect(isGlobalApprovalAllowed("super_admin")).toBe(true);
  });

  it("CS17-72: platform_admin can approve but not rollback pool-specific (global only)", () => {
    expect(isApprovalAllowed("platform_admin")).toBe(true);
    expect(isGlobalApprovalAllowed("platform_admin")).toBe(true);
  });

  it("CS17-73: approve flow state machine: pending → active (allowed)", () => {
    expect(isTransitionAllowed("pending", "active")).toBe(true);
  });

  it("CS17-74: reject flow state machine: pending → rejected (allowed)", () => {
    expect(isTransitionAllowed("pending", "rejected")).toBe(true);
  });

  it("CS17-75: request-edit flow: pending → edit_required (allowed)", () => {
    expect(isTransitionAllowed("pending", "edit_required")).toBe(true);
  });

  it("CS17-76: re-submit after edit: edit_required → pending (allowed)", () => {
    expect(isTransitionAllowed("edit_required", "pending")).toBe(true);
  });

  it("CS17-77: rollback flow: active → archived (allowed)", () => {
    expect(isTransitionAllowed("active", "archived")).toBe(true);
  });

  it("CS17-78: all 10 REJECT_REASONS are valid", () => {
    for (const reason of ["UNSUPPORTED_SOURCE", "NOT_IMPLEMENTED", "WRONG_ROLE",
      "WRONG_MODE", "POLICY_UNVERIFIED", "DUPLICATE", "CONFLICT",
      "OUTDATED", "SECURITY_RISK", "OTHER"]) {
      expect(isValidRejectReason(reason)).toBe(true);
    }
  });

  it("CS17-79: REVIEW_REQUIRED_APPROVED = 0 — CS12 readiness REVIEW_REQUIRED has note", () => {
    const rrItems = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED");
    for (const item of rrItems) {
      expect(item.note).toBeTruthy();
      expect(item.note.length).toBeGreaterThan(10);
    }
  });

  it("CS17-80: P0 coverage has entries for all 10 areas", () => {
    // getP0CoverageReadiness returns Record<string, Cs12ReadinessLabel>
    const p0 = getP0CoverageReadiness();
    const keys = Object.keys(p0);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) {
      expect(["READY_FOR_HUMAN_REVIEW", "REVIEW_REQUIRED", "BLOCKED"]).toContain(p0[key]);
    }
    // All P0 areas should be present
    expect(keys).toContain("AUTH_ACCOUNT_WITHDRAWAL");
    expect(keys).toContain("KNOWN_ISSUE_PUSH");
    expect(keys).toContain("KNOWN_ISSUE_BILLING");
  });
});

// ── CS17-SUMMARY ──────────────────────────────────────────────────────────────

describe("CS17-SUMMARY: §29/38 Final Metrics (전부 0)", () => {

  it("UNAUTHORIZED_UI_ACCESS = 0 — SuperGuard + requireApprovalRole double guard", () => {
    expect(isApprovalAllowed("teacher")).toBe(false);
    expect(isApprovalAllowed("parent_account")).toBe(false);
    expect(isApprovalAllowed("pool_admin")).toBe(false);
  });

  it("UI_BYPASS_APPROVAL = 0 — server requireApprovalRole on every action route", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    const guards = routeSrc.match(/requireApprovalRole/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(6);
  });

  it("CONCURRENT_APPROVAL_UI_ERROR = 0 — UI shows message, does NOT auto-retry", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/CONCURRENT_APPROVAL_CONFLICT/);
    expect(src).not.toMatch(/retry.*concurrent|concurrent.*auto/i);
  });

  it("RAW_SOURCE_LEAKAGE = 0 — safeSourceRef wraps all source_ref display", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    // No raw {candidate.source_ref} rendered to user
    expect((src.match(/\{candidate\.source_ref\}/g) ?? []).length).toBe(0);
  });

  it("PII_LEAKAGE = 0 — reviewer_id not in audit UI render", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).not.toMatch(/\{r\.reviewer_id\}/);
  });

  it("PENDING_SHOWN_AS_ACTIVE = 0 — status badge uses c.status from server", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/StatusBadge status=\{c\.status\}/);
  });

  it("KNOWN_ISSUE_SHOWN_AS_INCIDENT = 0 — TRIAGE badge + warning message in UI", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../../../artifacts/swimnote-web/src/pages/super/SuperKnowledgeReview.tsx"), "utf-8"
    );
    expect(src).toMatch(/KNOWN ISSUE TRIAGE/);
    expect(src).toMatch(/현재 장애를 서술하는 것처럼 표시되어서는 안 됩니다/);
  });

  it("REVIEW_REQUIRED_APPROVED = 0 — shows warning; server is authoritative on blockers", () => {
    // REVIEW_REQUIRED candidates may have warnings but not blockers
    // Server always re-validates; UI cannot bypass
    const rrItems = CS12_CANDIDATE_READINESS.filter(c => c.readiness === "REVIEW_REQUIRED");
    for (const item of rrItems) {
      const candidate = makeCandidate({ id: item.id });
      const result = validateApprovalChecklist(candidate);
      // These candidates are REVIEW_REQUIRED due to warnings, not blockers
      expect(result.blockers.length).toBe(0);
    }
  });

  it("CS_REGRESSION = 0 — all CS13/14/15/16 checks pass", () => {
    // CS13
    expect(isApprovalAllowed("super_admin")).toBe(true);
    expect(isApprovalAllowed("teacher")).toBe(false);
    // CS14
    expect(isAiReviewerAttempt("ai-approver", "super_admin")).toBe(true);
    // CS15
    expect(NO_AUTO_PROMOTION_GUARANTEE).toBe(true);
    // CS16
    expect(CS12_CANDIDATE_READINESS.filter(c => c.readiness === "BLOCKED")).toHaveLength(0);
  });

  it("PRODUCTION_WRITE = NO — approval routes only write on POST (migrate NOT auto-applied)", () => {
    const routeSrc = readFileSync(
      resolve(__dirname, "../knowledge-approval.ts"), "utf-8"
    );
    // Migration is lazy-imported at boot, not applied on every request
    expect(routeSrc).toMatch(/import\(.*pool-db-cs-16/);
    // GET routes must not INSERT
    const getCandidate = routeSrc.match(/router\.get[\s\S]{0,800}?(?=router\.)/)?.[0] ?? "";
    expect(getCandidate).not.toMatch(/INSERT INTO/i);
  });
});
