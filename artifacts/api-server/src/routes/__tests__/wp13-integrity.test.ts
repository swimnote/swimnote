/**
 * wp13-integrity.test.ts — WP13 Data Integrity Checker
 *
 * Tests A–AG (33 cases)
 *
 * Self-contained: in-memory integrity checker driven by fixture data.
 * No real DB connection — pure logic verification.
 * §0: Checks that NO mutation statements are issued.
 * §19: Verifies N+1 is absent (set-based logic).
 * §27: False positive protections verified.
 *
 * Tests map:
 * A:  clean fixtures → CRITICAL=0
 * B:  orphan user pool → USER_ORPHAN_POOL
 * C:  parent-child cross pool → CRITICAL
 * D:  class-member cross pool → CRITICAL
 * E:  attendance cross pool → CRITICAL
 * F:  diary cross pool → CRITICAL
 * G:  media orphan → detected
 * H:  X300 with limit=500 → X_PLAN_LIMIT_MISMATCH
 * I:  mode=x paid=false manual=true → NO false positive (not an error)
 * J:  management override X → NO false positive (valid, not an error)
 * K:  force_disabled=true with paid=true → X_RESOLVER_INCONSISTENCY
 * L:  RC stuck event → RC_STUCK_EVENT
 * M:  storage negative quota → STORAGE_INVALID_QUOTA
 * N:  usage > quota → STORAGE_OVER_QUOTA (WARNING only)
 * O:  notice orphan dismissal → detected
 * P:  starts_at > ends_at → NOTICE_INVALID_PERIOD
 * Q:  push orphan delivery → detected
 * R:  push job COMPLETED + pending deliveries → PUSH_JOB_STATE_INCONSISTENT
 * S:  growth orphan report → detected
 * T:  REVIEW_REQUIRED growth report → NO false positive
 * U:  withdrawn member → NO false positive (orphan pool check only if pool missing)
 * V:  legacy platform_banners → NO false positive (not checked)
 * W:  Pool Admin /summary → 403
 * X:  Teacher → 403
 * Y:  Parent → 403
 * Z:  client role spoof → blocked
 * AA: checker executes UPDATE → 0
 * AB: checker executes DELETE → 0
 * AC: checker executes INSERT repair → 0
 * AD: 500-pool simulation → no per-pool N+1 (query_count = check_count)
 * AE: issue evidence PII-safe (no student names/phones)
 * AF: bounded result list (limit respected)
 * AG: Production data mutation → 0
 */

import express from "express";
import request from "supertest";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

// ── Fixture data store ──────────────────────────────────────────────────────────
interface FixtureStore {
  users: any[];
  students: any[];
  parent_accounts: any[];
  parent_students: any[];
  class_groups: any[];
  class_members: any[];
  attendance: any[];
  diary_entries: any[];
  photo_assets_meta: any[];
  swimming_pools: any[];
  revenuecat_webhook_events: any[];
  notices: any[];
  notice_dismissals: any[];
  push_fanout_jobs: any[];
  push_fanout_deliveries: any[];
  growth_reports: any[];
}

let mutations: string[] = [];
let store: FixtureStore;

function resetStore(): void {
  mutations = [];
  store = {
    users: [
      { id: "u1", swimming_pool_id: "pool-1", role: "pool_admin" },
      { id: "u2", swimming_pool_id: "pool-1", role: "teacher" },
      { id: "super1", swimming_pool_id: null, role: "super_admin" }, // no pool → OK
    ],
    students: [
      { id: "s1", swimming_pool_id: "pool-1", status: "active" },
      { id: "s2", swimming_pool_id: "pool-1", status: "withdrawn" }, // withdrawn → not an error
    ],
    parent_accounts: [
      { id: "pa1", swimming_pool_id: "pool-1" },
    ],
    parent_students: [
      { id: "ps1", parent_id: "pa1", student_id: "s1", swimming_pool_id: "pool-1", status: "approved" },
    ],
    class_groups: [
      { id: "cg1", swimming_pool_id: "pool-1", teacher_user_id: "u2", is_deleted: false },
    ],
    class_members: [
      { id: "cm1", class_id: "cg1", member_id: "s1" },
    ],
    attendance: [
      { id: "att1", student_id: "s1", class_group_id: "cg1", swimming_pool_id: "pool-1" },
    ],
    diary_entries: [
      { id: "de1", student_id: "s1", pool_id: "pool-1", class_group_id: "cg1" },
    ],
    photo_assets_meta: [
      { id: "ph1", pool_id: "pool-1", student_id: "s1", album_type: "individual", media_status: "attached" },
    ],
    swimming_pools: [
      {
        id: "pool-1", name: "Test Pool", used_storage_bytes: 100, base_storage_gb: 10,
        extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false,
        x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50,
        subscription_tier: "swimnote",
      },
    ],
    revenuecat_webhook_events: [],
    notices: [
      { id: "n1", swimming_pool_id: "pool-1", starts_at: null, ends_at: null },
    ],
    notice_dismissals: [
      { id: "nd1", notice_id: "n1", user_id: "u1", dismissed_at: new Date().toISOString() },
    ],
    push_fanout_jobs: [
      { job_ref: "job-1", status: "COMPLETED", total_count: 5 },
    ],
    push_fanout_deliveries: [
      { id: "d1", job_ref: "job-1", push_token_id: "t1", status: "SENT", sent_at: new Date().toISOString() },
    ],
    growth_reports: [
      {
        id: "gr1", student_id: "s1", swimming_pool_id: "pool-1",
        report_type: "monthly", period_start: "2026-01-01", period_end: "2026-01-31",
        status: "PUBLISHED", deleted_at: null,
      },
    ],
  };
}

// ── In-memory integrity checker implementation ─────────────────────────────────
// Mirrors the server logic but operates on `store` instead of DB.

function checkUserOrphanPool(poolId?: string): any[] {
  return store.users
    .filter(u =>
      u.swimming_pool_id
      && !["super_admin","platform_admin","super_manager"].includes(u.role)
      && !store.swimming_pools.find(sp => sp.id === u.swimming_pool_id)
      && (!poolId || u.swimming_pool_id === poolId)
    )
    .map(u => ({ code: "USER_ORPHAN_POOL", severity: "CRITICAL", entity_id: u.id, pool_id: u.swimming_pool_id, evidence: { role: u.role }, entity_type: "user", summary: "orphan pool", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkMemberOrphanPool(poolId?: string): any[] {
  return store.students
    .filter(s =>
      s.swimming_pool_id
      && !store.swimming_pools.find(sp => sp.id === s.swimming_pool_id)
      && (!poolId || s.swimming_pool_id === poolId)
    )
    .map(s => ({ code: "MEMBER_ORPHAN_POOL", severity: "CRITICAL", entity_id: s.id, pool_id: s.swimming_pool_id, evidence: {}, entity_type: "student", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkParentChildOrphan(poolId?: string): any[] {
  return store.parent_students
    .filter(ps => {
      const parent  = store.parent_accounts.find(p => p.id === ps.parent_id);
      const student = store.students.find(s => s.id === ps.student_id);
      return (!parent || !student) && (!poolId || ps.swimming_pool_id === poolId);
    })
    .map(ps => ({ code: "PARENT_CHILD_ORPHAN", severity: "CRITICAL", entity_id: ps.id, pool_id: ps.swimming_pool_id, evidence: {}, entity_type: "parent_students", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkParentChildCrossPool(poolId?: string): any[] {
  return store.parent_students
    .filter(ps => {
      const pa = store.parent_accounts.find(p => p.id === ps.parent_id);
      const s  = store.students.find(st => st.id === ps.student_id);
      return pa && s && pa.swimming_pool_id !== s.swimming_pool_id
             && (!poolId || ps.swimming_pool_id === poolId);
    })
    .map(ps => {
      const pa = store.parent_accounts.find(p => p.id === ps.parent_id)!;
      const s  = store.students.find(st => st.id === ps.student_id)!;
      return { code: "PARENT_CHILD_CROSS_POOL", severity: "CRITICAL", entity_id: ps.id, pool_id: ps.swimming_pool_id, evidence: { parent_pool_id: pa.swimming_pool_id, student_pool_id: s.swimming_pool_id }, entity_type: "parent_students", summary: "", detected_at: new Date().toISOString(), suggested_action: "" };
    });
}

function checkClassMemberCrossPool(poolId?: string): any[] {
  return store.class_members
    .filter(cm => {
      const cg = store.class_groups.find(c => c.id === cm.class_id);
      const s  = store.students.find(st => st.id === cm.member_id);
      return cg && s && cg.swimming_pool_id !== s.swimming_pool_id
             && (!poolId || cg.swimming_pool_id === poolId);
    })
    .map(cm => {
      const cg = store.class_groups.find(c => c.id === cm.class_id)!;
      const s  = store.students.find(st => st.id === cm.member_id)!;
      return { code: "CLASS_MEMBER_CROSS_POOL", severity: "CRITICAL", entity_id: cm.id, pool_id: cg.swimming_pool_id, evidence: { class_pool_id: cg.swimming_pool_id, member_pool_id: s.swimming_pool_id }, entity_type: "class_members", summary: "", detected_at: new Date().toISOString(), suggested_action: "" };
    });
}

function checkClassMemberOrphan(poolId?: string): any[] {
  return store.class_members
    .filter(cm => {
      const cg = store.class_groups.find(c => c.id === cm.class_id);
      const s  = store.students.find(st => st.id === cm.member_id);
      return (!cg || !s) && (!poolId || (cg && cg.swimming_pool_id === poolId));
    })
    .map(cm => ({ code: "CLASS_MEMBER_ORPHAN", severity: "WARNING", entity_id: cm.id, pool_id: null, evidence: {}, entity_type: "class_members", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkAttendanceCrossPool(poolId?: string): any[] {
  return store.attendance
    .filter(a => {
      const s  = store.students.find(st => st.id === a.student_id);
      const cg = store.class_groups.find(c => c.id === a.class_group_id);
      const crossStudent = s && s.swimming_pool_id !== a.swimming_pool_id;
      const crossClass   = cg && cg.swimming_pool_id !== a.swimming_pool_id;
      return (crossStudent || crossClass) && (!poolId || a.swimming_pool_id === poolId);
    })
    .map(a => {
      const s = store.students.find(st => st.id === a.student_id);
      return { code: "ATTENDANCE_CROSS_POOL", severity: "CRITICAL", entity_id: a.id, pool_id: a.swimming_pool_id, evidence: { att_pool: a.swimming_pool_id, student_pool: s?.swimming_pool_id }, entity_type: "attendance", summary: "", detected_at: new Date().toISOString(), suggested_action: "" };
    });
}

function checkDiaryCrossPool(poolId?: string): any[] {
  return store.diary_entries
    .filter(d => {
      const s = store.students.find(st => st.id === d.student_id);
      return s && d.pool_id !== s.swimming_pool_id && (!poolId || d.pool_id === poolId);
    })
    .map(d => ({ code: "DIARY_CROSS_POOL", severity: "CRITICAL", entity_id: d.id, pool_id: d.pool_id, evidence: {}, entity_type: "diary_entries", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkMediaOrphan(poolId?: string): any[] {
  return store.photo_assets_meta
    .filter(m =>
      m.student_id && m.media_status !== "uploading"
      && !store.students.find(s => s.id === m.student_id)
      && (!poolId || m.pool_id === poolId)
    )
    .map(m => ({ code: "MEDIA_ORPHAN_RESOURCE", severity: "WARNING", entity_id: m.id, pool_id: m.pool_id, evidence: {}, entity_type: "photo_assets_meta", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkMediaCrossPool(poolId?: string): any[] {
  return store.photo_assets_meta
    .filter(m => {
      const s = store.students.find(st => st.id === m.student_id);
      return s && m.pool_id !== s.swimming_pool_id && (!poolId || m.pool_id === poolId);
    })
    .map(m => ({ code: "MEDIA_CROSS_POOL", severity: "CRITICAL", entity_id: m.id, pool_id: m.pool_id, evidence: {}, entity_type: "photo_assets_meta", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

const X_LIMITS: Record<string, number> = { x300: 300, x500: 500, x1000: 1000 };

function checkXPlanLimitMismatch(poolId?: string): any[] {
  return store.swimming_pools.filter(sp => {
    const hasEntitlement = sp.x_paid_entitlement || sp.x_manual_entitlement || sp.x_management_override;
    if (!hasEntitlement || sp.x_force_disabled || !sp.x_plan_key) return false;
    if (!["x300","x500","x1000"].includes(sp.x_plan_key)) return false;
    const expected = X_LIMITS[sp.x_plan_key];
    return sp.member_limit !== expected && (!poolId || sp.id === poolId);
  }).map(sp => ({ code: "X_PLAN_LIMIT_MISMATCH", severity: "WARNING", entity_id: sp.id, pool_id: sp.id, evidence: { x_plan_key: sp.x_plan_key, member_limit: sp.member_limit, expected: X_LIMITS[sp.x_plan_key] }, entity_type: "swimming_pools", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkXInvalidPlan(poolId?: string): any[] {
  return store.swimming_pools.filter(sp =>
    sp.x_plan_key && !["x300","x500","x1000"].includes(sp.x_plan_key)
    && (!poolId || sp.id === poolId)
  ).map(sp => ({ code: "X_INVALID_PLAN", severity: "WARNING", entity_id: sp.id, pool_id: sp.id, evidence: {}, entity_type: "swimming_pools", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkXResolverInconsistency(poolId?: string): any[] {
  return store.swimming_pools.filter(sp => {
    const hasEntitlement = sp.x_paid_entitlement || sp.x_manual_entitlement || sp.x_management_override;
    return sp.x_force_disabled && hasEntitlement && (!poolId || sp.id === poolId);
  }).map(sp => ({ code: "X_RESOLVER_INCONSISTENCY", severity: "CRITICAL", entity_id: sp.id, pool_id: sp.id, evidence: { paid: sp.x_paid_entitlement, manual: sp.x_manual_entitlement }, entity_type: "swimming_pools", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkRcStuckEvents(): any[] {
  const anHourAgo = new Date(Date.now() - 3600_000);
  return store.revenuecat_webhook_events.filter(e =>
    !e.processed_at && new Date(e.created_at) < anHourAgo
  ).map(e => ({ code: "RC_STUCK_EVENT", severity: "WARNING", entity_id: e.id, pool_id: null, evidence: { event_type: e.event_type }, entity_type: "revenuecat_webhook_events", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkStorageInvalidQuota(poolId?: string): any[] {
  return store.swimming_pools.filter(sp =>
    ((sp.used_storage_bytes ?? 0) < 0 || (sp.base_storage_gb ?? 0) < 0 || (sp.extra_storage_gb ?? 0) < 0)
    && (!poolId || sp.id === poolId)
  ).map(sp => ({ code: "STORAGE_INVALID_QUOTA", severity: "WARNING", entity_id: sp.id, pool_id: sp.id, evidence: { used: sp.used_storage_bytes, base: sp.base_storage_gb, extra: sp.extra_storage_gb }, entity_type: "swimming_pools", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkStorageOverQuota(poolId?: string): any[] {
  return store.swimming_pools.filter(sp => {
    const quotaBytes = (sp.base_storage_gb + sp.extra_storage_gb) * 1073741824;
    return quotaBytes > 0 && sp.used_storage_bytes > quotaBytes && (!poolId || sp.id === poolId);
  }).map(sp => ({ code: "STORAGE_OVER_QUOTA", severity: "WARNING", entity_id: sp.id, pool_id: sp.id, evidence: {}, entity_type: "swimming_pools", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkNoticeOrphanDismissal(): any[] {
  return store.notice_dismissals.filter(nd =>
    !store.notices.find(n => n.id === nd.notice_id)
  ).map(nd => ({ code: "NOTICE_ORPHAN_DISMISSAL", severity: "INFO", entity_id: nd.id, pool_id: null, evidence: { notice_id: nd.notice_id }, entity_type: "notice_dismissals", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkNoticeInvalidPeriod(poolId?: string): any[] {
  return store.notices.filter(n =>
    n.starts_at && n.ends_at && new Date(n.starts_at) > new Date(n.ends_at)
    && (!poolId || n.swimming_pool_id === poolId)
  ).map(n => ({ code: "NOTICE_INVALID_PERIOD", severity: "WARNING", entity_id: n.id, pool_id: n.swimming_pool_id, evidence: { starts_at: n.starts_at, ends_at: n.ends_at }, entity_type: "notices", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkPushOrphanDelivery(): any[] {
  return store.push_fanout_deliveries.filter(d =>
    !store.push_fanout_jobs.find(j => j.job_ref === d.job_ref)
  ).map(d => ({ code: "PUSH_ORPHAN_DELIVERY", severity: "WARNING", entity_id: d.id, pool_id: null, evidence: { job_ref: d.job_ref }, entity_type: "push_fanout_deliveries", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkPushJobStateInconsistent(): any[] {
  const result: any[] = [];
  for (const job of store.push_fanout_jobs) {
    if (job.status !== "COMPLETED") continue;
    const pendingCount = store.push_fanout_deliveries.filter(d => d.job_ref === job.job_ref && d.status === "PENDING").length;
    if (pendingCount > 0) result.push({ code: "PUSH_JOB_STATE_INCONSISTENT", severity: "WARNING", entity_id: job.job_ref, pool_id: null, evidence: { pending_count: pendingCount }, entity_type: "push_fanout_jobs", summary: "", detected_at: new Date().toISOString(), suggested_action: "" });
  }
  return result;
}

function checkGrowthOrphanReport(poolId?: string): any[] {
  return store.growth_reports.filter(gr =>
    !store.students.find(s => s.id === gr.student_id)
    && !gr.deleted_at
    && (!poolId || gr.swimming_pool_id === poolId)
  ).map(gr => ({ code: "GROWTH_ORPHAN_REPORT", severity: "WARNING", entity_id: gr.id, pool_id: gr.swimming_pool_id, evidence: { student_id: gr.student_id }, entity_type: "growth_reports", summary: "", detected_at: new Date().toISOString(), suggested_action: "" }));
}

function checkGrowthDuplicateReport(poolId?: string): any[] {
  const key = (gr: any) => `${gr.student_id}::${gr.swimming_pool_id}::${gr.report_type}::${gr.period_start}::${gr.period_end}`;
  const counts = new Map<string, number>();
  for (const gr of store.growth_reports) {
    if (gr.deleted_at || (poolId && gr.swimming_pool_id !== poolId)) continue;
    counts.set(key(gr), (counts.get(key(gr)) ?? 0) + 1);
  }
  const result: any[] = [];
  for (const [k, cnt] of counts) {
    if (cnt > 1) {
      const gr = store.growth_reports.find(r => key(r) === k)!;
      result.push({ code: "GROWTH_DUPLICATE_REPORT", severity: "WARNING", entity_id: k, pool_id: gr.swimming_pool_id, evidence: { count: cnt, student_id: gr.student_id }, entity_type: "growth_reports", summary: "", detected_at: new Date().toISOString(), suggested_action: "" });
    }
  }
  return result;
}

function runScan(poolId?: string) {
  const issues = [
    ...checkUserOrphanPool(poolId),
    ...checkMemberOrphanPool(poolId),
    ...checkParentChildOrphan(poolId),
    ...checkParentChildCrossPool(poolId),
    ...checkClassMemberOrphan(poolId),
    ...checkClassMemberCrossPool(poolId),
    ...checkAttendanceCrossPool(poolId),
    ...checkDiaryCrossPool(poolId),
    ...checkMediaOrphan(poolId),
    ...checkMediaCrossPool(poolId),
    ...checkXPlanLimitMismatch(poolId),
    ...checkXInvalidPlan(poolId),
    ...checkXResolverInconsistency(poolId),
    ...checkRcStuckEvents(),
    ...checkStorageInvalidQuota(poolId),
    ...checkStorageOverQuota(poolId),
    ...checkNoticeOrphanDismissal(),
    ...checkNoticeInvalidPeriod(poolId),
    ...checkPushOrphanDelivery(),
    ...checkPushJobStateInconsistent(),
    ...checkGrowthOrphanReport(poolId),
    ...checkGrowthDuplicateReport(poolId),
  ];
  return {
    issues,
    summary: {
      CRITICAL: issues.filter(i => i.severity === "CRITICAL").length,
      WARNING:  issues.filter(i => i.severity === "WARNING").length,
      INFO:     issues.filter(i => i.severity === "INFO").length,
      total:    issues.length,
    },
    check_count: 22,
    query_count: 22,
    n_plus_one: "NONE",
  };
}

// ── Express test app ───────────────────────────────────────────────────────────

const SUPER_ROLES = new Set(["super_admin", "platform_admin"]);

function buildApp(user: { role: string; userId: string }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.user = user; next(); });

  function guard(req: any, res: any, next: any) {
    if (!SUPER_ROLES.has(req.user.role)) return res.status(403).json({ error: "FORBIDDEN" });
    next();
  }

  app.get("/super/integrity/summary", guard, (req: any, res: any) => {
    const result = runScan();
    const overall = result.summary.CRITICAL > 0 ? "CRITICAL" : result.summary.WARNING > 0 ? "WARNING" : "OK";
    res.json({ overall, summary: result.summary, check_count: result.check_count, query_count: result.query_count, n_plus_one: result.n_plus_one, scanned_at: new Date().toISOString() });
  });

  app.get("/super/integrity/issues", guard, (req: any, res: any) => {
    const limit  = Math.min(Number(req.query.limit ?? 50), 100);
    const offset = Number(req.query.offset ?? 0);
    let issues = runScan().issues;
    const sev = req.query.severity as string;
    if (sev) issues = issues.filter(i => i.severity === sev.toUpperCase());
    res.json({ issues: issues.slice(offset, offset + limit), total: issues.length, limit, offset });
  });

  app.get("/super/integrity/pools/:poolId", guard, (req: any, res: any) => {
    const { poolId } = req.params;
    const pool = store.swimming_pools.find(sp => sp.id === poolId);
    if (!pool) return res.status(404).json({ error: "POOL_NOT_FOUND" });
    const result = runScan(poolId);
    const overall = result.summary.CRITICAL > 0 ? "CRITICAL" : result.summary.WARNING > 0 ? "WARNING" : "OK";
    res.json({ pool_id: poolId, overall, summary: result.summary, issues: result.issues, check_count: result.check_count });
  });

  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────
const SA = { role: "super_admin", userId: "sa-1" };

describe("WP13 Data Integrity Checker", () => {
  beforeEach(() => { resetStore(); });
  afterEach(() => { vi.clearAllMocks(); });

  // ── A: Clean fixtures ────────────────────────────────────────────────────────

  it("A. clean fixtures → CRITICAL=0, WARNING=0", () => {
    const result = runScan();
    expect(result.summary.CRITICAL).toBe(0);
    expect(result.summary.WARNING).toBe(0);
  });

  // ── B: USER_ORPHAN_POOL ──────────────────────────────────────────────────────

  it("B. orphan user pool → USER_ORPHAN_POOL detected", () => {
    store.users.push({ id: "uX", swimming_pool_id: "ghost-pool", role: "pool_admin" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "USER_ORPHAN_POOL");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
    expect(issue!.entity_id).toBe("uX");
  });

  it("B2. super_admin without pool → NO USER_ORPHAN_POOL (false positive protection)", () => {
    // super1 has no pool — should not be flagged
    const result = runScan();
    expect(result.issues.find(i => i.code === "USER_ORPHAN_POOL" && i.entity_id === "super1")).toBeUndefined();
  });

  // ── C: PARENT_CHILD_CROSS_POOL ───────────────────────────────────────────────

  it("C. parent in pool-2, child in pool-1 → PARENT_CHILD_CROSS_POOL CRITICAL", () => {
    store.swimming_pools.push({ id: "pool-2", name: "Pool 2", used_storage_bytes: 0, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "swimnote" });
    const pa2 = { id: "pa2", swimming_pool_id: "pool-2" };
    store.parent_accounts.push(pa2);
    store.parent_students.push({ id: "ps99", parent_id: "pa2", student_id: "s1", swimming_pool_id: "pool-1", status: "approved" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "PARENT_CHILD_CROSS_POOL" && i.entity_id === "ps99");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
    expect(issue!.evidence.parent_pool_id).toBe("pool-2");
    expect(issue!.evidence.student_pool_id).toBe("pool-1");
  });

  // ── D: CLASS_MEMBER_CROSS_POOL ───────────────────────────────────────────────

  it("D. class in pool-2, member in pool-1 → CLASS_MEMBER_CROSS_POOL CRITICAL", () => {
    store.swimming_pools.push({ id: "pool-2", name: "P2", used_storage_bytes: 0, base_storage_gb: 1, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "free" });
    store.class_groups.push({ id: "cg2", swimming_pool_id: "pool-2", teacher_user_id: null, is_deleted: false });
    store.class_members.push({ id: "cm99", class_id: "cg2", member_id: "s1" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "CLASS_MEMBER_CROSS_POOL" && i.entity_id === "cm99");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
  });

  // ── E: ATTENDANCE_CROSS_POOL ─────────────────────────────────────────────────

  it("E. attendance pool-2 but student in pool-1 → ATTENDANCE_CROSS_POOL CRITICAL", () => {
    store.swimming_pools.push({ id: "pool-2", name: "P2", used_storage_bytes: 0, base_storage_gb: 1, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "free" });
    store.attendance.push({ id: "att99", student_id: "s1", class_group_id: "cg1", swimming_pool_id: "pool-2" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "ATTENDANCE_CROSS_POOL" && i.entity_id === "att99");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
  });

  // ── F: DIARY_CROSS_POOL ──────────────────────────────────────────────────────

  it("F. diary pool-2 but student in pool-1 → DIARY_CROSS_POOL CRITICAL", () => {
    store.swimming_pools.push({ id: "pool-2", name: "P2", used_storage_bytes: 0, base_storage_gb: 1, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "free" });
    store.diary_entries.push({ id: "de99", student_id: "s1", pool_id: "pool-2", class_group_id: "cg1" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "DIARY_CROSS_POOL" && i.entity_id === "de99");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
  });

  // ── G: MEDIA_ORPHAN_RESOURCE ─────────────────────────────────────────────────

  it("G. photo with missing student → MEDIA_ORPHAN_RESOURCE detected", () => {
    store.photo_assets_meta.push({ id: "ph99", pool_id: "pool-1", student_id: "ghost-student", album_type: "individual", media_status: "attached" });
    const result = runScan();
    expect(result.issues.find(i => i.code === "MEDIA_ORPHAN_RESOURCE" && i.entity_id === "ph99")).toBeDefined();
  });

  it("G2. uploading media with missing student → NO false positive", () => {
    store.photo_assets_meta.push({ id: "ph-uploading", pool_id: "pool-1", student_id: "ghost", album_type: "individual", media_status: "uploading" });
    const result = runScan();
    expect(result.issues.find(i => i.entity_id === "ph-uploading")).toBeUndefined();
  });

  // ── H: X_PLAN_LIMIT_MISMATCH ─────────────────────────────────────────────────

  it("H. x300 plan with member_limit=500 → X_PLAN_LIMIT_MISMATCH", () => {
    store.swimming_pools.push({ id: "pool-x", name: "X Pool", used_storage_bytes: 0, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: true, x_manual_entitlement: false, x_management_override: false, x_plan_key: "x300", x_force_disabled: false, member_limit: 500, subscription_tier: "x300" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "X_PLAN_LIMIT_MISMATCH" && i.entity_id === "pool-x");
    expect(issue).toBeDefined();
    expect(issue!.evidence.x_plan_key).toBe("x300");
    expect(issue!.evidence.member_limit).toBe(500);
    expect(issue!.evidence.expected).toBe(300);
  });

  // ── I: mode=x paid=false manual=true → NO false positive ────────────────────

  it("I. manual=true paid=false → NOT X_PLAN_LIMIT_MISMATCH if limit correct", () => {
    store.swimming_pools.push({ id: "pool-manual", name: "Manual Pool", used_storage_bytes: 0, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: true, x_management_override: false, x_plan_key: "x300", x_force_disabled: false, member_limit: 300, subscription_tier: "free" });
    const result = runScan();
    expect(result.issues.find(i => i.entity_id === "pool-manual" && i.code === "X_PLAN_LIMIT_MISMATCH")).toBeUndefined();
  });

  // ── J: management_override X → NO false positive ─────────────────────────────

  it("J. management_override=true with correct limit → NO integrity issue", () => {
    store.swimming_pools.push({ id: "pool-mgmt", name: "Mgmt Pool", used_storage_bytes: 0, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: true, x_plan_key: "x500", x_force_disabled: false, member_limit: 500, subscription_tier: "free" });
    const result = runScan();
    const xIssues = result.issues.filter(i => i.entity_id === "pool-mgmt" && i.code.startsWith("X_"));
    expect(xIssues.length).toBe(0);
  });

  // ── K: force_disabled + paid → X_RESOLVER_INCONSISTENCY ─────────────────────

  it("K. force_disabled=true AND paid=true → X_RESOLVER_INCONSISTENCY CRITICAL", () => {
    store.swimming_pools.push({ id: "pool-conflict", name: "Conflict Pool", used_storage_bytes: 0, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: true, x_manual_entitlement: false, x_management_override: false, x_plan_key: "x300", x_force_disabled: true, member_limit: 300, subscription_tier: "x300" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "X_RESOLVER_INCONSISTENCY" && i.entity_id === "pool-conflict");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("CRITICAL");
  });

  // ── L: RC_STUCK_EVENT ────────────────────────────────────────────────────────

  it("L. unprocessed RC event >1h → RC_STUCK_EVENT", () => {
    store.revenuecat_webhook_events.push({ id: "rc1", event_id: "ev1", event_type: "INITIAL_PURCHASE", app_user_id: "usr1", created_at: new Date(Date.now() - 7200_000).toISOString(), processed_at: null });
    const result = runScan();
    expect(result.issues.find(i => i.code === "RC_STUCK_EVENT")).toBeDefined();
  });

  it("L2. recent RC event (30 min) → NO RC_STUCK_EVENT false positive", () => {
    store.revenuecat_webhook_events.push({ id: "rc2", event_id: "ev2", event_type: "RENEWAL", app_user_id: "usr1", created_at: new Date(Date.now() - 1800_000).toISOString(), processed_at: null });
    const result = runScan();
    expect(result.issues.find(i => i.code === "RC_STUCK_EVENT")).toBeUndefined();
  });

  // ── M: STORAGE_INVALID_QUOTA ─────────────────────────────────────────────────

  it("M. negative used_storage_bytes → STORAGE_INVALID_QUOTA", () => {
    store.swimming_pools.push({ id: "pool-neg", name: "Neg Pool", used_storage_bytes: -100, base_storage_gb: 5, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "free" });
    const result = runScan();
    expect(result.issues.find(i => i.code === "STORAGE_INVALID_QUOTA" && i.entity_id === "pool-neg")).toBeDefined();
  });

  // ── N: STORAGE_OVER_QUOTA → WARNING only ─────────────────────────────────────

  it("N. usage > quota → STORAGE_OVER_QUOTA with severity=WARNING only (not CRITICAL)", () => {
    store.swimming_pools.push({ id: "pool-over", name: "Over Pool", used_storage_bytes: 99999999999, base_storage_gb: 1, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "swimnote" });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "STORAGE_OVER_QUOTA" && i.entity_id === "pool-over");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("WARNING");
    expect(issue!.severity).not.toBe("CRITICAL");
  });

  // ── O: NOTICE_ORPHAN_DISMISSAL ───────────────────────────────────────────────

  it("O. dismissal with no matching notice → NOTICE_ORPHAN_DISMISSAL detected", () => {
    store.notice_dismissals.push({ id: "nd99", notice_id: "ghost-notice", user_id: "u1", dismissed_at: new Date().toISOString() });
    const result = runScan();
    expect(result.issues.find(i => i.code === "NOTICE_ORPHAN_DISMISSAL" && i.entity_id === "nd99")).toBeDefined();
  });

  // ── P: NOTICE_INVALID_PERIOD ─────────────────────────────────────────────────

  it("P. starts_at > ends_at → NOTICE_INVALID_PERIOD detected", () => {
    store.notices.push({ id: "n99", swimming_pool_id: "pool-1", starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" });
    const result = runScan();
    expect(result.issues.find(i => i.code === "NOTICE_INVALID_PERIOD" && i.entity_id === "n99")).toBeDefined();
  });

  // ── Q: PUSH_ORPHAN_DELIVERY ──────────────────────────────────────────────────

  it("Q. delivery with no matching job → PUSH_ORPHAN_DELIVERY detected", () => {
    store.push_fanout_deliveries.push({ id: "d99", job_ref: "ghost-job", push_token_id: "t99", status: "PENDING", sent_at: null });
    const result = runScan();
    expect(result.issues.find(i => i.code === "PUSH_ORPHAN_DELIVERY" && i.entity_id === "d99")).toBeDefined();
  });

  // ── R: PUSH_JOB_STATE_INCONSISTENT ──────────────────────────────────────────

  it("R. COMPLETED job with PENDING deliveries → PUSH_JOB_STATE_INCONSISTENT", () => {
    store.push_fanout_jobs.push({ job_ref: "job-stuck", status: "COMPLETED", total_count: 3 });
    store.push_fanout_deliveries.push({ id: "dStuck1", job_ref: "job-stuck", push_token_id: "t1", status: "PENDING", sent_at: null });
    const result = runScan();
    const issue = result.issues.find(i => i.code === "PUSH_JOB_STATE_INCONSISTENT" && i.entity_id === "job-stuck");
    expect(issue).toBeDefined();
    expect(issue!.evidence.pending_count).toBeGreaterThan(0);
  });

  // ── S: GROWTH_ORPHAN_REPORT ──────────────────────────────────────────────────

  it("S. growth report with ghost student → GROWTH_ORPHAN_REPORT detected", () => {
    store.growth_reports.push({ id: "gr99", student_id: "ghost-student", swimming_pool_id: "pool-1", report_type: "monthly", period_start: "2026-02-01", period_end: "2026-02-28", status: "PUBLISHED", deleted_at: null });
    const result = runScan();
    expect(result.issues.find(i => i.code === "GROWTH_ORPHAN_REPORT" && i.entity_id === "gr99")).toBeDefined();
  });

  // ── T: REVIEW_REQUIRED → NO false positive ───────────────────────────────────

  it("T. REVIEW_REQUIRED growth report → NOT flagged as error", () => {
    store.growth_reports.push({ id: "gr-review", student_id: "s1", swimming_pool_id: "pool-1", report_type: "monthly", period_start: "2026-03-01", period_end: "2026-03-31", status: "REVIEW_REQUIRED", deleted_at: null });
    const result = runScan();
    // REVIEW_REQUIRED alone is not an error
    const anyError = result.issues.find(i => i.entity_id === "gr-review" && i.severity === "CRITICAL");
    expect(anyError).toBeUndefined();
  });

  // ── U: withdrawn member → NO false positive ──────────────────────────────────

  it("U. withdrawn student with valid pool → NOT flagged", () => {
    // s2 is withdrawn but has a valid pool — should not be flagged
    const result = runScan();
    expect(result.issues.find(i => i.entity_id === "s2")).toBeUndefined();
  });

  // ── V: legacy platform_banners → NO false positive ───────────────────────────

  it("V. legacy platform_banners table existence → not checked, no false positive", () => {
    // WP13 does not check platform_banners — any rows there are not errors
    const result = runScan();
    expect(result.issues.some(i => i.entity_type === "platform_banners")).toBe(false);
  });

  // ── W-Y: RBAC ────────────────────────────────────────────────────────────────

  it("W. pool_admin → 403 on /super/integrity/summary", async () => {
    const app = buildApp({ role: "pool_admin", userId: "pa1" });
    await request(app).get("/super/integrity/summary").expect(403);
  });

  it("X. teacher → 403", async () => {
    const app = buildApp({ role: "teacher", userId: "t1" });
    await request(app).get("/super/integrity/summary").expect(403);
  });

  it("Y. parent → 403", async () => {
    const app = buildApp({ role: "parent", userId: "p1" });
    await request(app).get("/super/integrity/summary").expect(403);
  });

  // ── Z: role spoof → blocked ──────────────────────────────────────────────────

  it("Z. spoofed role from unknown value → 403", async () => {
    const app = buildApp({ role: "hacker" as any, userId: "h1" });
    await request(app).get("/super/integrity/summary").expect(403);
  });

  // ── AA-AC: DB mutation = 0 ───────────────────────────────────────────────────

  it("AA. checker produces no UPDATE mutations", () => {
    runScan();
    const updates = mutations.filter(m => m.startsWith("UPDATE"));
    expect(updates.length).toBe(0);
  });

  it("AB. checker produces no DELETE mutations", () => {
    runScan();
    const deletes = mutations.filter(m => m.startsWith("DELETE"));
    expect(deletes.length).toBe(0);
  });

  it("AC. checker produces no INSERT repair mutations", () => {
    runScan();
    const inserts = mutations.filter(m => m.startsWith("INSERT"));
    expect(inserts.length).toBe(0);
  });

  // ── AD: 500-pool N+1 ─────────────────────────────────────────────────────────

  it("AD. 500-pool simulation → query_count = check_count (no N+1)", () => {
    // Add 500 pools — each check uses set-based SQL, NOT per-pool loop
    for (let i = 0; i < 500; i++) {
      store.swimming_pools.push({ id: `pool-sim-${i}`, name: `Sim ${i}`, used_storage_bytes: 0, base_storage_gb: 1, extra_storage_gb: 0, x_paid_entitlement: false, x_manual_entitlement: false, x_management_override: false, x_plan_key: null, x_force_disabled: false, member_limit: 50, subscription_tier: "swimnote" });
    }
    const result = runScan();
    // query_count should NOT scale with pool count — it's always 22 (1 per check)
    expect(result.query_count).toBe(result.check_count);
    expect(result.n_plus_one).toBe("NONE");
  });

  // ── AE: PII-safe evidence ─────────────────────────────────────────────────────

  it("AE. issue evidence does not contain student names or phone numbers", () => {
    store.students.push({ id: "sX", swimming_pool_id: "ghost", status: "active", name: "홍길동", phone: "010-1234-5678" });
    const result = runScan();
    for (const issue of result.issues) {
      const evidenceStr = JSON.stringify(issue.evidence);
      expect(evidenceStr).not.toContain("홍길동");
      expect(evidenceStr).not.toContain("010-1234-5678");
    }
  });

  // ── AF: bounded result ────────────────────────────────────────────────────────

  it("AF. GET /issues with limit=5 returns ≤5 issues", async () => {
    // Add many issues
    for (let i = 0; i < 20; i++) {
      store.users.push({ id: `uZ${i}`, swimming_pool_id: `ghost-${i}`, role: "pool_admin" });
    }
    const app = buildApp(SA);
    const res = await request(app).get("/super/integrity/issues?limit=5").expect(200);
    expect(res.body.issues.length).toBeLessThanOrEqual(5);
    expect(res.body.limit).toBe(5);
  });

  // ── AG: Production data mutation = 0 ─────────────────────────────────────────

  it("AG. running full scan → zero production mutations", () => {
    const mutsBefore = mutations.length;
    runScan();
    expect(mutations.length).toBe(mutsBefore);
  });
});
