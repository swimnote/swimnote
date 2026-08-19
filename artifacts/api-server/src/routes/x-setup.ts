/**
 * x-setup.ts — WP-X03 X Setup 자료 제출 / 관리 API
 *
 * Pool side (pool_admin only):
 *   GET  /x-setup/status
 *   GET  /x-setup/templates/:type/download   — curriculum | website
 *   POST /x-setup/upload/curriculum          — DOCX (max 20MB)
 *   POST /x-setup/upload/website             — DOCX (max 20MB)
 *   POST /x-setup/upload/logo                — PNG/JPG/WEBP (max 10MB)
 *   POST /x-setup/upload/photo               — 단일 사진 (max 30MB)
 *   DELETE /x-setup/photos/:fileId           — 사진 soft-delete
 *   POST /x-setup/submit                     — 섹션별 제출 상태 갱신
 *
 * Super Admin side (super_admin only):
 *   GET  /super/x-setup/:poolId              — 전체 자료 조회
 *   GET  /super/x-setup/:poolId/files/:fileId/download — presigned URL
 *   POST /super/x-setup/:poolId/revisions    — 수정 요청
 *   PATCH /super/x-setup/:poolId/sections/:section/approve — 섹션 승인
 *
 * Security:
 *   - server requireRole 적용 (UI hide만으로 끝내지 않음)
 *   - pool isolation: pool_id → userId로 서버 결정
 *   - cross-pool: super_admin 조회 시에도 poolId 존재 확인
 *   - DOCX MIME + ext 검증 (DOC/DOCM 거부)
 *   - Logo MIME: image/png | image/jpeg | image/webp
 *   - Photo MIME: image/jpeg | image/png | image/webp
 *   - 원본 파일 보관 (X 구독 해지/만료 후에도 보존)
 *
 * Versioning:
 *   - 재업로드 시 이전 파일 is_current=false, 신규 파일 is_current=true
 *   - photo는 max 10장 (current만 카운트)
 */
import { Router } from "express";
import multer from "multer";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { uploadToR2, getPresignedUrl } from "../lib/objectStorage.js";
import { TEMPLATE_VERSIONS, getTemplateR2Key, type TemplateType } from "../lib/xSetupTemplates.js";

const router = Router();

// ── multer 인스턴스 ──────────────────────────────────────────────────────────
const DOCX_MAX_MB   = 20;
const LOGO_MAX_MB   = 10;
const PHOTO_MAX_MB  = 30;

const docxUpload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: DOCX_MAX_MB  * 1024 * 1024 } });
const logoUpload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_MB  * 1024 * 1024 } });
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_MB * 1024 * 1024 } });

// ── MIME / ext 검증 헬퍼 ────────────────────────────────────────────────────
const DOCX_MIME     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_ALT_MIME = "application/octet-stream"; // 일부 OS
const DOCX_EXT      = ".docx";
const LOGO_MIMES    = new Set(["image/png", "image/jpeg", "image/webp"]);
const LOGO_EXTS     = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const PHOTO_MIMES   = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_EXTS    = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_PHOTOS    = 10;

function extOf(filename: string): string {
  return filename.slice(filename.lastIndexOf(".")).toLowerCase();
}
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9가-힣._\-]/g, "_").slice(0, 200);
}
function validateDocx(file: Express.Multer.File): string | null {
  const ext = extOf(file.originalname);
  if (ext !== DOCX_EXT) return `DOCX 파일(.docx)만 업로드할 수 있습니다. 현재 확장자: ${ext}`;
  const mime = file.mimetype;
  if (mime !== DOCX_MIME && mime !== DOCX_ALT_MIME && !mime.includes("wordprocessingml")) {
    return `올바른 DOCX 파일이 아닙니다 (mime: ${mime})`;
  }
  return null;
}
function validateLogo(file: Express.Multer.File): string | null {
  const ext = extOf(file.originalname);
  if (!LOGO_EXTS.has(ext)) return `로고는 PNG, JPG, WEBP 형식만 가능합니다.`;
  if (!LOGO_MIMES.has(file.mimetype)) return `로고 파일 형식이 올바르지 않습니다.`;
  return null;
}
function validatePhoto(file: Express.Multer.File): string | null {
  const ext = extOf(file.originalname);
  if (!PHOTO_EXTS.has(ext)) return `사진은 JPG, PNG, WEBP 형식만 가능합니다.`;
  if (!PHOTO_MIMES.has(file.mimetype)) return `사진 파일 형식이 올바르지 않습니다.`;
  return null;
}

// ── getPoolId 헬퍼 ───────────────────────────────────────────────────────────
async function getPoolId(userId: string): Promise<string | null> {
  const [u] = (await superAdminDb.execute(sql`
    SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
  `)).rows as any[];
  return u?.swimming_pool_id ?? null;
}

// ── generateId 헬퍼 ──────────────────────────────────────────────────────────
function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── x_setup_submissions upsert 헬퍼 ─────────────────────────────────────────
async function ensureSubmission(poolId: string): Promise<void> {
  await superAdminDb.execute(sql`
    INSERT INTO x_setup_submissions (id, pool_id)
    VALUES (${genId("xss")}, ${poolId})
    ON CONFLICT (pool_id) DO NOTHING
  `);
}

// ── 현재 version 번호 계산 ────────────────────────────────────────────────────
async function nextVersion(poolId: string, fileType: string): Promise<number> {
  const [r] = (await superAdminDb.execute(sql`
    SELECT COALESCE(MAX(submission_version), 0) AS v
    FROM x_setup_files
    WHERE pool_id = ${poolId} AND file_type = ${fileType}
  `)).rows as any[];
  return (r?.v ?? 0) + 1;
}

// ════════════════════════════════════════════════════════════════════════════
// POOL ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /x-setup/status ────────────────────────────────────────────────────
router.get("/x-setup/status", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    await ensureSubmission(poolId);

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    const files = (await superAdminDb.execute(sql`
      SELECT id, file_type, original_filename, mime_type, file_size_bytes,
             submission_version, photo_order, photo_title, photo_category,
             template_version, uploaded_at
      FROM x_setup_files
      WHERE pool_id = ${poolId} AND is_current = true AND deleted_at IS NULL
      ORDER BY file_type, photo_order NULLS LAST, uploaded_at ASC
    `)).rows as any[];

    const revisions = (await superAdminDb.execute(sql`
      SELECT id, section, message, requested_at, status
      FROM x_setup_revision_requests
      WHERE pool_id = ${poolId} AND status = 'PENDING'
      ORDER BY requested_at DESC
    `)).rows as any[];

    res.json({
      submission: sub ?? null,
      files,
      pending_revisions: revisions,
      template_versions: TEMPLATE_VERSIONS,
    });
  } catch (err) {
    console.error("[x-setup/status]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /x-setup/templates/:type/download ──────────────────────────────────
router.get("/x-setup/templates/:type/download", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  const { type } = req.params;
  if (type !== "curriculum" && type !== "website") {
    res.status(400).json({ error: "type은 curriculum 또는 website만 가능합니다." });
    return;
  }
  const key = getTemplateR2Key(type as TemplateType);
  const { ok, url, error } = await getPresignedUrl(key, "photo", 300); // 5분
  if (!ok || !url) {
    res.status(503).json({ error: "템플릿 파일을 일시적으로 제공할 수 없습니다.", detail: error });
    return;
  }
  res.json({ url, version: TEMPLATE_VERSIONS[type as TemplateType], r2_key: key });
});

// ── POST /x-setup/upload/curriculum ────────────────────────────────────────
router.post("/x-setup/upload/curriculum", requireAuth, requireRole("pool_admin"),
  docxUpload.single("file"),
  async (req: AuthRequest, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    const validErr = validateDocx(file);
    if (validErr) { res.status(422).json({ error: validErr, code: "INVALID_DOCX" }); return; }

    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    try {
      await ensureSubmission(poolId);
      const version = await nextVersion(poolId, "curriculum");
      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/curriculum/v${version}_${Date.now()}_${safeName}`;

      const { ok, error } = await uploadToR2(r2Key, file.buffer, DOCX_MIME, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: error }); return; }

      // 이전 curriculum 파일 is_current=false
      await superAdminDb.execute(sql`
        UPDATE x_setup_files SET is_current = false
        WHERE pool_id = ${poolId} AND file_type = 'curriculum'
      `);

      const fileId = genId("xsf");
      await superAdminDb.execute(sql`
        INSERT INTO x_setup_files
          (id, pool_id, file_type, r2_key, original_filename, mime_type,
           file_size_bytes, submission_version, is_current,
           template_version, uploaded_by, uploaded_at)
        VALUES (${fileId}, ${poolId}, 'curriculum', ${r2Key}, ${safeName},
                ${DOCX_MIME}, ${file.size}, ${version}, true,
                ${(req.body?.template_version as string | undefined) ?? null},
                ${req.user!.userId}, NOW())
      `);

      // setup_status 갱신 (NOT_STARTED → IN_PROGRESS)
      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions
        SET curriculum_status = 'SUBMITTED',
            setup_status = CASE
              WHEN setup_status = 'NOT_STARTED' THEN 'IN_PROGRESS'
              ELSE setup_status
            END,
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);

      res.json({ ok: true, file_id: fileId, version, r2_key: r2Key });
    } catch (err) {
      console.error("[x-setup/upload/curriculum]", err);
      res.status(500).json({ error: "업로드 오류" });
    }
  },
);

// ── POST /x-setup/upload/website ───────────────────────────────────────────
router.post("/x-setup/upload/website", requireAuth, requireRole("pool_admin"),
  docxUpload.single("file"),
  async (req: AuthRequest, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    const validErr = validateDocx(file);
    if (validErr) { res.status(422).json({ error: validErr, code: "INVALID_DOCX" }); return; }

    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    try {
      await ensureSubmission(poolId);
      const version = await nextVersion(poolId, "website");
      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/website/v${version}_${Date.now()}_${safeName}`;

      const { ok, error } = await uploadToR2(r2Key, file.buffer, DOCX_MIME, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: error }); return; }

      await superAdminDb.execute(sql`
        UPDATE x_setup_files SET is_current = false
        WHERE pool_id = ${poolId} AND file_type = 'website'
      `);

      const fileId = genId("xsf");
      await superAdminDb.execute(sql`
        INSERT INTO x_setup_files
          (id, pool_id, file_type, r2_key, original_filename, mime_type,
           file_size_bytes, submission_version, is_current,
           template_version, uploaded_by, uploaded_at)
        VALUES (${fileId}, ${poolId}, 'website', ${r2Key}, ${safeName},
                ${DOCX_MIME}, ${file.size}, ${version}, true,
                ${(req.body?.template_version as string | undefined) ?? null},
                ${req.user!.userId}, NOW())
      `);

      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions
        SET website_status = 'SUBMITTED',
            setup_status = CASE
              WHEN setup_status = 'NOT_STARTED' THEN 'IN_PROGRESS'
              ELSE setup_status
            END,
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);

      res.json({ ok: true, file_id: fileId, version, r2_key: r2Key });
    } catch (err) {
      console.error("[x-setup/upload/website]", err);
      res.status(500).json({ error: "업로드 오류" });
    }
  },
);

// ── POST /x-setup/upload/logo ──────────────────────────────────────────────
router.post("/x-setup/upload/logo", requireAuth, requireRole("pool_admin"),
  logoUpload.single("file"),
  async (req: AuthRequest, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    const validErr = validateLogo(file);
    if (validErr) { res.status(422).json({ error: validErr, code: "INVALID_LOGO" }); return; }

    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    try {
      await ensureSubmission(poolId);
      const version = await nextVersion(poolId, "logo");
      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/logo/v${version}_${Date.now()}_${safeName}`;

      const { ok, error } = await uploadToR2(r2Key, file.buffer, file.mimetype, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: error }); return; }

      await superAdminDb.execute(sql`
        UPDATE x_setup_files SET is_current = false
        WHERE pool_id = ${poolId} AND file_type = 'logo'
      `);

      const fileId = genId("xsf");
      await superAdminDb.execute(sql`
        INSERT INTO x_setup_files
          (id, pool_id, file_type, r2_key, original_filename, mime_type,
           file_size_bytes, submission_version, is_current, uploaded_by, uploaded_at)
        VALUES (${fileId}, ${poolId}, 'logo', ${r2Key}, ${safeName},
                ${file.mimetype}, ${file.size}, ${version}, true,
                ${req.user!.userId}, NOW())
      `);

      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions
        SET logo_status = 'SUBMITTED',
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);

      res.json({ ok: true, file_id: fileId, version, r2_key: r2Key });
    } catch (err) {
      console.error("[x-setup/upload/logo]", err);
      res.status(500).json({ error: "업로드 오류" });
    }
  },
);

// ── POST /x-setup/upload/photo ─────────────────────────────────────────────
router.post("/x-setup/upload/photo", requireAuth, requireRole("pool_admin"),
  photoUpload.single("file"),
  async (req: AuthRequest, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    const validErr = validatePhoto(file);
    if (validErr) { res.status(422).json({ error: validErr, code: "INVALID_PHOTO" }); return; }

    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    try {
      await ensureSubmission(poolId);

      // 현재 사진 수 확인 (max 10)
      const [countRow] = (await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM x_setup_files
        WHERE pool_id = ${poolId} AND file_type = 'photo'
          AND is_current = true AND deleted_at IS NULL
      `)).rows as any[];
      const currentCount = Number(countRow?.cnt ?? 0);
      if (currentCount >= MAX_PHOTOS) {
        res.status(422).json({ error: `홍보사진은 최대 ${MAX_PHOTOS}장까지 업로드할 수 있습니다.`, code: "PHOTO_LIMIT_EXCEEDED" });
        return;
      }

      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/photos/${Date.now()}_${safeName}`;
      const { ok, error } = await uploadToR2(r2Key, file.buffer, file.mimetype, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: error }); return; }

      const photoOrder = currentCount + 1;
      const photoTitle    = (req.body?.title as string | undefined) ?? null;
      const photoCategory = (req.body?.category as string | undefined) ?? null;

      const fileId = genId("xsf");
      await superAdminDb.execute(sql`
        INSERT INTO x_setup_files
          (id, pool_id, file_type, r2_key, original_filename, mime_type,
           file_size_bytes, submission_version, is_current,
           photo_order, photo_title, photo_category,
           uploaded_by, uploaded_at)
        VALUES (${fileId}, ${poolId}, 'photo', ${r2Key}, ${safeName},
                ${file.mimetype}, ${file.size}, 1, true,
                ${photoOrder}, ${photoTitle}, ${photoCategory},
                ${req.user!.userId}, NOW())
      `);

      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions
        SET photos_status = 'SUBMITTED',
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);

      res.json({ ok: true, file_id: fileId, photo_order: photoOrder, r2_key: r2Key, total_count: currentCount + 1 });
    } catch (err) {
      console.error("[x-setup/upload/photo]", err);
      res.status(500).json({ error: "업로드 오류" });
    }
  },
);

// ── DELETE /x-setup/photos/:fileId ─────────────────────────────────────────
router.delete("/x-setup/photos/:fileId", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  const { fileId } = req.params;
  const poolId = await getPoolId(req.user!.userId);
  if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

  try {
    // cross-pool 방어: pool_id 일치 확인
    const [row] = (await superAdminDb.execute(sql`
      SELECT id, file_type FROM x_setup_files
      WHERE id = ${fileId} AND pool_id = ${poolId} AND deleted_at IS NULL
      LIMIT 1
    `)).rows as any[];
    if (!row) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }
    if (row.file_type !== "photo") { res.status(422).json({ error: "사진 파일만 삭제할 수 있습니다." }); return; }

    await superAdminDb.execute(sql`
      UPDATE x_setup_files SET is_current = false, deleted_at = NOW() WHERE id = ${fileId}
    `);

    // 남은 사진 없으면 photos_status → NOT_SUBMITTED
    const [remaining] = (await superAdminDb.execute(sql`
      SELECT COUNT(*)::int AS cnt FROM x_setup_files
      WHERE pool_id = ${poolId} AND file_type = 'photo' AND is_current = true AND deleted_at IS NULL
    `)).rows as any[];
    if (Number(remaining?.cnt ?? 0) === 0) {
      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions SET photos_status = 'NOT_SUBMITTED', updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[x-setup/photos/delete]", err);
    res.status(500).json({ error: "삭제 오류" });
  }
});

// ── POST /x-setup/submit ───────────────────────────────────────────────────
// body: { sections?: string[] }  — 전달 시 해당 섹션만, 없으면 전체 제출 상태로 SUBMITTED 마킹
router.post("/x-setup/submit", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  const poolId = await getPoolId(req.user!.userId);
  if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

  try {
    await ensureSubmission(poolId);

    // 전체 SUBMITTED로 전환 (각 섹션 상태 유지, overall만 변경)
    await superAdminDb.execute(sql`
      UPDATE x_setup_submissions
      SET setup_status = 'SUBMITTED',
          submitted_at = COALESCE(submitted_at, NOW()),
          submitted_by = ${req.user!.userId},
          updated_at = NOW()
      WHERE pool_id = ${poolId}
    `);

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId}
    `)).rows as any[];

    res.json({ ok: true, submission: sub });
  } catch (err) {
    console.error("[x-setup/submit]", err);
    res.status(500).json({ error: "제출 오류" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /super/x-setup/:poolId ─────────────────────────────────────────────
router.get("/super/x-setup/:poolId", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { poolId } = req.params;
  try {
    // pool 존재 확인
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id, name, x_paid_entitlement, x_manual_entitlement, xmode_config_status
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    // 현재 파일 (삭제 포함) — 버전 이력
    const allFiles = (await superAdminDb.execute(sql`
      SELECT id, file_type, original_filename, mime_type, file_size_bytes,
             submission_version, is_current, photo_order, photo_title, photo_category,
             template_version, uploaded_by, uploaded_at, deleted_at
      FROM x_setup_files
      WHERE pool_id = ${poolId}
      ORDER BY file_type, submission_version DESC, uploaded_at DESC
    `)).rows as any[];

    const revisions = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_revision_requests
      WHERE pool_id = ${poolId}
      ORDER BY requested_at DESC
      LIMIT 50
    `)).rows as any[];

    res.json({ pool, submission: sub ?? null, files: allFiles, revisions });
  } catch (err) {
    console.error("[super/x-setup]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── GET /super/x-setup/:poolId/files/:fileId/download ─────────────────────
router.get("/super/x-setup/:poolId/files/:fileId/download", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { poolId, fileId } = req.params;
  try {
    const [file] = (await superAdminDb.execute(sql`
      SELECT id, r2_key, original_filename, mime_type, pool_id
      FROM x_setup_files WHERE id = ${fileId} AND pool_id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!file) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    const { ok, url, error } = await getPresignedUrl(file.r2_key, "photo", 300);
    if (!ok || !url) { res.status(503).json({ error: "다운로드 URL 생성 실패", detail: error }); return; }

    res.json({ url, filename: file.original_filename, mime_type: file.mime_type });
  } catch (err) {
    console.error("[super/x-setup/download]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── POST /super/x-setup/:poolId/revisions ─────────────────────────────────
router.post("/super/x-setup/:poolId/revisions", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { poolId } = req.params;
  const { section, message } = req.body ?? {};
  if (!section || !message?.trim()) {
    res.status(400).json({ error: "section과 message는 필수입니다." });
    return;
  }
  const VALID_SECTIONS = ["curriculum", "website", "logo", "photos", "general"];
  if (!VALID_SECTIONS.includes(section)) {
    res.status(400).json({ error: `section은 ${VALID_SECTIONS.join(", ")} 중 하나여야 합니다.` });
    return;
  }
  try {
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const revId = genId("xsr");
    await superAdminDb.execute(sql`
      INSERT INTO x_setup_revision_requests
        (id, pool_id, section, message, requested_by, requested_at, status)
      VALUES (${revId}, ${poolId}, ${section}, ${message.trim()}, ${req.user!.userId}, NOW(), 'PENDING')
    `);

    // 섹션 상태 → REVISION_REQUESTED
    const colMap: Record<string, string> = {
      curriculum: "curriculum_status",
      website:    "website_status",
      logo:       "logo_status",
      photos:     "photos_status",
    };
    // 섹션별 컬럼 업데이트 (sql.raw 대신 explicit switch로 SQL injection 방어)
    if (section === "curriculum") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET curriculum_status='REVISION_REQUESTED', setup_status='REVISION_REQUESTED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "website") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET website_status='REVISION_REQUESTED', setup_status='REVISION_REQUESTED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "logo") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET logo_status='REVISION_REQUESTED', setup_status='REVISION_REQUESTED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "photos") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET photos_status='REVISION_REQUESTED', setup_status='REVISION_REQUESTED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET setup_status='REVISION_REQUESTED', updated_at=NOW() WHERE pool_id=${poolId}`);
    }

    res.json({ ok: true, revision_id: revId });
  } catch (err) {
    console.error("[super/x-setup/revisions]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── PATCH /super/x-setup/:poolId/sections/:section/approve ────────────────
router.patch("/super/x-setup/:poolId/sections/:section/approve", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { poolId, section } = req.params;
  const VALID_SECTIONS = ["curriculum", "website", "logo", "photos"];
  if (!VALID_SECTIONS.includes(section)) {
    res.status(400).json({ error: `section은 ${VALID_SECTIONS.join(", ")} 중 하나여야 합니다.` });
    return;
  }
  try {
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    // explicit switch (sql injection 방어)
    if (section === "curriculum") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET curriculum_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "website") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET website_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "logo") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET logo_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "photos") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET photos_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    }

    // 전체 승인 여부 확인 (curriculum + website 둘 다 APPROVED → setup_status=APPROVED)
    const [sub] = (await superAdminDb.execute(sql`
      SELECT curriculum_status, website_status, logo_status, photos_status
      FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (sub?.curriculum_status === "APPROVED" && sub?.website_status === "APPROVED") {
      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions
        SET setup_status = 'APPROVED', updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    }

    res.json({ ok: true, section, new_status: "APPROVED" });
  } catch (err) {
    console.error("[super/x-setup/approve]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// P0 server-boot recovery: X setup migrations and template initialization are
// intentionally not run as a startup side effect. X remains pending until an
// explicitly approved maintenance operation runs.
console.warn("[x-setup] startup migration and template initialization skipped");

export default router;
