/**
 * inquiries.ts — 문의하기 API
 *
 * POST  /inquiries                  — 문의 생성
 * GET   /inquiries/unread-count     — 미읽음 카운트
 * GET   /inquiries/sent             — 내가 보낸 문의 목록
 * GET   /inquiries/received         — 수신함 (admin: 내 수영장, super: 전체)
 * GET   /inquiries/:id              — 문의 상세 + 답변
 * POST  /inquiries/:id/reply        — 답변 작성
 * PATCH /inquiries/:id/read         — 문의 읽음 처리
 * PATCH /inquiries/replies/:id/read — 답변 읽음 처리
 */
import { Router } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

const SUPER_ROLES = new Set(["super_admin", "platform_admin"]);
const ADMIN_ROLES = new Set(["pool_admin", "sub_admin"]);

/**
 * ensureTables — NO-OP (WP8-P2)
 * DDL moved to src/migrations/runtime-ddl-consolidated.ts §2
 * Run that migration before deploying. This function is kept for call-site compatibility.
 */
async function ensureTables() {
  // NO-OP: schema is guaranteed by explicit migration
}

async function getSenderInfo(userId: string, role?: string) {
  // parent_account → parent_accounts 테이블 + 연결 학생의 수영장 정보
  if (role === "parent_account") {
    try {
      const rows = await db.execute(sql`
        SELECT pa.name,
               s.swimming_pool_id,
               sp.name AS pool_name
        FROM parent_accounts pa
        LEFT JOIN parent_students ps ON ps.parent_id = pa.id AND ps.status = 'approved'
        LEFT JOIN students s ON s.id = ps.student_id
        LEFT JOIN swimming_pools sp ON sp.id = s.swimming_pool_id
        WHERE pa.id = ${userId}
        LIMIT 1
      `);
      const row = rows.rows[0] as any;
      return {
        name: row?.name || "",
        pool_id: row?.swimming_pool_id || null,
        pool_name: row?.pool_name || null,
      };
    } catch {
      return { name: "", pool_id: null, pool_name: null };
    }
  }
  // 일반 users 테이블
  try {
    const rows = await superAdminDb.execute(sql`
      SELECT u.name, u.swimming_pool_id, sp.name AS pool_name
      FROM users u
      LEFT JOIN swimming_pools sp ON sp.id = u.swimming_pool_id
      WHERE u.id = ${userId}
      LIMIT 1
    `);
    const row = rows.rows[0] as any;
    return {
      name: row?.name || "",
      pool_id: row?.swimming_pool_id || null,
      pool_name: row?.pool_name || null,
    };
  } catch {
    return { name: "", pool_id: null, pool_name: null };
  }
}

function roleLabel(role: string): string {
  if (SUPER_ROLES.has(role)) return "슈퍼관리자";
  if (role === "pool_admin") return "관리자";
  if (role === "sub_admin")  return "관리자";
  if (role === "teacher")    return "선생님";
  if (role === "parent" || role === "parent_account") return "학부모";
  return role;
}

// ─── POST /inquiries — 문의 생성 ───────────────────────────────────────────
router.post("/inquiries", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId, role } = req.user!;
    const { title, content, target = "super" } = req.body;

    if (!title?.trim() || !content?.trim()) {
      res.status(400).json({ error: "제목과 내용을 입력해주세요." });
      return;
    }

    const allowedTargets: string[] = SUPER_ROLES.has(role)
      ? []
      : (role === "parent" || role === "parent_account")
        ? ["super", "admin"]
        : ["super"];

    if (!allowedTargets.includes(target)) {
      res.status(400).json({ error: "잘못된 문의 대상입니다." });
      return;
    }

    const { name, pool_id, pool_name } = await getSenderInfo(userId!, role);
    const id = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO inquiries
        (id, sender_uuid, sender_role, sender_name, pool_id, pool_name, target, title, content, status)
      VALUES
        (${id}, ${userId}, ${role}, ${name}, ${pool_id}, ${pool_name}, ${target}, ${title.trim()}, ${content.trim()}, 'unread')
    `);

    res.json({ success: true, id });
  } catch (e) {
    console.error("[POST /inquiries]", e);
    res.status(500).json({ error: "문의 저장 중 오류가 발생했습니다." });
  }
});

// ─── GET /inquiries/unread-count ────────────────────────────────────────────
router.get("/inquiries/unread-count", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId, role } = req.user!;
    let count = 0;

    if (SUPER_ROLES.has(role)) {
      const rows = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM inquiries WHERE target = 'super' AND status = 'unread'
      `);
      count = Number((rows.rows[0] as any)?.cnt ?? 0);
    } else if (ADMIN_ROLES.has(role)) {
      const { pool_id } = await getSenderInfo(userId!);
      const [recv, sent] = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM inquiries
          WHERE target = 'admin' AND pool_id = ${pool_id} AND status = 'unread'
        `),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM inquiry_replies ir
          JOIN inquiries i ON i.id = ir.inquiry_id
          WHERE i.sender_uuid = ${userId} AND ir.is_read = FALSE AND ir.replier_uuid != ${userId}
        `),
      ]);
      count = Number((recv.rows[0] as any)?.cnt ?? 0) + Number((sent.rows[0] as any)?.cnt ?? 0);
    } else {
      const rows = await db.execute(sql`
        SELECT COUNT(*) AS cnt FROM inquiry_replies ir
        JOIN inquiries i ON i.id = ir.inquiry_id
        WHERE i.sender_uuid = ${userId} AND ir.is_read = FALSE AND ir.replier_uuid != ${userId}
      `);
      count = Number((rows.rows[0] as any)?.cnt ?? 0);
    }

    res.json({ count });
  } catch (e) {
    console.error("[GET /inquiries/unread-count]", e);
    res.json({ count: 0 });
  }
});

// ─── GET /inquiries/sent — 내가 보낸 문의 ──────────────────────────────────
router.get("/inquiries/sent", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId } = req.user!;

    const rows = await db.execute(sql`
      SELECT
        i.*,
        COALESCE(
          (SELECT COUNT(*) FROM inquiry_replies ir
           WHERE ir.inquiry_id = i.id AND ir.is_read = FALSE AND ir.replier_uuid != ${userId}),
          0
        ) AS unread_reply_count,
        COALESCE(
          (SELECT COUNT(*) FROM inquiry_replies ir WHERE ir.inquiry_id = i.id),
          0
        ) AS reply_count
      FROM inquiries i
      WHERE i.sender_uuid = ${userId}
      ORDER BY i.created_at DESC
    `);

    res.json(rows.rows);
  } catch (e) {
    console.error("[GET /inquiries/sent]", e);
    res.status(500).json({ error: "문의 목록 조회 중 오류가 발생했습니다." });
  }
});

// ─── GET /inquiries/received — 수신함 ──────────────────────────────────────
router.get("/inquiries/received", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId, role } = req.user!;

    if (!SUPER_ROLES.has(role) && !ADMIN_ROLES.has(role)) {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }

    let rows;
    if (SUPER_ROLES.has(role)) {
      rows = await db.execute(sql`
        SELECT
          i.*,
          COALESCE(
            (SELECT COUNT(*) FROM inquiry_replies ir WHERE ir.inquiry_id = i.id), 0
          ) AS reply_count
        FROM inquiries i
        WHERE i.target = 'super'
        ORDER BY i.created_at DESC
        LIMIT 200
      `);
    } else {
      const { pool_id } = await getSenderInfo(userId!);
      rows = await db.execute(sql`
        SELECT
          i.*,
          COALESCE(
            (SELECT COUNT(*) FROM inquiry_replies ir WHERE ir.inquiry_id = i.id), 0
          ) AS reply_count
        FROM inquiries i
        WHERE i.target = 'admin' AND i.pool_id = ${pool_id}
        ORDER BY i.created_at DESC
        LIMIT 200
      `);
    }

    res.json(rows.rows);
  } catch (e) {
    console.error("[GET /inquiries/received]", e);
    res.status(500).json({ error: "수신함 조회 중 오류가 발생했습니다." });
  }
});

// ─── GET /inquiries/:id — 상세 ──────────────────────────────────────────────
router.get("/inquiries/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId, role } = req.user!;
    const { id } = req.params;

    const inqRows = await db.execute(sql`SELECT * FROM inquiries WHERE id = ${id} LIMIT 1`);
    const inq = inqRows.rows[0] as any;
    if (!inq) { res.status(404).json({ error: "문의를 찾을 수 없습니다." }); return; }

    const isSender = inq.sender_uuid === userId;
    const isRecipient =
      SUPER_ROLES.has(role) ||
      (ADMIN_ROLES.has(role) && inq.target === "admin");

    if (!isSender && !isRecipient) {
      res.status(403).json({ error: "권한이 없습니다." }); return;
    }

    const repliesRows = await db.execute(sql`
      SELECT * FROM inquiry_replies WHERE inquiry_id = ${id} ORDER BY created_at ASC
    `);

    res.json({ ...inq, replies: repliesRows.rows, role_label: roleLabel(inq.sender_role) });
  } catch (e) {
    console.error("[GET /inquiries/:id]", e);
    res.status(500).json({ error: "문의 상세 조회 중 오류가 발생했습니다." });
  }
});

// ─── POST /inquiries/:id/reply — 답변 작성 ─────────────────────────────────
router.post("/inquiries/:id/reply", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { userId, role } = req.user!;
    const { id } = req.params;
    const { content } = req.body;

    if (!content?.trim()) { res.status(400).json({ error: "내용을 입력해주세요." }); return; }

    const inqRows = await db.execute(sql`SELECT * FROM inquiries WHERE id = ${id} LIMIT 1`);
    const inq = inqRows.rows[0] as any;
    if (!inq) { res.status(404).json({ error: "문의를 찾을 수 없습니다." }); return; }

    const isSender = inq.sender_uuid === userId;
    const isRecipient =
      SUPER_ROLES.has(role) ||
      (ADMIN_ROLES.has(role) && inq.target === "admin");

    if (!isSender && !isRecipient) {
      res.status(403).json({ error: "권한이 없습니다." }); return;
    }

    const { name } = await getSenderInfo(userId!);
    const replyId = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO inquiry_replies (id, inquiry_id, replier_uuid, replier_role, replier_name, content, is_read)
      VALUES (${replyId}, ${id}, ${userId}, ${role}, ${name}, ${content.trim()}, FALSE)
    `);

    if (!isSender) {
      await db.execute(sql`UPDATE inquiries SET status = 'replied' WHERE id = ${id}`);
    }

    const replyRow = await db.execute(sql`SELECT * FROM inquiry_replies WHERE id = ${replyId} LIMIT 1`);
    res.json(replyRow.rows[0]);
  } catch (e) {
    console.error("[POST /inquiries/:id/reply]", e);
    res.status(500).json({ error: "답변 저장 중 오류가 발생했습니다." });
  }
});

// ─── PATCH /inquiries/:id/read ──────────────────────────────────────────────
router.patch("/inquiries/:id/read", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { id } = req.params;
    await db.execute(sql`UPDATE inquiries SET status = 'read' WHERE id = ${id} AND status = 'unread'`);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

// ─── PATCH /inquiries/replies/:id/read ─────────────────────────────────────
router.patch("/inquiries/replies/:id/read", requireAuth, async (req: AuthRequest, res) => {
  try {
    await ensureTables();
    const { id } = req.params;
    await db.execute(sql`UPDATE inquiry_replies SET is_read = TRUE WHERE id = ${id}`);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

export default router;
