import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable, usersTable, classMembersTable, classesTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
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
    const poolId = req.user!.role === "super_admin" ? null : await getPoolId(req.user!.userId);
    if (!poolId && req.user!.role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    const includeWithdrawn = req.query.include_withdrawn === "true";
    const members = await db.execute(sql`
      SELECT * FROM members
      WHERE swimming_pool_id = ${poolId!}
        ${includeWithdrawn ? sql`` : sql`AND status = 'active'`}
      ORDER BY created_at DESC
    `);

    const membersWithClass = await Promise.all((members.rows as any[]).map(async (m) => {
      const [cm] = await db.select({ class_id: classMembersTable.class_id })
        .from(classMembersTable).where(eq(classMembersTable.member_id, m.id)).limit(1);
      let class_name = null;
      if (cm) {
        const [cls] = await db.select({ name: classesTable.name }).from(classesTable).where(eq(classesTable.id, cm.class_id)).limit(1);
        class_name = cls?.name || null;
      }
      return { ...m, class_id: cm?.class_id || null, class_name };
    }));

    res.json(membersWithClass);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, parent_user_id, memo } = req.body;
  if (!name || !phone) return err(res, 400, "이름과 전화번호를 입력해주세요.");
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) return err(res, 403, "소속된 수영장이 없습니다.");

    const id = `member_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [member] = await db.insert(membersTable).values({
      id, swimming_pool_id: poolId, name, phone,
      birth_date: birth_date || null,
      parent_user_id: parent_user_id || null,
      memo: memo || null,
    }).returning();
    res.status(201).json({ success: true, ...member, class_id: null, class_name: null });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.params.id)).limit(1);
    if (!member) return err(res, 404, "회원을 찾을 수 없습니다.");

    // pool_admin은 자신의 풀 회원만 조회
    if (req.user!.role !== "super_admin" && poolId && member.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    res.json({ ...member, class_id: null, class_name: null });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.post("/:id/withdraw", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.params.id)).limit(1);
    if (!member) return err(res, 404, "회원을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && member.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }
    if ((member as any).status === "withdrawn") return err(res, 400, "이미 탈퇴 처리된 회원입니다.");

    await db.execute(sql`DELETE FROM class_members WHERE member_id = ${req.params.id}`);
    await db.execute(sql`UPDATE members SET status = 'withdrawn', updated_at = now() WHERE id = ${req.params.id}`);
    res.json({ success: true, message: `${member.name} 회원이 탈퇴 처리되었습니다.` });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.params.id)).limit(1);
    if (!member) return err(res, 404, "회원을 찾을 수 없습니다.");
    if (req.user!.role !== "super_admin" && poolId && member.swimming_pool_id !== poolId) {
      return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.delete(membersTable).where(eq(membersTable.id, req.params.id));
    res.json({ success: true, message: "회원이 삭제되었습니다." });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
