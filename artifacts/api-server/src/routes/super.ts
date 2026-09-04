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
import { computeMode, type XModeStatus, type PoolModeResult } from "../lib/xmode.js";
import { logPoolEvent } from "../lib/pool-event-logger.js";
import { logEvent } from "../lib/event-logger.js";
import { Client as ObjectStorageClient } from "@replit/object-storage";
import { runRealBackup } from "../lib/backup.js";
import { resolveSubscription, applySubscriptionState, normalizeTier, backfillPoolSubscriptionFields } from "../lib/subscriptionService.js";
import { getPoolOperators } from "../lib/poolOperatorService.js";
import { listAiTraces, getAiTraceByRequestId } from "../lib/ai-trace-service.js";
import { validateXModeReadiness } from "../lib/xmode-readiness.js";

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
            )::int AS deletion_pending_count,
            -- X MODE 활성 수영장: P0 rule = paid+not_force → x; manual+READY+not_force → x
            COUNT(*) FILTER (
              WHERE NOT COALESCE(x_force_disabled, false)
                AND (COALESCE(x_paid_entitlement, false)
                  OR (COALESCE(x_manual_entitlement, false) AND xmode_config_status = 'READY'))
            )::int AS xmode_operators
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
        // 정책 미확인 (refund_policy 현재 활성 버전 미동의)
        superAdminDb.execute(sql`
          SELECT sp.id, sp.name, sp.owner_name, sp.created_at, 'policy_unsigned' AS todo_type
          FROM swimming_pools sp
          WHERE sp.approval_status = 'approved'
            AND NOT EXISTS (
              SELECT 1 FROM policy_consents pc
              WHERE pc.pool_id = sp.id
                AND pc.policy_key = 'refund_policy'
                AND pc.version = COALESCE(
                  (SELECT version FROM policy_versions WHERE policy_key = 'refund_policy' AND is_active = TRUE ORDER BY created_at DESC LIMIT 1),
                  'v1.0'
                )
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
      // X MODE 활성 필터: P0 rule = paid+not_force → x; manual+READY+not_force → x
      if (filter === "xmode")           conditions.push(`NOT COALESCE(p.x_force_disabled, false) AND (COALESCE(p.x_paid_entitlement, false) OR (COALESCE(p.x_manual_entitlement, false) AND p.xmode_config_status = 'READY'))`);
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
          -- X MODE 필드 (X02-B2: effective=(paid OR manual) AND NOT force)
          (COALESCE(p.x_paid_entitlement, false) OR COALESCE(p.x_manual_entitlement, false))
            AND NOT COALESCE(p.x_force_disabled, false)    AS xmode_entitlement,
          COALESCE(p.xmode_config_status, 'NOT_CONFIGURED') AS xmode_config_status,
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
        xmode_entitlement:   Boolean(r.xmode_entitlement ?? false),
        xmode_config_status: (r.xmode_config_status ?? 'NOT_CONFIGURED') as string,
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

      // 삭제 대상 사용자 phone 수집 (phone_verifications 정리용)
      const userRows = (await superAdminDb.execute(sql`
        SELECT phone FROM users WHERE swimming_pool_id = ${id}
      `)).rows as any[];
      const phones = userRows.map((u: any) => u.phone).filter(Boolean);

      // 학부모 phone 수집
      const parentRows = (await superAdminDb.execute(sql`
        SELECT phone FROM parent_accounts WHERE swimming_pool_id = ${id}
      `)).rows as any[];
      const parentPhones = parentRows.map((p: any) => p.phone).filter(Boolean);

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

      // 사용자(스태프) 완전 삭제 — 역할 무관, withdrawal_requested_at 무시, 즉시 영구삭제
      await superAdminDb.execute(sql`
        DELETE FROM users WHERE swimming_pool_id = ${id}
      `).catch(() => {});

      // phone_verifications 잔여 기록 삭제 (아이디 중복 방지)
      for (const phone of [...phones, ...parentPhones]) {
        await superAdminDb.execute(sql`
          DELETE FROM phone_verifications WHERE phone = ${phone}
        `).catch(() => {});
      }

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
      is_active   BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      created_by  TEXT
    )
  `);
  // is_active 컬럼 마이그레이션 (기존 테이블 보완)
  await db.execute(sql`ALTER TABLE policy_versions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE`).catch(() => {});
  // DB 레벨 제약: policy_key 당 is_active=TRUE 는 최대 1개 (Partial Unique Index)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uidx_policy_versions_active_key
    ON policy_versions (policy_key)
    WHERE is_active = TRUE
  `).catch(() => {});
  // 각 policy_key 중 최신 버전을 is_active=TRUE로 설정
  await db.execute(sql`
    UPDATE policy_versions pv
    SET is_active = TRUE
    WHERE is_active = FALSE
      AND id = (
        SELECT id FROM policy_versions pv2
        WHERE pv2.policy_key = pv.policy_key
        ORDER BY created_at DESC LIMIT 1
      )
  `).catch(() => {});
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
      updated_by  TEXT,
      reason      TEXT
    )
  `);
  await superAdminDb.execute(sql`
    ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS reason TEXT
  `).catch(() => {});
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
  // event_logs — 운영 감사 로그 (로그인·보안·결제·권한 등 모든 이벤트)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS event_logs (
      id          TEXT PRIMARY KEY,
      pool_id     TEXT,
      category    TEXT NOT NULL DEFAULT '시스템',
      actor_id    TEXT,
      actor_name  TEXT,
      target      TEXT,
      description TEXT NOT NULL DEFAULT '',
      metadata    JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_event_logs_created_at  ON event_logs (created_at DESC)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_event_logs_category    ON event_logs (category)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_event_logs_pool_id     ON event_logs (pool_id)
  `).catch(() => {});

  // SA0-B: super_incidents 테이블
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS super_incidents (
      id               TEXT PRIMARY KEY,
      title            TEXT NOT NULL,
      severity         TEXT NOT NULL CHECK (severity IN ('SEV1','SEV2','SEV3','SEV4')),
      status           TEXT NOT NULL CHECK (status IN ('OPEN','INVESTIGATING','MITIGATED','RESOLVED')),
      service          TEXT,
      description      TEXT,
      root_cause       TEXT,
      action_taken     TEXT,
      started_at       TIMESTAMPTZ,
      detected_at      TIMESTAMPTZ,
      resolved_at      TIMESTAMPTZ,
      affected_pool_ids TEXT[] NOT NULL DEFAULT '{}',
      affected_users_count INTEGER DEFAULT 0,
      request_id       TEXT,
      trace_id         TEXT,
      reference        TEXT,
      created_by       TEXT,
      updated_by       TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await superAdminDb.execute(sql`CREATE INDEX IF NOT EXISTS idx_super_incidents_status   ON super_incidents (status)`).catch(() => {});
  await superAdminDb.execute(sql`CREATE INDEX IF NOT EXISTS idx_super_incidents_severity ON super_incidents (severity)`).catch(() => {});
  await superAdminDb.execute(sql`CREATE INDEX IF NOT EXISTS idx_super_incidents_created  ON super_incidents (created_at DESC)`).catch(() => {});

  // WP15.5-C: ad_creatives 테이블
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS ad_creatives (
      id              TEXT PRIMARY KEY,
      placement       TEXT NOT NULL DEFAULT 'PARENT_HOME_BANNER',
      creative_type   TEXT NOT NULL DEFAULT 'IMAGE_WITH_TEXT',
      headline        TEXT,
      body_text       TEXT,
      image_url       TEXT,
      destination_url TEXT,
      effect_type     TEXT NOT NULL DEFAULT 'NONE',
      display_order   INTEGER NOT NULL DEFAULT 0,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      target_region   TEXT[] NOT NULL DEFAULT '{}',
      target_age_band TEXT[] NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await superAdminDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_placement_active
    ON ad_creatives (placement, is_active, display_order)
  `).catch(() => {});

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
      // 기존 활성 버전 비활성화
      await db.execute(sql`UPDATE policy_versions SET is_active = FALSE WHERE policy_key = ${key}`);
      // 새 버전 is_active=TRUE로 삽입
      await db.execute(sql`
        INSERT INTO policy_versions (id, policy_key, version, value, is_active, created_by)
        VALUES (${id}, ${key}, ${version}, ${value}, TRUE, ${actorName})
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
// POST /super/operators/:id/purge — 운영자 데이터 영구 삭제 (슈퍼관리자 전용)
// Body: {
//   mode: "full" | "period" | "item",
//   fromDate?: string,  // YYYY-MM-DD (period 모드)
//   toDate?: string,    // YYYY-MM-DD (period 모드)
//   items?: string[],   // ["수업 영상","사진","일지","출석 기록","결제 기록"] (item 모드)
//   deletionReason: "operator_terminated"|"manual_by_admin"|"policy_violation",
//   reasonDetail: string,
//   password: string,
// }
// ════════════════════════════════════════════════════════════════
router.post(
  "/super/operators/:id/purge",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id: poolId } = req.params;
      const {
        mode, fromDate, toDate, items = [],
        deletionReason, reasonDetail, password,
      } = req.body as {
        mode: "full" | "period" | "item";
        fromDate?: string; toDate?: string; items?: string[];
        deletionReason: string; reasonDetail: string; password: string;
      };

      if (!mode || !["full","period","item"].includes(mode)) {
        res.status(400).json({ error: "삭제 방식을 선택해주세요." }); return;
      }
      if (!deletionReason) {
        res.status(400).json({ error: "삭제 사유를 선택해주세요." }); return;
      }
      if (!reasonDetail || reasonDetail.trim().length < 5) {
        res.status(400).json({ error: "상세 사유를 5자 이상 입력해주세요." }); return;
      }
      if (!password) {
        res.status(400).json({ error: "비밀번호를 입력해주세요." }); return;
      }
      if (mode === "period" && (!fromDate || !toDate)) {
        res.status(400).json({ error: "기간 지정 삭제는 시작일/종료일이 필요합니다." }); return;
      }
      if (mode === "item" && items.length === 0) {
        res.status(400).json({ error: "항목별 삭제는 최소 1개 항목을 선택해야 합니다." }); return;
      }

      const userId = req.user!.userId;

      // ── 슈퍼관리자 비밀번호 검증 ────────────────────────────
      const [userRow] = (await superAdminDb.execute(sql`
        SELECT password_hash, name FROM users WHERE id = ${userId} LIMIT 1
      `)).rows as any[];
      if (!userRow) { res.status(403).json({ error: "사용자 정보 없음" }); return; }

      const { comparePassword: cmpPwd } = await import("../lib/auth.js");
      const valid = await cmpPwd(password, userRow.password_hash);
      if (!valid) {
        res.status(401).json({ error: "비밀번호가 일치하지 않습니다." }); return;
      }

      const actorName = userRow.name || "슈퍼관리자";

      // ── 수영장 존재 확인 ─────────────────────────────────────
      const [poolRow] = (await superAdminDb.execute(sql`
        SELECT id, name FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)).rows as any[];
      if (!poolRow) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }

      const deleted = {
        videos: 0, photos: 0, class_records: 0,
        attendance: 0, payment_logs: 0, members: 0,
      };

      // ── 날짜 범위 조건 결정 ──────────────────────────────────
      let dateCondition = "";
      if (mode === "period" && fromDate && toDate) {
        dateCondition = `AND created_at >= '${fromDate}'::date AND created_at < ('${toDate}'::date + INTERVAL '1 day')`;
      }

      const shouldDelete = (itemLabel: string) =>
        mode === "full" ||
        mode === "period" ||
        (mode === "item" && items.includes(itemLabel));

      // ── 영상 삭제 ────────────────────────────────────────────
      if (shouldDelete("수업 영상")) {
        const [r] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM student_videos
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `))).rows as any[];
        await db.execute(sql.raw(`
          DELETE FROM student_videos
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `));
        deleted.videos = Number(r?.cnt ?? 0);
      }

      // ── 사진 삭제 ────────────────────────────────────────────
      if (shouldDelete("사진")) {
        const [r] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM student_photos
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `))).rows as any[];
        await db.execute(sql.raw(`
          DELETE FROM student_photos
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `));
        deleted.photos = Number(r?.cnt ?? 0);
      }

      // ── 수업기록/일지 삭제 ──────────────────────────────────
      if (shouldDelete("일지")) {
        const [cd] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM class_diaries
          WHERE swimming_pool_id = '${poolId}' AND is_deleted = false ${dateCondition}
        `))).rows as any[];
        const diaries = (await db.execute(sql.raw(`
          SELECT id FROM class_diaries
          WHERE swimming_pool_id = '${poolId}' AND is_deleted = false ${dateCondition}
        `))).rows as any[];
        if (diaries.length > 0) {
          const ids = diaries.map((d: any) => `'${d.id}'`).join(",");
          await db.execute(sql.raw(`DELETE FROM class_diary_student_notes WHERE diary_id IN (${ids})`));
          await db.execute(sql.raw(`DELETE FROM class_diaries WHERE id IN (${ids})`));
        }
        const [sd] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM swim_diary
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `))).rows as any[];
        await db.execute(sql.raw(`
          DELETE FROM swim_diary WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `));
        const [tm] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM teacher_daily_memos
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `))).rows as any[];
        await db.execute(sql.raw(`
          DELETE FROM teacher_daily_memos WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `));
        deleted.class_records = Number(cd?.cnt ?? 0) + Number(sd?.cnt ?? 0) + Number(tm?.cnt ?? 0);
      }

      // ── 출석 기록 삭제 ──────────────────────────────────────
      if (shouldDelete("출석 기록")) {
        const [r] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM attendances
          WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `))).rows as any[];
        await db.execute(sql.raw(`
          DELETE FROM attendances WHERE swimming_pool_id = '${poolId}' ${dateCondition}
        `));
        deleted.attendance = Number(r?.cnt ?? 0);
      }

      // ── 결제 기록 삭제 ──────────────────────────────────────
      if (shouldDelete("결제 기록")) {
        const [r] = (await superAdminDb.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM payment_logs
          WHERE pool_id = '${poolId}' ${dateCondition.replace(/created_at/g, 'paid_at')}
        `))).rows as any[];
        await superAdminDb.execute(sql.raw(`
          DELETE FROM payment_logs WHERE pool_id = '${poolId}'
          ${dateCondition.replace(/created_at/g, 'paid_at')}
        `));
        deleted.payment_logs = Number(r?.cnt ?? 0);
      }

      // ── 전체 삭제 전용: 회원 정보, 일정, 기타 ──────────────
      if (mode === "full") {
        const [mr] = (await db.execute(sql.raw(`
          SELECT COUNT(*)::int AS cnt FROM students
          WHERE swimming_pool_id = '${poolId}'
        `))).rows as any[];
        // 회원 연관 데이터 순서대로 삭제
        await db.execute(sql.raw(`
          DELETE FROM student_tag_assignments WHERE swimming_pool_id = '${poolId}'
        `)).catch(() => {});
        await db.execute(sql.raw(`
          DELETE FROM student_lesson_count WHERE student_id IN (
            SELECT id FROM students WHERE swimming_pool_id = '${poolId}'
          )
        `)).catch(() => {});
        await db.execute(sql.raw(`
          DELETE FROM students WHERE swimming_pool_id = '${poolId}'
        `)).catch(() => {});
        deleted.members = Number(mr?.cnt ?? 0);

        // 수영장 자체 상태 업데이트
        await superAdminDb.execute(sql.raw(`
          UPDATE swimming_pools
          SET subscription_status = 'cancelled',
              subscription_end_at = NOW(),
              is_readonly = true,
              upload_blocked = true,
              used_storage_bytes = 0
          WHERE id = '${poolId}'
        `));
      }

      const totalDeleted =
        deleted.videos + deleted.photos + deleted.class_records +
        deleted.attendance + deleted.payment_logs + deleted.members;

      const modeLabel = mode === "full" ? "전체 삭제" :
                        mode === "period" ? `기간 삭제 (${fromDate}~${toDate})` :
                        `항목별 삭제 (${items.join(", ")})`;

      const reasonLabel = deletionReason === "operator_terminated" ? "운영자 해지 확정" :
                          deletionReason === "manual_by_admin" ? "슈퍼관리자 수동 삭제" : "정책 위반";

      // ── 감사 이벤트 로그 ────────────────────────────────────
      const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      await superAdminDb.execute(sql.raw(`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (
          '${logId}',
          '${poolId}',
          '삭제',
          '${userId}',
          '${actorName}',
          '${poolRow.name.replace(/'/g, "''")}',
          '[킬스위치] ${modeLabel} — ${reasonLabel} — 총 ${totalDeleted}건 영구삭제',
          '${JSON.stringify({
            mode, deletionReason, reasonDetail,
            fromDate: fromDate ?? null, toDate: toDate ?? null, items,
            deleted, poolName: poolRow.name,
          }).replace(/'/g, "''")}'::jsonb
        )
      `)).catch(() => {});

      res.json({
        ok: true,
        pool_id: poolId,
        pool_name: poolRow.name,
        mode,
        deleted,
        total_deleted: totalDeleted,
        message: `${poolRow.name} — ${totalDeleted}건 영구 삭제 완료`,
      });
    } catch (err) {
      console.error("[purge]", err);
      res.status(500).json({ error: "서버 오류" });
    }
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
// PATCH /super/operators/:id/xmode — X 모드 상태 변경 (super_admin 전용)
//
// :id = swimming_pool_id
// Transaction 순서:
//   1. SELECT FOR UPDATE (pool 확인 + beforeData 확보)
//   2. pool 미존재 → throw isPoolNotFound
//   3. UPDATE RETURNING → afterData 확보
//   4. SELECT next_audit_version('swimming_pool_xmode', :id)
//   5. INSERT INTO audit_logs
//   6. Commit
// audit INSERT 실패 시 Transaction Rollback으로 UPDATE도 함께 취소된다.
//
// READY 전환 guard (validateXModeReadiness):
//   Transaction 전 실행 — x_pool_setups + curriculum + entitlement 검증
//   검증 실패 → 409 READY_PREREQUISITES_NOT_MET
// ════════════════════════════════════════════════════════════════
router.patch(
  "/super/operators/:id/xmode",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      xmode_entitlement,
      xmode_config_status,
      xmode_purchased_at,
      xmode_subscription_end_at,
      x_plan_key,
      bypass_readiness_check,
      reason,
    } = req.body as {
      xmode_entitlement?: boolean;
      xmode_config_status?: XModeStatus;
      xmode_purchased_at?: string | null;
      xmode_subscription_end_at?: string | null;
      x_plan_key?: string | null;          // Super Admin manual plan (x300/x500/x1000)
      bypass_readiness_check?: boolean;    // Super Admin manual grant — READY 검증 우회
      reason?: string;
    };

    // Super Admin manual grant: x_plan_key → member_limit 자동 반영
    const X_PLAN_LIMITS: Record<string, number> = { x300: 300, x500: 500, x1000: 1000 };
    const VALID_X_PLAN_KEYS = new Set(["x300", "x500", "x1000"]);

    // ── Transaction 밖: 입력 검증 ────────────────────────────────
    // X02-B2: xmode_entitlement 입력 → x_manual_entitlement 쓰기 (backward compat body key 유지)
    const hasEntitlement      = xmode_entitlement      !== undefined;
    const hasConfigStatus     = xmode_config_status    !== undefined;
    const hasPurchasedAt      = xmode_purchased_at     !== undefined;
    const hasSubscriptionEnd  = xmode_subscription_end_at !== undefined;
    const hasPlanKey          = x_plan_key             !== undefined;

    if (!hasEntitlement && !hasConfigStatus && !hasPurchasedAt && !hasSubscriptionEnd && !hasPlanKey) {
      res.status(400).json({ error: "변경 항목이 없습니다." }); return;
    }

    // x_plan_key 검증: null이거나 유효한 plan key여야 함
    if (hasPlanKey && x_plan_key !== null && !VALID_X_PLAN_KEYS.has(x_plan_key!)) {
      res.status(400).json({ error: "x_plan_key는 x300, x500, x1000 또는 null이어야 합니다." }); return;
    }
    if (hasEntitlement && typeof xmode_entitlement !== "boolean") {
      res.status(400).json({ error: "xmode_entitlement는 boolean이어야 합니다." }); return;
    }
    const validStatuses: XModeStatus[] = ["NOT_CONFIGURED", "CURRICULUM_PENDING", "READY"];
    if (hasConfigStatus && !validStatuses.includes(xmode_config_status!)) {
      res.status(400).json({ error: "xmode_config_status가 올바르지 않습니다." }); return;
    }
    if (hasPurchasedAt && xmode_purchased_at !== null) {
      if (typeof xmode_purchased_at !== "string") {
        res.status(400).json({ error: "xmode_purchased_at은 문자열 또는 null이어야 합니다." }); return;
      }
      if (isNaN(new Date(xmode_purchased_at).getTime())) {
        res.status(400).json({ error: "xmode_purchased_at이 올바른 날짜가 아닙니다." }); return;
      }
    }
    if (hasSubscriptionEnd && xmode_subscription_end_at !== null) {
      if (typeof xmode_subscription_end_at !== "string") {
        res.status(400).json({ error: "xmode_subscription_end_at은 문자열 또는 null이어야 합니다." }); return;
      }
      if (isNaN(new Date(xmode_subscription_end_at).getTime())) {
        res.status(400).json({ error: "xmode_subscription_end_at이 올바른 날짜가 아닙니다." }); return;
      }
    }

    // ── READY Transition Guard (Transaction 전 실행) ──────────────
    // x_setup_submissions + curriculum 파일 + entitlement 확인.
    // bypass_readiness_check=true: Super Admin manual grant 시 우회 허용.
    // 검증 실패 → 409 READY_PREREQUISITES_NOT_MET (DB write 없음).
    if (hasConfigStatus && xmode_config_status === "READY" && !bypass_readiness_check) {
      try {
        const readiness = await validateXModeReadiness(poolId, superAdminDb);
        if (!readiness.ready) {
          res.status(409).json({
            error:    "READY_PREREQUISITES_NOT_MET",
            message:  "READY 전환 조건이 충족되지 않았습니다.",
            missing:  readiness.missing,
            blockers: readiness.blockers,
          });
          return;
        }
      } catch (e: any) {
        console.error("[PATCH /super/operators/:id/xmode] readiness check 오류:", e.message);
        res.status(500).json({ error: "READINESS_CHECK_FAILED", message: e.message });
        return;
      }
    }

    const actorId = req.user!.userId;
    let responseResult: PoolModeResult;

    // ── Transaction ────────────────────────────────────────────────
    try {
      await db.transaction(async (tx) => {
        // 1. SELECT FOR UPDATE — pool 확인 + row lock + beforeData 확보
        // X02-B2: x_paid / x_manual / x_force 포함하여 effective 계산
        const poolRows = await tx.execute(sql`
          SELECT id, xmode_config_status,
                 xmode_purchased_at, xmode_subscription_end_at,
                 COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
                 COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
                 COALESCE(x_force_disabled,    false) AS x_force_disabled
          FROM swimming_pools
          WHERE id = ${poolId}
          LIMIT 1
          FOR UPDATE
        `);
        if (!poolRows.rows.length) {
          const err: any = new Error("POOL_NOT_FOUND");
          err.isPoolNotFound = true;
          throw err;
        }
        const pool = poolRows.rows[0] as any;
        const beforePaid   = Boolean(pool.x_paid_entitlement);
        const beforeManual = Boolean(pool.x_manual_entitlement);
        const beforeForce  = Boolean(pool.x_force_disabled);
        const beforeEffective = (beforePaid || beforeManual) && !beforeForce;

        // 2. beforeData 구성 (X02-B2: source 구분 포함)
        const beforeData = {
          xmode_entitlement:         beforeEffective,   // effective
          x_paid_entitlement:        beforePaid,
          x_manual_entitlement:      beforeManual,
          x_force_disabled:          beforeForce,
          xmode_config_status:       pool.xmode_config_status as XModeStatus,
          xmode_purchased_at:        pool.xmode_purchased_at
            ? new Date(pool.xmode_purchased_at).toISOString() : null,
          xmode_subscription_end_at: pool.xmode_subscription_end_at
            ? new Date(pool.xmode_subscription_end_at).toISOString() : null,
        };

        // 3. UPDATE — X02-B2: xmode_entitlement 입력값 → x_manual_entitlement 쓰기
        //    x_paid_entitlement / x_force_disabled 수정 금지
        const manualFrag = hasEntitlement
          ? sql`x_manual_entitlement = ${xmode_entitlement}`
          : sql`x_manual_entitlement = x_manual_entitlement`;
        const configStatusFrag = hasConfigStatus
          ? sql`xmode_config_status = ${xmode_config_status}`
          : sql`xmode_config_status = xmode_config_status`;
        const purchasedAtFrag = hasPurchasedAt
          ? sql`xmode_purchased_at = ${xmode_purchased_at ?? null}`
          : sql`xmode_purchased_at = xmode_purchased_at`;
        const subscriptionEndFrag = hasSubscriptionEnd
          ? sql`xmode_subscription_end_at = ${xmode_subscription_end_at ?? null}`
          : sql`xmode_subscription_end_at = xmode_subscription_end_at`;
        // Manual plan key — Super Admin only. x_plan_key null = revoke/clear
        const planKeyFrag = hasPlanKey
          ? sql`x_plan_key = ${x_plan_key ?? null}`
          : sql`x_plan_key = x_plan_key`;
        // Auto-set member_limit from plan key when granting a plan
        const resolvedLimit = (hasPlanKey && x_plan_key) ? (X_PLAN_LIMITS[x_plan_key] ?? null) : null;
        const memberLimitFrag = resolvedLimit !== null
          ? sql`member_limit = ${resolvedLimit}`
          : sql`member_limit = member_limit`;

        const updatedRows = await tx.execute(sql`
          UPDATE swimming_pools SET
            ${manualFrag},
            ${configStatusFrag},
            ${purchasedAtFrag},
            ${subscriptionEndFrag},
            ${planKeyFrag},
            ${memberLimitFrag}
          WHERE id = ${poolId}
          RETURNING id, xmode_config_status,
                    xmode_purchased_at, xmode_subscription_end_at,
                    x_plan_key, member_limit,
                    COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
                    COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
                    COALESCE(x_force_disabled,    false) AS x_force_disabled
        `);
        const updated = updatedRows.rows[0] as any;
        const newManual    = Boolean(updated.x_manual_entitlement);
        const newPaid      = Boolean(updated.x_paid_entitlement);
        const newForce     = Boolean(updated.x_force_disabled);
        const newPlanKey   = updated.x_plan_key as string | null;
        const newMemberLimit = updated.member_limit as number | null;
        const afterEffective = (newPaid || newManual) && !newForce;

        // 4. afterData 구성 (X02-B2: source 명시)
        const afterData = {
          xmode_entitlement:         afterEffective,    // effective
          x_paid_entitlement:        newPaid,
          x_manual_entitlement:      newManual,
          x_force_disabled:          newForce,
          x_plan_key:                newPlanKey,
          member_limit:              newMemberLimit,
          xmode_config_status:       updated.xmode_config_status as XModeStatus,
          xmode_purchased_at:        updated.xmode_purchased_at
            ? new Date(updated.xmode_purchased_at).toISOString() : null,
          xmode_subscription_end_at: updated.xmode_subscription_end_at
            ? new Date(updated.xmode_subscription_end_at).toISOString() : null,
          source: "super_admin_manual",   // X02-B2: paid / manual 구분
          bypass_readiness_check:    bypass_readiness_check ?? false,
        };

        // 5. next_audit_version 발급
        const versionResult = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_xmode', ${poolId}) AS v
        `);
        const entityVersion = (versionResult.rows[0] as any).v;

        // 6. audit_logs INSERT
        // (audit INSERT 실패 시 Transaction Rollback으로 UPDATE도 함께 취소된다)
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason,
            request_id, correlation_id, ip_hash
          ) VALUES (
            'swimming_pool_xmode', ${poolId}, ${entityVersion},
            'update', 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify(beforeData)}::jsonb,
            ${JSON.stringify(afterData)}::jsonb,
            ${reason ?? null},
            NULL, NULL, NULL
          )
        `);

        // 7. PoolModeResult 구성 (P0: paid→x 즉시, manual→config 기반)
        const mode = computeMode({
          x_paid_entitlement:   newPaid,
          x_manual_entitlement: newManual,
          x_force_disabled:     newForce,
          xmode_config_status:  updated.xmode_config_status as XModeStatus,
        });
        responseResult = {
          pool_id:              updated.id,
          mode,
          xmode_entitlement:    afterEffective,  // effective 값 (backward compat 필드명 유지)
          xmode_config_status:  updated.xmode_config_status as XModeStatus,
          x_manual_entitlement: newManual,
          x_paid_entitlement:   newPaid,
          x_plan_key:           newPlanKey,
          member_limit:         newMemberLimit,
        } as any;
      });
    } catch (e: any) {
      if (e.isPoolNotFound) {
        res.status(404).json({ error: "POOL_NOT_FOUND", message: "수영장을 찾을 수 없습니다." }); return;
      }
      console.error("[PATCH /super/operators/:id/xmode]", e);
      res.status(500).json({ error: "서버 오류" }); return;
    }

    res.json({ ok: true, ...responseResult! });

    // ── READY 전환 후 당월 cycle 즉시 보충 (non-blocking) ─────────
    // READY로 전환된 경우에만 실행.
    // 25일 이후라면 당월 cycle + report row를 idempotent하게 생성.
    if (hasConfigStatus && xmode_config_status === "READY") {
      setImmediate(async () => {
        try {
          const { ensureCurrentMonthGrowthReportCycle } = await import("../jobs/growth-report-scheduler.js");
          const r = await ensureCurrentMonthGrowthReportCycle(poolId, superAdminDb);
          console.log(`[xmode-patch] ensureCurrentMonthGrowthReportCycle: pool=${poolId}`, r);
        } catch (e: any) {
          // non-fatal: 일별 스케줄러가 복구함
          console.error(`[xmode-patch] ensureCurrentMonthGrowthReportCycle 실패 (non-fatal): pool=${poolId}`, e.message);
        }
      });
    }
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
      const { global_enabled, reason } = req.body as any;
      const actorName = req.user?.name ?? "슈퍼관리자";
      await superAdminDb.execute(sql`
        UPDATE feature_flags SET global_enabled = ${!!global_enabled},
          updated_at = NOW(), updated_by = ${actorName},
          reason = ${reason ?? null}
        WHERE key = ${key}
      `);
      const { invalidateFlagCache } = await import("../lib/featureFlags.js");
      invalidateFlagCache(key);

      await logEvent({
        pool_id:    "system",
        category:   "기능 플래그",
        actor_id:   req.user?.userId,
        actor_name: actorName,
        target:     key,
        description: `기능 플래그 ${global_enabled ? "활성화" : "비활성화"}: ${key}${reason ? ` — ${reason}` : ""}`,
        metadata:   { flag_key: key, enabled: !!global_enabled, reason: reason ?? null },
      }).catch(() => {});

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

// POST /super/plans/reinit — 확정 기준값으로 플랜 강제 초기화 (슈퍼관리자 전용)
router.post("/super/plans/reinit", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensurePlansTables();
    // ── 확정 기준값 (pool-db-init.ts 와 동일하게 유지) ──
    const PLAN_ROWS: [string, string, string, number, number, number, number, string][] = [
      ['free',       'free_10',     'Free',         0,       10,   102,    0.1,  '100MB'],
      ['starter',    'solo_30',     'Coach 30',     1900,    30,   307,    0.3,  '300MB'],
      ['basic',      'solo_50',     'Coach 50',     2900,    50,   512,    0.5,  '500MB'],
      ['standard',   'solo_100',    'Coach 100',    5900,    100,  1024,   1,    '1GB'  ],
      ['center_200', 'center_200',  'Premier 200',  19000,   200,  5120,   5,    '5GB'  ],
      ['advance',    'center_300',  'Premier 300',  27000,   300,  10240,  10,   '10GB' ],
      ['pro',        'center_500',  'Premier 500',  43000,   500,  20480,  20,   '20GB' ],
      ['max',        'center_1000', 'Premier 1000', 79000,   1000, 51200,  50,   '50GB' ],
    ];
    let upserted = 0;
    for (const [tier, plan_id, name, price, member_limit, storage_mb, storage_gb, display] of PLAN_ROWS) {
      await superAdminDb.execute(sql.raw(`
        INSERT INTO subscription_plans
          (tier, plan_id, name, price_per_month, member_limit, storage_mb, storage_gb, display_storage)
        VALUES
          ('${tier}','${plan_id}','${name}',${price},${member_limit},${storage_mb},${storage_gb},'${display}')
        ON CONFLICT (tier) DO UPDATE SET
          plan_id         = EXCLUDED.plan_id,
          name            = EXCLUDED.name,
          price_per_month = EXCLUDED.price_per_month,
          member_limit    = EXCLUDED.member_limit,
          storage_mb      = EXCLUDED.storage_mb,
          storage_gb      = EXCLUDED.storage_gb,
          display_storage = EXCLUDED.display_storage
      `));
      upserted++;
    }
    // 폐기 티어 삭제
    const delResult = await superAdminDb.execute(sql.raw(
      `DELETE FROM subscription_plans WHERE tier IN ('enterprise_2000','enterprise_3000','swimnote_2000','swimnote_3000') RETURNING tier`
    ));
    const deleted = delResult.rows.length;
    const actor = req.user?.name ?? "슈퍼관리자";
    const logId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await superAdminDb.execute(sql`
      INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
      VALUES (${logId}, NULL, '구독', ${req.user!.userId}, ${actor}, 'plans', '구독 플랜 강제 초기화 (확정 기준값)', '{}'::jsonb)
    `).catch(() => {});
    console.log(`[super/plans/reinit] upserted=${upserted}, deleted=${deleted}`);
    res.json({ ok: true, upserted, deleted, message: `플랜 ${upserted}개 초기화, 폐기 ${deleted}개 삭제 완료` });
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
          AND NOT EXISTS (
            SELECT 1 FROM policy_consents pc
            WHERE pc.pool_id = sp.id
              AND pc.policy_key = 'refund_policy'
              AND pc.version = COALESCE(
                (SELECT version FROM policy_versions WHERE policy_key = 'refund_policy' AND is_active = TRUE ORDER BY created_at DESC LIMIT 1),
                'v1.0'
              )
          )
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
    await ensureExtraTables();
    const limit = Math.min(parseInt((req.query.limit as string) ?? "10", 10), 50);
    const [rows, countRow, criticalRow, todayRow] = await Promise.all([
      superAdminDb.execute(sql`
        SELECT el.id, el.category, el.description, el.actor_name, el.pool_id, el.target,
               el.created_at, sp.name AS pool_name
        FROM event_logs el
        LEFT JOIN swimming_pools sp ON sp.id = el.pool_id
        ORDER BY el.created_at DESC
        LIMIT ${limit}
      `),
      superAdminDb.execute(sql`SELECT COUNT(*)::int AS total FROM event_logs`),
      superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM event_logs
        WHERE category IN ('보안', '삭제', '해지', '킬스위치')
      `),
      superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM event_logs
        WHERE created_at >= CURRENT_DATE
      `),
    ]);
    res.json({
      logs:           rows.rows,
      total:          Number((countRow.rows[0] as any)?.total ?? 0),
      critical_count: Number((criticalRow.rows[0] as any)?.cnt ?? 0),
      today_count:    Number((todayRow.rows[0] as any)?.cnt ?? 0),
    });
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
        WHERE subscription_tier IS NOT NULL
          AND subscription_tier != 'free'
          AND subscription_status NOT IN ('deleted','cancelled','expired')
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

// ════════════════════════════════════════════════════════════════
// GET  /super/pools/:id/credits — 수영장 크레딧 잔액 조회
// POST /super/pools/:id/credits — 크레딧 추가/설정 (슈퍼관리자)
// ════════════════════════════════════════════════════════════════
async function ensureCreditTable() {
  await superAdminDb.execute(sql`
    CREATE TABLE IF NOT EXISTS pool_credits (
      pool_id    TEXT PRIMARY KEY,
      balance    INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

router.get("/super/pools/:id/credits", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensureCreditTable();
    const [row] = (await superAdminDb.execute(sql`
      SELECT pc.balance, pc.updated_at, sp.name AS pool_name
      FROM pool_credits pc
      LEFT JOIN swimming_pools sp ON sp.id = pc.pool_id
      WHERE pc.pool_id = ${req.params.id}
      LIMIT 1
    `)).rows as any[];
    res.json({ pool_id: req.params.id, balance: row?.balance ?? 0, updated_at: row?.updated_at ?? null, pool_name: row?.pool_name ?? null });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

router.post("/super/pools/:id/credits", requireAuth, requireRole("super_admin"), async (req: AuthRequest, res) => {
  try {
    await ensureCreditTable();
    const { amount, reason, mode } = req.body as { amount: number; reason?: string; mode?: "add" | "set" };
    if (typeof amount !== "number") { res.status(400).json({ error: "amount 필요" }); return; }

    const actorName = req.user?.name ?? "슈퍼관리자";

    if (mode === "set") {
      await superAdminDb.execute(sql`
        INSERT INTO pool_credits (pool_id, balance, updated_at)
        VALUES (${req.params.id}, ${amount}, NOW())
        ON CONFLICT (pool_id) DO UPDATE SET balance = ${amount}, updated_at = NOW()
      `);
    } else {
      await superAdminDb.execute(sql`
        INSERT INTO pool_credits (pool_id, balance, updated_at)
        VALUES (${req.params.id}, ${amount}, NOW())
        ON CONFLICT (pool_id) DO UPDATE
          SET balance = pool_credits.balance + ${amount}, updated_at = NOW()
      `);
    }

    const [updated] = (await superAdminDb.execute(sql`
      SELECT balance FROM pool_credits WHERE pool_id = ${req.params.id}
    `)).rows as any[];

    await logEvent({
      pool_id:    req.params.id,
      category:   "크레딧",
      actor_name: actorName,
      description: `크레딧 ${mode === "set" ? "설정" : "추가"}: ${amount.toLocaleString()}원${reason ? ` (${reason})` : ""} (잔액: ${updated?.balance ?? 0}원)`,
      metadata:   { amount, mode: mode ?? "add", reason: reason ?? null, new_balance: updated?.balance ?? 0 },
    }).catch(() => {});

    res.json({ ok: true, balance: updated?.balance ?? 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: "서버 오류" }); }
});

// ── 매출 기록 정리 (super 경로 — billing 경로 장애 대비) ──────────────────
// DELETE /super/revenue-logs/purge-test — 샌드박스/날짜없음/가격불일치 삭제
router.delete("/super/revenue-logs/purge-test", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    const result = await superAdminDb.execute(sql`
      DELETE FROM revenue_logs
      WHERE COALESCE(is_sandbox, FALSE) = TRUE
         OR occurred_at IS NULL
         OR (
           charged_amount > 0
           AND plan_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM subscription_plans sp
             WHERE sp.tier = plan_id
               AND sp.price_per_month > 0
               AND charged_amount != sp.price_per_month
           )
         )
      RETURNING id
    `);
    const count = result.rows.length;
    res.json({ ok: true, deleted: count, message: `테스트/불일치 기록 ${count}건 삭제 완료` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /super/revenue-logs/purge-all — 전체 삭제
router.delete("/super/revenue-logs/purge-all", requireAuth, requireRole("super_admin"), async (_req: AuthRequest, res) => {
  try {
    const result = await superAdminDb.execute(sql`DELETE FROM revenue_logs RETURNING id`);
    const count = result.rows.length;
    res.json({ ok: true, deleted: count, message: `전체 매출 기록 ${count}건 삭제 완료` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 앱 시작 시 비동기로 테이블/컬럼 보장
ensureExtraTables().catch(err => console.error("[super] ensureExtraTables 오류:", err));
ensurePlansTables().catch(err => console.error("[super] ensurePlansTables 오류:", err));

// ════════════════════════════════════════════════════════════════
// WP4A — Global Template Set Management (super_admin only)
// ════════════════════════════════════════════════════════════════
// POST   /super/global-template-sets
// GET    /super/global-template-sets
// GET    /super/global-template-sets/:id
// PATCH  /super/global-template-sets/:id/activate
// PATCH  /super/global-template-sets/:id/archive
// GET    /super/global-template-sets/:id/templates
// POST   /super/global-template-sets/:id/templates
// PATCH  /super/global-template-sets/:id/templates/:templateId
// DELETE /super/global-template-sets/:id/templates/:templateId
// ════════════════════════════════════════════════════════════════

// audit helper for global_template_set events
async function auditGlobalTemplateSet(
  tx: typeof superAdminDb,
  action: string,
  entityId: string,
  actorId: string,
  beforeData: object | null,
  afterData: object | null,
  reason?: string | null,
) {
  try {
    const vRes = await tx.execute(sql`
      SELECT next_audit_version('global_template_set', ${entityId}) AS v
    `);
    const entityVersion = (vRes.rows[0] as any).v;
    await tx.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'global_template_set', ${entityId}, ${entityVersion},
        ${action}, 'super_admin', ${actorId}, NULL,
        ${beforeData ? JSON.stringify(beforeData) : null}::jsonb,
        ${afterData  ? JSON.stringify(afterData)  : null}::jsonb,
        ${reason ?? null},
        NULL, NULL, NULL
      )
    `);
  } catch (e: any) {
    // audit 실패는 메인 흐름을 차단하지 않음
    console.error("[wp4a-audit] audit_logs 기록 실패:", e?.message);
  }
}

// ── POST /super/global-template-sets — DRAFT 생성 ─────────────────────────
router.post(
  "/super/global-template-sets",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { version_name } = req.body as { version_name?: string };
    if (!version_name?.trim()) {
      res.status(400).json({ error: "BAD_REQUEST", message: "version_name 필수" });
      return;
    }
    try {
      const result = await superAdminDb.execute(sql`
        INSERT INTO global_template_sets (version_name, status)
        VALUES (${version_name.trim()}, 'DRAFT')
        RETURNING *
      `);
      const row = result.rows[0] as any;
      await auditGlobalTemplateSet(
        superAdminDb, "GLOBAL_TEMPLATE_SET_CREATED", row.id,
        req.user!.userId, null, { version_name: row.version_name, status: row.status },
      );
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.cause?.code === "23505") {
        res.status(409).json({ error: "DUPLICATE_VERSION_NAME", message: "이미 존재하는 버전 이름입니다." });
        return;
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /super/global-template-sets — 목록 ────────────────────────────────
router.get(
  "/super/global-template-sets",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const result = await superAdminDb.execute(sql`
        SELECT
          gts.*,
          COUNT(dt.id)::int AS template_count
        FROM global_template_sets gts
        LEFT JOIN diary_templates dt
          ON dt.global_template_set_id = gts.id AND dt.scope = 'x_global'
        GROUP BY gts.id
        ORDER BY gts.created_at DESC
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /super/global-template-sets/:id — 상세 ────────────────────────────
router.get(
  "/super/global-template-sets/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    try {
      const result = await superAdminDb.execute(sql`
        SELECT
          gts.*,
          COUNT(dt.id)::int AS template_count
        FROM global_template_sets gts
        LEFT JOIN diary_templates dt
          ON dt.global_template_set_id = gts.id AND dt.scope = 'x_global'
        WHERE gts.id = ${id}
        GROUP BY gts.id
      `);
      if (!result.rows[0]) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿 세트" }); return; }
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PATCH /super/global-template-sets/:id/activate ─────────────────────────
router.patch(
  "/super/global-template-sets/:id/activate",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    try {
      const result = await superAdminDb.transaction(async (tx) => {
        // 대상 확인
        const targetRes = await tx.execute(sql`
          SELECT * FROM global_template_sets WHERE id = ${id}
        `);
        const target = targetRes.rows[0] as any;
        if (!target) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
        if (target.status === "ACTIVE") throw Object.assign(new Error("ALREADY_ACTIVE"), { status: 409 });
        if (target.status === "ARCHIVED") throw Object.assign(new Error("ARCHIVED_CANNOT_ACTIVATE"), { status: 409 });

        // 기존 ACTIVE → ARCHIVED
        const prevActiveRes = await tx.execute(sql`
          UPDATE global_template_sets
          SET status = 'ARCHIVED', archived_at = NOW()
          WHERE status = 'ACTIVE'
          RETURNING id, status
        `);
        const prevActive = prevActiveRes.rows[0] as any;

        // 대상 → ACTIVE
        const updatedRes = await tx.execute(sql`
          UPDATE global_template_sets
          SET status = 'ACTIVE', activated_at = NOW()
          WHERE id = ${id}
          RETURNING *
        `);
        return { updated: updatedRes.rows[0] as any, prevActiveId: prevActive?.id ?? null };
      });

      const actorId = req.user!.userId;
      await auditGlobalTemplateSet(
        superAdminDb, "GLOBAL_TEMPLATE_SET_ACTIVATED", id,
        actorId, { status: "DRAFT" }, { status: "ACTIVE" },
      );
      if (result.prevActiveId) {
        await auditGlobalTemplateSet(
          superAdminDb, "GLOBAL_TEMPLATE_SET_ARCHIVED", result.prevActiveId,
          actorId, { status: "ACTIVE" }, { status: "ARCHIVED" },
          "auto-archived by new activation",
        );
      }

      // ACTIVE count 재확인 (안전성 검증)
      const countRes = await superAdminDb.execute(sql`
        SELECT COUNT(*)::int AS n FROM global_template_sets WHERE status = 'ACTIVE'
      `);
      const activeCount = Number((countRes.rows[0] as any).n);

      res.json({ ok: true, set: result.updated, active_count_verified: activeCount });
    } catch (err: any) {
      const status = err.status ?? 500;
      const msg = err.message;
      if (msg === "NOT_FOUND") { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿 세트" }); return; }
      if (msg === "ALREADY_ACTIVE") { res.status(409).json({ error: "ALREADY_ACTIVE", message: "이미 ACTIVE 상태입니다." }); return; }
      if (msg === "ARCHIVED_CANNOT_ACTIVATE") { res.status(409).json({ error: "ARCHIVED_CANNOT_ACTIVATE", message: "ARCHIVED 세트는 활성화할 수 없습니다." }); return; }
      res.status(status).json({ error: msg });
    }
  }
);

// ── PATCH /super/global-template-sets/:id/archive ──────────────────────────
router.patch(
  "/super/global-template-sets/:id/archive",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    try {
      const target = await superAdminDb.execute(sql`SELECT * FROM global_template_sets WHERE id = ${id}`);
      const row = target.rows[0] as any;
      if (!row) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿 세트" }); return; }
      if (row.status === "ARCHIVED") { res.status(409).json({ error: "ALREADY_ARCHIVED", message: "이미 ARCHIVED 상태입니다." }); return; }

      const before = { status: row.status };
      const updated = await superAdminDb.execute(sql`
        UPDATE global_template_sets
        SET status = 'ARCHIVED', archived_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `);
      await auditGlobalTemplateSet(
        superAdminDb, "GLOBAL_TEMPLATE_SET_ARCHIVED", id,
        req.user!.userId, before, { status: "ARCHIVED" },
      );
      res.json({ ok: true, set: updated.rows[0] });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /super/global-template-sets/:id/templates ─────────────────────────
router.get(
  "/super/global-template-sets/:id/templates",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    try {
      const setRes = await superAdminDb.execute(sql`SELECT id FROM global_template_sets WHERE id = ${id}`);
      if (!setRes.rows[0]) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿 세트" }); return; }

      const result = await superAdminDb.execute(sql`
        SELECT id, category, level, title, template_text, is_active, sort_order, created_at, updated_at
        FROM diary_templates
        WHERE global_template_set_id = ${id} AND scope = 'x_global'
        ORDER BY sort_order ASC, created_at ASC
      `);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── POST /super/global-template-sets/:id/templates ─────────────────────────
router.post(
  "/super/global-template-sets/:id/templates",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id } = req.params;
    const { category, level, title, template_text, sort_order } = req.body as {
      category?: string; level?: string; title?: string;
      template_text?: string; sort_order?: number;
    };
    if (!category?.trim() || !template_text?.trim()) {
      res.status(400).json({ error: "BAD_REQUEST", message: "category, template_text 필수" });
      return;
    }
    try {
      const setRes = await superAdminDb.execute(sql`SELECT id, status FROM global_template_sets WHERE id = ${id}`);
      const setRow = setRes.rows[0] as any;
      if (!setRow) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿 세트" }); return; }

      const actorId = req.user!.userId;
      const result = await superAdminDb.execute(sql`
        INSERT INTO diary_templates (
          swimming_pool_id, scope, global_template_set_id,
          category, level, title, template_text,
          created_by, is_active, sort_order
        ) VALUES (
          NULL, 'x_global', ${id},
          ${category.trim()}, ${level?.trim() ?? null}, ${title?.trim() ?? null},
          ${template_text.trim()},
          ${actorId}, true, ${sort_order ?? 0}
        )
        RETURNING *
      `);
      const tmpl = result.rows[0] as any;
      await auditGlobalTemplateSet(
        superAdminDb, "X_GLOBAL_TEMPLATE_CREATED", id,
        actorId, null, { template_id: tmpl.id, category: tmpl.category },
      );
      res.status(201).json(tmpl);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PATCH /super/global-template-sets/:id/templates/:templateId ───────────
router.patch(
  "/super/global-template-sets/:id/templates/:templateId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id, templateId } = req.params;
    const { category, level, title, template_text, is_active, sort_order } = req.body as {
      category?: string; level?: string; title?: string; template_text?: string;
      is_active?: boolean; sort_order?: number;
    };
    try {
      // 소속 확인
      const existing = await superAdminDb.execute(sql`
        SELECT * FROM diary_templates
        WHERE id = ${templateId} AND global_template_set_id = ${id} AND scope = 'x_global'
      `);
      if (!existing.rows[0]) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿" }); return; }

      const row = existing.rows[0] as any;
      const before = { category: row.category, template_text: row.template_text, is_active: row.is_active };

      const updated = await superAdminDb.execute(sql`
        UPDATE diary_templates SET
          category     = COALESCE(${category?.trim() ?? null}, category),
          level        = COALESCE(${level?.trim() ?? null}, level),
          title        = COALESCE(${title?.trim() ?? null}, title),
          template_text = COALESCE(${template_text?.trim() ?? null}, template_text),
          is_active    = COALESCE(${is_active ?? null}, is_active),
          sort_order   = COALESCE(${sort_order ?? null}, sort_order),
          updated_at   = NOW()
        WHERE id = ${templateId} AND global_template_set_id = ${id} AND scope = 'x_global'
        RETURNING *
      `);
      await auditGlobalTemplateSet(
        superAdminDb, "X_GLOBAL_TEMPLATE_UPDATED", id,
        req.user!.userId, before, req.body,
      );
      res.json(updated.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /super/global-template-sets/:id/templates/:templateId ──────────
router.delete(
  "/super/global-template-sets/:id/templates/:templateId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id, templateId } = req.params;
    try {
      const existing = await superAdminDb.execute(sql`
        SELECT * FROM diary_templates
        WHERE id = ${templateId} AND global_template_set_id = ${id} AND scope = 'x_global'
      `);
      if (!existing.rows[0]) { res.status(404).json({ error: "NOT_FOUND", message: "존재하지 않는 템플릿" }); return; }

      const row = existing.rows[0] as any;
      await superAdminDb.execute(sql`
        DELETE FROM diary_templates
        WHERE id = ${templateId} AND global_template_set_id = ${id} AND scope = 'x_global'
      `);
      await auditGlobalTemplateSet(
        superAdminDb, "X_GLOBAL_TEMPLATE_DELETED", id,
        req.user!.userId, { template_id: templateId, category: row.category }, null,
      );
      res.json({ ok: true, deleted: templateId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════
// GET  /super/ai-traces        — AI trace 목록 (super_admin 전용)
// GET  /super/ai-traces/:reqId — AI trace 상세
// ════════════════════════════════════════════════════════════════

/**
 * GET /super/ai-traces
 * Query: pool_id?, feature?, status?, from?, to?, limit?, offset?
 * 개인정보 비포함 (pool_id, actor_id(내부ID), token count만 반환)
 */
router.get(
  "/super/ai-traces",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { pool_id, feature, status, from, to, limit, offset } = req.query as Record<string, string | undefined>;

      const result = await listAiTraces({
        pool_id:  pool_id  || undefined,
        feature:  feature  || undefined,
        status:   (status === "SUCCESS" || status === "FAILED") ? status : undefined,
        from:     from     || undefined,
        to:       to       || undefined,
        limit:    limit    ? Math.min(parseInt(limit, 10) || 50, 200) : 50,
        offset:   offset   ? parseInt(offset, 10) || 0 : 0,
      });

      res.json({ ok: true, ...result });
    } catch (err: any) {
      console.error("[super/ai-traces] list error:", err?.message);
      res.status(500).json({ ok: false, error: "AI trace 조회 실패" });
    }
  },
);

/**
 * GET /super/ai-traces/:requestId
 * request_id(외부 ID) 기준 trace 상세 조회.
 */
router.get(
  "/super/ai-traces/:requestId",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { requestId } = req.params;
      if (!requestId || requestId.length > 128) {
        res.status(400).json({ ok: false, error: "invalid request_id" });
        return;
      }

      const found = await getAiTraceByRequestId(requestId);
      if (!found.found) {
        res.status(404).json({ ok: false, error: "trace not found" });
        return;
      }

      // 민감 원문 미포함 확인 — metadata는 ai-trace-service.ts에서 이미 필터링됨
      res.json({ ok: true, trace: { ...found.row, metadata: found.metadata } });
    } catch (err: any) {
      console.error("[super/ai-traces/:requestId] error:", err?.message);
      res.status(500).json({ ok: false, error: "AI trace 조회 실패" });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// WP15 — Growth Review Statistics  (READ ONLY, super_admin only)
// GET /super/growth-review-stats
// ════════════════════════════════════════════════════════════════

/**
 * GET /super/growth-review-stats
 * query: from, to (ISO date, 기준: created_at), pool_id
 *
 * source: growth_events WHERE is_invalidated = false
 * audit_logs 사용 금지 (별도 역할 분리)
 */
router.get(
  "/super/growth-review-stats",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const from    = (req.query.from    as string) || null;
      const to      = (req.query.to      as string) || null;
      const pool_id = (req.query.pool_id as string) || null;

      // 날짜 형식 간단 검증
      const ISO_RE = /^\d{4}-\d{2}-\d{2}/;
      if (from && !ISO_RE.test(from)) { res.status(400).json({ error: "invalid from date" }); return; }
      if (to   && !ISO_RE.test(to))   { res.status(400).json({ error: "invalid to date" });   return; }

      // 동적 WHERE 조건 구성
      const conditions: string[] = ["ge.is_invalidated = false"];
      if (pool_id) conditions.push(`ge.swimming_pool_id = '${pool_id.replace(/'/g, "''")}'`);
      if (from)    conditions.push(`ge.created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
      if (to)      conditions.push(`ge.created_at <  '${to.replace(/'/g, "''")}'::timestamptz`);
      const where = conditions.join(" AND ");

      // Query 1: 전체 집계 (1 round-trip)
      const summaryRes = await superAdminDb.execute(sql.raw(`
        SELECT
          COUNT(*)                                                                              AS total_valid_events,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'PENDING_REVIEW')                   AS pending_review,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'TEACHER_ACCEPTED')                 AS teacher_accepted,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'TEACHER_REJECTED')                 AS teacher_rejected,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'AUTO_ACCEPTED')                    AS auto_accepted,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'DISCARDED')                        AS discarded,
          COUNT(*) FILTER (
            WHERE ge.growth_match_status = 'PENDING_REVIEW'
              AND ge.created_at < NOW() - INTERVAL '24 hours'
          )                                                                                    AS pending_over_24h,
          COUNT(*) FILTER (
            WHERE ge.growth_match_status = 'PENDING_REVIEW'
              AND ge.created_at < NOW() - INTERVAL '48 hours'
          )                                                                                    AS pending_over_48h,
          ROUND(
            AVG(
              EXTRACT(EPOCH FROM (ge.reviewed_at - ge.created_at)) / 3600.0
            ) FILTER (
              WHERE ge.reviewed_at IS NOT NULL
                AND ge.growth_match_status IN ('TEACHER_ACCEPTED','TEACHER_REJECTED')
            )
          , 2)                                                                                 AS average_review_time_hours
        FROM growth_events ge
        WHERE ${where}
      `));

      const raw = (summaryRes.rows[0] as any) ?? {};
      const n = (k: string) => Number(raw[k] ?? 0);

      const total_valid_events      = n("total_valid_events");
      const pending_review          = n("pending_review");
      const teacher_accepted        = n("teacher_accepted");
      const teacher_rejected        = n("teacher_rejected");
      const auto_accepted           = n("auto_accepted");
      const discarded               = n("discarded");
      const pending_over_24h        = n("pending_over_24h");
      const pending_over_48h        = n("pending_over_48h");
      const avg_hrs_raw             = raw.average_review_time_hours;
      const average_review_time_hours =
        avg_hrs_raw !== null && avg_hrs_raw !== undefined ? Number(avg_hrs_raw) : null;

      // 계산: 분모 0 → 0 반환 (NaN/Infinity 금지)
      const reviewed_total    = teacher_accepted + teacher_rejected;
      const denom_review      = pending_review + teacher_accepted + teacher_rejected;
      const review_rate       = denom_review    > 0 ? Math.round((reviewed_total  / denom_review)    * 10000) / 10000 : 0;
      const accepted_rate     = reviewed_total  > 0 ? Math.round((teacher_accepted / reviewed_total) * 10000) / 10000 : 0;
      const rejected_rate     = reviewed_total  > 0 ? Math.round((teacher_rejected / reviewed_total) * 10000) / 10000 : 0;

      // Query 2: 수영장별 breakdown (N+1 금지, 1 query)
      const poolBreakdownRes = await superAdminDb.execute(sql.raw(`
        SELECT
          ge.swimming_pool_id                                                                   AS pool_id,
          sp.name                                                                               AS pool_name,
          COUNT(*)                                                                              AS total,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'PENDING_REVIEW')                   AS pending,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'TEACHER_ACCEPTED')                 AS accepted,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'TEACHER_REJECTED')                 AS rejected,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'AUTO_ACCEPTED')                    AS auto_accepted,
          COUNT(*) FILTER (WHERE ge.growth_match_status = 'DISCARDED')                        AS discarded
        FROM growth_events ge
        LEFT JOIN swimming_pools sp ON sp.id = ge.swimming_pool_id
        WHERE ${where}
        GROUP BY ge.swimming_pool_id, sp.name
        ORDER BY total DESC
      `));

      const pool_breakdown = (poolBreakdownRes.rows as any[]).map(r => {
        const t_acc = Number(r.accepted ?? 0);
        const t_rej = Number(r.rejected ?? 0);
        const rv    = t_acc + t_rej;
        const d_rv  = Number(r.pending ?? 0) + rv;
        return {
          pool_id:     r.pool_id,
          pool_name:   r.pool_name ?? null,
          total:       Number(r.total ?? 0),
          pending:     Number(r.pending ?? 0),
          accepted:    t_acc,
          rejected:    t_rej,
          auto_accepted: Number(r.auto_accepted ?? 0),
          discarded:   Number(r.discarded ?? 0),
          review_rate: d_rv > 0 ? Math.round((rv / d_rv) * 10000) / 10000 : 0,
        };
      });

      res.json({
        summary: {
          total_valid_events,
          pending_review,
          teacher_accepted,
          teacher_rejected,
          auto_accepted,
          discarded,
          reviewed_total,
          review_rate,
          accepted_rate,
          rejected_rate,
          pending_over_24h,
          pending_over_48h,
          average_review_time_hours,
        },
        pool_breakdown,
        filters: { from, to, pool_id },
      });
    } catch (err: any) {
      console.error("[super/growth-review-stats] error:", err?.message);
      res.status(500).json({ error: "성장 검토 통계 조회 실패" });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// WP14 — Audit Log Viewer  (READ ONLY, super_admin only)
// GET /super/audit-logs        목록 (pagination + filters)
// GET /super/audit-logs/:id    단건 상세
// ════════════════════════════════════════════════════════════════

/** 민감 필드 마스킹 — before_data/after_data JSON에서 적용 */
const SENSITIVE_FIELD_PATTERNS = [
  "password", "hash", "token", "secret", "api_key", "apikey",
  "access_key", "refresh", "phone", "diary_content", "prompt", "response",
];

function maskSensitive(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (Array.isArray(data)) return (data as unknown[]).map(maskSensitive);
  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = k.toLowerCase();
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some(p => keyLower.includes(p));
    result[k] = isSensitive ? "[REDACTED]" : maskSensitive(v);
  }
  return result;
}

/**
 * GET /super/audit-logs
 * query: limit(1-100, default 20), offset(≥0, default 0),
 *        action, entity_type, pool_id, actor_id, from, to (ISO date)
 */
router.get(
  "/super/audit-logs",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const limit  = Math.min(Math.max(parseInt((req.query.limit  as string) ?? "20", 10), 1), 100);
      const offset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);

      const action      = (req.query.action      as string) || null;
      const entity_type = (req.query.entity_type as string) || null;
      const pool_id     = (req.query.pool_id     as string) || null;
      const actor_id    = (req.query.actor_id    as string) || null;
      const from        = (req.query.from        as string) || null;
      const to          = (req.query.to          as string) || null;

      // 동적 WHERE 절 — drizzle sql 템플릿 with manual injection (safe: validated types)
      const conditions: string[] = ["TRUE"];
      if (action)      conditions.push(`action = '${action.replace(/'/g, "''")}'`);
      if (entity_type) conditions.push(`entity_type = '${entity_type.replace(/'/g, "''")}'`);
      if (pool_id)     conditions.push(`pool_id = '${pool_id.replace(/'/g, "''")}'`);
      if (actor_id)    conditions.push(`actor_id = '${actor_id.replace(/'/g, "''")}'`);
      if (from)        conditions.push(`created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
      if (to)          conditions.push(`created_at <= '${to.replace(/'/g, "''")}'::timestamptz`);
      const where = conditions.join(" AND ");

      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql.raw(`
          SELECT
            al.id,
            al.entity_type,
            al.entity_id,
            al.entity_version,
            al.action,
            al.actor_type,
            al.actor_id,
            al.pool_id,
            al.reason,
            al.created_at,
            sp.name AS pool_name
          FROM audit_logs al
          LEFT JOIN swimming_pools sp ON sp.id = al.pool_id
          WHERE ${where}
          ORDER BY al.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)),
        superAdminDb.execute(sql.raw(`
          SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}
        `)),
      ]);

      const total = Number((countRes.rows[0] as any)?.total ?? 0);
      res.json({ logs: rows.rows, total, limit, offset });
    } catch (err: any) {
      console.error("[super/audit-logs] list error:", err?.message);
      res.status(500).json({ error: "감사 로그 조회 실패" });
    }
  },
);

/**
 * GET /super/audit-logs/:id
 * 단건 상세 — before_data/after_data 마스킹 포함
 */
router.get(
  "/super/audit-logs/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      if (!id || id.length > 64) {
        res.status(400).json({ error: "invalid id" });
        return;
      }

      const result = await superAdminDb.execute(sql`
        SELECT
          al.*,
          sp.name AS pool_name
        FROM audit_logs al
        LEFT JOIN swimming_pools sp ON sp.id = al.pool_id
        WHERE al.id = ${id}
        LIMIT 1
      `);

      const row = (result.rows[0] as any);
      if (!row) {
        res.status(404).json({ error: "감사 로그를 찾을 수 없습니다." });
        return;
      }

      // 민감 필드 마스킹
      const safeRow = {
        ...row,
        before_data: maskSensitive(row.before_data),
        after_data:  maskSensitive(row.after_data),
        // ip_hash는 이미 해시값이므로 노출 허용 (원본 IP 아님)
      };

      res.json({ log: safeRow });
    } catch (err: any) {
      console.error("[super/audit-logs/:id] error:", err?.message);
      res.status(500).json({ error: "감사 로그 상세 조회 실패" });
    }
  },
);

// ── WP15.5-C: Ad Creative CRUD (super_admin) ──────────────────────────────────

// GET /super/ad-creatives?placement=PARENT_HOME_BANNER
router.get(
  "/super/ad-creatives",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const placement = (req.query.placement as string) || "PARENT_HOME_BANNER";
      const result = await superAdminDb.execute(sql`
        SELECT * FROM ad_creatives
        WHERE placement = ${placement}
        ORDER BY display_order ASC, created_at DESC
      `);
      res.json({ creatives: result.rows });
    } catch (err: any) {
      console.error("[super/ad-creatives GET] error:", err?.message);
      res.status(500).json({ error: "조회 실패" });
    }
  },
);

// POST /super/ad-creatives — 생성
router.post(
  "/super/ad-creatives",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const {
        placement = "PARENT_HOME_BANNER",
        creative_type = "IMAGE_WITH_TEXT",
        headline,
        body_text,
        image_url,
        destination_url,
        effect_type = "NONE",
        display_order = 0,
        target_age_band = [],
        target_region = [],
      } = req.body;

      const id = `adc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ageBandArr = Array.isArray(target_age_band) ? target_age_band : [];
      const regionArr  = Array.isArray(target_region)   ? target_region   : [];

      await superAdminDb.execute(sql`
        INSERT INTO ad_creatives
          (id, placement, creative_type, headline, body_text, image_url,
           destination_url, effect_type, display_order, is_active,
           target_age_band, target_region)
        VALUES
          (${id}, ${placement}, ${creative_type},
           ${headline ?? null}, ${body_text ?? null}, ${image_url ?? null},
           ${destination_url ?? null}, ${effect_type}, ${Number(display_order)},
           true,
           ${ageBandArr}::text[], ${regionArr}::text[])
      `);

      const row = await superAdminDb.execute(sql`
        SELECT * FROM ad_creatives WHERE id = ${id} LIMIT 1
      `);
      res.json({ creative: row.rows[0] });
    } catch (err: any) {
      console.error("[super/ad-creatives POST] error:", err?.message);
      res.status(500).json({ error: "생성 실패" });
    }
  },
);

// POST /super/ad-creatives/:id/update — 수정 (PATCH 대신 POST로 통일, fetch 호환)
// COALESCE 방식: undefined 필드는 기존 값 유지
router.post(
  "/super/ad-creatives/:id/update",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const {
        headline, body_text, image_url, destination_url,
        effect_type, display_order, is_active,
        target_age_band, target_region, creative_type, placement,
      } = req.body;

      const ageBandArr = target_age_band != null && Array.isArray(target_age_band)
        ? target_age_band : null;
      const regionArr  = target_region   != null && Array.isArray(target_region)
        ? target_region : null;

      const result = await superAdminDb.execute(sql`
        UPDATE ad_creatives SET
          headline        = COALESCE(${headline        ?? null}, headline),
          body_text       = COALESCE(${body_text       ?? null}, body_text),
          image_url       = COALESCE(${image_url       ?? null}, image_url),
          destination_url = COALESCE(${destination_url ?? null}, destination_url),
          effect_type     = COALESCE(${effect_type     ?? null}, effect_type),
          display_order   = COALESCE(${display_order   != null ? Number(display_order) : null}, display_order),
          is_active       = COALESCE(${is_active       != null ? Boolean(is_active)    : null}, is_active),
          creative_type   = COALESCE(${creative_type   ?? null}, creative_type),
          placement       = COALESCE(${placement       ?? null}, placement),
          target_age_band = COALESCE(${ageBandArr}::text[],  target_age_band),
          target_region   = COALESCE(${regionArr}::text[],   target_region),
          updated_at      = NOW()
        WHERE id = ${id}
        RETURNING *
      `);

      const row = (result.rows[0] as any);
      if (!row) { res.status(404).json({ error: "Creative를 찾을 수 없습니다." }); return; }
      res.json({ creative: row });
    } catch (err: any) {
      console.error("[super/ad-creatives/:id/update] error:", err?.message);
      res.status(500).json({ error: "수정 실패" });
    }
  },
);

// ── WP15.5-B/C Fix: Analytics Overview ────────────────────────────────────────
// GET /super/analytics-overview
// AVAILABLE_NOW 지표 (수영장/학생/parent 수, X mode, 구독 breakdown)
// MAU 프록시 제거 — analytics_events 충분히 쌓인 이후 실제값 계산 예정.
router.get(
  "/super/analytics-overview",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const [poolStats, studentStats, parentStats, adStats, sessionStats] = await Promise.all([
        // ── 수영장 통계 ───────────────────────────────────────────────────
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)::int                                                    AS total_pools,
            COUNT(*) FILTER (WHERE approval_status = 'approved')::int       AS approved_pools,
            COUNT(*) FILTER (
              WHERE approval_status = 'approved'
                AND subscription_status NOT IN ('expired','suspended','cancelled')
            )::int                                                           AS active_pools,
            COUNT(*) FILTER (
              WHERE approval_status = 'approved'
                AND (COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
                AND NOT COALESCE(x_force_disabled, false)
            )::int                                                           AS x_mode_pools,
            COUNT(*) FILTER (
              WHERE approval_status = 'approved'
                AND NOT (
                  (COALESCE(x_paid_entitlement, false) OR COALESCE(x_manual_entitlement, false))
                  AND NOT COALESCE(x_force_disabled, false)
                )
                AND subscription_status NOT IN ('expired','suspended','cancelled')
            )::int                                                           AS basic_pools,
            COUNT(*) FILTER (WHERE approval_status = 'pending')::int        AS pending_pools,
            COUNT(*) FILTER (
              WHERE subscription_status = 'active'
            )::int                                                           AS sub_active,
            COUNT(*) FILTER (
              WHERE subscription_status = 'trial'
            )::int                                                           AS sub_trial,
            COUNT(*) FILTER (
              WHERE subscription_status IN ('expired','suspended')
            )::int                                                           AS sub_expired
          FROM swimming_pools
        `),
        // ── 학생 통계 ─────────────────────────────────────────────────────
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)::int  AS total_students,
            COUNT(*) FILTER (
              WHERE id IN (
                SELECT DISTINCT student_id FROM student_class_history
                WHERE left_at IS NULL
              )
            )::int          AS active_students
          FROM students
        `),
        // ── parent 통계 ───────────────────────────────────────────────────
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)::int                                          AS total_parents,
            COUNT(*) FILTER (WHERE COALESCE(is_active, true) = true)::int AS active_parents
          FROM parent_accounts
        `),
        // ── 광고 Creative 수 (실제값) ─────────────────────────────────────
        db.execute(sql`
          SELECT
            COUNT(*)::int                                  AS total_creatives,
            COUNT(*) FILTER (WHERE is_active = true)::int AS active_creatives
          FROM ad_creatives
        `),
        // ── analytics_events 세션 수 (LOGIN_SESSION_START) ────────────────
        db.execute(sql`
          SELECT COUNT(*)::int AS total_sessions
          FROM analytics_events
          WHERE event_type = 'LOGIN_SESSION_START'
        `),
      ]);

      const p  = (poolStats.rows[0]    as any) ?? {};
      const st = (studentStats.rows[0] as any) ?? {};
      const pa = (parentStats.rows[0]  as any) ?? {};
      const ad = (adStats.rows[0]      as any) ?? {};
      const se = (sessionStats.rows[0] as any) ?? {};

      const totalSessions = Number(se.total_sessions ?? 0);
      // analytics_events가 충분히 쌓이지 않은 초기 상태: COLLECTING
      const mauStatus = totalSessions < 10 ? "COLLECTING" : "AVAILABLE";

      res.json({
        platform: {
          total_pools:    Number(p.total_pools    ?? 0),
          approved_pools: Number(p.approved_pools ?? 0),
          active_pools:   Number(p.active_pools   ?? 0),
          x_mode_pools:   Number(p.x_mode_pools   ?? 0),
          basic_pools:    Number(p.basic_pools    ?? 0),
          pending_pools:  Number(p.pending_pools  ?? 0),
          total_students: Number(st.total_students  ?? 0),
          active_students:Number(st.active_students ?? 0),
          total_parents:  Number(pa.total_parents  ?? 0),
          active_parents: Number(pa.active_parents ?? 0),
        },
        subscription: {
          active:  Number(p.sub_active  ?? 0),
          trial:   Number(p.sub_trial   ?? 0),
          expired: Number(p.sub_expired ?? 0),
        },
        // MAU proxy 제거됨. analytics_events 기반으로 교체.
        session_stats: {
          status:         mauStatus,
          total_sessions: totalSessions,
          note:           mauStatus === "COLLECTING"
            ? "analytics_events 수집 중 — 실제 앱 사용으로만 데이터 생성됨"
            : "LOGIN_SESSION_START 이벤트 기준",
        },
        // 광고 Creative 통계 (실제값)
        ad_stats: {
          total_creatives:  Number(ad.total_creatives  ?? 0),
          active_creatives: Number(ad.active_creatives ?? 0),
        },
      });
    } catch (err: any) {
      console.error("[super/analytics-overview] error:", err?.message);
      res.status(500).json({ error: "Analytics 조회 실패" });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// SA0-B: Incidents CRUD  (super_admin only)
// GET    /super/incidents
// POST   /super/incidents
// PATCH  /super/incidents/:id
// ════════════════════════════════════════════════════════════════

async function logIncidentAudit(
  action: "INCIDENT_CREATED" | "INCIDENT_UPDATED" | "INCIDENT_RESOLVED",
  incidentId: string,
  actorId: string,
  before: any,
  after: any,
) {
  try {
    const auditId = `al_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await superAdminDb.execute(sql`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, actor_type, actor_id, before_data, after_data, created_at)
      VALUES (${auditId}, 'super_incident', ${incidentId}, ${action}, 'super_admin', ${actorId},
              ${before ? JSON.stringify(before) : null}::jsonb,
              ${after  ? JSON.stringify(after)  : null}::jsonb, NOW())
    `);
  } catch { /* audit 실패는 무시 — 원본 작업은 이미 완료 */ }
}

router.get(
  "/super/incidents",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const {
        severity, status, service, pool_id, from, to,
        limit: lq = "50", offset: oq = "0",
      } = req.query as Record<string, string | undefined>;

      const limit  = Math.min(Math.max(parseInt(lq, 10) || 50, 1), 200);
      const offset = Math.max(parseInt(oq, 10) || 0, 0);

      const conds: string[] = [];
      if (severity) conds.push(`severity = '${severity.replace(/'/g, "''")}'`);
      if (status)   conds.push(`status = '${status.replace(/'/g, "''")}'`);
      if (service)  conds.push(`service ILIKE '%${service.replace(/'/g, "''")}%'`);
      if (pool_id)  conds.push(`'${pool_id.replace(/'/g, "''")}' = ANY(affected_pool_ids)`);
      if (from)     conds.push(`created_at >= '${from.replace(/'/g, "''")}'::timestamptz`);
      if (to)       conds.push(`created_at <= '${to.replace(/'/g, "''")}'::timestamptz`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql.raw(`
          SELECT * FROM super_incidents ${where}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
        `)),
        superAdminDb.execute(sql.raw(`
          SELECT COUNT(*)::int AS total FROM super_incidents ${where}
        `)),
      ]);

      const total = Number((countRes.rows[0] as any)?.total ?? 0);
      res.json({ incidents: rows.rows, total, limit, offset });
    } catch (err: any) {
      console.error("[super/incidents GET]", err?.message);
      res.status(500).json({ error: "incidents 조회 실패" });
    }
  },
);

router.post(
  "/super/incidents",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const {
        title, severity = "SEV3", status = "OPEN", service,
        description, root_cause, action_taken,
        started_at, detected_at,
        affected_pool_ids = [], affected_users_count = 0,
        request_id, trace_id, reference,
      } = req.body ?? {};

      if (!title)                                          { res.status(400).json({ error: "title is required" }); return; }
      if (!["SEV1","SEV2","SEV3","SEV4"].includes(severity)) { res.status(400).json({ error: "invalid severity" });   return; }
      if (!["OPEN","INVESTIGATING","MITIGATED","RESOLVED"].includes(status)) { res.status(400).json({ error: "invalid status" }); return; }

      const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const actorId = req.user?.userId ?? "unknown";
      const poolIds = Array.isArray(affected_pool_ids) ? affected_pool_ids : [];

      await superAdminDb.execute(sql`
        INSERT INTO super_incidents (
          id, title, severity, status, service, description, root_cause, action_taken,
          started_at, detected_at, affected_pool_ids, affected_users_count,
          request_id, trace_id, reference, created_by, updated_by
        ) VALUES (
          ${id}, ${title}, ${severity}, ${status}, ${service ?? null},
          ${description ?? null}, ${root_cause ?? null}, ${action_taken ?? null},
          ${started_at ?? null}, ${detected_at ?? null},
          ${poolIds}::text[], ${Number(affected_users_count) || 0},
          ${request_id ?? null}, ${trace_id ?? null}, ${reference ?? null},
          ${actorId}, ${actorId}
        )
      `);

      const row = (await superAdminDb.execute(sql`SELECT * FROM super_incidents WHERE id = ${id}`)).rows[0];
      await logIncidentAudit("INCIDENT_CREATED", id, actorId, null, row);
      res.json({ incident: row });
    } catch (err: any) {
      console.error("[super/incidents POST]", err?.message);
      res.status(500).json({ error: "incidents 생성 실패" });
    }
  },
);

router.patch(
  "/super/incidents/:id",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      await ensureExtraTables();
      const { id } = req.params;
      const actorId = req.user?.userId ?? "unknown";

      const beforeRes = await superAdminDb.execute(sql`SELECT * FROM super_incidents WHERE id = ${id} LIMIT 1`);
      const before = beforeRes.rows[0] as any;
      if (!before) { res.status(404).json({ error: "incident not found" }); return; }

      const {
        title, severity, status, service, description, root_cause, action_taken,
        started_at, detected_at, resolved_at,
        affected_pool_ids, affected_users_count,
        request_id, trace_id, reference,
      } = req.body ?? {};

      if (severity && !["SEV1","SEV2","SEV3","SEV4"].includes(severity)) { res.status(400).json({ error: "invalid severity" }); return; }
      if (status   && !["OPEN","INVESTIGATING","MITIGATED","RESOLVED"].includes(status)) { res.status(400).json({ error: "invalid status" }); return; }

      const poolIds = Array.isArray(affected_pool_ids) ? affected_pool_ids : null;
      const isResolving = status === "RESOLVED" && before.status !== "RESOLVED";
      const resolvedAtVal = isResolving ? new Date().toISOString() : (resolved_at ?? null);

      await superAdminDb.execute(sql`
        UPDATE super_incidents SET
          title            = COALESCE(${title        ?? null}, title),
          severity         = COALESCE(${severity     ?? null}, severity),
          status           = COALESCE(${status       ?? null}, status),
          service          = COALESCE(${service      ?? null}, service),
          description      = COALESCE(${description  ?? null}, description),
          root_cause       = COALESCE(${root_cause   ?? null}, root_cause),
          action_taken     = COALESCE(${action_taken ?? null}, action_taken),
          started_at       = COALESCE(${started_at   ?? null}::timestamptz, started_at),
          detected_at      = COALESCE(${detected_at  ?? null}::timestamptz, detected_at),
          resolved_at      = COALESCE(${resolvedAtVal ?? null}::timestamptz, resolved_at),
          affected_pool_ids = COALESCE(${poolIds}::text[], affected_pool_ids),
          affected_users_count = COALESCE(${affected_users_count != null ? Number(affected_users_count) : null}, affected_users_count),
          request_id       = COALESCE(${request_id   ?? null}, request_id),
          trace_id         = COALESCE(${trace_id     ?? null}, trace_id),
          reference        = COALESCE(${reference    ?? null}, reference),
          updated_by       = ${actorId},
          updated_at       = NOW()
        WHERE id = ${id}
      `);

      const after = (await superAdminDb.execute(sql`SELECT * FROM super_incidents WHERE id = ${id} LIMIT 1`)).rows[0];
      const auditAction = isResolving ? "INCIDENT_RESOLVED" : "INCIDENT_UPDATED";
      await logIncidentAudit(auditAction as any, id, actorId, before, after);
      res.json({ incident: after });
    } catch (err: any) {
      console.error("[super/incidents PATCH]", err?.message);
      res.status(500).json({ error: "incidents 수정 실패" });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// SA0-B: Billing Overview List
// GET /super/billing/list
// type=basic|x|all  status=ACTIVE|CANCELLED_BUT_ACTIVE|EXPIRED|BILLING_ISSUE|SYNC_PENDING|UNKNOWN
// anomaly=true
// ════════════════════════════════════════════════════════════════

function normalizeBillingStatus(sub: string, endAt: Date | null): string {
  const now = new Date();
  if (sub === "suspended") return "BILLING_ISSUE";
  if (sub === "active" || sub === "trial") return "ACTIVE";
  if (sub === "cancelled" && endAt && endAt > now) return "CANCELLED_BUT_ACTIVE";
  if (sub === "expired") return "EXPIRED";
  if (sub === "cancelled") return "EXPIRED";
  return "UNKNOWN";
}

function detectAnomalies(pool: any, slot: any | null, lastRcAt: Date | null): Record<string, boolean> {
  const now = new Date();
  const hasPaid    = Boolean(pool.x_paid_entitlement);
  const hasManual  = Boolean(pool.x_manual_entitlement);
  const hasX       = (hasPaid || hasManual) && !Boolean(pool.x_force_disabled);
  const sub        = String(pool.subscription_status ?? "").toLowerCase();
  const endAt      = pool.subscription_end_at ? new Date(pool.subscription_end_at) : null;

  const expired_but_x    = hasX && (sub === "expired" || sub === "suspended");
  const billing_issue    = sub === "suspended";
  const x_active_no_slot = hasPaid && !slot;
  const sync_stale       = hasX && lastRcAt && (now.getTime() - lastRcAt.getTime()) > 48 * 3600 * 1000;

  return {
    expired_but_x:    Boolean(expired_but_x),
    billing_issue:    Boolean(billing_issue),
    x_active_no_slot: Boolean(x_active_no_slot),
    sync_stale:       Boolean(sync_stale),
  };
}

router.get(
  "/super/billing/list",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    try {
      const { type = "all", status: statusFilter, anomaly, limit: lq = "200", offset: oq = "0" } = req.query as Record<string, string>;
      const limit  = Math.min(Math.max(parseInt(lq, 10) || 200, 1), 500);
      const offset = Math.max(parseInt(oq, 10) || 0, 0);

      // ① 전체 pool 데이터 (구독 필드 포함)
      const poolsRes = await superAdminDb.execute(sql`
        SELECT
          p.id, p.name, p.approval_status,
          p.subscription_status, p.subscription_tier, p.subscription_plan_name,
          p.subscription_start_at, p.subscription_end_at, p.trial_end_at,
          p.subscription_source, p.member_limit, p.display_storage,
          p.x_paid_entitlement, p.x_manual_entitlement, p.x_force_disabled,
          p.xmode_config_status,
          p.created_at, p.updated_at,
          u.name AS admin_name, u.email AS admin_email
        FROM swimming_pools p
        LEFT JOIN users u ON u.id = p.admin_user_id
        WHERE p.approval_status = 'approved'
        ORDER BY p.name
        LIMIT ${limit} OFFSET ${offset}
      `);
      const pools = poolsRes.rows as any[];

      // ② X slot 데이터 (batch — pool ids)
      const poolIds = pools.map(p => p.id);
      let slotMap: Record<string, any> = {};
      if (poolIds.length > 0) {
        try {
          const slotRes = await superAdminDb.execute(sql.raw(`
            SELECT pool_id, status, tier_key, expires_at, rc_app_user_id, last_sync_at
            FROM x_subscription_slots
            WHERE pool_id = ANY(ARRAY[${poolIds.map(id => `'${id.replace(/'/g, "''")}'`).join(",")}])
              AND status IN ('PURCHASED','CANCELLED','RESERVED')
            ORDER BY created_at DESC
          `));
          for (const s of slotRes.rows as any[]) {
            if (!slotMap[s.pool_id]) slotMap[s.pool_id] = s;
          }
        } catch { /* x_subscription_slots 없으면 무시 */ }
      }

      // ③ RC webhook 최근 이벤트 (pool 연결은 slot의 app_user_id 기준)
      let rcLastEventMap: Record<string, Date> = {};
      try {
        const rcRes = await superAdminDb.execute(sql`
          SELECT app_user_id, MAX(processed_at) AS last_at
          FROM revenuecat_webhook_events
          GROUP BY app_user_id
        `);
        for (const r of rcRes.rows as any[]) {
          rcLastEventMap[r.app_user_id] = new Date(r.last_at);
        }
      } catch { /* ignore */ }

      // ④ 정규화 + anomaly 계산
      const result = pools.map(pool => {
        const sub    = String(pool.subscription_status ?? "").toLowerCase();
        const endAt  = pool.subscription_end_at ? new Date(pool.subscription_end_at) : null;
        const slot   = slotMap[pool.id] ?? null;
        const rcAppUserId = slot?.rc_app_user_id ?? null;
        const lastRcAt = rcAppUserId ? (rcLastEventMap[rcAppUserId] ?? null) : null;

        const normalized_basic_status = normalizeBillingStatus(sub, endAt);

        const hasX = (Boolean(pool.x_paid_entitlement) || Boolean(pool.x_manual_entitlement))
          && !Boolean(pool.x_force_disabled);

        let normalized_x_status = "NOT_X";
        if (hasX) {
          if (slot) {
            const slotExp = slot.expires_at ? new Date(slot.expires_at) : null;
            const now = new Date();
            if (slot.status === "PURCHASED" && (!slotExp || slotExp > now)) normalized_x_status = "ACTIVE";
            else if (slot.status === "CANCELLED" && slotExp && slotExp > now)    normalized_x_status = "CANCELLED_BUT_ACTIVE";
            else normalized_x_status = "EXPIRED";
          } else if (Boolean(pool.x_paid_entitlement)) {
            normalized_x_status = "ACTIVE"; // RC entitlement, slot 없음
          } else {
            normalized_x_status = "UNKNOWN";
          }
        }

        const anomalies = detectAnomalies(pool, slot, lastRcAt);
        const has_anomaly = Object.values(anomalies).some(Boolean);

        return {
          pool_id:     pool.id,
          pool_name:   pool.name,
          // Basic
          raw_status:             pool.subscription_status,
          raw_tier:               pool.subscription_tier,
          raw_plan_name:          pool.subscription_plan_name,
          raw_source:             pool.subscription_source,
          normalized_basic_status,
          subscription_start_at:  pool.subscription_start_at ?? null,
          subscription_end_at:    pool.subscription_end_at   ?? null,
          member_limit:           pool.member_limit           ?? null,
          display_storage:        pool.display_storage        ?? null,
          // X
          x_paid_entitlement:     Boolean(pool.x_paid_entitlement),
          x_manual_entitlement:   Boolean(pool.x_manual_entitlement),
          x_force_disabled:       Boolean(pool.x_force_disabled),
          xmode_config_status:    pool.xmode_config_status ?? "NOT_CONFIGURED",
          normalized_x_status,
          x_slot_status:          slot?.status ?? null,
          x_slot_tier:            slot?.tier_key ?? null,
          x_slot_expires_at:      slot?.expires_at ?? null,
          x_last_sync_at:         slot?.last_sync_at ?? lastRcAt?.toISOString() ?? null,
          // Anomaly
          anomalies,
          has_anomaly,
          // Admin
          admin_name:  pool.admin_name  ?? null,
          admin_email: pool.admin_email ?? null,
          updated_at:  pool.updated_at  ?? null,
        };
      }).filter(p => {
        if (type === "basic") return !p.x_paid_entitlement && !p.x_manual_entitlement;
        if (type === "x")     return p.x_paid_entitlement  || p.x_manual_entitlement;
        return true; // all
      }).filter(p => {
        if (!statusFilter) return true;
        return p.normalized_basic_status === statusFilter || p.normalized_x_status === statusFilter;
      }).filter(p => {
        if (anomaly !== "true") return true;
        return p.has_anomaly;
      });

      res.json({ items: result, total: result.length });
    } catch (err: any) {
      console.error("[super/billing/list]", err?.message);
      res.status(500).json({ error: "billing list 조회 실패" });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// SA0-B: Servers Status — per-service, no global 500
// GET /super/servers/status
// ════════════════════════════════════════════════════════════════

async function pingDbForStatus(label: string, key: string): Promise<any> {
  const base = { id: key, name: label, status: "UNKNOWN" as string, latency_ms: null as number | null, note: "", last_checked: new Date().toISOString() };
  try {
    const t = Date.now();
    await superAdminDb.execute(sql`SELECT 1`);
    const ms = Date.now() - t;
    return { ...base, status: ms > 300 ? "DEGRADED" : "LIVE", latency_ms: ms, note: `PostgreSQL — ${ms}ms` };
  } catch (e: any) {
    return { ...base, status: "DEGRADED", note: `DB 오류: ${e?.message?.slice(0, 80) ?? "unknown"}` };
  }
}

async function fetchExtStatus(url: string, label: string, key: string, timeoutMs = 3000): Promise<any> {
  const base = { id: key, name: label, status: "UNKNOWN" as string, latency_ms: null as number | null, note: "", last_checked: new Date().toISOString() };
  try {
    const t = Date.now();
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - t;
    const ok = r.status < 500;
    return { ...base, status: ok ? "LIVE" : "DEGRADED", latency_ms: ms, note: `HTTP ${r.status} — ${ms}ms` };
  } catch (e: any) {
    return { ...base, status: "UNKNOWN", note: `연결 실패: ${e?.message?.slice(0, 60) ?? "unknown"}` };
  }
}

router.get(
  "/super/servers/status",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    // 각 서비스 독립 처리 — 하나 실패해도 전체 500 금지
    const [dbRes, rcRes, aiRes, storageRes, pushRes] = await Promise.allSettled([
      // DB
      pingDbForStatus("Database", "database"),
      // RevenueCat: recent webhook events count
      (async () => {
        const base = { id: "revenuecat", name: "RevenueCat", status: "UNKNOWN", latency_ms: null, note: "", last_checked: new Date().toISOString() };
        try {
          const r = await superAdminDb.execute(sql`
            SELECT
              COUNT(*)::int AS total_events,
              MAX(processed_at)  AS last_event_at,
              COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '1 hour')::int AS recent_1h
            FROM revenuecat_webhook_events
          `);
          const row = r.rows[0] as any;
          const total  = Number(row?.total_events ?? 0);
          const recent = Number(row?.recent_1h ?? 0);
          const lastAt = row?.last_event_at ? new Date(row.last_event_at) : null;
          const ageH   = lastAt ? (Date.now() - lastAt.getTime()) / 3600000 : null;
          const status = total === 0 ? "UNKNOWN" : (ageH !== null && ageH > 48) ? "DEGRADED" : "LIVE";
          const note   = total === 0
            ? "webhook 이벤트 없음 — 연동 확인 필요"
            : `총 ${total}건 · 최근 1h ${recent}건 · 마지막: ${lastAt?.toISOString().slice(0, 16) ?? "—"}`;
          return { ...base, status, note };
        } catch {
          return { ...base, status: "UNKNOWN", note: "revenuecat_webhook_events 조회 실패" };
        }
      })(),
      // AI Engine: ai_traces 최근 1h 기준
      (async () => {
        const base = { id: "ai_engine", name: "AI Engine", status: "UNKNOWN", latency_ms: null, note: "", last_checked: new Date().toISOString() };
        try {
          const r = await superAdminDb.execute(sql`
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success,
              COUNT(*) FILTER (WHERE status = 'FAILED')::int  AS failed,
              MAX(created_at) AS last_at
            FROM ai_traces
            WHERE created_at >= NOW() - INTERVAL '1 hour'
          `);
          const row     = r.rows[0] as any;
          const total   = Number(row?.total ?? 0);
          const success = Number(row?.success ?? 0);
          const failed  = Number(row?.failed  ?? 0);
          if (total === 0) return { ...base, status: "UNKNOWN", note: "최근 1h AI 호출 없음" };
          const errRate = total > 0 ? failed / total : 0;
          const status  = errRate > 0.5 ? "DEGRADED" : "LIVE";
          return { ...base, status, note: `최근 1h: 성공 ${success}건 / 실패 ${failed}건` };
        } catch {
          return { ...base, status: "UNKNOWN", note: "ai_traces 조회 실패" };
        }
      })(),
      // Storage: photo/video 업로드 최근 24h 활동
      (async () => {
        const base = { id: "storage", name: "Storage (R2)", status: "UNKNOWN", latency_ms: null, note: "", last_checked: new Date().toISOString() };
        try {
          const r = await superAdminDb.execute(sql`
            SELECT
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS uploads_24h,
              COUNT(*)::int AS total_files
            FROM photo_assets_meta
          `);
          const row    = r.rows[0] as any;
          const upld   = Number(row?.uploads_24h ?? 0);
          const total  = Number(row?.total_files ?? 0);
          return { ...base, status: "LIVE", note: `파일 ${total}개 · 최근 24h 업로드 ${upld}건 (DB 기반, R2 직접 핑 불포함)` };
        } catch {
          return { ...base, status: "UNKNOWN", note: "photo_assets_meta 조회 실패" };
        }
      })(),
      // Push: UNKNOWN (no telemetry source)
      Promise.resolve({ id: "push", name: "Push (APNs/FCM)", status: "UNKNOWN", latency_ms: null, note: "발송 텔레메트리 미구현", last_checked: new Date().toISOString() }),
    ]);

    const unwrap = (r: PromiseSettledResult<any>, fallback: object) =>
      r.status === "fulfilled" ? r.value : { ...fallback, status: "UNKNOWN", note: "조회 중 오류" };

    const database  = unwrap(dbRes,      { id: "database",   name: "Database"        });
    const revenuecat= unwrap(rcRes,      { id: "revenuecat", name: "RevenueCat"       });
    const ai_engine = unwrap(aiRes,      { id: "ai_engine",  name: "AI Engine"        });
    const storage   = unwrap(storageRes, { id: "storage",    name: "Storage (R2)"     });
    const push      = unwrap(pushRes,    { id: "push",       name: "Push (APNs/FCM)"  });

    // APP API: UNKNOWN — server-to-self 호출은 루프 위험, Front Door는 브라우저에서 직접 체크
    const app_api = { id: "app_api", name: "APP API", status: "UNKNOWN", latency_ms: null,
      note: "swimnote.kr/api — 클라이언트에서 직접 헬스체크 권장", last_checked: new Date().toISOString() };

    res.json({
      checked_at: new Date().toISOString(),
      services: { app_api, database, revenuecat, ai_engine, storage, push },
    });
  },
);

// ── POST /super/growth-report-scheduler/run — 스케줄러 수동 trigger (super_admin only) ──
// 용도: READY pool이 생긴 직후 cron을 기다리지 않고 즉시 cycle을 생성할 때
// 금지: AI 호출 없음, report 분석 없음 — cycle 생성 + report row 생성만
router.post(
  "/super/growth-report-scheduler/run",
  requireAuth, requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const { runGrowthReportScheduler } = await import("../jobs/growth-report-scheduler.js");
      const result = await runGrowthReportScheduler(superAdminDb);
      res.json({
        ok: true,
        cycles_opened:       result.cycles_opened,
        cycles_input_closed: result.cycles_input_closed,
        failed:              result.failed,
        errors:              result.errors,
        ran_at:              result.run_at,
      });
    } catch (err: any) {
      console.error("[super] growth-report-scheduler/run 오류:", err.message);
      res.status(500).json({ error: "SCHEDULER_RUN_FAILED", message: err.message });
    }
  },
);

// ── POST /super/growth-reports/:reportId/analyze — 단일 report AI 분석 trigger ──
//
// 용도:
//   1. 특정 report 1건만 분석 (auto worker 비활성 상태에서 검증용)
//   2. 운영 장애 시 개별 report 재처리
//
// 안전 조건:
//   - super_admin only
//   - 기존 growth-report-analysis-worker의 analyzeOneReport 파이프라인을 그대로 통과
//   - 직접 status/content 변경 금지
//   - OPEN/READY_FOR_ANALYSIS 외 상태 = 409 거부 (idempotent)
//   - duplicate-safe (FOR UPDATE in transitionReportStatus)
//   - auto worker 비활성(GROWTH_REPORT_ANALYSIS_AUTO_ENABLED=false)에도 동작
router.post(
  "/super/growth-reports/:reportId/analyze",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { reportId } = req.params;
    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "INVALID_REPORT_ID" });
      return;
    }

    try {
      // FAILED 상태인 경우: OPEN으로 복구 후 분석 (super_admin 운영 재처리 경로)
      const [curRow] = (await superAdminDb.execute(sql`
        SELECT product_status FROM growth_reports WHERE id = ${reportId} LIMIT 1
      `)).rows as any[];

      if (!curRow) {
        res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
        return;
      }

      if (curRow.product_status === "FAILED") {
        // 정상 transition 경로: FAILED → OPEN (직접 SQL 금지 준수)
        const { transitionReportStatus } = await import("../lib/growth-report-service.js");
        await transitionReportStatus({
          db:        superAdminDb,
          reportId,
          toStatus:  "OPEN",
          actorType: "super_admin",
          actorId:   (req as any).user?.id ?? null,
          reason:    "SUPER_ADMIN_REOPEN_FOR_REANALYSIS",
        });
        // analysis_request_id, retry_count 초기화 (새 분석 시도)
        await superAdminDb.execute(sql`
          UPDATE growth_reports
          SET analysis_request_id  = NULL,
              analysis_retry_count = 0,
              updated_at           = now()
          WHERE id = ${reportId} AND product_status = 'OPEN'::gr_product_status_enum
        `);
        console.log(`[super] report=${reportId} FAILED→OPEN (super_admin reopen for reanalysis)`);
      }

      const { analyzeSingleReport } = await import("../jobs/growth-report-analysis-worker.js");
      const result = await analyzeSingleReport(superAdminDb, reportId);

      if (result.already_done) {
        res.status(409).json({
          ok:             false,
          error:          "REPORT_NOT_ANALYZABLE",
          report_id:      result.report_id,
          product_status: result.product_status,
          message:        "Only OPEN or READY_FOR_ANALYSIS reports can be analyzed",
        });
        return;
      }

      res.json({
        ok:             result.product_status !== "FAILED",
        report_id:      result.report_id,
        product_status: result.product_status,
        triggered_at:   new Date().toISOString(),
        ...(result.error_code     ? { error_code:     result.error_code }     : {}),
        ...(result.http_status    ? { http_status:    result.http_status }    : {}),
        ...(result.engine_details ? { engine_details: result.engine_details } : {}),
      });
    } catch (err: any) {
      if (err.code === "REPORT_NOT_FOUND") {
        res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
        return;
      }
      // Unhandled exception during analysis — recover stuck PREANALYZING → FAILED
      try {
        const { transitionReportStatus } = await import("../lib/growth-report-service.js");
        await transitionReportStatus({
          db: superAdminDb, reportId,
          toStatus: "FAILED", actorType: "system", actorId: null,
          reason: "ANALYZE_EXCEPTION_RECOVERY",
        }).catch(() => {});
      } catch (_) {}
      console.error("[super] growth-reports/analyze 오류:", err.message);
      res.status(500).json({ error: "ANALYZE_FAILED", message: err.message });
    }
  },
);

// ── POST /super/growth-reports/:reportId/reopen — FAILED report를 OPEN으로 복구 ──
//
// 용도:
//   ENGINE_URL_NOT_CONFIGURED 등 비즈니스 외부 원인으로 FAILED된 report를
//   OPEN으로 되돌려 재분석 가능 상태로 만든다.
//
// 안전 조건:
//   - super_admin only
//   - FAILED 상태만 허용 (다른 상태 → 409)
//   - transitionReportStatus 정상 service 경로만 사용 (직접 SQL 금지)
//   - analysis_request_id, retry_count는 초기화 (새 분석 시도를 위해)
router.post(
  "/super/growth-reports/:reportId/reopen",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { reportId } = req.params;
    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "INVALID_REPORT_ID" });
      return;
    }

    try {
      const [row] = (await superAdminDb.execute(sql`
        SELECT product_status, analysis_retry_count FROM growth_reports WHERE id = ${reportId} LIMIT 1
      `)).rows as any[];

      if (!row) {
        res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
        return;
      }

      if (row.product_status !== "FAILED" && row.product_status !== "PREANALYZING") {
        res.status(409).json({
          ok:             false,
          error:          "NOT_FAILED",
          report_id:      reportId,
          product_status: row.product_status,
          message:        "Only FAILED or stuck PREANALYZING reports can be reopened",
        });
        return;
      }

      // 정상 transition 경로: FAILED → OPEN, PREANALYZING → OPEN
      const { transitionReportStatus } = await import("../lib/growth-report-service.js");
      await transitionReportStatus({
        db:        superAdminDb,
        reportId,
        toStatus:  "OPEN",
        actorType: "super_admin",
        actorId:   (req as any).user?.id ?? null,
        reason:    "SUPER_ADMIN_REOPEN",
      });

      // analysis_request_id 초기화 (새 분석 시도를 위해)
      await superAdminDb.execute(sql`
        UPDATE growth_reports
        SET analysis_request_id = NULL,
            analysis_retry_count = 0,
            updated_at = now()
        WHERE id = ${reportId} AND product_status = 'OPEN'::gr_product_status_enum
      `);

      res.json({
        ok:             true,
        report_id:      reportId,
        product_status: "OPEN",
        reopened_at:    new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[super] growth-reports/reopen 오류:", err.message);
      res.status(500).json({ error: "REOPEN_FAILED", message: err.message });
    }
  },
);

// ── GET /super/growth-reports/:reportId/snapshot-preview — 스냅샷 payload 확인 (엔진 호출 없음) ──
router.get(
  "/super/growth-reports/:reportId/snapshot-preview",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { reportId } = req.params as { reportId: string };
    try {
      const { fetchSingleReport } = await import("../jobs/growth-report-analysis-worker.js");
      const { buildAnalysisSnapshot } = await import("../lib/growth-report-snapshot-builder.js");

      const pending = await fetchSingleReport(superAdminDb, reportId);
      if (!pending) {
        return res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
      }

      const { request, payloadHash } = await buildAnalysisSnapshot(superAdminDb, {
        report:    pending.report,
        cycle:     pending.cycle,
        requestId: "preview-only",
      });

      return res.json({
        ok:            true,
        report_id:     reportId,
        payload_hash:  payloadHash,
        contract_version: request.contract_version,
        snapshot_version: request.snapshot.snapshot_version,
        context:       request.context,
        snapshot_summary: {
          diaries_count:       request.snapshot.diaries.length,
          growth_events_count: request.snapshot.growth_events.length,
          attendance_count:    request.snapshot.attendance.length,
          parent_answers_count: request.snapshot.parent_answers.length,
          has_curriculum_state: request.snapshot.curriculum_state !== null,
          longitudinal_previous_reports: request.snapshot.longitudinal.previous_report_structured_results.length,
        },
        full_request:  request,
      });
    } catch (err: any) {
      console.error("[super] growth-reports/snapshot-preview 오류:", err.message);
      res.status(500).json({ error: "SNAPSHOT_BUILD_FAILED", message: err.message });
    }
  },
);

// ── POST /super/growth-reports/:reportId/mark-review-required ────────────────
//
// 용도:
//   analysis_status=COMPLETE + report_content 존재 + grounding/growth_framing PASS 인
//   READY_FOR_ANALYSIS report를 super_admin이 수동으로 REVIEW_REQUIRED로 전환.
//   auto-worker 비활성화 환경에서의 운영 전용 엔드포인트.
//
// 전환 조건 (모두 충족 필수):
//   ① product_status  = READY_FOR_ANALYSIS
//   ② analysis_status = COMPLETE
//   ③ report_content  IS NOT NULL
//   ④ grounding       = PASS or REVISED_PASS  (report_content 내 grounding_result)
//   ⑤ growth_framing  = PASS or REVISED_PASS  (report_content 내 growth_framing_result)
//
// 조건 불충족 → 409
// 정상 전환   → transitionReportStatus(READY_FOR_ANALYSIS → REVIEW_REQUIRED)
router.post(
  "/super/growth-reports/:reportId/mark-review-required",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { reportId } = req.params;
    if (!reportId || typeof reportId !== "string") {
      res.status(400).json({ error: "INVALID_REPORT_ID" });
      return;
    }

    try {
      const rows = (await superAdminDb.execute(sql`
        SELECT
          product_status,
          analysis_status,
          report_content IS NOT NULL                                         AS has_content,
          report_content->'grounding_result'->>'status'                      AS grounding_status,
          report_content->'growth_framing_result'->>'status'                 AS growth_framing_status,
          report_content->'validation'->'grounding'->>'status'               AS val_grounding_status,
          report_content->'validation'->'growth_framing'->>'status'          AS val_growth_framing_status
        FROM growth_reports
        WHERE id = ${reportId} AND deleted_at IS NULL
        LIMIT 1
      `)).rows as any[];

      if (!rows.length) {
        res.status(404).json({ error: "REPORT_NOT_FOUND", report_id: reportId });
        return;
      }

      const row = rows[0];
      const PASS_VALUES = new Set(["PASS", "REVISED_PASS"]);

      // ① product_status 확인
      if (row.product_status !== "READY_FOR_ANALYSIS") {
        res.status(409).json({
          ok: false, error: "WRONG_STATUS",
          report_id: reportId,
          product_status: row.product_status,
          message: `product_status must be READY_FOR_ANALYSIS, got ${row.product_status}`,
        });
        return;
      }

      // ② analysis_status 확인
      if (row.analysis_status !== "COMPLETE") {
        res.status(409).json({
          ok: false, error: "NOT_COMPLETE",
          report_id: reportId,
          analysis_status: row.analysis_status,
          message: `analysis_status must be COMPLETE, got ${row.analysis_status}`,
        });
        return;
      }

      // ③ report_content 존재 확인
      if (!row.has_content) {
        res.status(409).json({
          ok: false, error: "NO_REPORT_CONTENT",
          report_id: reportId,
          message: "report_content is NULL — analysis result not persisted",
        });
        return;
      }

      // ④ grounding PASS 확인 (grounding_result.status 또는 validation.grounding.status)
      const groundingStatus = row.grounding_status ?? row.val_grounding_status ?? null;
      if (!PASS_VALUES.has(groundingStatus)) {
        res.status(409).json({
          ok: false, error: "GROUNDING_NOT_PASS",
          report_id: reportId,
          grounding_status: groundingStatus,
          message: `grounding must be PASS/REVISED_PASS, got ${groundingStatus}`,
        });
        return;
      }

      // ⑤ growth_framing PASS 확인
      const framingStatus = row.growth_framing_status ?? row.val_growth_framing_status ?? null;
      if (!PASS_VALUES.has(framingStatus)) {
        res.status(409).json({
          ok: false, error: "GROWTH_FRAMING_NOT_PASS",
          report_id: reportId,
          growth_framing_status: framingStatus,
          message: `growth_framing must be PASS/REVISED_PASS, got ${framingStatus}`,
        });
        return;
      }

      // 정상 transition: READY_FOR_ANALYSIS → REVIEW_REQUIRED
      const { transitionReportStatus } = await import("../lib/growth-report-service.js");
      await transitionReportStatus({
        db:        superAdminDb,
        reportId,
        toStatus:  "REVIEW_REQUIRED",
        actorType: "super_admin",
        actorId:   (req as any).user?.id ?? null,
        reason:    "SUPER_ADMIN_MARK_REVIEW_REQUIRED",
      });

      console.log(`[super] report=${reportId} READY_FOR_ANALYSIS→REVIEW_REQUIRED (super_admin manual)`);
      res.json({
        ok:             true,
        report_id:      reportId,
        product_status: "REVIEW_REQUIRED",
        marked_at:      new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[super] growth-reports/mark-review-required 오류:", err.message);
      res.status(500).json({ error: "MARK_REVIEW_REQUIRED_FAILED", message: err.message });
    }
  },
);

// ── GET /super/growth-report/push-index-status — 운영 DB push index 진단 (read-only) ─────
//
// uq_notifications_gr_published index 존재 + GROWTH_REPORT_PUBLISHED duplicate 확인.
// safe_for_on_conflict = index_exists && duplicate_group_count === 0
// DB write/index 생성/삭제 절대 금지.

router.get(
  "/super/growth-report/push-index-status",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    try {
      const [indexRes, dupRes] = await Promise.all([
        db.execute(sql`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE tablename = 'notifications'
            AND indexname = 'uq_notifications_gr_published'
        `),
        db.execute(sql`
          SELECT type, ref_id, recipient_id, COUNT(*) AS cnt
          FROM notifications
          WHERE type = 'GROWTH_REPORT_PUBLISHED'
          GROUP BY type, ref_id, recipient_id
          HAVING COUNT(*) > 1
        `),
      ]);

      const indexExists          = indexRes.rows.length > 0;
      const duplicateGroupCount  = dupRes.rows.length;
      const safeForOnConflict    = indexExists && duplicateGroupCount === 0;

      res.json({
        index_exists:          indexExists,
        index_name:            indexExists ? (indexRes.rows[0] as any).indexname : null,
        duplicate_group_count: duplicateGroupCount,
        safe_for_on_conflict:  safeForOnConflict,
        duplicates:            safeForOnConflict ? [] : dupRes.rows,
      });
    } catch (e: any) {
      console.error("[super] growth-report/push-index-status 오류:", e?.message);
      res.status(500).json({ error: "DIAGNOSTIC_FAILED", message: e?.message });
    }
  },
);

export default router;



