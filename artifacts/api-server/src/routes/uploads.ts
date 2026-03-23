import { Router, Request, Response } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

router.post("/", requireAuth, upload.array("images", 5), async (req: AuthRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: "파일을 선택해주세요." }); return; }
    if (files.length > 5) { res.status(400).json({ error: "사진은 최대 5장까지 첨부 가능합니다." }); return; }

    // ── 스토리지 초과 차단 체크 ──────────────────────────────────────
    const poolId = req.user?.poolId;
    if (poolId) {
      const [poolRow] = (await db.execute(sql`
        SELECT p.upload_blocked, p.used_storage_bytes, p.extra_storage_gb,
               sp.storage_gb
        FROM swimming_pools p
        LEFT JOIN subscription_plans sp ON sp.tier = p.subscription_tier
        WHERE p.id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (poolRow?.upload_blocked) {
        res.status(403).json({
          error: "저장공간이 가득 차 업로드가 제한됩니다. 추가 용량을 구매하거나 플랜을 업그레이드해주세요.",
          code: "UPLOAD_BLOCKED",
        });
        return;
      }
      // 90% 이상 시 경고 헤더 추가 (업로드는 허용)
      const quotaBytes = (Number(poolRow?.storage_gb ?? 0.1) + Number(poolRow?.extra_storage_gb ?? 0)) * 1024 ** 3;
      const usedBytes = Number(poolRow?.used_storage_bytes ?? 0);
      const pct = quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0;
      if (pct >= 90) res.setHeader("X-Storage-Warning", `${pct}%`);
    }
    const client = getClient();
    const urls: string[] = [];
    for (const file of files) {
      const ext = file.originalname.split(".").pop() || "jpg";
      const key = `notices/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
      const { ok, error } = await client.uploadFromBuffer(file.buffer, key, { contentType: file.mimetype });
      if (!ok) throw new Error(error?.message || "업로드 실패");
      urls.push(key);
    }
    res.json({ urls });
  } catch (err) { console.error(err); res.status(500).json({ error: "업로드 중 오류가 발생했습니다." }); }
});

router.get(/^\/(.+)$/, async (req: Request, res: Response) => {
  try {
    const key = (req.params as any)[0];
    if (!key) { res.status(400).json({ error: "잘못된 요청입니다." }); return; }
    const client = getClient();
    const { ok, value } = await client.downloadAsBytes(key);
    if (!ok || !value) { res.status(404).json({ error: "파일을 찾을 수 없습니다." }); return; }
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
    res.send(Buffer.from(value));
  } catch (err) { res.status(500).json({ error: "파일 조회 중 오류가 발생했습니다." }); }
});

export default router;
