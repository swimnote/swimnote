/**
 * push-settings.ts — 푸시 알림 설정 API
 *
 * GET  /push-settings          — 내 푸시 설정 조회
 * PUT  /push-settings          — 내 푸시 설정 변경
 * GET  /push-settings/pool     — 풀 푸시 발송 설정 조회 (관리자)
 * PUT  /push-settings/pool     — 풀 푸시 발송 설정 변경 (관리자)
 * GET  /push-settings/logs     — 최근 푸시 로그 (관리자)
 */
import { Router, Response } from "express";
import { db, superAdminDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── 내 푸시 설정 조회 ────────────────────────────────────────────────
router.get("/push-settings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const isParent = role === "parent_account";
    const col = isParent ? "parent_account_id" : "user_id";
    const id  = userId; // parent_account 토큰의 userId = parent_account.id

    const rows = await db.execute(sql`
      SELECT notification_type, is_enabled FROM push_settings
      WHERE ${sql.raw(col)} = ${id}
    `);
    const settings: Record<string, boolean> = {};
    for (const r of rows.rows as any[]) {
      settings[r.notification_type] = Boolean(r.is_enabled);
    }
    return res.json({ success: true, settings });
  } catch (e) {
    console.error("[push-settings GET]", e);
    return res.status(500).json({ error: "서버 오류" });
  }
});

// ── 내 푸시 설정 변경 ────────────────────────────────────────────────
router.put("/push-settings", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, role } = req.user!;
    const isParent = role === "parent_account";
    const col = isParent ? "parent_account_id" : "user_id";
    const id  = userId;
    const { settings } = req.body as { settings: Record<string, boolean> };
    if (!settings || typeof settings !== "object") {
      return res.status(400).json({ error: "settings 필드가 필요합니다." });
    }
    for (const [type, enabled] of Object.entries(settings)) {
      const psId = `ps_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      if (isParent) {
        await db.execute(sql`
          INSERT INTO push_settings (id, parent_account_id, notification_type, is_enabled, updated_at)
          VALUES (${psId}, ${id}, ${type}, ${Boolean(enabled)}, now())
          ON CONFLICT (parent_account_id, notification_type) WHERE parent_account_id IS NOT NULL
          DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
        `);
      } else {
        await db.execute(sql`
          INSERT INTO push_settings (id, user_id, notification_type, is_enabled, updated_at)
          VALUES (${psId}, ${id}, ${type}, ${Boolean(enabled)}, now())
          ON CONFLICT (user_id, notification_type) WHERE user_id IS NOT NULL
          DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = now()
        `);
      }
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("[push-settings PUT]", e);
    return res.status(500).json({ error: "서버 오류" });
  }
});

// ── 풀 푸시 발송 설정 조회 ───────────────────────────────────────────
router.get(
  "/push-settings/pool",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager", "pool_admin", "sub_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId, role } = req.user!;
      let poolId: string | null = null;
      if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
        poolId = (req.query.pool_id as string) || null;
      } else {
        const u = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
        poolId = (u.rows[0] as any)?.swimming_pool_id || null;
      }
      if (!poolId) return res.status(400).json({ error: "pool_id가 필요합니다." });

      const rows = await db.execute(sql`
        SELECT * FROM pool_push_settings WHERE pool_id = ${poolId} LIMIT 1
      `);
      const defaults = {
        pool_id: poolId,
        prev_day_push_time: "20:00",
        same_day_push_offset: 1,
        tpl_notice: "📢 새 공지사항이 등록되었습니다.",
        tpl_prev_day: "📅 내일 수업이 있습니다. 준비하세요!",
        tpl_same_day: "⏰ 오늘 수업 {offset}시간 전입니다.",
        tpl_diary: "📒 새 수업 일지가 작성되었습니다.",
        tpl_photo: "📸 새 사진이 업로드되었습니다.",
      };
      const setting = rows.rows.length ? { ...defaults, ...rows.rows[0] } : defaults;
      return res.json({ success: true, setting });
    } catch (e) {
      console.error("[push-settings/pool GET]", e);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── 풀 푸시 발송 설정 변경 ───────────────────────────────────────────
router.put(
  "/push-settings/pool",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager", "pool_admin", "sub_admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { userId, role } = req.user!;
      let poolId: string | null = null;
      if (["super_admin", "platform_admin", "super_manager"].includes(role)) {
        poolId = req.body.pool_id;
      } else {
        const u = await superAdminDb.execute(sql`SELECT swimming_pool_id FROM users WHERE id = ${userId}`);
        poolId = (u.rows[0] as any)?.swimming_pool_id || null;
      }
      if (!poolId) return res.status(400).json({ error: "pool_id가 필요합니다." });

      const {
        prev_day_push_time, same_day_push_offset,
        tpl_notice, tpl_prev_day, tpl_same_day, tpl_diary, tpl_photo,
      } = req.body;

      const id = `pps_${Date.now()}`;
      await db.execute(sql`
        INSERT INTO pool_push_settings
          (id, pool_id, prev_day_push_time, same_day_push_offset,
           tpl_notice, tpl_prev_day, tpl_same_day, tpl_diary, tpl_photo, updated_at)
        VALUES
          (${id}, ${poolId},
           ${prev_day_push_time || "20:00"}, ${same_day_push_offset ?? 1},
           ${tpl_notice || "📢 새 공지사항이 등록되었습니다."},
           ${tpl_prev_day || "📅 내일 수업이 있습니다. 준비하세요!"},
           ${tpl_same_day || "⏰ 오늘 수업 {offset}시간 전입니다."},
           ${tpl_diary || "📒 새 수업 일지가 작성되었습니다."},
           ${tpl_photo || "📸 새 사진이 업로드되었습니다."},
           now())
        ON CONFLICT (pool_id) DO UPDATE SET
          prev_day_push_time   = EXCLUDED.prev_day_push_time,
          same_day_push_offset = EXCLUDED.same_day_push_offset,
          tpl_notice   = EXCLUDED.tpl_notice,
          tpl_prev_day = EXCLUDED.tpl_prev_day,
          tpl_same_day = EXCLUDED.tpl_same_day,
          tpl_diary    = EXCLUDED.tpl_diary,
          tpl_photo    = EXCLUDED.tpl_photo,
          updated_at   = now()
      `);
      return res.json({ success: true });
    } catch (e) {
      console.error("[push-settings/pool PUT]", e);
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── 최근 푸시 로그 ───────────────────────────────────────────────────
router.get(
  "/push-settings/logs",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager", "pool_admin"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const rows = await superAdminDb.execute(sql`
        SELECT * FROM push_logs ORDER BY created_at DESC LIMIT 100
      `);
      return res.json({ success: true, logs: rows.rows });
    } catch (e) {
      return res.status(500).json({ error: "서버 오류" });
    }
  }
);

export default router;
