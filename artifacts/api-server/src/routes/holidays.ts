/**
 * holidays.ts — 수영장 휴무일 API
 * GET  /holidays?pool_id=&month=YYYY-MM
 * POST /holidays
 * DELETE /holidays/:id
 * GET  /holidays/confirm-status?pool_id=&month=YYYY-MM
 * POST /holidays/confirm
 */
import { Router, type Response } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logEvent } from "../lib/event-logger.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";

const router = Router();

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

async function getPoolId(userId: string): Promise<string | null> {
  const r = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as any)?.swimming_pool_id || null;
}

// GET /holidays?pool_id=&month=YYYY-MM
router.get("/holidays", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as { month?: string };
    const { userId, role, poolId: tokenPoolId } = req.user!;
    const pool_id = (req.query.pool_id as string) || tokenPoolId || undefined;
    if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
    if (role !== "super_admin") {
      const effectivePoolId = tokenPoolId || (await getPoolId(userId!));
      if (!effectivePoolId || effectivePoolId !== pool_id) return err(res, 403, "권한이 없습니다.");
    }
    let whereClause = sql`pool_id = ${pool_id}`;
    if (month) whereClause = sql`${whereClause} AND holiday_date::text LIKE ${month + '%'}`;
    const rows = await db.execute(sql`SELECT * FROM pool_holidays WHERE ${whereClause} ORDER BY holiday_date ASC`);
    return res.json({ success: true, holidays: rows.rows });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// GET /holidays/confirm-status?pool_id=&month=YYYY-MM
router.get("/holidays/confirm-status", requireAuth, requireRole("pool_admin", "teacher", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as { month?: string };
    const { userId, role, poolId: tokenPoolId } = req.user!;
    const pool_id = (req.query.pool_id as string) || tokenPoolId || undefined;
    if (!pool_id || !month) return err(res, 400, "pool_id, month가 필요합니다.");
    if (role !== "super_admin") {
      const effectivePoolId = tokenPoolId || (await getPoolId(userId!));
      if (!effectivePoolId || effectivePoolId !== pool_id) return err(res, 403, "권한이 없습니다.");
    }
    const rows = await db.execute(sql`SELECT * FROM holiday_confirmations WHERE pool_id = ${pool_id} AND target_month = ${month} LIMIT 1`);
    const row = rows.rows[0] as any;
    return res.json({ success: true, confirmed: !!row, confirmed_at: row?.confirmed_at || null });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// POST /holidays/confirm — 월 휴무일 확정
router.post("/holidays/confirm", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { pool_id, target_month } = req.body;
    const { userId, role } = req.user!;
    if (!pool_id || !target_month) return err(res, 400, "pool_id, target_month가 필요합니다.");
    if (role !== "super_admin") {
      const up = await getPoolId(userId!);
      if (up !== pool_id) return err(res, 403, "권한이 없습니다.");
    }
    await db.execute(sql`
      INSERT INTO holiday_confirmations (id, pool_id, target_month, confirmed_at, confirmed_by)
      VALUES (gen_random_uuid()::text, ${pool_id}, ${target_month}, now(), ${userId!})
      ON CONFLICT (pool_id, target_month) DO UPDATE SET confirmed_at = now(), confirmed_by = EXCLUDED.confirmed_by
    `);
    const actorRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`);
    const actorName = (actorRow.rows[0] as any)?.name || "관리자";
    logEvent({ pool_id, category: "휴무일", actor_id: userId!, actor_name: actorName, description: `${target_month} 휴무일 확정`, metadata: { target_month } }).catch(console.error);
    return res.json({ success: true });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// POST /holidays — 휴무일 등록 (관리자만)
router.post("/holidays", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { pool_id, holiday_date, reason } = req.body;
    const { userId, role } = req.user!;
    if (!pool_id || !holiday_date) return err(res, 400, "pool_id, holiday_date가 필요합니다.");
    if (role !== "super_admin") {
      const up = await getPoolId(userId!);
      if (up !== pool_id) return err(res, 403, "권한이 없습니다.");
    }
    const rows = await db.execute(sql`
      INSERT INTO pool_holidays (id, pool_id, holiday_date, reason, created_by)
      VALUES (gen_random_uuid()::text, ${pool_id}, ${holiday_date}, ${reason || null}, ${userId})
      ON CONFLICT (pool_id, holiday_date) DO UPDATE SET reason = EXCLUDED.reason
      RETURNING *
    `);
    // 해당 월 확정 해제 (수정됐으므로 재확정 필요)
    const holidayMonth = (holiday_date as string).substring(0, 7);
    await db.execute(sql`DELETE FROM holiday_confirmations WHERE pool_id = ${pool_id} AND target_month = ${holidayMonth}`).catch(() => {});
    const actorRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`);
    const actorName = (actorRow.rows[0] as any)?.name || "관리자";
    logEvent({ pool_id, category: "휴무일", actor_id: userId!, actor_name: actorName, description: `휴무일 등록 — ${holiday_date}${reason ? ` (${reason})` : ""}`, metadata: { holiday_date, reason } }).catch(console.error);
    logPoolEvent({ pool_id, event_type: "holiday_create", entity_type: "pool_holiday", entity_id: (rows.rows[0] as any)?.id, actor_id: userId!, actor_name: actorName, payload: { holiday_date, reason } }).catch(console.error);
    return res.status(201).json({ success: true, holiday: rows.rows[0] });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

// DELETE /holidays/:id — 휴무일 취소 (관리자만)
router.delete("/holidays/:id", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, role } = req.user!;
    const existing = await db.execute(sql`SELECT pool_id, holiday_date FROM pool_holidays WHERE id = ${id}`);
    const h = existing.rows[0] as any;
    if (!h) return err(res, 404, "휴무일을 찾을 수 없습니다.");
    if (role !== "super_admin") {
      const up = await getPoolId(userId!);
      if (up !== h.pool_id) return err(res, 403, "권한이 없습니다.");
    }
    await db.execute(sql`DELETE FROM pool_holidays WHERE id = ${id}`);
    // 해당 월 확정 해제 (수정됐으므로 재확정 필요)
    const holidayMonth = (h.holiday_date as string).substring(0, 7);
    await db.execute(sql`DELETE FROM holiday_confirmations WHERE pool_id = ${h.pool_id} AND target_month = ${holidayMonth}`).catch(() => {});
    const actorRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId} LIMIT 1`);
    const actorName = (actorRow.rows[0] as any)?.name || "관리자";
    logEvent({ pool_id: h.pool_id, category: "휴무일", actor_id: userId!, actor_name: actorName, description: `휴무일 삭제 — ${h.holiday_date}`, metadata: { holiday_date: h.holiday_date } }).catch(console.error);
    logPoolEvent({ pool_id: h.pool_id, event_type: "holiday_delete", entity_type: "pool_holiday", entity_id: id, actor_id: userId!, actor_name: actorName, payload: { holiday_date: h.holiday_date } }).catch(console.error);
    return res.json({ success: true });
  } catch (e: any) {
    return err(res, 500, e.message);
  }
});

export default router;
