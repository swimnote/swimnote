/**
 * 슈퍼관리자 전용 API 라우트
 *
 * GET  /super/operators       — 전체 운영자 목록 (상태/회원/구독/저장공간 포함)
 * GET  /super/policies        — 시스템 정책 목록
 * PUT  /super/policies/:key   — 정책 저장
 * GET  /super/op-logs         — 전체 운영 로그 (cross-pool)
 * POST /super/op-logs         — 운영 로그 직접 기록
 * GET  /super/storage/:poolId — 특정 수영장 저장공간 현황
 * PUT  /super/storage/:poolId — 특정 수영장 저장 용량 변경
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── DB 초기화: system_policies 테이블이 없으면 생성 ──────────────
async function ensurePoliciesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_policies (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
}

// 기본 환불 정책 문구
const DEFAULT_REFUND_POLICY = `구독 변경은 즉시 적용됩니다.
상위 플랜 변경 시 남은 기간 기준 차액이 즉시 결제됩니다.
하위 플랜 변경 시 남은 기간 기준 차액은 환불되지 않고, 다음 결제 시 차감되는 크레딧으로 적립됩니다.
구독 해지 시 유료 기능은 즉시 제한되며, 서비스는 읽기전용 상태로 전환됩니다.
구독 해지 후 24시간이 경과하면 저장된 사진 및 영상 데이터는 자동 삭제되며 복구되지 않습니다.
이미 결제된 이용요금은 원칙적으로 환불되지 않습니다.
단, 다음 결제가 발생하지 않는 상태에서 남아 있는 크레딧은 환불될 수 있습니다.
사용자는 구독 해지 전 데이터 삭제 정책을 충분히 확인해야 하며, 삭제된 데이터는 복구되지 않습니다.`;

// ════════════════════════════════════════════════════════════════
// GET /super/operators
// 전체 운영자(수영장) 목록 + 활성 회원 수 + 저장공간 + 마지막 접속
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/operators",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT
          sp.id,
          sp.name,
          sp.owner_name,
          sp.approval_status,
          sp.subscription_status,
          sp.subscription_tier,
          sp.credit_balance,
          sp.base_storage_gb,
          sp.extra_storage_gb,
          sp.used_storage_bytes,
          COALESCE(sp.subscription_end_at, sp.trial_end_at) AS next_billing_at,
          -- 활성 회원 수 (정상 + 연기): 퇴원 제외
          (
            SELECT COUNT(*)::int
            FROM students st
            WHERE st.swimming_pool_id = sp.id
              AND st.status IN ('active', 'suspended')
          ) AS active_member_count,
          -- 마지막 접속일 (pool_admin 계정 기준)
          (
            SELECT MAX(u.last_login_at)
            FROM users u
            WHERE u.swimming_pool_id = sp.id
              AND u.role = 'pool_admin'
          ) AS last_login_at
        FROM swimming_pools sp
        ORDER BY sp.created_at DESC
      `)).rows;

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/policies
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/policies",
  requireAuth,
  requireRole("super_admin", "pool_admin"),
  async (_req: AuthRequest, res) => {
    try {
      await ensurePoliciesTable();
      const rows = (await db.execute(sql`
        SELECT key, value, updated_at, updated_by FROM system_policies ORDER BY key
      `)).rows;

      // 환불 정책이 없으면 기본값으로 응답
      const map: Record<string, any> = {};
      rows.forEach((r: any) => { map[r.key] = r; });

      if (!map["refund_policy"]) {
        map["refund_policy"] = {
          key: "refund_policy",
          value: DEFAULT_REFUND_POLICY,
          updated_at: null,
          updated_by: null,
        };
      }

      res.json(Object.values(map));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// PUT /super/policies/:key
// ════════════════════════════════════════════════════════════════
router.put(
  "/super/policies/:key",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensurePoliciesTable();
      const { key } = req.params;
      const { value } = req.body as { value: string };
      if (!value || typeof value !== "string") {
        res.status(400).json({ error: "내용을 입력해주세요." });
        return;
      }
      const actorName = req.user?.name ?? "슈퍼관리자";

      await db.execute(sql`
        INSERT INTO system_policies (key, value, updated_at, updated_by)
        VALUES (${key}, ${value}, NOW(), ${actorName})
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value,
              updated_at = EXCLUDED.updated_at,
              updated_by = EXCLUDED.updated_by
      `);

      // 운영 로그 기록
      try {
        const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.execute(sql`
          INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
          VALUES (${logId}, 'system', '정책', ${req.user!.userId}, ${actorName},
                  ${key}, ${"정책 수정: " + key}, '{}'::jsonb)
        `);
      } catch {}

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/op-logs?category=&pool_id=&limit=50&offset=0
// 전체 운영 로그 (super admin 전용, cross-pool)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/op-logs",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { category, pool_id, limit = "50", offset = "0" } = req.query as any;
      const lim = Math.min(Number(limit) || 50, 100);
      const off = Number(offset) || 0;

      let rows: any[];
      const conditions: string[] = [];
      if (category && category !== "전체") conditions.push(`category = '${category.replace(/'/g, "''")}'`);
      if (pool_id) conditions.push(`pool_id = '${pool_id.replace(/'/g, "''")}'`);

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      rows = (await db.execute(sql.raw(`
        SELECT
          el.id, el.pool_id, el.category, el.actor_id, el.actor_name,
          el.target, el.description, el.metadata, el.created_at,
          sp.name AS pool_name
        FROM event_logs el
        LEFT JOIN swimming_pools sp ON sp.id = el.pool_id
        ${whereClause}
        ORDER BY el.created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `))).rows;

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/op-logs — 수동 로그 기록
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/op-logs",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { pool_id, category, target, description } = req.body as any;
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const actorName = req.user?.name ?? "슈퍼관리자";
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${pool_id ?? "system"}, ${category}, ${req.user!.userId},
                ${actorName}, ${target ?? null}, ${description}, '{}'::jsonb)
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/storage/:poolId — 특정 수영장 저장공간 현황
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/storage/:poolId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { poolId } = req.params;
      const [pool] = (await db.execute(sql`
        SELECT id, name, base_storage_gb, extra_storage_gb, used_storage_bytes
        FROM swimming_pools
        WHERE id = ${poolId}
      `)).rows as any[];

      if (!pool) { res.status(404).json({ error: "수영장 없음" }); return; }

      const totalGb = (pool.base_storage_gb || 5) + (pool.extra_storage_gb || 0);
      const usedBytes = Number(pool.used_storage_bytes || 0);
      const totalBytes = totalGb * 1024 * 1024 * 1024;
      const usagePct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      res.json({
        ...pool,
        total_storage_gb: totalGb,
        usage_pct: usagePct,
        is_near_limit: usagePct >= 95,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// PUT /super/storage/:poolId — 저장 용량 변경 (추가 용량 설정)
// Body: { extra_storage_gb: number }
// ════════════════════════════════════════════════════════════════
router.put(
  "/super/storage/:poolId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { poolId } = req.params;
      const { extra_storage_gb } = req.body as { extra_storage_gb: number };
      if (typeof extra_storage_gb !== "number" || extra_storage_gb < 0) {
        res.status(400).json({ error: "잘못된 용량 값" });
        return;
      }

      await db.execute(sql`
        UPDATE swimming_pools
        SET extra_storage_gb = ${extra_storage_gb}
        WHERE id = ${poolId}
      `);

      // 로그 기록
      try {
        const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const actorName = req.user?.name ?? "슈퍼관리자";
        await db.execute(sql`
          INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
          VALUES (${logId}, ${poolId}, '저장공간', ${req.user!.userId}, ${actorName},
                  ${poolId}, ${"추가 용량 변경: " + extra_storage_gb + "GB"}, '{}'::jsonb)
        `);
      } catch {}

      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

export default router;
