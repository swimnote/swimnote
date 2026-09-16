/**
 * platform-banners.ts
 * 슈퍼관리자 전용 플랫폼 배너 CRUD + 학부모 공개 조회 + 이미지 업로드
 *
 * Public (authenticated):
 *   GET /platform/banners?type=strip|slider   — 활성 배너 목록 (학부모 앱)
 *
 * Super-admin only:
 *   POST   /super/banner-upload               — 배너 이미지 업로드
 *   GET    /super/banners                     — 전체 배너 목록 (type 파라미터 선택)
 *   POST   /super/banners                     — 배너 생성
 *   PUT    /super/banners/:id                 — 배너 수정
 *   PATCH  /super/banners/:id/status          — 상태 변경
 *   PATCH  /super/banners/:id/order           — sort_order 변경
 *   DELETE /super/banners/:id                 — 배너 삭제
 */
import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { superAdminDb } from "@workspace/db";
import { platformBannersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const SUPER_ROLES = ["super_admin", "platform_admin", "super_manager"];

const ALLOWED_LINK_TYPES = ["none", "external", "internal"] as const;
const SAFE_URL_RE = /^https?:\/\//i;
const DISPLAY_SEC_MIN = 3;
const DISPLAY_SEC_MAX = 30;

let _storage: Client | null = null;
function getStorage() { if (!_storage) _storage = new Client(); return _storage; }

function err(res: any, status: number, msg: string) {
  return res.status(status).json({ success: false, message: msg });
}
function requireSuper(req: AuthRequest, res: any): boolean {
  if (!req.user || !SUPER_ROLES.includes(req.user.role)) {
    err(res, 403, "슈퍼관리자 권한이 필요합니다.");
    return false;
  }
  return true;
}

/** display_seconds 범위 방어 (3~30, 기본 5) */
function clampDisplaySeconds(v: any): number {
  const n = parseInt(v as any, 10);
  if (isNaN(n)) return 5;
  return Math.max(DISPLAY_SEC_MIN, Math.min(DISPLAY_SEC_MAX, n));
}

/** 링크 유효성 검사 */
function validateLink(linkType: string | undefined, linkUrl: string | undefined): string | null {
  if (!linkType || linkType === "none") return null;
  if (linkType === "external") {
    if (linkUrl && !SAFE_URL_RE.test(linkUrl.trim())) {
      return "외부 링크는 https:// 로 시작해야 합니다.";
    }
  }
  return null;
}

// ── SUPER: 배너 이미지 업로드 ──────────────────────────────────────────
router.post("/super/banner-upload", requireAuth, upload.single("image"), async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const file = req.file;
    if (!file) return err(res, 400, "이미지 파일이 필요합니다.");
    const ext = file.originalname.split(".").pop()?.toLowerCase() || "jpg";
    const allowedExts = ["jpg", "jpeg", "png", "webp"];
    if (!allowedExts.includes(ext)) return err(res, 400, "jpg/png/webp 파일만 가능합니다.");

    const key = `banner-images/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.${ext}`;
    const client = getStorage();
    const { ok, error } = await client.uploadFromBytes(key, file.buffer);
    if (!ok) throw new Error(error?.message || "업로드 실패");

    return res.json({ success: true, key, url: key });
  } catch (e: any) {
    console.error("[banner-upload] 오류:", e);
    return err(res, 500, "업로드 중 오류가 발생했습니다.");
  }
});

// ── PUBLIC/AUTHENTICATED: 활성 배너 목록 (학부모 앱 호출) ───────────────
// display_start/end nullable: NULL = 기간 제한 없음
// 정렬: sort_order ASC, created_at ASC
router.get("/platform/banners", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bannerType = (req.query.type as string) || null;
    const userRole = req.user!.role;

    // Raw SQL로 nullable date 조건 처리
    const typeClause = bannerType
      ? sql`AND banner_type = ${bannerType}`
      : sql``;

    const rows = await superAdminDb.execute(sql`
      SELECT *
      FROM platform_banners
      WHERE status = 'active'
        AND (display_start IS NULL OR display_start <= NOW())
        AND (display_end   IS NULL OR display_end   >  NOW())
        ${typeClause}
      ORDER BY sort_order ASC, created_at ASC
    `);

    // server-side target filtering
    const banners = (rows.rows as any[]).filter(b => {
      const target: string = b.target ?? "all";
      return target === "all" || target === userRole;
    });

    return res.json({ success: true, banners });
  } catch (e: any) {
    console.error("[platform-banners] 조회 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 전체 배너 목록 ──────────────────────────────────────────────
router.get("/super/banners", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const bannerType = (req.query.type as string) || null;

    const typeClause = bannerType
      ? sql`AND banner_type = ${bannerType}`
      : sql``;

    const rows = await superAdminDb.execute(sql`
      SELECT * FROM platform_banners
      WHERE 1=1 ${typeClause}
      ORDER BY sort_order ASC, created_at DESC
    `);

    return res.json({ success: true, banners: rows.rows });
  } catch (e: any) {
    console.error("[super-banners] 목록 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 생성 ────────────────────────────────────────────────────
router.post("/super/banners", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const {
      banner_type = "slider",
      title, description,
      image_url, image_key,
      link_type = "external",
      link_url, link_label,
      color_theme = "teal",
      target = "all",
      status = "inactive",
      display_start, display_end,
      display_seconds,
      sort_order = 0,
    } = req.body;

    if (!title?.trim()) return err(res, 400, "제목은 필수입니다.");

    const linkErr = validateLink(link_type, link_url);
    if (linkErr) return err(res, 400, linkErr);

    const dispSec = clampDisplaySeconds(display_seconds ?? 5);

    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    await superAdminDb.execute(sql`
      INSERT INTO platform_banners
        (id, banner_type, title, description, image_url, image_key,
         link_type, link_url, link_label, color_theme, target, status,
         display_start, display_end, display_seconds, sort_order,
         created_by, created_at, updated_at)
      VALUES (
        ${id}, ${banner_type}, ${title.trim()},
        ${description?.trim() ?? null}, ${image_url ?? null}, ${image_key ?? null},
        ${link_type}, ${link_url?.trim() ?? null}, ${link_label?.trim() ?? null},
        ${color_theme}, ${target}, ${status},
        ${display_start ? new Date(display_start) : null},
        ${display_end   ? new Date(display_end)   : null},
        ${dispSec}, ${sort_order},
        ${req.user!.id}, NOW(), NOW()
      )
    `);

    const [row] = await superAdminDb
      .select()
      .from(platformBannersTable)
      .where(eq(platformBannersTable.id, id));

    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, actor_id, after_data)
      VALUES ('platform_banner', ${id}, 'create', 'super_admin', ${req.user!.id},
              ${JSON.stringify({ title: title.trim(), banner_type, status })}::jsonb)
    `).catch(() => {});

    return res.status(201).json({ success: true, banner: row });
  } catch (e: any) {
    console.error("[super-banners] 생성 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 수정 ────────────────────────────────────────────────────
router.put("/super/banners/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { id } = req.params;
  try {
    const {
      title, description, image_url, image_key,
      link_type, link_url, link_label,
      color_theme, target, status,
      display_start, display_end, display_seconds,
      sort_order, banner_type,
    } = req.body;

    if (link_type !== undefined) {
      const linkErr = validateLink(link_type, link_url);
      if (linkErr) return err(res, 400, linkErr);
    }

    const patch: Record<string, any> = { updated_at: new Date() };
    if (title !== undefined)           patch.title = title.trim();
    if (description !== undefined)     patch.description = description?.trim() ?? null;
    if (image_url !== undefined)       patch.image_url = image_url ?? null;
    if (image_key !== undefined)       patch.image_key = image_key ?? null;
    if (link_type !== undefined)       patch.link_type = link_type;
    if (link_url !== undefined)        patch.link_url = link_url?.trim() ?? null;
    if (link_label !== undefined)      patch.link_label = link_label?.trim() ?? null;
    if (color_theme !== undefined)     patch.color_theme = color_theme;
    if (target !== undefined)          patch.target = target;
    if ("target_pool_id" in req.body)  patch.target_pool_id = req.body.target_pool_id ?? null;
    if (status !== undefined)          patch.status = status;
    if (display_start !== undefined)   patch.display_start = display_start ? new Date(display_start) : null;
    if (display_end !== undefined)     patch.display_end = display_end ? new Date(display_end) : null;
    if (display_seconds !== undefined) patch.display_seconds = clampDisplaySeconds(display_seconds);
    if (sort_order !== undefined)      patch.sort_order = sort_order;
    if (banner_type !== undefined)     patch.banner_type = banner_type;

    const [row] = await superAdminDb
      .update(platformBannersTable)
      .set(patch as any)
      .where(eq(platformBannersTable.id, id))
      .returning();

    if (!row) return err(res, 404, "배너를 찾을 수 없습니다.");

    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, actor_id, after_data)
      VALUES ('platform_banner', ${id}, 'update', 'super_admin', ${req.user!.id},
              ${JSON.stringify(patch)}::jsonb)
    `).catch(() => {});

    return res.json({ success: true, banner: row });
  } catch (e: any) {
    console.error("[super-banners] 수정 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 상태 변경 ───────────────────────────────────────────────
router.patch("/super/banners/:id/status", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { id } = req.params;
  const { status } = req.body;
  if (!["active", "scheduled", "inactive"].includes(status)) return err(res, 400, "올바른 상태값이 아닙니다.");
  try {
    const [row] = await superAdminDb
      .update(platformBannersTable)
      .set({ status, updated_at: new Date() } as any)
      .where(eq(platformBannersTable.id, id))
      .returning();
    if (!row) return err(res, 404, "배너를 찾을 수 없습니다.");
    return res.json({ success: true, banner: row });
  } catch (e: any) {
    console.error("[super-banners] 상태 변경 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 순서 변경 ───────────────────────────────────────────────
router.patch("/super/banners/:id/order", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { id } = req.params;
  const { sort_order } = req.body;
  if (typeof sort_order !== "number") return err(res, 400, "sort_order는 숫자여야 합니다.");
  try {
    const [row] = await superAdminDb
      .update(platformBannersTable)
      .set({ sort_order, updated_at: new Date() } as any)
      .where(eq(platformBannersTable.id, id))
      .returning();
    if (!row) return err(res, 404, "배너를 찾을 수 없습니다.");
    return res.json({ success: true, banner: row });
  } catch (e: any) {
    console.error("[super-banners] 순서 변경 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 삭제 ────────────────────────────────────────────────────
router.delete("/super/banners/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { id } = req.params;
  try {
    const [before] = await superAdminDb
      .select({ title: platformBannersTable.title, status: platformBannersTable.status })
      .from(platformBannersTable)
      .where(eq(platformBannersTable.id, id));

    const [row] = await superAdminDb
      .update(platformBannersTable)
      .set({ status: "inactive", updated_at: new Date() } as any)
      .where(eq(platformBannersTable.id, id))
      .returning();
    if (!row) return err(res, 404, "배너를 찾을 수 없습니다.");

    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (entity_type, entity_id, action, actor_type, actor_id, before_data)
      VALUES ('platform_banner', ${id}, 'update', 'super_admin', ${req.user!.id},
              ${JSON.stringify({ title: (before as any)?.title, status: (before as any)?.status, _op: "deactivate" })}::jsonb)
    `).catch(() => {});

    return res.json({ success: true });
  } catch (e: any) {
    console.error("[super-banners] 삭제 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

export default router;
