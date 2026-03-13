import { Router, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable, studentsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

router.get("/students/:studentId/diary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params;
    const role = req.user!.role;
    const userId = req.user!.userId;

    if (role === "parent_account") {
      const rows = await db.execute(sql`
        SELECT 1 FROM parent_students
        WHERE parent_id = ${userId} AND student_id = ${studentId} AND status = 'approved'
      `);
      if (rows.rows.length === 0) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    } else if (!["pool_admin", "teacher", "super_admin"].includes(role)) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }

    const rows = await db.execute(sql`
      SELECT * FROM swim_diary WHERE student_id = ${studentId} ORDER BY created_at DESC
    `);
    res.json(rows.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post(
  "/students/:studentId/diary",
  requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("images", 5),
  async (req: AuthRequest, res: Response) => {
    try {
      const { studentId } = req.params;
      const { title, lesson_content, practice_goals, good_points, improve_points, next_focus } = req.body;

      if (!title?.trim()) { res.status(400).json({ error: "제목을 입력해주세요." }); return; }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      const [student] = await db.select({ id: studentsTable.id }).from(studentsTable)
        .where(eq(studentsTable.id, studentId)).limit(1);
      if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

      const files = req.files as Express.Multer.File[] | undefined;
      const imageKeys: string[] = [];
      if (files && files.length > 0) {
        const client = getClient();
        for (const file of files.slice(0, 5)) {
          const ext = file.originalname.split(".").pop() || "jpg";
          const key = `diary/${studentId}/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
          const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
          if (!ok) throw new Error(error?.message || "업로드 실패");
          imageKeys.push(key);
        }
      }

      const id = `diary_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      const rows = await db.execute(sql`
        INSERT INTO swim_diary
          (id, student_id, swimming_pool_id, author_id, author_name,
           title, lesson_content, practice_goals, good_points, improve_points, next_focus, image_urls)
        VALUES
          (${id}, ${studentId}, ${user.swimming_pool_id}, ${req.user!.userId}, ${user.name},
           ${title.trim()},
           ${lesson_content?.trim() || null},
           ${practice_goals?.trim() || null},
           ${good_points?.trim() || null},
           ${improve_points?.trim() || null},
           ${next_focus?.trim() || null},
           ${JSON.stringify(imageKeys)}::jsonb)
        RETURNING *
      `);
      res.status(201).json(rows.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
  }
);

router.delete(
  "/students/:studentId/diary/:entryId",
  requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.execute(sql`SELECT image_urls FROM swim_diary WHERE id = ${req.params.entryId}`);
      const entry = rows.rows[0] as any;
      if (entry && Array.isArray(entry.image_urls) && entry.image_urls.length > 0) {
        const client = getClient();
        for (const key of entry.image_urls) { await client.delete(key).catch(() => {}); }
      }
      await db.execute(sql`DELETE FROM swim_diary WHERE id = ${req.params.entryId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "삭제 중 오류가 발생했습니다." }); }
  }
);

export default router;
