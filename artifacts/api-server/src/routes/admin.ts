import { Router } from "express";
import { db } from "@workspace/db";
import { swimmingPoolsTable, usersTable, subscriptionsTable, membersTable, parentAccountsTable, parentStudentsTable, studentsTable } from "@workspace/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

router.get("/pools", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    const { approval_status } = req.query;
    const pools = await db.select().from(swimmingPoolsTable).orderBy(swimmingPoolsTable.created_at);

    const poolsWithCount = await Promise.all(pools.map(async (pool) => {
      const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(membersTable).where(eq(membersTable.swimming_pool_id, pool.id));
      return { ...pool, member_count: Number(countResult?.count || 0) };
    }));

    if (approval_status && approval_status !== "all") {
      const filtered = poolsWithCount.filter(p => p.approval_status === approval_status);
      res.json(filtered);
    } else {
      res.json(poolsWithCount);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.patch("/pools/:id/approve", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const [pool] = await db.update(swimmingPoolsTable)
      .set({ approval_status: "approved", subscription_status: "trial", updated_at: new Date() })
      .where(eq(swimmingPoolsTable.id, id))
      .returning();
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.patch("/pools/:id/reject", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const [pool] = await db.update(swimmingPoolsTable)
      .set({ approval_status: "rejected", rejection_reason: reason || "기준 미달", updated_at: new Date() })
      .where(eq(swimmingPoolsTable.id, id))
      .returning();
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    res.json(pool);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.patch("/pools/:id/subscription", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { subscription_status, subscription_start_at, subscription_end_at, note } = req.body;
  try {
    const updateData: Record<string, unknown> = {
      subscription_status,
      updated_at: new Date(),
    };
    if (subscription_start_at) updateData.subscription_start_at = new Date(subscription_start_at);
    if (subscription_end_at) updateData.subscription_end_at = new Date(subscription_end_at);

    const [pool] = await db.update(swimmingPoolsTable)
      .set(updateData)
      .where(eq(swimmingPoolsTable.id, id))
      .returning();
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.insert(subscriptionsTable).values({
      id: subId,
      swimming_pool_id: id,
      status: subscription_status,
      plan_name: "기본 플랜",
      amount: subscription_status === "active" ? 99000 : 0,
      start_at: subscription_start_at ? new Date(subscription_start_at) : null,
      end_at: subscription_end_at ? new Date(subscription_end_at) : null,
      note: note || null,
      created_by: req.user!.userId,
    });

    res.json(pool);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/users", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    const users = await db.select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      phone: usersTable.phone,
      role: usersTable.role,
      swimming_pool_id: usersTable.swimming_pool_id,
      created_at: usersTable.created_at,
    }).from(usersTable).orderBy(usersTable.created_at);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/users", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { email, password, name, phone, swimming_pool_id, role } = req.body;
  if (!email || !password || !name || !swimming_pool_id) {
    res.status(400).json({ error: "필수 정보를 입력해주세요." });
    return;
  }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing) { res.status(400).json({ error: "이미 사용 중인 이메일입니다." }); return; }

    const password_hash = await hashPassword(password);
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [user] = await db.insert(usersTable).values({
      id,
      email,
      password_hash,
      name,
      phone: phone || null,
      role: role || "pool_admin",
      swimming_pool_id,
    }).returning();
    const { password_hash: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.get("/parents", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.query.pool_id as string || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const parents = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.swimming_pool_id, poolId));
    const enriched = await Promise.all(parents.map(async (pa) => {
      const links = await db.select().from(parentStudentsTable).where(eq(parentStudentsTable.parent_id, pa.id));
      const linkedStudents = await Promise.all(links.map(async (l) => {
        const [s] = await db.select({ id: studentsTable.id, name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, l.student_id)).limit(1);
        return s ? { ...s, link_id: l.id, status: l.status, rejection_reason: l.rejection_reason, created_at: l.created_at } : null;
      }));
      return { ...pa, pin_hash: undefined, students: linkedStudents.filter(Boolean) };
    }));
    res.json(enriched);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/parents", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, pin } = req.body;
  if (!name || !phone || !pin) { res.status(400).json({ error: "이름, 전화번호, PIN을 입력해주세요." }); return; }
  if (pin.length < 4) { res.status(400).json({ error: "PIN은 4자리 이상이어야 합니다." }); return; }
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.body.swimming_pool_id || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const pin_hash = await hashPassword(pin);
    const id = `pa_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [pa] = await db.insert(parentAccountsTable).values({ id, swimming_pool_id: poolId, phone, pin_hash, name }).returning();
    res.status(201).json({ ...pa, pin_hash: undefined, students: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(400).json({ error: "이미 등록된 전화번호입니다." }); }
    else { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
});

router.delete("/parents/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.parent_id, req.params.id));
    await db.delete(parentAccountsTable).where(eq(parentAccountsTable.id, req.params.id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/parents/:id/students", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { student_id } = req.body;
  if (!student_id) { res.status(400).json({ error: "student_id가 필요합니다." }); return; }
  try {
    const [pa] = await db.select().from(parentAccountsTable).where(eq(parentAccountsTable.id, req.params.id)).limit(1);
    if (!pa) { res.status(404).json({ error: "학부모 계정을 찾을 수 없습니다." }); return; }
    const [s] = await db.select({ name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, student_id)).limit(1);
    const linkId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [link] = await db.insert(parentStudentsTable).values({
      id: linkId, parent_id: req.params.id, student_id, swimming_pool_id: pa.swimming_pool_id,
      status: "pending",
    }).returning();
    res.status(201).json({ ...link, student_name: s?.name || null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique")) { res.status(400).json({ error: "이미 연결 요청된 학생입니다." }); }
    else { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
});

router.patch("/parents/:id/students/:link_id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { action, reason } = req.body;
  if (!["approve", "reject"].includes(action)) {
    res.status(400).json({ error: "action은 approve 또는 reject여야 합니다." }); return;
  }
  try {
    const [link] = await db.update(parentStudentsTable)
      .set({
        status: action === "approve" ? "approved" : "rejected",
        approved_by: action === "approve" ? req.user!.userId : null,
        approved_at: action === "approve" ? new Date() : null,
        rejection_reason: action === "reject" ? (reason || "관리자 거부") : null,
      })
      .where(eq(parentStudentsTable.id, req.params.link_id))
      .returning();
    if (!link) { res.status(404).json({ error: "연결 요청을 찾을 수 없습니다." }); return; }
    res.json(link);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.delete("/parents/:id/students/:link_id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(parentStudentsTable).where(eq(parentStudentsTable.id, req.params.link_id));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.get("/pending-connections", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    let poolId: string | null = null;
    if (req.user!.role === "pool_admin") {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = u?.swimming_pool_id || null;
    } else {
      poolId = req.query.pool_id as string || null;
    }
    if (!poolId) { res.status(400).json({ error: "pool_id가 필요합니다." }); return; }
    const links = await db.select().from(parentStudentsTable).where(
      and(eq(parentStudentsTable.swimming_pool_id, poolId), eq(parentStudentsTable.status, "pending"))
    );
    const enriched = await Promise.all(links.map(async (l) => {
      const [pa] = await db.select({ id: parentAccountsTable.id, name: parentAccountsTable.name, phone: parentAccountsTable.phone }).from(parentAccountsTable).where(eq(parentAccountsTable.id, l.parent_id)).limit(1);
      const [s] = await db.select({ id: studentsTable.id, name: studentsTable.name }).from(studentsTable).where(eq(studentsTable.id, l.student_id)).limit(1);
      return { link_id: l.id, status: l.status, created_at: l.created_at, parent: pa, student: s };
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

export default router;
