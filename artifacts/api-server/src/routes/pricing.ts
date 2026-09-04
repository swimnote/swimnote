/**
 * pricing.ts — 수업 단가표 API
 * GET /pricing?pool_id=
 * PUT /pricing/:poolId  (전체 배치 업데이트)
 */
import { Router, type Response } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

// GET /pricing?pool_id=
router.get("/pricing", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role, poolId: tokenPoolId } = req.user!;
    const pool_id = (req.query.pool_id as string) || tokenPoolId || undefined;
    if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
    if (role !== "super_admin") {
      const userPoolId = await getPoolId(userId!);
      if (userPoolId && userPoolId !== pool_id) return err(res, 403, "권한이 없습니다.");
    }
    const rows = await superAdminDb.execute(sql`
      SELECT * FROM pool_class_pricing WHERE pool_id = ${pool_id} ORDER BY 
        CASE type_key WHEN 'weekly_1' THEN 1 WHEN 'weekly_2' THEN 2 WHEN 'weekly_3' THEN 3 WHEN 'custom_1' THEN 4 WHEN 'custom_2' THEN 5 ELSE 6 END
    `);
    return res.json({ success: true, pricing: rows.rows });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// PUT /pricing/:poolId — 단가표 일괄 업데이트 (관리자만)
router.put("/pricing/:poolId", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { poolId } = req.params;
    const { userId, role } = req.user!;
    const { items } = req.body; // [{type_key, type_name, monthly_fee, sessions_per_month, is_active}]

    if (role !== "super_admin") {
      const userPoolId = await getPoolId(userId!);
      if (userPoolId !== poolId) return err(res, 403, "권한이 없습니다.");
    }
    if (!Array.isArray(items)) return err(res, 400, "items 배열이 필요합니다.");

    for (const item of items) {
      await superAdminDb.execute(sql`
        INSERT INTO pool_class_pricing (id, pool_id, type_key, type_name, monthly_fee, sessions_per_month, is_active, updated_at)
        VALUES (gen_random_uuid()::text, ${poolId}, ${item.type_key}, ${item.type_name}, ${item.monthly_fee || 0}, ${item.sessions_per_month || 4}, ${item.is_active !== false}, now())
        ON CONFLICT (pool_id, type_key) DO UPDATE SET
          type_name = EXCLUDED.type_name,
          monthly_fee = EXCLUDED.monthly_fee,
          sessions_per_month = EXCLUDED.sessions_per_month,
          is_active = EXCLUDED.is_active,
          updated_at = now()
      `);
    }

    const rows = await superAdminDb.execute(sql`SELECT * FROM pool_class_pricing WHERE pool_id = ${poolId} ORDER BY type_key`);
    return res.json({ success: true, pricing: rows.rows });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

export default router;
