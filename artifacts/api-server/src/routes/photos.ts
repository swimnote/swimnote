/**
 * photos.ts — 사진 앨범 API
 *
 * album_type:
 *   "group"   → 반 전체 앨범  (class_id 필수, student_id nullable)
 *   "private" → 개인 앨범     (class_id + student_id 모두 필수)
 *
 * 접근 권한:
 *   super_admin  → 모든 풀
 *   pool_admin   → 자신의 풀만
 *   teacher      → 자신이 담당하는 반의 사진만 업로드/조회
 *   parent_account → 자녀 반 전체 앨범 + 자녀 개인 앨범만
 */
import { Router, Response } from "express";
import multer from "multer";
import { uploadToR2, downloadFromR2, deleteFromR2, getPresignedUrl, getPresignedPutUrl, headObject } from "../lib/objectStorage.js";
import crypto from "crypto";
import {
  signUploadToken,
  verifyUploadToken,
  isSafeClientId,
  validateFileSize,
  validateHeadMetadata,
  extFromMime,
  DIRECT_UPLOAD_MIME_ALLOWLIST,
  MAX_FILES_PER_SESSION,
  SESSION_TTL_SECONDS,
  MAX_CAPTION_LENGTH,
  type UploadSessionPayload,
} from "../lib/directUploadToken.js";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendPushToClassParents, sendPushToUser } from "../lib/push-service.js";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName } from "../utils/filename.js";
import {
  getDiaryPhotos,
  getDraftPhotosForClass,
  attachPhotosToDiary,
  attachPhotosToStudentNote,
  detachPhotosFromDiary,
  canDeleteR2Object,
} from "../services/mediaService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/**
 * 사진/영상 목록에 R2 presigned URL 일괄 추가.
 * expo-image의 네이티브 iOS URLSession은 Replit mTLS 프록시를 신뢰하지 않아
 * Authorization 헤더나 302 redirect 방식이 모두 불가능합니다.
 * 해결책: JS fetch로 받은 목록에 presigned_url을 포함하고,
 * expo-image가 R2에 직접(프록시 없이) 접근하도록 합니다.
 */
async function batchPresign(photos: any[], type: "photo" | "video" = "photo"): Promise<any[]> {
  const CHUNK = 10;
  const result: any[] = [];
  for (let i = 0; i < photos.length; i += CHUNK) {
    const chunk = photos.slice(i, i + CHUNK);
    const signed = await Promise.all(chunk.map(async (p) => {
      if (!p.object_key) return p;
      const { ok, url } = await getPresignedUrl(p.object_key, type, 3600);
      return ok && url ? { ...p, presigned_url: url } : p;
    }));
    result.push(...signed);
  }
  return result;
}


async function getPoolSlug(poolId: string): Promise<string> {
  const rows = await superAdminDb.execute(sql`SELECT name_en, name FROM swimming_pools WHERE id = ${poolId}`);
  const pool = rows.rows[0] as any;
  return pool?.name_en || sanitizePoolName(pool?.name || "pool");
}

/** 저장공간 실시간 체크 — 100% 초과 시 upload_blocked 자동 설정, 여유 시 자동 해제 */
async function checkStorageLimit(poolId: string): Promise<{ blocked: boolean; pct: number }> {
  const [meta] = (await superAdminDb.execute(sql`
    SELECT p.upload_blocked, p.is_readonly, p.extra_storage_gb,
           COALESCE(sp.storage_gb, 0.5) AS storage_gb
    FROM swimming_pools p
    LEFT JOIN pool_subscriptions ps ON ps.swimming_pool_id = p.id AND ps.status = 'active'
    LEFT JOIN subscription_plans sp ON sp.tier = COALESCE(ps.tier, 'free')
    WHERE p.id = ${poolId} LIMIT 1
  `)).rows as any[];

  const [usage] = (await db.execute(sql`
    SELECT COALESCE(SUM(file_size), 0) AS used_bytes
    FROM photo_assets_meta
    WHERE pool_id = ${poolId}
      AND is_clone = false
  `)).rows as any[];
  const quotaBytes = (Number(meta?.storage_gb ?? 0.5) + Number(meta?.extra_storage_gb ?? 0)) * 1024 ** 3;
  const usedBytes  = Number(usage?.used_bytes ?? 0);
  const pct = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;

  if (pct >= 100) {
    await superAdminDb.execute(sql`UPDATE swimming_pools SET upload_blocked = true WHERE id = ${poolId}`);
    return { blocked: true, pct };
  }
  // 용량 여유 있으면 upload_blocked 자동 해제 (is_readonly 인 경우는 유지)
  if (meta?.upload_blocked && !meta?.is_readonly) {
    await superAdminDb.execute(sql`UPDATE swimming_pools SET upload_blocked = false WHERE id = ${poolId}`);
  }
  return { blocked: false, pct };
}

// ── 권한 헬퍼 ──────────────────────────────────────────────────────────

/** teacher가 해당 class를 담당하는지 확인 */
async function teacherOwnsClass(teacherUserId: string, classId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM class_groups WHERE id = ${classId} AND teacher_user_id = ${teacherUserId}
  `);
  return rows.rows.length > 0;
}

/** parent가 해당 student에 연결되어 있는지 확인 (approved) */
async function parentOwnsStudent(parentAccountId: string, studentId: string): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM parent_students
    WHERE parent_id = ${parentAccountId} AND student_id = ${studentId} AND status = 'approved'
  `);
  return rows.rows.length > 0;
}

/** student의 class_id 조회 */
async function getStudentClassId(studentId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT class_group_id FROM students WHERE id = ${studentId}`);
  return (rows.rows[0] as any)?.class_group_id || null;
}

/** teacher의 pool_id 조회 */
async function getUserPoolId(userId: string): Promise<string | null> {
  const rows = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

/** parent의 pool_id 조회 */
async function getParentPoolId(parentAccountId: string): Promise<string | null> {
  const rows = await db.execute(sql`SELECT swimming_pool_id FROM parent_accounts WHERE id = ${parentAccountId}`);
  return (rows.rows[0] as any)?.swimming_pool_id || null;
}

// ── 사진 파일 스트리밍 (인증 + 권한 검사) ────────────────────────────
router.get("/photos/:photoId/file", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { photoId } = req.params;
    const { role, userId } = req.user!;

    const rows = await db.execute(sql`
      SELECT sp.*, s.class_group_id AS student_class_id
      FROM photo_assets_meta sp
      LEFT JOIN students s ON s.id = sp.student_id
      WHERE sp.id = ${photoId}
    `);
    const photo = rows.rows[0] as any;
    if (!photo) { res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return; }
    if (photo.media_status === "uploading") {
      res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return;
    }

    // 권한 검사
    if (role === "parent_account") {
      if (photo.album_type === "group") {
        // 자녀가 해당 반에 속해 있어야 함
        const childRows = await db.execute(sql`
          SELECT s.id FROM students s
          JOIN parent_students ps ON ps.student_id = s.id
          WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
            AND s.class_group_id = ${photo.class_id}
        `);
        if (!childRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      } else {
        // private: 자녀 본인 사진만
        const ok = await parentOwnsStudent(userId, photo.student_id);
        if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }
    } else if (role === "teacher") {
      const classId = photo.class_id || photo.student_class_id;
      if (classId) {
        const ok = await teacherOwnsClass(userId, classId);
        if (!ok) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      if (photo.pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }
    // super_admin: 통과

    const { ok, url, error } = await getPresignedUrl(photo.object_key, "photo", 3600);
    if (!ok || !url) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    res.setHeader("Cache-Control", "private, max-age=3600");
    res.redirect(302, url);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 반 전체 앨범 조회 ──────────────────────────────────────────────────
router.get("/photos/group/:classId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { classId } = req.params;
    const { role, userId } = req.user!;

    if (role === "teacher") {
      const ok = await teacherOwnsClass(userId, classId);
      if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
    } else if (role === "parent_account") {
      // 자녀가 해당 반에 속해야 함
      const childRows = await db.execute(sql`
        SELECT s.id, s.class_group_id FROM students s
        JOIN parent_students ps ON ps.student_id = s.id
        WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
          AND s.class_group_id = ${classId}
      `);
      // 진단: approved 상태인 전체 자녀 목록도 로그
      const allChildren = await db.execute(sql`
        SELECT s.id, s.name, s.class_group_id FROM students s
        JOIN parent_students ps ON ps.student_id = s.id
        WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
      `);
      console.log(`[photos/GET] parent=${userId} classId=${classId} matched=${childRows.rows.length} allChildren=${JSON.stringify(allChildren.rows.map((r:any)=>({id:r.id,cg:r.class_group_id})))}`);
      if (!childRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    } else if (role === "pool_admin") {
      const poolId = await getUserPoolId(userId);
      const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${classId} AND swimming_pool_id = ${poolId}`);
      if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
    }
    // super_admin: 통과

    const { date } = req.query;

    // 학부모: attached 사진만 (삭제된 일지 제외, media_status='attached' 필수)
    if (role === "parent_account") {
      const rows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
               sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at,
               sp.lesson_date, sp.file_size, sp.object_key,
               s.name AS student_name
        FROM photo_assets_meta sp
        LEFT JOIN students s ON s.id = sp.student_id
        WHERE sp.class_id = ${classId}
          AND sp.media_status = 'attached'
          AND (
            (
              sp.journal_id IS NOT NULL
              ${date ? sql`AND sp.journal_id IN (
                SELECT id FROM class_diaries
                WHERE class_group_id = ${classId} AND lesson_date = ${date as string}
                  AND is_deleted = false
              )` : sql`AND sp.journal_id IN (SELECT id FROM class_diaries WHERE is_deleted = false)`}
            )
            OR (
              sp.student_note_id IS NOT NULL
              ${date ? sql`AND sp.student_note_id IN (
                SELECT csn.id FROM class_diary_student_notes csn
                JOIN class_diaries cd ON cd.id = csn.diary_id AND cd.is_deleted = false
                WHERE cd.class_group_id = ${classId} AND cd.lesson_date = ${date as string}
                  AND csn.is_deleted = false
              )` : sql`AND sp.student_note_id IN (
                SELECT csn.id FROM class_diary_student_notes csn
                JOIN class_diaries cd ON cd.id = csn.diary_id AND cd.is_deleted = false
                WHERE csn.is_deleted = false
              )`}
            )
          )
        ORDER BY sp.created_at DESC
      `);
      const photos = await batchPresign(
        (rows.rows as any[]).map(p => ({ ...p, file_url: `/api/photos/${p.id}/file` }))
      );
      return res.json(photos);
    }

    // Media Engine v2: attached 사진과 draft 사진을 분리 조회 (OR 혼용 금지)
    // attached: journal_id 기준 + is_deleted=false JOIN (버그 1 수정)
    // draft: class_id + lesson_date + media_status='draft' (Reservation 시스템)
    const dateStr = date as string | undefined;
    let allPhotos: any[] = [];

    // 1. attached 사진 — 일지에 연결된 사진
    const attachedRows = await db.execute(sql`
      SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
             sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at,
             sp.lesson_date, sp.file_size, sp.object_key, sp.media_status,
             s.name AS student_name
      FROM photo_assets_meta sp
      JOIN class_diaries cd ON cd.id = sp.journal_id AND cd.is_deleted = false
      LEFT JOIN students s ON s.id = sp.student_id
      WHERE cd.class_group_id = ${classId}
        AND sp.media_status = 'attached'
        ${dateStr ? sql`AND cd.lesson_date = ${dateStr}` : sql``}
      ORDER BY sp.created_at DESC
    `);
    allPhotos = allPhotos.concat(attachedRows.rows as any[]);

    // 2. draft 사진 — 업로드됐지만 아직 일지 미연결 (Reservation 후보)
    if (dateStr) {
      const draftRows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
               sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at,
               sp.lesson_date, sp.file_size, sp.object_key, sp.media_status,
               s.name AS student_name
        FROM photo_assets_meta sp
        LEFT JOIN students s ON s.id = sp.student_id
        WHERE sp.class_id = ${classId}
          AND sp.media_status = 'draft'
          AND sp.journal_id IS NULL
          AND (
            sp.lesson_date = ${dateStr}
            OR (sp.lesson_date IS NULL AND DATE(sp.created_at AT TIME ZONE 'Asia/Seoul') = ${dateStr}::date)
          )
        ORDER BY sp.created_at DESC
      `);
      allPhotos = allPhotos.concat(draftRows.rows as any[]);
    }

    // mediaUuid(id) 기준 중복 제거
    const seenIds = new Set<string>();
    const uniquePhotos = allPhotos.filter(p => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    uniquePhotos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const photos = await batchPresign(
      uniquePhotos.map(p => ({ ...p, file_url: `/api/photos/${p.id}/file` }))
    );
    res.json(photos);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인 앨범 조회 ────────────────────────────────────────────────────
router.get("/photos/private/:studentId", requireAuth, async (req: AuthRequest, res: Response) => {
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

    const { date } = req.query;
    const rows = await db.execute(sql`
      SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
             sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at, sp.file_size,
             sp.object_key, sp.lesson_date, s.name AS student_name
      FROM photo_assets_meta sp
      LEFT JOIN students s ON s.id = sp.student_id
      WHERE sp.album_type = 'private' AND sp.student_id = ${studentId}
      AND sp.media_status <> 'uploading'
      ${date ? sql`AND (
        (sp.lesson_date IS NOT NULL AND sp.lesson_date = ${date as string})
        OR (sp.lesson_date IS NULL AND DATE(sp.created_at AT TIME ZONE 'Asia/Seoul') = ${date as string})
      )` : sql``}
      ORDER BY sp.created_at DESC
    `);
    const photos = await batchPresign(
      (rows.rows as any[]).map(p => ({ ...p, file_url: `/api/photos/${p.id}/file` }))
    );
    res.json(photos);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 반 전체 앨범 업로드 ────────────────────────────────────────────────
router.post(
  "/photos/group",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 100),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, lesson_date } = req.body;
      // class_id는 선택사항 — 전체앨범은 반 선택 없이 업로드 가능

      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }

      const { role, userId } = req.user!;
      console.log(`[photos/group] 업로드 시작: userId=${userId} role=${role} class_id=${class_id ?? "없음"} files=${files.length}`);

      // teacher: class_id가 있을 때만 담당 반 확인
      if (role === "teacher" && class_id) {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      console.log(`[photos/group] 사용자 정보 조회 중...`);
      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }
      console.log(`[photos/group] user 확인: pool_id=${user.swimming_pool_id}`);

      // pool_admin: class_id가 있을 때만 반 소속 확인
      if (role === "pool_admin" && class_id) {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      // ── 저장공간 실시간 체크 ────────────────────────────────────────
      if (user.swimming_pool_id) {
        console.log(`[photos/group] 저장공간 체크 중...`);
        const { blocked, pct } = await checkStorageLimit(user.swimming_pool_id);
        if (blocked) {
          res.status(403).json({ error: "저장공간이 가득 차 업로드가 제한됩니다.", code: "UPLOAD_BLOCKED", storage_pct: pct }); return;
        }
        if (pct >= 80) res.setHeader("X-Storage-Pct", `${pct}`);
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id || "");
      console.log(`[photos/group] R2 업로드 시작 (${files.length}개)...`);
      const inserted: any[] = [];

      for (const file of files) {
        const ext = file.originalname.split(".").pop() || "jpg";
        const filename = genFilename(poolSlug, ext);
        // class_id가 있으면 반별 경로, 없으면 풀 전체 경로
        const key = class_id
          ? `photos/group/${class_id}/${filename}`
          : `photos/pool/${user.swimming_pool_id}/${filename}`;
        console.log(`[photos/group] R2 업로드: key=${key} size=${file.size}`);
        const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "image/jpeg", "photo");
        if (!ok) {
          console.error(`[photos/group] R2 업로드 실패:`, error);
          throw new Error(error || "스토리지 업로드 실패");
        }
        console.log(`[photos/group] 스토리지 업로드 완료, DB INSERT 중...`);

        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const rows = await db.execute(sql`
          INSERT INTO photo_assets_meta
            (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id, lesson_date, media_status)
          VALUES
            (${id}, NULL, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'group', ${class_id || null}, ${lesson_date || null}, 'draft')
          RETURNING *
        `);
        console.log(`[photos/group] DB INSERT 완료: id=${id}`);
        inserted.push({ ...rows.rows[0], file_url: `/api/photos/${id}/file` });
      }

      // class_id가 있을 때만 학부모 푸시 발송
      if (inserted.length > 0 && class_id) {
        const pSettings = await db.execute(sql`
          SELECT COALESCE(tpl_photo, '새 사진이 업로드되었습니다.') AS tpl
          FROM pool_push_settings WHERE pool_id = ${user.swimming_pool_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        const tpl = (pSettings.rows[0] as any)?.tpl ?? "새 사진이 업로드되었습니다.";
        sendPushToClassParents(
          class_id,
          "photo_upload",
          "새 사진이 올라왔어요",
          tpl,
          { type: "photo_upload", classId: class_id },
          `photo_group_${class_id}_${Date.now()}`,
          true,
          { subtitle: "SwimNote", channelId: "photo_upload" }
        ).catch(() => {});
      }

      res.status(201).json({ count: inserted.length, photos: inserted });
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 최대 8MB까지 업로드할 수 있습니다." }); return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 개인 앨범 업로드 ──────────────────────────────────────────────────
router.post(
  "/photos/private",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 100),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, student_id } = req.body;
      if (!class_id || !student_id) {
        res.status(400).json({ error: "반과 학생을 선택해주세요." }); return;
      }

      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }

      const { role, userId } = req.user!;

      // teacher는 담당 반만
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      // student가 실제로 해당 class에 속하는지 검증
      const studentRows = await db.execute(sql`
        SELECT id, name FROM students WHERE id = ${student_id} AND class_group_id = ${class_id}
      `);
      if (!studentRows.rows.length) {
        res.status(400).json({ error: "해당 반에 소속된 학생이 아닙니다." }); return;
      }

      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (role === "pool_admin") {
        const classRows = await db.execute(sql`SELECT id FROM class_groups WHERE id = ${class_id} AND swimming_pool_id = ${user.swimming_pool_id}`);
        if (!classRows.rows.length) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      // ── 저장공간 실시간 체크 ────────────────────────────────────────
      if (user.swimming_pool_id) {
        const { blocked, pct } = await checkStorageLimit(user.swimming_pool_id);
        if (blocked) {
          res.status(403).json({ error: "저장공간이 가득 차 업로드가 제한됩니다.", code: "UPLOAD_BLOCKED", storage_pct: pct }); return;
        }
        if (pct >= 80) res.setHeader("X-Storage-Pct", `${pct}`);
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id || "");
      const inserted: any[] = [];

      for (const file of files) {
        const ext = file.originalname.split(".").pop() || "jpg";
        const filename = genFilename(poolSlug, ext);
        const key = `photos/private/${student_id}/${filename}`;
        const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "image/jpeg", "photo");
        if (!ok) throw new Error(error || "업로드 실패");

        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const rows = await db.execute(sql`
          INSERT INTO photo_assets_meta
            (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id, media_status)
          VALUES
            (${id}, ${student_id}, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'private', ${class_id}, 'draft')
          RETURNING *
        `);
        inserted.push({ ...rows.rows[0], file_url: `/api/photos/${id}/file` });
      }

      // 개인 앨범 업로드 → 해당 학생 학부모에게 푸시 알림
      if (inserted.length > 0) {
        const pSettings = await db.execute(sql`
          SELECT COALESCE(tpl_photo, '새 사진이 업로드되었습니다.') AS tpl
          FROM pool_push_settings WHERE pool_id = ${user.swimming_pool_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        const tpl = (pSettings.rows[0] as any)?.tpl ?? "새 사진이 업로드되었습니다.";
        const parentRows = await db.execute(sql`
          SELECT parent_id AS parent_account_id FROM parent_students
          WHERE student_id = ${student_id} AND status = 'approved'
        `).catch(() => ({ rows: [] }));
        for (const p of parentRows.rows as any[]) {
          sendPushToUser(p.parent_account_id, true, "photo_upload", "사진 업로드", tpl,
            { type: "photo", studentId: student_id }, `photo_private_${student_id}_${Date.now()}`
          ).catch(() => {});
        }
      }

      res.status(201).json({ count: inserted.length, photos: inserted });
    } catch (err) {
      console.error(err);
      const msg = (err as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 최대 8MB까지 업로드할 수 있습니다." }); return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 일괄 개인 앨범 업로드 (사진 1장 → 복수 학생) ─────────────────────────
router.post(
  "/photos/batch",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 1),
  async (req: AuthRequest, res: Response) => {
    try {
      const { student_ids } = req.body;
      if (!student_ids) { res.status(400).json({ error: "학생을 선택해주세요." }); return; }

      let ids: string[];
      try { ids = JSON.parse(student_ids); } catch { res.status(400).json({ error: "student_ids 형식 오류" }); return; }
      if (!ids.length) { res.status(400).json({ error: "학생을 선택해주세요." }); return; }

      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }
      const file = files[0];

      const { userId } = req.user!;
      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      if (user.swimming_pool_id) {
        const { blocked } = await checkStorageLimit(user.swimming_pool_id);
        if (blocked) { res.status(403).json({ error: "저장공간이 가득 차 업로드가 제한됩니다.", code: "UPLOAD_BLOCKED" }); return; }
      }

      const poolSlug = await getPoolSlug(user.swimming_pool_id || "");
      const ext = file.originalname.split(".").pop() || "jpg";
      const filename = genFilename(poolSlug, ext);
      const r2Key = `photos/batch/${user.swimming_pool_id}/${filename}`;
      const { ok, error } = await uploadToR2(r2Key, file.buffer, file.mimetype || "image/jpeg", "photo");
      if (!ok) throw new Error(error || "업로드 실패");

      const inserted: any[] = [];
      for (const student_id of ids) {
        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const rows = await db.execute(sql`
          INSERT INTO photo_assets_meta
            (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, media_status)
          VALUES
            (${id}, ${student_id}, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${r2Key}, ${file.size}, 'private', 'draft')
          RETURNING *
        `);
        inserted.push({ ...rows.rows[0], file_url: `/api/photos/${id}/file` });

        const parentRows = await db.execute(sql`
          SELECT parent_id AS parent_account_id FROM parent_students
          WHERE student_id = ${student_id} AND status = 'approved'
        `).catch(() => ({ rows: [] }));
        for (const p of parentRows.rows as any[]) {
          sendPushToUser(p.parent_account_id, true, "photo_upload", "사진 업로드", "새 사진이 업로드되었습니다.",
            { type: "photo", studentId: student_id }, `photo_batch_${student_id}_${Date.now()}`
          ).catch(() => {});
        }
      }

      res.status(201).json({ count: inserted.length });
    } catch (err) {
      console.error("[photos/batch]", err);
      const msg = (err as any)?.message || "";
      if (msg.includes("LIMIT_FILE_SIZE")) {
        res.status(413).json({ error: "파일 크기 초과: 최대 8MB까지 업로드할 수 있습니다." }); return;
      }
      res.status(500).json({ error: "업로드 중 오류" });
    }
  }
);

// ── 선생님: 전체앨범(pool-wide) / 개인앨범(saved) 목록 ───────────────────
router.get("/photos/teacher-all", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const scope = (req.query.scope as string) || "group";

    let photos: any[];
    if (scope === "group") {
      // 전체앨범 = pool 전체 사진 (class 무관)
      // Issue 3 Fix: 삭제된 일지에 연결된 사진을 'draft'로 반환 (picker와 동일 로직)
      const poolId = await getUserPoolId(userId);
      if (!poolId) { res.json({ photos: [], total: 0 }); return; }
      const rows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.uploaded_by_name,
               sp.caption, sp.created_at, sp.file_size, sp.object_key,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN 'draft'
                 ELSE sp.media_status
               END AS media_status,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN NULL
                 ELSE sp.journal_id
               END AS journal_id,
               '/api/photos/' || sp.id || '/file' AS file_url,
               cg.name AS class_name, cg.schedule_days, cg.schedule_time
        FROM photo_assets_meta sp
        LEFT JOIN class_groups cg ON cg.id = sp.class_id
        LEFT JOIN class_diaries cd_j ON cd_j.id = sp.journal_id
        LEFT JOIN class_diary_student_notes csn ON csn.id = sp.student_note_id
        LEFT JOIN class_diaries cd_sn ON cd_sn.id = csn.diary_id
        WHERE sp.album_type = 'group'
          AND sp.pool_id = ${poolId}
          AND sp.media_status <> 'uploading'
        ORDER BY sp.created_at DESC
      `);
      photos = await batchPresign(rows.rows as any[]);
    } else {
      // 개인앨범 = teacher_saved_photos 에서 가져옴
      const rows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.uploaded_by_name,
               sp.caption, sp.created_at, sp.file_size, sp.object_key,
               sp.media_status, sp.journal_id,
               '/api/photos/' || sp.id || '/file' AS file_url,
               cg.name AS class_name, cg.schedule_days, cg.schedule_time,
               tsp.created_at AS saved_at
        FROM teacher_saved_photos tsp
        JOIN photo_assets_meta sp ON sp.id = tsp.photo_id
        LEFT JOIN class_groups cg ON cg.id = sp.class_id
        WHERE tsp.teacher_id = ${userId}
          AND sp.media_status <> 'uploading'
        ORDER BY tsp.created_at DESC
      `);
      photos = await batchPresign(rows.rows as any[]);
    }

    res.json({ photos, total: photos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범 저장 목록 조회 ─────────────────────────────────────────────
router.get("/photos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const rows = await db.execute(sql`
      SELECT sp.id, sp.album_type, sp.class_id, sp.uploaded_by_name,
             sp.caption, sp.created_at, sp.file_size,
             '/api/photos/' || sp.id || '/file' AS file_url,
             cg.name AS class_name
      FROM teacher_saved_photos tsp
      JOIN photo_assets_meta sp ON sp.id = tsp.photo_id
      LEFT JOIN class_groups cg ON cg.id = sp.class_id
      WHERE tsp.teacher_id = ${userId}
        AND sp.media_status <> 'uploading'
      ORDER BY tsp.created_at DESC
    `);
    const photos = rows.rows as any[];
    res.json({ photos, total: photos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범에 사진 저장 (즐겨찾기 추가) ──────────────────────────────────
router.post("/photos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { photo_ids } = req.body as { photo_ids: string[] };
    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      res.status(400).json({ error: "photo_ids가 필요합니다." }); return;
    }
    const poolId = await getUserPoolId(userId);
    // pool 소속 검증 (drizzle sql 배열 바인딩 우회: PG array literal 형식 사용)
    const photoIdsLiteral = `{${photo_ids.join(',')}}`;
    const checkRow = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
      WHERE id = ANY(${photoIdsLiteral}::text[])
        AND pool_id = ${poolId}
        AND media_status <> 'uploading'
    `);
    if (Number((checkRow.rows[0] as any)?.cnt ?? 0) !== photo_ids.length) {
      res.status(403).json({ error: "일부 사진에 대한 접근 권한이 없습니다." }); return;
    }
    for (const photoId of photo_ids) {
      const saveId = `save_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      await db.execute(sql`
        INSERT INTO teacher_saved_photos (id, teacher_id, photo_id)
        VALUES (${saveId}, ${userId}, ${photoId})
        ON CONFLICT (teacher_id, photo_id) DO NOTHING
      `);
    }
    res.json({ success: true, saved: photo_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 개인앨범에서 사진 제거 (파일 삭제 아님) ───────────────────────────────
router.delete("/photos/saved", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids가 필요합니다." }); return;
    }
    for (const photoId of ids) {
      await db.execute(sql`
        DELETE FROM teacher_saved_photos
        WHERE teacher_id = ${userId} AND photo_id = ${photoId}
      `);
    }
    res.json({ success: true, deleted: ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 사진 대량 삭제 (teacher: 자신이 올린 것, admin: 풀 내 모두) ──────────
router.delete("/photos/bulk", requireAuth, requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { ids } = req.body as { ids: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "삭제할 사진 ID를 지정해주세요." }); return;
      }
      const { role, userId } = req.user!;
      let deletedCount = 0;
      for (const id of ids) {
        const rows = await db.execute(sql`
          SELECT * FROM photo_assets_meta
          WHERE id = ${id}
            AND media_status <> 'uploading'
        `);
        const photo = rows.rows[0] as any;
        if (!photo) continue;
        if (role === "teacher" && photo.uploaded_by !== userId) continue;
        // clone row거나 object_key를 공유하는 sibling이 있으면 R2 파일은 유지
        const okToDeleteR2 = await canDeleteR2Object(id, photo.object_key, photo.pool_id);
        if (okToDeleteR2) {
          await deleteFromR2(photo.object_key, "photo");
        }
        await db.execute(sql`DELETE FROM photo_assets_meta WHERE id = ${id}`);
        deletedCount++;
      }
      res.json({ success: true, deleted: deletedCount });
    } catch (e) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

// ── 부모: 자녀 전체 앨범 — 반 전체 + 개별 통합 flat 목록 + source_label ─
router.get("/photos/parent-view", requireAuth, requireRole("parent_account"), async (req: AuthRequest, res: Response) => {
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

    const photoMap = new Map<string, any>();

    for (const child of children) {
      // 반 전체 사진: 일지(journal_id)에 연결된 것만, 등록 기간 내만
      if (child.class_group_id) {
        const groupRows = (await db.execute(sql`
          SELECT sp.id, sp.album_type, sp.class_id, sp.student_id,
                 sp.uploaded_by_name, sp.caption, sp.created_at,
                 sp.journal_id,
                 '/api/photos/' || sp.id || '/file' AS file_url,
                 cd.lesson_date,
                 cg.name AS class_name, cg.schedule_days, cg.schedule_time
          FROM photo_assets_meta sp
          JOIN class_diaries cd ON cd.id = sp.journal_id AND cd.is_deleted = false
          JOIN class_groups cg ON cg.id = cd.class_group_id
          JOIN student_class_history sch
            ON sch.class_group_id = cd.class_group_id
            AND sch.student_id = ${child.id}
            AND sch.enrolled_at <= cd.lesson_date::date
            AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
          WHERE sp.album_type = 'group'
            AND sp.media_status = 'attached'
            AND cd.class_group_id = ${child.class_group_id}
          ORDER BY cd.lesson_date DESC, sp.created_at DESC LIMIT 200
        `)).rows as any[];
        for (const row of groupRows) {
          if (!photoMap.has(row.id)) {
            const source_label = row.caption ||
              (row.schedule_days && row.schedule_time
                ? `${row.schedule_days.split(",")[0]} ${row.schedule_time}반 사진`
                : row.class_name ? `${row.class_name} 반 전체 사진` : "반 전체 사진");
            photoMap.set(row.id, { ...row, source_label });
          }
        }
      }

      // 개별 사진: student_note_id에 연결된 것만, 등록 기간 내만
      const privRows = (await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id,
               sp.uploaded_by_name, sp.caption, sp.created_at,
               sp.journal_id,
               '/api/photos/' || sp.id || '/file' AS file_url,
               s.name AS student_name,
               cd.lesson_date
        FROM photo_assets_meta sp
        LEFT JOIN students s ON s.id = sp.student_id
        JOIN class_diary_student_notes csn ON csn.id = sp.student_note_id AND csn.is_deleted = false
        JOIN class_diaries cd ON cd.id = csn.diary_id AND cd.is_deleted = false
        JOIN student_class_history sch
          ON sch.class_group_id = cd.class_group_id
          AND sch.student_id = ${child.id}
          AND sch.enrolled_at <= cd.lesson_date::date
          AND (sch.left_at IS NULL OR sch.left_at > cd.lesson_date::date)
        WHERE sp.album_type = 'private'
          AND sp.media_status = 'attached'
          AND sp.student_id = ${child.id}
        ORDER BY cd.lesson_date DESC, sp.created_at DESC LIMIT 200
      `)).rows as any[];
      for (const row of privRows) {
        if (!photoMap.has(row.id)) {
          const source_label = row.caption ||
            `${row.student_name || child.name || "학생"} 개별 사진`;
          photoMap.set(row.id, { ...row, source_label });
        }
      }
    }

    const photos = Array.from(photoMap.values())
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    res.json({ photos, total: photos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 사진 삭제 (teacher: 자신이 올린 것만, admin: 풀 내 모두) ──────────
router.delete("/photos/:photoId", requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { photoId } = req.params;
      const { role, userId } = req.user!;

      const rows = await db.execute(sql`
        SELECT * FROM photo_assets_meta
        WHERE id = ${photoId}
          AND media_status <> 'uploading'
      `);
      const photo = rows.rows[0] as any;
      if (!photo) { res.status(404).json({ error: "사진을 찾을 수 없습니다." }); return; }

      if (role === "teacher") {
        if (photo.uploaded_by !== userId) {
          res.status(403).json({ error: "자신이 업로드한 사진만 삭제할 수 있습니다." }); return;
        }
      } else if (role === "pool_admin") {
        const poolId = await getUserPoolId(userId);
        if (photo.pool_id !== poolId) { res.status(403).json({ error: "접근 권한이 없습니다." }); return; }
      }

      // clone row거나 object_key를 공유하는 sibling이 있으면 R2 파일은 유지
      const okToDeleteR2 = await canDeleteR2Object(photoId, photo.object_key, photo.pool_id);
      if (okToDeleteR2) {
        await deleteFromR2(photo.object_key, "photo");
      }
      await db.execute(sql`DELETE FROM photo_assets_meta WHERE id = ${photoId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

// ── GET /photos/picker — 일지 작성용 전체앨범 사진 조회 ───────────────────────
router.get("/photos/picker", requireAuth, requireRole("teacher", "pool_admin", "sub_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    let photos: any[];

    if (role === "teacher") {
      // 본인 담당 반 사진 + 수영장 공용(class_id=null) 사진 모두 포함
      // ⚠️ Issue 2/3 Fix: 삭제된 일지에 연결된 사진을 'attached'로 오진하지 않도록
      //    cd_j(journal_id 경유) + cd_sn(student_note_id 경유) LEFT JOIN으로
      //    일지 is_deleted 상태를 확인 → 삭제된 일지 사진은 'draft'(사용 가능)로 반환
      const poolId = await getUserPoolId(userId);
      const rows = await db.execute(sql`
        SELECT sp.id, sp.class_id, sp.uploaded_by_name, sp.created_at, sp.file_size, sp.object_key,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN 'draft'
                 ELSE sp.media_status
               END AS media_status,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN NULL
                 ELSE sp.journal_id
               END AS journal_id,
               '/api/photos/' || sp.id || '/file' AS file_url,
               cg.name AS class_name
        FROM photo_assets_meta sp
        LEFT JOIN class_groups cg ON cg.id = sp.class_id
        LEFT JOIN class_diaries cd_j ON cd_j.id = sp.journal_id
        LEFT JOIN class_diary_student_notes csn ON csn.id = sp.student_note_id
        LEFT JOIN class_diaries cd_sn ON cd_sn.id = csn.diary_id
        WHERE sp.album_type = 'group'
          AND (
            (sp.class_id IS NOT NULL AND cg.teacher_user_id = ${userId})
            OR
            (sp.class_id IS NULL AND sp.pool_id = ${poolId})
          )
        ORDER BY sp.created_at DESC
      `);
      photos = await batchPresign(rows.rows as any[]);
    } else if (role === "super_admin") {
      photos = [];
    } else {
      const poolId = await getUserPoolId(userId);
      if (!poolId) { res.json({ photos: [], total: 0 }); return; }
      // pool_admin도 동일하게 삭제된 일지 사진을 'draft'로 반환
      const rows = await db.execute(sql`
        SELECT sp.id, sp.class_id, sp.uploaded_by_name, sp.created_at, sp.file_size, sp.object_key,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN 'draft'
                 ELSE sp.media_status
               END AS media_status,
               CASE
                 WHEN sp.media_status = 'attached' AND (
                   (sp.journal_id IS NOT NULL AND COALESCE(cd_j.is_deleted, false) = true)
                   OR (sp.student_note_id IS NOT NULL AND COALESCE(cd_sn.is_deleted, false) = true)
                 ) THEN NULL
                 ELSE sp.journal_id
               END AS journal_id,
               '/api/photos/' || sp.id || '/file' AS file_url,
               cg.name AS class_name
        FROM photo_assets_meta sp
        LEFT JOIN class_groups cg ON cg.id = sp.class_id
        LEFT JOIN class_diaries cd_j ON cd_j.id = sp.journal_id
        LEFT JOIN class_diary_student_notes csn ON csn.id = sp.student_note_id
        LEFT JOIN class_diaries cd_sn ON cd_sn.id = csn.diary_id
        WHERE sp.album_type = 'group'
          AND sp.pool_id = ${poolId}
        ORDER BY sp.created_at DESC
      `);
      photos = await batchPresign(rows.rows as any[]);
    }

    res.json({ photos, total: photos.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── POST /photos/diary-attach — 선택 사진 일지 연결 (MediaService 경유) ────────
router.post("/photos/diary-attach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { diary_id, photo_ids } = req.body as { diary_id: string; photo_ids: string[] };

    console.log(`[diary-attach] START userId=${userId} diary_id=${diary_id} photo_ids=${JSON.stringify(photo_ids)}`);

    if (!diary_id || !Array.isArray(photo_ids)) {
      console.log(`[diary-attach] INVALID PARAMS diary_id=${diary_id}`);
      res.status(400).json({ error: "diary_id와 photo_ids가 필요합니다." }); return;
    }
    if (photo_ids.length === 0) { res.json({ updated: 0 }); return; }
    if (photo_ids.length > 20) {
      res.status(400).json({ error: "한 번에 최대 20장까지 연결할 수 있습니다." }); return;
    }

    const poolId = await getUserPoolId(userId);
    console.log(`[diary-attach] poolId=${poolId} for userId=${userId}`);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    // diary 존재 여부 직접 확인 (디버깅)
    const diaryCheckRow = await db.execute(sql`
      SELECT id, swimming_pool_id, is_deleted FROM class_diaries WHERE id = ${diary_id} LIMIT 1
    `);
    const diaryCheck = diaryCheckRow.rows[0] as any;
    console.log(`[diary-attach] DB diary check: found=${!!diaryCheck} id=${diaryCheck?.id} swimming_pool_id=${diaryCheck?.swimming_pool_id} is_deleted=${diaryCheck?.is_deleted}`);
    console.log(`[diary-attach] poolId match: diary.swimming_pool_id=${diaryCheck?.swimming_pool_id} === token poolId=${poolId} → ${diaryCheck?.swimming_pool_id === poolId}`);

    // 기존 연결 사진 수 확인 (최대 20장 제한)
    const existingRow = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM photo_assets_meta
      WHERE journal_id = ${diary_id} AND pool_id = ${poolId} AND media_status = 'attached'
    `);
    const existing = Number((existingRow.rows[0] as any)?.cnt ?? 0);
    if (existing + photo_ids.length > 20) {
      res.status(400).json({ error: `최대 20장까지 연결할 수 있습니다. 현재 ${existing}장 연결됨.` }); return;
    }

    const results = await attachPhotosToDiary(diary_id, photo_ids, poolId);
    const attached = results.filter(r => r.action === "attached").length;
    const cloned = results.filter(r => r.action === "cloned").length;
    const alreadyAttached = results.filter(r => r.action === "already_attached").length;
    const failed = results.filter(r => r.action === "not_found" || r.action === "failed").length;
    console.log(`[diary-attach] SUCCESS diary_id=${diary_id} attached=${attached} cloned=${cloned} alreadyAttached=${alreadyAttached} failed=${failed}`);
    res.json({
      success: failed === 0,
      requested: photo_ids.length,
      attached,
      cloned,
      alreadyAttached,
      failed,
      results,
    });
  } catch (err: any) {
    console.error(`[diary-attach] ERROR:`, err.message);
    if (err.message?.includes("찾을 수 없") || err.message?.includes("권한")) {
      res.status(400).json({ error: err.message }); return;
    }
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /photos/diary-detach — 사진 일지 분리 (MediaService 경유) ────────────
router.post("/photos/diary-detach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { photo_ids } = req.body as { photo_ids: string[] };

    if (!Array.isArray(photo_ids) || photo_ids.length === 0) {
      res.status(400).json({ error: "photo_ids가 필요합니다." }); return;
    }

    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    await detachPhotosFromDiary(photo_ids, poolId);
    res.json({ updated: photo_ids.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── GET /photos/diary/:diaryId — 일지 연결 사진 목록 (MediaService 경유) ─────
router.get("/photos/diary/:diaryId", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { diaryId } = req.params;

    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.json({ photos: [], total: 0 }); return; }

    const result = await getDiaryPhotos(diaryId, poolId);
    const allPhotos = [...result.common, ...result.individual];
    const presigned = await batchPresign(allPhotos);
    res.json({ photos: presigned, total: presigned.length, common: result.common.length, individual: result.individual.length });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── GET /photos/draft — Reservation draft 사진 목록 (일지 작성 화면 후보) ────
router.get("/photos/draft", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const { class_id, lesson_date } = req.query as { class_id?: string; lesson_date?: string };

    if (!class_id || !lesson_date) {
      res.status(400).json({ error: "class_id와 lesson_date가 필요합니다." }); return;
    }

    const poolId = await getUserPoolId(userId);
    if (!poolId) { res.json([]); return; }

    if (role === "teacher") {
      const ok = await teacherOwnsClass(userId, class_id);
      if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
    }

    const draftPhotos = await getDraftPhotosForClass(class_id, lesson_date, poolId);
    const presigned = await batchPresign(draftPhotos);
    res.json(presigned);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 사진 일괄 정리 미리보기 ───────────────────────────────────────────────────
// GET /photos/cleanup-preview?before=6m|1y
// 권한: pool_admin, sub_admin, super_admin
router.get(
  "/photos/cleanup-preview",
  requireAuth,
  requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.user!;
      const before = (req.query.before as string) || "6m";

      if (!["6m", "1y"].includes(before)) {
        res.status(400).json({ error: "before는 '6m' 또는 '1y'만 허용됩니다." }); return;
      }

      const poolId = await getUserPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

      const row = before === "1y"
        ? (await db.execute(sql`
            SELECT COUNT(*)::int AS count, COALESCE(SUM(file_size), 0)::bigint AS total_size
            FROM photo_assets_meta
            WHERE pool_id = ${poolId}
              AND is_clone = false
              AND created_at < NOW() - INTERVAL '1 year'
          `)).rows[0] as any
        : (await db.execute(sql`
            SELECT COUNT(*)::int AS count, COALESCE(SUM(file_size), 0)::bigint AS total_size
            FROM photo_assets_meta
            WHERE pool_id = ${poolId}
              AND is_clone = false
              AND created_at < NOW() - INTERVAL '6 months'
          `)).rows[0] as any;

      res.json({ count: Number(row.count), total_size: Number(row.total_size) });
    } catch (err) { console.error("[cleanup-preview]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 사진 일괄 정리 실행 ───────────────────────────────────────────────────────
// POST /photos/cleanup   body: { before: "6m" | "1y" }
// 권한: pool_admin, sub_admin, super_admin
// R2 삭제 성공 후 DB 삭제. 중간 오류 발생 시 해당 건 DB 유지.
router.post(
  "/photos/cleanup",
  requireAuth,
  requireRole("pool_admin", "sub_admin", "super_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.user!;
      const { before } = req.body as { before?: string };

      if (!before || !["6m", "1y"].includes(before)) {
        res.status(400).json({ error: "before는 '6m' 또는 '1y'만 허용됩니다." }); return;
      }

      const poolId = await getUserPoolId(userId);
      if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

      // cleanup 직전 실제 대상 재계산 (clone row 제외: is_clone=false만 대상)
      const targets = before === "1y"
        ? (await db.execute(sql`
            SELECT id, object_key, file_size
            FROM photo_assets_meta
            WHERE pool_id = ${poolId}
              AND is_clone = false
              AND created_at < NOW() - INTERVAL '1 year'
          `)).rows as any[]
        : (await db.execute(sql`
            SELECT id, object_key, file_size
            FROM photo_assets_meta
            WHERE pool_id = ${poolId}
              AND is_clone = false
              AND created_at < NOW() - INTERVAL '6 months'
          `)).rows as any[];

      if (targets.length === 0) {
        res.json({ deleted: 0, freed_bytes: 0 }); return;
      }

      console.log(`[photo-cleanup] pool=${poolId} before=${before} 대상=${targets.length}건 시작`);

      let deletedCount = 0;
      let freedBytes = 0;

      for (const photo of targets) {
        try {
          // object_key를 공유하는 sibling(clone 등)이 있으면 R2 파일 유지
          const okToDeleteR2 = await canDeleteR2Object(photo.id, photo.object_key, poolId);
          if (okToDeleteR2) {
            await deleteFromR2(photo.object_key, "photo");
          }
          // DB row 삭제
          await db.execute(sql`DELETE FROM photo_assets_meta WHERE id = ${photo.id}`);
          deletedCount++;
          freedBytes += Number(photo.file_size ?? 0);
        } catch (err) {
          console.error(`[photo-cleanup] 실패 id=${photo.id}:`, err);
        }
      }

      console.log(`[photo-cleanup] 완료: 삭제=${deletedCount}건 확보=${freedBytes}bytes`);
      res.json({ deleted: deletedCount, freed_bytes: freedBytes });
    } catch (err) { console.error("[photo-cleanup]", err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── POST /photos/note-attach — 선택 사진 학생 노트 연결 (MediaService 경유) ───
// 버그 3 수정: student_id + journal_id + student_note_id 동시 설정
router.post("/photos/note-attach", requireAuth, requireRole("teacher", "pool_admin", "sub_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const { note_id, photo_ids } = req.body as { note_id: string; photo_ids: string[] };

    console.log(`[note-attach] START userId=${userId} note_id=${note_id} photo_ids=${JSON.stringify(photo_ids)}`);

    if (!note_id || !Array.isArray(photo_ids) || photo_ids.length === 0) {
      console.log(`[note-attach] INVALID PARAMS note_id=${note_id}`);
      res.status(400).json({ error: "note_id와 photo_ids가 필요합니다." }); return;
    }

    const poolId = await getUserPoolId(userId);
    console.log(`[note-attach] poolId=${poolId} for userId=${userId}`);
    if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

    // note_id로 diary_id와 student_id 조회 (MediaService 호출에 필요)
    const noteRow = await db.execute(sql`
      SELECT id, diary_id, student_id, is_deleted FROM class_diary_student_notes
      WHERE id = ${note_id}
      LIMIT 1
    `);
    const note = noteRow.rows[0] as any;
    console.log(`[note-attach] DB note check: found=${!!note} id=${note?.id} diary_id=${note?.diary_id} student_id=${note?.student_id} is_deleted=${note?.is_deleted}`);
    if (!note) {
      // note_id로 아무 레코드도 없음 → 전체 count 확인
      const totalRow = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM class_diary_student_notes`);
      console.log(`[note-attach] TOTAL notes in DB: ${(totalRow.rows[0] as any)?.cnt}`);
      res.status(404).json({ error: "학생 노트를 찾을 수 없습니다." }); return;
    }
    if (note.is_deleted) {
      console.log(`[note-attach] note is_deleted=true`);
      res.status(404).json({ error: "학생 노트를 찾을 수 없습니다." }); return;
    }

    const noteResults = await attachPhotosToStudentNote(note.diary_id, note_id, note.student_id, photo_ids, poolId);
    const nAttached = noteResults.filter(r => r.action === "attached").length;
    const nCloned   = noteResults.filter(r => r.action === "cloned").length;
    const nAlready  = noteResults.filter(r => r.action === "already_attached").length;
    const nFailed   = noteResults.filter(r => r.action === "not_found" || r.action === "failed").length;
    console.log(`[note-attach] SUCCESS note_id=${note_id} attached=${nAttached} cloned=${nCloned} alreadyAttached=${nAlready} failed=${nFailed}`);
    res.json({
      success: nFailed === 0,
      requested: photo_ids.length,
      attached: nAttached,
      cloned: nCloned,
      alreadyAttached: nAlready,
      failed: nFailed,
      results: noteResults,
    });
  } catch (err: any) {
    console.error(`[note-attach] ERROR:`, err.message);
    if (err.message?.includes("찾을 수 없") || err.message?.includes("권한")) {
      res.status(400).json({ error: err.message }); return;
    }
    res.status(500).json({ error: "서버 오류" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Direct-Upload (R2 Presigned PUT) — Task #44
// POST /photos/direct-upload/session   → issue presigned PUT URLs
// POST /photos/direct-upload/finalize  → verify objects & create DB rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Diary-route semantics: teacher owns class if they are the primary teacher
 * OR listed in co_teacher_ids JSON array, within the same pool.
 */
async function teacherOwnsClassForUpload(
  userId: string,
  poolId: string,
  classId: string,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT id FROM class_groups
    WHERE id = ${classId}
      AND swimming_pool_id = ${poolId}
      AND (teacher_user_id = ${userId} OR co_teacher_ids @> to_jsonb(${userId}::text))
  `);
  return rows.rows.length > 0;
}

async function discardDirectUploadReservation(
  poolId: string,
  userId: string,
  objectKey: string,
): Promise<void> {
  const deleted = await db.execute(sql`
    DELETE FROM photo_assets_meta
    WHERE pool_id = ${poolId}
      AND uploaded_by = ${userId}
      AND object_key = ${objectKey}
      AND media_status = 'uploading'
    RETURNING object_key
  `);
  if (deleted.rows.length > 0) {
    await deleteFromR2(objectKey, "photo");
  }
}

// ── POST /photos/direct-upload/session ────────────────────────────────────
router.post(
  "/photos/direct-upload/session",
  requireAuth,
  requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId, role } = req.user!;
      const body = req.body as {
        album_type?: string;
        class_id?: string;
        student_id?: string;
        lesson_date?: string;
        caption?: string;
        files?: Array<{
          client_id?: string;
          file_name?: string;
          file_type?: string;
          file_size?: unknown;
        }>;
      };

      // ── Basic body validation ─────────────────────────────────────────
      const { album_type } = body;
      const class_id = body.class_id === undefined ? undefined : body.class_id;
      const student_id = body.student_id === undefined ? undefined : body.student_id;
      const lesson_date = body.lesson_date === undefined ? undefined : body.lesson_date;
      const caption = body.caption === undefined ? undefined : body.caption;

      if (album_type !== "group" && album_type !== "private") {
        res.status(400).json({ error: "album_type은 'group' 또는 'private'이어야 합니다." }); return;
      }
      if (class_id !== undefined && (typeof class_id !== "string" || class_id.length === 0)) {
        res.status(400).json({ error: "class_id가 유효하지 않습니다." }); return;
      }
      if (student_id !== undefined && (typeof student_id !== "string" || student_id.length === 0)) {
        res.status(400).json({ error: "student_id가 유효하지 않습니다." }); return;
      }
      // group: class_id is optional (pool-wide saved-album upload)
      // private: class_id + student_id are required
      if (album_type === "private") {
        if (!class_id) {
          res.status(400).json({ error: "개인 앨범은 class_id가 필요합니다." }); return;
        }
        if (!student_id) {
          res.status(400).json({ error: "개인 앨범은 student_id가 필요합니다." }); return;
        }
      }
      if (lesson_date !== undefined && (typeof lesson_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(lesson_date))) {
        res.status(400).json({ error: "lesson_date 형식은 YYYY-MM-DD이어야 합니다." }); return;
      }
      if (caption !== undefined && typeof caption !== "string") {
        res.status(400).json({ error: "caption이 유효하지 않습니다." }); return;
      }
      if (caption !== undefined && caption.length > MAX_CAPTION_LENGTH) {
        res.status(400).json({ error: `caption은 최대 ${MAX_CAPTION_LENGTH}자까지 허용됩니다.` }); return;
      }

      // ── File list validation ──────────────────────────────────────────
      if (!Array.isArray(body.files) || body.files.length === 0) {
        res.status(400).json({ error: "files 배열이 필요합니다." }); return;
      }
      if (body.files.length > MAX_FILES_PER_SESSION) {
        res.status(400).json({ error: `파일은 최대 ${MAX_FILES_PER_SESSION}개까지 업로드할 수 있습니다.` }); return;
      }

      const clientIdsSeen = new Set<string>();
      for (const f of body.files) {
        if (!isSafeClientId(f.client_id)) {
          res.status(400).json({ error: "client_id가 유효하지 않습니다." }); return;
        }
        if (clientIdsSeen.has(f.client_id as string)) {
          res.status(400).json({ error: "client_id가 중복되었습니다." }); return;
        }
        clientIdsSeen.add(f.client_id as string);

        if (!f.file_type || !DIRECT_UPLOAD_MIME_ALLOWLIST.has(f.file_type)) {
          res.status(400).json({ error: `허용되지 않는 파일 형식: ${f.file_type}` }); return;
        }
        const sizeCheck = validateFileSize(f.file_size);
        if (!sizeCheck.ok) {
          res.status(400).json({ error: sizeCheck.error }); return;
        }
      }

      // ── User / pool lookup ────────────────────────────────────────────
      const [user] = await superAdminDb.select({
        name: usersTable.name,
        role: usersTable.role,
        swimming_pool_id: usersTable.swimming_pool_id,
      })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }

      const poolId = user.swimming_pool_id;
      if (!poolId) { res.status(403).json({ error: "수영장 정보를 찾을 수 없습니다." }); return; }

      // ── Class ownership checks (when class_id is provided) ────────────
      if (class_id) {
        const classRows = await db.execute(sql`
          SELECT id, swimming_pool_id FROM class_groups WHERE id = ${class_id}
        `);
        const classRow = classRows.rows[0] as any;
        if (!classRow) { res.status(400).json({ error: "반을 찾을 수 없습니다." }); return; }

        // The metadata row must never combine one pool with another pool's class.
        if (classRow.swimming_pool_id !== poolId) {
          res.status(403).json({ error: "다른 수영장의 반에 접근할 수 없습니다." }); return;
        }

        // A pool admin can switch the client into teacher mode. Match the diary
        // route: only actual teachers are restricted to primary/co-teacher classes.
        if (role === "teacher" && user.role !== "pool_admin") {
          const ok = await teacherOwnsClassForUpload(userId, poolId, class_id);
          if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
        }

        // Private: verify student belongs to class
        if (album_type === "private" && student_id) {
          const studentRows = await db.execute(sql`
            SELECT id FROM students WHERE id = ${student_id} AND class_group_id = ${class_id}
          `);
          if (!studentRows.rows.length) {
            res.status(400).json({ error: "해당 반에 소속된 학생이 아닙니다." }); return;
          }
        }
      }

      // ── Storage quota ─────────────────────────────────────────────────
      const totalIncoming = (body.files as Array<{ file_size: number }>).reduce((s, f) => s + f.file_size, 0);
      const [quotaRow] = (await superAdminDb.execute(sql`
        SELECT COALESCE(sp.storage_gb, 0.5) AS storage_gb, COALESCE(p.extra_storage_gb, 0) AS extra_storage_gb
        FROM swimming_pools p
        LEFT JOIN pool_subscriptions ps ON ps.swimming_pool_id = p.id AND ps.status = 'active'
        LEFT JOIN subscription_plans sp ON sp.tier = COALESCE(ps.tier, 'free')
        WHERE p.id = ${poolId} LIMIT 1
      `)).rows as any[];
      const quotaBytes = (Number(quotaRow?.storage_gb ?? 0.5) + Number(quotaRow?.extra_storage_gb ?? 0)) * 1024 ** 3;

      // ── Generate UUID-based object keys and presigned PUT URLs ────────
      // All direct uploads live under a session-scoped prefix. A future
      // cleanup job can list this prefix and remove keys with no metadata row.
      const nonce = crypto.randomUUID();
      const keysMap: Record<string, string> = {};
      const sizesMap: Record<string, number> = {};
      const typesMap: Record<string, string> = {};

      const uploads: Array<{
        client_id: string;
        object_key: string;
        upload_url: string;
        headers: { "Content-Type": string };
      }> = [];

      for (const f of body.files as Array<{ client_id: string; file_type: string; file_size: number }>) {
        const ext = extFromMime(f.file_type);
        // UUID-based key — server generated, never derived from client-supplied filename
        const uuid = crypto.randomUUID();
        const objectKey = `photos/direct-staging/${poolId}/${nonce}/${uuid}.${ext}`;

        // ContentLength is part of the signature. R2 rejects a PUT whose
        // actual byte length differs from the validated declaration.
        const { ok, url, error } = await getPresignedPutUrl(
          objectKey,
          f.file_type,
          f.file_size,
          SESSION_TTL_SECONDS,
        );
        if (!ok || !url) {
          res.status(500).json({ error: `presigned URL 생성 실패: ${error}` }); return;
        }

        keysMap[f.client_id] = objectKey;
        sizesMap[f.client_id] = f.file_size;
        typesMap[f.client_id] = f.file_type;

        uploads.push({
          client_id: f.client_id,
          object_key: objectKey,
          upload_url: url,
          headers: { "Content-Type": f.file_type },
        });
      }

      // ── Build and sign session token ─────────────────────────────────
      const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
      const sessionPayload: UploadSessionPayload = {
        nonce,
        userId,
        poolId,
        album_type: album_type as "group" | "private",
        class_id,
        student_id: student_id ?? undefined,
        lesson_date: lesson_date ?? undefined,
        caption: caption ?? undefined,
        keys: keysMap,
        sizes: sizesMap,
        types: typesMap,
        exp,
      };

      const upload_token = signUploadToken(sessionPayload);
      const expires_at = new Date(exp * 1000).toISOString();

      // Reserve declared bytes before returning writable URLs. The existing
      // metadata table is reused with an internal `uploading` state, so no
      // schema migration is needed. Storage accounting already includes these
      // rows, which closes concurrent-session and abandoned-upload quota gaps.
      let quotaExceeded = false;
      let projectedPct = 0;
      let expiredObjectKeys: string[] = [];
      const visibility = album_type === "group" ? "class" : "private";

      await db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtext(${"photo-direct-quota:" + poolId}))
        `);

        // PUT URLs expire after five minutes. Keep a small grace period for
        // in-flight native uploads, then clean stale reservations on demand.
        const expiredRows = await tx.execute(sql`
          DELETE FROM photo_assets_meta
          WHERE pool_id = ${poolId}
            AND media_status = 'uploading'
            AND created_at < NOW() - INTERVAL '15 minutes'
          RETURNING object_key
        `);
        expiredObjectKeys = (expiredRows.rows as any[]).map((row) => String(row.object_key));

        const [usageRow] = (await tx.execute(sql`
          SELECT COALESCE(SUM(file_size), 0) AS used_bytes
          FROM photo_assets_meta
          WHERE pool_id = ${poolId}
            AND is_clone = false
        `)).rows as any[];
        const usedBytes = Number(usageRow?.used_bytes ?? 0);
        projectedPct = quotaBytes > 0 ? ((usedBytes + totalIncoming) / quotaBytes) * 100 : 0;

        if (quotaBytes > 0 && usedBytes + totalIncoming > quotaBytes) {
          quotaExceeded = true;
          return;
        }

        for (const f of body.files as Array<{ client_id: string; file_type: string; file_size: number }>) {
          const photoId = `photo_${crypto.randomUUID()}`;
          await tx.execute(
            album_type === "group"
              ? sql`
                INSERT INTO photo_assets_meta
                  (id, student_id, pool_id, uploaded_by, uploaded_by_name,
                   object_key, file_type, file_size,
                   album_type, visibility, class_id,
                   lesson_date, caption, media_status)
                VALUES
                  (${photoId}, NULL, ${poolId}, ${userId}, ${user.name},
                   ${keysMap[f.client_id]}, ${f.file_type}, ${f.file_size},
                   'group', ${visibility}, ${class_id ?? null},
                   ${lesson_date ?? null}, ${caption ?? null}, 'uploading')
              `
              : sql`
                INSERT INTO photo_assets_meta
                  (id, student_id, pool_id, uploaded_by, uploaded_by_name,
                   object_key, file_type, file_size,
                   album_type, visibility, class_id,
                   lesson_date, caption, media_status)
                VALUES
                  (${photoId}, ${student_id ?? null}, ${poolId}, ${userId}, ${user.name},
                   ${keysMap[f.client_id]}, ${f.file_type}, ${f.file_size},
                   'private', ${visibility}, ${class_id ?? null},
                   ${lesson_date ?? null}, ${caption ?? null}, 'uploading')
              `,
          );
        }
      });

      // Delete stale staging objects only after their reservation rows commit.
      await Promise.allSettled(
        expiredObjectKeys.map((key) => deleteFromR2(key, "photo")),
      );

      if (quotaExceeded) {
        res.status(403).json({
          error: "저장공간이 부족합니다.",
          code: "STORAGE_LIMIT_EXCEEDED",
        });
        return;
      }

      if (projectedPct >= 80) {
        res.setHeader("X-Storage-Pct", `${Math.round(projectedPct)}`);
      }
      // Never log upload_token or upload_url (contains credentials)
      res.status(200).json({ upload_token, expires_at, uploads });
    } catch (err: any) {
      console.error("[direct-upload/session]", err?.message ?? err);
      if (err?.message?.startsWith("DIRECT_UPLOAD_SECRET_MISSING")) {
        res.status(500).json({ error: "서버 설정 오류: 업로드 세션을 생성할 수 없습니다." }); return;
      }
      res.status(500).json({ error: "업로드 세션 생성 중 오류" });
    }
  }
);

// ── POST /photos/direct-upload/finalize ───────────────────────────────────
router.post(
  "/photos/direct-upload/finalize",
  requireAuth,
  requireRole("super_admin", "pool_admin", "teacher"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId } = req.user!;
      const body = req.body as {
        upload_token?: string;
        completed?: Array<{ client_id?: string; object_key?: string }>;
      };

      if (!body.upload_token || typeof body.upload_token !== "string") {
        res.status(400).json({ error: "upload_token이 필요합니다." }); return;
      }
      if (!Array.isArray(body.completed) || body.completed.length === 0) {
        res.status(400).json({ error: "completed 배열이 필요합니다." }); return;
      }
      if (body.completed.length > MAX_FILES_PER_SESSION) {
        res.status(400).json({ error: `completed는 최대 ${MAX_FILES_PER_SESSION}개까지 허용됩니다.` }); return;
      }

      // ── Verify token (HMAC + expiry) ──────────────────────────────────
      let session: UploadSessionPayload;
      try {
        session = verifyUploadToken(body.upload_token);
      } catch (e: any) {
        const code = e.message === "token_expired" ? "TOKEN_EXPIRED" : "INVALID_TOKEN";
        res.status(400).json({ error: "업로드 토큰이 유효하지 않습니다.", code }); return;
      }

      // Caller must match the token's userId
      if (session.userId !== userId) {
        res.status(403).json({ error: "업로드 토큰의 사용자와 일치하지 않습니다." }); return;
      }

      // ── Validate completed list: no duplicates, all in session ─────────
      const completedClientIds = new Set<string>();
      const completedObjectKeys = new Set<string>();
      for (const item of body.completed) {
        if (!item.client_id || typeof item.client_id !== "string" || !item.object_key || typeof item.object_key !== "string") {
          res.status(400).json({ error: "completed 항목에 client_id와 object_key가 필요합니다." }); return;
        }
        if (completedClientIds.has(item.client_id)) {
          res.status(400).json({ error: `completed에 중복된 client_id: ${item.client_id}` }); return;
        }
        if (completedObjectKeys.has(item.object_key)) {
          res.status(400).json({ error: `completed에 중복된 object_key: ${item.object_key}` }); return;
        }
        completedClientIds.add(item.client_id);
        completedObjectKeys.add(item.object_key);

        const expected = session.keys[item.client_id];
        if (!expected) {
          res.status(400).json({ error: `알 수 없는 client_id: ${item.client_id}` }); return;
        }
        if (expected !== item.object_key) {
          res.status(400).json({ error: `object_key 불일치: ${item.client_id}` }); return;
        }
      }

      // ── Verify each object exists in R2 with exact metadata ──────────
      const verifiedItems: Array<{
        client_id: string;
        object_key: string;
        file_size: number;
        file_type: string;
      }> = [];

      for (const item of body.completed as Array<{ client_id: string; object_key: string }>) {
        const declaredSize = session.sizes[item.client_id];
        const declaredType = session.types[item.client_id];

        let head: { contentLength: number; contentType: string } | null;
        try {
          head = await headObject(item.object_key, "photo");
        } catch (e: any) {
          res.status(502).json({ error: `R2 오브젝트 확인 실패: ${item.object_key}` }); return;
        }

        if (!head) {
          await discardDirectUploadReservation(session.poolId, userId, item.object_key);
          res.status(400).json({ error: `업로드된 파일을 찾을 수 없습니다: ${item.client_id}` }); return;
        }

        // Strict exact-byte and exact-type validation (jpeg/jpg alias only)
        const metaErr = validateHeadMetadata(
          item.client_id,
          declaredSize,
          declaredType,
          head.contentLength,
          head.contentType,
        );
        if (metaErr) {
          // The signed Content-Length should prevent this in normal clients.
          // If storage metadata is still invalid, remove its reservation and key.
          await discardDirectUploadReservation(session.poolId, userId, item.object_key);
          res.status(400).json({ error: metaErr }); return;
        }

        verifiedItems.push({
          client_id: item.client_id,
          object_key: item.object_key,
          file_size: head.contentLength,
          file_type: declaredType,
        });
      }

      // ── Finalize reserved rows atomically with race-safe idempotency ──
      // Preserve the order of verifiedItems in the response.
      const photos: Array<{
        client_id: string;
        id: string;
        file_url: string;
        created_at: string;
        uploaded_by_name: string;
        media_status: string;
        journal_id: string | null;
      }> = [];
      let missingReservationKeys: string[] = [];

      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            SELECT pg_advisory_xact_lock(hashtext(${"photo-direct-quota:" + session.poolId}))
          `);

          const resolvedItems: Array<{
            item: typeof verifiedItems[number];
            existing?: any;
          }> = [];

          for (const item of verifiedItems) {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${item.object_key}))`);
            const existingRows = await tx.execute(sql`
              SELECT id, created_at, uploaded_by_name, media_status, journal_id,
                     file_size, file_type
              FROM photo_assets_meta
              WHERE object_key = ${item.object_key}
                AND pool_id = ${session.poolId}
                AND uploaded_by = ${userId}
                AND is_clone = false
              LIMIT 1
            `);
            if (existingRows.rows.length === 0) {
              missingReservationKeys.push(item.object_key);
              throw new Error("DIRECT_UPLOAD_RESERVATION_MISSING");
            }
            resolvedItems.push({
              item,
              existing: existingRows.rows[0] as any | undefined,
            });
          }

          for (const { item, existing } of resolvedItems) {
            if (existing.media_status !== "uploading") {
              photos.push({
                client_id: item.client_id,
                id: existing.id,
                file_url: `/api/photos/${existing.id}/file`,
                created_at: existing.created_at,
                uploaded_by_name: existing.uploaded_by_name,
                media_status: existing.media_status,
                journal_id: existing.journal_id ?? null,
              });
              continue;
            }

            const finalizedRows = await tx.execute(sql`
              UPDATE photo_assets_meta
              SET media_status = 'draft',
                  file_size = ${item.file_size},
                  file_type = ${item.file_type}
              WHERE id = ${existing.id}
                AND media_status = 'uploading'
              RETURNING id, created_at, uploaded_by_name, media_status, journal_id
            `);
            const row = finalizedRows.rows[0] as any;
            photos.push({
              client_id: item.client_id,
              id: row.id,
              file_url: `/api/photos/${row.id}/file`,
              created_at: row.created_at,
              uploaded_by_name: row.uploaded_by_name,
              media_status: row.media_status,
              journal_id: row.journal_id ?? null,
            });
          }
        });
      } catch (err: any) {
        if (err?.message === "DIRECT_UPLOAD_RESERVATION_MISSING") {
          await Promise.allSettled(
            missingReservationKeys.map((key) => deleteFromR2(key, "photo")),
          );
          res.status(409).json({
            error: "업로드 세션 예약을 찾을 수 없습니다. 다시 업로드해주세요.",
            code: "UPLOAD_RESERVATION_MISSING",
          });
          return;
        }
        throw err;
      }

      res.status(200).json({ photos });
    } catch (err: any) {
      console.error("[direct-upload/finalize]", err?.message ?? err);
      if (err?.message?.startsWith("DIRECT_UPLOAD_SECRET_MISSING")) {
        res.status(500).json({ error: "서버 설정 오류" }); return;
      }
      res.status(500).json({ error: "업로드 완료 처리 중 오류" });
    }
  }
);

export default router;
