import { Router } from "express";
import { db } from "@workspace/db";
import { classesTable, classMembersTable, membersTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const classes = await db.select().from(classesTable).where(eq(classesTable.swimming_pool_id, poolId));
    const classesWithCount = await Promise.all(classes.map(async (c) => {
      const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(classMembersTable).where(eq(classMembersTable.class_id, c.id));
      return { ...c, member_count: Number(countResult?.count || 0) };
    }));
    res.json(classesWithCount);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, instructor, schedule, capacity } = req.body;
  if (!name || !instructor || !schedule) return err(res, 400, "필수 정보를 입력해주세요.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const id = `class_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [cls] = await db.insert(classesTable).values({
      id, swimming_pool_id: poolId, name, instructor, schedule, capacity: capacity || null,
    }).returning();
    res.status(201).json({ success: true, ...cls, member_count: 0 });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [cls] = await db.select({ swimming_pool_id: classesTable.swimming_pool_id })
      .from(classesTable).where(eq(classesTable.id, req.params.id)).limit(1);
    if (!cls) return err(res, 404, "반을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && cls.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.delete(classMembersTable).where(eq(classMembersTable.class_id, req.params.id));
    await db.delete(classesTable).where(eq(classesTable.id, req.params.id));
    res.json({ success: true, message: "반이 삭제되었습니다." });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id/members", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [cls] = await db.select({ swimming_pool_id: classesTable.swimming_pool_id })
      .from(classesTable).where(eq(classesTable.id, req.params.id)).limit(1);
    if (!cls) return err(res, 404, "반을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && cls.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const classMembers = await db.select({
      id: membersTable.id, swimming_pool_id: membersTable.swimming_pool_id,
      name: membersTable.name, phone: membersTable.phone,
      birth_date: membersTable.birth_date, parent_user_id: membersTable.parent_user_id,
      memo: membersTable.memo, created_at: membersTable.created_at,
    }).from(classMembersTable)
      .innerJoin(membersTable, eq(classMembersTable.member_id, membersTable.id))
      .where(eq(classMembersTable.class_id, req.params.id));
    res.json(classMembers.map(m => ({ ...m, class_id: req.params.id, class_name: null })));
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/:id/members", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { member_id } = req.body;
  if (!member_id) return err(res, 400, "회원 ID가 필요합니다.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [cls] = await db.select({ swimming_pool_id: classesTable.swimming_pool_id })
      .from(classesTable).where(eq(classesTable.id, req.params.id)).limit(1);
    if (!cls) return err(res, 404, "반을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && cls.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    const existing = await db.select().from(classMembersTable)
      .where(eq(classMembersTable.member_id, member_id)).limit(1);
    if (existing.length > 0) {
      await db.update(classMembersTable).set({ class_id: req.params.id }).where(eq(classMembersTable.member_id, member_id));
    } else {
      const id = `cm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.insert(classMembersTable).values({ id, class_id: req.params.id, member_id });
    }
    res.status(201).json({ success: true, message: "반에 회원이 추가되었습니다." });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
