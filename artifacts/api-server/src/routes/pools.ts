import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { db } from "@workspace/db";
import { swimmingPoolsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { sanitizePoolName } from "../utils/filename.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

// ── 수영장 이름 검색 (공개 API — 학부모 가입 시 사용) ──────────────────
router.get("/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q || q.length < 1) { res.json([]); return; }
  try {
    const rows = await db.execute(sql`
      SELECT id, name, address, phone
      FROM swimming_pools
      WHERE approval_status = 'approved'
        AND (name ILIKE ${"%" + q + "%"} OR address ILIKE ${"%" + q + "%"})
      ORDER BY name
      LIMIT 20
    `);
    res.json(rows.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 수영장 등록 신청 (기본 정보만 입력, JSON) ─────────────────────────
router.post("/apply", requireAuth,
  async (req: AuthRequest, res) => {
    const { name, name_en, address, phone, owner_name, admin_name, admin_email, admin_phone } = req.body;
    if (!name || !address || !phone || !owner_name || !admin_name || !admin_email) {
      return res.status(400).json({ success: false, message: "모든 필수 항목을 입력해주세요.", error: "필수 항목 누락" });
    }
    try {
      const user = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user[0]) return res.status(404).json({ success: false, message: "사용자를 찾을 수 없습니다.", error: "사용자 없음" });

      const id = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const resolvedNameEn = name_en?.trim()
        ? name_en.trim().toLowerCase().replace(/[^a-z0-9_]/g, "")
        : sanitizePoolName(name);

      const safeAdminPhone = admin_phone?.trim() || null;
      const rows = await db.execute(sql`
        INSERT INTO swimming_pools
          (id, name, name_en, address, phone, owner_name, owner_email, admin_name, admin_email, admin_phone, approval_status, subscription_status)
        VALUES
          (${id}, ${name}, ${resolvedNameEn}, ${address}, ${phone}, ${owner_name}, ${admin_email}, ${admin_name}, ${admin_email}, ${safeAdminPhone}, 'pending', 'trial')
        RETURNING *
      `);

      await db.update(usersTable).set({ swimming_pool_id: id }).where(eq(usersTable.id, req.user!.userId));
      res.status(201).json({ success: true, data: rows.rows[0], admin_name, admin_email, admin_phone });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "서버 오류가 발생했습니다.", error: String(err) });
    }
  }
);

// ── 내 수영장 정보 조회 ───────────────────────────────────────────────
router.get("/my", requireAuth, async (req: AuthRequest, res) => {
  try {
    const user = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
    if (!user[0]?.swimming_pool_id) {
      res.status(404).json({ error: "소속된 수영장이 없습니다." }); return;
    }
    const rows = await db.execute(sql`SELECT * FROM swimming_pools WHERE id = ${user[0].swimming_pool_id}`);
    if (!rows.rows.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    res.json(rows.rows[0]);
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 수영장 설정 조회 ──────────────────────────────────────────────────
router.get("/settings", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(404).json({ error: "소속 수영장 없음" }); return; }
      const rows = await db.execute(sql`SELECT * FROM swimming_pools WHERE id = ${user.swimming_pool_id}`);
      if (!rows.rows.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
      res.json(rows.rows[0]);
    } catch (err) { res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 수영장 설정 수정 ──────────────────────────────────────────────────
router.put("/settings", requireAuth, requireRole("pool_admin", "super_admin"),
  upload.single("business_reg_image"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(404).json({ error: "소속 수영장 없음" }); return; }

      const { name, name_en, address, phone, owner_name } = req.body;

      let imageKey: string | null = null;
      if (req.file) {
        const client = getClient();
        const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
        const key = `docs/business_reg/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
        const { ok } = await client.uploadFromBuffer(req.file.buffer, key, { contentType: req.file.mimetype });
        if (ok) imageKey = key;
      }

      const cleanNameEn = name_en ? name_en.toLowerCase().replace(/[^a-z0-9_]/g, "") : null;

      const rows = await db.execute(sql`
        UPDATE swimming_pools SET
          name       = COALESCE(NULLIF(${name?.trim() || ''}, ''), name),
          name_en    = COALESCE(NULLIF(${cleanNameEn || ''}, ''), name_en),
          address    = COALESCE(NULLIF(${address?.trim() || ''}, ''), address),
          phone      = COALESCE(NULLIF(${phone?.trim() || ''}, ''), phone),
          owner_name = COALESCE(NULLIF(${owner_name?.trim() || ''}, ''), owner_name),
          business_reg_image_key = CASE WHEN ${imageKey} IS NOT NULL THEN ${imageKey} ELSE business_reg_image_key END
        WHERE id = ${user.swimming_pool_id}
        RETURNING *
      `);
      res.json(rows.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 브랜딩 조회 ───────────────────────────────────────────────────────
router.get(
  "/branding",
  requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select().from(usersTable)
        .where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(403).json({ error: "수영장이 없습니다." }); return; }

      const result = await db.execute(sql`
        SELECT id, name, theme_color, logo_url, logo_emoji
        FROM swimming_pools WHERE id = ${user.swimming_pool_id} LIMIT 1
      `);
      res.json(result.rows[0] ?? {});
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 브랜딩 업데이트 ───────────────────────────────────────────────────
router.put(
  "/branding",
  requireAuth, requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    const { theme_color, logo_url, logo_emoji } = req.body;

    // hex 색상 유효성 검사
    if (theme_color && !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(theme_color)) {
      res.status(400).json({ error: "올바른 hex 색상 코드를 입력해주세요. (예: #1A5CFF)" }); return;
    }

    try {
      const [user] = await db.select().from(usersTable)
        .where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(403).json({ error: "수영장이 없습니다." }); return; }

      const result = await db.execute(sql`
        UPDATE swimming_pools
        SET
          theme_color = COALESCE(${theme_color ?? null}, theme_color),
          logo_url    = ${logo_url    !== undefined ? (logo_url    || null) : sql`logo_url`},
          logo_emoji  = ${logo_emoji  !== undefined ? (logo_emoji  || null) : sql`logo_emoji`}
        WHERE id = ${user.swimming_pool_id}
        RETURNING id, name, theme_color, logo_url, logo_emoji
      `);
      res.json(result.rows[0]);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

export default router;
