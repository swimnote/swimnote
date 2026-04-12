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
import { superAdminDb } from "@workspace/db";
const db = superAdminDb;
import { sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";
import { Client as ObjectStorageClient } from "@replit/object-storage";
import { runRealBackup } from "../lib/backup.js";
import { resolveSubscription, applySubscriptionState, normalizeTier, backfillPoolSubscriptionFields } from "../lib/subscriptionService.js";
import { getPoolOperators } from "../lib/poolOperatorService.js";

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
        superAdminDb.execute(sql`
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
                    NULLIF(COALESCE(storage_mb,512)::bigint * 1048576, 0) >= 0.95
            )::int AS storage_danger_count,
            COUNT(*) FILTER (
              WHERE subscription_end_at IS NOT NULL
                AND subscription_end_at > NOW()
                AND subscription_end_at <= NOW() + INTERVAL '24 hours'
            )::int AS deletion_pending_count
          FROM swimming_pools
        `),
        // 승인 대기
        superAdminDb.execute(sql`
          SELECT id, name, owner_name, created_at, COALESCE(pool_type,'swimming_pool') AS pool_type,
                 'pending_approval' AS todo_type
          FROM swimming_pools WHERE approval_status = 'pending'
          ORDER BY created_at ASC LIMIT 10
        `),
        // 결제 실패
        superAdminDb.execute(sql`
          SELECT id, name, owner_name, subscription_status, subscription_end_at,
                 'payment_failed' AS todo_type
          FROM swimming_pools
          WHERE approval_status = 'approved'
            AND subscription_status IN ('expired','suspended')
          ORDER BY subscription_end_at ASC NULLS LAST LIMIT 10
        `),
        // 저장공간 위험 (95% 이상)
        superAdminDb.execute(sql`
          SELECT id, name, COALESCE(owner_name, '') AS owner_name,
                 COALESCE(used_storage_bytes,0) AS used_storage_bytes,
                 COALESCE(storage_mb,512) AS storage_mb,
                 COALESCE(display_storage,'500MB') AS display_storage,
                 LEAST(ROUND(
                   COALESCE(used_storage_bytes,0)::numeric /
                   NULLIF(COALESCE(storage_mb,512)::bigint * 1048576, 0) * 100
                 )::int, 100) AS usage_pct,
                 'storage_danger' AS todo_type
          FROM swimming_pools
          WHERE approval_status = 'approved'
            AND COALESCE(used_storage_bytes,0)::float /
                NULLIF(COALESCE(storage_mb,512)::bigint * 1048576, 0) >= 0.95
          ORDER BY usage_pct DESC LIMIT 10
        `),
        // 자동삭제 예정 (24h)
        superAdminDb.execute(sql`
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
        superAdminDb.execute(sql`
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
        superAdminDb.execute(sql`
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
// GET /super/pools-summary
// swimming_pools 기준 운영자+구독 통합 목록 (단일 소스, 중첩 응답)
//
// 응답 구조:
// {
//   pool_id, pool_name, pool_type, approval_status,
//   is_readonly, upload_blocked, credit_balance,
//   active_member_count, last_login_at, usage_pct,
//   deletion_pending, created_at, updated_at,
//   admin: { user_id, name, phone },
//   subscription: {
//     tier, plan_name, status, source,
//     member_limit, storage_mb, display_storage,
//     video_storage_limit_mb, white_label_enabled,
//     starts_at, ends_at, trial_end_at
//   }
// }
//
// count = list.length (별도 count 쿼리 없음)
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/pools-summary",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { search, filter } = req.query as any;

      const conditions: string[] = [];
      if (search) {
        const q = (search as string).replace(/'/g, "''");
        conditions.push(`(p.name ILIKE '%${q}%' OR u.name ILIKE '%${q}%' OR u.phone ILIKE '%${q}%')`);
      }
      if (filter === "pending")          conditions.push(`p.approval_status = 'pending'`);
      if (filter === "payment_failed")   conditions.push(`p.subscription_status IN ('expired','suspended','cancelled')`);
      if (filter === "active")           conditions.push(`p.approval_status = 'approved' AND p.subscription_status IN ('active','trial')`);
      if (filter === "storage95")        conditions.push(`p.used_storage_bytes IS NOT NULL AND p.storage_mb > 0 AND p.used_storage_bytes::float / (p.storage_mb::bigint * 1048576) >= 0.95`);
      if (filter === "this_week")        conditions.push(`p.created_at >= NOW() - INTERVAL '7 days'`);
      if (filter === "readonly")         conditions.push(`p.is_readonly = TRUE`);
      if (filter === "storage_alert")    conditions.push(`p.used_storage_bytes IS NOT NULL AND p.storage_mb > 0 AND p.used_storage_bytes::float / (p.storage_mb::bigint * 1048576) >= 0.80`);
      if (filter === "deletion_pending") conditions.push(`p.subscription_end_at IS NOT NULL AND p.subscription_end_at > NOW() AND p.subscription_end_at <= NOW() + INTERVAL '24 hours'`);
      if (filter === "policy_unsigned")  conditions.push(`p.approval_status = 'approved' AND NOT EXISTS (SELECT 1 FROM policy_consents pc WHERE pc.pool_id = p.id AND pc.policy_key = 'refund_policy')`);
      if (filter === "upload_spike")     conditions.push(`p.upload_blocked = TRUE`);
      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = (await db.execute(sql.raw(`
        SELECT
          p.id                                  AS pool_id,
          p.name                                AS pool_name,
          COALESCE(p.pool_type,'swimming_pool') AS pool_type,
          COALESCE(p.approval_status,'pending') AS approval_status,
          COALESCE(p.is_readonly, FALSE)        AS is_readonly,
          COALESCE(p.upload_blocked, FALSE)     AS upload_blocked,
          COALESCE(p.credit_balance, 0)         AS credit_balance,
          p.created_at,
          p.updated_at,
          -- 관리자 정보 (admin_user_id FK → users)
          u.id                                  AS admin_user_id,
          COALESCE(u.name, p.owner_name, '')    AS admin_name,
          COALESCE(u.phone, '')                 AS admin_phone,
          -- 구독 스냅샷 (swimming_pools 직접 저장값)
          COALESCE(p.subscription_tier,  'free')            AS sub_tier,
          COALESCE(p.subscription_plan_name, p.subscription_tier, 'Free') AS sub_plan_name,
          COALESCE(p.subscription_status, 'trial')          AS sub_status,
          COALESCE(p.subscription_source, 'free_default')   AS sub_source,
          COALESCE(p.member_limit, 10)                      AS sub_member_limit,
          COALESCE(p.storage_mb, 512)                       AS sub_storage_mb,
          COALESCE(p.display_storage, '500MB')              AS sub_display_storage,
          COALESCE(p.video_storage_limit_mb, 0)             AS sub_video_storage_limit_mb,
          COALESCE(p.white_label_enabled, FALSE)            AS sub_white_label_enabled,
          p.subscription_start_at                           AS sub_starts_at,
          p.subscription_end_at                             AS sub_ends_at,
          p.trial_end_at                                    AS sub_trial_end_at,
          -- 부가 통계 (서브쿼리)
          (
            SELECT COUNT(*)::int FROM students st
            WHERE st.swimming_pool_id = p.id
              AND st.status IN ('active','suspended')
          )                                     AS active_member_count,
          (
            SELECT MAX(u2.last_login_at) FROM users u2
            WHERE u2.swimming_pool_id = p.id
              AND u2.role IN ('pool_admin','super_admin')
          )                                     AS last_login_at,
          CASE
            WHEN p.used_storage_bytes IS NOT NULL AND COALESCE(p.storage_mb,0) > 0
            THEN LEAST(ROUND(
              p.used_storage_bytes::numeric
              / (COALESCE(p.storage_mb,512)::bigint * 1048576) * 100
            )::int, 100)
            ELSE 0
          END                                   AS usage_pct,
          p.used_storage_bytes,
          CASE
            WHEN p.subscription_end_at IS NOT NULL
              AND p.subscription_end_at > NOW()
              AND p.subscription_end_at <= NOW() + INTERVAL '24 hours'
            THEN true ELSE false
          END                                   AS deletion_pending
        FROM swimming_pools p
        LEFT JOIN users u ON u.id = p.admin_user_id
        ${whereClause}
        ORDER BY p.created_at DESC
        LIMIT 500
      `))).rows as any[];

      // 중첩 구조로 변환
      const result = rows.map(r => ({
        pool_id:             r.pool_id,
        pool_name:           r.pool_name,
        pool_type:           r.pool_type,
        approval_status:     r.approval_status,
        is_readonly:         r.is_readonly,
        upload_blocked:      r.upload_blocked,
        credit_balance:      Number(r.credit_balance),
        active_member_count: Number(r.active_member_count ?? 0),
        last_login_at:       r.last_login_at ?? null,
        usage_pct:           Number(r.usage_pct ?? 0),
        used_storage_bytes:  r.used_storage_bytes ? Number(r.used_storage_bytes) : 0,
        deletion_pending:    r.deletion_pending ?? false,
        created_at:          r.created_at,
        updated_at:          r.updated_at,
        admin: {
          user_id: r.admin_user_id ?? null,
          name:    r.admin_name,
          phone:   r.admin_phone,
        },
        subscription: {
          tier:                  r.sub_tier,
          plan_name:             r.sub_plan_name,
          status:                r.sub_status,
          source:                r.sub_source,
          member_limit:          Number(r.sub_member_limit),
          storage_mb:            Number(r.sub_storage_mb),
          display_storage:       r.sub_display_storage,
          video_storage_limit_mb: Number(r.sub_video_storage_limit_mb ?? 0),
          white_label_enabled:   r.sub_white_label_enabled,
          starts_at:             r.sub_starts_at ?? null,
          ends_at:               r.sub_ends_at ?? null,
          trial_end_at:          r.sub_trial_end_at ?? null,
        },
      }));

      res.json(result);
    } catch (err) {
      console.error("[pools-summary]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/billing/backfill-pools
// 기존 수영장 구독 필드(plan_name/storage_mb/display_storage) 일괄 채우기
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/billing/backfill-pools",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const result = await backfillPoolSubscriptionFields();
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /super/operators — 비활성화 (→ /super/pools-summary 로 대체)
// users 기반 운영자 목록 API 제거. swimming_pools 기준 API 사용.
router.get(
  "/super/operators",
  requireAuth,
  requireRole("super_admin"),
  (_req: AuthRequest, res) => {
    res.status(410).json({
      error: "Deprecated",
      message: "이 API는 비활성화되었습니다. GET /super/pools-summary 를 사용하세요.",
      redirect: "/super/pools-summary",
    });
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
    const { id } = req.params;
    try {
      // ① 수영장 기본 정보 (SELECT * 로 컬럼 미존재 오류 방지)
      const poolRes = await superAdminDb.execute(sql`
        SELECT * FROM swimming_pools WHERE id = ${id}
      `);
      const poolRow = poolRes.rows[0] as any;
      if (!poolRow) { res.status(404).json({ error: "운영자 없음" }); return; }

      // ② 가입된 관리자/스태프 목록 (users 테이블)
      let staffList: any[] = [];
      try {
        const staffRes = await superAdminDb.execute(sql`
          SELECT id, name, email, phone, role::text AS role, created_at, last_login_at
          FROM users
          WHERE swimming_pool_id = ${id}
          ORDER BY created_at ASC
        `);
        staffList = staffRes.rows as any[];
      } catch (e: any) {
        console.error(`[operator-detail] staff query error:`, e?.message);
      }

      // ③ 회원 수 (students 테이블)
      let memberStats = { active: 0, total: 0 };
      try {
        const mRes = await superAdminDb.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
            COUNT(*)::int AS total_count
          FROM students
          WHERE swimming_pool_id = ${id}
        `);
        const r = mRes.rows[0] as any;
        memberStats = { active: r?.active_count ?? 0, total: r?.total_count ?? 0 };
      } catch (e: any) {
        console.error(`[operator-detail] students query error:`, e?.message);
      }

      // ④ 수업 수 (classes 테이블)
      let classCount = 0;
      try {
        const cRes = await superAdminDb.execute(sql`
          SELECT COUNT(*)::int AS cnt FROM classes WHERE swimming_pool_id = ${id}
        `);
        classCount = (cRes.rows[0] as any)?.cnt ?? 0;
      } catch (e: any) {
        console.error(`[operator-detail] classes query error:`, e?.message);
      }

      // ⑤ 구독 플랜 목록
      let plans: any[] = [];
      try {
        const plRes = await superAdminDb.execute(sql`
          SELECT plan_id, name, price_per_month AS price, member_limit, storage_mb, display_storage, is_active
          FROM subscription_plans
          ORDER BY price_per_month ASC
        `);
        plans = plRes.rows as any[];
      } catch (e: any) {
        console.error(`[operator-detail] plans query error:`, e?.message);
      }

      // ⑥ 활동 로그 (event_logs — db = superAdminDb)
      let logs: any[] = [];
      try {
        const logRes = await db.execute(sql`
          SELECT id, category, actor_name, target, description, created_at
          FROM event_logs
          WHERE pool_id = ${id}
          ORDER BY created_at DESC
          LIMIT 50
        `);
        logs = logRes.rows as any[];
      } catch (e: any) {
        console.error(`[operator-detail] logs query error:`, e?.message);
      }

      // ⑦ 정책 동의 현황
      let policy: Record<string, string | null> = {};
      try {
        const polRes = await superAdminDb.execute(sql`
          SELECT policy_key, MAX(agreed_at)::text AS agreed_at
          FROM policy_consents
          WHERE pool_id = ${id}
          GROUP BY policy_key
        `);
        for (const r of polRes.rows as any[]) {
          policy[r.policy_key] = r.agreed_at ?? null;
        }
      } catch (e: any) {
        console.error(`[operator-detail] policy query error:`, e?.message);
      }

      // ⑧ 고객센터 티켓 통계
      let support = { total_count: 0, open_count: 0, resolved_count: 0 };
      try {
        const supRes = await db.execute(sql`
          SELECT
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS open_count,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved_count
          FROM support_tickets
          WHERE pool_id = ${id}
        `);
        const r = supRes.rows[0] as any;
        if (r) support = { total_count: r.total_count ?? 0, open_count: r.open_count ?? 0, resolved_count: r.resolved_count ?? 0 };
      } catch (e: any) {
        console.error(`[operator-detail] support query error:`, e?.message);
      }

      // 스태프 분류 — admins는 getPoolOperators 단일 소스 사용 (role='pool_admin' + is_activated=TRUE)
      const teachers  = staffList.filter(u => u.role === 'teacher');
      let admins: any[] = [];
      try {
        admins = await getPoolOperators(id);
      } catch (e: any) {
        console.error(`[operator-detail] admins query error:`, e?.message);
        admins = staffList.filter(u => u.role === 'pool_admin');
      }

      // resolver로 구독 상태 완전 계산
      const resolved = await resolveSubscription(id).catch(() => null);

      res.json({
        pool: {
          ...poolRow,
          member_limit:            resolved?.memberLimit        ?? (poolRow.member_limit ?? 10),
          base_storage_gb:         resolved?.storageGb          ?? (poolRow.base_storage_gb ?? 0.49),
          storage_mb:              resolved?.storageMb           ?? 512,
          display_storage:         resolved?.displayStorage      ?? "500MB",
          video_enabled:           resolved?.videoEnabled        ?? false,
          video_storage_limit_mb:  resolved?.videoStorageLimitMb ?? 0,
          white_label_enabled:     resolved?.whiteLabelEnabled   ?? false,
          subscription_tier:       resolved?.planCode            ?? poolRow.subscription_tier,
          subscription_status:     resolved?.status              ?? poolRow.subscription_status,
          subscription_source:     resolved?.source              ?? null,
          plan_name:               resolved?.planName             ?? null,
          price_per_month:         resolved?.pricePerMonth        ?? 0,
          subscription_starts_at:  resolved?.startsAt             ?? null,
          subscription_ends_at:    resolved?.endsAt               ?? null,
          trial_ends_at:           resolved?.trialEndsAt          ?? null,
          effective_reason:        resolved?.effectiveReason       ?? null,
          next_billing_at:         resolved?.nextBillingAt         ?? null,
          pending_tier:            resolved?.pendingTier           ?? null,
          pending_plan_name:       resolved?.pendingPlanName       ?? null,
          downgrade_at:            resolved?.downgradeAt           ?? null,
          active_member_count:    memberStats.active,
          total_member_count:     memberStats.total,
          total_class_count:      classCount,
          teacher_count:          teachers.length,
          staff_count:            staffList.length,
        },
        staff:    staffList,
        teachers,
        admins,
        logs,
        policy: {
          refund_policy:  policy["refund_policy"]  ?? null,
          privacy_policy: policy["privacy_policy"] ?? null,
          terms:          policy["terms"]           ?? null,
        },
        support,
        plans,
      });
    } catch (err: any) {
      console.error(`[operator-detail] fatal error for id=${id}:`, err?.message ?? err);
      res.status(500).json({ error: "서버 오류", detail: err?.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// DELETE /super/operators/:id — 수영장(운영자) 완전 삭제
// 슈퍼관리자 전용, 모든 관련 데이터 cascade 삭제
// ════════════════════════════════════════════════════════════════
router.delete(
  "/super/operators/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const actorName = req.user?.name ?? "슈퍼관리자";

      const [poolCheck] = (await superAdminDb.execute(sql`
        SELECT id, name FROM swimming_pools WHERE id = ${id}
      `)).rows as any[];

      if (!poolCheck) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

      const poolName = poolCheck.name;

      // 연관 데이터 순차 삭제 (FK 참조 순서 고려)
      await superAdminDb.execute(sql`DELETE FROM attendance WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM supplements WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM lesson_diaries WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM notices WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM students WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM classes WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM teacher_invites WHERE swimming_pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM policy_consents WHERE pool_id = ${id}`).catch(() => {});
      await superAdminDb.execute(sql`DELETE FROM parent_accounts WHERE swimming_pool_id = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM support_tickets WHERE pool_id = ${id}`).catch(() => {});
      await db.execute(sql`DELETE FROM event_logs WHERE pool_id = ${id}`).catch(() => {});
      // 사용자(스태프) 삭제
      await superAdminDb.execute(sql`
        DELETE FROM users WHERE swimming_pool_id = ${id} AND role IN ('pool_admin','sub_admin','teacher')
      `).catch(() => {});
      // 수영장 최종 삭제
      await superAdminDb.execute(sql`DELETE FROM swimming_pools WHERE id = ${id}`);

      // 삭제 감사 로그 (슈퍼관리자 DB에 남김)
      try {
        await db.execute(sql`
          INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
          VALUES (${`evt_del_${Date.now()}`}, ${id}, '삭제', ${req.user!.userId}, ${actorName},
                  ${id}, ${`수영장 완전 삭제: ${poolName}`}, '{}'::jsonb)
        `);
      } catch {}

      res.json({ ok: true, message: `${poolName} 삭제 완료` });
    } catch (err) {
      console.error("[DELETE pool]", err);
      res.status(500).json({ error: "삭제 처리 중 오류가 발생했습니다." });
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
      await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
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
          await superAdminDb.execute(sql`UPDATE swimming_pools SET approval_status = 'approved' WHERE id = ${id}`);
          desc = "일괄 승인";
        } else if (action === "reject") {
          await superAdminDb.execute(sql`UPDATE swimming_pools SET approval_status = 'rejected', rejection_reason = ${reason ?? "기준 미달"} WHERE id = ${id}`);
          desc = `일괄 반려: ${reason ?? "기준 미달"}`;
        } else if (action === "restrict") {
          await superAdminDb.execute(sql`UPDATE swimming_pools SET subscription_status = 'suspended' WHERE id = ${id}`);
          desc = `일괄 제한: ${reason ?? "운영 위반"}`;
        } else if (action === "readonly_on") {
          await superAdminDb.execute(sql`UPDATE swimming_pools SET is_readonly = TRUE, readonly_reason = ${reason ?? "일괄 읽기전용"} WHERE id = ${id}`);
          desc = `일괄 읽기전용 전환: ${reason ?? ""}`;
          category = "읽기전용 전환";
          logPoolEvent({
            pool_id: id, event_type: "read_only_mode.on", entity_type: "swimming_pool",
            entity_id: id, actor_id: req.user!.userId,
            payload: { reason: reason ?? "일괄 읽기전용" },
          }).catch(() => {});
        } else if (action === "readonly_off") {
          await superAdminDb.execute(sql`UPDATE swimming_pools SET is_readonly = FALSE WHERE id = ${id}`);
          desc = "일괄 읽기전용 해제";
          category = "읽기전용 전환";
          logPoolEvent({
            pool_id: id, event_type: "read_only_mode.off", entity_type: "swimming_pool",
            entity_id: id, actor_id: req.user!.userId,
            payload: {},
          }).catch(() => {});
        } else if (action === "block_upload") {
          await superAdminDb.execute(sql`UPDATE swimming_pools SET upload_blocked = TRUE WHERE id = ${id}`);
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
      const rows = (await superAdminDb.execute(sql`
        SELECT
          sp.id,
          sp.name,
          COALESCE(u.name, sp.owner_name, '') AS owner_name,
          sp.approval_status,
          COALESCE(sp.storage_mb, 512)         AS storage_mb,
          COALESCE(sp.display_storage, '500MB') AS display_storage,
          sp.used_storage_bytes,
          CASE
            WHEN sp.used_storage_bytes IS NOT NULL AND COALESCE(sp.storage_mb, 512) > 0
            THEN LEAST(ROUND(
              sp.used_storage_bytes::numeric
              / (COALESCE(sp.storage_mb, 512)::bigint * 1048576) * 100
            )::int, 100)
            ELSE 0
          END AS usage_pct,
          COALESCE(sp.upload_blocked, false) AS upload_blocked
        FROM swimming_pools sp
        LEFT JOIN users u ON u.id = sp.admin_user_id
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
      const [pool] = (await superAdminDb.execute(sql`
        SELECT id, name,
          COALESCE(storage_mb, 512)         AS storage_mb,
          COALESCE(display_storage, '500MB') AS display_storage,
          used_storage_bytes,
          upload_blocked
        FROM swimming_pools WHERE id = ${poolId}
      `)).rows as any[];

      if (!pool) { res.status(404).json({ error: "수영장 없음" }); return; }

      const storageMb  = Number(pool.storage_mb || 512);
      const usedBytes  = Number(pool.used_storage_bytes || 0);
      const totalBytes = storageMb * 1048576;
      const usagePct   = totalBytes > 0 ? Math.min(Math.round((usedBytes / totalBytes) * 100), 100) : 0;

      res.json({ ...pool, usage_pct: usagePct, is_near_limit: usagePct >= 95 });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// PUT /super/storage/:poolId — storage_mb 기준으로 용량 부여
// ════════════════════════════════════════════════════════════════
router.put(
  "/super/storage/:poolId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { poolId } = req.params;
      // add_mb: 추가할 MB (프론트에서 GB → MB 변환 후 전송)
      const { add_mb } = req.body as { add_mb: number };
      if (typeof add_mb !== "number" || add_mb < 0) {
        res.status(400).json({ error: "잘못된 용량 값 (add_mb 필요)" }); return;
      }
      // 현재 storage_mb 조회 후 더함
      const cur = (await superAdminDb.execute(sql`
        SELECT COALESCE(storage_mb, 512) AS storage_mb, display_storage
        FROM swimming_pools WHERE id = ${poolId}
      `)).rows[0] as any;
      const newMb = (cur?.storage_mb ?? 512) + add_mb;
      // display_storage 갱신: 1024 이상이면 GB 표기
      const newDisplay = newMb >= 1024
        ? `${(newMb / 1024).toFixed(1).replace(/\.0$/, "")}GB`
        : `${newMb}MB`;
      await superAdminDb.execute(sql`
        UPDATE swimming_pools
        SET storage_mb = ${newMb}, display_storage = ${newDisplay}
        WHERE id = ${poolId}
      `);
      const actorName = req.user?.name ?? "슈퍼관리자";
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${poolId}, '저장공간', ${req.user!.userId}, ${actorName}, ${poolId},
                ${'저장용량 추가: +' + add_mb + 'MB → 총 ' + newMb + 'MB (' + newDisplay + ')'}, '{}'::jsonb)
      `).catch(() => {});
      res.json({ ok: true, storage_mb: newMb, display_storage: newDisplay });
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
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS base_storage_gb FLOAT8 DEFAULT 5`,
    `ALTER TABLE swimming_pools ALTER COLUMN base_storage_gb TYPE FLOAT8 USING base_storage_gb::FLOAT8`,
    `ALTER TABLE swimming_pools ADD COLUMN IF NOT EXISTS extra_storage_gb FLOAT8 DEFAULT 0`,
    `ALTER TABLE swimming_pools ALTER COLUMN extra_storage_gb TYPE FLOAT8 USING extra_storage_gb::FLOAT8`,
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
  await superAdminDb.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`).catch(() => {});
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
  await superAdminDb.execute(sql`
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
  await superAdminDb.execute(sql`
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
    await superAdminDb.execute(sql`
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
          superAdminDb.execute(sql`
            SELECT id, name, owner_name, subscription_status, subscription_end_at
            FROM swimming_pools
            WHERE approval_status = 'approved'
              AND subscription_status IN ('expired','suspended','cancelled')
            ORDER BY subscription_end_at ASC NULLS LAST LIMIT 20
          `),
          // 저장 95% 초과
          superAdminDb.execute(sql`
            SELECT id, name, COALESCE(owner_name,'') AS owner_name,
                   COALESCE(used_storage_bytes,0) AS used_storage_bytes,
                   COALESCE(storage_mb,512) AS storage_mb,
                   COALESCE(display_storage,'500MB') AS display_storage,
                   LEAST(ROUND(
                     COALESCE(used_storage_bytes,0)::numeric /
                     NULLIF(COALESCE(storage_mb,512)::bigint * 1048576, 0) * 100
                   )::int, 100) AS usage_pct
            FROM swimming_pools
            WHERE approval_status = 'approved'
              AND COALESCE(used_storage_bytes,0)::float /
                  NULLIF(COALESCE(storage_mb,512)::bigint * 1048576, 0) >= 0.95
            ORDER BY usage_pct DESC LIMIT 20
          `),
          // 자동삭제 예정 (48h)
          superAdminDb.execute(sql`
            SELECT id, name, owner_name, subscription_end_at,
                   EXTRACT(EPOCH FROM (subscription_end_at - NOW())) / 3600 AS hours_left
            FROM swimming_pools
            WHERE subscription_end_at IS NOT NULL
              AND subscription_end_at > NOW()
              AND subscription_end_at <= NOW() + INTERVAL '48 hours'
            ORDER BY subscription_end_at ASC LIMIT 20
          `),
          // 업로드 급증 (24h 내 저장공간 이벤트 많은 운영자)
          superAdminDb.execute(sql`
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
      const rows = (await superAdminDb.execute(sql`
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
      const rows = (await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
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
// PATCH /super/operators/:id/subscription — 구독 전체 필드 수동 동기화
// Body: {
//   subscription_status?,   subscription_tier?,      credit_amount?,
//   is_readonly?,           upload_blocked?,          subscription_end_at?,
//   member_limit?,          trial_ends_at?,           subscription_started_at?,
//   member_limit_reset?     (true이면 pool 개별 override 제거)
// }
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/subscription",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const {
        subscription_status,
        subscription_tier: rawTier,
        credit_amount,
        is_readonly,
        upload_blocked,
        subscription_end_at,
        member_limit,
        member_limit_reset,
        trial_ends_at,
        subscription_started_at,
      } = req.body as any;

      const actorName = req.user?.name ?? "슈퍼관리자";
      const updates: string[] = [];

      // ── 현재 tier / status 조회 (applySubscriptionState에 필요) ──────
      const [curPool] = (await superAdminDb.execute(sql`
        SELECT subscription_tier, subscription_status FROM swimming_pools WHERE id = ${id} LIMIT 1
      `)).rows as any[];

      const effectiveTier   = rawTier ? normalizeTier(rawTier) : (curPool?.subscription_tier ?? "free");
      const effectiveStatus = subscription_status ?? (rawTier ? "active" : (curPool?.subscription_status ?? "active"));

      const memberLimitOpt =
        member_limit_reset === true ? null :
        (member_limit != null && !isNaN(Number(member_limit)) ? Number(member_limit) : undefined);

      const endAtOpt   = subscription_end_at   !== undefined ? (subscription_end_at   === "null" ? null : subscription_end_at)   : undefined;
      const trialAtOpt = trial_ends_at         !== undefined ? (trial_ends_at         === "null" ? null : trial_ends_at)         : undefined;
      const startAtOpt = subscription_started_at !== undefined ? (subscription_started_at === "null" ? null : subscription_started_at) : undefined;

      // ── 단일 applySubscriptionState 호출 ──────────────────────────
      if (rawTier || subscription_status || subscription_end_at !== undefined ||
          trial_ends_at !== undefined || subscription_started_at !== undefined ||
          memberLimitOpt !== undefined) {
        await applySubscriptionState(id, effectiveTier, "manual", effectiveStatus as any, {
          endsAt:              endAtOpt,
          trialEndsAt:         trialAtOpt,
          startsAt:            startAtOpt,
          memberLimitOverride: memberLimitOpt,
          resetReadonly:       effectiveStatus === "active",
        });
        if (rawTier)             updates.push(`구독티어 → ${effectiveTier} (파생값 자동 동기화)`);
        if (subscription_status) updates.push(`구독상태 → ${effectiveStatus}`);
        if (endAtOpt !== undefined)   updates.push(endAtOpt   ? `구독만료일 → ${endAtOpt}`   : "구독만료일 제거");
        if (trialAtOpt !== undefined) updates.push(trialAtOpt ? `체험만료일 → ${trialAtOpt}` : "체험만료일 제거");
        if (startAtOpt !== undefined) updates.push(startAtOpt ? `구독시작일 → ${startAtOpt}` : "구독시작일 제거");
        if (memberLimitOpt === null)        updates.push("회원한도 override 해제 (플랜 기본값 복귀)");
        else if (memberLimitOpt !== undefined) updates.push(`회원한도 → ${memberLimitOpt}명 (개별 override)`);
      }

      // ── 크레딧 ────────────────────────────────────────────────────
      if (credit_amount != null && !isNaN(Number(credit_amount))) {
        const amt = Number(credit_amount);
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET credit_balance = ${amt} WHERE id = ${id}
        `);
        updates.push(`크레딧 → ${amt.toLocaleString()}원`);
      }

      // ── 읽기전용 / 업로드 차단 ────────────────────────────────────
      if (typeof is_readonly === "boolean") {
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET is_readonly = ${is_readonly} WHERE id = ${id}
        `);
        updates.push(`읽기전용 → ${is_readonly}`);
      }
      if (typeof upload_blocked === "boolean") {
        await superAdminDb.execute(sql`
          UPDATE swimming_pools SET upload_blocked = ${upload_blocked} WHERE id = ${id}
        `);
        updates.push(`업로드차단 → ${upload_blocked}`);
      }

      if (updates.length === 0) { res.status(400).json({ error: "변경 항목이 없습니다." }); return; }

      // 변경 후 최신 resolver 결과 반환 (응답 전 DB 반영 완료 보장)
      const resolved = await resolveSubscription(id).catch(() => null);

      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (${logId}, ${id}, '구독', ${req.user!.userId}, ${actorName}, ${id},
                ${updates.join(" / ")}, '{}'::jsonb)
      `).catch(() => {});

      // 명시적 snake_case 필드로 응답 (앱/프론트엔드 즉시 상태 갱신용)
      res.json({
        ok: true,
        updates,
        resolved,
        // 앱이 즉시 읽을 수 있도록 최상위에 snake_case 필드 병렬 노출
        subscription_tier:       resolved?.planCode       ?? null,
        subscription_status:     resolved?.status         ?? null,
        subscription_source:     resolved?.source         ?? null,
        member_limit:            resolved?.memberLimit     ?? 10,
        storage_mb:              resolved?.storageMb        ?? 512,
        display_storage:         resolved?.displayStorage   ?? "500MB",
        video_storage_limit_mb:  resolved?.videoStorageLimitMb ?? 0,
        white_label_enabled:     resolved?.whiteLabelEnabled ?? false,
        plan_name:               resolved?.planName         ?? null,
        price_per_month:         resolved?.pricePerMonth    ?? 0,
        next_billing_at:         resolved?.nextBillingAt    ?? null,
        pending_tier:            resolved?.pendingTier      ?? null,
        pending_plan_name:       resolved?.pendingPlanName  ?? null,
        downgrade_at:            resolved?.downgradeAt      ?? null,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// ════════════════════════════════════════════════════════════════
// POST /super/billing/apply-pending-downgrades
// 만료된 다운그레이드 예약을 즉시 적용 (수동 크론 트리거)
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/billing/apply-pending-downgrades",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { pool_id } = req.body as any;
      const condition = pool_id
        ? sql`WHERE pending_tier IS NOT NULL AND downgrade_at IS NOT NULL AND swimming_pool_id = ${pool_id}`
        : sql`WHERE pending_tier IS NOT NULL AND downgrade_at IS NOT NULL`;

      const pending = (await db.execute(sql`
        SELECT swimming_pool_id, pending_tier, downgrade_at FROM pool_subscriptions ${condition}
      `)).rows as any[];

      const results: any[] = [];
      for (const row of pending) {
        try {
          await applySubscriptionState(row.swimming_pool_id, row.pending_tier, "revenuecat", "active", {
            nextBillingAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
            resetReadonly: true,
          });
          await db.execute(sql`
            UPDATE pool_subscriptions
            SET pending_tier = NULL, downgrade_at = NULL, updated_at = now()
            WHERE swimming_pool_id = ${row.swimming_pool_id}
          `);
          const resolved = await resolveSubscription(row.swimming_pool_id).catch(() => null);
          results.push({ pool_id: row.swimming_pool_id, applied: row.pending_tier, ok: true, resolved });
          console.log(`[super/apply-pending] 다운그레이드 적용: ${row.swimming_pool_id} → ${row.pending_tier}`);
        } catch (e: any) {
          results.push({ pool_id: row.swimming_pool_id, ok: false, error: e.message });
        }
      }
      res.json({ applied: results.length, results });
    } catch (err: any) {
      console.error("[super/apply-pending-downgrades]", err);
      res.status(500).json({ error: err?.message ?? "서버 오류" });
    }
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
      await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`UPDATE swimming_pools SET upload_blocked = ${!!enabled} WHERE id = ${id}`);
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
      const rows = (await superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
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
      const rows = (await superAdminDb.execute(sql`
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
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS storage_gb NUMERIC NOT NULL DEFAULT 5`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_storage TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});

  // revenue_logs 테이블 (billing.ts와 동일 — 누가 먼저 실행해도 안전)
  await superAdminDb.execute(sql`
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
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS pool_name TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS plan_name TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'new_subscription'`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS gross_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS intro_discount_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS charged_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS refunded_amount INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'store'`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS provider_transaction_id TEXT`).catch(() => {});
  await superAdminDb.execute(sql`ALTER TABLE revenue_logs ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`).catch(() => {});
  // 기존 amount 컬럼은 charged_amount와 동일 — 하위 호환 유지

  // growth → advance 티어 이름 마이그레이션 (기존 DB 데이터 정리)
  await superAdminDb.execute(sql`
    UPDATE subscription_plans SET tier = 'advance', plan_id = 'swimnote_300'
    WHERE tier = 'growth'
  `).catch(err => console.error('[super] growth→advance 마이그레이션 오류:', err?.message));

  // ★ 플랜 시드는 pool-db-init.ts가 단일 관리 (서버 시작 시 자동 실행)
  // 여기서는 스키마 DDL만 처리한다.

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
  // 백업 테이블 컬럼 보완 (파일 경로, 저장 방식, 백업 데이터)
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS file_path    TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS file_name    TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS storage_type TEXT DEFAULT 'database'`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS backup_type_v2 TEXT DEFAULT 'manual'`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS backup_data  TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS super_db_tables INT`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS pool_db_tables  INT`).catch(() => {});
  await db.execute(sql`ALTER TABLE platform_backups ADD COLUMN IF NOT EXISTS total_tables    INT`).catch(() => {});

  // 자동 백업 설정 테이블
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS backup_settings (
      id              TEXT PRIMARY KEY DEFAULT 'default',
      auto_enabled    BOOLEAN NOT NULL DEFAULT true,
      schedule_type   TEXT NOT NULL DEFAULT 'daily',
      run_hour        INT NOT NULL DEFAULT 3,
      run_minute      INT NOT NULL DEFAULT 0,
      retention_days  INT NOT NULL DEFAULT 7,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by      TEXT
    )
  `).catch(() => {});
  // 기본 설정 행 삽입 (없으면)
  await db.execute(sql`
    INSERT INTO backup_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING
  `).catch(() => {});

  // 읽기전용 제어 로그 테이블
  await superAdminDb.execute(sql`
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
    const rows = (await superAdminDb.execute(sql`
      SELECT pb.*, sp.name AS operator_name_resolved
      FROM platform_backups pb
      LEFT JOIN swimming_pools sp ON sp.id = pb.operator_id
      ORDER BY pb.created_at DESC LIMIT 100
    `)).rows as any[];
    // bigint 컬럼(size_bytes)은 pg driver가 string으로 반환 → Number() 변환
    const backups = rows.map((r) => ({
      ...r,
      size_bytes: r.size_bytes != null ? Number(r.size_bytes) : null,
    }));
    res.json({ backups });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/super/backups", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const { note } = req.body as any;
    const actor = req.user?.name ?? req.user?.email ?? "슈퍼관리자";

    console.log("[backup] 수동 백업 시작 — actor:", actor);
    const result = await runRealBackup({ type: "manual", createdBy: actor, note: note ?? undefined });
    console.log("[backup] 수동 백업 완료 —", result.filePath);

    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, NULL, '백업', ${req.user!.userId}, ${actor},
              ${result.backupId}, ${"수동 백업 생성: 전체 통합 백업 (" + result.fileName + ")"}, '{}'::jsonb)
    `).catch(() => {});

    res.json({
      ok:         true,
      id:         result.backupId,
      backup_id:  result.backupId,
      file_name:  result.fileName,
      file_path:  result.filePath,
      size_bytes: result.sizeBytes,
      status:     "done",
      created_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[backup] 수동 백업 실패:", e.message);
    res.status(500).json({ error: e.message });
  }
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

// ── 백업 다운로드 ─────────────────────────────────────────────────────────────
router.get("/super/backups/:id/download", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const { id } = req.params;
    const backup = (await db.execute(sql`
      SELECT id, file_name, storage_type, backup_data, file_path, size_bytes FROM platform_backups WHERE id = ${id}
    `)).rows[0] as any;
    if (!backup) { res.status(404).json({ error: "백업을 찾을 수 없습니다" }); return; }

    const fileName = backup.file_name ?? `${id}.json`;

    if (backup.storage_type === "database" && backup.backup_data) {
      // DB에서 직접 스트림
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Length", String(Buffer.byteLength(backup.backup_data, "utf8")));
      res.send(backup.backup_data);
      return;
    }

    // Object Storage에서 다운로드
    if (backup.storage_type === "object_storage" && backup.file_path) {
      try {
        const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
        const storageClient = bucketId ? new ObjectStorageClient({ bucketId }) : new ObjectStorageClient();
        const dlRes = await storageClient.downloadAsBytes(backup.file_path);
        if (!dlRes.ok) throw new Error("Object Storage 다운로드 실패");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Length", String(dlRes.value.length));
        res.send(dlRes.value[0]);
        return;
      } catch (e: any) {
        console.error("[backup] Object Storage 다운로드 실패:", e.message);
        res.status(500).json({ error: "Object Storage에서 파일을 가져오지 못했습니다: " + e.message });
        return;
      }
    }

    res.status(404).json({ error: "백업 데이터를 찾을 수 없습니다 (storage_type=" + backup.storage_type + ")" });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── 백업 설정 GET / PUT ────────────────────────────────────────────────────────
router.get("/super/backup-settings", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const row = (await db.execute(sql`SELECT * FROM backup_settings WHERE id = 'default'`)).rows[0] as any;
    res.json({ settings: row ?? {
      id: "default", auto_enabled: true, schedule_type: "daily",
      run_hour: 3, run_minute: 0, retention_days: 7,
    }});
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put("/super/backup-settings", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    const { auto_enabled, schedule_type, run_hour, run_minute, retention_days } = req.body as any;
    const actor = req.user?.name ?? req.user?.email ?? "슈퍼관리자";

    await db.execute(sql`
      UPDATE backup_settings SET
        auto_enabled   = ${!!auto_enabled},
        schedule_type  = ${schedule_type ?? "daily"},
        run_hour       = ${Number(run_hour ?? 3)},
        run_minute     = ${Number(run_minute ?? 0)},
        retention_days = ${Number(retention_days ?? 7)},
        updated_at     = NOW(),
        updated_by     = ${actor}
      WHERE id = 'default'
    `);

    const updated = (await db.execute(sql`SELECT * FROM backup_settings WHERE id = 'default'`)).rows[0];
    res.json({ ok: true, settings: updated });
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
      superAdminDb.execute(sql`
        SELECT id, name, owner_name, is_readonly, readonly_reason, subscription_status
        FROM swimming_pools WHERE is_readonly = TRUE ORDER BY name
      `),
      superAdminDb.execute(sql`
        SELECT key, name, description, category, global_enabled
        FROM feature_flags WHERE key LIKE 'readonly%' OR category = '읽기전용'
        ORDER BY name
      `),
      superAdminDb.execute(sql`
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
      await superAdminDb.execute(sql`
        UPDATE swimming_pools SET is_readonly = ${!!enabled}, readonly_reason = ${reason ?? null} WHERE id = ${target_id}
      `);
    } else if (scope === "feature" && feature_key) {
      await superAdminDb.execute(sql`
        UPDATE feature_flags SET global_enabled = ${!!enabled}, updated_by = ${actor}, updated_at = NOW() WHERE key = ${feature_key}
      `);
    } else {
      res.status(400).json({ error: "잘못된 scope 또는 대상" }); return;
    }

    const logId = `rcl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await superAdminDb.execute(sql`
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
      superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE approval_status = 'approved' AND subscription_status IN ('expired','suspended','cancelled')
      `),
      superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE approval_status = 'approved'
          AND COALESCE(used_storage_bytes,0)::float /
              NULLIF(COALESCE(storage_mb,512)::bigint*1048576,0) >= 0.95
      `),
      superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM swimming_pools
        WHERE subscription_end_at IS NOT NULL AND subscription_end_at > NOW()
          AND subscription_end_at <= NOW() + INTERVAL '24 hours'
      `),
      superAdminDb.execute(sql`
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
    const rows = (await superAdminDb.execute(sql`
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

// ════════════════════════════════════════════════════════════════
// GET  /super/platform-users  — 플랫폼 관리자 목록 (super_admin 역할 전체)
// POST /super/platform-users  — 플랫폼 관리자 계정 생성
// PATCH /super/platform-users/:id/permissions — 권한 수정
// ════════════════════════════════════════════════════════════════
router.get(
  "/super/platform-users",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT id, email, name, phone, role, permissions, created_at
        FROM users
        WHERE role = 'super_admin'
        ORDER BY created_at ASC
      `)).rows;
      res.json(rows);
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.post(
  "/super/platform-users",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { name, email, phone, permissions } = req.body as any;
      if (!name || !email) { res.status(400).json({ error: "이름과 이메일은 필수입니다." }); return; }
      const exists = (await db.execute(sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`)).rows;
      if (exists.length > 0) { res.status(409).json({ error: "이미 등록된 이메일입니다." }); return; }
      const bcrypt = (await import("bcryptjs")).default;
      const tempPw = Math.random().toString(36).slice(2, 10) + "Aa1!";
      const hash = await bcrypt.hash(tempPw, 10);
      const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const permsJson = permissions ? JSON.stringify(permissions) : null;
      await db.execute(sql`
        INSERT INTO users (id, email, password_hash, name, phone, role, permissions, is_activated)
        VALUES (${id}, ${email}, ${hash}, ${name}, ${phone ?? null}, 'super_admin',
                ${permsJson}::jsonb, true)
      `);
      res.json({ ok: true, id, temp_password: tempPw });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

router.patch(
  "/super/platform-users/:id/permissions",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body as any;
      const permsJson = permissions ? JSON.stringify(permissions) : null;
      await db.execute(sql`
        UPDATE users SET permissions = ${permsJson}::jsonb, updated_at = NOW()
        WHERE id = ${id} AND role = 'super_admin'
      `);
      res.json({ ok: true });
    } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
  }
);

// GET /super/platform-metrics — 플랫폼 전체 실사용량 지표 (비용 분석 화면용)
router.get(
  "/super/platform-metrics",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager"),
  async (_req, res) => {
    try {
      const storageRes = await db.execute(sql`
        SELECT
          COALESCE(SUM(COALESCE(used_storage_bytes, 0)), 0)::bigint AS total_used_bytes,
          COUNT(*)::int                                              AS total_pools,
          COUNT(*) FILTER (WHERE approval_status = 'approved')::int AS approved_pools
        FROM swimming_pools
      `);
      const row = storageRes.rows[0] ?? {};
      const totalUsedBytes = Number(row.total_used_bytes ?? 0);
      const totalUsedGb    = totalUsedBytes / (1024 ** 3);

      const subRes = await db.execute(sql`
        SELECT COUNT(*)::int AS active_subs
        FROM swimming_pools
        WHERE plan_id IS NOT NULL
          AND plan_id != 'free'
          AND subscription_status NOT IN ('deleted','cancelled')
      `);
      const activeSubs = Number(subRes.rows[0]?.active_subs ?? 0);

      res.json({
        total_storage_bytes: totalUsedBytes,
        total_storage_gb:    Math.round(totalUsedGb * 100) / 100,
        total_pools:         Number(row.total_pools ?? 0),
        approved_pools:      Number(row.approved_pools ?? 0),
        active_subscriptions: activeSubs,
      });
    } catch (err) {
      console.error("[super/platform-metrics]", err);
      res.json({ total_storage_bytes: 0, total_storage_gb: 0, total_pools: 0, approved_pools: 0, active_subscriptions: 0 });
    }
  }
);

// ── GET /super/scheduler-heartbeat — 스케줄러 상태 조회 ─────────────────────
// 예상 주기 × 3 초과 시 warning, 기록 없으면 empty
const JOB_EXPECTED_SECONDS: Record<string, number> = {
  "push-minute":       60,
  "parent-link":       60,
  "auto-attendance":   15 * 60,
  "push-makeup":       24 * 60 * 60,
  "backup-auto":       60 * 60,
  "backup-incremental": 24 * 60 * 60,
};

router.get(
  "/super/scheduler-heartbeat",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager"),
  async (_req, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT job_name, last_run_at, result
        FROM scheduler_heartbeat
        ORDER BY last_run_at DESC
      `)).rows as Array<{ job_name: string; last_run_at: string; result: any }>;

      const now = Date.now();
      const items = rows.map(r => {
        const expectedSec = JOB_EXPECTED_SECONDS[r.job_name] ?? 300;
        const lastMs = new Date(r.last_run_at).getTime();
        const elapsed = (now - lastMs) / 1000;
        const status: "ok" | "warning" = elapsed > expectedSec * 3 ? "warning" : "ok";
        return {
          job_name: r.job_name,
          last_run_at: r.last_run_at,
          elapsed_seconds: Math.round(elapsed),
          expected_seconds: expectedSec,
          result: r.result,
          status,
        };
      });

      // JOB_EXPECTED_SECONDS에 정의된 잡 중 기록 없는 것 추가 (empty)
      const recordedNames = new Set(rows.map(r => r.job_name));
      for (const jobName of Object.keys(JOB_EXPECTED_SECONDS)) {
        if (!recordedNames.has(jobName)) {
          items.push({
            job_name: jobName,
            last_run_at: "",
            elapsed_seconds: -1,
            expected_seconds: JOB_EXPECTED_SECONDS[jobName],
            result: null,
            status: "warning" as "ok" | "warning",
          });
        }
      }

      res.json({ items });
    } catch (err) {
      console.error("[super/scheduler-heartbeat]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// ── GET /super/ops-alerts — 슈퍼관리자 운영 알림 피드 (최신 10개) ────────────
router.get(
  "/super/ops-alerts",
  requireAuth,
  requireRole("super_admin", "platform_admin", "super_manager"),
  async (_req, res) => {
    try {
      const rows = (await db.execute(sql`
        SELECT id, type, title, message, severity, related_pool_id, related_user_id, is_read, created_at
        FROM ops_alerts
        ORDER BY created_at DESC
        LIMIT 10
      `)).rows as any[];

      res.json({ items: rows });
    } catch (err) {
      console.error("[super/ops-alerts]", err);
      res.status(500).json({ error: "서버 오류" });
    }
  }
);

// 앱 시작 시 비동기로 테이블/컬럼 보장
ensureExtraTables().catch(err => console.error("[super] ensureExtraTables 오류:", err));
ensurePlansTables().catch(err => console.error("[super] ensurePlansTables 오류:", err));

export default router;
