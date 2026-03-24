import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

async function getPoolId(userId: string): Promise<string | null> {
  const [user] = await superAdminDb.select({ swimming_pool_id: usersTable.swimming_pool_id })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.swimming_pool_id || null;
}

// ── 지점 목록 ─────────────────────────────────────────────────────────
router.get("/", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const branches = await db.execute(sql`
      SELECT * FROM pool_branches
      WHERE swimming_pool_id = ${poolId}
      ORDER BY display_order ASC, name ASC
    `);
    res.json(branches.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 지점 등록 ─────────────────────────────────────────────────────────
router.post("/", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { name, address, phone, memo } = req.body;
  if (!name) { res.status(400).json({ error: "지점명을 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const maxOrderResult = await db.execute(sql`
      SELECT COALESCE(MAX(display_order), -1) + 1 AS next_order
      FROM pool_branches WHERE swimming_pool_id = ${poolId}
    `);
    const nextOrder = Number((maxOrderResult.rows[0] as any)?.next_order ?? 0);

    const id = `branch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const result = await db.execute(sql`
      INSERT INTO pool_branches (id, swimming_pool_id, name, address, phone, memo, display_order)
      VALUES (${id}, ${poolId}, ${name}, ${address || null}, ${phone || null}, ${memo || null}, ${nextOrder})
      RETURNING *
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 지점 수정 ─────────────────────────────────────────────────────────
router.put("/:id", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { name, address, phone, memo } = req.body;
  if (!name) { res.status(400).json({ error: "지점명을 입력해주세요." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    const result = await db.execute(sql`
      UPDATE pool_branches
      SET name = ${name}, address = ${address || null}, phone = ${phone || null},
          memo = ${memo || null}, updated_at = now()
      WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
      RETURNING *
    `);
    if (!result.rows.length) { res.status(404).json({ error: "지점을 찾을 수 없습니다." }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 지점 순서 변경 ────────────────────────────────────────────────────
// body: { ordered_ids: ["id1","id2","id3"] }
router.put("/reorder/bulk", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { ordered_ids } = req.body as { ordered_ids: string[] };
  if (!Array.isArray(ordered_ids)) { res.status(400).json({ error: "ordered_ids 배열이 필요합니다." }); return; }
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    await Promise.all(
      ordered_ids.map((id, idx) =>
        db.execute(sql`
          UPDATE pool_branches SET display_order = ${idx}, updated_at = now()
          WHERE id = ${id} AND swimming_pool_id = ${poolId}
        `)
      )
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// ── 지점 삭제 ─────────────────────────────────────────────────────────
router.delete("/:id", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    await db.execute(sql`
      DELETE FROM pool_branches WHERE id = ${req.params.id} AND swimming_pool_id = ${poolId}
    `);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

export default router;
