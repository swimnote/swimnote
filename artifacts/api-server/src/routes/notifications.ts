import { Router, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { encodeCursor, decodeCursor, parseLimit } from "../lib/pagination.js";

const router = Router();

// ── 내 알림 목록 ──────────────────────────────────────────────────────
// Backward-compatible: response shape {notifications, unread_count} preserved.
// Additive: next_cursor field added when more pages exist.
// Query params: limit (default 50, max 100), cursor (opaque base64url)
router.get("/notifications", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const limit = parseLimit(req.query.limit, 50, 100);
    const cursor = req.query.cursor as string | undefined;

    let cursorClause = sql``;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return res.status(400).json({ error: "cursor 형식이 올바르지 않습니다." });
      }
      cursorClause = sql`
        AND (n.created_at, n.id) < (${decoded.created_at}::timestamptz, ${decoded.id})
      `;
    }

    // Fetch limit+1 to detect next page
    const rows = await db.execute(sql`
      SELECT n.*, n.id AS _id_for_cursor
      FROM notifications n
      WHERE n.recipient_id = ${userId}
        ${cursorClause}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${limit + 1}
    `);

    const allRows = rows.rows as any[];
    const hasMore = allRows.length > limit;
    const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

    const unread = pageRows.filter(n => !n.is_read).length;

    let next_cursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      next_cursor = encodeCursor(last.created_at, last.id);
    }

    res.json({ notifications: pageRows, unread_count: unread, next_cursor });
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

// ── 선생님 소식 (diary_like / diary_thanks / diary_comment / growth_report_like) ─────────────
// Backward-compatible: {news, unread_count} + additive next_cursor
// Query params: limit (default 50, max 100), cursor
router.get("/teacher/news", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const limit = parseLimit(req.query.limit, 50, 100);
    const cursor = req.query.cursor as string | undefined;

    let cursorClause = sql``;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return res.status(400).json({ error: "cursor 형식이 올바르지 않습니다." });
      }
      cursorClause = sql`
        AND (n.created_at, n.id) < (${decoded.created_at}::timestamptz, ${decoded.id})
      `;
    }

    const rows = await db.execute(sql`
      SELECT n.id, n.type, n.title, n.body, n.ref_id, n.is_read, n.created_at,
        cd.lesson_date, cg.name AS class_name
      FROM notifications n
      LEFT JOIN class_diaries cd ON cd.id = n.ref_id AND n.ref_type = 'diary'
      LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
      WHERE n.recipient_id = ${userId} AND n.recipient_type = 'user'
        AND n.type IN ('diary_like', 'diary_thanks', 'diary_comment', 'growth_report_like', 'growth_report_comment')
        ${cursorClause}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ${limit + 1}
    `);

    const allRows = rows.rows as any[];
    const hasMore = allRows.length > limit;
    const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

    const unread = pageRows.filter((n: any) => !n.is_read).length;

    let next_cursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
      next_cursor = encodeCursor(last.created_at, last.id);
    }

    res.json({ news: pageRows, unread_count: unread, next_cursor });
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
