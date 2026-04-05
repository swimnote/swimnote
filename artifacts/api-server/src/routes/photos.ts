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
import { uploadToR2, downloadFromR2, deleteFromR2 } from "../lib/objectStorage.js";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { sendPushToClassParents, sendPushToUser } from "../lib/push-service.js";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { genFilename, sanitizePoolName } from "../utils/filename.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });


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
    FROM photo_assets_meta WHERE pool_id = ${poolId}
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

    const { ok, data: bytes, error } = await downloadFromR2(photo.object_key, "photo");
    if (!ok || !bytes) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    const ext = (photo.object_key.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(bytes);
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
    const rows = await db.execute(sql`
      SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
             sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at,
             sp.lesson_date, sp.file_size,
             s.name AS student_name
      FROM photo_assets_meta sp
      LEFT JOIN students s ON s.id = sp.student_id
      WHERE sp.album_type = 'group' AND sp.class_id = ${classId}
        ${date ? sql`AND (
          (sp.lesson_date IS NOT NULL AND sp.lesson_date = ${date as string})
          OR (sp.lesson_date IS NULL AND DATE(sp.created_at AT TIME ZONE 'Asia/Seoul') = ${date as string})
        )` : sql``}
      ORDER BY sp.created_at DESC
    `);
    const photos = (rows.rows as any[]).map(p => ({ ...p, file_url: `/api/photos/${p.id}/file` }));
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

    const rows = await db.execute(sql`
      SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.pool_id,
             sp.uploaded_by, sp.uploaded_by_name, sp.caption, sp.created_at, sp.file_size,
             s.name AS student_name
      FROM photo_assets_meta sp
      LEFT JOIN students s ON s.id = sp.student_id
      WHERE sp.album_type = 'private' AND sp.student_id = ${studentId}
      ORDER BY sp.created_at DESC
    `);
    const photos = (rows.rows as any[]).map(p => ({ ...p, file_url: `/api/photos/${p.id}/file` }));
    res.json(photos);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 반 전체 앨범 업로드 ────────────────────────────────────────────────
router.post(
  "/photos/group",
  requireAuth,
  requireRole("pool_admin", "teacher", "super_admin"),
  upload.array("photos", 10),
  async (req: AuthRequest, res: Response) => {
    try {
      const { class_id, lesson_date } = req.body;
      if (!class_id) { res.status(400).json({ error: "반(class_id)을 선택해주세요." }); return; }

      const files = req.files as Express.Multer.File[];
      if (!files?.length) { res.status(400).json({ error: "사진을 선택해주세요." }); return; }

      const { role, userId } = req.user!;
      console.log(`[photos/group] 업로드 시작: userId=${userId} role=${role} class_id=${class_id} files=${files.length}`);

      // teacher는 담당 반만
      if (role === "teacher") {
        const ok = await teacherOwnsClass(userId, class_id);
        if (!ok) { res.status(403).json({ error: "담당 반이 아닙니다." }); return; }
      }

      console.log(`[photos/group] 사용자 정보 조회 중...`);
      const [user] = await superAdminDb.select({ name: usersTable.name, swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (!user) { res.status(403).json({ error: "사용자를 찾을 수 없습니다." }); return; }
      console.log(`[photos/group] user 확인: pool_id=${user.swimming_pool_id}`);

      // pool_admin 권한: 자신의 풀 반만
      if (role === "pool_admin") {
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
        const key = `photos/group/${class_id}/${filename}`;
        console.log(`[photos/group] R2 업로드: key=${key} size=${file.size}`);
        const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "image/jpeg", "photo");
        if (!ok) {
          console.error(`[photos/group] R2 업로드 실패:`, error);
          throw new Error(error || "스토리지 업로드 실패");
        }
        console.log(`[photos/group] 스토리지 업로드 완료, DB INSERT 중...`);

        const id = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        // group 앨범: student_id는 NULL (반 전체 공유)
        const rows = await db.execute(sql`
          INSERT INTO photo_assets_meta
            (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id, lesson_date)
          VALUES
            (${id}, NULL, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'group', ${class_id}, ${lesson_date || null})
          RETURNING *
        `);
        console.log(`[photos/group] DB INSERT 완료: id=${id}`);
        inserted.push({ ...rows.rows[0], file_url: `/api/photos/${id}/file` });
      }

      // 반 전체 앨범 업로드 → 해당 반 학부모에게 푸시 알림
      if (inserted.length > 0) {
        const pSettings = await db.execute(sql`
          SELECT COALESCE(tpl_photo, '📸 새 사진이 업로드되었습니다.') AS tpl
          FROM pool_push_settings WHERE pool_id = ${user.swimming_pool_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        const tpl = (pSettings.rows[0] as any)?.tpl ?? "📸 새 사진이 업로드되었습니다.";
        // 5분 내 diary 푸시가 발송된 경우 photo 푸시 스킵 (중복 방지)
        sendPushToClassParents(
          class_id,
          "photo_upload",
          "📸 사진 업로드",
          tpl,
          { type: "photo", classId: class_id },
          `photo_group_${class_id}_${Date.now()}`,
          true
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
  upload.array("photos", 10),
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
            (id, student_id, pool_id, uploaded_by, uploaded_by_name, object_key, file_size, album_type, class_id)
          VALUES
            (${id}, ${student_id}, ${user.swimming_pool_id}, ${userId}, ${user.name}, ${key}, ${file.size}, 'private', ${class_id})
          RETURNING *
        `);
        inserted.push({ ...rows.rows[0], file_url: `/api/photos/${id}/file` });
      }

      // 개인 앨범 업로드 → 해당 학생 학부모에게 푸시 알림
      if (inserted.length > 0) {
        const pSettings = await db.execute(sql`
          SELECT COALESCE(tpl_photo, '📸 새 사진이 업로드되었습니다.') AS tpl
          FROM pool_push_settings WHERE pool_id = ${user.swimming_pool_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        const tpl = (pSettings.rows[0] as any)?.tpl ?? "📸 새 사진이 업로드되었습니다.";
        const parentRows = await db.execute(sql`
          SELECT parent_id AS parent_account_id FROM parent_students
          WHERE student_id = ${student_id} AND status = 'approved'
        `).catch(() => ({ rows: [] }));
        for (const p of parentRows.rows as any[]) {
          sendPushToUser(p.parent_account_id, true, "photo_upload", "📸 사진 업로드", tpl,
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

// ── 선생님: 내 담당 반 전체 미디어 목록 (scope=group|private) ─────────────
router.get("/photos/teacher-all", requireAuth, requireRole("teacher", "pool_admin", "super_admin"), async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.user!;
    const scope = (req.query.scope as string) || "group";

    let photos: any[];
    if (scope === "group") {
      const rows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.uploaded_by_name,
               sp.caption, sp.created_at, sp.file_size,
               '/api/photos/' || sp.id || '/file' AS file_url,
               cg.name AS class_name, cg.schedule_days, cg.schedule_time
        FROM photo_assets_meta sp
        JOIN class_groups cg ON cg.id = sp.class_id
        WHERE sp.album_type = 'group'
          AND cg.teacher_user_id = ${userId}
        ORDER BY sp.created_at DESC
      `);
      photos = rows.rows as any[];
    } else {
      const rows = await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id, sp.uploaded_by_name,
               sp.caption, sp.created_at, sp.file_size,
               '/api/photos/' || sp.id || '/file' AS file_url,
               s.name AS student_name,
               cg.name AS class_name
        FROM photo_assets_meta sp
        LEFT JOIN students s ON s.id = sp.student_id
        LEFT JOIN class_groups cg ON cg.id = sp.class_id
        WHERE sp.album_type = 'private'
          AND sp.uploaded_by = ${userId}
        ORDER BY sp.created_at DESC
      `);
      photos = rows.rows as any[];
    }

    res.json({ photos, total: photos.length });
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
        const rows = await db.execute(sql`SELECT * FROM photo_assets_meta WHERE id = ${id}`);
        const photo = rows.rows[0] as any;
        if (!photo) continue;
        if (role === "teacher" && photo.uploaded_by !== userId) continue;
        await deleteFromR2(photo.object_key, "photo");
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

    const childRows = await db.execute(sql`
      SELECT s.id, s.name, s.class_group_id,
             cg.name AS class_name, cg.schedule_days, cg.schedule_time
      FROM students s
      JOIN parent_students ps ON ps.student_id = s.id
      LEFT JOIN class_groups cg ON cg.id = s.class_group_id
      WHERE ps.parent_id = ${userId} AND ps.status = 'approved'
    `);
    const children = childRows.rows as any[];

    const photoMap = new Map<string, any>();

    for (const child of children) {
      if (child.class_group_id) {
        const rows = (await db.execute(sql`
          SELECT sp.id, sp.album_type, sp.class_id, sp.student_id,
                 sp.uploaded_by_name, sp.caption, sp.created_at,
                 '/api/photos/' || sp.id || '/file' AS file_url,
                 cg.name AS class_name, cg.schedule_days, cg.schedule_time
          FROM photo_assets_meta sp
          LEFT JOIN class_groups cg ON cg.id = sp.class_id
          WHERE sp.album_type = 'group' AND sp.class_id = ${child.class_group_id}
          ORDER BY sp.created_at DESC LIMIT 100
        `)).rows as any[];
        for (const row of rows) {
          if (!photoMap.has(row.id)) {
            const source_label = row.caption ||
              (row.schedule_days && row.schedule_time
                ? `${row.schedule_days.split(",")[0]} ${row.schedule_time}반 사진`
                : row.class_name ? `${row.class_name} 반 전체 사진` : "반 전체 사진");
            photoMap.set(row.id, { ...row, source_label });
          }
        }
      }
      const privRows = (await db.execute(sql`
        SELECT sp.id, sp.album_type, sp.class_id, sp.student_id,
               sp.uploaded_by_name, sp.caption, sp.created_at,
               '/api/photos/' || sp.id || '/file' AS file_url,
               s.name AS student_name
        FROM photo_assets_meta sp
        LEFT JOIN students s ON s.id = sp.student_id
        WHERE sp.album_type = 'private' AND sp.student_id = ${child.id}
        ORDER BY sp.created_at DESC LIMIT 100
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

      const rows = await db.execute(sql`SELECT * FROM photo_assets_meta WHERE id = ${photoId}`);
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

      await deleteFromR2(photo.object_key, "photo");
      await db.execute(sql`DELETE FROM photo_assets_meta WHERE id = ${photoId}`);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "삭제 중 오류" }); }
  }
);

export default router;
