import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { membersTable, usersTable, classMembersTable, classesTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

// NOTE: members.status column is ensured by src/migrations/runtime-ddl-consolidated.ts §1
// Boot-time DDL removed (WP8-P2). Run migration before deploying.

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// WP8: N+1 fix (batch class lookup) + LIMIT added (default 200, max 500)
// Backward-compat: plain array response preserved
router.get("/", requireAuth, async (req: AuthRequest, res) => {
  try {
    const poolId = req.user!.role === "super_admin" ? null : await getPoolId(req.user!.userId);
    if (!poolId && req.user!.role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    const includeWithdrawn = req.query.include_withdrawn === "true";
    const rawLimit = parseInt(String(req.query.limit ?? ""), 10);
    const limit = (!rawLimit || rawLimit <= 0) ? 200 : Math.min(rawLimit, 500);

    const members = await db.execute(sql`
      SELECT * FROM members
      WHERE swimming_pool_id = ${poolId!}
        ${includeWithdrawn ? sql`` : sql`AND status = 'active'`}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    const memberRows = members.rows as any[];
    if (memberRows.length === 0) { return res.json([]); }

    // WP8 N+1 Fix: batch load class assignments in ONE query
    const memberIds = memberRows.map(m => `'${m.id}'`).join(",");
    const cmRows = await db.execute(sql`
      SELECT cm.member_id, cm.class_id, c.name AS class_name
      FROM class_members cm
      LEFT JOIN classes c ON c.id = cm.class_id
      WHERE cm.member_id IN (${sql.raw(memberIds)})
    `);
    const cmMap = new Map<string, { class_id: string; class_name: string | null }>();
    for (const cm of cmRows.rows as any[]) {
      cmMap.set(cm.member_id, { class_id: cm.class_id, class_name: cm.class_name ?? null });
    }

    const membersWithClass = memberRows.map(m => {
      const cm = cmMap.get(m.id);
      return { ...m, class_id: cm?.class_id ?? null, class_name: cm?.class_name ?? null };
    });

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
    logPoolEvent({
      pool_id: poolId, event_type: "member.create", entity_type: "member",
      entity_id: id, actor_id: req.user!.userId,
      payload: { name, phone },
    }).catch(() => {});
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
    logPoolEvent({
      pool_id: member.swimming_pool_id!, event_type: "member.withdraw", entity_type: "member",
      entity_id: req.params.id, actor_id: req.user!.userId,
      payload: { name: member.name },
    }).catch(() => {});
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
