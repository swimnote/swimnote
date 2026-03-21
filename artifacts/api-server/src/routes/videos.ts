/**
 * videos.ts — 영상 앨범 API
 *
 * album_type:
 *   "group"   → 반 전체 앨범  (class_id 필수, student_id nullable)
 *   "private" → 개인 앨범     (class_id + student_id 모두 필수)
 *
 * 접근 권한:
 *   super_admin    → 모든 풀
 *   pool_admin     → 자신의 풀만
 *   teacher        → 자신이 담당하는 반의 영상만 업로드/조회
 *   parent_account → 자녀 반 전체 앨범 + 자녀 개인 앨범만
 */
import { Router, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName } from "../utils/filename.js";

const router = Router();
// 영상은 최대 100MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client({ bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID });
  return _client;
}

async function getPoolSlug(poolId: string): Promise<string> {
  const rows = await db.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${poolId}`);
  const pool = rows.rows[0] as any;
  return pool?.name_en || sanitizePoolName(pool?.name || "pool");
}

async function teacherOwnsClass(teacherUserId: string, classId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM class_groups WHERE id = ${classId} AND teacher_user_id = ${teacherUserId}
  `);
  return rows.rows.length > 0;
}

async function parentOwnsStudent(parentAccountId: string, studentId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM parent_students
    WHERE parent_id = ${parentAccountId} AND student_id = ${studentId} AND status = 'approved'
  `);
  return rows.rows.length > 0;
}

async function getStudentClassId(studentId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT class_group_id FROM students WHERE id = ${studentId}`);
  return (rows.rows[0] as any)?.class_group_id || null;
}

async function getUserPoolId(userId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

function videoMimeType(ext: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    mkv: "video/x-matroska", webm: "video/webm", m4v: "video/x-m4v",
  };
  return map[ext.toLowerCase()] || "video/mp4";
}

// ── 영상 파일 스트리밍 ──────────────────────────────────────────────────
router.get("/videos/:videoId/file", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { videoId } = req.params;
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`
      SELECT sv.*, s.class_group_id AS student_class_id
      FROM student_videos sv
      LEFT JOIN students s ON s.id = sv.student_id
      WHERE sv.id = ${videoId}
    `);
    const video = rows.rows[0] as any;
    if (!video) { res.status(404).json({ error: "영상을 찾을 수 없습니다." }); return; }

    if (role === "parent_account") {
      if (video.album_type === "group") {
        const childRows = await db.execute(sql`
          SELECT s.id FROM students s
          JOIN parent_students ps ON ps.student_id = s.id
          WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
            AND s.class_group_id = ${video.class_id}
        `);
        if (!childRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      } else {
        const ok = await parentOwnsStudent(userId, video.student_id);
        if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }
    } else if (role === "teacher") {
      const classId = video.class_id || video.student_class_id;
      if (classId) {
        const ok = await teacherOwnsClass(userId, classId);
        if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (video.swimming_pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }

    const client = getClient();
    const { ok, value: bytes, error } = await client.downloadAsBytes(video.storage_key);
    if (!ok || !bytes) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    const ext = (video.storage_key.split(".").pop() || "mp4").toLowerCase();
    res.setHeader("Content-Type", videoMimeType(ext));
    res.setHeader("Cache-Control", "private, max-age=3600");
    const buf = Array.isArray(bytes) ? bytes[0] : bytes;
    res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf as any));
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 반 전체 앨범 조회 ──────────────────────────────────────────────────
router.get("/videos/group/:classId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { classId } = req.params;
    const { role, userId } = req.user!;

    if (role === "teacher") {
      const ok = await teacherOwnsClass(userId, classId);
      if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
    } else if (role === "parent_account") {
      const childRows = await db.execute(sql`
        SELECT s.id FROM students s
        JOIN parent_students ps ON ps.student_id = s.id
        WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
          AND s.class_group_id = ${classId}
      `);
      if (!childRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${classId} AND swimming_pool_id = ${poolId}`);
      if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }

    const rows = await db.execute(sql`
      SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.swimming_pool_id,
             sv.uploader_id, sv.uploader_name, sv.caption, sv.created_at, sv.file_size_bytes,
             s.name AS student_name
      FROM student_videos sv
      LEFT JOIN students s ON s.id = sv.student_id
      WHERE sv.album_type = 'group' AND sv.class_id = ${classId}
      ORDER BY sv.created_at DESC
    `);
    const videos = (rows.rows as any[]).map(v => ({ ...v, file_url: `/api/videos/${v.id}/file` }));
    res.json(videos);
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인 앨범 조회 ────────────────────────────────────────────────────
router.get("/videos/private/:studentId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { studentId } = req.params;
    const { role, userId } = req.user!;

    if (role === "teacher") {
      const classId = await getStudentClassId(studentId);
      if (!classId) { res.status(404).json({ error: "학생을 찾을 수 없습니다." }); return; }
      const ok = await teacherOwnsClass(userId, classId);
      if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
    } else if (role === "parent_account") {
      const ok = await parentOwnsStudent(userId, studentId);
      if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      const sRows = await db.execute(sql`SELECT id FROM students WHERE id = ${studentId} AND swimming_pool_id = ${poolId}`);
      if (!sRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }

    const rows = await db.execute(sql`
      SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.swimming_pool_id,
             sv.uploader_id, sv.uploader_name, sv.caption, sv.created_at, sv.file_size_bytes,
             s.name AS student_name
      FROM student_videos sv
      LEFT JOIN students s ON s.id = sv.student_id
      WHERE sv.album_type = 'private' AND sv.student_id = ${studentId}
      ORDER BY sv.created_at DESC
    `);
    const videos = (rows.rows as any[]).map(v => ({ ...v, file_url: `/api/videos/${v.id}/file` }));
    res.json(videos);
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 반 전체 앨범 업로드 ────────────────────────────────────────────────
router.post(
  "/videos/group",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.single("video"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, caption } = req.body;
      if (!class_id) { res.status(400).json({ error: "반(class_id)을 선택해주세요." }); return; }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "영상 파일을 선택해주세요." }); return; }

      const { role, userId } = req.user!;

      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (role === "pool_admin") {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id);
      const ext = file.originalname.split(".").pop() || "mp4";
      const filename = genFilename(poolSlug, ext);
      const key = `videos/group/${class_id}/${filename}`;

      const client = getClient();
      const { ok, error } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype });
      if (!ok) throw new Error(error?.message || "업로드 실패");

      const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const rows = await db.execute(sql`
        INSERT INTO student_videos
          (id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, file_size_bytes, album_type, class_id, caption)
        VALUES
          (${id}, NULL, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'group', ${class_id}, ${caption || null})
        RETURNING *
      `);

      res.status(201).json({ success: true, video: { ...rows.rows[0], file_url: `/api/videos/${id}/file` } });
    } catch (e) {
      console.error(e);
      const msg = (e as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 최대 100MB까지 업로드할 수 있습니다." }); return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 개인 앨범 업로드 ──────────────────────────────────────────────────
router.post(
  "/videos/private",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.single("video"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, student_id, caption } = req.body;
      if (!class_id || !student_id) {
        res.status(400).json({ error: "반과 학생을 선택해주세요." }); return;
      }

      const file = req.file;
      if (!file) { res.status(400).json({ error: "영상 파일을 선택해주세요." }); return; }

      const { role, userId } = req.user!;

      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      // student가 실제로 해당 class에 속하는지 검증
      const studentRows = await db.execute(sql`
        SELECT id, name FROM students WHERE id = ${student_id}
      `);
      if (!studentRows.rows.length) {
        res.status(400).json({ error: "학생을 찾을 수 없습니다." }); return;
      }

      const [user] = await db.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (role === "pool_admin") {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id);
      const ext = file.originalname.split(".").pop() || "mp4";
      const filename = genFilename(poolSlug, ext);
      const key = `videos/private/${student_id}/${filename}`;

      const client = getClient();
      const { ok, error } = await client.uploadFromBytes(key, file.buffer, { contentType: file.mimetype });
      if (!ok) throw new Error(error?.message || "업로드 실패");

      const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const rows = await db.execute(sql`
        INSERT INTO student_videos
          (id, student_id, swimming_pool_id, uploader_id, uploader_name, storage_key, file_size_bytes, album_type, class_id, caption)
        VALUES
          (${id}, ${student_id}, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'private', ${class_id}, ${caption || null})
        RETURNING *
      `);

      res.status(201).json({ success: true, video: { ...rows.rows[0], file_url: `/api/videos/${id}/file` } });
    } catch (e) {
      console.error(e);
      const msg = (e as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 최대 100MB까지 업로드할 수 있습니다." }); return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 학부모: 자녀 영상 앨범 — 반 전체 + 개별 통합 flat 목록 + source_label ─
router.get("/videos/parent-view", requireAuth, requireRole("parent_account"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;

    const childRows = await db.execute(sql`
      SELECT s.id, s.name, s.class_group_id,
             cg.name AS class_name, cg.schedule_days, cg.schedule_time
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      LEFT JOIN class_groups cg ON cg.id = s.class_group_id
      WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
    `);
    const children = childRows.rows as any[];

    const videoMap = new Map<string, any>();

    for (const child of children) {
      if (child.class_group_id) {
        const rows = (await db.execute(sql`
          SELECT sv.id, sv.album_type, sv.class_id, sv.student_id,
                 sv.uploader_name, sv.caption, sv.created_at,
                 '/api/videos/' || sv.id || '/file' AS file_url,
                 cg.name AS class_name, cg.schedule_days, cg.schedule_time
          FROM student_videos sv
          LEFT JOIN class_groups cg ON cg.id = sv.class_id
          WHERE sv.album_type = 'group' AND sv.class_id = ${child.class_group_id}
          ORDER BY sv.created_at DESC LIMIT 100
        `)).rows as any[];
        for (const row of rows) {
          if (!videoMap.has(row.id)) {
            const source_label = row.caption ||
              (row.schedule_days && row.schedule_time
                ? `${row.schedule_days.split(",")[0]} ${row.schedule_time}반 영상`
                : row.class_name ? `${row.class_name} 반 전체 영상` : "반 전체 영상");
            videoMap.set(row.id, { ...row, source_label });
          }
        }
      }
      const privRows = (await db.execute(sql`
        SELECT sv.id, sv.album_type, sv.class_id, sv.student_id,
               sv.uploader_name, sv.caption, sv.created_at,
               '/api/videos/' || sv.id || '/file' AS file_url,
               s.name AS student_name
        FROM student_videos sv
        LEFT JOIN students s ON s.id = sv.student_id
        WHERE sv.album_type = 'private' AND sv.student_id = ${child.id}
        ORDER BY sv.created_at DESC LIMIT 100
      `)).rows as any[];
      for (const row of privRows) {
        if (!videoMap.has(row.id)) {
          const source_label = row.caption ||
            `${row.student_name || child.name || "학생"} 개별 영상`;
          videoMap.set(row.id, { ...row, source_label });
        }
      }
    }

    const videos = Array.from(videoMap.values())
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    res.json({ videos, total: videos.length });
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 영상 삭제 ────────────────────────────────────────────────────────
router.delete("/videos/:videoId", requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { videoId } = req.params;
      const { role, userId } = req.user!;

      const rows = await db.execute(sql`SELECT * FROM student_videos WHERE id = ${videoId}`);
      const video = rows.rows[0] as any;
      if (!video) { res.status(404).json({ error: "영상을 찾을 수 없습니다." }); return; }

      if (role === "teacher") {
        if (video.uploader_id !== userId) {
          res.status(403).json({ error: "자신이 업로드한 영상만 삭제할 수 있습니다." }); return;
        }
      } else if (role === "pool_admin") {
        const poolId = await getUserPoolId(userId);
        if (video.swimming_pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      const client = getClient();
      await client.delete(video.storage_key).catch(() => {});
      await db.execute(sql`DELETE FROM student_videos WHERE id = ${videoId}`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

export default router;
