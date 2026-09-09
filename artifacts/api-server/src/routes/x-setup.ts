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
 * Durability (P0 fixes):
 *   - DB transaction: is_current=false + INSERT + submission_update atomic
 *   - Advisory lock: pg_advisory_xact_lock prevents version race per (pool, file_type)
 *   - R2 compensating cleanup: DB transaction 실패 시 신규 R2 object 삭제 시도
 *   - UNIQUE partial index on (pool_id, file_type, submission_version) WHERE type!=photo
 *   - raw_original_filename: 원본 파일명 별도 보존
 *   - audit_logs: 업로드/재업로드/삭제/제출/승인/revision 전 action 기록
 */
import { Router } from "express";
import multer from "multer";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { uploadToR2, getPresignedUrl, deleteFromR2 } from "../lib/objectStorage.js";
import { TEMPLATE_VERSIONS, getTemplateR2Key, type TemplateType } from "../lib/xSetupTemplates.js";
import {
  processLocalCurriculumForReview,
  approveAndActivateLocalCurriculum,
} from "../lib/curriculum-orchestration.js";

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

// ── X entitlement 헬퍼 ────────────────────────────────────────────────────────
/**
 * X setup은 x_pending(설정 중)도 접근 가능 — entitlement 보유 여부만 체크.
 * x_paid_entitlement OR x_manual_entitlement OR x_management_override
 */
async function hasXEntitlement(poolId: string): Promise<boolean> {
  const [row] = (await superAdminDb.execute(sql`
    SELECT (
      COALESCE(x_paid_entitlement, false) OR
      COALESCE(x_manual_entitlement, false) OR
      COALESCE(x_management_override, false)
    ) AS has_x
    FROM swimming_pools WHERE id = ${poolId} LIMIT 1
  `)).rows as any[];
  return row?.has_x === true;
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

// ── Audit log 헬퍼 ───────────────────────────────────────────────────────────
/**
 * X setup 관련 action을 audit_logs에 기록한다.
 * fire-and-forget — 실패해도 업로드 자체는 중단하지 않는다.
 */
async function logXSetupAudit(params: {
  action: string;
  poolId: string;
  actorId: string;
  actorType?: string;
  fileId?: string;
  fileType?: string;
  version?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const entityId = params.fileId ?? params.poolId;
  const afterData = JSON.stringify({
    file_type: params.fileType,
    version: params.version,
    ...params.meta,
  });
  await superAdminDb.execute(sql`
    INSERT INTO audit_logs
      (id, entity_type, entity_id, action, actor_type, actor_id, pool_id, after_data, created_at)
    VALUES
      (${genId("al")}, 'x_setup_file', ${entityId}, ${params.action},
       ${params.actorType ?? "user"}, ${params.actorId}, ${params.poolId},
       ${afterData}::jsonb, NOW())
  `).catch((e: any) => console.error(`[x-setup audit] ${params.action} 기록 실패:`, e?.message));
}

// ── R2 orphan 보상 cleanup ───────────────────────────────────────────────────
/**
 * DB transaction 실패 시 방금 업로드한 신규 R2 object를 삭제 시도한다.
 * 기존/과거 R2 object는 절대 삭제하지 않는다.
 * cleanup 실패 시 audit_logs에 r2_orphan_cleanup_failed로 기록한다.
 */
async function compensatingR2Cleanup(params: {
  r2Key: string;
  bucket: "photo" | "video";
  poolId: string;
  actorId: string;
  fileType: string;
}): Promise<void> {
  try {
    await deleteFromR2(params.r2Key, params.bucket);
    console.warn(`[x-setup] R2 compensating cleanup 성공: ${params.r2Key}`);
  } catch (cleanupErr: any) {
    console.error(`[x-setup] R2 compensating cleanup 실패: ${params.r2Key}`, cleanupErr?.message);
    // 추적 가능한 orphan 로그
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs
        (id, entity_type, entity_id, action, actor_type, actor_id, pool_id, after_data, created_at)
      VALUES
        (${genId("al")}, 'x_setup_orphan', ${params.r2Key}, 'r2_orphan_cleanup_failed',
         'system', ${params.actorId}, ${params.poolId},
         ${JSON.stringify({ r2_key: params.r2Key, file_type: params.fileType, error: cleanupErr?.message })}::jsonb,
         NOW())
    `).catch((e: any) => console.error("[x-setup] orphan log 실패:", e?.message));
  }
}

// ── Versioned file atomic upload (curriculum / website / logo) ───────────────
/**
 * P0-A + P0-B + P0-C 동시 해결:
 *   - advisory lock: (pool_id, file_type) 쌍으로 직렬화 → version race 불가
 *   - transaction: is_current=false UPDATE + INSERT + submission UPDATE 원자적
 *   - compensating cleanup: DB 실패 시 신규 R2 object 삭제
 *   - raw_original_filename: 원본 파일명 별도 보존
 */
async function uploadVersionedFile(params: {
  poolId: string;
  actorId: string;
  fileType: "curriculum" | "website" | "logo";
  r2Key: string;
  rawOriginalFilename: string;
  safeName: string;
  mimeType: string;
  fileSize: number;
  templateVersion?: string | null;
  submissionStatusCol: string;
  submissionStatusValue: string;
}): Promise<{ fileId: string; version: number }> {
  const {
    poolId, actorId, fileType, r2Key,
    rawOriginalFilename, safeName, mimeType, fileSize,
    templateVersion, submissionStatusCol, submissionStatusValue,
  } = params;

  const fileId = genId("xsf");
  let version = 0; // transaction 내부에서 설정됨

  await superAdminDb.transaction(async (tx) => {
    // 1. Advisory lock — 같은 (pool, fileType)에서 동시 업로드 직렬화
    //    pg_advisory_xact_lock은 transaction 종료 시 자동 해제
    const lockKey = `${poolId}:${fileType}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    // 2. Version 계산 (lock 안에서 → race 불가)
    const [vr] = (await tx.execute(sql`
      SELECT COALESCE(MAX(submission_version), 0) + 1 AS v
      FROM x_setup_files
      WHERE pool_id = ${poolId} AND file_type = ${fileType}
    `)).rows as any[];
    version = Number(vr?.v ?? 1);

    // 3. 기존 current 파일 is_current=false (rollback되면 원복됨)
    await tx.execute(sql`
      UPDATE x_setup_files SET is_current = false
      WHERE pool_id = ${poolId} AND file_type = ${fileType}
    `);

    // 4. 신규 파일 INSERT
    await tx.execute(sql`
      INSERT INTO x_setup_files
        (id, pool_id, file_type, r2_key, original_filename, raw_original_filename,
         mime_type, file_size_bytes, submission_version, is_current,
         template_version, uploaded_by, uploaded_at)
      VALUES
        (${fileId}, ${poolId}, ${fileType}, ${r2Key}, ${safeName}, ${rawOriginalFilename},
         ${mimeType}, ${fileSize}, ${version}, true,
         ${templateVersion ?? null}, ${actorId}, NOW())
    `);

    // 5. Submission 상태 갱신
    if (submissionStatusCol === "curriculum_status") {
      await tx.execute(sql`
        UPDATE x_setup_submissions
        SET curriculum_status = ${submissionStatusValue},
            setup_status = CASE WHEN setup_status = 'NOT_STARTED' THEN 'IN_PROGRESS' ELSE setup_status END,
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    } else if (submissionStatusCol === "website_status") {
      await tx.execute(sql`
        UPDATE x_setup_submissions
        SET website_status = ${submissionStatusValue},
            setup_status = CASE WHEN setup_status = 'NOT_STARTED' THEN 'IN_PROGRESS' ELSE setup_status END,
            updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    } else if (submissionStatusCol === "logo_status") {
      await tx.execute(sql`
        UPDATE x_setup_submissions SET logo_status = ${submissionStatusValue}, updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    }
  });

  return { fileId, version };
}

// ════════════════════════════════════════════════════════════════════════════
// POOL ADMIN ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /x-setup/status ────────────────────────────────────────────────────
router.get("/x-setup/status", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = await getPoolId(req.user!.userId);
    if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

    // X entitlement guard — x_pending 포함 허용, BASE(normal) 차단
    if (!(await hasXEntitlement(poolId).catch(() => false))) {
      res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
    }

    await ensureSubmission(poolId);

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    const files = (await superAdminDb.execute(sql`
      SELECT id, file_type, original_filename, raw_original_filename, mime_type, file_size_bytes,
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

    if (!(await hasXEntitlement(poolId).catch(() => false))) {
      res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
    }

    const actorId = req.user!.userId;

    try {
      await ensureSubmission(poolId);

      // R2 key는 timestamp + genId로 고유성 보장 (version은 DB에서 관리)
      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/curriculum/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

      // ── Step 1: R2 upload ─────────────────────────────────────────────────
      const { ok, error: r2Err } = await uploadToR2(r2Key, file.buffer, DOCX_MIME, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: r2Err }); return; }

      // ── Step 2: Atomic DB transaction (advisory lock + versioning) ────────
      let fileId: string;
      let version: number;
      try {
        ({ fileId, version } = await uploadVersionedFile({
          poolId, actorId, fileType: "curriculum", r2Key,
          rawOriginalFilename: file.originalname,
          safeName, mimeType: DOCX_MIME, fileSize: file.size,
          templateVersion: (req.body?.template_version as string | undefined) ?? null,
          submissionStatusCol: "curriculum_status",
          submissionStatusValue: "SUBMITTED",
        }));
      } catch (dbErr) {
        // DB 실패 → 신규 R2 object 보상 삭제
        await compensatingR2Cleanup({ r2Key, bucket: "photo", poolId, actorId, fileType: "curriculum" });
        throw dbErr; // → 500 반환
      }

      // ── Step 3: Audit log ─────────────────────────────────────────────────
      const isReupload = version > 1;
      await logXSetupAudit({
        action: isReupload ? "x_setup_reupload" : "x_setup_upload",
        poolId, actorId, fileId, fileType: "curriculum", version,
        meta: { safe_name: safeName, file_size: file.size, r2_key: r2Key },
      });

      // ── Step 4: Parse / Review (실패해도 원본 보존) ──────────────────────
      let reviewResult: Awaited<ReturnType<typeof processLocalCurriculumForReview>> | null = null;
      try {
        reviewResult = await processLocalCurriculumForReview(poolId, actorId);
      } catch (orchErr) {
        console.error("[x-setup/upload/curriculum] review-parse error:", orchErr);
        reviewResult = null;
      }

      // ── N5: Super Admin 알림 — 커리큘럼 파일 업로드 ────────────────────
      import("../utils/notify.js").then(async ({ notifySuperAdmin }) => {
        try {
          const [poolRow] = (await superAdminDb.execute(sql`SELECT name FROM swimming_pools WHERE id = ${poolId} LIMIT 1`)).rows as any[];
          notifySuperAdmin({
            type: "CURRICULUM_UPLOADED",
            title: "커리큘럼 파일 업로드",
            body: `${poolRow?.name ?? poolId} — v${version} (${isReupload ? "재업로드" : "신규"})`,
            poolId,
            refId: fileId,
            refType: "curriculum",
            idempotencyKey: `curriculum_upload_${fileId}`,
          }).catch(console.error);
        } catch { /* 알림 실패는 무시 */ }
      }).catch(console.error);

      res.json({
        ok: true,
        file_id: fileId,
        version,
        r2_key: r2Key,
        curriculum: reviewResult
          ? {
              status: reviewResult.status,
              canonical_node_count: reviewResult.canonical_node_count,
              soft_review_count: reviewResult.soft_review_count,
              hard_error_count: reviewResult.hard_error_count,
              idempotent: reviewResult.idempotent,
              version_id: reviewResult.version_id,
              block_message: reviewResult.block_message,
            }
          : { status: "ORCHESTRATION_ERROR" },
      });
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

    if (!(await hasXEntitlement(poolId).catch(() => false))) {
      res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
    }

    const actorId = req.user!.userId;

    try {
      await ensureSubmission(poolId);

      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/website/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

      const { ok, error: r2Err } = await uploadToR2(r2Key, file.buffer, DOCX_MIME, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: r2Err }); return; }

      let fileId: string;
      let version: number;
      try {
        ({ fileId, version } = await uploadVersionedFile({
          poolId, actorId, fileType: "website", r2Key,
          rawOriginalFilename: file.originalname,
          safeName, mimeType: DOCX_MIME, fileSize: file.size,
          templateVersion: (req.body?.template_version as string | undefined) ?? null,
          submissionStatusCol: "website_status",
          submissionStatusValue: "SUBMITTED",
        }));
      } catch (dbErr) {
        await compensatingR2Cleanup({ r2Key, bucket: "photo", poolId, actorId, fileType: "website" });
        throw dbErr;
      }

      const isReupload = version > 1;
      await logXSetupAudit({
        action: isReupload ? "x_setup_reupload" : "x_setup_upload",
        poolId, actorId, fileId, fileType: "website", version,
        meta: { safe_name: safeName, file_size: file.size, r2_key: r2Key },
      });

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

    if (!(await hasXEntitlement(poolId).catch(() => false))) {
      res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
    }

    const actorId = req.user!.userId;

    try {
      await ensureSubmission(poolId);

      const safeName = sanitizeFilename(file.originalname);
      const r2Key = `x-setup/${poolId}/logo/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

      const { ok, error: r2Err } = await uploadToR2(r2Key, file.buffer, file.mimetype, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: r2Err }); return; }

      let fileId: string;
      let version: number;
      try {
        ({ fileId, version } = await uploadVersionedFile({
          poolId, actorId, fileType: "logo", r2Key,
          rawOriginalFilename: file.originalname,
          safeName, mimeType: file.mimetype, fileSize: file.size,
          submissionStatusCol: "logo_status",
          submissionStatusValue: "SUBMITTED",
        }));
      } catch (dbErr) {
        await compensatingR2Cleanup({ r2Key, bucket: "photo", poolId, actorId, fileType: "logo" });
        throw dbErr;
      }

      const isReupload = version > 1;
      await logXSetupAudit({
        action: isReupload ? "x_setup_reupload" : "x_setup_upload",
        poolId, actorId, fileId, fileType: "logo", version,
        meta: { safe_name: safeName, file_size: file.size, r2_key: r2Key },
      });

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

    if (!(await hasXEntitlement(poolId).catch(() => false))) {
      res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
    }

    const actorId = req.user!.userId;

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

      // ── Step 1: R2 upload ─────────────────────────────────────────────────
      const { ok, error: r2Err } = await uploadToR2(r2Key, file.buffer, file.mimetype, "photo");
      if (!ok) { res.status(503).json({ error: "파일 저장에 실패했습니다.", detail: r2Err }); return; }

      // ── Step 2: Atomic DB insert + submission update ──────────────────────
      const photoOrder = currentCount + 1;
      const photoTitle    = (req.body?.title as string | undefined) ?? null;
      const photoCategory = (req.body?.category as string | undefined) ?? null;
      const fileId = genId("xsf");

      try {
        await superAdminDb.transaction(async (tx) => {
          await tx.execute(sql`
            INSERT INTO x_setup_files
              (id, pool_id, file_type, r2_key, original_filename, raw_original_filename,
               mime_type, file_size_bytes, submission_version, is_current,
               photo_order, photo_title, photo_category, uploaded_by, uploaded_at)
            VALUES
              (${fileId}, ${poolId}, 'photo', ${r2Key}, ${safeName}, ${file.originalname},
               ${file.mimetype}, ${file.size}, 1, true,
               ${photoOrder}, ${photoTitle}, ${photoCategory}, ${actorId}, NOW())
          `);

          await tx.execute(sql`
            UPDATE x_setup_submissions
            SET photos_status = 'SUBMITTED', updated_at = NOW()
            WHERE pool_id = ${poolId}
          `);
        });
      } catch (dbErr) {
        // DB 실패 → 신규 R2 object 보상 삭제
        await compensatingR2Cleanup({ r2Key, bucket: "photo", poolId, actorId, fileType: "photo" });
        throw dbErr;
      }

      // ── Step 3: Audit log ─────────────────────────────────────────────────
      await logXSetupAudit({
        action: "x_setup_photo_upload",
        poolId, actorId, fileId, fileType: "photo",
        meta: { safe_name: safeName, photo_order: photoOrder, file_size: file.size },
      });

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

  if (!(await hasXEntitlement(poolId).catch(() => false))) {
    res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
  }

  const actorId = req.user!.userId;

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

    // Audit log
    await logXSetupAudit({
      action: "x_setup_photo_delete",
      poolId, actorId, fileId, fileType: "photo",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[x-setup/photos/delete]", err);
    res.status(500).json({ error: "삭제 오류" });
  }
});

// ── POST /x-setup/submit ───────────────────────────────────────────────────
router.post("/x-setup/submit", requireAuth, requireRole("pool_admin"), async (req: AuthRequest, res) => {
  const poolId = await getPoolId(req.user!.userId);
  if (!poolId) { res.status(403).json({ error: "소속된 수영장이 없습니다." }); return; }

  if (!(await hasXEntitlement(poolId).catch(() => false))) {
    res.status(403).json({ error: "SWIMNOTE X 전용 기능입니다.", code: "XMODE_REQUIRED" }); return;
  }

  const actorId = req.user!.userId;

  try {
    await ensureSubmission(poolId);

    await superAdminDb.execute(sql`
      UPDATE x_setup_submissions
      SET setup_status = 'SUBMITTED',
          submitted_at = COALESCE(submitted_at, NOW()),
          submitted_by = ${actorId},
          updated_at = NOW()
      WHERE pool_id = ${poolId}
    `);

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId}
    `)).rows as any[];

    // Audit log
    await logXSetupAudit({
      action: "x_setup_submit", poolId, actorId,
      meta: { setup_status: "SUBMITTED" },
    });

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
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id, name, x_paid_entitlement, x_manual_entitlement, xmode_config_status
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const [sub] = (await superAdminDb.execute(sql`
      SELECT * FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    // 현재 파일 + 이력 (삭제 포함) — raw_original_filename 포함
    const allFiles = (await superAdminDb.execute(sql`
      SELECT id, file_type, original_filename, raw_original_filename, mime_type, file_size_bytes,
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
// soft-deleted 파일도 Super Admin forensic 목적으로 download 허용
router.get("/super/x-setup/:poolId/files/:fileId/download", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { poolId, fileId } = req.params;
  try {
    // deleted_at 필터 없음 — soft-deleted 원본도 접근 가능 (forensic)
    const [file] = (await superAdminDb.execute(sql`
      SELECT id, r2_key, original_filename, raw_original_filename, mime_type, pool_id, deleted_at
      FROM x_setup_files WHERE id = ${fileId} AND pool_id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!file) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }

    const { ok, url, error } = await getPresignedUrl(file.r2_key, "photo", 300);
    if (!ok || !url) { res.status(503).json({ error: "다운로드 URL 생성 실패", detail: error }); return; }

    // 원본 파일명 우선 반환 (raw_original_filename이 있으면), 없으면 sanitized
    const displayFilename = file.raw_original_filename ?? file.original_filename;

    res.json({
      url,
      filename: displayFilename,
      original_filename: file.original_filename,
      raw_original_filename: file.raw_original_filename ?? null,
      mime_type: file.mime_type,
      is_deleted: !!file.deleted_at,
    });
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

  const actorId = req.user!.userId;

  try {
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    const revId = genId("xsr");
    await superAdminDb.execute(sql`
      INSERT INTO x_setup_revision_requests
        (id, pool_id, section, message, requested_by, requested_at, status)
      VALUES (${revId}, ${poolId}, ${section}, ${message.trim()}, ${actorId}, NOW(), 'PENDING')
    `);

    // 섹션 상태 → REVISION_REQUESTED
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

    // Audit log
    await logXSetupAudit({
      action: "x_setup_revision",
      poolId, actorId,
      meta: { section, message: message.trim(), revision_id: revId },
    });

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

  const actorId = req.user!.userId;

  try {
    const [pool] = (await superAdminDb.execute(sql`
      SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (!pool) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

    // 승인 전 현재 상태 캡처 (audit before/after)
    const [subBefore] = (await superAdminDb.execute(sql`
      SELECT curriculum_status, website_status, logo_status, photos_status, setup_status
      FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];

    if (section === "curriculum") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET curriculum_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "website") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET website_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "logo") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET logo_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    } else if (section === "photos") {
      await superAdminDb.execute(sql`UPDATE x_setup_submissions SET photos_status='APPROVED', updated_at=NOW() WHERE pool_id=${poolId}`);
    }

    const [sub] = (await superAdminDb.execute(sql`
      SELECT curriculum_status, website_status, logo_status, photos_status
      FROM x_setup_submissions WHERE pool_id = ${poolId} LIMIT 1
    `)).rows as any[];
    if (sub?.curriculum_status === "APPROVED" && sub?.website_status === "APPROVED") {
      await superAdminDb.execute(sql`
        UPDATE x_setup_submissions SET setup_status = 'APPROVED', updated_at = NOW()
        WHERE pool_id = ${poolId}
      `);
    }

    // ── curriculum section 승인 시에만: approve + activate + READY ──────────
    let activationResult: { status: string; block_message?: string } | null = null;
    if (section === "curriculum") {
      try {
        activationResult = await approveAndActivateLocalCurriculum(poolId, actorId);
      } catch (actErr) {
        console.error("[super/x-setup/approve] activation error:", actErr);
        activationResult = { status: "ACTIVATION_ERROR", block_message: String(actErr) };
      }
    }

    // Audit log (approve + 선택적 activate)
    await logXSetupAudit({
      action: section === "curriculum" && activationResult?.status !== "ACTIVATION_ERROR"
        ? "x_setup_activate"
        : "x_setup_approve",
      poolId, actorId,
      meta: {
        section,
        before_status: (subBefore as any)?.[`${section}_status`] ?? null,
        after_status: "APPROVED",
        ...(activationResult ? { activation_status: activationResult.status } : {}),
      },
    });

    res.json({
      ok: true,
      section,
      new_status: "APPROVED",
      ...(activationResult ? { activation: activationResult } : {}),
    });
  } catch (err) {
    console.error("[super/x-setup/approve]", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── Startup: DB migration + DOCX 템플릿 초기화 ──────────────────────────────
import("../migrations/pool-db-x-setup.js")
  .then(async ({ runXSetupMigration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runXSetupMigration(superAdminDb);
  })
  .catch((e: any) => console.error("[x-setup-init] migration failed:", e?.message));

import("../migrations/p0-file-durability.js")
  .then(async ({ runP0FileDurabilityMigration }) => {
    const { superAdminDb } = await import("@workspace/db");
    return runP0FileDurabilityMigration(superAdminDb);
  })
  .catch((e: any) => console.error("[x-setup-init] p0-durability migration failed:", e?.message));

import("../lib/xSetupTemplates.js")
  .then(({ ensureXSetupTemplates }) => ensureXSetupTemplates())
  .catch((e: any) => console.error("[x-setup-init] template upload failed:", e?.message));

export default router;
