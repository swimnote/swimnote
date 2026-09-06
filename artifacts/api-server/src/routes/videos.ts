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
import { uploadToR2, downloadFromR2, deleteFromR2, getPresignedUrl } from "../lib/objectStorage.js";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName } from "../utils/filename.js";

const router = Router();
// 영상은 최대 100MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
// 영상 + 썸네일 동시 수신용 필드 설정
const uploadVideoFields = upload.fields([
  { name: "video",     maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
]);

/**
 * 영상 목록에 썸네일 presigned URL 일괄 추가.
 * 썸네일은 photo bucket(swimnotepicture)에 저장되므로 type="photo"로 서명.
 */
async function batchVideoPresign(videos: any[]): Promise<any[]> {
  return Promise.all(videos.map(async (v) => {
    let result = { ...v };
    // 썸네일 presign
    if (v.thumbnail_key) {
      const { ok, url } = await getPresignedUrl(v.thumbnail_key, "photo", 3600);
      if (ok && url) result.thumbnail_presigned_url = url;
    }
    // 영상 파일 presign (클라이언트가 redirect 없이 직접 다운로드 가능하게)
    if (v.object_key) {
      const { ok, url } = await getPresignedUrl(v.object_key, "video", 3600);
      if (ok && url) result.presigned_url = url;
    }
    return result;
  }));
}


async function getPoolSlug(poolId: string): Promise<string> {
  const rows = await superAdminDb.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${poolId}`);
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
  const rows = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

/**
 * 영상 업로드 사전 체크 (WP2A):
 * - tierBlocked 제거: 모든 플랜 영상 허용 (LOCKED POLICY)
 * - unified quota helper 사용: photo+video 통합 용량 기준
 */
async function checkVideoUploadAllowed(poolId: string): Promise<{
  tierBlocked: false;
  storageBlocked: boolean;
  tier: string;
  usedMb: number;
  limitMb: number;
}> {
  const { getPoolStorageUsage } = await import("../lib/storageQuota.js");
  const usage = await getPoolStorageUsage(poolId);

  // tier 정보 (로그용)
  const [meta] = (await superAdminDb.execute(sql`
    SELECT COALESCE(p.subscription_tier, 'free') AS tier
    FROM swimming_pools p WHERE p.id = ${poolId} LIMIT 1
  `)).rows as any[];
  const tier = (meta?.tier ?? "free") as string;

  const usedMb  = Math.round(usage.usedBytes / (1024 * 1024));
  const limitMb = Math.round(usage.quotaGb * 1024);

  return {
    tierBlocked: false,          // WP2A: all tiers allowed
    storageBlocked: usage.pct >= 100,
    tier,
    usedMb,
    limitMb,
  };
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
      FROM video_assets_meta sv
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
      if (video.pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }

    const { ok, url, error } = await getPresignedUrl(video.object_key, "video", 3600);
    if (!ok || !url) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    res.setHeader("Cache-Control", "private, max-age=3600");
    res.redirect(302, url);
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
      SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.pool_id,
             sv.uploaded_by, sv.uploaded_by_name, sv.caption, sv.created_at, sv.file_size,
             sv.thumbnail_key, s.name AS student_name
      FROM video_assets_meta sv
      LEFT JOIN students s ON s.id = sv.student_id
      WHERE sv.album_type = 'group' AND sv.class_id = ${classId}
      ORDER BY sv.created_at DESC
    `);
    const rawVideos = (rows.rows as any[]).map(v => ({ ...v, file_url: `/api/videos/${v.id}/file` }));
    const videos = await batchVideoPresign(rawVideos);
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
      SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.pool_id,
             sv.uploaded_by, sv.uploaded_by_name, sv.caption, sv.created_at, sv.file_size,
             s.name AS student_name
      FROM video_assets_meta sv
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
  uploadVideoFields,
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, caption } = req.body;
      // class_id는 선택사항 — 전체앨범은 반 선택 없이 업로드 가능

      const files = req.files as { [f: string]: Express.Multer.File[] } | undefined;
      const file = files?.video?.[0];
      const thumbFile = files?.thumbnail?.[0];
      if (!file) { res.status(400).json({ error: "영상 파일을 선택해주세요." }); return; }

      const { role, userId } = req.user!;

      if (role === "teacher" && class_id) {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (role === "pool_admin" && class_id) {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      // ── 영상 업로드 저장 제한 체크 (WP2A: tier gate 제거, unified quota) ──
      if (user.swimming_pool_id) {
        const check = await checkVideoUploadAllowed(user.swimming_pool_id);
        if (check.storageBlocked) {
          res.status(403).json({
            error: `저장공간 한도(${check.limitMb}MB) 초과로 업로드가 제한됩니다. 현재 사용: ${check.usedMb}MB`,
            code: "VIDEO_STORAGE_EXCEEDED",
            used_mb: check.usedMb,
            limit_mb: check.limitMb,
          }); return;
        }
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id || "");
      const ext = file.originalname.split(".").pop() || "mp4";
      const filename = genFilename(poolSlug, ext);
      // class_id가 있으면 반별 경로, 없으면 풀 전체 경로
      const key = class_id
        ? `videos/group/${class_id}/${filename}`
        : `videos/pool/${user.swimming_pool_id}/${filename}`;

      const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "video/mp4", "video");
      if (!ok) throw new Error(error || "업로드 실패");

      // 썸네일 업로드 (있을 경우) — photo bucket에 저장
      let thumbnailKey: string | null = null;
      if (thumbFile) {
        const thumbFilename = genFilename(poolSlug, "jpg");
        const tKey = `thumbnails/video/${user.swimming_pool_id}/${thumbFilename}`;
        const { ok: tOk } = await uploadToR2(tKey, thumbFile.buffer, "image/jpeg", "photo");
        if (tOk) thumbnailKey = tKey;
      }

      const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const rows = await db.execute(sql`
        INSERT INTO video_assets_meta
          (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id, caption, thumbnail_key, expires_at, status)
        VALUES
          (${id}, NULL, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'group', ${class_id || null}, ${caption || null}, ${thumbnailKey}, NOW() + INTERVAL '14 days', 'active')
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
  uploadVideoFields,
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, student_id, caption } = req.body;
      if (!class_id || !student_id) {
        res.status(400).json({ error: "반과 학생을 선택해주세요." }); return;
      }

      const files = req.files as { [f: string]: Express.Multer.File[] } | undefined;
      const file = files?.video?.[0];
      const thumbFile = files?.thumbnail?.[0];
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

      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (role === "pool_admin") {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      // ── 영상 업로드 저장 제한 체크 (WP2A: tier gate 제거, unified quota) ──
      if (user.swimming_pool_id) {
        const check = await checkVideoUploadAllowed(user.swimming_pool_id);
        if (check.storageBlocked) {
          res.status(403).json({
            error: `저장공간 한도(${check.limitMb}MB) 초과로 업로드가 제한됩니다. 현재 사용: ${check.usedMb}MB`,
            code: "VIDEO_STORAGE_EXCEEDED",
            used_mb: check.usedMb,
            limit_mb: check.limitMb,
          }); return;
        }
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id || "");
      const ext = file.originalname.split(".").pop() || "mp4";
      const filename = genFilename(poolSlug, ext);
      const key = `videos/private/${student_id}/${filename}`;

      const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "video/mp4", "video");
      if (!ok) throw new Error(error || "업로드 실패");

      // 썸네일 업로드 (있을 경우) — photo bucket에 저장
      let thumbnailKey: string | null = null;
      if (thumbFile) {
        const thumbFilename = genFilename(poolSlug, "jpg");
        const tKey = `thumbnails/video/${user.swimming_pool_id}/${thumbFilename}`;
        const { ok: tOk } = await uploadToR2(tKey, thumbFile.buffer, "image/jpeg", "photo");
        if (tOk) thumbnailKey = tKey;
      }

      const id = `video_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const rows = await db.execute(sql`
        INSERT INTO video_assets_meta
          (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id, caption, thumbnail_key, expires_at, status)
        VALUES
          (${id}, ${student_id}, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'private', ${class_id}, ${caption || null}, ${thumbnailKey}, NOW() + INTERVAL '14 days', 'active')
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

// ── 선생님: 전체앨범(pool-wide) / 개인앨범(saved) 영상 목록 ─────────────
router.get("/videos/teacher-all", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const scope = (req.query.scope as string) || "group";

    let videos: any[];
    if (scope === "group") {
      // 전체앨범 = pool 전체 영상 (class 무관)
      const poolId = await getUserPoolId(userId);
      if (!poolId) { res.json({ videos: [], total: 0 }); return; }
      const rows = await db.execute(sql`
        SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.uploaded_by_name,
               sv.caption, sv.created_at, sv.file_size, sv.thumbnail_key,
               '/api/videos/' || sv.id || '/file' AS file_url,
               cg.name AS class_name, cg.schedule_days, cg.schedule_time
        FROM video_assets_meta sv
        LEFT JOIN class_groups cg ON cg.id = sv.class_id
        WHERE sv.album_type = 'group'
          AND sv.pool_id = ${poolId}
          AND sv.status = 'active'
        ORDER BY sv.created_at DESC
      `);
      console.log("[teacher-all:group] poolId=", poolId, "rows=", rows.rows.length);
      videos = await batchVideoPresign(rows.rows as any[]);
    } else {
      // 개인앨범 = teacher_saved_videos 에서 가져옴
      const rows = await db.execute(sql`
        SELECT sv.id, sv.album_type, sv.class_id, sv.student_id, sv.uploaded_by_name,
               sv.caption, sv.created_at, sv.file_size, sv.thumbnail_key,
               '/api/videos/' || sv.id || '/file' AS file_url,
               cg.name AS class_name, cg.schedule_days, cg.schedule_time,
               tsv.created_at AS saved_at
        FROM teacher_saved_videos tsv
        JOIN video_assets_meta sv ON sv.id = tsv.video_id
        LEFT JOIN class_groups cg ON cg.id = sv.class_id
        WHERE tsv.teacher_id = ${userId}
        ORDER BY tsv.created_at DESC
      `);
      videos = await batchVideoPresign(rows.rows as any[]);
    }

    res.json({ videos, total: videos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범 영상 저장 목록 조회 ────────────────────────────────────────
router.get("/videos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT sv.id, sv.album_type, sv.class_id, sv.uploaded_by_name,
             sv.caption, sv.created_at, sv.file_size,
             '/api/videos/' || sv.id || '/file' AS file_url,
             cg.name AS class_name
      FROM teacher_saved_videos tsv
      JOIN video_assets_meta sv ON sv.id = tsv.video_id
      LEFT JOIN class_groups cg ON cg.id = sv.class_id
      WHERE tsv.teacher_id = ${userId}
      ORDER BY tsv.created_at DESC
    `);
    res.json({ videos: rows.rows, total: (rows.rows as any[]).length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범에 영상 저장 (즐겨찾기 추가) ─────────────────────────────────
router.post("/videos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { video_ids } = req.body as { video_ids: string[] };
    if (!Array.isArray(video_ids) || video_ids.length === 0) {
      res.status(400).json({ error: "video_ids가 필요합니다." }); return;
    }
    const poolId = await getUserPoolId(userId);
    const videoIdsLiteral = `{${video_ids.join(',')}}`;
    const checkRow = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM video_assets_meta
      WHERE id = ANY(${videoIdsLiteral}::text[]) AND pool_id = ${poolId}
    `);
    if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== video_ids.length) {
      res.status(403).json({ error: "일부 영상에 대한 접근 권한이 없습니다." }); return;
    }
    for (const videoId of video_ids) {
      const saveId = `vsave_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      await db.execute(sql`
        INSERT INTO teacher_saved_videos (id, teacher_id, video_id)
        VALUES (${saveId}, ${userId}, ${videoId})
        ON CONFLICT (teacher_id, video_id) DO NOTHING
      `);
    }
    res.json({ success: true, saved: video_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범에서 영상 제거 (파일 삭제 아님) ──────────────────────────────
router.delete("/videos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids가 필요합니다." }); return;
    }
    for (const videoId of ids) {
      await db.execute(sql`
        DELETE FROM teacher_saved_videos
        WHERE teacher_id = ${userId} AND video_id = ${videoId}
      `);
    }
    res.json({ success: true, deleted: ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 영상 대량 삭제 (teacher: 자신이 올린 것) ─────────────────────────────
router.delete("/videos/bulk", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "삭제할 영상 ID를 지정해주세요." }); return;
      }
      const { role, userId } = req.user!;
      let deletedCount = 0;
      for (const id of ids) {
        const rows = await db.execute(sql`SELECT * FROM video_assets_meta WHERE id = ${id}`);
        const video = rows.rows[0] as any;
        if (!video) continue;
        if (role === "teacher" && video.uploaded_by !== userId) continue;
        await deleteFromR2(video.object_key, "video");
        // Bug Fix #2: 대량 삭제 시에도 thumbnail R2 orphan 방지
        if (video.thumbnail_key) {
          try { await deleteFromR2(video.thumbnail_key, "photo"); } catch (_) {}
        }
        await db.execute(sql`DELETE FROM video_assets_meta WHERE id = ${id}`);
        deletedCount++;
      }
      res.json({ success: true, deleted: deletedCount });
    } catch (e) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

// ── 학부모: 자녀 영상 앨범 — 반 전체 + 개별 통합 flat 목록 + source_label ─
router.get("/videos/parent-view", requireAuth, requireRole("parent_account"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const studentId = (req.query.student_id as string) || null;

    const childRows = await db.execute(sql`
      SELECT s.id, s.name, s.class_group_id,
             cg.name AS class_name, cg.schedule_days, cg.schedule_time
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      LEFT JOIN class_groups cg ON cg.id = s.class_group_id
      WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
        AND (${studentId}::text IS NULL OR s.id = ${studentId})
    `);
    const children = childRows.rows as any[];

    const videoMap = new Map<string, any>();

    for (const child of children) {
      if (child.class_group_id) {
        const rows = (await db.execute(sql`
          SELECT sv.id, sv.album_type, sv.class_id, sv.student_id,
                 sv.uploaded_by_name, sv.caption, sv.created_at,
                 sv.thumbnail_key, sv.journal_id, sv.object_key,
                 '/api/videos/' || sv.id || '/file' AS file_url,
                 cg.name AS class_name, cg.schedule_days, cg.schedule_time
          FROM video_assets_meta sv
          LEFT JOIN class_groups cg ON cg.id = sv.class_id
          WHERE sv.album_type = 'group' AND sv.class_id = ${child.class_group_id}
            AND sv.status = 'active'
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
               sv.uploaded_by_name, sv.caption, sv.created_at,
               sv.thumbnail_key, sv.journal_id, sv.object_key,
               '/api/videos/' || sv.id || '/file' AS file_url,
               s.name AS student_name
        FROM video_assets_meta sv
        LEFT JOIN students s ON s.id = sv.student_id
        WHERE sv.album_type = 'private' AND sv.student_id = ${child.id}
          AND sv.status = 'active'
        ORDER BY sv.created_at DESC LIMIT 100
      `)).rows as any[];
      for (const row of privRows) {
        if (!videoMap.has(row.id)) {
          const source_label = row.caption ||
            `${row.student_name || child.name || "학생"} 개별 영상`;
          videoMap.set(row.id, { ...row, source_label });
        }
      }

      // ── 일지 첨부 영상 (journal_id 기준, class_diaries 조인) ──────────
      if (child.class_group_id) {
        const diaryVideoRows = (await db.execute(sql`
          SELECT sv.id, sv.album_type, sv.class_id, sv.student_id,
                 sv.uploaded_by_name, sv.caption, sv.created_at,
                 sv.thumbnail_key, sv.journal_id, sv.object_key,
                 '/api/videos/' || sv.id || '/file' AS file_url,
                 cd.class_group_id
          FROM video_assets_meta sv
          JOIN class_diaries cd ON cd.id = sv.journal_id
          WHERE cd.class_group_id = ${child.class_group_id}
            AND sv.journal_id IS NOT NULL
            AND sv.status = 'active'
          ORDER BY sv.created_at DESC LIMIT 200
        `)).rows as any[];
        for (const row of diaryVideoRows) {
          if (!videoMap.has(row.id)) {
            const source_label = row.caption ||
              (child.class_name
                ? `${child.class_name} 일지 영상`
                : "수업 일지 영상");
            videoMap.set(row.id, { ...row, source_label });
          }
        }
      }
    }

    const rawVideos = Array.from(videoMap.values())
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const videos = await batchVideoPresign(rawVideos);

    res.json({ videos, total: videos.length });
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── GET /videos/picker — 일지 작성용 전체앨범 영상 조회 ─────────────────────
// teacher-all과 동일하게 pool_id 기준으로만 조회 (teacher_user_id 조건 없음)
router.get("/videos/picker", requireAuth, requireRole("teacher", "pool_admin", "sub_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const poolId = await getUserPoolId(userId);
    if (role === "super_admin") { res.json({ videos: [], total: 0 }); return; }
    if (!poolId) { res.json({ videos: [], total: 0 }); return; }

    const rows = await db.execute(sql`
      SELECT sv.id, sv.class_id, sv.uploaded_by_name, sv.created_at, sv.file_size,
             sv.thumbnail_key,
             '/api/videos/' || sv.id || '/file' AS file_url,
             cg.name AS class_name
      FROM video_assets_meta sv
      LEFT JOIN class_groups cg ON cg.id = sv.class_id
      WHERE sv.album_type = 'group'
        AND sv.pool_id = ${poolId}
      ORDER BY sv.created_at DESC
    `);
    const videos = await batchVideoPresign(rows.rows as any[]);
    res.json({ videos, total: videos.length });
  } catch (err) {
    console.error("[VIDEOS_PICKER] 에러:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /videos/diary-attach — 선택 영상 journal_id 연결 ─────────────────
router.post("/videos/diary-attach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { diary_id, video_ids } = req.body as { diary_id: string; video_ids: string[] };
    if (!diary_id || !Array.isArray(video_ids)) {
      res.status(400).json({ error: "diary_id와 video_ids가 필요합니다." }); return;
    }
    if (video_ids.length > 10) {
      res.status(400).json({ error: "한 번에 최대 10개까지 연결할 수 있습니다." }); return;
    }
    if (video_ids.length === 0) { res.json({ updated: 0 }); return; }

    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    const videoIdsLiteral = `{${video_ids.join(',')}}`;
    const checkRow = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM video_assets_meta
      WHERE id = ANY(${videoIdsLiteral}::text[]) AND pool_id = ${poolId}
    `);
    if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== video_ids.length) {
      res.status(403).json({ error: "일부 영상에 대한 접근 권한이 없습니다." }); return;
    }

    await db.execute(sql`
      UPDATE video_assets_meta SET journal_id = ${diary_id}
      WHERE id = ANY(${videoIdsLiteral}::text[]) AND pool_id = ${poolId}
    `);

    res.json({ updated: video_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── POST /videos/diary-detach — journal_id 해제 ──────────────────────────
router.post("/videos/diary-detach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { video_ids } = req.body as { video_ids: string[] };
    if (!Array.isArray(video_ids) || video_ids.length === 0) {
      res.status(400).json({ error: "video_ids가 필요합니다." }); return;
    }
    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    const detachLiteral = `{${video_ids.join(',')}}`;
    await db.execute(sql`
      UPDATE video_assets_meta SET journal_id = NULL
      WHERE id = ANY(${detachLiteral}::text[]) AND pool_id = ${poolId}
    `);
    res.json({ updated: video_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── GET /videos/diary/:diaryId — 일지 연결 영상 목록 (선생님/관리자/학부모)
router.get("/videos/diary/:diaryId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const { diaryId } = req.params;

    // 학부모: 해당 일지 반에 자녀가 등록되어 있어야 함
    if (role === "parent_account") {
      const diaryRow = await db.execute(sql`
        SELECT cd.class_group_id FROM class_diaries cd
        JOIN class_groups cg ON cg.id = cd.class_group_id
        WHERE cd.id = ${diaryId}
        LIMIT 1
      `);
      if (!diaryRow.rows.length) { res.status(404).json({ error: "일지를 찾을 수 없습니다." }); return; }
      const classGroupId = (diaryRow.rows[0] as any).class_group_id;
      const childRows = await db.execute(sql`
        SELECT s.id FROM students s
        JOIN parent_students ps ON ps.student_id = s.id
        WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
          AND s.class_group_id = ${classGroupId}
      `);
      if (!childRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      // 학부모는 pool_id 없이 journal_id만으로 조회
      const rows = await db.execute(sql`
        SELECT id, uploaded_by_name, created_at, file_size, class_id, caption, thumbnail_key, status,
               '/api/videos/' || id || '/file' AS file_url
        FROM video_assets_meta
        WHERE journal_id = ${diaryId}
        ORDER BY created_at ASC
      `);
      const videos = await batchVideoPresign(rows.rows as any[]);
      res.json({ videos, total: videos.length }); return;
    }

    // 선생님/관리자
    if (!["teacher", "pool_admin", "sub_admin", "super_admin"].includes(role)) {
      res.status(403).json({ error: "권한이 없습니다." }); return;
    }
    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.json({ videos: [], total: 0 }); return; }

    // P0 Fix: journal_id 기반 공통 영상 + student_note_id 기반 학생별 영상 함께 반환
    // student note videos는 class_diary_student_notes.diary_id = diaryId 조건으로 조인
    const rows = await db.execute(sql`
      SELECT v.id, v.uploaded_by_name, v.created_at, v.file_size, v.class_id,
             v.caption, v.thumbnail_key, v.status, v.student_note_id,
             '/api/videos/' || v.id || '/file' AS file_url
      FROM video_assets_meta v
      WHERE (v.journal_id = ${diaryId} AND v.pool_id = ${poolId})
         OR v.student_note_id IN (
           SELECT id FROM class_diary_student_notes WHERE diary_id = ${diaryId}
         )
      ORDER BY v.created_at ASC
    `);

    const videos = await batchVideoPresign(rows.rows as any[]);
    res.json({ videos, total: videos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── POST /videos/note-attach — 선택 영상 student_note_id 연결 ──────────────────
router.post("/videos/note-attach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { note_id, video_ids } = req.body as { note_id: string; video_ids: string[] };

    if (!note_id || !Array.isArray(video_ids) || video_ids.length === 0) {
      res.status(400).json({ error: "note_id와 video_ids가 필요합니다." }); return;
    }

    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    const literal = `{${video_ids.join(",")}}`;
    const checkRow = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM video_assets_meta
      WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
    `);
    if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== video_ids.length) {
      res.status(403).json({ error: "일부 영상에 대한 접근 권한이 없습니다." }); return;
    }

    await db.execute(sql`
      UPDATE video_assets_meta SET student_note_id = ${note_id}
      WHERE id = ANY(${literal}::text[]) AND pool_id = ${poolId}
    `);

    res.json({ updated: video_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 영상 삭제 ────────────────────────────────────────────────────────
router.delete("/videos/:videoId", requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { videoId } = req.params;
      const { role, userId } = req.user!;

      const rows = await db.execute(sql`SELECT * FROM video_assets_meta WHERE id = ${videoId}`);
      const video = rows.rows[0] as any;
      if (!video) { res.status(404).json({ error: "영상을 찾을 수 없습니다." }); return; }

      if (role === "teacher") {
        if (video.uploaded_by !== userId) {
          res.status(403).json({ error: "자신이 업로드한 영상만 삭제할 수 있습니다." }); return;
        }
      } else if (role === "pool_admin") {
        const poolId = await getUserPoolId(userId);
        if (video.pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      await deleteFromR2(video.object_key, "video");
      // Bug Fix #2: 사용자 직접 삭제 시 thumbnail R2 orphan 방지
      if (video.thumbnail_key) {
        try {
          await deleteFromR2(video.thumbnail_key, "photo");
        } catch (thumbErr) {
          // thumbnail 삭제 실패는 경고만 — main video 삭제는 진행
          console.warn("[video-delete] thumbnail R2 삭제 실패 (무시):", thumbErr);
        }
      }
      await db.execute(sql`DELETE FROM video_assets_meta WHERE id = ${videoId}`);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

export default router;
