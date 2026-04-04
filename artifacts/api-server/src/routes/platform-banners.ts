/**
 * platform-banners.ts
 * 슈퍼관리자 전용 플랫폼 배너 CRUD + 학부모 공개 조회
 *
 * Public:
 *   GET /platform/banners          — 활성 배너 목록 (학부모 앱에서 호출)
 *
 * Super-admin only:
 *   GET    /super/banners          — 전체 배너 목록
 *   POST   /super/banners          — 배너 생성
 *   PUT    /super/banners/:id      — 배너 수정
 *   PATCH  /super/banners/:id/status — 상태 변경
 *   DELETE /super/banners/:id      — 배너 삭제
 */
import { Router } from "express";
import { superAdminDb } from "@workspace/db";
import { platformBannersTable } from "@workspace/db/schema";
import { eq, and, lte, gte, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router = Router();
const SUPER_ROLES = ["super_admin", "platform_admin", "super_manager"];

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

// ── PUBLIC: 활성 배너 목록 (학부모 앱 호출) ─────────────────────────────
router.get("/platform/banners", async (req, res) => {
  try {
    const now = new Date();
    const rows = await superAdminDb
      .select()
      .from(platformBannersTable)
      .where(
        and(
          eq(platformBannersTable.status, "active"),
          lte(platformBannersTable.display_start, now),
          gte(platformBannersTable.display_end, now)
        )
      )
      .orderBy(platformBannersTable.sort_order, desc(platformBannersTable.created_at));
    return res.json({ success: true, banners: rows });
  } catch (e: any) {
    console.error("[platform-banners] 조회 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 전체 배너 목록 ──────────────────────────────────────────────
router.get("/super/banners", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  try {
    const rows = await superAdminDb
      .select()
      .from(platformBannersTable)
      .orderBy(desc(platformBannersTable.created_at));
    return res.json({ success: true, banners: rows });
  } catch (e: any) {
    console.error("[super-banners] 목록 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

// ── SUPER: 배너 생성 ────────────────────────────────────────────────────
router.post("/super/banners", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { title, description, image_url, link_url, link_label,
          color_theme, target, status, display_start, display_end, sort_order } = req.body;
  if (!title) return err(res, 400, "제목이 필요합니다.");
  if (!display_start || !display_end) return err(res, 400, "노출 기간이 필요합니다.");
  try {
    const id = `banner_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const [row] = await superAdminDb.insert(platformBannersTable).values({
      id,
      title: title.trim(),
      description: description?.trim() ?? null,
      image_url: image_url ?? null,
      link_url: link_url?.trim() ?? null,
      link_label: link_label?.trim() ?? null,
      color_theme: color_theme ?? "teal",
      target: target ?? "all",
      status: status ?? "inactive",
      display_start: new Date(display_start),
      display_end: new Date(display_end),
      sort_order: sort_order ?? 0,
      created_by: req.user!.id,
    } as any).returning();
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
  const { title, description, image_url, link_url, link_label,
          color_theme, target, status, display_start, display_end, sort_order } = req.body;
  try {
    const patch: any = { updated_at: new Date() };
    if (title !== undefined)        patch.title = title.trim();
    if (description !== undefined)  patch.description = description?.trim() ?? null;
    if (image_url !== undefined)    patch.image_url = image_url ?? null;
    if (link_url !== undefined)     patch.link_url = link_url?.trim() ?? null;
    if (link_label !== undefined)   patch.link_label = link_label?.trim() ?? null;
    if (color_theme !== undefined)  patch.color_theme = color_theme;
    if (target !== undefined)       patch.target = target;
    if (status !== undefined)       patch.status = status;
    if (display_start !== undefined) patch.display_start = new Date(display_start);
    if (display_end !== undefined)  patch.display_end = new Date(display_end);
    if (sort_order !== undefined)   patch.sort_order = sort_order;

    const [row] = await superAdminDb
      .update(platformBannersTable)
      .set(patch)
      .where(eq(platformBannersTable.id, id))
      .returning();
    if (!row) return err(res, 404, "배너를 찾을 수 없습니다.");
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

// ── SUPER: 배너 삭제 ────────────────────────────────────────────────────
router.delete("/super/banners/:id", requireAuth, async (req: AuthRequest, res) => {
  if (!requireSuper(req, res)) return;
  const { id } = req.params;
  try {
    await superAdminDb.delete(platformBannersTable).where(eq(platformBannersTable.id, id));
    return res.json({ success: true });
  } catch (e: any) {
    console.error("[super-banners] 삭제 오류:", e);
    return err(res, 500, "서버 오류");
  }
});

export default router;
