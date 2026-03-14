/**
 * diary.ts — 수영일지 API
 *
 * 테이블: swim_diary
 * 컬럼: id, student_id(null), swimming_pool_id, author_id, author_name,
 *       created_at, title, lesson_content, practice_goals, good_points,
 *       next_focus, image_urls(jsonb), media_items(jsonb), class_group_id
 *
 * media_items 형식: [{key: string, type: 'image'|'video'}]
 */
import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

function err(res: any, status: number, message: string) {
  return res.status(status).json({ success: false, message, error: message });
}

async function getUserPoolId(userId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

async function getUserName(userId: string): Promise<string> {
  const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.name || userId;
}

async function teacherOwnsClass(teacherUserId: string, classId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM class_groups WHERE id = ${classId} AND teacher_user_id = ${teacherUserId}
  `);
  return rows.rows.length > 0;
}

/** 일지 저장 후 해당 반 학부모에게 in-app + Expo 푸시 알림 발송 */
async function sendDiaryNotifications(classId: string, diaryId: string, className: string, poolId: string) {
  try {
    // 학반의 학생에 연결된 승인된 학부모 조회 (JOIN으로 배열 없이)
    const parentRows = await db.execute(sql`
      SELECT DISTINCT pa.id AS parent_account_id, pa.name AS parent_name
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      JOIN parent_accounts pa ON pa.id = ps.parent_id
      WHERE s.class_group_id = ${classId}
        AND s.status != 'deleted'
        AND ps.status = 'approved'
    `);
    const parents = parentRows.rows as any[];
    if (parents.length === 0) return;

    // In-app 알림 삽입
    for (const parent of parents) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await db.execute(sql`
        INSERT INTO notifications
          (id, recipient_id, recipient_type, type, title, body, ref_id, ref_type, pool_id, is_read)
        VALUES
          (${notifId}, ${parent.parent_account_id}, 'parent_account', 'diary_upload',
           ${'새 수영 일지가 작성되었습니다'},
           ${`${className} 수업 일지가 작성되었습니다. 확인해보세요!`},
           ${diaryId}, 'diary', ${poolId}, false)
        ON CONFLICT DO NOTHING
      `);
    }

    // Expo 푸시 토큰 조회 (JOIN으로 배열 없이)
    const tokenRows = await db.execute(sql`
      SELECT DISTINCT pt.token
      FROM push_tokens pt
      JOIN students s ON s.class_group_id = ${classId}
      JOIN parent_students ps ON ps.student_id = s.id AND ps.parent_id = pt.parent_account_id
      WHERE s.status != 'deleted'
        AND ps.status = 'approved'
        AND pt.token IS NOT NULL AND pt.token != ''
    `);
    const tokens = (tokenRows.rows as any[]).map((r: any) => r.token).filter(Boolean);
    if (tokens.length === 0) return;

    const messages = tokens.map((t: string) => ({
      to: t,
      title: "📒 새 수영 일지",
      body: `${className} 수업 일지가 작성되었습니다`,
      data: { type: "diary_upload", diaryId, classId },
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    }).catch(() => {});
  } catch (e) {
    console.error("알림 발송 오류:", e);
  }
}

// ── POST /diary/upload ─────────────────────────────────────────────────
// 일지용 미디어(사진/영상) 업로드
router.post("/diary/upload", requireAuth, requireRole("super_admin", "pool_admin", "teacher"),
  upload.single("file"), async (req: AuthRequest, res) => {
  try {
    const file = req.file;
    if (!file) return err(res, 400, "파일을 선택해주세요.");

    const ext = file.originalname.split(".").pop()?.toLowerCase() || "jpg";
    const isVideo = ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(ext);
    const type = isVideo ? "video" : "image";
    const key = `diary-media/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${ext}`;

    const client = getClient();
    const { ok, error } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype });
    if (!ok) throw new Error((error as any)?.message || "업로드 실패");

    return res.json({ key, type });
  } catch (e: any) {
    console.error(e);
    return err(res, 500, "업로드 중 오류가 발생했습니다.");
  }
});

// ── GET /diary ─────────────────────────────────────────────────────────
router.get("/diary", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { date, class_group_id } = req.query as Record<string, string>;
    const { role, userId } = req.user!;

    const poolId = await getUserPoolId(userId);
    if (!poolId && role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    if (class_group_id) {
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_group_id);
        if (!ok) return err(res, 403, "담당 반이 아닙니다.");
      } else if (role === "pool_admin") {
        const classRows = await db.execute(sql`
          SELECT id FROM class_groups WHERE id = ${class_group_id} AND swimming_pool_id = ${poolId}
        `);
        if (!classRows.rows.length) return err(res, 403, "접근 권한이 없습니다.");
      }

      const rows = await db.execute(sql`
        SELECT id, class_group_id, swimming_pool_id, author_id, author_name,
               title, lesson_content, practice_goals, good_points, next_focus,
               image_urls, media_items, created_at
        FROM swim_diary
        WHERE class_group_id = ${class_group_id}
        ORDER BY created_at DESC
      `);
      return res.json(rows.rows);
    }

    if (date) {
      let rows;
      if (role === "teacher") {
        rows = await db.execute(sql`
          SELECT sd.id, sd.class_group_id, sd.title, sd.created_at
          FROM swim_diary sd
          JOIN class_groups cg ON cg.id = sd.class_group_id
          WHERE sd.swimming_pool_id = ${poolId}
            AND cg.teacher_user_id = ${userId}
            AND DATE(sd.created_at) = ${date}::date
          ORDER BY sd.created_at DESC
        `);
      } else if (role === "pool_admin") {
        rows = await db.execute(sql`
          SELECT id, class_group_id, title, created_at
          FROM swim_diary
          WHERE swimming_pool_id = ${poolId}
            AND DATE(created_at) = ${date}::date
          ORDER BY created_at DESC
        `);
      } else {
        rows = await db.execute(sql`
          SELECT id, class_group_id, title, created_at
          FROM swim_diary
          WHERE DATE(created_at) = ${date}::date
          ORDER BY created_at DESC
        `);
      }
      return res.json(rows.rows);
    }

    if (role === "teacher") {
      const rows = await db.execute(sql`
        SELECT sd.id, sd.class_group_id, sd.title, sd.lesson_content, sd.next_focus,
               sd.author_name, sd.created_at, sd.media_items
        FROM swim_diary sd
        JOIN class_groups cg ON cg.id = sd.class_group_id
        WHERE sd.swimming_pool_id = ${poolId}
          AND cg.teacher_user_id = ${userId}
        ORDER BY sd.created_at DESC
        LIMIT 50
      `);
      return res.json(rows.rows);
    }

    const rows = await db.execute(sql`
      SELECT id, class_group_id, title, lesson_content, next_focus, author_name, created_at, media_items
      FROM swim_diary
      WHERE swimming_pool_id = ${poolId}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    return res.json(rows.rows);
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── POST /diary ────────────────────────────────────────────────────────
// body: { lesson_content?, media_items?: [{key, type}][], class_group_ids: string[] }
router.post("/diary", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { lesson_content, practice_goals, good_points, media_items, class_group_ids } = req.body;

    const classIds: string[] = Array.isArray(class_group_ids) ? class_group_ids : [];
    if (classIds.length === 0) return err(res, 400, "반(class_group_ids)을 선택해주세요.");

    const { role, userId } = req.user!;
    const poolId = await getUserPoolId(userId);
    if (!poolId && role !== "super_admin") return err(res, 403, "소속된 수영장이 없습니다.");

    const authorName = await getUserName(userId);
    const mediaItemsJson = JSON.stringify(Array.isArray(media_items) ? media_items : []);
    const inserted: any[] = [];

    for (const classId of classIds) {
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, classId);
        if (!ok) return err(res, 403, `담당 반이 아닙니다: ${classId}`);
      } else if (role === "pool_admin") {
        const classRows = await db.execute(sql`
          SELECT id FROM class_groups WHERE id = ${classId} AND swimming_pool_id = ${poolId}
        `);
        if (!classRows.rows.length) return err(res, 403, "접근 권한이 없습니다.");
      }

      // 반 이름 조회 (알림용)
      const classInfo = await db.execute(sql`SELECT name FROM class_groups WHERE id = ${classId}`);
      const className = (classInfo.rows[0] as any)?.name || "반";

      const id = `diary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const effectivePoolId = poolId || "super";
      // 자동 제목 생성
      const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
      const autoTitle = `${className} ${today} 수업 일지`;

      const rows = await db.execute(sql`
        INSERT INTO swim_diary
          (id, student_id, swimming_pool_id, author_id, author_name,
           title, lesson_content, practice_goals, good_points, next_focus,
           image_urls, media_items, class_group_id)
        VALUES
          (${id}, NULL, ${effectivePoolId}, ${userId}, ${authorName},
           ${autoTitle}, ${lesson_content || null},
           ${practice_goals || null}, ${good_points || null}, NULL,
           '[]'::jsonb, ${mediaItemsJson}::jsonb, ${classId})
        RETURNING *
      `);
      const diaryRow = rows.rows[0] as any;
      inserted.push(diaryRow);

      // 비동기 알림 발송 (await 하지 않음 - 응답 먼저)
      sendDiaryNotifications(classId, id, className, effectivePoolId).catch(console.error);
    }

    if (inserted.length === 1) return res.status(201).json({ success: true, ...inserted[0] });
    return res.status(201).json({ success: true, count: inserted.length, diaries: inserted });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── GET /diary/:id ─────────────────────────────────────────────────────
router.get("/diary/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { role, userId } = req.user!;
    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      const ok = await teacherOwnsClass(userId, diary.class_group_id);
      if (!ok) return err(res, 403, "접근 권한이 없습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    return res.json(diary);
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── PUT /diary/:id ─────────────────────────────────────────────────────
router.put("/diary/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { lesson_content, next_focus, practice_goals, good_points, media_items } = req.body;
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      if (diary.author_id !== userId) return err(res, 403, "자신이 작성한 일지만 수정할 수 있습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    const newMediaItems = media_items !== undefined
      ? JSON.stringify(Array.isArray(media_items) ? media_items : [])
      : JSON.stringify(diary.media_items || []);

    const updated = await db.execute(sql`
      UPDATE swim_diary SET
        lesson_content = ${lesson_content ?? diary.lesson_content},
        practice_goals = ${practice_goals ?? diary.practice_goals},
        good_points = ${good_points ?? diary.good_points},
        next_focus = ${next_focus ?? diary.next_focus},
        media_items = ${newMediaItems}::jsonb
      WHERE id = ${req.params.id}
      RETURNING *
    `);
    return res.json({ success: true, ...updated.rows[0] });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /diary/:id/media/:key ────────────────────────────────────────
// media_items 배열에서 특정 key 항목 제거
router.delete("/diary/:diaryId/media", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { role, userId } = req.user!;
    const key = req.body?.key as string;
    if (!key) return err(res, 400, "key가 필요합니다.");
    const diaryId = req.params.diaryId;

    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${diaryId}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      if (diary.author_id !== userId) return err(res, 403, "자신이 작성한 일지만 수정할 수 있습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    const currentItems: any[] = Array.isArray(diary.media_items) ? diary.media_items : [];
    const filtered = currentItems.filter((item: any) => item.key !== key);
    const newJson = JSON.stringify(filtered);

    await db.execute(sql`
      UPDATE swim_diary SET media_items = ${newJson}::jsonb WHERE id = ${diaryId}
    `);

    // Object Storage에서도 삭제 시도
    try {
      const client = getClient();
      await client.delete(key);
    } catch (_) {}

    return res.json({ success: true, media_items: filtered });
  } catch (e) { console.error(e); return err(res, 500, "서버 오류가 발생했습니다."); }
});

// ── DELETE /diary/:id ──────────────────────────────────────────────────
router.delete("/diary/:id", requireAuth, requireRole("super_admin", "pool_admin", "teacher"), async (req: AuthRequest, res) => {
  try {
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`SELECT * FROM swim_diary WHERE id = ${req.params.id}`);
    const diary = rows.rows[0] as any;
    if (!diary) return err(res, 404, "일지를 찾을 수 없습니다.");

    if (role === "teacher") {
      if (diary.author_id !== userId) return err(res, 403, "자신이 작성한 일지만 삭제할 수 있습니다.");
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (diary.swimming_pool_id !== poolId) return err(res, 403, "접근 권한이 없습니다.");
    }

    await db.execute(sql`DELETE FROM swim_diary WHERE id = ${req.params.id}`);
    return res.json({ success: true });
  } catch (e) { return err(res, 500, "서버 오류가 발생했습니다."); }
});

export default router;
