import { Router, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── 내 알림 목록 ──────────────────────────────────────────────────────
router.get("/notifications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT * FROM notifications
      WHERE recipient_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    const unread = (rows.rows as any[]).filter(n => !n.is_read).length;
    res.json({ notifications: rows.rows, unread_count: unread });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 읽지 않은 알림 수 ─────────────────────────────────────────────────
router.get("/notifications/unread-count", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT COUNT(*) AS count FROM notifications
      WHERE recipient_id = ${userId} AND is_read = false
    `);
    res.json({ count: parseInt((rows.rows[0] as any).count, 10) });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 단건 읽음 처리 ────────────────────────────────────────────────────
router.post("/notifications/:id/read", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    await db.execute(sql`
      UPDATE notifications SET is_read = true
      WHERE id = ${req.params.id} AND recipient_id = ${userId}
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 전체 읽음 처리 ────────────────────────────────────────────────────
router.post("/notifications/read-all", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    await db.execute(sql`
      UPDATE notifications SET is_read = true WHERE recipient_id = ${userId}
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 알림 삭제 ─────────────────────────────────────────────────────────
router.delete("/notifications/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    await db.execute(sql`
      DELETE FROM notifications WHERE id = ${req.params.id} AND recipient_id = ${userId}
    `);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

export default router;
