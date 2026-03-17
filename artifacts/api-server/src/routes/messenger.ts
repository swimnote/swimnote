/**
 * messenger.ts — 업무 메신저 API
 * 
 * 기능:
 *   - 텍스트 메시지 (전체/특정 스태프 대상)
 *   - 사진 첨부 메시지
 *   - 회원이전 카드
 * 
 * 권한: pool_admin, teacher (같은 pool 내)
 */
import { Router, type Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename } from "../utils/filename.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

function err(res: Response, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg, error: msg });
}

/** 요청자의 pool_id를 확인 */
async function getPoolId(userId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

/** pool_admin/teacher만 해당 pool에 접근 가능 */
async function checkPoolAccess(userId: string, role: string, poolId: string): Promise<boolean> {
  if (role === "super_admin") return true;
  const userPoolId = await getPoolId(userId);
  return userPoolId === poolId;
}

// ─── 1. 메시지 목록 조회 ───────────────────────────────────────────────
// GET /messenger/messages?pool_id=&filter=all|photo|transfer&cursor=&limit=
router.get(
  "/messenger/messages",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, filter = "all", cursor, limit: limitStr } = req.query as Record<string, string>;
      const { userId, role } = req.user!;
      const limit = Math.min(parseInt(limitStr || "30", 10), 100);

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      let filterClause = sql``;
      if (filter === "photo") filterClause = sql` AND wm.msg_type = 'photo'`;
      if (filter === "transfer") filterClause = sql` AND wm.msg_type = 'member_transfer'`;

      let cursorClause = sql``;
      if (cursor) cursorClause = sql` AND wm.created_at < ${cursor}::timestamp`;

      const rows = await db.execute(sql`
        SELECT 
          wm.id,
          wm.sender_id,
          wm.sender_name,
          wm.sender_role,
          wm.msg_type,
          wm.content,
          wm.target_id,
          wm.target_name,
          wm.photo_url,
          wm.member_transfer_id,
          wm.created_at,
          mt.student_id,
          mt.student_name,
          mt.from_user_id,
          mt.from_user_name,
          mt.to_user_id,
          mt.to_user_name,
          mt.weekly_sessions,
          mt.remaining_makeups,
          mt.status AS transfer_status,
          mt.notes AS transfer_notes
        FROM work_messages wm
        LEFT JOIN member_transfers mt ON mt.id = wm.member_transfer_id
        WHERE wm.pool_id = ${pool_id}
        ${filterClause}
        ${cursorClause}
        ORDER BY wm.created_at DESC
        LIMIT ${limit + 1}
      `);

      const messages = rows.rows as any[];
      const hasMore = messages.length > limit;
      if (hasMore) messages.pop();

      const nextCursor = hasMore ? messages[messages.length - 1]?.created_at : null;

      return res.json({ success: true, messages, hasMore, nextCursor });
    } catch (e: any) {
      console.error("[messenger/messages GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 2. 텍스트 메시지 전송 ─────────────────────────────────────────────
// POST /messenger/messages
router.post(
  "/messenger/messages",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, content, target_id, target_name } = req.body;
      const { userId, role } = req.user!;

      if (!pool_id || !content?.trim()) return err(res, 400, "pool_id와 content가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const userRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const rows = await db.execute(sql`
        INSERT INTO work_messages (pool_id, sender_id, sender_name, sender_role, msg_type, content, target_id, target_name)
        VALUES (${pool_id}, ${userId}, ${senderName}, ${role}, 'text', ${content.trim()}, ${target_id || null}, ${target_name || null})
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/messages POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 3. 사진 메시지 전송 ───────────────────────────────────────────────
// POST /messenger/messages/photo (multipart)
router.post(
  "/messenger/messages/photo",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  upload.single("photo"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, content, target_id, target_name } = req.body;
      const { userId, role } = req.user!;
      const file = req.file;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!file) return err(res, 400, "사진 파일이 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const poolRow = await db.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${pool_id}`);
      const pool = poolRow.rows[0] as any;
      const poolSlug = pool?.name_en || (pool?.name || "pool").toLowerCase().replace(/\s+/g, "-");

      const userRow = await db.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const ext = file.originalname.split(".").pop() || "jpg";
      const key = `${poolSlug}/messenger/${genFilename(ext)}`;

      const client = getClient();
      const { ok, error: uploadErr } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype });
      if (!ok) throw new Error(uploadErr?.message || "사진 업로드 실패");

      const msgId = `wmsg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const photoApiUrl = `/api/messenger/photo/${msgId}`;

      const rows = await db.execute(sql`
        INSERT INTO work_messages 
          (id, pool_id, sender_id, sender_name, sender_role, msg_type, content, target_id, target_name, photo_url, photo_key)
        VALUES 
          (${msgId}, ${pool_id}, ${userId}, ${senderName}, ${role}, 'photo', ${content?.trim() || null}, 
           ${target_id || null}, ${target_name || null}, ${photoApiUrl}, ${key})
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/messages/photo POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 4. 회원이전 카드 생성 ─────────────────────────────────────────────
// POST /messenger/member-transfers
router.post(
  "/messenger/member-transfers",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, student_id, to_user_id, notes } = req.body;
      const { userId, role } = req.user!;

      if (!pool_id || !student_id || !to_user_id) return err(res, 400, "pool_id, student_id, to_user_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const [senderRow, studentRow, targetRow, makeupRow, scsRow] = await Promise.all([
        db.execute(sql`SELECT name FROM users WHERE id = ${userId}`),
        db.execute(sql`SELECT name, swimming_pool_id FROM students WHERE id = ${student_id}`),
        db.execute(sql`SELECT name FROM users WHERE id = ${to_user_id}`),
        db.execute(sql`SELECT count(*)::int AS cnt FROM makeup_sessions WHERE student_id = ${student_id} AND status = 'waiting'`),
        db.execute(sql`SELECT frequency FROM student_class_schedules WHERE student_id = ${student_id}`),
      ]);

      const senderName = (senderRow.rows[0] as any)?.name || "알 수 없음";
      const student = studentRow.rows[0] as any;
      if (!student || student.swimming_pool_id !== pool_id) return err(res, 404, "해당 수영장의 회원이 아닙니다.");
      if (userId === to_user_id) return err(res, 400, "자신에게 이전할 수 없습니다.");

      const toUserName = (targetRow.rows[0] as any)?.name || "알 수 없음";
      const remainingMakeups = (makeupRow.rows[0] as any)?.cnt || 0;
      const weeklySessions = (scsRow.rows[0] as any)?.frequency || 0;

      const transferRows = await db.execute(sql`
        INSERT INTO member_transfers 
          (pool_id, student_id, student_name, from_user_id, from_user_name, to_user_id, to_user_name, weekly_sessions, remaining_makeups, notes)
        VALUES 
          (${pool_id}, ${student_id}, ${student.name}, ${userId}, ${senderName}, ${to_user_id}, ${toUserName}, ${weeklySessions}, ${remainingMakeups}, ${notes || null})
        RETURNING *
      `);

      const transfer = transferRows.rows[0] as any;

      const msgRows = await db.execute(sql`
        INSERT INTO work_messages 
          (pool_id, sender_id, sender_name, sender_role, msg_type, content, target_id, target_name, member_transfer_id)
        VALUES 
          (${pool_id}, ${userId}, ${senderName}, ${role}, 'member_transfer', ${`${student.name} 회원 이전 요청`},
           ${to_user_id}, ${toUserName}, ${transfer.id})
        RETURNING *
      `);

      await db.execute(sql`UPDATE member_transfers SET work_message_id = ${msgRows.rows[0].id} WHERE id = ${transfer.id}`);

      return res.status(201).json({ success: true, message: msgRows.rows[0], transfer });
    } catch (e: any) {
      console.error("[messenger/member-transfers POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 5. 회원이전 처리 (승인/거절) ─────────────────────────────────────
// PATCH /messenger/member-transfers/:id
router.patch(
  "/messenger/member-transfers/:id",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body; // 'approve' | 'reject'
      const { userId, role } = req.user!;

      if (!["approve", "reject"].includes(action)) return err(res, 400, "action은 approve 또는 reject이어야 합니다.");

      const tfRows = await db.execute(sql`SELECT * FROM member_transfers WHERE id = ${id}`);
      const tf = tfRows.rows[0] as any;
      if (!tf) return err(res, 404, "이전 요청을 찾을 수 없습니다.");
      if (tf.status !== "pending") return err(res, 400, "이미 처리된 요청입니다.");
      if (!(await checkPoolAccess(userId!, role, tf.pool_id))) return err(res, 403, "권한이 없습니다.");

      if (action === "approve") {
        await db.execute(sql`
          UPDATE students SET class_group_id = NULL, updated_at = now() WHERE id = ${tf.student_id}
        `);
        await db.execute(sql`
          UPDATE student_class_schedules SET assigned_class_id = NULL, updated_at = now(), updated_by = ${userId}
          WHERE student_id = ${tf.student_id}
        `);
        await db.execute(sql`
          UPDATE member_transfers SET status = 'approved', resolved_at = now(), resolved_by = ${userId} WHERE id = ${id}
        `);
      } else {
        await db.execute(sql`
          UPDATE member_transfers SET status = 'rejected', resolved_at = now(), resolved_by = ${userId} WHERE id = ${id}
        `);
      }

      const updated = await db.execute(sql`SELECT * FROM member_transfers WHERE id = ${id}`);
      return res.json({ success: true, transfer: updated.rows[0] });
    } catch (e: any) {
      console.error("[messenger/member-transfers PATCH]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 6. 스태프 목록 조회 (이전 대상 선택용) ───────────────────────────
// GET /messenger/staff?pool_id=
router.get(
  "/messenger/staff",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id } = req.query as { pool_id: string };
      const { userId, role } = req.user!;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const rows = await db.execute(sql`
        SELECT id, name, role, position
        FROM users
        WHERE swimming_pool_id = ${pool_id}
          AND role IN ('pool_admin', 'teacher')
          AND is_activated = true
        ORDER BY role DESC, name ASC
      `);

      return res.json({ success: true, staff: rows.rows });
    } catch (e: any) {
      console.error("[messenger/staff GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 7. 사진 앨범 조회 ─────────────────────────────────────────────────
// GET /messenger/album?pool_id=&cursor=&limit=
router.get(
  "/messenger/album",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, cursor, limit: limitStr } = req.query as Record<string, string>;
      const { userId, role } = req.user!;
      const limit = Math.min(parseInt(limitStr || "20", 10), 50);

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      let cursorClause = sql``;
      if (cursor) cursorClause = sql` AND created_at < ${cursor}::timestamp`;

      const rows = await db.execute(sql`
        SELECT id, sender_name, photo_url, content, created_at
        FROM work_messages
        WHERE pool_id = ${pool_id} AND msg_type = 'photo'
        ${cursorClause}
        ORDER BY created_at DESC
        LIMIT ${limit + 1}
      `);

      const photos = rows.rows as any[];
      const hasMore = photos.length > limit;
      if (hasMore) photos.pop();
      const nextCursor = hasMore ? photos[photos.length - 1]?.created_at : null;

      return res.json({ success: true, photos, hasMore, nextCursor });
    } catch (e: any) {
      console.error("[messenger/album GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 8. 이전 가능한 회원 목록 ──────────────────────────────────────────
// GET /messenger/transferable-students?pool_id=
router.get(
  "/messenger/transferable-students",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id } = req.query as { pool_id: string };
      const { userId, role } = req.user!;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      let whereClause = sql`s.swimming_pool_id = ${pool_id} AND s.status = 'active'`;
      if (role === "teacher") {
        const cgRows = await db.execute(sql`SELECT id FROM class_groups WHERE teacher_user_id = ${userId} AND is_deleted = false`);
        const classIds = cgRows.rows.map((r: any) => r.id);
        if (classIds.length === 0) return res.json({ success: true, students: [] });
        whereClause = sql`${whereClause} AND s.class_group_id = ANY(${classIds})`;
      }

      const rows = await db.execute(sql`
        SELECT s.id, s.name, s.class_group_id, cg.name AS class_name, scs.frequency AS weekly_sessions
        FROM students s
        LEFT JOIN class_groups cg ON cg.id = s.class_group_id
        LEFT JOIN student_class_schedules scs ON scs.student_id = s.id
        WHERE ${whereClause}
        ORDER BY s.name ASC
        LIMIT 100
      `);

      return res.json({ success: true, students: rows.rows });
    } catch (e: any) {
      console.error("[messenger/transferable-students GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 9. 사진 파일 서빙 ─────────────────────────────────────────────────
// GET /messenger/photo/:messageId
router.get(
  "/messenger/photo/:messageId",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { messageId } = req.params;
      const { userId, role } = req.user!;

      const rows = await db.execute(sql`SELECT pool_id, photo_key FROM work_messages WHERE id = ${messageId} AND msg_type = 'photo'`);
      const msg = rows.rows[0] as any;
      if (!msg || !msg.photo_key) return err(res, 404, "사진을 찾을 수 없습니다.");
      if (!(await checkPoolAccess(userId!, role, msg.pool_id))) return err(res, 403, "권한이 없습니다.");

      const client = getClient();
      const { ok, value: bytes, error } = await client.downloadAsBytes(msg.photo_key);
      if (!ok || !bytes) return err(res, 404, "파일을 찾을 수 없습니다.");

      const ext = (msg.photo_key.split(".").pop() || "jpg").toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=3600");
      const buf = Array.isArray(bytes) ? bytes[0] : bytes;
      res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any));
    } catch (e: any) {
      console.error("[messenger/photo GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

export default router;
