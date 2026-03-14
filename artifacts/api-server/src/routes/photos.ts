import { Router, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { studentsTable, usersTable, parentStudentsTable, parentAccountsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName, filenameFromKey } from "../utils/filename.js";
import { notifyPhotoUpload, notifyComment, checkStorageUsage } from "../utils/notify.js";

const router = Router();
// 모바일 평균 사진 크기 기준 최대 8MB 제한
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

async function getPoolSlug(poolId: string): Promise<string> {
  const rows = await db.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${poolId}`);
  const pool = rows.rows[0] as any;
  return pool?.name_en || sanitizePoolName(pool?.name || "pool");
}

// ── 사진 파일 스트리밍 (인증 필요) ───────────────────────────────────
router.get("/photos/:photoId/file", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { photoId } = req.params;
    const rows = await db.execute(sql`SELECT storage_key FROM student_photos WHERE id = ${photoId}`);
    const photo = rows.rows[0] as any;
    if (!photo) { res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return; }
    const client = getClient();
    const { ok, value: bytes, error } = await client.downloadAsBytes(photo.storage_key);
    if (!ok || !bytes) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }
    const ext = (photo.storage_key.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(Buffer.from(bytes));
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 학생 사진 목록 ────────────────────────────────────────────────────
router.get("/students/:studentId/photos", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params;
    const { role, userId } = req.user!;
    if (role === "parent_account") {
      const [link] = await db.select().from(parentStudentsTable)
        .where(and(eq(parentStudentsTable.parent_id, userId), eq(parentStudentsTable.student_id, studentId), eq(parentStudentsTable.status, "approved")))
        .limit(1);
      if (!link) { res.status(403).json({ error: "해당 학생의 사진에 접근할 권한이 없습니다." }); return; }
    } else if (!["pool_admin", "teacher", "super_admin"].includes(role)) {
      res.status(403).json({ error: "접근 권한이 없습니다." }); return;
    }
    const rows = await db.execute(sql`
      SELECT sp.*, (SELECT COUNT(*) FROM photo_comments WHERE photo_id = sp.id) AS comment_count
      FROM student_photos sp WHERE sp.student_id = ${studentId} ORDER BY sp.created_at DESC
    `);
    const photos = (rows.rows as any[]).map(p => ({
      ...p,
      file_url: `/photos/${p.id}/file`,
    }));
    res.json(photos);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 여러 학생에게 동시 사진 업로드 ───────────────────────────────────
router.post("/photos/batch", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 5),
  async (req: AuthRequest, res: Response) => {
    try {
      let studentIds: string[] = [];
      try { const raw = req.body.student_ids; studentIds = Array.isArray(raw) ? raw : JSON.parse(raw); } catch { studentIds = []; }
      if (!studentIds.length) { res.status(400).json({ error: "학생을 한 명 이상 선택해주세요." }); return; }
      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      const poolSlug = await getPoolSlug(user.swimming_pool_id);
      const client = getClient();

      // 파일을 오브젝트 스토리지에 업로드 (표준 파일명)
      const uploaded: { key: string; size: number }[] = [];
      for (const file of files) {
        const ext = (file.originalname.split(".").pop() || "jpg");
        const filename = genFilename(poolSlug, ext);
        const key = `photos/batch/${filename}`;
        const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
        if (!ok) throw new Error(error?.message || "업로드 실패");
        uploaded.push({ key, size: file.size });
      }

      // 각 학생별로 DB 레코드 생성 + 알림
      const inserted: any[] = [];
      for (const studentId of studentIds) {
        const [student] = await db.select({ id: studentsTable.id, name: studentsTable.name })
          .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
        if (!student) continue;
        for (const { key, size } of uploaded) {
          const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const rows = await db.execute(sql`
            INSERT INTO student_photos (id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, file_size_bytes)
            VALUES (${id}, ${studentId}, ${user.swimming_pool_id}, ${req.user!.userId}, ${user.name}, ${key}, ${size})
            RETURNING *
          `);
          inserted.push(rows.rows[0]);
        }
        notifyPhotoUpload(user.swimming_pool_id, studentId, student.name, uploaded.length).catch(() => {});
      }
      // 저장 용량 80% 경고 체크 (비동기)
      checkStorageUsage(user.swimming_pool_id).catch(() => {});
      res.status(201).json({ count: inserted.length, photos: inserted });
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE") || msg.includes("too large")) {
        res.status(413).json({ error: "파일 크기 초과: 이미지는 장당 최대 8MB까지 업로드할 수 있습니다." });
        return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 단일 학생 업로드 ──────────────────────────────────────────────────
router.post("/students/:studentId/photos", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 5),
  async (req: AuthRequest, res: Response) => {
    try {
      const { studentId } = req.params;
      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }
      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }
      const [student] = await db.select({ id: studentsTable.id, name: studentsTable.name })
        .from(studentsTable).where(eq(studentsTable.id, studentId)).limit(1);
      if (!student) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }

      const poolSlug = await getPoolSlug(user.swimming_pool_id);
      const client = getClient();
      const inserted: any[] = [];
      for (const file of files) {
        const ext = file.originalname.split(".").pop() || "jpg";
        const filename = genFilename(poolSlug, ext);
        const key = `photos/${studentId}/${filename}`;
        const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
        if (!ok) throw new Error(error?.message || "업로드 실패");
        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const rows = await db.execute(sql`
          INSERT INTO student_photos (id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, file_size_bytes)
          VALUES (${id}, ${studentId}, ${user.swimming_pool_id}, ${req.user!.userId}, ${user.name}, ${key}, ${file.size})
          RETURNING *
        `);
        inserted.push(rows.rows[0]);
      }
      notifyPhotoUpload(user.swimming_pool_id, studentId, student.name, files.length).catch(() => {});
      // 저장 용량 80% 경고 체크 (비동기)
      checkStorageUsage(user.swimming_pool_id).catch(() => {});
      res.status(201).json(inserted);
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 이미지는 장당 최대 8MB까지 업로드할 수 있습니다." });
        return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 사진 삭제 (관리자만) ──────────────────────────────────────────────
router.delete("/students/:studentId/photos/:photoId", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.execute(sql`SELECT storage_key FROM student_photos WHERE id = ${req.params.photoId}`);
      const photo = rows.rows[0] as any;
      if (!photo) { res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return; }
      const client = getClient();
      await client.delete(photo.storage_key).catch(() => {});
      await db.execute(sql`DELETE FROM student_photos WHERE id = ${req.params.photoId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

// ── 사진 댓글 목록 (내 댓글만 내용 공개) ────────────────────────────
router.get("/photos/:photoId/comments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT * FROM photo_comments WHERE photo_id = ${req.params.photoId} ORDER BY created_at ASC
    `);
    const result = (rows.rows as any[]).map(c => ({
      id: c.id, photo_id: c.photo_id,
      author_name: c.author_id === userId ? c.author_name : null,
      author_role: c.author_role,
      content: c.author_id === userId ? c.content : null,
      is_mine: c.author_id === userId,
      created_at: c.created_at,
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 사진 댓글 작성 ────────────────────────────────────────────────────
router.post("/photos/:photoId/comments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) { res.status(400).json({ error: "댓글 내용을 입력해주세요." }); return; }
    const { userId, role } = req.user!;
    let authorName = "알 수 없음";
    let poolId = "";

    if (role === "parent_account") {
      const [pa] = await db.select({ name: parentAccountsTable.name, swimming_pool_id: parentAccountsTable.swimming_pool_id })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, userId)).limit(1);
      authorName = pa?.name || "학부모";
      poolId = pa?.swimming_pool_id || "";
    } else {
      const [u] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      authorName = u?.name || "선생님";
      poolId = u?.swimming_pool_id || "";
    }

    const id = `cmt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const rows = await db.execute(sql`
      INSERT INTO photo_comments (id, photo_id, author_id, author_name, author_role, content)
      VALUES (${id}, ${req.params.photoId}, ${userId}, ${authorName}, ${role}, ${content.trim()})
      RETURNING *
    `);
    const c = rows.rows[0] as any;

    // 알림: 학부모가 댓글을 달면 선생님에게 알림 (비동기)
    if (role === "parent_account" && poolId) {
      notifyComment(poolId, "photo_comment", authorName, req.params.photoId, "사진").catch(() => {});
    }

    res.status(201).json({ ...c, is_mine: true });
  } catch (err) { res.status(500).json({ error: "서버 오류" }); }
});

// ── 사진 댓글 삭제 (관리자만) ─────────────────────────────────────────
router.delete("/photos/:photoId/comments/:commentId", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const rows = await db.execute(sql`SELECT id FROM photo_comments WHERE id = ${req.params.commentId}`);
      if (!rows.rows.length) { res.status(404).json({ error: "댓글을 찾을 수 없습니다." }); return; }
      await db.execute(sql`DELETE FROM photo_comments WHERE id = ${req.params.commentId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
