/**
 * support-tickets.ts
 * POST   /support/tickets            — 문의 생성 (any auth user)
 * GET    /support/my-tickets         — 내 문의 목록
 * GET    /support/tickets/:id        — 문의 상세 + 답변 목록
 * POST   /support/tickets/:id/replies — 답변 추가
 * GET    /super/support-general      — 슈퍼관리자: 일반 문의 목록
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

const SUPER_ROLES = new Set(["super_admin", "platform_admin", "super_manager"]);

let _tableDone = false;
async function ensureTicketTables() {
  if (_tableDone) return;
  _tableDone = true;

  for (const ddl of [
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT '{}'`,
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS consultation_requested BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS submitter_user_id TEXT`,
  ]) {
    await db.execute(sql.raw(ddl)).catch(() => {});
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS support_ticket_replies (
      id          TEXT PRIMARY KEY,
      ticket_id   TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      author_name TEXT,
      author_role TEXT NOT NULL DEFAULT 'user',
      content     TEXT NOT NULL,
      image_urls  TEXT[] DEFAULT '{}',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

ensureTicketTables().catch(console.error);

// ─── POST /support/tickets — 문의 생성 ─────────────────────────────────────
router.post("/support/tickets", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTicketTables();

    const { ticket_type, subject, description, image_urls, consultation_requested, pool_id } = req.body as any;
    if (!subject) { res.status(400).json({ error: "제목을 입력해주세요." }); return; }

    const userId   = req.user?.userId ?? "";
    const userName = req.user?.name   ?? "";
    const userRole = req.user?.role   ?? "";

    let requesterType = "operator";
    if (userRole === "teacher") requesterType = "teacher";
    else if (userRole === "parent") requesterType = "parent";

    const type = ticket_type ?? "general";
    const slaHours = type === "security" ? 4 : type === "emergency" ? 8 : 24;
    const id = `tkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const images: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 3) : [];

    await db.execute(sql`
      INSERT INTO support_tickets
        (id, ticket_type, requester_type, requester_name, pool_id, subject, description,
         sla_hours, submitter_user_id, image_urls, consultation_requested, status)
      VALUES
        (${id}, ${type}, ${requesterType}, ${userName},
         ${pool_id ?? null}, ${subject}, ${description ?? null},
         ${slaHours}, ${userId},
         ${images as any},
         ${consultation_requested ? true : false}, 'open')
    `);

    res.json({ ok: true, id });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── GET /support/my-tickets — 내 문의 목록 ────────────────────────────────
router.get("/support/my-tickets", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTicketTables();
    const userId = req.user?.userId ?? "";
    const rows = (await db.execute(sql`
      SELECT id, ticket_type, subject, status, consultation_requested,
             created_at, updated_at, resolved_at
      FROM support_tickets
      WHERE submitter_user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 50
    `)).rows;
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── GET /support/tickets/:id — 문의 상세 ──────────────────────────────────
router.get("/support/tickets/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTicketTables();
    const { id } = req.params;
    const userId   = req.user?.userId ?? "";
    const userRole = req.user?.role   ?? "";
    const isSuper  = SUPER_ROLES.has(userRole);

    const rows = (await db.execute(sql`
      SELECT * FROM support_tickets WHERE id = ${id}
    `)).rows;

    if (!rows.length) { res.status(404).json({ error: "문의를 찾을 수 없습니다." }); return; }
    const ticket = rows[0] as any;

    if (!isSuper && ticket.submitter_user_id !== userId) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }

    const replies = (await db.execute(sql`
      SELECT * FROM support_ticket_replies
      WHERE ticket_id = ${id}
      ORDER BY created_at ASC
    `)).rows;

    res.json({ ...ticket, replies });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── POST /support/tickets/:id/replies — 답변 추가 ─────────────────────────
router.post("/support/tickets/:id/replies", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTicketTables();
    const { id } = req.params;
    const { content, image_urls } = req.body as any;
    if (!content) { res.status(400).json({ error: "내용을 입력해주세요." }); return; }

    const userId   = req.user?.userId ?? "";
    const userName = req.user?.name   ?? "";
    const userRole = req.user?.role   ?? "";
    const isSuper  = SUPER_ROLES.has(userRole);

    const rows = (await db.execute(sql`
      SELECT submitter_user_id FROM support_tickets WHERE id = ${id}
    `)).rows;
    if (!rows.length) { res.status(404).json({ error: "문의를 찾을 수 없습니다." }); return; }
    const ticket = rows[0] as any;

    if (!isSuper && ticket.submitter_user_id !== userId) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }

    const replyId    = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const authorRole = isSuper ? "super_admin" : "user";
    const images: string[] = Array.isArray(image_urls) ? image_urls.slice(0, 3) : [];

    await db.execute(sql`
      INSERT INTO support_ticket_replies
        (id, ticket_id, author_user_id, author_name, author_role, content, image_urls)
      VALUES
        (${replyId}, ${id}, ${userId}, ${userName}, ${authorRole}, ${content}, ${images as any})
    `);

    if (isSuper) {
      await db.execute(sql`
        UPDATE support_tickets
        SET status = 'in_progress', updated_at = NOW()
        WHERE id = ${id} AND status = 'open'
      `).catch(() => {});
    } else {
      await db.execute(sql`
        UPDATE support_tickets
        SET status = 'open', updated_at = NOW()
        WHERE id = ${id} AND status = 'in_progress'
      `).catch(() => {});
    }

    res.json({ ok: true, id: replyId });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ─── GET /super/support-general — 슈퍼관리자: 일반 문의 목록 ────────────────
router.get(
  "/super/support-general",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureTicketTables();
      const { status, limit = "50", offset = "0" } = req.query as any;
      const statusClause = (status && status !== "all")
        ? `AND status = '${String(status).replace(/'/g, "''")}'`
        : "";

      const rows = (await db.execute(sql.raw(`
        SELECT id, ticket_type, subject, status, requester_name, requester_type,
               consultation_requested, created_at, updated_at
        FROM support_tickets
        WHERE ticket_type = 'general'
        ${statusClause}
        ORDER BY created_at DESC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}
      `))).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
