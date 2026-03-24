/**
 * 슈퍼관리자 전용 API 라우트 (대규모 운영 콘솔)
 *
 * GET  /super/dashboard-stats     — 6대 핵심 지표 + 오늘 처리할 일 큐
 * GET  /super/operators           — 운영자 목록 (필터/검색 포함)
 * GET  /super/operators/:id       — 운영자 상세
 * PATCH /super/operators/:id/approve  — 승인
 * PATCH /super/operators/:id/reject   — 반려
 * PATCH /super/operators/:id/restrict — 제한
 * POST /super/operators/bulk      — 일괄 처리
 * GET  /super/storage-list        — 저장공간 사용량 목록 (정렬 포함)
 * GET  /super/policies            — 시스템 정책 목록
 * PUT  /super/policies/:key       — 정책 저장
 * GET  /super/op-logs             — 전체 운영 로그 (cross-pool)
 * POST /super/op-logs             — 운영 로그 직접 기록
 * GET  /super/storage/:poolId     — 특정 수영장 저장공간 현황
 * PUT  /super/storage/:poolId     — 특정 수영장 저장 용량 변경
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";

const router = Router();

// ── 시스템 정책 테이블 초기화 ─────────────────────────────────────
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

const DEFAULT_REFUND_POLICY = `구독 변경은 즉시 적용됩니다.
상위 플랜 변경 시 남은 기간 기준 차액이 즉시 결제됩니다.
하위 플랜 변경 시 남은 기간 기준 차액은 환불되지 않고, 다음 결제 시 차감되는 크레딧으로 적립됩니다.
구독 해지 시 유료 기능은 즉시 제한되며, 서비스는 읽기전용 상태로 전환됩니다.
구독 해지 후 24시간이 경과하면 저장된 사진 및 영상 데이터는 자동 삭제되며 복구되지 않습니다.
이미 결제된 이용요금은 원칙적으로 환불되지 않습니다.
단, 다음 결제가 발생하지 않는 상태에서 남아 있는 크레딧은 환불될 수 있습니다.
사용자는 구독 해지 전 데이터 삭제 정책을 충분히 확인해야 하며, 삭제된 데이터는 복구되지 않습니다.`;

// ════════════════════════════════════════════════════════════════
// GET /super/dashboard-stats
// 6대 핵심 지표 + 오늘 처리할 일 큐
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/dashboard-stats",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      await ensureExtraTables();

      const [statsRes, pendingItems, paymentItems, storageItems, deletionItems,
             policyItems, supportRes, securityItems] = await Promise.all([
        // KPI 지표
        db.execute(sql`
          SELECT
            COUNT(*)::int AS total_operators,
            COUNT(*) FILTER (WHERE approval_status = 'approved')::int AS active_operators,
            COUNT(*) FILTER (WHERE approval_status = 'pending')::int AS pending_operators,
            COUNT(*) FILTER (
              WHERE approval_status = 'approved'
                AND subscription_status IN ('expired','suspended','cancelled')
            )::int AS payment_issue_count,
            COUNT(*) FILTER (
              WHERE approval_status = 'approved'
                AND COALESCE(used_storage_bytes,0)::float /
                    NULLIF((COALESCE(base_storage_gb,5) + COALESCE(extra_storage_gb,0))::bigint * 1073741824, 0) >= 0.95
            )::int AS storage_danger_count,
            COUNT(*) FILTER (
              WHERE subscription_end_at IS NOT NULL
                AND subscription_end_at > NOW()
                AND subscription_end_at <= NOW() + INTERVAL '24 hours'
            )::int AS deletion_pending_count
          FROM swimming_pools
        `),
        // 승인 대기
        db.execute(sql`
          SELECT id, name, owner_name, created_at, COALESCE(pool_type,'swimming_pool') AS pool_type,
                 'pending_approval' AS todo_type
          FROM swimming_pools WHERE approval_status = 'pending'
          ORDER BY created_at ASC LIMIT 10
        `),
        // 결제 실패
        db.execute(sql`
          SELECT id, name, owner_name, subscription_status, subscription_end_at,
                 'payment_failed' AS todo_type
          FROM swimming_pools
          WHERE approval_status = 'approved'
            AND subscription_status IN ('expired','suspended')
          ORDER BY subscription_end_at ASC NULLS LAST LIMIT 10
        `),
        // 저장공간 위험 (95% 이상)
        db.execute(sql`
          SELECT id, name, owner_name,
                 COALESCE(used_storage_bytes,0) AS used_storage_bytes,
                 (COALESCE(base_storage_gb,5) + COALESCE(extra_storage_gb,0)) AS total_gb,
                 LEAST(ROUND(
                   COALESCE(used_storage_bytes,0)::numeric /
                   NULLIF((COALESCE(base_storage_gb,5) + COALESCE(extra_storage_gb,0))::bigint * 1073741824, 0) * 100
                 )::int, 100) AS usage_pct,
                 'storage_danger' AS todo_type
          FROM swimming_pools
          WHERE approval_status = 'approved'
            AND COALESCE(used_storage_bytes,0)::float /
                NULLIF((COALESCE(base_storage_gb,5) + COALESCE(extra_storage_gb,0))::bigint * 1073741824, 0) >= 0.95
          ORDER BY usage_pct DESC LIMIT 10
        `),
        // 자동삭제 예정 (24h)
        db.execute(sql`
          SELECT id, name, owner_name, subscription_end_at,
                 EXTRACT(EPOCH FROM (subscription_end_at - NOW())) / 3600 AS hours_left,
                 'deletion_pending' AS todo_type
          FROM swimming_pools
          WHERE subscription_end_at IS NOT NULL
            AND subscription_end_at > NOW()
            AND subscription_end_at <= NOW() + INTERVAL '24 hours'
          ORDER BY subscription_end_at ASC LIMIT 10
        `),
        // 정책 미확인 (refund_policy 미동의)
        db.execute(sql`
          SELECT sp.id, sp.name, sp.owner_name, sp.created_at, 'policy_unsigned' AS todo_type
          FROM swimming_pools sp
          WHERE sp.approval_status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM policy_consents pc
              WHERE pc.pool_id = sp.id AND pc.policy_key = 'refund_policy'
            )
          ORDER BY sp.created_at DESC LIMIT 10
        `).catch(() => ({ rows: [] })),
        // 고객센터 미처리
        db.execute(sql`
          SELECT COUNT(*)::int AS open_count,
                 COUNT(*) FILTER (
                   WHERE created_at <= NOW() - (sla_hours || ' hours')::interval
                 )::int AS overdue_count
          FROM support_tickets WHERE status IN ('open','in_progress')
        `).catch(() => ({ rows: [{ open_count: 0, overdue_count: 0 }] })),
        // 보안 이벤트 (최근 24h)
        db.execute(sql`
          SELECT el.id, el.pool_id, sp.name AS pool_name, el.actor_name,
                 el.description, el.created_at, '보안' AS todo_type
          FROM event_logs el
          LEFT JOIN swimming_pools sp ON sp.id = el.pool_id
          WHERE el.category = '보안'
            AND el.created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY el.created_at DESC LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);

      const stats = (statsRes.rows[0] as any) ?? {};
      const support = (supportRes.rows[0] as any) ?? { open_count: 0, overdue_count: 0 };

      res.json({
        stats,
        todo: {
          pending_approval: pendingItems.rows,
          payment_failed:   paymentItems.rows,
          storage_danger:   storageItems.rows,
          deletion_pending: deletionItems.rows,
          policy_unsigned:  policyItems.rows,
          security_events:  securityItems.rows,
          support_open_count:    support.open_count ?? 0,
          support_overdue_count: support.overdue_count ?? 0,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/operators  (필터 파라미터 지원)
// ?filter=pending|storage_alert|payment_failed|deletion_pending|this_week
// ?search=&sort=name|created_at|members|storage
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/operators",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { filter, search, sort = "created_at" } = req.query as any;

      const conditions: string[] = [];
      if (search) {
        const q = search.replace(/'/g, "''");
        conditions.push(`(sp.name ILIKE '%${q}%' OR sp.owner_name ILIKE '%${q}%')`);
      }
      if (filter === "pending")          conditions.push(`sp.approval_status = 'pending'`);
      if (filter === "payment_failed")   conditions.push(`sp.approval_status = 'approved' AND sp.subscription_status IN ('expired','suspended','cancelled')`);
      if (filter === "storage_alert")    conditions.push(`sp.approval_status = 'approved' AND sp.used_storage_bytes IS NOT NULL AND (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) > 0 AND sp.used_storage_bytes::float / ((sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0))::bigint * 1073741824) >= 0.95`);
      if (filter === "deletion_pending") conditions.push(`sp.subscription_end_at IS NOT NULL AND sp.subscription_end_at > NOW() AND sp.subscription_end_at <= NOW() + INTERVAL '24 hours'`);
      if (filter === "this_week")        conditions.push(`sp.created_at >= NOW() - INTERVAL '7 days'`);
      if (filter === "free_over30")      conditions.push(`sp.approval_status = 'approved' AND sp.subscription_status = 'trial'`);
      // 운영 유형 필터
      if (filter === "type_swimming")    conditions.push(`sp.pool_type = 'swimming_pool'`);
      if (filter === "type_coach")       conditions.push(`sp.pool_type = 'solo_coach'`);
      if (filter === "type_rental")      conditions.push(`sp.pool_type = 'rental_team'`);
      if (filter === "type_franchise")   conditions.push(`sp.pool_type = 'franchise'`);
      if (filter === "credit_balance")   conditions.push(`COALESCE(sp.credit_balance,0) > 0`);
      if (filter === "upload_spike")     conditions.push(`sp.upload_blocked = TRUE`);
      if (filter === "policy_unsigned")  conditions.push(`
        sp.approval_status = 'approved' AND NOT EXISTS (
          SELECT 1 FROM policy_consents pc WHERE pc.pool_id = sp.id AND pc.policy_key = 'refund_policy'
        )
      `);
      if (filter === "repeat_refund")    conditions.push(`
        (SELECT COUNT(*) FROM support_tickets st WHERE st.pool_id = sp.id AND st.ticket_type = 'refund') >= 2
      `);

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const orderMap: Record<string, string> = {
        created_at:   "sp.created_at DESC",
        name:         "sp.name ASC",
        members:      "active_member_count DESC",
        storage:      "usage_pct DESC",
        last_login:   "last_login_at DESC NULLS LAST",
        payment_risk: "CASE WHEN sp.subscription_status IN ('expired','suspended','cancelled') THEN 0 ELSE 1 END ASC, sp.created_at DESC",
      };
      const orderClause = orderMap[sort] ?? "sp.created_at DESC";

      const rows = (await db.execute(sql.raw(`
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
          sp.created_at,
          COALESCE(sp.pool_type, 'swimming_pool') AS pool_type,
          COALESCE(sp.subscription_end_at, sp.trial_end_at) AS next_billing_at,
          (
            SELECT COUNT(*)::int FROM students st
            WHERE st.swimming_pool_id = sp.id AND st.status IN ('active','suspended')
          ) AS active_member_count,
          (
            SELECT MAX(u.last_login_at) FROM users u
            WHERE u.swimming_pool_id = sp.id AND u.role = 'pool_admin'
          ) AS last_login_at,
          CASE
            WHEN sp.used_storage_bytes IS NOT NULL
              AND (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) > 0
            THEN ROUND(
              sp.used_storage_bytes::numeric /
              ((sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0))::bigint * 1073741824) * 100
            )::int
            ELSE 0
          END AS usage_pct,
          (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) AS total_storage_gb,
          COALESCE(sp.is_readonly, FALSE) AS is_readonly,
          COALESCE(sp.upload_blocked, FALSE) AS upload_blocked,
          CASE
            WHEN sp.subscription_end_at IS NOT NULL
              AND sp.subscription_end_at > NOW()
              AND sp.subscription_end_at <= NOW() + INTERVAL '24 hours'
            THEN true
            ELSE false
          END AS deletion_pending
        FROM swimming_pools sp
        ${whereClause}
        ORDER BY ${orderClause}
        LIMIT 200
      `))).rows;

      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/operators/:id — 운영자 상세 (6탭 데이터 통합)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/operators/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;

      const [pool, teachers, recentLogs, policyRows] = await Promise.all([
        db.execute(sql`
          SELECT sp.*,
            (SELECT COUNT(*)::int FROM students st WHERE st.swimming_pool_id = sp.id AND st.status = 'active') AS active_member_count,
            (SELECT COUNT(*)::int FROM students st WHERE st.swimming_pool_id = sp.id) AS total_member_count,
            (SELECT COUNT(*)::int FROM classes c WHERE c.swimming_pool_id = sp.id) AS total_class_count,
            CASE
              WHEN sp.used_storage_bytes IS NOT NULL AND (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) > 0
              THEN ROUND(sp.used_storage_bytes::numeric / ((sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0))::bigint * 1073741824) * 100)::int
              ELSE 0
            END AS usage_pct,
            (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) AS total_storage_gb
          FROM swimming_pools sp
          WHERE sp.id = ${id}
        `),
        db.execute(sql`
          SELECT id, name, role, email, created_at, last_login_at
          FROM users
          WHERE swimming_pool_id = ${id}
            AND role IN ('pool_admin','teacher')
          ORDER BY role, name
        `),
        db.execute(sql`
          SELECT id, category, actor_name, target, description, created_at
          FROM event_logs
          WHERE pool_id = ${id}
          ORDER BY created_at DESC
          LIMIT 30
        `),
        db.execute(sql`
          SELECT policy_key, MAX(agreed_at) AS agreed_at
          FROM policy_consents
          WHERE pool_id = ${id}
          GROUP BY policy_key
        `).catch(() => ({ rows: [] })),
      ]);

      if (!pool.rows[0]) { res.status(404).json({ error: "운영자 없음" }); return; }

      const policyMap: Record<string, string | null> = {};
      for (const row of policyRows.rows as any[]) {
        policyMap[row.policy_key] = row.agreed_at ?? null;
      }

      res.json({
        pool: pool.rows[0],
        teachers: teachers.rows,
        logs: recentLogs.rows,
        policy: {
          refund_policy:   policyMap["refund_policy"]   ?? null,
          privacy_policy:  policyMap["privacy_policy"]  ?? null,
          terms:           policyMap["terms"]            ?? null,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/approve
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/approve",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`
        UPDATE swimming_pools SET approval_status = 'approved' WHERE id = ${id}
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '권한', ${req.user!.userId}, ${actorName}, ${id}, '운영자 승인', '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/reject
// Body: { reason?: string }
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/reject",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason = "기준 미달" } = req.body as any;
      await db.execute(sql`
        UPDATE swimming_pools SET approval_status = 'rejected', rejection_reason = ${reason} WHERE id = ${id}
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '권한', ${req.user!.userId}, ${actorName}, ${id}, ${'운영자 반려: ' + reason}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/restrict
// Body: { reason?: string }
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/restrict",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { reason = "운영 위반" } = req.body as any;
      await db.execute(sql`
        UPDATE swimming_pools SET subscription_status = 'suspended' WHERE id = ${id}
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '권한', ${req.user!.userId}, ${actorName}, ${id}, ${'운영자 제한: ' + reason}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/operators/bulk
// Body: { ids: string[], action: 'approve'|'reject'|'restrict', reason?: string }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/operators/bulk",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { ids, action, reason } = req.body as { ids: string[]; action: string; reason?: string };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: "대상을 선택해주세요." }); return;
      }
      const actorName = req.user?.name ?? "슈퍼관리자";

      for (const id of ids) {
        let category = "권한";
        let desc = "";
        if (action === "approve") {
          await db.execute(sql`UPDATE swimming_pools SET approval_status = 'approved' WHERE id = ${id}`);
          desc = "일괄 승인";
        } else if (action === "reject") {
          await db.execute(sql`UPDATE swimming_pools SET approval_status = 'rejected', rejection_reason = ${reason ?? "기준 미달"} WHERE id = ${id}`);
          desc = `일괄 반려: ${reason ?? "기준 미달"}`;
        } else if (action === "restrict") {
          await db.execute(sql`UPDATE swimming_pools SET subscription_status = 'suspended' WHERE id = ${id}`);
          desc = `일괄 제한: ${reason ?? "운영 위반"}`;
        } else if (action === "readonly_on") {
          await db.execute(sql`UPDATE swimming_pools SET is_readonly = TRUE, readonly_reason = ${reason ?? "일괄 읽기전용"} WHERE id = ${id}`);
          desc = `일괄 읽기전용 전환: ${reason ?? ""}`;
          category = "읽기전용 전환";
        } else if (action === "readonly_off") {
          await db.execute(sql`UPDATE swimming_pools SET is_readonly = FALSE WHERE id = ${id}`);
          desc = "일괄 읽기전용 해제";
          category = "읽기전용 전환";
        } else if (action === "block_upload") {
          await db.execute(sql`UPDATE swimming_pools SET upload_blocked = TRUE WHERE id = ${id}`);
          desc = "일괄 업로드 차단";
          category = "저장공간";
        } else if (action === "policy_reminder") {
          desc = "일괄 정책 재알림";
          category = "정책";
        } else {
          desc = `일괄 ${action}`;
        }
        const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        await db.execute(sql`
          INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
          VALUES (${logId}, ${id}, ${category}, ${req.user!.userId}, ${actorName}, ${id}, ${desc}, '{}'::jsonb)
        `).catch(() => {});
      }

      res.json({ ok: true, processed: ids.length });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/storage-list — 운영자 저장공간 목록 (사용률 정렬)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/storage-list",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT
          sp.id, sp.name, sp.owner_name, sp.approval_status,
          sp.base_storage_gb, sp.extra_storage_gb, sp.used_storage_bytes,
          (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) AS total_storage_gb,
          CASE
            WHEN sp.used_storage_bytes IS NOT NULL AND (sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0)) > 0
            THEN ROUND(sp.used_storage_bytes::numeric / ((sp.base_storage_gb + COALESCE(sp.extra_storage_gb,0))::bigint * 1073741824) * 100)::int
            ELSE 0
          END AS usage_pct,
          COALESCE(sp.upload_blocked, false) AS upload_blocked
        FROM swimming_pools sp
        WHERE sp.approval_status = 'approved'
        ORDER BY usage_pct DESC, sp.name ASC
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

      const map: Record<string, any> = {};
      rows.forEach((r: any) => { map[r.key] = r; });

      if (!map["refund_policy"]) {
        map["refund_policy"] = { key: "refund_policy", value: DEFAULT_REFUND_POLICY, updated_at: null, updated_by: null };
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
        res.status(400).json({ error: "내용을 입력해주세요." }); return;
      }
      const actorName = req.user?.name ?? "슈퍼관리자";
      await db.execute(sql`
        INSERT INTO system_policies (key, value, updated_at, updated_by)
        VALUES (${key}, ${value}, NOW(), ${actorName})
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
      `);
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, 'system', '정책', ${req.user!.userId}, ${actorName}, ${key}, ${'정책 수정: ' + key}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/op-logs
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

      const conditions: string[] = [];
      if (category && category !== "전체") conditions.push(`el.category = '${category.replace(/'/g, "''")}'`);
      if (pool_id) conditions.push(`el.pool_id = '${pool_id.replace(/'/g, "''")}'`);

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = (await db.execute(sql.raw(`
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
// POST /super/op-logs
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
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/storage/:poolId
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
        FROM swimming_pools WHERE id = ${poolId}
      `)).rows as any[];

      if (!pool) { res.status(404).json({ error: "수영장 없음" }); return; }

      const totalGb    = (pool.base_storage_gb || 5) + (pool.extra_storage_gb || 0);
      const usedBytes  = Number(pool.used_storage_bytes || 0);
      const totalBytes = totalGb * 1073741824;
      const usagePct   = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

      res.json({ ...pool, total_storage_gb: totalGb, usage_pct: usagePct, is_near_limit: usagePct >= 95 });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PUT /super/storage/:poolId
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
        res.status(400).json({ error: "잘못된 용량 값" }); return;
      }
      await db.execute(sql`UPDATE swimming_pools SET extra_storage_gb = ${extra_storage_gb} WHERE id = ${poolId}`);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${poolId}, '저장공간', ${req.user!.userId}, ${actorName}, ${poolId},
                ${'추가 용량 변경: ' + extra_storage_gb + 'GB'}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ── DB 초기화: 컬럼 + 테이블 (앱 시작 시 즉시 실행) ──────────────────
let _ensureDone = false;
async function ensureExtraTables() {
  if (_ensureDone) return;
  // swimming_pools 필수 컬럼 추가
  for (const ddl of [
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS pool_type TEXT DEFAULT 'swimming_pool'`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS used_storage_bytes BIGINT DEFAULT 0`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS base_storage_gb INTEGER DEFAULT 5`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS extra_storage_gb INTEGER DEFAULT 0`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS credit_balance INTEGER DEFAULT 0`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS is_readonly BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS upload_blocked BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS readonly_reason TEXT`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS rejection_reason TEXT`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS subscription_end_at TIMESTAMPTZ`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS trial_end_at TIMESTAMPTZ`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial'`,
  ]) {
    await db.execute(sql.raw(ddl)).catch(() => {});
  }
  // users 컬럼
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`).catch(() => {});
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id          TEXT PRIMARY KEY,
      ticket_type TEXT NOT NULL DEFAULT 'other',
      requester_type TEXT NOT NULL DEFAULT 'operator',
      requester_name TEXT,
      pool_id     TEXT,
      subject     TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'open',
      assignee    TEXT,
      sla_hours   INTEGER DEFAULT 24,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_versions (
      id          TEXT PRIMARY KEY,
      policy_key  TEXT NOT NULL,
      version     TEXT NOT NULL,
      value       TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      created_by  TEXT
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policy_consents (
      id          TEXT PRIMARY KEY,
      pool_id     TEXT NOT NULL,
      policy_key  TEXT NOT NULL,
      version     TEXT NOT NULL,
      agreed_at   TIMESTAMPTZ DEFAULT NOW(),
      ip_address  TEXT,
      UNIQUE(pool_id, policy_key, version)
    )
  `);
  // 기능 플래그
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS feature_flags (
      key         TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      category    TEXT DEFAULT 'general',
      global_enabled BOOLEAN DEFAULT FALSE,
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_by  TEXT
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS feature_flag_overrides (
      id          TEXT PRIMARY KEY,
      flag_key    TEXT NOT NULL,
      pool_id     TEXT NOT NULL,
      enabled     BOOLEAN DEFAULT FALSE,
      reason      TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_by  TEXT,
      UNIQUE(flag_key, pool_id)
    )
  `);
  // 기본 기능 플래그 시드
  for (const [key, name, desc, cat] of [
    ["new_scheduler",          "새 스케줄러",          "개선된 수업 스케줄러 엔진 사용", "기능"],
    ["new_subscription_policy","새 구독 정책",         "구독 정책 v2 적용",              "구독"],
    ["auto_deletion_policy",   "자동 삭제 정책",       "구독 해지 후 24h 자동 삭제",     "데이터"],
    ["support_center",         "고객센터 기능",         "고객센터 티켓 시스템 활성화",    "기능"],
    ["new_upload_structure",   "새 업로드 구조",        "업로드 파이프라인 v2 사용",      "저장공간"],
    ["readonly_auto_trigger",  "읽기전용 자동 전환",    "구독 만료 시 자동 읽기전용 전환","구독"],
    ["credit_auto_apply",      "크레딧 자동 차감",      "다음 결제 시 크레딧 자동 차감",  "구독"],
    ["upload_spike_detection", "업로드 급증 탐지",      "24h 급증 운영자 자동 감지",      "저장공간"],
  ] as const) {
    await db.execute(sql`
      INSERT INTO feature_flags (key, name, description, category)
      VALUES (${key}, ${name}, ${desc}, ${cat})
      ON CONFLICT (key) DO NOTHING
    `).catch(() => {});
  }
  _ensureDone = true;
}

// ════════════════════════════════════════════════════════════════
// GET /super/risk-center — 장애·리스크 센터 통합 데이터
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/risk-center",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const [payFailed, storageDanger, deletionPending, uploadSpike, openTickets, lastBackup] =
        await Promise.all([
          // 결제 실패
          db.execute(sql`
            SELECT id, name, owner_name, subscription_status, subscription_end_at
            FROM swimming_pools
            WHERE approval_status = 'approved'
              AND subscription_status IN ('expired','suspended','cancelled')
            ORDER BY subscription_end_at ASC NULLS LAST LIMIT 20
          `),
          // 저장 95% 초과
          db.execute(sql`
            SELECT id, name, owner_name, used_storage_bytes,
                   (base_storage_gb + COALESCE(extra_storage_gb,0)) AS total_gb,
                   ROUND(used_storage_bytes::numeric /
                     NULLIF((base_storage_gb + COALESCE(extra_storage_gb,0))::bigint * 1073741824, 0) * 100)::int AS usage_pct
            FROM swimming_pools
            WHERE approval_status = 'approved'
              AND used_storage_bytes IS NOT NULL
              AND (base_storage_gb + COALESCE(extra_storage_gb,0)) > 0
              AND used_storage_bytes::float /
                  ((base_storage_gb + COALESCE(extra_storage_gb,0))::bigint * 1073741824) >= 0.95
            ORDER BY usage_pct DESC LIMIT 20
          `),
          // 자동삭제 예정 (48h)
          db.execute(sql`
            SELECT id, name, owner_name, subscription_end_at,
                   EXTRACT(EPOCH FROM (subscription_end_at - NOW())) / 3600 AS hours_left
            FROM swimming_pools
            WHERE subscription_end_at IS NOT NULL
              AND subscription_end_at > NOW()
              AND subscription_end_at <= NOW() + INTERVAL '48 hours'
            ORDER BY subscription_end_at ASC LIMIT 20
          `),
          // 업로드 급증 (24h 내 저장공간 이벤트 많은 운영자)
          db.execute(sql`
            SELECT el.pool_id, sp.name, sp.owner_name, COUNT(*)::int AS event_count
            FROM event_logs el
            JOIN swimming_pools sp ON sp.id = el.pool_id
            WHERE el.category = '저장공간'
              AND el.created_at >= NOW() - INTERVAL '24 hours'
            GROUP BY el.pool_id, sp.name, sp.owner_name
            HAVING COUNT(*) >= 5
            ORDER BY event_count DESC LIMIT 10
          `),
          // 미처리 고객센터 티켓
          db.execute(sql`
            SELECT COUNT(*)::int AS open_count,
                   COUNT(*) FILTER (WHERE created_at <= NOW() - (sla_hours || ' hours')::interval)::int AS overdue_count
            FROM support_tickets
            WHERE status IN ('open','in_progress')
          `).catch(() => ({ rows: [{ open_count: 0, overdue_count: 0 }] })),
          // 마지막 백업 시간
          db.execute(sql`
            SELECT MAX(created_at) AS last_at FROM event_logs
            WHERE description ILIKE '%백업%' OR category = '백업'
          `).catch(() => ({ rows: [{ last_at: null }] })),
        ]);

      res.json({
        payment_failed:   payFailed.rows,
        storage_danger:   storageDanger.rows,
        deletion_pending: deletionPending.rows,
        upload_spike:     uploadSpike.rows,
        support: (openTickets.rows[0] as any) ?? { open_count: 0, overdue_count: 0 },
        backup: { last_at: (lastBackup.rows[0] as any)?.last_at ?? null },
        external_services: [
          { name: "데이터베이스", status: "normal" },
          { name: "오브젝트 스토리지", status: "normal" },
          { name: "API 서버", status: "normal" },
          { name: "Expo 빌드", status: "normal" },
        ],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/support-tickets
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/support-tickets",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { status, ticket_type, limit = "50", offset = "0" } = req.query as any;
      const conds: string[] = [];
      if (status && status !== "all") conds.push(`st.status = '${status.replace(/'/g,"''")}'`);
      if (ticket_type && ticket_type !== "all") conds.push(`st.ticket_type = '${ticket_type.replace(/'/g,"''")}'`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const rows = (await db.execute(sql.raw(`
        SELECT st.*, sp.name AS pool_name
        FROM support_tickets st
        LEFT JOIN swimming_pools sp ON sp.id = st.pool_id
        ${where}
        ORDER BY st.created_at DESC
        LIMIT ${Number(limit)} OFFSET ${Number(offset)}
      `))).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/support-tickets
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/support-tickets",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { ticket_type, requester_type, requester_name, pool_id, subject, description, sla_hours } = req.body as any;
      if (!subject) { res.status(400).json({ error: "제목을 입력해주세요." }); return; }
      const id = `tkt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO support_tickets (id, ticket_type, requester_type, requester_name, pool_id, subject, description, sla_hours)
        VALUES (${id}, ${ticket_type ?? "other"}, ${requester_type ?? "operator"}, ${requester_name ?? null},
                ${pool_id ?? null}, ${subject}, ${description ?? null}, ${sla_hours ?? 24})
      `);
      res.json({ ok: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/support-tickets/:id
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/support-tickets/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const { status, assignee, description } = req.body as any;
      if (status === "resolved") {
        await db.execute(sql`
          UPDATE support_tickets SET status = ${status}, assignee = ${assignee ?? null},
            description = COALESCE(${description ?? null}, description),
            updated_at = NOW(), resolved_at = NOW() WHERE id = ${id}
        `);
      } else {
        await db.execute(sql`
          UPDATE support_tickets SET status = COALESCE(${status ?? null}, status),
            assignee = COALESCE(${assignee ?? null}, assignee),
            description = COALESCE(${description ?? null}, description),
            updated_at = NOW() WHERE id = ${id}
        `);
      }
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/policy-versions/:key — 정책 버전 목록
// POST /super/policy-versions/:key — 새 버전 저장
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/policy-versions/:key",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const rows = (await db.execute(sql`
        SELECT id, policy_key, version, created_at, created_by,
               LEFT(value, 120) AS preview
        FROM policy_versions
        WHERE policy_key = ${req.params.key}
        ORDER BY created_at DESC LIMIT 20
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.post(
  "/super/policy-versions/:key",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { key } = req.params;
      const { version, value } = req.body as any;
      if (!version || !value) { res.status(400).json({ error: "버전·내용을 입력해주세요." }); return; }
      const id = `pv_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const actorName = req.user?.name ?? "슈퍼관리자";
      await db.execute(sql`
        INSERT INTO policy_versions (id, policy_key, version, value, created_by)
        VALUES (${id}, ${key}, ${version}, ${value}, ${actorName})
      `);
      res.json({ ok: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/policy-consents — 정책 미동의 운영자 목록
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/policy-consents",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { policy_key } = req.query as any;
      // 승인된 운영자 중 해당 정책에 동의하지 않은 목록
      const rows = (await db.execute(sql`
        SELECT sp.id, sp.name, sp.owner_name, sp.approval_status, sp.created_at
        FROM swimming_pools sp
        WHERE sp.approval_status = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM policy_consents pc
            WHERE pc.pool_id = sp.id
              AND pc.policy_key = ${policy_key ?? "refund_policy"}
          )
        ORDER BY sp.created_at DESC
        LIMIT 50
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET /super/kill-switch-logs — 킬스위치 실행 로그
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/kill-switch-logs",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT el.id, el.pool_id, el.actor_name, el.description, el.metadata, el.created_at,
               sp.name AS pool_name
        FROM event_logs el
        LEFT JOIN swimming_pools sp ON sp.id = el.pool_id
        WHERE el.category = '삭제'
        ORDER BY el.created_at DESC LIMIT 50
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/operators/:id/defer-deletion — 삭제 유예 (종료 기간 연장)
// Body: { hours: number }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/operators/:id/defer-deletion",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { hours = 48 } = req.body as any;
      await db.execute(sql`
        UPDATE swimming_pools
        SET subscription_end_at = subscription_end_at + (${hours} || ' hours')::interval
        WHERE id = ${id} AND subscription_end_at IS NOT NULL
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '삭제', ${req.user!.userId}, ${actorName}, ${id},
                ${'삭제 유예 ' + hours + '시간'}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/operators/:id/cancel-deletion — 자동삭제 예약 취소
// subscription_end_at을 NULL로 초기화하고 subscription_status를 active로 복구
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/operators/:id/cancel-deletion",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      await db.execute(sql`
        UPDATE swimming_pools
        SET subscription_end_at = NULL,
            subscription_status = 'active'
        WHERE id = ${id}
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '삭제', ${req.user!.userId}, ${actorName}, ${id},
                '자동삭제 예약 취소', '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/subscription — 구독상태·크레딧 수동 조정
// Body: { subscription_status?: string; credit_amount?: number }
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/subscription",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const { subscription_status, credit_amount } = req.body as any;
      const actorName = req.user?.name ?? "슈퍼관리자";
      const updates: string[] = [];
      if (subscription_status) {
        await db.execute(sql`
          UPDATE swimming_pools SET subscription_status = ${subscription_status} WHERE id = ${id}
        `);
        updates.push(`구독상태 → ${subscription_status}`);
      }
      if (credit_amount != null && !isNaN(Number(credit_amount))) {
        const amt = Number(credit_amount);
        await db.execute(sql`
          UPDATE swimming_pools SET credit_balance = ${amt} WHERE id = ${id}
        `);
        updates.push(`크레딧 → ${amt.toLocaleString()}원`);
      }
      if (updates.length === 0) { res.status(400).json({ error: "변경 항목이 없습니다." }); return; }
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '구독', ${req.user!.userId}, ${actorName}, ${id},
                ${updates.join(" / ")}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/readonly — 읽기전용 전환
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/readonly",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const { enabled, reason } = req.body as any;
      await db.execute(sql`
        UPDATE swimming_pools SET is_readonly = ${!!enabled},
          readonly_reason = ${reason ?? null}
        WHERE id = ${id}
      `);
      const desc = enabled ? `읽기전용 전환: ${reason ?? ""}` : "읽기전용 해제";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '읽기전용 전환', ${req.user!.userId}, ${req.user?.name ?? "슈퍼관리자"},
                ${id}, ${desc}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/block-upload — 업로드 차단 토글
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/block-upload",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const { enabled } = req.body as any;
      await db.execute(sql`UPDATE swimming_pools SET upload_blocked = ${!!enabled} WHERE id = ${id}`);
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '저장공간', ${req.user!.userId}, ${req.user?.name ?? "슈퍼관리자"},
                ${id}, ${enabled ? "업로드 차단" : "업로드 차단 해제"}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/operators/:id/policy-reminder — 정책 재알림
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/operators/:id/policy-reminder",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { policy_key = "refund_policy" } = req.body as any;
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '정책', ${req.user!.userId}, ${req.user?.name ?? "슈퍼관리자"},
                ${id}, ${"정책 재알림 발송: " + policy_key}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// GET  /super/feature-flags       — 전체 기능 플래그 목록 (+오버라이드 수)
// PATCH /super/feature-flags/:key — 글로벌 토글
// GET  /super/feature-flags/:key/overrides — 운영자별 오버라이드 목록
// POST /super/feature-flags/:key/overrides — 오버라이드 추가/수정
// DELETE /super/feature-flags/:key/overrides/:poolId
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/feature-flags",
  requireAuth, requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const rows = (await db.execute(sql`
        SELECT ff.*,
          (SELECT COUNT(*)::int FROM feature_flag_overrides ffo WHERE ffo.flag_key = ff.key) AS override_count
        FROM feature_flags ff ORDER BY ff.category, ff.name
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.patch(
  "/super/feature-flags/:key",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { key } = req.params;
      const { global_enabled } = req.body as any;
      const actorName = req.user?.name ?? "슈퍼관리자";
      await db.execute(sql`
        UPDATE feature_flags SET global_enabled = ${!!global_enabled},
          updated_at = NOW(), updated_by = ${actorName}
        WHERE key = ${key}
      `);
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, NULL, '기능 플래그', ${req.user!.userId}, ${actorName},
                ${key}, ${`기능 플래그 ${global_enabled ? "활성화" : "비활성화"}: ${key}`}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.get(
  "/super/feature-flags/:key/overrides",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const rows = (await db.execute(sql`
        SELECT ffo.*, sp.name AS pool_name, sp.owner_name
        FROM feature_flag_overrides ffo
        LEFT JOIN swimming_pools sp ON sp.id = ffo.pool_id
        WHERE ffo.flag_key = ${req.params.key}
        ORDER BY ffo.created_at DESC
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.post(
  "/super/feature-flags/:key/overrides",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { key } = req.params;
      const { pool_id, enabled, reason } = req.body as any;
      if (!pool_id) { res.status(400).json({ error: "pool_id 필요" }); return; }
      const id = `ffo_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO feature_flag_overrides (id, flag_key, pool_id, enabled, reason, updated_by)
        VALUES (${id}, ${key}, ${pool_id}, ${!!enabled}, ${reason ?? null}, ${req.user?.name ?? "슈퍼관리자"})
        ON CONFLICT (flag_key, pool_id) DO UPDATE
          SET enabled = EXCLUDED.enabled, reason = EXCLUDED.reason,
              updated_by = EXCLUDED.updated_by
      `);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.delete(
  "/super/feature-flags/:key/overrides/:poolId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      await db.execute(sql`
        DELETE FROM feature_flag_overrides
        WHERE flag_key = ${req.params.key} AND pool_id = ${req.params.poolId}
      `);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// 구독 상품 테이블 보장
// ════════════════════════════════════════════════════════════════
async function ensurePlansTables() {
  // subscription_plans: 최종 확정 스키마
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      tier             TEXT PRIMARY KEY,
      plan_id          TEXT NOT NULL DEFAULT '',
      name             TEXT NOT NULL,
      price_per_month  INTEGER NOT NULL DEFAULT 0,
      member_limit     INTEGER NOT NULL DEFAULT 9999,
      storage_gb       NUMERIC NOT NULL DEFAULT 5,
      storage_mb       INTEGER NOT NULL DEFAULT 5120,
      display_storage  TEXT NOT NULL DEFAULT '',
      is_active        BOOLEAN NOT NULL DEFAULT TRUE
    )
  `).catch(() => {});
  // 기존 테이블에 누락된 컬럼 추가 (안전)
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_mb INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_storage TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});

  // revenue_logs 테이블 (billing.ts와 동일 — 누가 먼저 실행해도 안전)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS revenue_logs (
      id                      TEXT PRIMARY KEY,
      pool_id                 TEXT NOT NULL,
      pool_name               TEXT,
      plan_id                 TEXT NOT NULL,
      plan_name               TEXT,
      event_type              TEXT NOT NULL DEFAULT 'new_subscription',
      gross_amount            INTEGER NOT NULL DEFAULT 0,
      intro_discount_amount   INTEGER NOT NULL DEFAULT 0,
      charged_amount          INTEGER NOT NULL DEFAULT 0,
      refunded_amount         INTEGER NOT NULL DEFAULT 0,
      store_fee               INTEGER NOT NULL DEFAULT 0,
      net_revenue             INTEGER NOT NULL DEFAULT 0,
      payment_provider        TEXT NOT NULL DEFAULT 'store',
      provider_transaction_id TEXT,
      occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // 기존 revenue_logs에 누락된 컬럼 추가 (하위 호환)
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS pool_name TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS plan_name TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'new_subscription'`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS gross_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS intro_discount_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS charged_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS refunded_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'store'`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
  // 기존 amount 컬럼은 charged_amount와 동일 — 하위 호환 유지

  // 최종 확정 플랜 시드 (ON CONFLICT DO UPDATE로 항상 최신값 유지)
  for (const plan of [
    { tier: "free",            plan_id: "free_5",        name: "무료",             price: 0,      limit: 5,    storage_gb: 0.09765625, storage_mb: 100,    display: "100MB" },
    { tier: "starter",         plan_id: "swimnote_30",   name: "스타터",           price: 2900,   limit: 30,   storage_gb: 0.5859375,  storage_mb: 600,    display: "600MB" },
    { tier: "basic",           plan_id: "swimnote_50",   name: "베이직",           price: 3900,   limit: 50,   storage_gb: 1,          storage_mb: 1024,   display: "1GB"   },
    { tier: "standard",        plan_id: "swimnote_100",  name: "스탠다드",         price: 9900,   limit: 100,  storage_gb: 5,          storage_mb: 5120,   display: "5GB"   },
    { tier: "growth",          plan_id: "swimnote_300",  name: "어드밴스",         price: 29000,  limit: 300,  storage_gb: 20,         storage_mb: 20480,  display: "20GB"  },
    { tier: "pro",             plan_id: "swimnote_500",  name: "프로",             price: 59000,  limit: 500,  storage_gb: 40,         storage_mb: 40960,  display: "40GB"  },
    { tier: "max",             plan_id: "swimnote_1000", name: "맥스",             price: 99000,  limit: 1000, storage_gb: 100,        storage_mb: 102400, display: "100GB" },
    { tier: "enterprise_2000", plan_id: "swimnote_2000", name: "엔터프라이즈 2000", price: 179000, limit: 2000, storage_gb: 250,        storage_mb: 256000, display: "250GB" },
    { tier: "enterprise_3000", plan_id: "swimnote_3000", name: "엔터프라이즈 3000", price: 249000, limit: 3000, storage_gb: 400,        storage_mb: 409600, display: "400GB" },
  ]) {
    await db.execute(sql`
      INSERT INTO subscription_plans (tier, plan_id, name, price_per_month, member_limit, storage_gb, storage_mb, display_storage)
      VALUES (${plan.tier}, ${plan.plan_id}, ${plan.name}, ${plan.price}, ${plan.limit}, ${plan.storage_gb}, ${plan.storage_mb}, ${plan.display})
      ON CONFLICT (tier) DO UPDATE
        SET plan_id = ${plan.plan_id}, name = ${plan.name}, price_per_month = ${plan.price},
            member_limit = ${plan.limit}, storage_gb = ${plan.storage_gb},
            storage_mb = ${plan.storage_mb}, display_storage = ${plan.display}
    `).catch(() => {});
  }

  // 백업 테이블
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_backups (
      id              TEXT PRIMARY KEY,
      operator_id     TEXT,
      operator_name   TEXT,
      backup_type     TEXT NOT NULL DEFAULT 'operator',
      status          TEXT NOT NULL DEFAULT 'pending',
      is_snapshot     BOOLEAN NOT NULL DEFAULT FALSE,
      size_bytes      BIGINT,
      note            TEXT,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ
    )
  `).catch(() => {});

  // 읽기전용 제어 로그 테이블
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS readonly_control_logs (
      id              TEXT PRIMARY KEY,
      scope           TEXT NOT NULL DEFAULT 'operator',
      target_id       TEXT,
      target_name     TEXT,
      feature_key     TEXT,
      enabled         BOOLEAN NOT NULL DEFAULT FALSE,
      reason          TEXT,
      actor_name      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

// ════════════════════════════════════════════════════════════════
// GET /super/plans — 구독 상품 목록
// POST /super/plans — 구독 상품 생성
// PUT /super/plans/:id — 구독 상품 수정
// PATCH /super/plans/:id/toggle — 활성화/비활성화
// ════════════════════════════════════════════════════════════════

router.get("/super/plans", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const rows = (await db.execute(sql`SELECT * FROM subscription_plans ORDER BY price_per_month ASC`)).rows;
    res.json({ plans: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/super/plans", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const {
      tier, name, price_per_month = 0, member_limit = 9999, storage_gb = 5,
    } = req.body as any;
    if (!tier || !name) { res.status(400).json({ error: "tier와 name이 필요합니다" }); return; }
    await db.execute(sql`
      INSERT INTO subscription_plans (tier, name, price_per_month, member_limit, storage_gb)
      VALUES (${tier}, ${name}, ${price_per_month}, ${member_limit}, ${storage_gb})
    `);
    const actor = req.user?.name ?? "슈퍼관리자";
    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, NULL, '구독', ${req.user!.userId}, ${actor}, ${tier}, ${`구독 상품 생성: ${name}`}, '{}'::jsonb)
    `).catch(() => {});
    res.json({ ok: true, tier });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put("/super/plans/:id", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const tier = req.params.id; // :id param = tier 값
    const { name, price_per_month, member_limit, storage_gb, storage_mb, display_storage } = req.body as any;
    await db.execute(sql`
      UPDATE subscription_plans SET
        name            = COALESCE(${name ?? null}, name),
        price_per_month = COALESCE(${price_per_month ?? null}, price_per_month),
        member_limit    = COALESCE(${member_limit ?? null}, member_limit),
        storage_gb      = COALESCE(${storage_gb ?? null}, storage_gb),
        storage_mb      = COALESCE(${storage_mb ?? null}, storage_mb),
        display_storage = COALESCE(${display_storage ?? null}, display_storage)
      WHERE tier = ${tier}
    `);
    const actor = req.user?.name ?? "슈퍼관리자";
    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, NULL, '구독', ${req.user!.userId}, ${actor}, ${tier}, ${`구독 상품 수정: ${name ?? tier}`}, '{}'::jsonb)
    `).catch(() => {});
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.patch("/super/plans/:id/toggle", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    await ensurePlansTables();
    const rows = (await db.execute(sql`
      UPDATE subscription_plans SET is_active = NOT is_active WHERE tier = ${id}
      RETURNING tier, name, is_active
    `)).rows as any[];
    if (!rows.length) { res.status(404).json({ error: "플랜을 찾을 수 없습니다." }); return; }
    res.json({ ok: true, plan: rows[0] });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// 백업/스냅샷
// GET  /super/backups             — 백업 목록
// POST /super/backups             — 백업 생성
// POST /super/backups/:id/restore — 복구 실행
// POST /super/snapshots           — 스냅샷 생성
// ════════════════════════════════════════════════════════════════

router.get("/super/backups", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const rows = (await db.execute(sql`
      SELECT pb.*, sp.name AS operator_name_resolved
      FROM platform_backups pb
      LEFT JOIN swimming_pools sp ON sp.id = pb.operator_id
      ORDER BY pb.created_at DESC LIMIT 100
    `)).rows;
    res.json({ backups: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/super/backups", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const { operator_id, backup_type = "operator", note, is_snapshot = false } = req.body as any;
    const actor = req.user?.name ?? "슈퍼관리자";

    let operatorName: string | null = null;
    if (operator_id) {
      const r = await db.execute(sql`SELECT name FROM swimming_pools WHERE id = ${operator_id}`);
      operatorName = (r.rows[0] as any)?.name ?? null;
    }

    const id = `bak_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO platform_backups (id, operator_id, operator_name, backup_type, status, is_snapshot, note, created_by)
      VALUES (${id}, ${operator_id ?? null}, ${operatorName}, ${backup_type}, 'running', ${!!is_snapshot}, ${note ?? null}, ${actor})
    `);

    // 시뮬레이션: 즉시 완료 처리 (실제에서는 비동기 잡)
    const simSizeBytes = Math.floor(Math.random() * 500 * 1024 * 1024);
    await db.execute(sql`
      UPDATE platform_backups SET status = 'done', completed_at = NOW(), size_bytes = ${simSizeBytes} WHERE id = ${id}
    `);

    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, ${operator_id ?? null}, '백업', ${req.user!.userId}, ${actor},
              ${id}, ${is_snapshot ? `스냅샷 생성: ${operatorName ?? "플랫폼"}` : `백업 생성: ${operatorName ?? "플랫폼"}`}, '{}'::jsonb)
    `).catch(() => {});

    res.json({ ok: true, id, status: "done" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/super/backups/:id/restore", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const { id } = req.params;
    const { reason } = req.body as any;
    const actor = req.user?.name ?? "슈퍼관리자";

    const backup = (await db.execute(sql`SELECT * FROM platform_backups WHERE id = ${id}`)).rows[0] as any;
    if (!backup) { res.status(404).json({ error: "백업을 찾을 수 없습니다" }); return; }

    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, ${backup.operator_id ?? null}, '백업', ${req.user!.userId}, ${actor},
              ${id}, ${`데이터 복구 실행: ${backup.operator_name ?? "플랫폼"} (사유: ${reason ?? "미입력"})`}, '{}'::jsonb)
    `).catch(() => {});

    res.json({ ok: true, message: "복구가 기록되었습니다. 미디어 원본은 복구되지 않습니다." });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// 읽기전용 제어 (3단계: 플랫폼 전체, 운영자별, 기능별)
// GET  /super/readonly-control        — 현황
// POST /super/readonly-control        — 플랫폼 전체 읽기전용
// POST /super/readonly-control/feature — 기능별 읽기전용
// ════════════════════════════════════════════════════════════════

router.get("/super/readonly-control", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const [platformStatus, operatorList, featureList, recentLogs] = await Promise.all([
      db.execute(sql`
        SELECT value FROM system_policies WHERE key = 'platform_readonly'
      `).catch(() => ({ rows: [] })),
      db.execute(sql`
        SELECT id, name, owner_name, is_readonly, readonly_reason, subscription_status
        FROM swimming_pools WHERE is_readonly = TRUE ORDER BY name
      `),
      db.execute(sql`
        SELECT key, name, description, category, global_enabled
        FROM feature_flags WHERE key LIKE 'readonly%' OR category = '읽기전용'
        ORDER BY name
      `),
      db.execute(sql`
        SELECT * FROM readonly_control_logs ORDER BY created_at DESC LIMIT 20
      `).catch(() => ({ rows: [] })),
    ]);
    const platformReadonly = (platformStatus.rows[0] as any)?.value === "true";
    res.json({
      platform_readonly: platformReadonly,
      operators_readonly: operatorList.rows,
      feature_readonly: featureList.rows,
      recent_logs: recentLogs.rows,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/super/readonly-control", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    await ensurePoliciesTable();
    const { scope, target_id, feature_key, enabled, reason } = req.body as any;
    const actor = req.user?.name ?? "슈퍼관리자";

    if (scope === "platform") {
      await db.execute(sql`
        INSERT INTO system_policies (key, value, updated_by) VALUES ('platform_readonly', ${enabled ? "true" : "false"}, ${actor})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
      `);
    } else if (scope === "operator" && target_id) {
      await db.execute(sql`
        UPDATE swimming_pools SET is_readonly = ${!!enabled}, readonly_reason = ${reason ?? null} WHERE id = ${target_id}
      `);
    } else if (scope === "feature" && feature_key) {
      await db.execute(sql`
        UPDATE feature_flags SET global_enabled = ${!!enabled}, updated_by = ${actor}, updated_at = NOW() WHERE key = ${feature_key}
      `);
    } else {
      res.status(400).json({ error: "잘못된 scope 또는 대상" }); return;
    }

    const logId = `rcl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO readonly_control_logs (id, scope, target_id, target_name, feature_key, enabled, reason, actor_name)
      VALUES (${logId}, ${scope}, ${target_id ?? null}, ${null}, ${feature_key ?? null}, ${!!enabled}, ${reason ?? null}, ${actor})
    `).catch(() => {});

    const evtId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${evtId}, ${target_id ?? null}, '읽기전용', ${req.user!.userId}, ${actor},
              ${feature_key ?? target_id ?? "플랫폼"},
              ${`읽기전용 ${enabled ? "활성화" : "해제"} (${scope}) - ${reason ?? "사유 없음"}`}, '{}'::jsonb)
    `).catch(() => {});

    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// GET /super/risk-summary — 리스크 요약 (0이어도 표시)
// ════════════════════════════════════════════════════════════════

router.get("/super/risk-summary", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensureExtraTables();
    const [pay, store, del, policy, sla, sec] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE approval_status = 'approved' AND subscription_status IN ('expired','suspended','cancelled')
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE approval_status = 'approved'
          AND COALESCE(used_storage_bytes,0)::float /
              NULLIF((COALESCE(base_storage_gb,5)+COALESCE(extra_storage_gb,0))::bigint*1073741824,0) >= 0.95
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE subscription_end_at IS NOT NULL AND subscription_end_at > NOW()
          AND subscription_end_at <= NOW() + INTERVAL '24 hours'
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools sp
        WHERE sp.approval_status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM policy_consents pc WHERE pc.pool_id = sp.id AND pc.policy_key = 'refund_policy')
      `).catch(() => ({ rows: [{ cnt: 0 }] })),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM support_tickets
        WHERE status IN ('open','in_progress')
          AND created_at <= NOW() - (sla_hours || ' hours')::interval
      `).catch(() => ({ rows: [{ cnt: 0 }] })),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM event_logs
        WHERE category = '보안' AND created_at >= NOW() - INTERVAL '24 hours'
      `).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);
    res.json({
      payment_risk:      (pay.rows[0] as any)?.cnt ?? 0,
      storage_risk:      (store.rows[0] as any)?.cnt ?? 0,
      deletion_pending:  (del.rows[0] as any)?.cnt ?? 0,
      policy_unsigned:   (policy.rows[0] as any)?.cnt ?? 0,
      sla_overdue:       (sla.rows[0] as any)?.cnt ?? 0,
      security_events:   (sec.rows[0] as any)?.cnt ?? 0,
      feature_errors:    0,
      external_services: 0,
      backup_failures:   0,
      abuse_detected:    0,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// GET /super/recent-audit-logs — 최근 감사 로그 N개
// ════════════════════════════════════════════════════════════════

router.get("/super/recent-audit-logs", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10), 50);
    const rows = (await db.execute(sql`
      SELECT el.id, el.category, el.description, el.actor_name, el.pool_id, el.target,
             el.created_at, sp.name AS pool_name
      FROM event_logs el
      LEFT JOIN swimming_pools sp ON sp.id = el.pool_id
      ORDER BY el.created_at DESC
      LIMIT ${limit}
    `)).rows;
    res.json({ logs: rows });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 앱 시작 시 비동기로 테이블/컬럼 보장
ensureExtraTables().catch(err => console.error("[super] ensureExtraTables 오류:", err));
ensurePlansTables().catch(err => console.error("[super] ensurePlansTables 오류:", err));

export default router;
