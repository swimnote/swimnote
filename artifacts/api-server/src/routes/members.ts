import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable, usersTable, classMembersTable, classesTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// ── 회원 목록 (active 기본, ?include_withdrawn=true로 전체) ────────────
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = req.user!.role === "super_admin" ? null : await getPoolId(req.user!.userId);
    if (!poolId && req.user!.role !== "super_admin") {
      res.status(403).json({ error: "소속된 수영장이 없습니다." }); return;
    }
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 회원 등록 ─────────────────────────────────────────────────────────
router.post("/", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  const { name, phone, birth_date, parent_user_id, memo } = req.body;
  if (!name || !phone) { res.status(400).json({ error: "이름과 전화번호를 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const id = `member_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const [member] = await db.insert(membersTable).values({
      id,
      swimming_pool_id: poolId,
      name,
      phone,
      birth_date: birth_date || null,
      parent_user_id: parent_user_id || null,
      memo: memo || null,
    }).returning();
    res.status(201).json({ ...member, class_id: null, class_name: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 회원 단건 조회 ────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.params.id)).limit(1);
    if (!member) { res.status(404).json({ error: "회원을 찾을 수 없습니다." }); return; }
    res.json({ ...member, class_id: null, class_name: null });
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 회원 탈퇴 처리 (소프트 삭제 — 기록 유지) ─────────────────────────
router.post("/:id/withdraw", requireAuth, requireRole("super_admin", "pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [member] = await db.select().from(membersTable).where(eq(membersTable.id, req.params.id)).limit(1);
      if (!member) { res.status(404).json({ error: "회원을 찾을 수 없습니다." }); return; }
      if ((member as any).status === "withdrawn") {
        res.status(400).json({ error: "이미 탈퇴 처리된 회원입니다." }); return;
      }
      // 출결 기록 유지, 반 배정만 해제
      await db.execute(sql`
        DELETE FROM class_members WHERE member_id = ${req.params.id}
      `);
      await db.execute(sql`
        UPDATE members SET status = 'withdrawn', updated_at = now() WHERE id = ${req.params.id}
      `);
      res.json({ success: true, message: `${member.name} 회원이 탈퇴 처리되었습니다.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ── 회원 완전 삭제 (super_admin 전용) ────────────────────────────────
router.delete("/:id", requireAuth, requireRole("super_admin", "pool_admin"), async (req: AuthRequest, res) => {
  try {
    await db.delete(membersTable).where(eq(membersTable.id, req.params.id));
    res.json({ success: true, message: "회원이 삭제되었습니다." });
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
