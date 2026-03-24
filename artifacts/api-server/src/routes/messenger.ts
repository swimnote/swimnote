/**
 * messenger.ts — 업무 메신저 API (채널형 2탭 구조)
 *
 * 채널:
 *   talk   — 관리자/선생님 실시간 업무 채팅
 *   notice — 관리자 공지 + 이동/보강 시스템 자동 메시지
 *
 * 권한: pool_admin, teacher (같은 pool 내)
 */
import { Router, type Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db, superAdminDb , superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename } from "../utils/filename.js";
import { sendPushToUser, sendPushToPoolAdmins, sendPushToPoolTeachers } from "../lib/push-service.js";

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

async function getPoolId(userId: string): Promise<string | null> {
  const rows = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

async function checkPoolAccess(userId: string, role: string, poolId: string): Promise<boolean> {
  if (role === "super_admin") return true;
  const userPoolId = await getPoolId(userId);
  return userPoolId === poolId;
}

// ─── 1. 메시지 목록 조회 ───────────────────────────────────────────────
// GET /messenger/messages?pool_id=&channel_type=talk|notice&cursor=&limit=
router.get(
  "/messenger/messages",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, channel_type = "talk", cursor, limit: limitStr } = req.query as Record<string, string>;
      const { userId, role } = req.user!;
      const limit = Math.min(parseInt(limitStr || "40", 10), 100);

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      let cursorClause = sql``;
      if (cursor) cursorClause = sql` AND wm.created_at < ${cursor}::timestamp`;

      const rows = await db.execute(sql`
        SELECT
          wm.id,
          wm.sender_id,
          wm.sender_name,
          wm.sender_role,
          wm.msg_type,
          wm.channel_type,
          wm.message_type,
          wm.content,
          wm.photo_url,
          wm.member_transfer_id,
          wm.extra_data,
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
          AND wm.channel_type = ${channel_type}
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

// ─── 2. 대화 채널 텍스트 메시지 전송 (talk, normal) ──────────────────
// POST /messenger/messages
router.post(
  "/messenger/messages",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, content, target_user_id, target_user_name } = req.body;
      const { userId, role } = req.user!;

      if (!pool_id || !content?.trim()) return err(res, 400, "pool_id와 content가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const msgType = target_user_id ? "directed_message" : "normal";
      const extraData = target_user_id
        ? JSON.stringify({ target_user_id, target_user_name: target_user_name || "" })
        : "{}";

      const rows = await db.execute(sql`
        INSERT INTO work_messages
          (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content, extra_data)
        VALUES
          (${pool_id}, ${userId}, ${senderName}, ${role}, 'text', 'talk', ${msgType}, ${content.trim()}, ${extraData}::jsonb)
        RETURNING *
      `);

      // 특정 유저 멘션(@) 메시지 → 해당 유저에게 푸시
      if (target_user_id && target_user_id !== userId) {
        sendPushToUser(
          target_user_id, false, "messenger",
          `💬 ${senderName}님의 메시지`,
          content.trim().slice(0, 100),
          { type: "messenger", poolId: pool_id },
          `msg_${pool_id}`
        ).catch(() => {});
      }

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/messages POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 3. 공지 채널 공지 작성 (notice, 관리자만) ─────────────────────────
// POST /messenger/notice
router.post(
  "/messenger/notice",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, content } = req.body;
      const { userId, role } = req.user!;

      if (!pool_id || !content?.trim()) return err(res, 400, "pool_id와 content가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const rows = await db.execute(sql`
        INSERT INTO work_messages
          (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content)
        VALUES
          (${pool_id}, ${userId}, ${senderName}, ${role}, 'text', 'notice', 'notice', ${content.trim()})
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/notice POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 4. 사진 메시지 전송 (대화 채널) ──────────────────────────────────
// POST /messenger/messages/photo
router.post(
  "/messenger/messages/photo",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  upload.single("photo"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, content } = req.body;
      const { userId, role } = req.user!;
      const file = req.file;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!file) return err(res, 400, "사진 파일이 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const poolRow = await superAdminDb.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${pool_id}`);
      const pool = poolRow.rows[0] as any;
      const poolSlug = pool?.name_en || (pool?.name || "pool").toLowerCase().replace(/\s+/g, "-");

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
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
          (id, pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content, photo_url, photo_key)
        VALUES
          (${msgId}, ${pool_id}, ${userId}, ${senderName}, ${role}, 'photo', 'talk', 'normal',
           ${content?.trim() || null}, ${photoApiUrl}, ${key})
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/messages/photo POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 5. 읽음 상태 조회 ─────────────────────────────────────────────────
// GET /messenger/read-state?pool_id=&channel_type=notice
router.get(
  "/messenger/read-state",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, channel_type = "notice" } = req.query as Record<string, string>;
      const { userId } = req.user!;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");

      const rows = await db.execute(sql`
        SELECT last_read_at FROM messenger_read_state
        WHERE pool_id = ${pool_id} AND user_id = ${userId} AND channel_type = ${channel_type}
      `);

      const lastReadAt = (rows.rows[0] as any)?.last_read_at || null;

      // 읽지 않은 메시지 수 확인
      let unreadCount = 0;
      if (lastReadAt) {
        const cntRows = await db.execute(sql`
          SELECT count(*)::int AS cnt FROM work_messages
          WHERE pool_id = ${pool_id} AND channel_type = ${channel_type}
            AND created_at > ${lastReadAt}::timestamp
            AND sender_id != ${userId}
        `);
        unreadCount = (cntRows.rows[0] as any)?.cnt || 0;
      } else {
        const cntRows = await db.execute(sql`
          SELECT count(*)::int AS cnt FROM work_messages
          WHERE pool_id = ${pool_id} AND channel_type = ${channel_type}
        `);
        unreadCount = (cntRows.rows[0] as any)?.cnt || 0;
      }

      return res.json({ success: true, lastReadAt, unreadCount });
    } catch (e: any) {
      console.error("[messenger/read-state GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 6. 읽음 상태 업데이트 ─────────────────────────────────────────────
// POST /messenger/read-state
router.post(
  "/messenger/read-state",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, channel_type = "notice" } = req.body;
      const { userId } = req.user!;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");

      await db.execute(sql`
        INSERT INTO messenger_read_state (pool_id, user_id, channel_type, last_read_at)
        VALUES (${pool_id}, ${userId}, ${channel_type}, now())
        ON CONFLICT (pool_id, user_id, channel_type)
        DO UPDATE SET last_read_at = now()
      `);

      return res.json({ success: true });
    } catch (e: any) {
      console.error("[messenger/read-state POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 7. 회원이전 카드 생성 (notice 채널, system_move) ──────────────────
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
        superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`),
        db.execute(sql`SELECT name, swimming_pool_id FROM students WHERE id = ${student_id}`),
        superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${to_user_id}`),
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

      // 공지 채널 system_move 메시지
      const systemContent = `${student.name} 회원이 ${senderName} 선생님에서 ${toUserName} 선생님으로 이동되었습니다.`;
      const msgRows = await db.execute(sql`
        INSERT INTO work_messages
          (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content, member_transfer_id)
        VALUES
          (${pool_id}, 'system', '시스템', 'system', 'text', 'notice', 'system_move', ${systemContent}, ${transfer.id})
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

// ─── 8. 회원이전 처리 (승인/거절) ─────────────────────────────────────
// PATCH /messenger/member-transfers/:id
router.patch(
  "/messenger/member-transfers/:id",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body;
      const { userId, role } = req.user!;

      if (!["approve", "reject"].includes(action)) return err(res, 400, "action은 approve 또는 reject이어야 합니다.");

      const tfRows = await db.execute(sql`SELECT * FROM member_transfers WHERE id = ${id}`);
      const tf = tfRows.rows[0] as any;
      if (!tf) return err(res, 404, "이전 요청을 찾을 수 없습니다.");
      if (tf.status !== "pending") return err(res, 400, "이미 처리된 요청입니다.");
      if (!(await checkPoolAccess(userId!, role, tf.pool_id))) return err(res, 403, "권한이 없습니다.");

      if (action === "approve") {
        await db.execute(sql`UPDATE students SET class_group_id = NULL, updated_at = now() WHERE id = ${tf.student_id}`);
        await db.execute(sql`
          UPDATE student_class_schedules SET assigned_class_id = NULL, updated_at = now(), updated_by = ${userId}
          WHERE student_id = ${tf.student_id}
        `);
        await db.execute(sql`UPDATE member_transfers SET status = 'approved', resolved_at = now(), resolved_by = ${userId} WHERE id = ${id}`);
      } else {
        await db.execute(sql`UPDATE member_transfers SET status = 'rejected', resolved_at = now(), resolved_by = ${userId} WHERE id = ${id}`);
      }

      const updated = await db.execute(sql`SELECT * FROM member_transfers WHERE id = ${id}`);
      return res.json({ success: true, transfer: updated.rows[0] });
    } catch (e: any) {
      console.error("[messenger/member-transfers PATCH]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 9. 스태프 목록 조회 ───────────────────────────────────────────────
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

      const rows = await superAdminDb.execute(sql`
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

// ─── 11. 내 담당 학생 목록 ─────────────────────────────────────────────
// GET /messenger/my-students?pool_id=
router.get(
  "/messenger/my-students",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id } = req.query as { pool_id: string };
      const { userId, role } = req.user!;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      // 관리자는 해당 풀 전체 활성 학생, 선생님은 자신이 담당한 반의 학생만
      const teacherFilter = role === "pool_admin" ? sql`true` : sql`cg.teacher_user_id = ${userId}`;
      const rows = await superAdminDb.execute(sql`
        SELECT
          s.id,
          s.name,
          s.parent_phone,
          s.parent_name,
          cg.id AS class_group_id,
          cg.name AS class_name,
          cg.schedule_days,
          cg.schedule_time,
          cg.teacher_user_id,
          u.name AS teacher_name
        FROM students s
        LEFT JOIN class_groups cg ON cg.id = s.class_group_id AND cg.is_deleted = false
        LEFT JOIN users u ON u.id = cg.teacher_user_id
        WHERE s.swimming_pool_id = ${pool_id}
          AND s.status = 'active'
          AND (${teacherFilter})
        ORDER BY s.name ASC
      `);

      return res.json({ success: true, students: rows.rows });
    } catch (e: any) {
      console.error("[messenger/my-students GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 12. 회원정보 카드 메시지 전송 ─────────────────────────────────────
// POST /messenger/send-card
router.post(
  "/messenger/send-card",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id, student_id } = req.body;
      const { userId, role } = req.user!;

      if (!pool_id || !student_id) return err(res, 400, "pool_id와 student_id가 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const studentRow = await superAdminDb.execute(sql`
        SELECT
          s.id, s.name, s.parent_phone, s.parent_name,
          cg.id AS class_group_id, cg.name AS class_name,
          cg.schedule_days, cg.schedule_time, cg.teacher_user_id,
          u.name AS teacher_name
        FROM students s
        LEFT JOIN class_groups cg ON cg.id = s.class_group_id AND cg.is_deleted = false
        LEFT JOIN users u ON u.id = cg.teacher_user_id
        WHERE s.id = ${student_id}
          AND s.swimming_pool_id = ${pool_id}
          AND s.status = 'active'
        LIMIT 1
      `);

      const student = studentRow.rows[0] as any;
      if (!student) return err(res, 404, "학생을 찾을 수 없습니다.");

      const cardData = {
        student_id: student.id,
        member_name: student.name,
        class_name: student.class_name || "미배정",
        schedule_days: student.schedule_days || "",
        schedule_time: student.schedule_time || "",
        parent_phone: student.parent_phone || "",
        teacher_user_id: student.teacher_user_id || null,
        teacher_name: student.teacher_name || "",
      };

      const content = `[회원정보] ${student.name}`;
      const extraData = JSON.stringify(cardData);

      const rows = await db.execute(sql`
        INSERT INTO work_messages
          (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content, extra_data)
        VALUES
          (${pool_id}, ${userId}, ${senderName}, ${role}, 'text', 'talk', 'member_profile_card', ${content}, ${extraData}::jsonb)
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/send-card POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 13. 파일 첨부 메시지 전송 ────────────────────────────────────────
// POST /messenger/send-attachment (multipart/form-data: pool_id, file)
router.post(
  "/messenger/send-attachment",
  requireAuth,
  requireRole("pool_admin", "teacher"),
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { pool_id } = req.body;
      const { userId, role } = req.user!;
      const file = req.file;

      if (!pool_id) return err(res, 400, "pool_id가 필요합니다.");
      if (!file) return err(res, 400, "파일이 필요합니다.");
      if (!(await checkPoolAccess(userId!, role, pool_id))) return err(res, 403, "권한이 없습니다.");

      const poolRow = await superAdminDb.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${pool_id}`);
      const pool = poolRow.rows[0] as any;
      const poolSlug = pool?.name_en || (pool?.name || "pool").toLowerCase().replace(/\s+/g, "-");

      const userRow = await superAdminDb.execute(sql`SELECT name FROM users WHERE id = ${userId}`);
      const senderName = (userRow.rows[0] as any)?.name || "알 수 없음";

      const ext = file.originalname.split(".").pop() || "bin";
      const key = `${poolSlug}/attachments/${genFilename(ext)}`;

      const client = getClient();
      const { ok, error: uploadErr } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype } as any);
      if (!ok) throw new Error(uploadErr?.message || "파일 업로드 실패");

      const domain = process.env.REPLIT_DEV_DOMAIN || "localhost";
      const fileApiUrl = `https://${domain}/api/messenger/attachment/${key}`;

      const extraData = JSON.stringify({
        attachment_key: key,
        attachment_name: file.originalname,
        attachment_mime: file.mimetype,
        attachment_size: file.size,
        attachment_url: fileApiUrl,
      });

      const content = `[파일] ${file.originalname}`;
      const rows = await db.execute(sql`
        INSERT INTO work_messages
          (pool_id, sender_id, sender_name, sender_role, msg_type, channel_type, message_type, content, extra_data)
        VALUES
          (${pool_id}, ${userId}, ${senderName}, ${role}, 'file', 'talk', 'attachment_file', ${content}, ${extraData}::jsonb)
        RETURNING *
      `);

      return res.status(201).json({ success: true, message: rows.rows[0] });
    } catch (e: any) {
      console.error("[messenger/send-attachment POST]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

// ─── 10. 사진 파일 서빙 ────────────────────────────────────────────────
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
      return void res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any));
    } catch (e: any) {
      console.error("[messenger/photo GET]", e);
      return err(res, 500, e.message || "서버 오류");
    }
  }
);

export default router;
