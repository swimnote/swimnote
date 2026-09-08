import { Router, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { uploadToR2, downloadFromR2, getPresignedPutUrl } from "../lib/objectStorage.js";
import { superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/", requireAuth, upload.array("images", 5), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    if (files.length > 5) { res.status(400).json({ error: "사진은 최대 5장까지 첨부 가능합니다." }); return; }

    // ── 스토리지 초과 차단 체크 (WP2A: unified photo+video quota) ──────
    const poolId = req.user?.poolId;
    if (poolId) {
      // Fast-path: check upload_blocked flag first
      const [poolRow] = (await superAdminDb.execute(sql`
        SELECT upload_blocked FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)).rows as any[];

      if (poolRow?.upload_blocked) {
        res.status(403).json({
          error: "저장공간이 가득 차 업로드가 제한됩니다.",
          code: "UPLOAD_BLOCKED",
          storage_full: true,
        });
        return;
      }

      // Unified quota check (photo_assets_meta + student_photos + video_assets_meta)
      const { checkAndUpdateUploadBlocked, getPoolStorageUsage } = await import("../lib/storageQuota.js");
      const usage = await getPoolStorageUsage(poolId);
      const pct   = usage.pct;

      if (pct >= 100) {
        await checkAndUpdateUploadBlocked(poolId);
        res.status(403).json({
          error: "저장공간이 가득 차 업로드가 제한됩니다.",
          code: "UPLOAD_BLOCKED",
          storage_pct: pct,
          storage_full: true,
        });
        return;
      }

      if (pct >= 80) res.setHeader("X-Storage-Warning", `${pct}`);
      if (pct >= 80) res.setHeader("X-Storage-Pct", `${pct}`);

      // 업로드 급증 감지: 24h 동안 300건 초과 시 경고 플래그
      const spikeEnabled = await isFeatureEnabled("upload_spike_detection", poolId).catch(() => false);
      if (spikeEnabled) {
        const [spikeRow] = (await superAdminDb.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM student_photos
          WHERE swimming_pool_id = ${poolId}
            AND created_at >= NOW() - INTERVAL '24 hours'
        `)).rows as any[];
        const cnt24h = Number(spikeRow?.cnt ?? 0);
        if (cnt24h > 300) {
          await superAdminDb.execute(sql`
            UPDATE swimming_pools
            SET metadata = COALESCE(metadata, '{}'::jsonb) ||
              jsonb_build_object('upload_spike_detected', true, 'spike_at', NOW()::text, 'spike_24h_count', ${cnt24h})
            WHERE id = ${poolId}
          `).catch(() => {});
          res.setHeader("X-Upload-Spike", "true");
          console.warn(`[upload-spike] pool ${poolId}: ${cnt24h}건/24h 급증 감지`);
        }
      }
    }

    // new_upload_structure 플래그: v2 경로 사용 (notices → uploads/v2)
    const useV2Path = await isFeatureEnabled("new_upload_structure", poolId ?? null).catch(() => false);
    const pathPrefix = useV2Path ? `uploads/v2` : `notices`;

    const urls: string[] = [];
    for (const file of files) {
      const ext = file.originalname.split(".").pop() || "jpg";
      const key = `${pathPrefix}/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const { ok, error } = await uploadToR2(key, file.buffer, file.mimetype || "image/jpeg", "photo");
      if (!ok) throw new Error(error || "업로드 실패");
      urls.push(key);
    }
    res.json({ urls });
  } catch (err) { console.error(err); res.status(500).json({ error: "업로드 중 오류가 발생했습니다." }); }
});

// ── POST /uploads/presigned — Notice image direct-upload sessions ─────────
// Generates presigned PUT URLs so the app can PUT notice images directly to
// R2 without Render acting as a binary proxy.
// The app stores the returned object_key values in the notice's image_urls
// field (same format as before). Display via GET /uploads/:key is unchanged.
const NOTICE_ALLOWED_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "image/heic", "image/heif",
]);
const NOTICE_MAX_FILES = 5;
const NOTICE_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const NOTICE_PRESIGNED_TTL_S = 5 * 60; // 5 minutes

router.post("/presigned", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const poolId = req.user?.poolId;
    const files = req.body?.files as Array<{
      client_id?: unknown;
      file_type?: unknown;
      file_size?: unknown;
    }> | undefined;

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: "files 배열이 필요합니다." }); return;
    }
    if (files.length > NOTICE_MAX_FILES) {
      res.status(400).json({ error: `파일은 최대 ${NOTICE_MAX_FILES}개까지 업로드할 수 있습니다.` }); return;
    }

    for (const f of files) {
      if (typeof f.client_id !== "string" || f.client_id.length === 0 || f.client_id.length > 64) {
        res.status(400).json({ error: "client_id가 유효하지 않습니다." }); return;
      }
      if (typeof f.file_type !== "string" || !NOTICE_ALLOWED_MIMES.has(f.file_type)) {
        res.status(400).json({ error: `허용되지 않는 파일 형식: ${f.file_type}` }); return;
      }
      const sz = Number(f.file_size ?? 0);
      if (!Number.isFinite(sz) || sz <= 0 || sz > NOTICE_MAX_FILE_BYTES) {
        res.status(400).json({ error: "파일 크기가 유효하지 않습니다." }); return;
      }
    }

    // Optional quota guard (same fast-path as the multipart /uploads route)
    if (poolId) {
      const [poolRow] = (await superAdminDb.execute(sql`
        SELECT upload_blocked FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (poolRow?.upload_blocked) {
        res.status(403).json({ error: "저장공간이 가득 차 업로드가 제한됩니다.", code: "UPLOAD_BLOCKED" }); return;
      }
    }

    const t0 = Date.now();
    const items: Array<{
      client_id: string;
      object_key: string;
      upload_url: string;
      headers: { "Content-Type": string };
    }> = [];

    for (const f of files as Array<{ client_id: string; file_type: string; file_size: number }>) {
      // Normalise extension: heic → heic, image/jpeg → jpg, etc.
      const rawExt = f.file_type.split("/")[1] ?? "jpg";
      const ext = rawExt === "jpeg" ? "jpg" : rawExt;
      const uuid = crypto.randomUUID();
      // Use the same path prefix that the multipart route uses so that
      // GET /uploads/:key continues to serve these files without changes.
      const useV2Path = false; // presigned always uses notices/ prefix for now
      const objectKey = `notices/${poolId ?? "global"}/${uuid}.${ext}`;

      const { ok, url, error } = await getPresignedPutUrl(
        objectKey,
        f.file_type,
        f.file_size,
        NOTICE_PRESIGNED_TTL_S,
      );
      if (!ok || !url) {
        res.status(500).json({ error: `presigned URL 생성 실패: ${error}` }); return;
      }

      items.push({
        client_id: f.client_id,
        object_key: objectKey,
        upload_url: url,
        headers: { "Content-Type": f.file_type },
      });
    }

    console.log(`[uploads/presigned] files=${items.length} latency=${Date.now() - t0}ms pool=${poolId ?? "none"}`);
    res.json({ items });
  } catch (err) {
    console.error("[uploads/presigned]", err);
    res.status(500).json({ error: "presigned URL 생성 중 오류가 발생했습니다." });
  }
});

router.get(/^\/(.+)$/, async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    if (!key) { res.status(400).json({ error: "잘못된 요청입니다." }); return; }
    const { ok, data } = await downloadFromR2(key, "photo");
    if (!ok || !data) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }
    const ext = key.split(".").pop()?.toLowerCase() || "jpg";
    const mime: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif",
      mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
      mkv: "video/x-matroska", webm: "video/webm", m4v: "video/x-m4v",
    };
    const mimeType = mime[ext] || "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (mimeType.startsWith("video/")) res.setHeader("Accept-Ranges", "bytes");
    res.send(data);
  } catch (err) { res.status(500).json({ error: "파일 조회 중 오류가 발생했습니다." }); }
});

export default router;
