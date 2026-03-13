import { Router, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { studentsTable, usersTable, parentStudentsTable, parentAccountsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

async function getPoolId(userId: string): Promise<string | null> {
  const [u] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return u?.swimming_pool_id || null;
}

router.get("/students/:studentId/photos", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params;
    const role = req.user!.role;
    const userId = req.user!.userId;

    if (role === "parent_account") {
      const [link] = await db.select().from(parentStudentsTable)
        .where(and(eq(parentStudentsTable.parent_id, userId), eq(parentStudentsTable.student_id, studentId), eq(parentStudentsTable.status, "approved")))
        .limit(1);
      if (!link) { res.status(403).json({ error: "해당 학생의 사진에 접근할 권한이 없습니다." }); return; }
    } else if (!["pool_admin", "teacher", "super_admin"].includes(role)) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }

    const rows = await db.execute(sql`SELECT * FROM student_photos WHERE student_id = ${studentId} ORDER BY created_at DESC`);
    res.json(rows.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

router.post("/students/:studentId/photos", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 10), async (req: AuthRequest, res: Response) => {
    try {
      const { studentId } = req.params;
      const { caption } = req.body;
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      const [student] = await db.select({ id: studentsTable.id }).from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
      if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

      const client = getClient();
      const inserted: any[] = [];
      for (const file of files) {
        const ext = file.originalname.split(".").pop() || "jpg";
        const key = `photos/${studentId}/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
        const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
        if (!ok) throw new Error(error?.message || "업로드 실패");
        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const rows = await db.execute(sql`
          INSERT INTO student_photos (id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, caption)
          VALUES (${id}, ${studentId}, ${user.swimming_pool_id}, ${req.user!.userId}, ${user.name}, ${key}, ${caption || null})
          RETURNING *
        `);
        inserted.push(rows.rows[0]);
      }
      res.status(201).json(inserted);
    } catch (err) { console.error(err); res.status(500).json({ error: "업로드 중 오류가 발생했습니다." }); }
  }
);

router.delete("/students/:studentId/photos/:photoId", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { photoId } = req.params;
      const rows = await db.execute(sql`SELECT storage_key FROM student_photos WHERE id = ${photoId}`);
      const photo = rows.rows[0] as any;
      if (!photo) { res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return; }
      const client = getClient();
      await client.delete(photo.storage_key);
      await db.execute(sql`DELETE FROM student_photos WHERE id = ${photoId}`);
      res.json({ success: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "삭제 중 오류가 발생했습니다." }); }
  }
);

export default router;
