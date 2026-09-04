import { Router } from "express";
import multer from "multer";
import { Client } from "@replit/object-storage";
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { swimmingPoolsTable, usersTable, parentAccountsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { resolvePoolMode } from "../lib/xmode.js";
import { sanitizePoolName } from "../utils/filename.js";
import { signToken } from "../lib/auth.js";
import { resolveSubscription } from "../lib/subscriptionService.js";
import { insertDefaultTemplates } from "../lib/defaultTemplates.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let _client: Client | null = null;
function getClient() {
  if (!_client) _client = new Client();
  return _client;
}

// ── name_en 중복 체크 + 자동 카운팅 해결 ─────────────────────────────────
// GET /pools/check-name-en?name=toykids&exclude_pool_id=xxx
//   → { available: true, resolved: "toykids" }
//   → { available: false, resolved: "toykids_1" }
async function resolveUniqueNameEn(base: string, excludePoolId?: string): Promise<{ available: boolean; resolved: string }> {
  const clean = base.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!clean) return { available: true, resolved: "" };

  // 현재 base 사용 중인지 확인
  const existing = await db.execute(sql`
    SELECT name_en FROM swimming_pools
    WHERE name_en IS NOT NULL AND name_en != ''
      ${excludePoolId ? sql`AND id != ${excludePoolId}` : sql``}
  `);
  const taken = new Set((existing.rows as any[]).map(r => r.name_en as string));

  if (!taken.has(clean)) return { available: true, resolved: clean };

  // 카운팅 순회: toykids_1, toykids_2, ...
  for (let i = 1; i <= 999; i++) {
    const candidate = `${clean}_${i}`;
    if (!taken.has(candidate)) return { available: false, resolved: candidate };
  }
  return { available: false, resolved: `${clean}_${Date.now()}` };
}

router.get("/check-name-en", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const name = (req.query.name as string || "").trim();
  const excludePoolId = req.query.exclude_pool_id as string | undefined;
  if (!name) { res.json({ available: true, resolved: "" }); return; }
  try {
    const result = await resolveUniqueNameEn(name, excludePoolId);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

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

// ── 주소 최소 지역 축약 (화면 표시용 — DB 저장값 변경 없음) ─────────────
// swimming_pools.address 에는 city/district 별도 컬럼이 없으므로
// address 문자열을 공백 split하여 시·군·구 단위까지만 반환한다.
//
// 패턴:
//   "서울특별시 강남구 테헤란로 123"   → "서울특별시 강남구"
//   "경기도 고양시 덕양구 화정로 10"   → "경기도 고양시 덕양구"
//   "제주특별자치도 제주시 한림읍 ..."  → "제주특별자치도 제주시 한림읍"
//   "인천광역시 남동구 ..."             → "인천광역시 남동구"
//   파싱 불확실 → 처음 2토큰 (이름만보다 낫고 상세주소보다 안전)
function abbreviateAddress(address: string | null | undefined): string {
  if (!address) return "";
  const parts = address.trim().split(/\s+/);
  if (parts.length === 0) return "";
  const first = parts[0];
  // "도"·"특별자치도"로 끝나는 광역 단위 → 첫 3토큰 (도 + 시/군 + 구/면)
  if (first.endsWith("도")) {
    return parts.slice(0, Math.min(3, parts.length)).join(" ");
  }
  // "시"로 끝나는 단위 (서울특별시·광역시·특별자치시·일반시) → 첫 2토큰
  if (first.endsWith("시")) {
    return parts.slice(0, Math.min(2, parts.length)).join(" ");
  }
  // 그 외 (해외 주소 등 예외) → 첫 2토큰
  return parts.slice(0, Math.min(2, parts.length)).join(" ");
}

// ── 수영장 이름 검색 (public-search — pool-join-request 호환) ────────────
// 정책: 검색어가 없으면 빈 배열 반환. 전방일치(name ILIKE q%)만 허용.
// 반환 필드: id, name, address (최소 지역 정보만 — phone·상세주소 제외)
router.get("/public-search", async (req, res) => {
  const q = (req.query.name as string || "").trim();
  // 검색어 없음 → 전체 목록 반환 금지
  if (!q) {
    res.json({ success: true, data: [] });
    return;
  }
  try {
    const rows = await superAdminDb.execute(sql`
      SELECT id, name, address
      FROM swimming_pools
      WHERE approval_status = 'approved'
        AND name ILIKE ${q + "%"}
      ORDER BY
        CASE WHEN LOWER(name) = LOWER(${q}) THEN 0 ELSE 1 END,
        LENGTH(name),
        name
      LIMIT 20
    `);
    // address를 최소 지역 단위로 축약하여 반환 (화면 표시용)
    const data = (rows.rows as Array<{ id: string; name: string; address: string | null }>).map(r => ({
      id: r.id,
      name: r.name,
      address: abbreviateAddress(r.address),
    }));
    res.json({ success: true, data });
  } catch (e) { console.error(e); res.status(500).json({ success: false, data: [] }); }
});

// ── 수영장 공개 페이지 조회 (인증 불필요) ─────────────────────────────
router.get("/:id/public", async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await superAdminDb.execute(sql`
      SELECT id, name, address, phone, owner_name, approval_status, subscription_status
      FROM swimming_pools
      WHERE id = ${id}
      LIMIT 1
    `);
    if (!rows.rows.length) {
      res.status(404).json({ error: "수영장을 찾을 수 없습니다." });
      return;
    }
    res.json(rows.rows[0]);
  } catch (e) {
    console.error("[pools/:id/public]", e);
    res.status(500).json({ error: "서버 오류" });
  }
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
    let poolId: string | null = null;

    if (req.user!.role === "parent_account") {
      // 학부모: parent_accounts 테이블에서 swimming_pool_id 조회
      const [pa] = await db.select({ swimming_pool_id: parentAccountsTable.swimming_pool_id })
        .from(parentAccountsTable).where(eq(parentAccountsTable.id, req.user!.userId)).limit(1);
      poolId = pa?.swimming_pool_id || (req.user as any).poolId || null;
    } else {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      poolId = user?.swimming_pool_id || null;
    }

    if (!poolId) {
      res.status(404).json({ error: "소속된 수영장이 없습니다." }); return;
    }
    const rows = await superAdminDb.execute(sql`SELECT * FROM swimming_pools WHERE id = ${poolId}`);
    if (!rows.rows.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    const pool = rows.rows[0] as any;

    // 회원 수 조회: 유료회원 기준 (active + suspended, withdrawn 제외)
    const [cntRow] = (await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM students
      WHERE swimming_pool_id = ${poolId} AND status IN ('active', 'suspended')
    `)).rows as any[];
    const memberCount = Number(cntRow?.cnt ?? 0);

    // resolver로 구독 상태 계산
    const resolved = await resolveSubscription(poolId);

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
      member_count:            memberCount,
      member_limit:            resolved.memberLimit,
      base_storage_gb:         resolved.storageGb,
      storage_mb:              resolved.storageMb,
      display_storage:         resolved.displayStorage,
      video_enabled:           resolved.videoEnabled,
      video_storage_limit_mb:  resolved.videoStorageLimitMb,
      white_label_enabled:     resolved.whiteLabelEnabled,
      subscription_tier:       resolved.planCode,
      subscription_status:     resolved.status,
      subscription_source:     resolved.source,
      plan_name:               resolved.planName,
      price_per_month:         resolved.pricePerMonth,
      subscription_starts_at:  resolved.startsAt,
      subscription_ends_at:    resolved.endsAt,
      trial_ends_at:           resolved.trialEndsAt,
      effective_reason:        resolved.effectiveReason,
      days_until_deletion:     daysUntilDeletion,
      next_billing_at:         resolved.nextBillingAt,
      pending_tier:            resolved.pendingTier,
      pending_plan_name:       resolved.pendingPlanName,
      downgrade_at:            resolved.downgradeAt,
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
        const { ok } = await client.uploadFromBytes(key, req.file.buffer);
        if (ok) imageKey = key;
      }

      let cleanNameEn: string | null = name_en ? name_en.toLowerCase().replace(/[^a-z0-9_]/g, "") : null;
      // 중복이면 자동 카운팅 (_1, _2, ...) 적용
      if (cleanNameEn) {
        const { resolved } = await resolveUniqueNameEn(cleanNameEn, user.swimming_pool_id);
        cleanNameEn = resolved || cleanNameEn;
      }
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

// ── 수영정보 콘텐츠 조회 ─────────────────────────────────────────────
router.get("/content", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(404).json({ error: "소속 수영장 없음" }); return; }
      const rows = await superAdminDb.execute(sql`
        SELECT introduction, tuition_info, level_test_info, event_info, equipment_info
        FROM swimming_pools WHERE id = ${user.swimming_pool_id} LIMIT 1
      `);
      res.json(rows.rows[0] ?? {});
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── 수영정보 콘텐츠 수정 ─────────────────────────────────────────────
router.put("/content", requireAuth, requireRole("pool_admin", "super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [user] = await db.select({ swimming_pool_id: usersTable.swimming_pool_id })
        .from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
      if (!user?.swimming_pool_id) { res.status(404).json({ error: "소속 수영장 없음" }); return; }
      const { introduction, tuition_info, level_test_info, event_info, equipment_info } = req.body;
      const rows = await superAdminDb.execute(sql`
        UPDATE swimming_pools SET
          introduction    = ${introduction    ?? null},
          tuition_info    = ${tuition_info    ?? null},
          level_test_info = ${level_test_info ?? null},
          event_info      = ${event_info      ?? null},
          equipment_info  = ${equipment_info  ?? null},
          updated_at      = NOW()
        WHERE id = ${user.swimming_pool_id}
        RETURNING introduction, tuition_info, level_test_info, event_info, equipment_info
      `);
      res.json({ success: true, data: rows.rows[0] });
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

// ── X 모드 상태 조회 ─────────────────────────────────────────────────────
// GET /pools/x-mode
//
// 허용 역할: pool_admin, teacher, parent_account, super_admin (fail-closed)
// poolId 결정: JWT poolId 신뢰 금지 — DB 직접 조회
//   pool_admin / teacher   → users.swimming_pool_id
//   parent_account         → parent_accounts.swimming_pool_id
//   super_admin            → ?pool_id= query param 필수
//
// /pools/x-mode는 현재 Route path를 유지하기 위해 query parameter를 선택하였다.
// (super.ts /super/event-logs의 pool_id query param 패턴과 동일)
//
router.get("/x-mode", requireAuth, async (req: AuthRequest, res) => {
  try {
    const role = req.user!.role;
    const userId = req.user!.userId;
    let poolId: string | null = null;

    if (role === "pool_admin" || role === "teacher") {
      const userRow = await superAdminDb.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
      `);
      poolId = (userRow.rows[0] as any)?.swimming_pool_id ?? null;
      if (!poolId) {
        res.status(404).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
        return;
      }
    } else if (role === "parent_account") {
      const paRow = await superAdminDb.execute(sql`
        SELECT swimming_pool_id FROM parent_accounts WHERE id = ${userId} LIMIT 1
      `);
      poolId = (paRow.rows[0] as any)?.swimming_pool_id ?? null;
      if (!poolId) {
        res.status(404).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
        return;
      }
    } else if (role === "super_admin") {
      const qPoolId = req.query.pool_id as string | undefined;
      if (!qPoolId) {
        res.status(400).json({ error: "pool_id 파라미터가 필요합니다." });
        return;
      }
      poolId = qPoolId;
    } else if (role === "sub_admin") {
      // sub_admin: pool 소속 동일 — users.swimming_pool_id 조회 (pool_admin/teacher와 동일)
      const userRow = await superAdminDb.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
      `);
      poolId = (userRow.rows[0] as any)?.swimming_pool_id ?? null;
      if (!poolId) {
        res.status(404).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
        return;
      }
    } else {
      // fail-closed: platform_admin, super_manager, 레거시 parent, 미확인 역할 모두 차단
      res.status(403).json({ success: false, message: "권한이 없습니다.", error: "권한이 없습니다." });
      return;
    }

    const result = await resolvePoolMode(poolId);
    if (!result) {
      res.status(404).json({ success: false, error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[GET /pools/x-mode]", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
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
    // ── 기본 일지 템플릿 자동 삽입 ──────────────────────────────────────
    insertDefaultTemplates(id, userId).catch((e: any) => console.error("[insertDefaultTemplates] create-pool:", e));

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

// ── 수영장 홈페이지 슬러그로 공개 조회 (인증 불필요) ──────────────────
router.get("/by-slug/:slug", async (req, res) => {
  const slug = decodeURIComponent(req.params.slug);
  try {
    const rows = await superAdminDb.execute(sql`
      SELECT id, name, name_en, address, phone, owner_name,
             theme_color, logo_url, logo_emoji,
             introduction, tuition_info, level_test_info, event_info, equipment_info,
             homepage_slug, homepage_enabled,
             approval_status, subscription_status
      FROM swimming_pools
      WHERE homepage_slug = ${slug} AND homepage_enabled = TRUE
      LIMIT 1
    `);
    if (!rows.rows.length) {
      res.status(404).json({ error: "수영장 홈페이지를 찾을 수 없습니다." });
      return;
    }
    res.json(rows.rows[0]);
  } catch (e) {
    console.error("[pools/by-slug]", e);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ── 홈페이지 슬러그 중복 확인 (인증 필요) ────────────────────────────
router.get("/homepage/check-slug", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { slug } = req.query as { slug: string };
  if (!slug) { res.status(400).json({ error: "슬러그를 입력해주세요." }); return; }

  // 슬러그 유효성 검사: 한글, 영문, 숫자, 하이픈만 허용
  if (!/^[가-힣a-zA-Z0-9-]+$/.test(slug)) {
    res.json({ available: false, message: "한글, 영문, 숫자, 하이픈(-)만 사용할 수 있습니다." }); return;
  }

  // 예약어 체크
  const reserved = ["login", "super-admin", "pool", "education", "app", "support", "api", "admin"];
  if (reserved.includes(slug.toLowerCase())) {
    res.json({ available: false, message: "사용할 수 없는 주소입니다." }); return;
  }

  try {
    const existing = await superAdminDb.execute(sql`
      SELECT id FROM swimming_pools
      WHERE homepage_slug = ${slug} AND id != ${req.user!.poolId ?? ""}
      LIMIT 1
    `);
    if (existing.rows.length) {
      res.json({ available: false, message: "이미 사용 중인 주소입니다." });
    } else {
      res.json({ available: true, message: "사용 가능한 주소입니다." });
    }
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 홈페이지 슬러그 조회 (내 수영장) ────────────────────────────────
router.get("/homepage/settings", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  try {
    const poolId = req.user!.poolId;
    if (!poolId) { res.status(404).json({ error: "수영장 없음" }); return; }
    const row = await superAdminDb.execute(sql`
      SELECT homepage_slug, homepage_enabled,
             introduction, tuition_info, level_test_info, event_info, equipment_info,
             theme_color, logo_url, logo_emoji, name, phone, address
      FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `);
    res.json(row.rows[0] ?? {});
  } catch (e) { console.error(e); res.status(500).json({ error: "서버 오류" }); }
});

// ── 홈페이지 슬러그 설정 ──────────────────────────────────────────
router.patch("/homepage/settings", requireAuth, requireRole("pool_admin", "super_admin"), async (req: AuthRequest, res) => {
  const { homepage_slug, homepage_enabled } = req.body;
  try {
    const poolId = req.user!.poolId;
    if (!poolId) { res.status(404).json({ error: "수영장 없음" }); return; }

    if (homepage_slug !== undefined && homepage_slug !== null && homepage_slug !== "") {
      if (!/^[가-힣a-zA-Z0-9-]+$/.test(homepage_slug)) {
        res.status(400).json({ error: "한글, 영문, 숫자, 하이픈(-)만 사용할 수 있습니다." }); return;
      }
      const reserved = ["login", "super-admin", "pool", "education", "app", "support", "api", "admin"];
      if (reserved.includes(homepage_slug.toLowerCase())) {
        res.status(400).json({ error: "사용할 수 없는 주소입니다." }); return;
      }
      const dup = await superAdminDb.execute(sql`
        SELECT id FROM swimming_pools WHERE homepage_slug = ${homepage_slug} AND id != ${poolId} LIMIT 1
      `);
      if (dup.rows.length) {
        res.status(409).json({ error: "이미 사용 중인 주소입니다." }); return;
      }
    }

    const slug = homepage_slug === "" ? null : (homepage_slug ?? undefined);
    const enabledVal = homepage_enabled !== undefined ? homepage_enabled : undefined;

    if (slug !== undefined && enabledVal !== undefined) {
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET homepage_slug = ${slug}, homepage_enabled = ${enabledVal}, updated_at = NOW()
        WHERE id = ${poolId}
      `);
    } else if (slug !== undefined) {
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET homepage_slug = ${slug}, updated_at = NOW() WHERE id = ${poolId}
      `);
    } else if (enabledVal !== undefined) {
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET homepage_enabled = ${enabledVal}, updated_at = NOW() WHERE id = ${poolId}
      `);
    }

    const updated = await superAdminDb.execute(sql`
      SELECT homepage_slug, homepage_enabled FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `);
    res.json({ success: true, ...(updated.rows[0] ?? {}) });
  } catch (e: any) {
    if (e?.code === "23505") { res.status(409).json({ error: "이미 사용 중인 주소입니다." }); return; }
    console.error(e); res.status(500).json({ error: "서버 오류" });
  }
});

// ── WP3: POST /pools/x-request ────────────────────────────────────────────
//
// pool_admin이 X 커리큘럼 설정 요청을 제출한다.
//
// 사전조건 (Transaction 내):
//   A. pool 존재 (SELECT FOR UPDATE)
//   B. xmode_entitlement = true
//   C. xmode_config_status = 'NOT_CONFIGURED'  (READY/CURRICULUM_PENDING이면 거부)
//   D. pending 또는 reviewing 상태 요청이 이미 없어야 함 (중복 방지)
//
// 성공 시 (같은 Transaction):
//   1. curriculum_requests INSERT (request_status='pending')
//   2. swimming_pools.xmode_config_status = 'CURRICULUM_PENDING' UPDATE
//   3. audit_logs INSERT
//
// poolId는 request body에서 받지 않음 — authenticated userId → users.swimming_pool_id
//
router.post(
  "/x-request",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    try {
      // poolId: DB에서 결정 (JWT 신뢰 금지)
      const userRow = await db.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
      `);
      const poolId: string | null = (userRow.rows[0] as any)?.swimming_pool_id ?? null;
      if (!poolId) {
        res.status(403).json({ error: "수영장 정보가 없습니다." });
        return;
      }

      let resultRequest: Record<string, unknown> | null = null;
      let resultPoolMode: Record<string, unknown> | null = null;

      await db.transaction(async (tx) => {
        // A. pool SELECT FOR UPDATE
        // X02-B2: x_paid / x_manual / x_force 포함하여 effective 계산
        const poolRows = await tx.execute(sql`
          SELECT id, xmode_config_status,
                 COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
                 COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
                 COALESCE(x_force_disabled,    false) AS x_force_disabled
          FROM swimming_pools
          WHERE id = ${poolId}
          LIMIT 1
          FOR UPDATE
        `);
        if (!poolRows.rows.length) {
          const e: any = new Error("POOL_NOT_FOUND");
          e.status = 404; e.code = "POOL_NOT_FOUND";
          throw e;
        }
        const pool = poolRows.rows[0] as any;
        const effectiveEntitlement =
          (Boolean(pool.x_paid_entitlement) || Boolean(pool.x_manual_entitlement))
          && !Boolean(pool.x_force_disabled);

        // B. entitlement 확인
        if (!effectiveEntitlement) {
          const e: any = new Error("X entitlement 없음");
          e.status = 403; e.code = "NO_ENTITLEMENT";
          throw e;
        }

        // C. config_status 확인
        const configStatus: string = pool.xmode_config_status;
        if (configStatus === "READY") {
          const e: any = new Error("이미 X 설정 완료 상태입니다.");
          e.status = 409; e.code = "ALREADY_READY";
          throw e;
        }
        if (configStatus === "CURRICULUM_PENDING") {
          // 중복 방지: 현재 진행 중 요청 반환
          const activeRows = await tx.execute(sql`
            SELECT id, request_status, title, created_at, updated_at
            FROM curriculum_requests
            WHERE swimming_pool_id = ${poolId}
              AND request_status IN ('pending', 'reviewing')
            ORDER BY created_at DESC
            LIMIT 1
          `);
          const e: any = new Error("커리큘럼 요청이 이미 진행 중입니다.");
          e.status = 409; e.code = "ALREADY_PENDING";
          e.existingRequest = activeRows.rows[0] ?? null;
          throw e;
        }

        // D. NOT_CONFIGURED 확인 후 pending/reviewing 중복 방지
        const dupRows = await tx.execute(sql`
          SELECT id FROM curriculum_requests
          WHERE swimming_pool_id = ${poolId}
            AND request_status IN ('pending', 'reviewing')
          LIMIT 1
          FOR UPDATE
        `);
        if (dupRows.rows.length) {
          const e: any = new Error("커리큘럼 요청이 이미 존재합니다.");
          e.status = 409; e.code = "DUPLICATE_REQUEST";
          throw e;
        }

        // 1. curriculum_requests INSERT
        const title = "SWIMNOTE X 커리큘럼 설정 요청";
        const insertedRows = await tx.execute(sql`
          INSERT INTO curriculum_requests (
            swimming_pool_id, request_status, title, requested_by
          ) VALUES (
            ${poolId}, 'pending', ${title}, ${userId}
          )
          RETURNING id, request_status, title, created_at
        `);
        const inserted = insertedRows.rows[0] as any;

        // 2. swimming_pools UPDATE → CURRICULUM_PENDING
        // X02-B2: effective 조건으로 guard (AND 조건은 race condition 방지용)
        await tx.execute(sql`
          UPDATE swimming_pools
          SET xmode_config_status = 'CURRICULUM_PENDING'
          WHERE id = ${poolId}
            AND (COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
            AND NOT COALESCE(x_force_disabled, false)
            AND xmode_config_status = 'NOT_CONFIGURED'
        `);

        // 3. audit_logs INSERT
        const beforeData = {
          xmode_entitlement: true,
          xmode_config_status: "NOT_CONFIGURED",
        };
        const afterData = {
          xmode_entitlement: true,
          xmode_config_status: "CURRICULUM_PENDING",
          source: "curriculum_request",
          curriculum_request_id: inserted.id,
        };
        const versionRes = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_xmode', ${poolId}) AS v
        `);
        const version = (versionRes.rows[0] as any)?.v ?? 1;
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_xmode', ${poolId}, ${version},
            'update', 'pool_admin', ${userId}, ${poolId},
            ${JSON.stringify(beforeData)}::jsonb,
            ${JSON.stringify(afterData)}::jsonb,
            'X curriculum setup requested'
          )
        `);

        resultRequest = {
          id: inserted.id,
          request_status: inserted.request_status,
          created_at: inserted.created_at,
        };
        // computeMode: entitlement=true + CURRICULUM_PENDING → x_pending
        resultPoolMode = {
          pool_id: poolId,
          mode: "x_pending",
          xmode_entitlement: true,
          xmode_config_status: "CURRICULUM_PENDING",
        };
      });

      res.status(201).json({
        request: resultRequest,
        pool_mode: resultPoolMode,
      });
    } catch (err: any) {
      if (err.status === 404) { res.status(404).json({ error: err.message, code: err.code }); return; }
      if (err.status === 403) { res.status(403).json({ error: err.message, code: err.code }); return; }
      if (err.status === 409) {
        res.status(409).json({
          error: err.message,
          code: err.code,
          ...(err.existingRequest ? { existing_request: err.existingRequest } : {}),
        });
        return;
      }
      console.error("[POST /pools/x-request]", err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

// ── WP3: GET /pools/x-request ─────────────────────────────────────────────
//
// pool_admin이 자기 pool의 현재 커리큘럼 요청 상태를 조회한다.
//
// 반환 우선순위:
//   1. pending 또는 reviewing 상태 요청 (진행 중)
//   2. 없으면 가장 최근 요청 1건 (approved/rejected/cancelled)
//   3. 없으면 { request: null }
//
// 자기 pool 외 데이터 노출 금지 — poolId를 DB에서 결정.
//
router.get(
  "/x-request",
  requireAuth,
  requireRole("pool_admin"),
  async (req: AuthRequest, res) => {
    const userId = req.user!.userId;
    try {
      const userRow = await db.execute(sql`
        SELECT swimming_pool_id FROM users WHERE id = ${userId} LIMIT 1
      `);
      const poolId: string | null = (userRow.rows[0] as any)?.swimming_pool_id ?? null;
      if (!poolId) {
        res.status(403).json({ error: "수영장 정보가 없습니다." });
        return;
      }

      // 진행 중 요청 우선
      const activeRows = await db.execute(sql`
        SELECT id, request_status, title, review_note, result_version_id,
               created_at, updated_at, reviewed_at
        FROM curriculum_requests
        WHERE swimming_pool_id = ${poolId}
          AND request_status IN ('pending', 'reviewing')
        ORDER BY created_at DESC
        LIMIT 1
      `);
      if (activeRows.rows.length) {
        res.json({ request: activeRows.rows[0] });
        return;
      }

      // 없으면 가장 최근 완료/반려/취소 요청
      const latestRows = await db.execute(sql`
        SELECT id, request_status, title, review_note, result_version_id,
               created_at, updated_at, reviewed_at
        FROM curriculum_requests
        WHERE swimming_pool_id = ${poolId}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      res.json({ request: latestRows.rows[0] ?? null });
    } catch (err) {
      console.error("[GET /pools/x-request]", err);
      res.status(500).json({ error: "서버 오류가 발생했습니다." });
    }
  }
);

export default router;
