import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { swimmingPoolsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { sanitizePoolName } from "../utils/filename.js";
import { signToken } from "../lib/auth.js";

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
    const rows = await superAdminDb.execute(sql`
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

// ── 수영장 이름 검색 (public-search — pool-join-request 호환) ────────────
router.get("/public-search", async (req, res) => {
  const name = (req.query.name as string || "").trim();
  try {
    const q = name.length >= 1 ? name : "";
    const rows = await superAdminDb.execute(sql`
      SELECT id, name, address, phone
      FROM swimming_pools
      WHERE approval_status = 'approved'
        ${q ? sql`AND (name ILIKE ${"%" + q + "%"} OR address ILIKE ${"%" + q + "%"})` : sql``}
      ORDER BY name
      LIMIT 30
    `);
    res.json({ success: true, data: rows.rows });
  } catch (e) { console.error(e); res.status(500).json({ success: false, data: [] }); }
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
      const rows = await superAdminDb.execute(sql`
        INSERT INTO swimming_pools
          (id, name, name_en, address, phone, owner_name, owner_email, admin_name, admin_email, admin_phone, approval_status, subscription_status, trial_end_at)
        VALUES
          (${id}, ${name}, ${resolvedNameEn}, ${address}, ${phone}, ${owner_name}, ${admin_email}, ${admin_name}, ${admin_email}, ${safeAdminPhone}, 'approved', 'trial', NOW() + INTERVAL '30 days')
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
    const poolId = user[0].swimming_pool_id;
    const rows = await superAdminDb.execute(sql`SELECT * FROM swimming_pools WHERE id = ${poolId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    const pool = rows.rows[0] as any;

    // 회원 수 조회: 유료회원 기준 (active + suspended, withdrawn 제외)
    const [cntRow] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId} AND status IN ('active', 'suspended')
    `)).rows as any[];
    const memberCount = Number(cntRow?.cnt ?? 0);

    // 플랜 회원 한도 조회
    const [planRow] = (await db.execute(sql`
      SELECT member_limit, storage_gb FROM subscription_plans
      WHERE tier = ${pool.subscription_tier ?? "free"} LIMIT 1
    `)).rows as any[];

    // 삭제까지 남은 일수 계산
    let daysUntilDeletion: number | null = null;
    if (pool.payment_failed_at) {
      const failedAt = new Date(pool.payment_failed_at);
      const deletionAt = new Date(failedAt.getTime() + 14 * 86_400_000);
      const now = new Date();
      daysUntilDeletion = Math.max(0, Math.ceil((deletionAt.getTime() - now.getTime()) / 86_400_000));
    }

    res.json({
      ...pool,
      member_count: memberCount,
      member_limit: Number(planRow?.member_limit ?? 5),
      base_storage_gb: Number(planRow?.storage_gb ?? 0.1),
      days_until_deletion: daysUntilDeletion,
    });
  } catch (err) { res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 수영장 설정 조회 ──────────────────────────────────────────────────
router.get("/settings", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(404).json({ error: "소속 수영장 없음" }); return; }
      const rows = await superAdminDb.execute(sql`SELECT * FROM swimming_pools WHERE id = ${user.swimming_pool_id}`);
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

      const { name, name_en, address, phone, owner_name, business_reg_number } = req.body;

      let imageKey: string | null = null;
      if (req.file) {
        const client = getClient();
        const ext = (req.file.originalname.split(".").pop() || "jpg").toLowerCase();
        const key = `docs/business_reg/${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${ext}`;
        const { ok } = await client.uploadFromBuffer(req.file.buffer, key, { contentType: req.file.mimetype });
        if (ok) imageKey = key;
      }

      const cleanNameEn = name_en ? name_en.toLowerCase().replace(/[^a-z0-9_]/g, "") : null;
      const cleanBizNum = business_reg_number ? business_reg_number.replace(/[^0-9\-]/g, "").trim() : null;

      const rows = await superAdminDb.execute(sql`
        UPDATE swimming_pools SET
          name       = COALESCE(NULLIF(${name?.trim() || ''}, ''), name),
          name_en    = COALESCE(NULLIF(${cleanNameEn || ''}, ''), name_en),
          address    = COALESCE(NULLIF(${address?.trim() || ''}, ''), address),
          phone      = COALESCE(NULLIF(${phone?.trim() || ''}, ''), phone),
          owner_name = COALESCE(NULLIF(${owner_name?.trim() || ''}, ''), owner_name),
          business_reg_number = CASE WHEN ${cleanBizNum} IS NOT NULL THEN ${cleanBizNum} ELSE business_reg_number END,
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

      const result = await superAdminDb.execute(sql`
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

      const result = await superAdminDb.execute(sql`
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

// ── 내 모든 수영장 목록 (단일풀: users.swimming_pool_id 기반) ─────────
router.get("/my-pools", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const userRow = await superAdminDb.execute(sql`
      SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
    `);
    const poolId = (userRow.rows[0] as any)?.swimming_pool_id;
    if (!poolId) { res.json([]); return; }
    const rows = await superAdminDb.execute(sql`
      SELECT id, name, address, phone, approval_status,
             subscription_status, theme_color, logo_url, logo_emoji,
             true AS is_primary, created_at AS linked_at
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `);
    res.json(rows.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 수영장 전환 (새 토큰 발급, users.swimming_pool_id 기반) ──────────
router.post("/switch/:poolId", requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { poolId } = req.params;
    const poolRow = await superAdminDb.execute(sql`SELECT * FROM swimming_pools WHERE id = ${poolId} LIMIT 1`);
    if (!poolRow.rows.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    const pool = poolRow.rows[0] as any;
    await superAdminDb.execute(sql`UPDATE users SET swimming_pool_id = ${poolId} WHERE id = ${userId}`);
    const userRow = await superAdminDb.execute(sql`SELECT id, email, name, phone, role, swimming_pool_id, roles FROM users WHERE id = ${userId} LIMIT 1`);
    const user = userRow.rows[0] as any;
    const role = user?.role || req.user!.role || "pool_admin";
    const newToken = signToken({ userId, role, poolId });
    res.json({ token: newToken, pool, user: { ...user, swimming_pool_id: poolId } });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 새 수영장 생성 (멀티풀) ──────────────────────────────────────────
router.post("/create-pool", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { name, address, phone, copy_levels, copy_pricing, copy_payment, copy_feedback, source_pool_id } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "수영장 이름을 입력해주세요." }); return; }
  try {
    const userId = req.user!.userId;
    const id = `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const nameEn = sanitizePoolName(name);
    const userRow = await superAdminDb.execute(sql`SELECT name, email FROM users WHERE id = ${userId} LIMIT 1`);
    const userInfo = userRow.rows[0] as any;
    await superAdminDb.execute(sql`
      INSERT INTO swimming_pools (id, name, name_en, address, phone, owner_name, owner_email, approval_status, subscription_status)
      VALUES (${id}, ${name.trim()}, ${nameEn}, ${address || null}, ${phone || null},
              ${userInfo?.name || ""}, ${userInfo?.email || ""},
              'approved', 'trial')
    `);

    const srcId = source_pool_id || req.user!.poolId;
    if (srcId) {
      if (copy_levels) {
        await db.execute(sql`
          INSERT INTO pool_level_settings
            (pool_id, level_order, level_name, level_description, learning_content, promotion_test_rule, badge_type, badge_label, badge_color, badge_text_color, is_active, updated_at)
          SELECT ${id}, level_order, level_name, level_description, learning_content, promotion_test_rule, badge_type, badge_label, badge_color, badge_text_color, is_active, NOW()
          FROM pool_level_settings WHERE pool_id = ${srcId}
          ON CONFLICT (pool_id, level_order) DO NOTHING
        `);
      }
      if (copy_pricing) {
        await db.execute(sql`
          INSERT INTO pool_class_pricing (id, pool_id, type_key, type_name, monthly_fee, sessions_per_month, is_active)
          SELECT gen_random_uuid()::text, ${id}, type_key, type_name, monthly_fee, sessions_per_month, is_active
          FROM pool_class_pricing WHERE pool_id = ${srcId}
          ON CONFLICT DO NOTHING
        `);
      }
    }
    const poolRow = await superAdminDb.execute(sql`SELECT * FROM swimming_pools WHERE id = ${id} LIMIT 1`);
    res.status(201).json(poolRow.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류가 발생했습니다." }); }
});

// ── 화이트라벨 설정 조회 ──────────────────────────────────────────────
router.get("/white-label", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = req.user!.poolId;
    if (!poolId) { res.status(404).json({ error: "수영장 없음" }); return; }
    const row = await superAdminDb.execute(sql`
      SELECT white_label_enabled, hide_platform_name FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `);
    res.json(row.rows[0] ?? { white_label_enabled: false, hide_platform_name: false });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 화이트라벨 설정 저장 ──────────────────────────────────────────────
router.put("/white-label", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { white_label_enabled, hide_platform_name } = req.body;
  try {
    const poolId = req.user!.poolId;
    if (!poolId) { res.status(404).json({ error: "수영장 없음" }); return; }
    const row = await superAdminDb.execute(sql`
      UPDATE swimming_pools
      SET white_label_enabled = ${white_label_enabled ?? false},
          hide_platform_name  = ${hide_platform_name ?? false}
      WHERE id = ${poolId}
      RETURNING white_label_enabled, hide_platform_name
    `);
    res.json(row.rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

export default router;
