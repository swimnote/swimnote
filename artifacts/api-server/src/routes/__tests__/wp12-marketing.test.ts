/**
 * wp12-marketing.test.ts — WP12 Super Admin Marketing MVP
 *
 * Tests A–AJ (36 cases)
 *
 * Self-contained: in-memory express app + mocked DB.
 * No real DB connection — pure route logic verification.
 *
 * Coverage:
 * §A-C:  POST /super/marketing/notices/preview — shape + counts
 * §D-G:  Preview — role / plan filtering
 * §H-L:  POST /super/marketing/notices — create + send
 * §M-O:  Accidental global send protection
 * §P-R:  starts_at future → push deferred
 * §S-U:  starts_at past / null → push immediate
 * §V-X:  Input validation
 * §Y-AB: Response-level audit verification
 * §AC-AE: GET /super/marketing/notices list
 * §AF-AH: RBAC guards
 * §AI-AJ: Idempotent / platform_admin
 */

import express from "express";
import request from "supertest";
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────────
// notice store (in-memory)
const noticeStore: Map<string, any> = new Map();
let noticeSeq = 0;
const auditLog: any[] = [];
const fanoutJobs: Map<string, any> = new Map();
let fanoutDeliveries: any[] = [];

// Pool store: we have 3 pools in fixture
// pool-001: swimnote, pool-002: x300, pool-003: x500
const POOLS = [
  { id: "pool-001", subscription_tier: "swimnote", x_manual_entitlement: false, x_management_override: false, x_plan_key: null },
  { id: "pool-002", subscription_tier: "x300",     x_manual_entitlement: false, x_management_override: false, x_plan_key: null },
  { id: "pool-003", subscription_tier: "x500",     x_manual_entitlement: false, x_management_override: false, x_plan_key: null },
  { id: "pool-004", subscription_tier: "free",     x_manual_entitlement: true,  x_management_override: false, x_plan_key: "x300" },
];
// User fixture
const USERS = [
  { id: "u001", role: "pool_admin", swimming_pool_id: "pool-001" },
  { id: "u002", role: "teacher",   swimming_pool_id: "pool-001" },
  { id: "u003", role: "pool_admin", swimming_pool_id: "pool-002" },
];
// Parent fixture
const PARENTS = [
  { id: "pa001", swimming_pool_id: "pool-001" },
  { id: "pa002", swimming_pool_id: "pool-002" },
];
// Token fixture
const TOKENS = [
  { id: "t001", token: "ExpoT1", user_id: "u001", parent_account_id: null },
  { id: "t002", token: "ExpoT2", user_id: "u002", parent_account_id: null },
  { id: "t003", token: "ExpoT3", user_id: null,   parent_account_id: "pa001" },
];

vi.mock("@workspace/db", () => ({
  db:           { execute: vi.fn(async () => ({ rows: [] })) },
  superAdminDb: { execute: vi.fn(async () => ({ rows: [] })) },
  sql:          { raw: (s: string) => ({ _raw: s }) },
}));

// ── Build test server ──────────────────────────────────────────────────────────

function buildApp(userFixture: { role: string; userId: string; [k: string]: any }) {
  const app = express();
  app.use(express.json());

  // Inject test user
  app.use((req: any, _res: any, next: any) => {
    req.user = userFixture;
    next();
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────
  const SUPER_ROLES_MARKETING = new Set(["super_admin", "platform_admin"]);
  function requireMarketingRole(req: any, res: any, next: any) {
    if (!req.user || !SUPER_ROLES_MARKETING.has(req.user.role)) {
      return res.status(403).json({ error: "FORBIDDEN", message: "슈퍼관리자 전용 기능입니다." });
    }
    next();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const VALID_PLAN_TYPES  = ["swimnote", "x300", "x500", "x1000"] as const;
  const VALID_TARGET_ROLES = ["ADMIN", "TEACHER", "PARENT"] as const;

  function validateCriteria(body: any): { criteria: any | null; error: string | null } {
    const { pool_ids, plan_types, roles } = body;
    if (pool_ids !== null && pool_ids !== undefined && !Array.isArray(pool_ids))
      return { criteria: null, error: "pool_ids는 배열 또는 null이어야 합니다." };
    if (plan_types !== null && plan_types !== undefined) {
      if (!Array.isArray(plan_types)) return { criteria: null, error: "plan_types는 배열 또는 null이어야 합니다." };
      for (const p of plan_types) {
        if (!(VALID_PLAN_TYPES as readonly string[]).includes(p))
          return { criteria: null, error: `plan_types에 유효하지 않은 값: ${p}` };
      }
    }
    if (roles !== null && roles !== undefined) {
      if (!Array.isArray(roles)) return { criteria: null, error: "roles는 배열 또는 null이어야 합니다." };
      for (const r of roles) {
        if (!(VALID_TARGET_ROLES as readonly string[]).includes(r))
          return { criteria: null, error: `roles에 유효하지 않은 값: ${r}` };
      }
    }
    return {
      criteria: {
        poolIds:   pool_ids   ?? null,
        planTypes: plan_types ?? null,
        roles:     roles      ?? null,
      },
      error: null,
    };
  }

  function resolveTargetPools(criteria: any): string[] {
    const { poolIds, planTypes } = criteria;
    // null = all pools; [] = explicit empty set (0 pools)
    if (poolIds !== null && Array.isArray(poolIds) && poolIds.length === 0) return [];
    let pools = [...POOLS];
    if (poolIds !== null && Array.isArray(poolIds) && poolIds.length > 0) {
      pools = pools.filter(p => poolIds.includes(p.id));
    }
    if (planTypes !== null && Array.isArray(planTypes) && planTypes.length > 0) {
      pools = pools.filter(p => {
        const xPlans = planTypes.filter((pt: string) => pt !== "swimnote");
        const swimPlans = planTypes.filter((pt: string) => pt === "swimnote");
        if (swimPlans.includes(p.subscription_tier)) return true;
        if (xPlans.includes(p.subscription_tier)) return true;
        if (p.x_manual_entitlement && xPlans.includes(p.x_plan_key)) return true;
        if (p.x_management_override && xPlans.includes(p.x_plan_key)) return true;
        return false;
      });
    }
    return pools.map(p => p.id);
  }

  function resolvePreview(criteria: any) {
    const targetPoolIds = resolveTargetPools(criteria);
    const { roles } = criteria;
    const needAdmin   = !roles || roles.includes("ADMIN");
    const needTeacher = !roles || roles.includes("TEACHER");
    const needParent  = !roles || roles.includes("PARENT");

    const adminCount   = needAdmin   ? USERS.filter(u => u.role === "pool_admin" && targetPoolIds.includes(u.swimming_pool_id)).length : 0;
    const teacherCount = needTeacher ? USERS.filter(u => u.role === "teacher"    && targetPoolIds.includes(u.swimming_pool_id)).length : 0;
    const parentCount  = needParent  ? PARENTS.filter(p => targetPoolIds.includes(p.swimming_pool_id)).length : 0;

    const adminTeacherTokens = needAdmin || needTeacher
      ? TOKENS.filter(t => t.user_id && USERS.some(u =>
          t.user_id === u.id && targetPoolIds.includes(u.swimming_pool_id) &&
          ((needAdmin && u.role === "pool_admin") || (needTeacher && u.role === "teacher"))
        )).length
      : 0;
    const parentTokens = needParent
      ? TOKENS.filter(t => t.parent_account_id && PARENTS.some(p =>
          t.parent_account_id === p.id && targetPoolIds.includes(p.swimming_pool_id)
        )).length
      : 0;

    return {
      pool_count:       targetPoolIds.length,
      user_count:       adminCount + teacherCount + parentCount,
      admin_count:      adminCount,
      teacher_count:    teacherCount,
      parent_count:     parentCount,
      push_token_count: adminTeacherTokens + parentTokens,
    };
  }

  function enqueueMarketing(jobRef: string, noticeId: string, title: string, body: string, targetPoolIds: string[], roles: any): { duplicate: boolean; deliveriesAdded: number } {
    if (fanoutJobs.has(jobRef)) return { duplicate: true, deliveriesAdded: 0 };
    fanoutJobs.set(jobRef, { jobRef, noticeId, title, body, targetPoolIds, roles });
    const tokens = TOKENS.filter(t => {
      if (t.user_id) {
        const user = USERS.find(u => u.id === t.user_id && targetPoolIds.includes(u.swimming_pool_id));
        if (!user) return false;
        if (!roles) return true;
        if (user.role === "pool_admin") return (roles as string[]).includes("ADMIN");
        if (user.role === "teacher")   return (roles as string[]).includes("TEACHER");
        return false;
      }
      if (t.parent_account_id) {
        const p = PARENTS.find(pa => pa.id === t.parent_account_id && targetPoolIds.includes(pa.swimming_pool_id));
        if (!p) return false;
        return !roles || (roles as string[]).includes("PARENT");
      }
      return false;
    });
    fanoutDeliveries.push(...tokens.map(t => ({ jobRef, tokenId: t.id })));
    return { duplicate: false, deliveriesAdded: tokens.length };
  }

  // ── POST /super/marketing/notices/preview ──────────────────────────────────
  app.post("/super/marketing/notices/preview", requireMarketingRole, (req: any, res: any) => {
    try {
      const { criteria, error } = validateCriteria(req.body);
      if (error || !criteria) return res.status(400).json({ error: "INVALID_CRITERIA", message: error });
      const preview = resolvePreview(criteria);
      return res.json(preview);
    } catch (e: any) {
      return res.status(500).json({ error: "PREVIEW_FAILED", message: e.message });
    }
  });

  // ── POST /super/marketing/notices ──────────────────────────────────────────
  app.post("/super/marketing/notices", requireMarketingRole, (req: any, res: any) => {
    try {
      const { title, content, pool_ids, plan_types, roles, send_push, show_banner, starts_at, ends_at, deep_link, target_all } = req.body ?? {};

      if (!title || typeof title !== "string" || !title.trim())
        return res.status(400).json({ error: "MISSING_FIELD", message: "title은 필수입니다." });
      if (!content || typeof content !== "string" || !content.trim())
        return res.status(400).json({ error: "MISSING_FIELD", message: "content는 필수입니다." });

      const allNull = (pool_ids == null || (Array.isArray(pool_ids) && pool_ids.length === 0))
                   && (plan_types == null || (Array.isArray(plan_types) && plan_types.length === 0))
                   && (roles == null || (Array.isArray(roles) && roles.length === 0));
      if (allNull && !target_all) {
        return res.status(400).json({ error: "ACCIDENTAL_GLOBAL_SEND", message: "모든 필터가 비어있으면 target_all=true 필요." });
      }

      const { criteria, error: criteriaError } = validateCriteria({ pool_ids, plan_types, roles });
      if (criteriaError || !criteria) return res.status(400).json({ error: "INVALID_CRITERIA", message: criteriaError });

      let startsAtDate: Date | null = null;
      if (starts_at) {
        startsAtDate = new Date(starts_at);
        if (isNaN(startsAtDate.getTime()))
          return res.status(400).json({ error: "INVALID_STARTS_AT", message: "starts_at 형식이 유효하지 않습니다." });
      }
      if (ends_at) {
        const d = new Date(ends_at);
        if (isNaN(d.getTime()))
          return res.status(400).json({ error: "INVALID_ENDS_AT", message: "ends_at 형식이 유효하지 않습니다." });
      }

      const nowDate = new Date();
      const isFuture = startsAtDate !== null && startsAtDate > nowDate;

      const targetPoolIds = resolveTargetPools(criteria);
      const id = `notice_${++noticeSeq}`;
      const now = new Date().toISOString();
      const notice = {
        id, title: title.trim(), content: content.trim(), audience_scope: "global",
        target_roles: criteria.roles, target_pools: targetPoolIds, target_plan_types: criteria.planTypes,
        send_push: send_push !== false, show_banner: show_banner !== false,
        starts_at: startsAtDate?.toISOString() ?? null,
        ends_at: ends_at ?? null, deep_link: deep_link ?? null,
        push_sent_at: null,
        author_user_id: req.user.userId,
        created_at: now,
      };
      noticeStore.set(id, notice);
      auditLog.push({ action: "MARKETING_NOTICE_CREATE", entity_id: id });

      let pushResult: { duplicate: boolean; deliveriesAdded: number } | null = null;
      if (send_push !== false && !isFuture) {
        const jobRef = `notice:${id}:send`;
        pushResult = enqueueMarketing(jobRef, id, title.trim(), content.trim().slice(0, 255), targetPoolIds, criteria.roles);
        notice.push_sent_at = now;
        auditLog.push({ action: "MARKETING_NOTICE_SEND", entity_id: id, deliveries: pushResult.deliveriesAdded });
      }

      return res.status(201).json({
        id,
        title:             notice.title,
        created_at:        notice.created_at,
        push_scheduled:    isFuture,
        push_enqueued:     !isFuture && send_push !== false,
        push_deliveries:   pushResult?.deliveriesAdded ?? null,
        target_pool_count: targetPoolIds.length,
      });
    } catch (e: any) {
      return res.status(500).json({ error: "CREATE_FAILED", message: e.message });
    }
  });

  // ── GET /super/marketing/notices ───────────────────────────────────────────
  app.get("/super/marketing/notices", requireMarketingRole, (req: any, res: any) => {
    const limit  = Math.min(Number(req.query.limit ?? 50), 100);
    const offset = Number(req.query.offset ?? 0);
    const all = [...noticeStore.values()].reverse();
    return res.json({ notices: all.slice(offset, offset + limit), limit, offset });
  });

  return app;
}

// ── Fixtures ───────────────────────────────────────────────────────────────────
const SUPER_USER    = { role: "super_admin",    userId: "super-001" };
const PLATFORM_USER = { role: "platform_admin", userId: "plat-001" };
const POOL_ADMIN    = { role: "pool_admin",      userId: "pa-001" };

// ── Test suite ─────────────────────────────────────────────────────────────────
describe("WP12 Marketing", () => {
  beforeEach(() => {
    noticeStore.clear();
    auditLog.length = 0;
    fanoutJobs.clear();
    fanoutDeliveries = [];
    noticeSeq = 0;
  });

  afterEach(() => { vi.clearAllMocks(); });

  // ── §A-C  Preview shape ────────────────────────────────────────────────────

  it("A. preview all-null → non-negative counts", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview")
      .send({ pool_ids: null, plan_types: null, roles: null }).expect(200);
    expect(res.body.pool_count).toBeGreaterThanOrEqual(0);
    expect(res.body.user_count).toBeGreaterThanOrEqual(0);
    expect(res.body.push_token_count).toBeGreaterThanOrEqual(0);
  });

  it("B. preview response has all required keys", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview").send({}).expect(200);
    for (const k of ["pool_count","user_count","admin_count","teacher_count","parent_count","push_token_count"])
      expect(res.body).toHaveProperty(k);
  });

  it("C. preview empty pool_ids[] → pool_count=0, user_count=0", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview").send({ pool_ids: [] }).expect(200);
    expect(res.body.pool_count).toBe(0);
    expect(res.body.user_count).toBe(0);
  });

  // ── §D-G  Role/plan filter ─────────────────────────────────────────────────

  it("D. preview roles=['ADMIN'] → parent_count=0, teacher_count=0", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview").send({ roles: ["ADMIN"] }).expect(200);
    expect(res.body.parent_count).toBe(0);
    expect(res.body.teacher_count).toBe(0);
    expect(res.body.admin_count).toBeGreaterThan(0);
  });

  it("E. preview roles=['PARENT'] → admin_count=0, teacher_count=0", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview").send({ roles: ["PARENT"] }).expect(200);
    expect(res.body.admin_count).toBe(0);
    expect(res.body.teacher_count).toBe(0);
    expect(res.body.parent_count).toBeGreaterThan(0);
  });

  it("F. preview plan_types=[] same pool_count as plan_types=null (all pools)", async () => {
    const app = buildApp(SUPER_USER);
    const r1 = await request(app).post("/super/marketing/notices/preview").send({ plan_types: [] });
    const r2 = await request(app).post("/super/marketing/notices/preview").send({ plan_types: null });
    expect(r1.body.pool_count).toBe(r2.body.pool_count);
  });

  it("G. preview plan_types=['swimnote'] returns pool-001 only (1 pool)", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview")
      .send({ plan_types: ["swimnote"] }).expect(200);
    // POOLS has 1 swimnote pool
    expect(res.body.pool_count).toBe(1);
  });

  // ── §H-L  Create ──────────────────────────────────────────────────────────

  it("H. create minimal payload → 201 with id and target_pool_count", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice H", content: "Content H", target_all: true }).expect(201);
    expect(res.body.id).toBeTruthy();
    expect(typeof res.body.target_pool_count).toBe("number");
    expect(typeof res.body.push_enqueued).toBe("boolean");
  });

  it("I. send_push=false → push_enqueued=false, push_scheduled=false", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice I", content: "Content I", send_push: false, target_all: true }).expect(201);
    expect(res.body.push_enqueued).toBe(false);
    expect(res.body.push_scheduled).toBe(false);
  });

  it("J. deep_link accepted → 201", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice J", content: "Content J", deep_link: "swimnote://billing", target_all: true }).expect(201);
    expect(res.body.id).toBeTruthy();
  });

  it("K. show_banner=false → 201", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice K", content: "Content K", show_banner: false, target_all: true }).expect(201);
    expect(res.body.id).toBeTruthy();
  });

  it("L. plan_types=['x300'] → only x300+manual x300 pools targeted", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice L", content: "Content L", plan_types: ["x300"] }).expect(201);
    // pool-002 (x300 tier) + pool-004 (x_manual_entitlement + x_plan_key=x300) = 2
    expect(res.body.target_pool_count).toBe(2);
  });

  // ── §M-O  Accidental global send ─────────────────────────────────────────

  it("M. all filters empty, no target_all → 400 ACCIDENTAL_GLOBAL_SEND", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice M", content: "Content M" }).expect(400);
    expect(res.body.error).toBe("ACCIDENTAL_GLOBAL_SEND");
  });

  it("N. target_all=true bypasses accidental guard → 201", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice N", content: "Content N", target_all: true, send_push: false }).expect(201);
    expect(res.body.id).toBeTruthy();
  });

  it("O. partial filter (plan_types set) bypasses guard without target_all → 201", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice O", content: "Content O", plan_types: ["x500"], send_push: false }).expect(201);
    expect(res.body.id).toBeTruthy();
  });

  // ── §P-R  Future starts_at ────────────────────────────────────────────────

  it("P. future starts_at → push_scheduled=true, push_enqueued=false", async () => {
    const app = buildApp(SUPER_USER);
    const futureDate = new Date(Date.now() + 86400_000 * 2).toISOString();
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice P", content: "Content P", starts_at: futureDate, target_all: true }).expect(201);
    expect(res.body.push_scheduled).toBe(true);
    expect(res.body.push_enqueued).toBe(false);
  });

  it("Q. future starts_at — no fanout job enqueued in store", async () => {
    const app = buildApp(SUPER_USER);
    const futureDate = new Date(Date.now() + 86400_000).toISOString();
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice Q", content: "Content Q", starts_at: futureDate, target_all: true }).expect(201);
    expect(fanoutJobs.has(`notice:${res.body.id}:send`)).toBe(false);
  });

  it("R. invalid starts_at → 400 INVALID_STARTS_AT", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice R", content: "Content R", starts_at: "not-a-date", target_all: true }).expect(400);
    expect(res.body.error).toBe("INVALID_STARTS_AT");
  });

  // ── §S-U  Immediate push ──────────────────────────────────────────────────

  it("S. null starts_at + send_push → push_enqueued=true", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice S", content: "Content S", starts_at: null, target_all: true, send_push: true }).expect(201);
    expect(res.body.push_enqueued).toBe(true);
    expect(res.body.push_scheduled).toBe(false);
  });

  it("T. past starts_at → push_enqueued=true (immediate)", async () => {
    const app = buildApp(SUPER_USER);
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice T", content: "Content T", starts_at: pastDate, target_all: true, send_push: true }).expect(201);
    expect(res.body.push_enqueued).toBe(true);
    expect(res.body.push_scheduled).toBe(false);
  });

  it("U. push_deliveries >= 0 on immediate send", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice U", content: "Content U", target_all: true, send_push: true }).expect(201);
    expect(typeof res.body.push_deliveries).toBe("number");
    expect(res.body.push_deliveries).toBeGreaterThanOrEqual(0);
  });

  // ── §V-X  Validation ──────────────────────────────────────────────────────

  it("V. missing title → 400 MISSING_FIELD", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ content: "Content V", target_all: true }).expect(400);
    expect(res.body.error).toBe("MISSING_FIELD");
  });

  it("W. missing content → 400 MISSING_FIELD", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices")
      .send({ title: "Notice W", target_all: true }).expect(400);
    expect(res.body.error).toBe("MISSING_FIELD");
  });

  it("X. invalid plan_type 'pro' → 400 INVALID_CRITERIA", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview")
      .send({ plan_types: ["pro"] }).expect(400);
    expect(res.body.error).toBe("INVALID_CRITERIA");
  });

  // ── §Y-AB  Audit log ──────────────────────────────────────────────────────

  it("Y. create → MARKETING_NOTICE_CREATE audit written", async () => {
    const app = buildApp(SUPER_USER);
    await request(app).post("/super/marketing/notices")
      .send({ title: "Notice Y", content: "Content Y", target_all: true, send_push: false }).expect(201);
    expect(auditLog.some(a => a.action === "MARKETING_NOTICE_CREATE")).toBe(true);
  });

  it("Z. immediate push → MARKETING_NOTICE_SEND audit written", async () => {
    const app = buildApp(SUPER_USER);
    await request(app).post("/super/marketing/notices")
      .send({ title: "Notice Z", content: "Content Z", target_all: true, send_push: true }).expect(201);
    expect(auditLog.some(a => a.action === "MARKETING_NOTICE_SEND")).toBe(true);
  });

  it("AA. future-scheduled → MARKETING_NOTICE_SEND audit NOT written (deferred)", async () => {
    const app = buildApp(SUPER_USER);
    const futureDate = new Date(Date.now() + 86400_000 * 3).toISOString();
    await request(app).post("/super/marketing/notices")
      .send({ title: "Notice AA", content: "Content AA", starts_at: futureDate, target_all: true }).expect(201);
    // Only CREATE was written, not SEND
    expect(auditLog.some(a => a.action === "MARKETING_NOTICE_SEND")).toBe(false);
  });

  it("AB. invalid role 'MANAGER' → 400 INVALID_CRITERIA", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).post("/super/marketing/notices/preview")
      .send({ roles: ["MANAGER"] }).expect(400);
    expect(res.body.error).toBe("INVALID_CRITERIA");
  });

  // ── §AC-AE  GET list ──────────────────────────────────────────────────────

  it("AC. GET /super/marketing/notices returns { notices, limit, offset }", async () => {
    const app = buildApp(SUPER_USER);
    const res = await request(app).get("/super/marketing/notices").expect(200);
    expect(Array.isArray(res.body.notices)).toBe(true);
    expect(typeof res.body.limit).toBe("number");
    expect(typeof res.body.offset).toBe("number");
  });

  it("AD. GET list includes notices created in test run", async () => {
    const app = buildApp(SUPER_USER);
    await request(app).post("/super/marketing/notices")
      .send({ title: "Notice AD", content: "Content AD", target_all: true, send_push: false }).expect(201);
    const res = await request(app).get("/super/marketing/notices").expect(200);
    expect(res.body.notices.length).toBeGreaterThan(0);
    expect(res.body.notices.some((n: any) => n.title === "Notice AD")).toBe(true);
  });

  it("AE. GET list with limit=1 returns ≤1 notice", async () => {
    const app = buildApp(SUPER_USER);
    await request(app).post("/super/marketing/notices")
      .send({ title: "N1", content: "C1", target_all: true, send_push: false });
    await request(app).post("/super/marketing/notices")
      .send({ title: "N2", content: "C2", target_all: true, send_push: false });
    const res = await request(app).get("/super/marketing/notices?limit=1").expect(200);
    expect(res.body.notices.length).toBeLessThanOrEqual(1);
    expect(res.body.limit).toBe(1);
  });

  // ── §AF-AH  RBAC ──────────────────────────────────────────────────────────

  it("AF. pool_admin cannot access preview → 403", async () => {
    const app = buildApp(POOL_ADMIN);
    await request(app).post("/super/marketing/notices/preview").send({}).expect(403);
  });

  it("AG. pool_admin cannot POST /super/marketing/notices → 403", async () => {
    const app = buildApp(POOL_ADMIN);
    await request(app).post("/super/marketing/notices")
      .send({ title: "hack", content: "hack", target_all: true }).expect(403);
  });

  it("AH. pool_admin cannot GET /super/marketing/notices → 403", async () => {
    const app = buildApp(POOL_ADMIN);
    await request(app).get("/super/marketing/notices").expect(403);
  });

  // ── §AI-AJ  Idempotent / platform_admin ──────────────────────────────────

  it("AI. two identical creates return different IDs", async () => {
    const app = buildApp(SUPER_USER);
    const payload = { title: "Dup test", content: "Content dup", target_all: true, send_push: false };
    const r1 = await request(app).post("/super/marketing/notices").send(payload).expect(201);
    const r2 = await request(app).post("/super/marketing/notices").send(payload).expect(201);
    expect(r1.body.id).not.toBe(r2.body.id);
  });

  it("AJ. platform_admin role can access marketing endpoints", async () => {
    const app = buildApp(PLATFORM_USER);
    const res = await request(app).post("/super/marketing/notices/preview").send({}).expect(200);
    expect(res.body).toHaveProperty("pool_count");
  });
});
