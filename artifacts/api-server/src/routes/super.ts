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
import { logEvent, logOperationalError } from "../lib/event-logger.js";
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
/**
 * ensureExtraTables — NO-OP (WP8-P2)
 * DDL moved to src/migrations/runtime-ddl-consolidated.ts §7
 * Run that migration before deploying. This function is kept for call-site compatibility.
 */
async function ensureExtraTables() {
  // NO-OP: schema is guaranteed by explicit migration
}

/**
 * ensurePlansTables — NO-OP (WP8-P2)
 * DDL moved to src/migrations/runtime-ddl-consolidated.ts §8
 * Run that migration before deploying. This function is kept for call-site compatibility.
 */
async function ensurePlansTables() {
  // NO-OP: schema is guaranteed by explicit migration
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
/**
 * ensureCreditTable — NO-OP (WP8-P2)
 * DDL moved to src/migrations/runtime-ddl-consolidated.ts §10
 */
async function ensureCreditTable() {
  // NO-OP: schema is guaranteed by explicit migration
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
// ensureExtraTables() boot call removed (WP8-P2) — schema via explicit migration
// ensurePlansTables() boot call removed (WP8-P2) — schema via explicit migration

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

// ════════════════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/base — BASE SWIMNOTE manual entitlement grant/revoke
// ════════════════════════════════════════════════════════════════════════════
//
// Super Admin이 결제 없이 수영장에 BASE SWIMNOTE 이용권을 직접 부여/회수.
// RevenueCat webhook은 base_manual_entitlement를 절대 수정하지 않음.
// 모든 변경은 audit_logs에 기록됨.
//
router.patch(
  "/super/operators/:id/base",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      base_manual_entitlement,
      reason,
    } = req.body as {
      base_manual_entitlement?: boolean;
      reason?: string;
    };

    if (base_manual_entitlement === undefined) {
      res.status(400).json({ error: "base_manual_entitlement 필드 필요" });
      return;
    }
    if (typeof base_manual_entitlement !== "boolean") {
      res.status(400).json({ error: "base_manual_entitlement는 boolean이어야 함" });
      return;
    }

    const actorId = req.user!.id;
    try {
      await superAdminDb.transaction(async (tx) => {
        // Before
        const beforeRes = await tx.execute(sql`
          SELECT COALESCE(base_manual_entitlement, false) AS base_manual_entitlement
          FROM swimming_pools WHERE id = ${poolId}
        `);
        if (!beforeRes.rows.length) {
          res.status(404).json({ error: "수영장 없음" });
          return;
        }
        const beforeData = {
          base_manual_entitlement: Boolean((beforeRes.rows[0] as any).base_manual_entitlement),
        };

        // Update
        const updatedRes = await tx.execute(sql`
          UPDATE swimming_pools
          SET base_manual_entitlement = ${base_manual_entitlement}
          WHERE id = ${poolId}
          RETURNING id, COALESCE(base_manual_entitlement, false) AS base_manual_entitlement
        `);
        const updated = updatedRes.rows[0] as any;
        const afterData = {
          base_manual_entitlement: Boolean(updated.base_manual_entitlement),
          source: "super_admin_manual",
        };

        // Audit
        const vRes = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_base_access', ${poolId}) AS v
        `);
        const version = (vRes.rows[0] as any).v;
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_base_access', ${poolId}, ${version},
            'update', 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify(beforeData)}::jsonb,
            ${JSON.stringify(afterData)}::jsonb,
            ${reason ?? (base_manual_entitlement ? "Super Admin BASE grant" : "Super Admin BASE revoke")}
          )
        `);

        res.json({
          pool_id: poolId,
          base_manual_entitlement: Boolean(updated.base_manual_entitlement),
          action: base_manual_entitlement ? "granted" : "revoked",
          source: "super_admin_manual",
        });
      });
    } catch (e: any) {
      console.error("[super] PATCH operators/:id/base 오류:", e?.message);
      res.status(500).json({ error: "BASE_GRANT_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// GET /super/plan-catalog — X Plan Catalog (backward-compat, X plans only)
// ════════════════════════════════════════════════════════════════════════════
router.get(
  "/super/plan-catalog",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    const { X_PLAN_CATALOG } = await import("../lib/xPlanCatalog.js");
    res.json({ plans: X_PLAN_CATALOG });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// GET /super/official-plan-catalog — 신규 공식 6개 플랜 전체 (서버 authoritative)
//
// 반환 구조:
//   { catalog: OfficialPlanDef[], by_type: { base, x, data_addon } }
//
// Super Admin UI는 이 endpoint를 기준으로 구독 플랜 표시.
// Legacy Coach/Premier는 active=false이므로 신규 selector에 표시 안 됨.
// ════════════════════════════════════════════════════════════════════════════
router.get(
  "/super/official-plan-catalog",
  requireAuth,
  requireRole("super_admin"),
  async (_req: AuthRequest, res) => {
    const { OFFICIAL_PLAN_CATALOG, getPlansByType } = await import("../lib/officialPlanCatalog.js");
    res.json({
      catalog:  OFFICIAL_PLAN_CATALOG,
      by_type: {
        base:       getPlansByType("base"),
        x:          getPlansByType("x"),
        data_addon: getPlansByType("data_addon"),
      },
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/xmode — X Manual Entitlement Grant / Revoke
// ════════════════════════════════════════════════════════════════════════════
//
// Super Admin이 결제 없이 수영장에 X 이용권을 직접 부여/회수.
// 쓰는 DB 필드: x_manual_entitlement (± x_force_disabled, x_plan_key, xmode_config_status)
// 절대 수정하지 않는 필드: x_paid_entitlement, xmode_entitlement (legacy)
// RevenueCat 상태 조작 금지.
//
// Body:
//   xmode_entitlement: boolean  — true=부여, false=회수  (UI backward-compat key)
//   x_plan_key?:       string | null
//   bypass_readiness_check?: boolean  — true 시 xmode_config_status → READY
//   reason?: string
//
// 부여 시:
//   x_manual_entitlement = true
//   x_force_disabled     = false  (강제 비활성화 해제)
//   x_plan_key           = provided value (optional)
//   xmode_config_status  = bypass_readiness_check ? 'READY' : 기존값 유지
//
// 회수 시:
//   x_manual_entitlement = false
//   x_plan_key           = null
//   (x_paid_entitlement, xmode_config_status 불변)
//
// Response: effective resolver 기준 상태 반환.
// Audit: audit_logs 기록.
//
router.patch(
  "/super/operators/:id/xmode",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      xmode_entitlement,
      x_plan_key,
      bypass_readiness_check,
      reason,
    } = req.body as {
      xmode_entitlement?: boolean;
      x_plan_key?: string | null;
      bypass_readiness_check?: boolean;
      reason?: string;
    };

    if (typeof xmode_entitlement !== "boolean") {
      res.status(400).json({ error: "xmode_entitlement (boolean) 필드 필요" });
      return;
    }

    const actorId = req.user!.id;
    const grant = xmode_entitlement; // true=부여, false=회수

    try {
      await superAdminDb.transaction(async (tx) => {
        // ── Before state ───────────────────────────────────────────────
        const beforeRes = await tx.execute(sql`
          SELECT
            id,
            COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
            COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
            COALESCE(x_force_disabled,    false) AS x_force_disabled,
            x_plan_key,
            xmode_config_status
          FROM swimming_pools
          WHERE id = ${poolId}
          LIMIT 1
        `);
        if (!beforeRes.rows.length) {
          res.status(404).json({ error: "수영장 없음" });
          return;
        }
        const before = beforeRes.rows[0] as any;

        const beforePaid   = Boolean(before.x_paid_entitlement);
        const beforeManual = Boolean(before.x_manual_entitlement);
        const beforeForce  = Boolean(before.x_force_disabled);

        // ── Build UPDATE ────────────────────────────────────────────────
        let newManual: boolean;
        let newForce:  boolean;
        let newPlanKey: string | null;
        let newConfigStatus: string | null;

        if (grant) {
          newManual     = true;
          newForce      = false; // 강제 비활성화 해제
          newPlanKey    = x_plan_key ?? (before.x_plan_key ?? null);
          newConfigStatus = bypass_readiness_check
            ? "READY"
            : (before.xmode_config_status ?? null);
        } else {
          newManual     = false;
          newForce      = beforeForce; // force는 건드리지 않음
          newPlanKey    = null;
          newConfigStatus = before.xmode_config_status ?? null; // 불변
        }

        // ── Catalog-authoritative member_limit ─────────────────────────
        // 클라이언트 제공 member_limit는 절대 신뢰하지 않음.
        // grant 시: X plan catalog 기준 member_limit 자동 설정.
        // revoke 시: null로 초기화 (plan catalog 기본값 사용).
        const { getXMemberLimit } = await import("../lib/xPlanCatalog.js");
        const newMemberLimit: number | null = grant && newPlanKey
          ? (getXMemberLimit(newPlanKey) ?? null)
          : null;

        const updatedRes = await tx.execute(sql`
          UPDATE swimming_pools
          SET
            x_manual_entitlement = ${newManual},
            x_force_disabled     = ${newForce},
            x_plan_key           = ${newPlanKey},
            xmode_config_status  = ${newConfigStatus},
            member_limit         = ${newMemberLimit},
            updated_at           = NOW()
          WHERE id = ${poolId}
          RETURNING
            COALESCE(x_paid_entitlement,  false) AS x_paid_entitlement,
            COALESCE(x_manual_entitlement, false) AS x_manual_entitlement,
            COALESCE(x_force_disabled,    false) AS x_force_disabled,
            x_plan_key,
            xmode_config_status,
            member_limit
        `);
        const after = updatedRes.rows[0] as any;

        const afterPaid   = Boolean(after.x_paid_entitlement);
        const afterManual = Boolean(after.x_manual_entitlement);
        const afterForce  = Boolean(after.x_force_disabled);
        const afterEff    = (afterPaid || afterManual) && !afterForce;

        // ── Audit ───────────────────────────────────────────────────────
        const beforeEff = (beforePaid || beforeManual) && !beforeForce;
        const vRes = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_xmode', ${poolId}) AS v
        `);
        const version = (vRes.rows[0] as any).v;
        const beforeData = {
          x_paid_entitlement:   beforePaid,
          x_manual_entitlement: beforeManual,
          x_force_disabled:     beforeForce,
          xmode_entitlement:    beforeEff,
        };
        const afterData = {
          x_paid_entitlement:   afterPaid,
          x_manual_entitlement: afterManual,
          x_force_disabled:     afterForce,
          xmode_entitlement:    afterEff,
          source:               "super_admin_manual",
          action:               grant ? "grant" : "revoke",
        };
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_xmode', ${poolId}, ${version},
            'update', 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify(beforeData)}::jsonb,
            ${JSON.stringify(afterData)}::jsonb,
            ${reason ?? (grant ? "Super Admin X grant" : "Super Admin X revoke")}
          )
        `);

        // ── Response: effective resolver 기준 ───────────────────────────
        const afterOverride = Boolean(after.x_management_override);
        res.json({
          pool_id:                poolId,
          x_manual_entitlement:   afterManual,
          x_paid_entitlement:     afterPaid,
          x_force_disabled:       afterForce,
          x_management_override:  afterOverride,
          x_effective:            afterEff,
          x_source:               afterOverride ? "management_override"
                                  : (afterManual ? "manual" : (afterPaid ? "paid" : "none")),
          x_plan_key:             after.x_plan_key ?? null,
          member_limit:           after.member_limit ?? null,
          xmode_config_status:    after.xmode_config_status ?? null,
          action:                 grant ? "granted" : "revoked",
        });
      });
    } catch (e: any) {
      console.error("[super] PATCH operators/:id/xmode 오류:", e?.message);
      res.status(500).json({ error: "X_ENTITLEMENT_UPDATE_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/management-override — 본사 관리용 X override 설정/해제
// ════════════════════════════════════════════════════════════════════════════
//
// 목적: 특정 pool을 일반 X 진입 조건(paid/config/curriculum/force_disabled)과
//       완전히 분리하여 영구 X 테넌트로 고정.
//
// 권한: Super Admin 전용. 클라이언트에서 activate 불가.
// 우선순위: computeMode() 최우선 — force_disabled보다 우선.
// override=true  → 즉시 mode="x", plan=x_plan_key, source="management_override"
// override=false → 일반 entitlement/config resolver로 복귀
//
// 변경 audit_logs 기록.
//
router.patch(
  "/super/operators/:id/management-override",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { override, reason } = req.body as {
      override?: boolean;
      reason?: string;
    };

    if (typeof override !== "boolean") {
      res.status(400).json({ error: "override (boolean) 필드 필요" });
      return;
    }

    const actorId = req.user!.id;

    try {
      await superAdminDb.transaction(async (tx) => {
        // ── Before state ────────────────────────────────────────────────
        const beforeRes = await tx.execute(sql`
          SELECT id,
                 COALESCE(x_management_override, false) AS x_management_override,
                 COALESCE(x_manual_entitlement,  false) AS x_manual_entitlement,
                 COALESCE(x_paid_entitlement,    false) AS x_paid_entitlement,
                 COALESCE(x_force_disabled,      false) AS x_force_disabled,
                 x_plan_key, xmode_config_status, member_limit
          FROM swimming_pools WHERE id = ${poolId} LIMIT 1
        `);
        if (!beforeRes.rows.length) {
          res.status(404).json({ error: "수영장 없음" });
          return;
        }
        const before = beforeRes.rows[0] as any;
        const beforeOverride = Boolean(before.x_management_override);

        // ── UPDATE ──────────────────────────────────────────────────────
        const version = Date.now();
        await tx.execute(sql`
          UPDATE swimming_pools
          SET x_management_override = ${override}
          WHERE id = ${poolId}
        `);

        // ── After state ─────────────────────────────────────────────────
        const afterRes = await tx.execute(sql`
          SELECT COALESCE(x_management_override, false) AS x_management_override,
                 COALESCE(x_manual_entitlement,  false) AS x_manual_entitlement,
                 COALESCE(x_paid_entitlement,    false) AS x_paid_entitlement,
                 COALESCE(x_force_disabled,      false) AS x_force_disabled,
                 x_plan_key, xmode_config_status, member_limit
          FROM swimming_pools WHERE id = ${poolId} LIMIT 1
        `);
        const after = afterRes.rows[0] as any;
        const afterOverride = Boolean(after.x_management_override);

        // ── Audit log ───────────────────────────────────────────────────
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_management_override', ${poolId}, ${version},
            'update', 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify({ x_management_override: beforeOverride })}::jsonb,
            ${JSON.stringify({ x_management_override: afterOverride })}::jsonb,
            ${reason ?? (override ? "Super Admin management override 활성" : "Super Admin management override 해제")}
          )
        `);

        // ── Response ─────────────────────────────────────────────────────
        const afterManual = Boolean(after.x_manual_entitlement);
        const afterPaid   = Boolean(after.x_paid_entitlement);
        res.json({
          pool_id:               poolId,
          x_management_override: afterOverride,
          x_manual_entitlement:  afterManual,
          x_paid_entitlement:    afterPaid,
          x_force_disabled:      Boolean(after.x_force_disabled),
          x_effective:           afterOverride || ((afterManual || afterPaid) && !after.x_force_disabled),
          x_source:              afterOverride ? "management_override"
                                 : (afterManual ? "manual" : (afterPaid ? "paid" : "none")),
          x_plan_key:            after.x_plan_key ?? null,
          member_limit:          after.member_limit ?? null,
          xmode_config_status:   after.xmode_config_status ?? null,
          action:                override ? "override_enabled" : "override_disabled",
        });
      });
    } catch (e: any) {
      console.error("[super] PATCH operators/:id/management-override 오류:", e?.message);
      res.status(500).json({ error: "MANAGEMENT_OVERRIDE_UPDATE_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/force-disable — X 강제 비활성화 / 해제
// ════════════════════════════════════════════════════════════════════════════
//
// x_force_disabled = true  → paid/manual entitlement 무관하게 effective X OFF
// x_force_disabled = false → entitlement 상태 기준으로 재계산
// x_paid_entitlement / x_manual_entitlement 불변
// 모든 변경 audit_logs 기록
//
router.patch(
  "/super/operators/:id/force-disable",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { disabled, reason } = req.body as { disabled?: boolean; reason?: string };

    if (typeof disabled !== "boolean") {
      res.status(400).json({ error: "disabled (boolean) 필드 필요" });
      return;
    }
    if (!reason?.trim()) {
      res.status(400).json({ error: "reason 필수 (빈 문자열 불가)" });
      return;
    }

    const actorId = req.user!.userId;
    try {
      await db.transaction(async (tx) => {
        const beforeRes = await tx.execute(sql`
          SELECT id,
                 COALESCE(x_paid_entitlement,  false) AS x_paid,
                 COALESCE(x_manual_entitlement, false) AS x_manual,
                 COALESCE(x_force_disabled,     false) AS x_force
          FROM swimming_pools WHERE id = ${poolId}
          LIMIT 1 FOR UPDATE
        `);
        if (!beforeRes.rows.length) { res.status(404).json({ error: "수영장 없음" }); return; }
        const before = beforeRes.rows[0] as any;
        const beforeForce = Boolean(before.x_force);
        const xPaid = Boolean(before.x_paid);
        const xManual = Boolean(before.x_manual);
        const beforeEff = (xPaid || xManual) && !beforeForce;

        const updatedRes = await tx.execute(sql`
          UPDATE swimming_pools SET x_force_disabled = ${disabled}
          WHERE id = ${poolId}
          RETURNING id, COALESCE(x_force_disabled, false) AS x_force_disabled
        `);
        const afterForce = Boolean((updatedRes.rows[0] as any).x_force_disabled);
        const afterEff = (xPaid || xManual) && !afterForce;

        const action = disabled ? "X_FORCE_DISABLE" : "X_FORCE_RESTORE";
        const vRes = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_xmode', ${poolId}) AS v
        `);
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_xmode', ${poolId}, ${(vRes.rows[0] as any).v},
            ${action}, 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify({ x_force_disabled: beforeForce, x_effective: beforeEff })}::jsonb,
            ${JSON.stringify({ x_force_disabled: afterForce, x_effective: afterEff })}::jsonb,
            ${reason}
          )
        `);

        res.json({
          pool_id: poolId,
          x_force_disabled: afterForce,
          x_effective: afterEff,
          action,
        });
      });
    } catch (e: any) {
      console.error("[super] PATCH operators/:id/force-disable 오류:", e?.message);
      res.status(500).json({ error: "FORCE_DISABLE_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// PATCH /super/operators/:id/member-limit — Member Limit Override
// ════════════════════════════════════════════════════════════════════════════
//
// member_limit = N (1..9998) → pool-level override, plan catalog limit 무시
// member_limit = null         → override 해제, plan catalog limit 사용
// 클라이언트가 보낸 숫자 그대로 신뢰 금지 — 서버에서 범위 검증
//
router.patch(
  "/super/operators/:id/member-limit",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { member_limit, reason } = req.body as {
      member_limit?: number | null;
      reason?: string;
    };

    // Validate
    if (member_limit !== null && member_limit !== undefined) {
      if (!Number.isInteger(member_limit) || member_limit < 1 || member_limit > 9998) {
        res.status(400).json({ error: "member_limit은 1~9998 정수 또는 null(해제)이어야 함" });
        return;
      }
    }
    if (!reason?.trim()) {
      res.status(400).json({ error: "reason 필수" });
      return;
    }

    const actorId = req.user!.userId;
    const newLimit = member_limit ?? null;

    try {
      await db.transaction(async (tx) => {
        const beforeRes = await tx.execute(sql`
          SELECT id, member_limit FROM swimming_pools WHERE id = ${poolId}
          LIMIT 1 FOR UPDATE
        `);
        if (!beforeRes.rows.length) { res.status(404).json({ error: "수영장 없음" }); return; }
        const beforeLimit = (beforeRes.rows[0] as any).member_limit ?? null;

        const updatedRes = await tx.execute(sql`
          UPDATE swimming_pools SET member_limit = ${newLimit}
          WHERE id = ${poolId}
          RETURNING id, member_limit
        `);
        const afterLimit = (updatedRes.rows[0] as any).member_limit ?? null;

        const action = newLimit !== null ? "MEMBER_LIMIT_OVERRIDE" : "MEMBER_LIMIT_OVERRIDE_CLEAR";
        const vRes = await tx.execute(sql`
          SELECT next_audit_version('swimming_pool_member_limit', ${poolId}) AS v
        `);
        await tx.execute(sql`
          INSERT INTO audit_logs (
            entity_type, entity_id, entity_version,
            action, actor_type, actor_id, pool_id,
            before_data, after_data, reason
          ) VALUES (
            'swimming_pool_member_limit', ${poolId}, ${(vRes.rows[0] as any).v},
            ${action}, 'super_admin', ${actorId}, ${poolId},
            ${JSON.stringify({ member_limit: beforeLimit })}::jsonb,
            ${JSON.stringify({ member_limit: afterLimit })}::jsonb,
            ${reason}
          )
        `);

        res.json({ pool_id: poolId, member_limit: afterLimit, action });
      });
    } catch (e: any) {
      console.error("[super] PATCH operators/:id/member-limit 오류:", e?.message);
      res.status(500).json({ error: "MEMBER_LIMIT_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN POOL CONTROL CENTER — Summary + Lazy Tab Endpoints
// ════════════════════════════════════════════════════════════════════════════

// GET /super/pools/:id/control-center/summary — 핵심 요약 (단일 진입 호출)
router.get(
  "/super/pools/:id/control-center/summary",
  requireAuth,
  requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    try {
      // Pool + entitlement (single query)
      const poolRes = await superAdminDb.execute(sql`
        SELECT
          sp.*,
          COALESCE(sp.x_paid_entitlement, false) AS x_paid_entitlement,
          COALESCE(sp.x_manual_entitlement, false) AS x_manual_entitlement,
          COALESCE(sp.x_force_disabled, false) AS x_force_disabled,
          COALESCE(sp.base_manual_entitlement, false) AS base_manual_entitlement
        FROM swimming_pools sp
        WHERE sp.id = ${poolId}
        LIMIT 1
      `);
      if (!poolRes.rows.length) { res.status(404).json({ error: "수영장 없음" }); return; }
      const pool = poolRes.rows[0] as any;

      // Counts + storage + recent errors (parallel)
      const [countsRes, errorRes, aiRes, grRes, notifRes, supportRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            (SELECT COUNT(*) FROM students WHERE swimming_pool_id = ${poolId} AND status = 'active') AS active_members,
            (SELECT COUNT(*) FROM students WHERE swimming_pool_id = ${poolId}) AS total_members,
            (SELECT COUNT(*) FROM users WHERE swimming_pool_id = ${poolId} AND role IN ('pool_admin', 'teacher')) AS teacher_count,
            (SELECT COUNT(*) FROM parent_accounts WHERE swimming_pool_id = ${poolId}) AS parent_count,
            (SELECT COUNT(*) FROM class_groups WHERE swimming_pool_id = ${poolId} AND active = true) AS active_class_count
        `),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at
          FROM event_logs
          WHERE pool_id = ${poolId} AND level IN ('error', 'critical')
            AND created_at > NOW() - INTERVAL '7 days'
        `).catch(() => ({ rows: [{ cnt: 0, last_at: null }] })),
        superAdminDb.execute(sql`
          SELECT diary_count, teacher_count AS ai_teacher_count, ai_call_count,
                 year_month
          FROM x_monthly_operational_snapshots
          WHERE swimming_pool_id = ${poolId}
          ORDER BY year_month DESC LIMIT 1
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) FILTER (WHERE status = 'READY_TO_SEND') AS ready_count,
                 COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_count,
                 COUNT(*) AS total_count
          FROM growth_reports
          WHERE swimming_pool_id = ${poolId}
            AND batch_date >= CURRENT_DATE - INTERVAL '30 days'
        `).catch(() => ({ rows: [{ ready_count: 0, failed_count: 0, total_count: 0 }] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS unread
          FROM notifications
          WHERE pool_id = ${poolId} AND is_read = false
            AND created_at > NOW() - INTERVAL '7 days'
        `).catch(() => ({ rows: [{ unread: 0 }] })),
        superAdminDb.execute(sql`
          SELECT id, ticket_id, state, created_at, updated_at, actor_role
          FROM support_cases
          WHERE pool_id = ${poolId}
          ORDER BY created_at DESC
          LIMIT 1
        `).catch(() => ({ rows: [] })),
      ]);

      const counts = countsRes.rows[0] as any;
      const errors = errorRes.rows[0] as any;
      const ai = aiRes.rows[0] as any ?? {};
      const gr = grRes.rows[0] as any ?? {};
      const notif = notifRes.rows[0] as any;
      const recentSupport = (supportRes.rows[0] as any) ?? null;

      // Health score (rule-based)
      const healthIssues: string[] = [];
      if (pool.x_paid_entitlement && pool.x_force_disabled) healthIssues.push("X ENTITLEMENT CONFLICT");
      if (Number(errors.cnt ?? 0) > 10) healthIssues.push("FREQUENT_ERRORS");
      if (Number(gr.failed_count ?? 0) > 3) healthIssues.push("GROWTH_REPORT_FAILURES");
      if (pool.upload_blocked) healthIssues.push("STORAGE_QUOTA");
      const health: "GREEN" | "YELLOW" | "RED" =
        healthIssues.length === 0 ? "GREEN" :
        healthIssues.some((h) => h.includes("CONFLICT") || h.includes("STORAGE")) ? "RED" : "YELLOW";

      const xPaid    = Boolean(pool.x_paid_entitlement);
      const xManual  = Boolean(pool.x_manual_entitlement);
      const xForce   = Boolean(pool.x_force_disabled);
      const xEff     = (xPaid || xManual) && !xForce;
      const basePaid = Boolean(pool.subscription_status === "active" && !pool.base_manual_entitlement);
      const baseManual = Boolean(pool.base_manual_entitlement);
      const baseEff  = basePaid || baseManual;

      res.json({
        pool_id:          pool.id,
        name:             pool.name,
        owner_name:       pool.owner_name,
        approval_status:  pool.approval_status,
        created_at:       pool.created_at,
        updated_at:       pool.updated_at,
        health,
        health_issues:    healthIssues,
        // BASE access
        base_paid:        basePaid,
        base_manual:      baseManual,
        base_effective:   baseEff,
        base_source:      baseManual ? "manual" : (basePaid ? "paid" : "none"),
        subscription_status: pool.subscription_status,
        subscription_tier:   pool.subscription_tier,
        // X access
        x_paid:           xPaid,
        x_manual:         xManual,
        x_force_disabled: xForce,
        x_effective:      xEff,
        x_source:         xManual ? "manual" : (xPaid ? "paid" : "none"),
        x_plan_key:       pool.x_plan_key ?? null,
        xmode_config_status: pool.xmode_config_status,
        // Counts
        active_members:   Number(counts.active_members ?? 0),
        total_members:    Number(counts.total_members ?? 0),
        teacher_count:    Number(counts.teacher_count ?? 0),
        parent_count:     Number(counts.parent_count ?? 0),
        active_class_count: Number(counts.active_class_count ?? 0),
        // Storage
        member_limit:     pool.member_limit,
        used_storage_bytes: pool.used_storage_bytes,
        upload_blocked:   pool.upload_blocked,
        // AI
        recent_ai_diary_count: Number(ai.diary_count ?? 0),
        recent_ai_month:       ai.year_month ?? null,
        // Growth Report (30d)
        gr_ready_count:   Number(gr.ready_count ?? 0),
        gr_failed_count:  Number(gr.failed_count ?? 0),
        gr_total_count:   Number(gr.total_count ?? 0),
        // Errors (7d)
        recent_error_count: Number(errors.cnt ?? 0),
        last_error_at:    errors.last_at ?? null,
        // Notifications (7d unread)
        unread_notifications: Number(notif.unread ?? 0),
        // Recent support case (latest 1, pool-scoped)
        recent_support: recentSupport ? {
          id:         recentSupport.id,
          ticket_id:  recentSupport.ticket_id,
          state:      recentSupport.state,
          actor_role: recentSupport.actor_role,
          created_at: recentSupport.created_at,
          updated_at: recentSupport.updated_at,
        } : null,
      });
    } catch (e: any) {
      console.error("[control-center] summary 오류:", e?.message);
      res.status(500).json({ error: "SUMMARY_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/members
router.get(
  "/super/pools/:id/control-center/members",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const rawLimit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 100);
    const rawOffset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);
    const { q = "", status = "" } = req.query as Record<string, string>;
    try {
      const rows = await superAdminDb.execute(sql`
        SELECT s.id, s.name, s.status, s.phone,
               s.created_at, s.updated_at,
               s.current_level_order,
               cg.id AS class_id, cg.name AS class_name,
               u.name AS teacher_name,
               (SELECT COUNT(*) FROM parent_students ps
                  JOIN parent_accounts pa ON ps.parent_account_id = pa.id
                  WHERE ps.student_id = s.id AND pa.approved_at IS NOT NULL) AS parent_count,
               (SELECT MAX(created_at) FROM diary_entries WHERE student_id = s.id) AS last_diary_at
        FROM students s
        LEFT JOIN class_group_students cgs ON cgs.student_id = s.id
        LEFT JOIN class_groups cg ON cg.id = cgs.class_group_id AND cg.active = true
        LEFT JOIN users u ON u.id = cg.teacher_id
        WHERE s.swimming_pool_id = ${poolId}
          AND (${q} = '' OR s.name ILIKE ${'%' + q + '%'} OR s.phone ILIKE ${'%' + q + '%'} OR s.id ILIKE ${'%' + q + '%'})
          AND (${status} = '' OR s.status = ${status})
        ORDER BY s.status ASC, s.name ASC
        LIMIT ${rawLimit} OFFSET ${rawOffset}
      `);
      const total = await superAdminDb.execute(sql`
        SELECT COUNT(*) AS cnt FROM students
        WHERE swimming_pool_id = ${poolId}
          AND (${q} = '' OR name ILIKE ${'%' + q + '%'})
          AND (${status} = '' OR status = ${status})
      `);
      res.json({ members: rows.rows, total: Number((total.rows[0] as any).cnt) });
    } catch (e: any) {
      res.status(500).json({ error: "MEMBERS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/members/:memberId — Member detail (pool-scoped)
router.get(
  "/super/pools/:id/control-center/members/:memberId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, memberId } = req.params;
    try {
      // 1. Identity (pool-scoped: both swimming_pool_id AND id must match)
      const memberRes = await superAdminDb.execute(sql`
        SELECT s.id, s.name, s.status, s.phone, s.current_level_order,
               s.created_at, s.updated_at
        FROM students s
        WHERE s.swimming_pool_id = ${poolId} AND s.id = ${memberId}
        LIMIT 1
      `);
      if (!memberRes.rows.length) { res.status(404).json({ error: "MEMBER_NOT_FOUND" }); return; }
      const member = memberRes.rows[0] as any;

      const levelOrder = member.current_level_order;
      const [levelRes, classRes, parentRes, diaryRes, notifRes, errorRes] = await Promise.all([
        // Level name
        levelOrder !== null && levelOrder !== undefined
          ? superAdminDb.execute(sql`
              SELECT level_order, level_name FROM pool_levels
              WHERE pool_id = ${poolId} AND level_order = ${levelOrder}
              LIMIT 1
            `).catch(() => ({ rows: [] }))
          : Promise.resolve({ rows: [] }),
        // Current class + teacher
        superAdminDb.execute(sql`
          SELECT cg.id, cg.name AS class_name, cg.active,
                 u.id AS teacher_id, u.name AS teacher_name, u.email AS teacher_email
          FROM class_group_students cgs
          JOIN class_groups cg ON cg.id = cgs.class_group_id
          LEFT JOIN users u ON u.id = cg.teacher_id
          WHERE cgs.student_id = ${memberId} AND cg.swimming_pool_id = ${poolId}
          ORDER BY cg.active DESC, cg.name ASC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Linked parents (pool-scoped via students.swimming_pool_id)
        superAdminDb.execute(sql`
          SELECT pa.id, pa.name, pa.phone, pa.approved_at, pa.last_login_at,
                 ps.created_at AS linked_at
          FROM parent_students ps
          JOIN parent_accounts pa ON pa.id = ps.parent_account_id
          WHERE ps.student_id = ${memberId} AND pa.swimming_pool_id = ${poolId}
          ORDER BY pa.approved_at DESC NULLS LAST
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        // Recent diaries (5)
        superAdminDb.execute(sql`
          SELECT id, created_at, title, ai_generated
          FROM diary_entries
          WHERE student_id = ${memberId}
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Recent notifications (5) — by ref_id (student) or pool
        superAdminDb.execute(sql`
          SELECT id, type, title, body, is_read, created_at
          FROM notifications
          WHERE pool_id = ${poolId}
            AND (ref_id = ${memberId} OR ref_type = 'student')
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Recent errors (5) from event_logs — by pool + actor_id or metadata reference
        superAdminDb.execute(sql`
          SELECT id, category, description, level, created_at, actor_id
          FROM event_logs
          WHERE pool_id = ${poolId}
            AND actor_id = ${memberId}
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);

      const levelRow = (levelRes.rows[0] as any) ?? null;
      res.json({
        identity: {
          ...member,
          level_name: levelRow?.level_name ?? null,
        },
        classes: classRes.rows,
        parents: parentRes.rows,
        recent_diaries: diaryRes.rows,
        recent_notifications: notifRes.rows,
        recent_errors: errorRes.rows,
      });
    } catch (e: any) {
      console.error("[super] member detail 오류:", e?.message);
      res.status(500).json({ error: "MEMBER_DETAIL_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/teachers
router.get(
  "/super/pools/:id/control-center/teachers",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { q = "" } = req.query as Record<string, string>;
    try {
      const rows = await superAdminDb.execute(sql`
        SELECT u.id, u.name, u.email, u.phone, u.role::text AS role,
               u.created_at, u.last_login_at,
               (SELECT COUNT(*) FROM class_groups cg
                WHERE cg.teacher_id = u.id AND cg.swimming_pool_id = ${poolId} AND cg.active = true
               ) AS active_class_count,
               (SELECT COUNT(*) FROM ai_traces at2
                WHERE at2.pool_id = ${poolId} AND at2.actor_id = u.id
                  AND at2.created_at > NOW() - INTERVAL '30 days'
               ) AS recent_ai_count
        FROM users u
        WHERE u.swimming_pool_id = ${poolId}
          AND u.role IN ('pool_admin', 'teacher')
          AND (${q} = '' OR u.name ILIKE ${'%' + q + '%'} OR u.email ILIKE ${'%' + q + '%'} OR u.id ILIKE ${'%' + q + '%'})
        ORDER BY u.role ASC, u.name ASC
      `);
      res.json({ teachers: rows.rows });
    } catch (e: any) {
      res.status(500).json({ error: "TEACHERS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/teachers/:teacherId — Teacher detail (pool-scoped)
router.get(
  "/super/pools/:id/control-center/teachers/:teacherId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, teacherId } = req.params;
    try {
      const teacherRes = await superAdminDb.execute(sql`
        SELECT id, name, email, phone, role::text AS role, created_at, last_login_at, updated_at
        FROM users
        WHERE swimming_pool_id = ${poolId} AND id = ${teacherId}
          AND role IN ('pool_admin', 'teacher')
        LIMIT 1
      `);
      if (!teacherRes.rows.length) { res.status(404).json({ error: "TEACHER_NOT_FOUND" }); return; }
      const teacher = teacherRes.rows[0];

      const [classRes, aiRes, errorRes, notifRes] = await Promise.all([
        // Assigned classes (pool-scoped)
        superAdminDb.execute(sql`
          SELECT cg.id, cg.name, cg.active, cg.created_at,
                 (SELECT COUNT(*) FROM class_group_students cgs WHERE cgs.class_group_id = cg.id) AS student_count
          FROM class_groups cg
          WHERE cg.teacher_id = ${teacherId} AND cg.swimming_pool_id = ${poolId}
          ORDER BY cg.active DESC, cg.name ASC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        // Recent AI diary traces (30d)
        superAdminDb.execute(sql`
          SELECT id, feature, status, llm_model, total_tokens, latency_ms, created_at
          FROM ai_traces
          WHERE pool_id = ${poolId} AND actor_id = ${teacherId}
          ORDER BY created_at DESC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        // Recent errors from event_logs (by actor_id + pool)
        superAdminDb.execute(sql`
          SELECT id, category, description, level, created_at
          FROM event_logs
          WHERE pool_id = ${poolId} AND actor_id = ${teacherId}
            AND level IN ('error', 'critical')
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Recent notifications sent by/to this pool for this teacher (actor reference)
        superAdminDb.execute(sql`
          SELECT id, type, title, is_read, created_at
          FROM notifications
          WHERE pool_id = ${poolId} AND recipient_id = ${teacherId}
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);

      res.json({
        identity: teacher,
        classes: classRes.rows,
        recent_ai_traces: aiRes.rows,
        recent_errors: errorRes.rows,
        recent_notifications: notifRes.rows,
      });
    } catch (e: any) {
      console.error("[super] teacher detail 오류:", e?.message);
      res.status(500).json({ error: "TEACHER_DETAIL_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/parents
router.get(
  "/super/pools/:id/control-center/parents",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const rawLimit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 100);
    const rawOffset = Math.max(parseInt((req.query.offset as string) ?? "0", 10), 0);
    const { q = "" } = req.query as Record<string, string>;
    try {
      const rows = await superAdminDb.execute(sql`
        SELECT pa.id, pa.name, pa.phone, pa.created_at, pa.approved_at,
               pa.last_login_at,
               (SELECT COUNT(*) FROM parent_students ps WHERE ps.parent_account_id = pa.id) AS linked_student_count
        FROM parent_accounts pa
        WHERE pa.swimming_pool_id = ${poolId}
          AND (${q} = '' OR pa.name ILIKE ${'%' + q + '%'} OR pa.phone ILIKE ${'%' + q + '%'})
        ORDER BY pa.created_at DESC
        LIMIT ${rawLimit} OFFSET ${rawOffset}
      `);
      const total = await superAdminDb.execute(sql`
        SELECT COUNT(*) AS cnt FROM parent_accounts
        WHERE swimming_pool_id = ${poolId}
          AND (${q} = '' OR name ILIKE ${'%' + q + '%'})
      `);
      res.json({ parents: rows.rows, total: Number((total.rows[0] as any).cnt) });
    } catch (e: any) {
      res.status(500).json({ error: "PARENTS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/parents/:parentId — Parent detail (pool-scoped)
router.get(
  "/super/pools/:id/control-center/parents/:parentId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, parentId } = req.params;
    try {
      const parentRes = await superAdminDb.execute(sql`
        SELECT id, name, phone, created_at, approved_at, last_login_at
        FROM parent_accounts
        WHERE swimming_pool_id = ${poolId} AND id = ${parentId}
        LIMIT 1
      `);
      if (!parentRes.rows.length) { res.status(404).json({ error: "PARENT_NOT_FOUND" }); return; }

      const [childrenRes, notifRes, errorRes] = await Promise.all([
        // Linked students (pool-scoped)
        superAdminDb.execute(sql`
          SELECT s.id, s.name, s.status, s.current_level_order,
                 ps.created_at AS linked_at,
                 cg.name AS class_name
          FROM parent_students ps
          JOIN students s ON s.id = ps.student_id
          LEFT JOIN class_group_students cgs ON cgs.student_id = s.id
          LEFT JOIN class_groups cg ON cg.id = cgs.class_group_id AND cg.active = true
          WHERE ps.parent_account_id = ${parentId}
            AND s.swimming_pool_id = ${poolId}
          ORDER BY s.status ASC, s.name ASC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        // Recent notifications
        superAdminDb.execute(sql`
          SELECT id, type, title, body, is_read, created_at
          FROM notifications
          WHERE pool_id = ${poolId}
            AND (recipient_id = ${parentId} OR ref_type = 'parent_account')
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Recent errors (by actor_id)
        superAdminDb.execute(sql`
          SELECT id, category, description, level, created_at
          FROM event_logs
          WHERE pool_id = ${poolId} AND actor_id = ${parentId}
            AND level IN ('error', 'critical')
          ORDER BY created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);

      res.json({
        identity: parentRes.rows[0],
        children: childrenRes.rows,
        recent_notifications: notifRes.rows,
        recent_errors: errorRes.rows,
        // Connection diagnostics
        connection_states: {
          total_linked: childrenRes.rows.length,
          approved_at: (parentRes.rows[0] as any).approved_at,
          approved: !!(parentRes.rows[0] as any).approved_at,
        },
      });
    } catch (e: any) {
      console.error("[super] parent detail 오류:", e?.message);
      res.status(500).json({ error: "PARENT_DETAIL_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/classes
router.get(
  "/super/pools/:id/control-center/classes",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const rawLimit = Math.min(parseInt((req.query.limit as string) ?? "100", 10), 200);
    const { q = "" } = req.query as Record<string, string>;
    try {
      const rows = await superAdminDb.execute(sql`
        SELECT cg.id, cg.name, cg.active, cg.created_at, cg.updated_at,
               u.id AS teacher_id, u.name AS teacher_name,
               (SELECT COUNT(*) FROM class_group_students cgs WHERE cgs.class_group_id = cg.id) AS student_count
        FROM class_groups cg
        LEFT JOIN users u ON u.id = cg.teacher_id
        WHERE cg.swimming_pool_id = ${poolId}
          AND (${q} = '' OR cg.name ILIKE ${'%' + q + '%'})
        ORDER BY cg.active DESC, cg.name ASC
        LIMIT ${rawLimit}
      `);
      res.json({ classes: rows.rows });
    } catch (e: any) {
      res.status(500).json({ error: "CLASSES_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/classes/:classId — Class detail (pool-scoped)
router.get(
  "/super/pools/:id/control-center/classes/:classId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, classId } = req.params;
    try {
      const classRes = await superAdminDb.execute(sql`
        SELECT cg.id, cg.name, cg.active, cg.created_at, cg.updated_at,
               u.id AS teacher_id, u.name AS teacher_name, u.email AS teacher_email
        FROM class_groups cg
        LEFT JOIN users u ON u.id = cg.teacher_id
        WHERE cg.swimming_pool_id = ${poolId} AND cg.id = ${classId}
        LIMIT 1
      `);
      if (!classRes.rows.length) { res.status(404).json({ error: "CLASS_NOT_FOUND" }); return; }

      const [studentsRes, diaryRes, scheduleRes, curriculumRes] = await Promise.all([
        // Students in this class
        superAdminDb.execute(sql`
          SELECT s.id, s.name, s.status, s.current_level_order,
                 cgs.created_at AS joined_at
          FROM class_group_students cgs
          JOIN students s ON s.id = cgs.student_id
          WHERE cgs.class_group_id = ${classId}
            AND s.swimming_pool_id = ${poolId}
          ORDER BY s.status ASC, s.name ASC
          LIMIT 100
        `).catch(() => ({ rows: [] })),
        // Recent diary entries in this class
        superAdminDb.execute(sql`
          SELECT de.id, de.student_id, s.name AS student_name, de.created_at, de.ai_generated
          FROM diary_entries de
          JOIN students s ON s.id = de.student_id
          WHERE de.class_group_id = ${classId}
          ORDER BY de.created_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Schedules (if class_schedules exists)
        superAdminDb.execute(sql`
          SELECT id, day_of_week, start_time, end_time, room
          FROM class_schedules
          WHERE class_group_id = ${classId}
          ORDER BY day_of_week ASC, start_time ASC
          LIMIT 10
        `).catch(() => ({ rows: [] })),
        // Curriculum assignment (if x_curriculum_class_assignments exists)
        superAdminDb.execute(sql`
          SELECT xca.id, xca.class_group_id,
                 xp.package_name, xp.package_version, xp.status AS package_status
          FROM x_curriculum_class_assignments xca
          JOIN x_curriculum_packages xp ON xp.id = xca.package_id
          WHERE xca.class_group_id = ${classId}
            AND xca.swimming_pool_id = ${poolId}
          ORDER BY xp.generated_at DESC
          LIMIT 1
        `).catch(() => ({ rows: [] })),
      ]);

      res.json({
        identity: classRes.rows[0],
        students: studentsRes.rows,
        recent_diaries: diaryRes.rows,
        schedules: scheduleRes.rows,
        curriculum: curriculumRes.rows[0] ?? null,
      });
    } catch (e: any) {
      console.error("[super] class detail 오류:", e?.message);
      res.status(500).json({ error: "CLASS_DETAIL_FAILED", message: e?.message });
    }
  },
);

// ──────────────────────────────────────────────────────────────────
// R2 signed URL helper (shared, no raw key returned to client)
// ──────────────────────────────────────────────────────────────────
// CF_ACCOUNT_ID matches objectStorage.ts (photo client) — curriculum files use photo bucket
const _CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID  ?? "53dff4976d55c17ec94ebe6306d0cffc";
const _PHOTO_BUCKET   = process.env.CF_R2_BUCKET_NAME ?? "swimnotepicture";
const _R2_ENDPOINT    = `https://${_CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

async function generateR2SignedUrl(r2Key: string, expiresIn = 300): Promise<string> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const r2 = new S3Client({
    region: "auto",
    endpoint: _R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  });
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: _PHOTO_BUCKET, Key: r2Key }),
    { expiresIn },
  );
}

// ──────────────────────────────────────────────────────────────────
// GET /super/pools/:id/control-center/curriculum
// Sources: x_setup_submissions (status), x_setup_files (files+versions),
//          x_packaged_profiles (packages), x_curriculum_class_assignments (assignment agg)
// ──────────────────────────────────────────────────────────────────
router.get(
  "/super/pools/:id/control-center/curriculum",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    try {
      const [submissionRes, filesRes, packagesRes, assignRes] = await Promise.all([
        // Submission state (1:1 per pool — pool_id column in this table)
        superAdminDb.execute(sql`
          SELECT id, pool_id, setup_status, curriculum_status, website_status,
                 logo_status, photos_status, submitted_at, submitted_by,
                 created_at, updated_at
          FROM x_setup_submissions
          WHERE pool_id = ${poolId}
          LIMIT 1
        `).catch(() => ({ rows: [] })),
        // File version history (curriculum + website types only)
        superAdminDb.execute(sql`
          SELECT id, pool_id, file_type, original_filename, mime_type,
                 file_size_bytes, submission_version, is_current,
                 template_version, uploaded_by, uploaded_at, deleted_at
          FROM x_setup_files
          WHERE pool_id = ${poolId}
            AND file_type IN ('curriculum', 'website')
            AND deleted_at IS NULL
          ORDER BY uploaded_at DESC
          LIMIT 20
        `).catch(() => ({ rows: [] })),
        // Packages (x_packaged_profiles)
        superAdminDb.execute(sql`
          SELECT id, package_version, package_name, generated_at, source_submission_version
          FROM x_packaged_profiles
          WHERE pool_id = ${poolId}
          ORDER BY generated_at DESC
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Assignment aggregate: classes assigned + student count
        superAdminDb.execute(sql`
          SELECT COUNT(DISTINCT xca.class_group_id) AS assigned_class_count,
                 COALESCE(SUM(cgs_cnt.student_count), 0) AS assigned_student_count
          FROM x_curriculum_class_assignments xca
          JOIN x_curriculum_packages xp ON xp.id = xca.package_id
          LEFT JOIN (
            SELECT class_group_id, COUNT(*) AS student_count
            FROM class_group_students
            GROUP BY class_group_id
          ) cgs_cnt ON cgs_cnt.class_group_id = xca.class_group_id
          WHERE xca.swimming_pool_id = ${poolId}
        `).catch(() => ({ rows: [] })),
      ]);

      const submission = submissionRes.rows[0] as any ?? null;
      const files      = filesRes.rows as any[];
      const packages   = packagesRes.rows as any[];
      const assign     = (assignRes.rows[0] as any) ?? { assigned_class_count: 0, assigned_student_count: 0 };

      // Derive active/current versions per file_type
      const currentFiles: Record<string, any> = {};
      for (const f of files) {
        if (f.is_current && !currentFiles[f.file_type]) {
          currentFiles[f.file_type] = f;
        }
      }

      // Normalized UI status from curriculum_status field
      const normalizeStatus = (raw: string | null | undefined): string => {
        if (!raw) return "NOT_SUBMITTED";
        if (["APPROVED", "READY"].includes(raw)) return "ACTIVE";
        if (raw === "SUBMITTED" || raw === "UNDER_REVIEW") return "PROCESSING";
        if (raw === "REVISION_REQUESTED") return "REVISION_REQUESTED";
        if (raw === "IN_PROGRESS") return "UPLOADED";
        return raw; // preserve original if unknown
      };

      res.json({
        submission: submission ? {
          id:                 submission.id,
          setup_status:       submission.setup_status,
          curriculum_status:  submission.curriculum_status,
          website_status:     submission.website_status,
          curriculum_ui_status: normalizeStatus(submission.curriculum_status),
          submitted_at:       submission.submitted_at,
          updated_at:         submission.updated_at,
        } : null,
        files,
        current_files: currentFiles, // { curriculum: file, website: file }
        packages,
        assignment: {
          assigned_class_count:   Number(assign.assigned_class_count   ?? 0),
          assigned_student_count: Number(assign.assigned_student_count ?? 0),
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: "CURRICULUM_FAILED", message: e?.message });
    }
  },
);

// ──────────────────────────────────────────────────────────────────
// GET /super/pools/:id/control-center/curriculum/download
// Security: client provides file_id only (x_setup_files.id)
//           server resolves r2_key from DB — no client-supplied key
//           audit log written on success
// ──────────────────────────────────────────────────────────────────
router.get(
  "/super/pools/:id/control-center/curriculum/download",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { file_id } = req.query as Record<string, string>;
    if (!file_id) {
      res.status(400).json({ error: "MISSING_PARAMS", message: "file_id 필요" });
      return;
    }
    try {
      // 1. Resolve file record — pool-scoped, no client-supplied key
      const fileRes = await superAdminDb.execute(sql`
        SELECT id, pool_id, file_type, r2_key, original_filename, mime_type, file_size_bytes,
               submission_version, is_current, deleted_at
        FROM x_setup_files
        WHERE id = ${file_id} AND pool_id = ${poolId} AND deleted_at IS NULL
        LIMIT 1
      `);
      if (!fileRes.rows.length) {
        res.status(404).json({ error: "FILE_NOT_FOUND", message: "원본 파일을 찾을 수 없습니다." });
        return;
      }
      const file = fileRes.rows[0] as any;

      // 2. Guard: r2_key must exist
      if (!file.r2_key) {
        res.status(404).json({ error: "SOURCE_MISSING", message: "원본 파일을 찾을 수 없습니다." });
        return;
      }

      // 3. CRLF-safe filename for Content-Disposition (DB source only — §29)
      const safeFilename = (file.original_filename ?? "curriculum.docx")
        .replace(/[\r\n\t"\\]/g, "_")
        .replace(/[^\x20-\x7E가-힣]/g, "_")
        .trim() || "curriculum.docx";

      // 4. Generate signed URL (server-resolved r2_key — §28)
      const signedUrl = await generateR2SignedUrl(file.r2_key, 300);

      // 5. Audit log — CURRICULUM_SOURCE_DOWNLOAD (no signed URL, no r2_key stored — §11/§38)
      const actorName = (req.user as any)?.name ?? "슈퍼관리자";
      const logId = `evt_csd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db.execute(sql`
        INSERT INTO event_logs (id, pool_id, category, actor_id, actor_name, target, description, metadata)
        VALUES (
          ${logId}, ${poolId}, '커리큘럼',
          ${req.user!.userId}, ${actorName},
          ${file_id},
          ${`커리큘럼 원본 파일 다운로드: ${safeFilename} (v${file.submission_version})`},
          ${JSON.stringify({
            action:       "CURRICULUM_SOURCE_DOWNLOAD",
            file_type:    file.file_type,
            file_id:      file.id,
            filename:     safeFilename,
            version:      file.submission_version,
            is_current:   file.is_current,
            // r2_key and signed URL are NOT stored
          })}::jsonb
        )
      `).catch((err: any) => {
        console.error("[super] curriculum download audit 실패:", err?.message);
      });

      res.json({
        url:         signedUrl,
        expires_in:  300,
        filename:    safeFilename,
        mime_type:   file.mime_type ?? null,
        file_size_bytes: Number(file.file_size_bytes ?? 0),
        file_type:   file.file_type,
        version:     file.submission_version,
        is_current:  file.is_current,
      });
    } catch (e: any) {
      console.error("[super] curriculum download 오류:", e?.message);
      res.status(500).json({ error: "DOWNLOAD_FAILED", message: "다운로드 처리 중 오류가 발생했습니다." });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// WP5 — AI / GROWTH REPORT / JOB OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/** ISO month range helper — avoids LEFT(date,7) full-scan pattern */
function monthRange(yearMonth: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return null;
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01T00:00:00.000Z`;
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const to = `${nextMonth}-01T00:00:00.000Z`;
  return { from, to };
}

/** Clamp pagination params */
function clampPage(limitStr: string, offsetStr: string, max = 100) {
  return {
    lim: Math.min(Math.max(parseInt(limitStr) || 20, 1), max),
    off: Math.max(parseInt(offsetStr) || 0, 0),
  };
}

// GET /super/pools/:id/control-center/ai
// Monthly snapshot summary (x_monthly_operational_snapshots — real columns)
router.get(
  "/super/pools/:id/control-center/ai",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { month } = req.query as Record<string, string>;

    try {
      // 1. Monthly snapshot (up to 12 months; or single month if requested)
      const snapshots = await superAdminDb.execute(month
        ? sql`
          SELECT year, month,
                 ai_diary_count, ai_diary_teacher_count,
                 parent_curriculum_search_count, parent_curriculum_user_count,
                 growth_report_target_count, growth_report_generated_count,
                 growth_report_failed_count, growth_report_sent_count
          FROM x_monthly_operational_snapshots
          WHERE swimming_pool_id = ${poolId}
            AND year  = ${parseInt(month.slice(0, 4))}
            AND month = ${parseInt(month.slice(5, 7))}
          LIMIT 1
        `
        : sql`
          SELECT year, month,
                 ai_diary_count, ai_diary_teacher_count,
                 parent_curriculum_search_count, parent_curriculum_user_count,
                 growth_report_target_count, growth_report_generated_count,
                 growth_report_failed_count, growth_report_sent_count
          FROM x_monthly_operational_snapshots
          WHERE swimming_pool_id = ${poolId}
          ORDER BY year DESC, month DESC LIMIT 12
        `
      ).catch(() => ({ rows: [] }));

      // 2. Raw recount for selected/current month (snapshot consistency check)
      const now = new Date();
      const targetYear  = month ? parseInt(month.slice(0, 4)) : now.getUTCFullYear();
      const targetMonth = month ? parseInt(month.slice(5, 7)) : now.getUTCMonth() + 1;
      const ymStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;
      const range = monthRange(ymStr)!;

      const [rawDiary, rawCurriculum] = await Promise.all([
        // AI Diary raw recount from class_diaries
        superAdminDb.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE ai_generated = TRUE)                  AS ai_diary_count,
            COUNT(DISTINCT teacher_id) FILTER (WHERE ai_generated = TRUE) AS ai_diary_teacher_count
          FROM class_diaries
          WHERE swimming_pool_id = ${poolId}
            AND created_at >= ${range.from}::timestamptz
            AND created_at <  ${range.to}::timestamptz
            AND is_deleted  IS NOT TRUE
        `).catch(() => ({ rows: [{ ai_diary_count: null, ai_diary_teacher_count: null }] })),
        // Parent curriculum search recount from event_logs
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)             AS search_count,
            COUNT(DISTINCT actor_id) AS unique_parent_count
          FROM event_logs
          WHERE pool_id  = ${poolId}
            AND category = 'AI'
            AND metadata->>'feature' = 'parent_curriculum_search'
            AND created_at >= ${range.from}::timestamptz
            AND created_at <  ${range.to}::timestamptz
        `).catch(() => ({ rows: [{ search_count: null, unique_parent_count: null }] })),
      ]);

      res.json({
        snapshots: snapshots.rows,
        selected_month: ymStr,
        raw_recount: {
          month:  ymStr,
          ai_diary_count:           rawDiary.rows[0]?.ai_diary_count ?? null,
          ai_diary_teacher_count:   rawDiary.rows[0]?.ai_diary_teacher_count ?? null,
          curriculum_search_count:  rawCurriculum.rows[0]?.search_count ?? null,
          curriculum_unique_parents: rawCurriculum.rows[0]?.unique_parent_count ?? null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: "AI_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/ai/diary
// Recent AI Diary requests — class_diaries (ai_generated=true) + event_logs correlation
router.get(
  "/super/pools/:id/control-center/ai/diary",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "20", offset = "0", month } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 100);
    try {
      let rangeClause = sql``;
      if (month) {
        const range = monthRange(month);
        if (!range) return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
        rangeClause = sql`AND cd.created_at >= ${range.from}::timestamptz AND cd.created_at < ${range.to}::timestamptz`;
      }
      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            cd.id, cd.ai_trace_id AS request_id, cd.class_group_id,
            cd.teacher_id,
            u.name AS teacher_name,
            cg.name AS class_name,
            cd.created_at,
            el.metadata->>'status'     AS trace_status,
            el.metadata->>'model'      AS model,
            (el.metadata->>'latency_ms')::int AS latency_ms,
            (el.metadata->>'total_tokens')::int AS total_tokens,
            el.metadata->>'error_code' AS error_code,
            el.metadata->>'pool_mode'  AS pool_mode
          FROM class_diaries cd
          LEFT JOIN users         u  ON u.id  = cd.teacher_id
          LEFT JOIN class_groups  cg ON cg.id = cd.class_group_id
          LEFT JOIN event_logs    el
            ON  el.category    = 'AI'
            AND el.pool_id     = ${poolId}
            AND el.metadata->>'request_id' = cd.ai_trace_id
          WHERE cd.swimming_pool_id = ${poolId}
            AND cd.ai_generated = TRUE
            AND cd.is_deleted IS NOT TRUE
            ${rangeClause}
          ORDER BY cd.created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM class_diaries
          WHERE swimming_pool_id = ${poolId}
            AND ai_generated = TRUE
            AND is_deleted IS NOT TRUE
        `).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
      });
    } catch (e: any) {
      res.status(500).json({ error: "AI_DIARY_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/ai/curriculum
// Recent Parent Curriculum Search requests (event_logs, PII minimized)
router.get(
  "/super/pools/:id/control-center/ai/curriculum",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "20", offset = "0", month } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 100);
    try {
      let rangeClause = sql``;
      if (month) {
        const range = monthRange(month);
        if (!range) return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
        rangeClause = sql`AND el.created_at >= ${range.from}::timestamptz AND el.created_at < ${range.to}::timestamptz`;
      }
      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            el.id,
            el.actor_id,
            el.metadata->>'request_id'                 AS request_id,
            el.metadata->>'status'                     AS status,
            el.metadata->>'error_code'                 AS error_code,
            el.metadata->>'feature'                    AS feature,
            el.metadata->>'pool_mode'                  AS pool_mode,
            (el.metadata->>'total_tokens')::int        AS total_tokens,
            (el.metadata->>'latency_ms')::int          AS latency_ms,
            el.metadata->>'model'                      AS model,
            el.created_at
          FROM event_logs el
          WHERE el.pool_id  = ${poolId}
            AND el.category = 'AI'
            AND el.metadata->>'feature' = 'parent_curriculum_search'
            ${rangeClause}
          ORDER BY el.created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM event_logs
          WHERE pool_id = ${poolId}
            AND category = 'AI'
            AND metadata->>'feature' = 'parent_curriculum_search'
        `).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
        note: "query_text omitted for PII minimization",
      });
    } catch (e: any) {
      res.status(500).json({ error: "AI_CURRICULUM_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/ai/traces
// All AI traces for pool (event_logs category=AI, paginated)
router.get(
  "/super/pools/:id/control-center/ai/traces",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "20", offset = "0", feature = "", status = "", month } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 100);
    try {
      const conditions: import("drizzle-orm").SQL[] = [
        sql`pool_id  = ${poolId}`,
        sql`category = 'AI'`,
      ];
      if (feature) conditions.push(sql`metadata->>'feature' = ${feature}`);
      if (status)  conditions.push(sql`metadata->>'status'  = ${status}`);
      if (month) {
        const range = monthRange(month);
        if (!range) return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
        conditions.push(sql`created_at >= ${range.from}::timestamptz`);
        conditions.push(sql`created_at <  ${range.to}::timestamptz`);
      }
      const where = sql.join(conditions, sql` AND `);

      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            id, actor_id,
            metadata->>'request_id'       AS request_id,
            metadata->>'feature'          AS feature,
            metadata->>'status'           AS status,
            metadata->>'pool_mode'        AS pool_mode,
            metadata->>'generation_mode'  AS generation_mode,
            metadata->>'model'            AS model,
            (metadata->>'total_tokens')::int             AS total_tokens,
            (metadata->'cost'->>'total_cost_usd')::float AS total_cost_usd,
            (metadata->>'latency_ms')::int               AS latency_ms,
            metadata->>'error_stage'      AS error_stage,
            metadata->>'error_code'       AS error_code,
            created_at
          FROM event_logs
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`SELECT COUNT(*) AS total FROM event_logs WHERE ${where}`)
          .catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
      });
    } catch (e: any) {
      res.status(500).json({ error: "AI_TRACES_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/ai/search?request_id=...
// Exact request_id search across event_logs (AI category, pool-scoped)
router.get(
  "/super/pools/:id/control-center/ai/search",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { request_id } = req.query as Record<string, string>;
    if (!request_id?.trim()) {
      return res.status(400).json({ error: "MISSING_PARAM", message: "request_id is required" });
    }
    try {
      const [traceRes, diaryRes, reportRes] = await Promise.all([
        // AI trace (event_logs, exact index match via metadata->>'request_id')
        superAdminDb.execute(sql`
          SELECT
            id, actor_id,
            metadata->>'request_id'      AS request_id,
            metadata->>'feature'         AS feature,
            metadata->>'status'          AS status,
            metadata->>'model'           AS model,
            (metadata->>'total_tokens')::int AS total_tokens,
            (metadata->>'latency_ms')::int   AS latency_ms,
            metadata->>'error_code'      AS error_code,
            metadata->>'error_stage'     AS error_stage,
            metadata->>'pool_mode'       AS pool_mode,
            (metadata->'cost'->>'total_cost_usd')::float AS total_cost_usd,
            created_at
          FROM event_logs
          WHERE pool_id  = ${poolId}
            AND category = 'AI'
            AND metadata->>'request_id' = ${request_id.trim()}
          ORDER BY created_at DESC LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Correlated diary (ai_trace_id = request_id)
        superAdminDb.execute(sql`
          SELECT cd.id, cd.class_group_id, cd.teacher_id,
                 u.name AS teacher_name, cg.name AS class_name,
                 cd.created_at
          FROM class_diaries cd
          LEFT JOIN users        u  ON u.id  = cd.teacher_id
          LEFT JOIN class_groups cg ON cg.id = cd.class_group_id
          WHERE cd.swimming_pool_id = ${poolId}
            AND cd.ai_trace_id = ${request_id.trim()}
          LIMIT 5
        `).catch(() => ({ rows: [] })),
        // Correlated growth report (analysis_request_id = request_id)
        superAdminDb.execute(sql`
          SELECT gr.id, gr.student_id, gr.report_period, gr.product_status,
                 gr.analysis_status, gr.created_at,
                 s.name AS student_name
          FROM growth_reports gr
          LEFT JOIN students s ON s.id = gr.student_id
          WHERE gr.swimming_pool_id    = ${poolId}
            AND gr.analysis_request_id = ${request_id.trim()}
          LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);
      res.json({
        request_id:     request_id.trim(),
        traces:         traceRes.rows,
        linked_diaries: diaryRes.rows,
        linked_reports: reportRes.rows,
      });
    } catch (e: any) {
      res.status(500).json({ error: "AI_SEARCH_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/growth
// Growth Report monthly summary (snapshot + raw recount + auto-batch status)
router.get(
  "/super/pools/:id/control-center/growth",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { month } = req.query as Record<string, string>;
    const now = new Date();
    const targetYear  = month ? parseInt(month.slice(0, 4)) : now.getUTCFullYear();
    const targetMonth = month ? parseInt(month.slice(5, 7)) : now.getUTCMonth() + 1;
    const ymStr = `${targetYear}-${String(targetMonth).padStart(2, "0")}`;

    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
    }

    try {
      const [snapshot, rawCount, batchSummary] = await Promise.all([
        // Snapshot KPI
        superAdminDb.execute(sql`
          SELECT year, month,
                 growth_report_target_count,
                 growth_report_generated_count,
                 growth_report_failed_count,
                 growth_report_sent_count
          FROM x_monthly_operational_snapshots
          WHERE swimming_pool_id = ${poolId}
            AND year  = ${targetYear}
            AND month = ${targetMonth}
          LIMIT 1
        `).catch(() => ({ rows: [] })),
        // Raw logical report counts for the month
        // "logical" = per student per report_period (latest version only)
        superAdminDb.execute(sql`
          SELECT
            COUNT(*) FILTER (WHERE product_status NOT IN ('NOT_OPEN','OPEN'))  AS total_targeted,
            COUNT(*) FILTER (WHERE product_status IN ('APPROVED','PUBLISHED','PARTIAL'))
                                                                                AS generated_count,
            COUNT(*) FILTER (WHERE product_status = 'FAILED')                  AS failed_count,
            COUNT(*) FILTER (WHERE product_status = 'PUBLISHED')               AS published_count,
            COUNT(*) FILTER (WHERE admin_push_sent_at IS NOT NULL)             AS sent_count,
            COUNT(*) FILTER (WHERE discarded_at IS NOT NULL)                   AS discarded_count,
            COUNT(*) FILTER (WHERE product_status IN ('PREANALYZING','ANALYZING','REVIEW_REQUIRED'))
                                                                                AS in_progress_count
          FROM (
            SELECT DISTINCT ON (student_id, report_period)
              student_id, report_period, product_status, discarded_at,
              admin_push_sent_at
            FROM growth_reports
            WHERE swimming_pool_id = ${poolId}
              AND report_period    = ${ymStr}
              AND deleted_at IS NULL
            ORDER BY student_id, report_period, created_at DESC
          ) latest
        `).catch(() => ({ rows: [] })),
        // Batch jobs for the month
        superAdminDb.execute(sql`
          SELECT id, job_type, status, attempts, target_count,
                 completed_count, failed_count, created_at, updated_at,
                 locked_at, next_attempt_at,
                 CASE WHEN status = 'RUNNING'
                        AND locked_at < NOW() - INTERVAL '10 minutes'
                      THEN TRUE ELSE FALSE END AS is_stuck
          FROM growth_report_batch_jobs
          WHERE swimming_pool_id = ${poolId}
            AND year  = ${targetYear}
            AND month = ${targetMonth}
          ORDER BY created_at DESC LIMIT 10
        `).catch(() => ({ rows: [] })),
      ]);

      res.json({
        selected_month: ymStr,
        snapshot:       snapshot.rows[0] ?? null,
        raw_count:      rawCount.rows[0] ?? null,
        batch_jobs:     batchSummary.rows,
        auto_batch_enabled: process.env.GROWTH_REPORT_BATCH_AUTO_ENABLED === "true",
      });
    } catch (e: any) {
      res.status(500).json({ error: "GROWTH_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/growth/reports
// Growth report list — paginated, logical (latest version per student+period)
router.get(
  "/super/pools/:id/control-center/growth/reports",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "20", offset = "0", month, status } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 100);
    try {
      const conditions: import("drizzle-orm").SQL[] = [
        sql`gr.swimming_pool_id = ${poolId}`,
        sql`gr.deleted_at IS NULL`,
      ];
      if (month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
          return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
        conditions.push(sql`gr.report_period = ${month}`);
      }
      if (status) conditions.push(sql`gr.product_status = ${status}::gr_product_status_enum`);
      const where = sql.join(conditions, sql` AND `);

      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            gr.id, gr.student_id, gr.report_period,
            gr.product_status, gr.analysis_status,
            gr.analysis_retry_count, gr.teacher_reanalysis_count,
            gr.teacher_review_action, gr.teacher_review_reason_code,
            gr.cycle_id,
            gr.published_at, gr.discarded_at,
            gr.teacher_reviewed_at, gr.teacher_reviewed_by,
            gr.created_at, gr.updated_at,
            s.name AS student_name
          FROM growth_reports gr
          LEFT JOIN students s ON s.id = gr.student_id
          WHERE ${where}
          ORDER BY gr.report_period DESC, gr.created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM growth_reports gr WHERE ${where}
        `).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
      });
    } catch (e: any) {
      res.status(500).json({ error: "GROWTH_REPORTS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/growth/reports/:reportId
// Report detail + version history (all versions for same student+period)
router.get(
  "/super/pools/:id/control-center/growth/reports/:reportId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, reportId } = req.params;
    try {
      const [reportRes, cycleRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            gr.id, gr.student_id, gr.report_period,
            gr.product_status, gr.analysis_status, gr.analysis_request_id,
            gr.analysis_retry_count, gr.teacher_reanalysis_count,
            gr.teacher_review_action, gr.teacher_review_reason_code, gr.teacher_review_reason_code,
            gr.teacher_reviewed_by, gr.teacher_reviewed_at,
            gr.cycle_id, gr.report_type,
            gr.published_at, gr.discarded_at,
            gr.created_at, gr.updated_at, gr.deleted_at,
            s.name AS student_name
          FROM growth_reports gr
          LEFT JOIN students s ON s.id = gr.student_id
          WHERE gr.id = ${reportId}
            AND gr.swimming_pool_id = ${poolId}
        `).catch(() => ({ rows: [] })),
        // Batch jobs correlated by pool+period (approximate, no FK from report→job)
        superAdminDb.execute(sql`
          SELECT id, job_type, status, attempts, target_count, completed_count, failed_count,
                 locked_at, next_attempt_at, started_at, completed_at, created_at,
                 CASE WHEN status = 'RUNNING'
                        AND locked_at < NOW() - INTERVAL '10 minutes'
                      THEN TRUE ELSE FALSE END AS is_stuck
          FROM growth_report_batch_jobs
          WHERE swimming_pool_id = ${poolId}
          ORDER BY created_at DESC LIMIT 5
        `).catch(() => ({ rows: [] })),
      ]);

      if (reportRes.rows.length === 0) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Report not found in this pool" });
      }
      const report = reportRes.rows[0] as any;

      // Version history: all rows for same student_id + report_period
      const versions = await superAdminDb.execute(sql`
        SELECT id, product_status, analysis_status, created_at, published_at, discarded_at,
               analysis_retry_count, teacher_reanalysis_count, deleted_at
        FROM growth_reports
        WHERE swimming_pool_id = ${poolId}
          AND student_id       = ${report.student_id}
          AND report_period    = ${report.report_period}
        ORDER BY created_at ASC
      `).catch(() => ({ rows: [] }));

      // Cycle info if available
      let cycle = null;
      if (report.cycle_id) {
        const cycleRow = await superAdminDb.execute(sql`
          SELECT id, report_period, cycle_status, analysis_from, analysis_cutoff_at,
                 parent_input_open_at, parent_input_close_at, created_at, updated_at
          FROM growth_report_cycles
          WHERE id = ${report.cycle_id}
            AND swimming_pool_id = ${poolId}
        `).catch(() => ({ rows: [] }));
        cycle = cycleRow.rows[0] ?? null;
      }

      res.json({
        report,
        version_history: versions.rows,
        cycle,
        related_batch_jobs: cycleRes.rows,
        note: "report_content omitted; metadata/diagnostics only",
      });
    } catch (e: any) {
      res.status(500).json({ error: "GROWTH_REPORT_DETAIL_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/growth/batch-jobs
// Batch job list — paginated, actual columns
router.get(
  "/super/pools/:id/control-center/growth/batch-jobs",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "20", offset = "0", month } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 100);
    try {
      const conditions: import("drizzle-orm").SQL[] = [sql`swimming_pool_id = ${poolId}`];
      if (month) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
          return res.status(400).json({ error: "INVALID_MONTH", message: "month must be YYYY-MM" });
        conditions.push(sql`year  = ${parseInt(month.slice(0, 4))}`);
        conditions.push(sql`month = ${parseInt(month.slice(5, 7))}`);
      }
      const where = sql.join(conditions, sql` AND `);

      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            id, year, month, job_type, status,
            target_count, completed_count, failed_count,
            attempts, worker_id, locked_at, next_attempt_at,
            started_at, completed_at, admin_push_sent_at,
            created_at, updated_at,
            CASE WHEN status = 'RUNNING'
                   AND locked_at < NOW() - INTERVAL '10 minutes'
                 THEN TRUE ELSE FALSE END AS is_stuck
          FROM growth_report_batch_jobs
          WHERE ${where}
          ORDER BY year DESC, month DESC, created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM growth_report_batch_jobs WHERE ${where}
        `).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
        stuck_threshold_minutes: 10,
      });
    } catch (e: any) {
      res.status(500).json({ error: "BATCH_JOBS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/growth/cycles
// Growth report cycles — paginated
router.get(
  "/super/pools/:id/control-center/growth/cycles",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const { limit = "12", offset = "0" } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 50);
    try {
      const [rows, countRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT id, report_period, cycle_status,
                 analysis_from, analysis_cutoff_at,
                 parent_input_open_at, parent_input_close_at,
                 timezone, created_at, updated_at
          FROM growth_report_cycles
          WHERE swimming_pool_id = ${poolId}
          ORDER BY report_period DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM growth_report_cycles WHERE swimming_pool_id = ${poolId}
        `).catch(() => ({ rows: [{ total: 0 }] })),
      ]);
      res.json({
        rows: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit: lim, offset: off,
      });
    } catch (e: any) {
      res.status(500).json({ error: "CYCLES_FAILED", message: e?.message });
    }
  },
);

// Legacy route kept for backward compat — redirects to new growth summary
router.get(
  "/super/pools/:id/control-center/growth-reports",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    res.redirect(308, req.url.replace("/growth-reports", "/growth"));
  },
);

// ── WP6 helper: parse time-range filter ──────────────────────────────────────
function parseTimeRange(rangeStr: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (rangeStr) {
    case "24h": return { from: new Date(Date.now() - 86_400_000).toISOString(), to };
    case "7d":  return { from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to };
    case "30d": return { from: new Date(Date.now() - 30 * 86_400_000).toISOString(), to };
    default:    return { from: new Date(Date.now() - 7 * 86_400_000).toISOString(), to };
  }
}

// GET /super/pools/:id/control-center/errors
// WP6 REWRITE — real columns, multi-source, filters, summary
router.get(
  "/super/pools/:id/control-center/errors",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      limit = "50", offset = "0",
      range = "7d",        // 24h | 7d | 30d
      feature = "",        // OpErrorFeature filter
      level = "",          // ERROR | CRITICAL | WARNING
      category = "",       // event_logs category filter
      request_id = "",     // exact request_id search
      trace_id = "",       // exact trace_id search
    } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 200);
    const { from, to } = parseTimeRange(range);

    try {
      // ── 1. event_logs (operational errors + audit events with warning/error level) ──
      const evtConditions: import("drizzle-orm").SQL[] = [
        sql`pool_id = ${poolId}`,
        sql`created_at >= ${from}::timestamptz`,
        sql`created_at <  ${to}::timestamptz`,
      ];
      // Level filter: if WP6 columns exist → use level; also include 보안/AI/시스템 category events
      if (level) {
        evtConditions.push(sql`(level = ${level} OR (level IS NULL AND category IN ('보안','시스템')))`);
      } else {
        // Default: show WARNING/ERROR/CRITICAL + legacy security/system events
        evtConditions.push(sql`(level IN ('WARNING','ERROR','CRITICAL') OR (level IS NULL AND category IN ('보안')))`);
      }
      if (feature) evtConditions.push(sql`feature = ${feature}`);
      if (category) evtConditions.push(sql`category = ${category}`);
      if (request_id) evtConditions.push(sql`request_id = ${request_id.trim()}`);
      if (trace_id)   evtConditions.push(sql`trace_id = ${trace_id.trim()}`);
      const evtWhere = sql.join(evtConditions, sql` AND `);

      // ── 2. push_logs failures (pool-scoped if pool_id column exists) ──
      // WP6: push_logs.pool_id added via additive migration
      const pushFailed = superAdminDb.execute(sql`
        SELECT id, 'PUSH'::text AS source_type, pool_id,
               target_user_id AS actor_id, type AS feature_detail,
               status, message AS safe_message, NULL::text AS error_code,
               'ERROR'::text AS level, created_at
        FROM push_logs
        WHERE pool_id = ${poolId}
          AND status = 'failed'
          AND created_at >= ${from}::timestamptz
          AND created_at <  ${to}::timestamptz
        ORDER BY created_at DESC
        LIMIT 50
      `).catch(() => ({ rows: [] }));

      // ── 3. growth batch job failures ──
      const growthFailed = superAdminDb.execute(sql`
        SELECT id, 'JOB'::text AS source_type,
               swimming_pool_id AS pool_id,
               'GROWTH'::text AS feature_detail,
               status, 'GROWTH_JOB_FAILED'::text AS error_code,
               CONCAT('배치 잡 실패: ', job_type, ' (시도 ', attempts, '회)') AS safe_message,
               'ERROR'::text AS level,
               updated_at AS created_at
        FROM growth_report_batch_jobs
        WHERE swimming_pool_id = ${poolId}
          AND status = 'FAILED'
          AND updated_at >= ${from}::timestamptz
          AND updated_at <  ${to}::timestamptz
        ORDER BY updated_at DESC
        LIMIT 20
      `).catch(() => ({ rows: [] }));

      // ── 4. super_incidents (pool may be in affected_pool_ids) ──
      const incidents = superAdminDb.execute(sql`
        SELECT id, title, severity, status,
               created_at, resolved_at, description,
               service, request_id, trace_id,
               'INCIDENT'::text AS source_type
        FROM super_incidents
        WHERE ${poolId} = ANY(affected_pool_ids)
          AND created_at >= ${from}::timestamptz
          AND created_at <  ${to}::timestamptz
        ORDER BY created_at DESC LIMIT 10
      `).catch(() => ({ rows: [] }));

      // ── 5. Main event_logs query ──
      const [evtRows, evtCount, pushRes, growthRes, incidentRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT id, 'EVENT'::text AS source_type,
                 pool_id, category,
                 COALESCE(feature, category) AS feature_detail,
                 COALESCE(level, 'WARNING') AS level,
                 error_code, safe_message,
                 actor_id, target,
                 COALESCE(description, safe_message, '') AS display_message,
                 request_id, trace_id,
                 entity_type, entity_id,
                 metadata, created_at
          FROM event_logs
          WHERE ${evtWhere}
          ORDER BY created_at DESC
          LIMIT ${lim} OFFSET ${off}
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS total FROM event_logs WHERE ${evtWhere}
        `).catch(() => ({ rows: [{ total: 0 }] })),
        pushFailed,
        growthFailed,
        incidents,
      ]);

      // ── 6. Summary (24h + 7d counts by level) ──
      const summary24h = superAdminDb.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE level IN ('ERROR','CRITICAL') OR (level IS NULL AND category='보안')) AS error_count,
          COUNT(*) FILTER (WHERE level = 'WARNING') AS warning_count,
          COUNT(*) FILTER (WHERE level = 'CRITICAL') AS critical_count
        FROM event_logs
        WHERE pool_id = ${poolId}
          AND created_at >= NOW() - INTERVAL '24 hours'
          AND (level IN ('WARNING','ERROR','CRITICAL') OR (level IS NULL AND category = '보안'))
      `).catch(() => ({ rows: [{ error_count: 0, warning_count: 0, critical_count: 0 }] }));

      const summary7d = superAdminDb.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE level IN ('ERROR','CRITICAL') OR (level IS NULL AND category='보안')) AS error_count,
          COUNT(*) FILTER (WHERE level = 'WARNING') AS warning_count,
          COUNT(*) FILTER (WHERE level = 'CRITICAL') AS critical_count,
          feature,
          COUNT(*) AS feature_count
        FROM event_logs
        WHERE pool_id = ${poolId}
          AND created_at >= NOW() - INTERVAL '7 days'
          AND (level IN ('WARNING','ERROR','CRITICAL') OR (level IS NULL AND category = '보안'))
        GROUP BY feature
        ORDER BY feature_count DESC LIMIT 10
      `).catch(() => ({ rows: [] }));

      const [sum24hRes, sum7dRes] = await Promise.all([summary24h, summary7d]);

      res.json({
        // Paginated event_logs
        events:      evtRows.rows,
        total:       Number((evtCount.rows[0] as any)?.total ?? 0),
        limit:       lim, offset: off,
        // Supplementary sources
        push_failures:   pushRes.rows,
        growth_failures: growthRes.rows,
        incidents:       incidentRes.rows,
        // Filters applied
        applied_filters: { range, from, to, feature, level, category, request_id, trace_id },
        // Summary
        summary: {
          h24: sum24hRes.rows[0] ?? null,
          d7:  sum7dRes.rows,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: "ERRORS_FAILED", message: e?.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// WP7 — NOTIFICATION / PUSH DELIVERY DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

// push_logs.status enum: 'sent' | 'skipped' | 'failed'
// Canonical delivery states for Super Admin UI:
//   NOT_ATTEMPTED  — no push_logs row correlated (heuristic proximity search found nothing)
//   ACCEPTED_BY_PROVIDER — push_logs.status = 'sent'
//   FAILED         — push_logs.status = 'failed'
//   SKIPPED        — push_logs.status = 'skipped' (e.g. duplicate suppression)
// Correlation method: heuristic time-proximity (target_user_id + pool_id + ±60s window)
//   since push_logs does not store notification_id FK.
//   WP7 additive: notification_id / ref_id columns added to push_logs for future forward-linking.
//
// Push token privacy: raw token NEVER returned. Only has_push_token (bool) + token_updated_at.
// Push retry: NOT IMPLEMENTED in current codebase.

function normalizePushState(status: string | null | undefined): string {
  if (!status) return "NOT_ATTEMPTED";
  if (status === "sent") return "ACCEPTED_BY_PROVIDER";
  if (status === "failed") return "FAILED";
  if (status === "skipped") return "SKIPPED";
  return "UNKNOWN";
}

function safePushError(errorMsg: string | null | undefined): string | null {
  if (!errorMsg) return null;
  const m = (errorMsg ?? "").toLowerCase();
  if (m.includes("invalid") || m.includes("unregistered") || m.includes("devicenotregistered"))
    return "invalid_or_unregistered_token";
  if (m.includes("network") || m.includes("etimedout") || m.includes("econnrefused"))
    return "network_failure";
  if (m.includes("rate") || m.includes("429")) return "rate_limit";
  if (m.includes("payload") || m.includes("400")) return "payload_rejected";
  if (m.includes("500") || m.includes("502") || m.includes("503")) return "provider_api_error";
  return "unknown";
}

function notifTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    GROWTH_REPORT_PUBLISHED: "성장리포트 발행",
    GROWTH_REPORT_BATCH_READY: "성장리포트 일괄 완료",
    growth_report_like: "성장리포트 좋아요",
    growth_report_comment: "성장리포트 댓글",
    growth_report_comment_reply: "성장리포트 댓글 답글",
    diary_upload: "일지 업로드",
    photo_upload: "사진 업로드",
    photo_comment: "사진 댓글",
    diary_comment: "일지 댓글",
    storage_warning: "저장공간 경고",
    parent_request: "학부모 요청",
  };
  return labels[type] ?? type;
}

// GET /super/pools/:id/control-center/notifications
// WP7 REWRITE — push delivery diagnostics, recipient info, device status, filters, pagination
// N+1 prevention: single query with LATERAL JOINs for push_log and device token
router.get(
  "/super/pools/:id/control-center/notifications",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      limit = "50", offset = "0",
      period = "",           // 24h | 7d | 30d
      type = "",             // exact notification type
      role = "",             // parent | teacher | pool_admin | admin
      read_state = "",       // read | unread
      push_state = "",       // attempted | sent | failed | skipped | not_attempted
      q = "",                // search: recipient_id prefix or ref_id exact
    } = req.query as Record<string, string>;
    const { lim, off } = clampPage(limit, offset, 200);

    const { from, to } = period
      ? parseTimeRange(period)
      : { from: new Date(0).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    // WHERE conditions for outer query (applied after LATERAL JOINs)
    const whereConds: import("drizzle-orm").SQL[] = [
      sql`n.pool_id = ${poolId}`,
      sql`n.created_at >= ${from}::timestamptz`,
      sql`n.created_at <  ${to}::timestamptz`,
    ];
    if (type) whereConds.push(sql`n.type = ${type}`);
    if (role) whereConds.push(sql`n.recipient_type = ${role}`);
    if (read_state === "read") whereConds.push(sql`n.is_read = true`);
    if (read_state === "unread") whereConds.push(sql`n.is_read = false`);
    if (q) whereConds.push(sql`(n.recipient_id LIKE ${q + "%"} OR n.ref_id = ${q})`);
    const whereClause = sql.join(whereConds, sql` AND `);

    // push_state filter is applied as a HAVING-like condition after LATERAL JOIN
    // We use a subquery approach: wrap in CTE
    const pushStateFilter: import("drizzle-orm").SQL | null = (() => {
      if (!push_state || push_state === "all") return null;
      if (push_state === "not_attempted") return sql`push_corr_id IS NULL`;
      if (push_state === "attempted")     return sql`push_corr_id IS NOT NULL`;
      if (push_state === "sent")          return sql`push_corr_status = 'sent'`;
      if (push_state === "failed")        return sql`push_corr_status = 'failed'`;
      if (push_state === "skipped")       return sql`push_corr_status = 'skipped'`;
      return null;
    })();

    try {
      // ── Main list query (N+1-free via LATERAL) ────────────────────────────
      const listSql = sql`
        WITH base AS (
          SELECT
            n.id, n.type, n.title, n.body, n.recipient_id, n.recipient_type,
            n.ref_id, n.ref_type, n.is_read, n.created_at, n.deep_link,
            COALESCE(u.name, pa.name) AS recipient_name,
            -- WP7: push correlation (heuristic: target_user_id + pool_id + ±60s window)
            -- Raw push token is NEVER included. has_push_token = bool only.
            push_corr.id     AS push_corr_id,
            push_corr.status AS push_corr_status,
            push_corr.created_at AS push_corr_at,
            push_corr.recipient_count AS push_corr_count,
            push_corr.error_message   AS push_corr_error,
            (device.has_token IS TRUE) AS has_push_token,
            device.token_updated_at
          FROM notifications n
          LEFT JOIN users u ON u.id = n.recipient_id
          LEFT JOIN parent_accounts pa ON pa.id = n.recipient_id
          LEFT JOIN LATERAL (
            SELECT pl.id, pl.status, pl.created_at, pl.recipient_count, pl.error_message
            FROM push_logs pl
            WHERE pl.pool_id = ${poolId}
              AND pl.target_user_id = n.recipient_id
              AND ABS(EXTRACT(EPOCH FROM (pl.created_at - n.created_at))) < 60
            ORDER BY ABS(EXTRACT(EPOCH FROM (pl.created_at - n.created_at)))
            LIMIT 1
          ) push_corr ON true
          LEFT JOIN LATERAL (
            SELECT TRUE AS has_token, updated_at AS token_updated_at
            FROM push_tokens
            WHERE user_id = n.recipient_id OR parent_account_id = n.recipient_id
            ORDER BY updated_at DESC
            LIMIT 1
          ) device ON true
          WHERE ${whereClause}
        )
        SELECT * FROM base
        ${pushStateFilter ? sql`WHERE ${pushStateFilter}` : sql``}
        ORDER BY created_at DESC
        LIMIT ${lim} OFFSET ${off}
      `;

      const countSql = sql`
        WITH base AS (
          SELECT
            n.id,
            push_corr.id     AS push_corr_id,
            push_corr.status AS push_corr_status
          FROM notifications n
          LEFT JOIN LATERAL (
            SELECT pl.id, pl.status
            FROM push_logs pl
            WHERE pl.pool_id = ${poolId}
              AND pl.target_user_id = n.recipient_id
              AND ABS(EXTRACT(EPOCH FROM (pl.created_at - n.created_at))) < 60
            ORDER BY ABS(EXTRACT(EPOCH FROM (pl.created_at - n.created_at)))
            LIMIT 1
          ) push_corr ON true
          WHERE ${whereClause}
        )
        SELECT COUNT(*) AS cnt FROM base
        ${pushStateFilter ? sql`WHERE ${pushStateFilter}` : sql``}
      `;

      // ── Summary (24h, unread, push stats) — from notifications + push_logs ──
      const now24h = new Date(Date.now() - 86400000).toISOString();
      const summarySql = superAdminDb.execute(sql`
        SELECT
          COUNT(*)                                                         AS notif_24h,
          COUNT(*) FILTER (WHERE is_read = false)                         AS unread_total,
          COUNT(*) FILTER (WHERE created_at >= ${now24h}::timestamptz AND is_read = false) AS unread_24h
        FROM notifications
        WHERE pool_id = ${poolId}
      `).catch(() => ({ rows: [{ notif_24h: 0, unread_total: 0, unread_24h: 0 }] }));

      const pushSummarySql = superAdminDb.execute(sql`
        SELECT
          COUNT(*)                                               AS push_attempted_24h,
          COUNT(*) FILTER (WHERE status = 'failed')             AS push_failed_24h,
          COUNT(*) FILTER (WHERE status = 'sent')               AS push_sent_24h
        FROM push_logs
        WHERE pool_id = ${poolId}
          AND created_at >= ${now24h}::timestamptz
      `).catch(() => ({ rows: [{ push_attempted_24h: 0, push_failed_24h: 0, push_sent_24h: 0 }] }));

      const [listRes, countRes, summaryRes, pushSummRes] = await Promise.all([
        superAdminDb.execute(listSql),
        superAdminDb.execute(countSql),
        summarySql,
        pushSummarySql,
      ]);

      const notifications = listRes.rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        type_label: notifTypeLabel(r.type),
        title: r.title,
        recipient_id: r.recipient_id,
        recipient_type: r.recipient_type,
        recipient_name: r.recipient_name ?? null,
        ref_id: r.ref_id,
        ref_type: r.ref_type,
        is_read: r.is_read,
        created_at: r.created_at,
        deep_link: r.deep_link,
        // Push delivery diagnostic — state derived from heuristic correlation
        push_state: normalizePushState(r.push_corr_status),
        push_log_id: r.push_corr_id ?? null,
        push_attempted_at: r.push_corr_at ?? null,
        push_recipient_count: r.push_corr_count ?? null,
        push_safe_error: safePushError(r.push_corr_error),
        push_correlation: r.push_corr_id ? "heuristic_time_proximity" : "none",
        // Device — token existence only (raw token NEVER returned per §27)
        has_push_token: r.has_push_token === true || r.has_push_token === "true",
        token_updated_at: r.token_updated_at ?? null,
      }));

      const s0 = (summaryRes.rows[0] as any) ?? {};
      const p0 = (pushSummRes.rows[0] as any) ?? {};

      res.json({
        notifications,
        total: Number((countRes.rows[0] as any)?.cnt ?? 0),
        summary: {
          notif_24h:        Number(s0.notif_24h ?? 0),
          unread_total:     Number(s0.unread_total ?? 0),
          unread_24h:       Number(s0.unread_24h ?? 0),
          push_attempted_24h: Number(p0.push_attempted_24h ?? 0),
          push_failed_24h:    Number(p0.push_failed_24h ?? 0),
          push_sent_24h:      Number(p0.push_sent_24h ?? 0),
        },
        // Diagnostic metadata
        push_retry: "NOT_IMPLEMENTED",
        push_correlation_method: "heuristic_time_proximity",
        token_platform: "UNKNOWN",  // push_tokens has no platform column
      });
    } catch (e: any) {
      res.status(500).json({ error: "NOTIFICATIONS_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/notifications/summary
// WP7: KPI-only endpoint for fast top-bar stats
router.get(
  "/super/pools/:id/control-center/notifications/summary",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const now24h = new Date(Date.now() - 86400000).toISOString();
    try {
      const [notifSumm, pushSumm] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)                                                          AS notif_total,
            COUNT(*) FILTER (WHERE created_at >= ${now24h}::timestamptz)     AS notif_24h,
            COUNT(*) FILTER (WHERE is_read = false)                          AS unread_total,
            COUNT(*) FILTER (WHERE is_read = false AND created_at >= ${now24h}::timestamptz) AS unread_24h
          FROM notifications WHERE pool_id = ${poolId}
        `),
        superAdminDb.execute(sql`
          SELECT
            COUNT(*)                                               AS push_attempted_24h,
            COUNT(*) FILTER (WHERE status = 'sent')               AS push_sent_24h,
            COUNT(*) FILTER (WHERE status = 'failed')             AS push_failed_24h,
            COUNT(*) FILTER (WHERE status = 'skipped')            AS push_skipped_24h
          FROM push_logs
          WHERE pool_id = ${poolId}
            AND created_at >= ${now24h}::timestamptz
        `).catch(() => ({ rows: [{}] })),
      ]);
      const n = (notifSumm.rows[0] as any) ?? {};
      const p = (pushSumm.rows[0] as any) ?? {};
      res.json({
        notif_total:       Number(n.notif_total ?? 0),
        notif_24h:         Number(n.notif_24h ?? 0),
        unread_total:      Number(n.unread_total ?? 0),
        unread_24h:        Number(n.unread_24h ?? 0),
        push_attempted_24h: Number(p.push_attempted_24h ?? 0),
        push_sent_24h:      Number(p.push_sent_24h ?? 0),
        push_failed_24h:    Number(p.push_failed_24h ?? 0),
        push_skipped_24h:   Number(p.push_skipped_24h ?? 0),
        push_retry:        "NOT_IMPLEMENTED",
        token_platform:    "UNKNOWN",
      });
    } catch (e: any) {
      res.status(500).json({ error: "NOTIFICATIONS_SUMMARY_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/notifications/:notifId
// WP7: per-notification detail with full push diagnostic, recipient, related entity
// Cross-pool guard: notif.pool_id must match :id
router.get(
  "/super/pools/:id/control-center/notifications/:notifId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, notifId } = req.params;
    try {
      // 1. Notification row — verify pool scope (cross-pool guard §36)
      const notifRes = await superAdminDb.execute(sql`
        SELECT id, type, title, body, recipient_id, recipient_type,
               ref_id, ref_type, pool_id, is_read, created_at, deep_link
        FROM notifications
        WHERE id = ${notifId} AND pool_id = ${poolId}
        LIMIT 1
      `);
      if (!notifRes.rows.length) {
        res.status(404).json({ error: "NOTIFICATION_NOT_FOUND" });
        return;
      }
      const n = notifRes.rows[0] as any;

      // 2. Recipient info + device token (token existence only — no raw token per §27)
      const [recipientRes, deviceRes] = await Promise.all([
        superAdminDb.execute(sql`
          SELECT id, name, role, phone, email
          FROM users WHERE id = ${n.recipient_id} LIMIT 1
        `).catch(() => ({ rows: [] })),
        superAdminDb.execute(sql`
          SELECT updated_at FROM push_tokens
          WHERE user_id = ${n.recipient_id} OR parent_account_id = ${n.recipient_id}
          ORDER BY updated_at DESC LIMIT 1
        `).catch(() => ({ rows: [] })),
      ]);

      // Try parent_accounts if not found in users
      let recipientRow = (recipientRes.rows[0] as any) ?? null;
      if (!recipientRow) {
        const paRes = await superAdminDb.execute(sql`
          SELECT id, name, 'parent_account'::text AS role, phone, null AS email
          FROM parent_accounts WHERE id = ${n.recipient_id} LIMIT 1
        `).catch(() => ({ rows: [] }));
        recipientRow = (paRes.rows[0] as any) ?? null;
      }
      const deviceRow = (deviceRes.rows[0] as any) ?? null;

      // 3. Push correlation (heuristic: target_user_id + pool_id + ±60s)
      const pushRes = await superAdminDb.execute(sql`
        SELECT id, status, created_at AS attempted_at,
               recipient_count, error_message, triggered_by
        FROM push_logs
        WHERE pool_id = ${poolId}
          AND target_user_id = ${n.recipient_id}
          AND ABS(EXTRACT(EPOCH FROM (created_at - ${n.created_at}::timestamptz))) < 60
        ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - ${n.created_at}::timestamptz)))
        LIMIT 3
      `).catch(() => ({ rows: [] }));

      const primaryPush = (pushRes.rows[0] as any) ?? null;

      // 4. Push settings — is user opted in for this type?
      const settingRes = await superAdminDb.execute(sql`
        SELECT is_enabled FROM push_settings
        WHERE (user_id = ${n.recipient_id} OR parent_account_id = ${n.recipient_id})
          AND notification_type = ${n.type}
        LIMIT 1
      `).catch(() => ({ rows: [] }));
      const pushEnabled = (settingRes.rows[0] as any)?.is_enabled ?? null;

      res.json({
        notification: {
          id: n.id,
          type: n.type,
          type_label: notifTypeLabel(n.type),
          title: n.title,
          body: n.body,
          ref_id: n.ref_id,
          ref_type: n.ref_type,
          is_read: n.is_read,
          created_at: n.created_at,
          deep_link: n.deep_link,
        },
        recipient: {
          id: n.recipient_id,
          role: recipientRow?.role ?? n.recipient_type,
          name: recipientRow?.name ?? null,
          // No email/phone here — PII minimised per §28; go to WP3 for full detail
          has_push_token: !!deviceRow,
          token_updated_at: deviceRow?.updated_at ?? null,
          token_platform: "UNKNOWN",  // push_tokens has no platform column
          push_opted_in: pushEnabled,
        },
        push: {
          attempted: !!primaryPush,
          provider_status: normalizePushState(primaryPush?.status),
          push_log_id: primaryPush?.id ?? null,
          attempted_at: primaryPush?.attempted_at ?? null,
          recipient_count: primaryPush?.recipient_count ?? null,
          safe_error: safePushError(primaryPush?.error_message),
          retry: "NOT_IMPLEMENTED",
          // All correlated attempts (bounded to 3)
          all_attempts: pushRes.rows.map((p: any) => ({
            id: p.id,
            status: p.status,
            attempted_at: p.attempted_at,
            recipient_count: p.recipient_count,
            safe_error: safePushError(p.error_message),
          })),
          correlation_method: primaryPush ? "heuristic_time_proximity" : "none",
          // Raw push token: NEVER returned (§27)
        },
        related: {
          ref_id: n.ref_id,
          ref_type: n.ref_type,
          deep_link: n.deep_link,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: "NOTIFICATION_DETAIL_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/storage
// Usage source: swimming_pools.used_storage_bytes (DB-cached aggregate, updated by billing.ts)
// Quota source:  (base_storage_gb + extra_storage_gb) * 1024 MB
// upload_blocked: swimming_pools.upload_blocked — same field used by billing.ts upload guard
router.get(
  "/super/pools/:id/control-center/storage",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    try {
      const pool = (await superAdminDb.execute(sql`
        SELECT used_storage_bytes, upload_blocked, storage_warning_sent_at,
               video_storage_limit_mb, base_storage_gb, extra_storage_gb,
               is_readonly
        FROM swimming_pools WHERE id = ${poolId} LIMIT 1
      `)).rows[0] as any;
      if (!pool) { res.status(404).json({ error: "수영장 없음" }); return; }

      const [mediaRes, curriculumFileRes] = await Promise.all([
        // media_files: aggregate — NO per-row scan (§30)
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size), 0) AS total_bytes
          FROM media_files WHERE swimming_pool_id = ${poolId}
        `).catch(() => ({ rows: [{ cnt: 0, total_bytes: 0 }] })),
        // curriculum file count from x_setup_files — aggregate
        superAdminDb.execute(sql`
          SELECT COUNT(*) AS cnt, COALESCE(SUM(file_size_bytes), 0) AS total_bytes
          FROM x_setup_files
          WHERE pool_id = ${poolId} AND deleted_at IS NULL
        `).catch(() => ({ rows: [{ cnt: 0, total_bytes: 0 }] })),
      ]);

      const media      = mediaRes.rows[0] as any;
      const curriculum = curriculumFileRes.rows[0] as any;

      // Quota — null/0 means unlimited (§13)
      const baseGb  = Number(pool.base_storage_gb  ?? 0);
      const extraGb = Number(pool.extra_storage_gb ?? 0);
      const totalGb = baseGb + extraGb;
      const quotaMb = totalGb > 0 ? totalGb * 1024 : null; // null = unlimited

      const usedBytes = Number(pool.used_storage_bytes ?? 0);
      const quotaBytes = quotaMb !== null ? quotaMb * 1024 * 1024 : null;

      // Safe percentage — no division by zero (§13)
      const usedPct = (quotaBytes !== null && quotaBytes > 0)
        ? Math.min(Math.round((usedBytes / quotaBytes) * 1000) / 10, 100)
        : null;
      const remainingBytes = (quotaBytes !== null) ? Math.max(quotaBytes - usedBytes, 0) : null;

      res.json({
        // Usage
        used_storage_bytes:      usedBytes,
        upload_blocked:          Boolean(pool.upload_blocked),
        is_readonly:             Boolean(pool.is_readonly),
        storage_warning_sent_at: pool.storage_warning_sent_at,

        // Quota (null = unlimited)
        quota_mb:                quotaMb,
        quota_bytes:             quotaBytes,
        remaining_bytes:         remainingBytes,
        used_pct:                usedPct,

        // Quota source info
        quota_source:            totalGb > 0 ? `base ${baseGb}GB + extra ${extraGb}GB` : "unlimited",
        base_storage_gb:         baseGb,
        extra_storage_gb:        extraGb,
        video_storage_limit_mb:  Number(pool.video_storage_limit_mb ?? 0),

        // File breakdown (aggregate, no object storage call)
        media_count:             Number(media.cnt ?? 0),
        media_bytes:             Number(media.total_bytes ?? 0),
        curriculum_file_count:   Number(curriculum.cnt ?? 0),
        curriculum_file_bytes:   Number(curriculum.total_bytes ?? 0),
      });
    } catch (e: any) {
      res.status(500).json({ error: "STORAGE_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// WP8 — Audit / Support Case / Customer Service History
// Super Admin Pool Control Center
// ════════════════════════════════════════════════════════════════

// ── WP8 Schema note ─────────────────────────────────────────────
// Runtime DDL (ensureWp8Schema) is REMOVED.
// Schema is applied via explicit migration:
//   src/migrations/wp8-support-case-crm.ts
// Server boot must NOT execute any DDL.

// ── Helpers ─────────────────────────────────────────────────────
const WP8_CATEGORIES = new Set([
  "ACCOUNT","MEMBER","TEACHER","PARENT","CLASS","ENTITLEMENT",
  "BILLING","CURRICULUM","AI","GROWTH_REPORT","NOTIFICATION","STORAGE","ERROR","OTHER",
]);
const WP8_OPS_STATUSES = new Set(["OPEN","IN_PROGRESS","RESOLVED"]);
const WP8_SUBJECT_TYPES = new Set([
  "POOL","MEMBER","TEACHER","PARENT","CLASS","REPORT","CURRICULUM","NOTIFICATION","OTHER",
]);
const WP8_NOTE_EVENTS = new Set([
  "CREATED","NOTE_ADDED","STATUS_CHANGED","ASSIGNED","RESOLVED","REOPENED",
]);

function wp8Id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function wp8TicketId(): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SUPP-${date}-${suffix}`;
}

async function wp8InsertNote(params: {
  caseId: string; poolId: string; actorId: string;
  eventType: string; note?: string | null;
  beforeState?: string | null; afterState?: string | null;
}): Promise<void> {
  const id = wp8Id("scn");
  await (superAdminDb as any).execute(sql`
    INSERT INTO support_case_notes
      (id, support_case_id, pool_id, actor_id, event_type, note, before_state, after_state)
    VALUES (${id}, ${params.caseId}, ${params.poolId}, ${params.actorId},
            ${params.eventType}, ${params.note ?? null},
            ${params.beforeState ?? null}, ${params.afterState ?? null})
  `);
}

// ── Validate pool ownership of subject ──────────────────────────
async function wp8ValidateSubject(
  poolId: string, subjectType: string | null, subjectId: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (!subjectType || !subjectId) return { ok: true };
  if (!WP8_SUBJECT_TYPES.has(subjectType)) return { ok: false, error: "유효하지 않은 subject_type" };
  try {
    let countRes: any = null;
    switch (subjectType) {
      case "MEMBER":
        countRes = await (superAdminDb as any).execute(sql`
          SELECT 1 FROM students WHERE id = ${subjectId} AND swimming_pool_id = ${poolId} LIMIT 1
        `);
        break;
      case "TEACHER":
        countRes = await (superAdminDb as any).execute(sql`
          SELECT 1 FROM users WHERE id = ${subjectId} AND swimming_pool_id = ${poolId}
            AND role IN ('teacher','pool_admin') LIMIT 1
        `);
        break;
      case "PARENT":
        countRes = await (superAdminDb as any).execute(sql`
          SELECT 1 FROM parent_accounts WHERE id = ${subjectId} AND swimming_pool_id = ${poolId} LIMIT 1
        `);
        break;
      case "CLASS":
        countRes = await (superAdminDb as any).execute(sql`
          SELECT 1 FROM class_groups WHERE id = ${subjectId} AND swimming_pool_id = ${poolId} LIMIT 1
        `);
        break;
      case "POOL":
        countRes = await (superAdminDb as any).execute(sql`
          SELECT 1 FROM swimming_pools WHERE id = ${subjectId} AND id = ${poolId} LIMIT 1
        `);
        break;
      default:
        return { ok: true }; // REPORT/CURRICULUM/NOTIFICATION/OTHER — soft check
    }
    if (!countRes?.rows?.length) {
      return { ok: false, error: `subject ${subjectType}:${subjectId}이 pool ${poolId}에 속하지 않습니다.` };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // fail-open for soft checks
  }
}

// ════════════════════════════════════════════════════════════════
// AUDIT ROUTES (enhanced)
// ════════════════════════════════════════════════════════════════

// GET /super/pools/:id/control-center/audit — enhanced with filters + pagination
router.get(
  "/super/pools/:id/control-center/audit",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      limit: limitStr = "50", offset: offsetStr = "0",
      action, entity_type, actor_id, from: fromDate, to: toDate,
    } = req.query as Record<string, string>;
    const limit  = Math.min(Math.max(parseInt(limitStr,  10), 1), 100);
    const offset = Math.max(parseInt(offsetStr, 10), 0);
    try {
      const conds: string[] = [`pool_id = '${poolId.replace(/'/g,"''")}'`];
      if (action)      conds.push(`action = '${action.replace(/'/g,"''")}'`);
      if (entity_type) conds.push(`entity_type = '${entity_type.replace(/'/g,"''")}'`);
      if (actor_id)    conds.push(`actor_id = '${actor_id.replace(/'/g,"''")}'`);
      if (fromDate)    conds.push(`created_at >= '${fromDate.replace(/'/g,"''")}'::timestamptz`);
      if (toDate)      conds.push(`created_at <= '${toDate.replace(/'/g,"''")}'::timestamptz`);
      const where = conds.join(" AND ");
      const [rows, countRes] = await Promise.all([
        (superAdminDb as any).execute(sql.raw(`
          SELECT id, entity_type, entity_id, entity_version,
                 action, actor_type, actor_id, pool_id,
                 reason, request_id, created_at
          FROM audit_logs WHERE ${where}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
        `)),
        (superAdminDb as any).execute(sql.raw(`
          SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${where}
        `)),
      ]);
      res.json({
        logs: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        limit, offset,
      });
    } catch (e: any) {
      res.status(500).json({ error: "AUDIT_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/audit/:logId — detail with redaction
router.get(
  "/super/pools/:id/control-center/audit/:logId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, logId } = req.params;
    if (!logId || logId.length > 80) { res.status(400).json({ error: "invalid logId" }); return; }
    try {
      const result = await (superAdminDb as any).execute(sql`
        SELECT al.*, sp.name AS pool_name
        FROM audit_logs al
        LEFT JOIN swimming_pools sp ON sp.id = al.pool_id
        WHERE al.id = ${logId} AND al.pool_id = ${poolId} LIMIT 1
      `);
      const row = result?.rows?.[0] as any;
      if (!row) { res.status(404).json({ error: "감사 로그를 찾을 수 없습니다." }); return; }
      res.json({
        log: {
          ...row,
          before_data: maskSensitive(row.before_data),
          after_data:  maskSensitive(row.after_data),
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: "AUDIT_DETAIL_FAILED", message: e?.message });
    }
  },
);

// ════════════════════════════════════════════════════════════════
// SUPPORT CASE ROUTES
// ════════════════════════════════════════════════════════════════

// GET /super/pools/:id/control-center/support — enhanced list with filters
router.get(
  "/super/pools/:id/control-center/support",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const {
      limit: limitStr = "30", offset: offsetStr = "0",
      ops_status, category, subject_type, q,
      from: fromDate, to: toDate,
    } = req.query as Record<string, string>;
    const limit  = Math.min(Math.max(parseInt(limitStr,  10), 1), 100);
    const offset = Math.max(parseInt(offsetStr, 10), 0);
    try {

      const conds: string[] = [`pool_id = '${poolId.replace(/'/g,"''")}'`];
      if (ops_status && WP8_OPS_STATUSES.has(ops_status))
        conds.push(`ops_status = '${ops_status}'`);
      if (category && WP8_CATEGORIES.has(category))
        conds.push(`category = '${category}'`);
      if (subject_type && WP8_SUBJECT_TYPES.has(subject_type))
        conds.push(`subject_type = '${subject_type}'`);
      if (fromDate) conds.push(`created_at >= '${fromDate.replace(/'/g,"''")}'::timestamptz`);
      if (toDate)   conds.push(`created_at <= '${toDate.replace(/'/g,"''")}'::timestamptz`);
      if (q) {
        const safe = q.slice(0, 100).replace(/'/g, "''");
        conds.push(`(ticket_id ILIKE '${safe}%' OR title ILIKE '%${safe}%')`);
      }
      const where = conds.join(" AND ");
      const [rows, countRes, summaryRes] = await Promise.all([
        (superAdminDb as any).execute(sql.raw(`
          SELECT id, pool_id, ticket_id, title, category, ops_status,
                 subject_type, subject_id, actor_role, state,
                 assigned_operator, resolution, resolved_at,
                 created_by_admin, created_at, updated_at
          FROM support_cases WHERE ${where}
          ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
        `)),
        (superAdminDb as any).execute(sql.raw(`
          SELECT COUNT(*)::int AS total FROM support_cases WHERE ${where}
        `)),
        (superAdminDb as any).execute(sql.raw(`
          SELECT ops_status, COUNT(*)::int AS cnt
          FROM support_cases WHERE pool_id = '${poolId.replace(/'/g,"''")}'
          GROUP BY ops_status
        `)),
      ]);
      const summary: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
      for (const r of (summaryRes.rows as any[])) {
        if (r.ops_status in summary) summary[r.ops_status] = Number(r.cnt);
      }
      res.json({
        cases: rows.rows,
        total: Number((countRes.rows[0] as any)?.total ?? 0),
        summary, limit, offset,
      });
    } catch (e: any) {
      res.status(500).json({ error: "SUPPORT_FAILED", message: e?.message });
    }
  },
);

// POST /super/pools/:id/control-center/support/cases — create
router.post(
  "/super/pools/:id/control-center/support/cases",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { title, category, subject_type, subject_id, note, assigned_operator } = req.body ?? {};
    // Validation
    if (!title?.trim()) { res.status(400).json({ error: "title 필수" }); return; }
    if (!category || !WP8_CATEGORIES.has(category)) {
      res.status(400).json({ error: `category는 ${[...WP8_CATEGORIES].join("/")} 중 하나여야 합니다.` }); return;
    }
    // Pool existence check
    const poolCheck = await (superAdminDb as any).execute(sql`
      SELECT id FROM swimming_pools WHERE id = ${poolId} LIMIT 1
    `).catch(() => ({ rows: [] }));
    if (!poolCheck?.rows?.length) { res.status(404).json({ error: "수영장을 찾을 수 없습니다." }); return; }
    // Cross-pool subject validation
    if (subject_type && subject_id) {
      const sv = await wp8ValidateSubject(poolId, subject_type, subject_id);
      if (!sv.ok) { res.status(400).json({ error: sv.error }); return; }
    }
    try {

      const caseId   = wp8Id("sc");
      const ticketId = wp8TicketId();
      await (superAdminDb as any).execute(sql`
        INSERT INTO support_cases
          (id, pool_id, ticket_id, title, category, ops_status,
           subject_type, subject_id, assigned_operator,
           actor_role, state, created_by_admin, created_at, updated_at)
        VALUES (
          ${caseId}, ${poolId}, ${ticketId}, ${title.trim()}, ${category}, ${"OPEN"},
          ${subject_type ?? null}, ${subject_id ?? null}, ${assigned_operator ?? null},
          ${"super_admin"}, ${"NEW"}, ${actorId}, NOW(), NOW()
        )
      `);
      // Initial note/event
      await wp8InsertNote({
        caseId, poolId, actorId, eventType: "CREATED",
        note: note?.trim() ?? `케이스 생성: ${title.trim()}`,
        afterState: "OPEN",
      });
      // Audit
      await (superAdminDb as any).execute(sql`
        INSERT INTO audit_logs
          (id, entity_type, entity_id, entity_version, action,
           actor_type, actor_id, pool_id, after_data, reason, created_at)
        VALUES (
          ${wp8Id("al")}, ${"SUPPORT_CASE"}, ${caseId}, ${1}, ${"create"},
          ${"super_admin"}, ${actorId}, ${poolId},
          ${JSON.stringify({ title: title.trim(), category, ops_status: "OPEN" })}::jsonb,
          ${"케이스 생성"}, NOW()
        )
      `).catch(() => {});
      res.status(201).json({ case_id: caseId, ticket_id: ticketId, ops_status: "OPEN" });
    } catch (e: any) {
      res.status(500).json({ error: "CASE_CREATE_FAILED", message: e?.message });
    }
  },
);

// GET /super/pools/:id/control-center/support/cases/:caseId — detail
router.get(
  "/super/pools/:id/control-center/support/cases/:caseId",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    try {

      const [caseRes, notesRes] = await Promise.all([
        (superAdminDb as any).execute(sql`
          SELECT sc.*, sp.name AS pool_name
          FROM support_cases sc
          LEFT JOIN swimming_pools sp ON sp.id = sc.pool_id
          WHERE sc.id = ${caseId} AND sc.pool_id = ${poolId} LIMIT 1
        `),
        (superAdminDb as any).execute(sql`
          SELECT id, event_type, note, before_state, after_state, actor_id, created_at
          FROM support_case_notes
          WHERE support_case_id = ${caseId}
          ORDER BY created_at ASC LIMIT 200
        `),
      ]);
      const kase = caseRes?.rows?.[0] as any;
      if (!kase) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      res.json({ case: kase, notes: notesRes.rows });
    } catch (e: any) {
      res.status(500).json({ error: "CASE_DETAIL_FAILED", message: e?.message });
    }
  },
);

// PATCH /super/pools/:id/control-center/support/cases/:caseId/status
router.patch(
  "/super/pools/:id/control-center/support/cases/:caseId/status",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { ops_status, note } = req.body ?? {};
    if (!ops_status || !WP8_OPS_STATUSES.has(ops_status)) {
      res.status(400).json({ error: "ops_status는 OPEN/IN_PROGRESS/RESOLVED 중 하나" }); return;
    }
    try {

      const cur = await (superAdminDb as any).execute(sql`
        SELECT ops_status FROM support_cases WHERE id = ${caseId} AND pool_id = ${poolId} LIMIT 1
      `);
      const row = cur?.rows?.[0] as any;
      if (!row) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      const prevStatus = row.ops_status ?? "OPEN";
      await (superAdminDb as any).execute(sql`
        UPDATE support_cases
        SET ops_status = ${ops_status}, updated_at = NOW()
        WHERE id = ${caseId} AND pool_id = ${poolId}
      `);
      await wp8InsertNote({
        caseId, poolId, actorId, eventType: "STATUS_CHANGED",
        note: note?.trim() ?? null,
        beforeState: prevStatus, afterState: ops_status,
      });
      await (superAdminDb as any).execute(sql`
        INSERT INTO audit_logs
          (id, entity_type, entity_id, entity_version, action,
           actor_type, actor_id, pool_id, before_data, after_data, reason, created_at)
        VALUES (
          ${wp8Id("al")}, ${"SUPPORT_CASE"}, ${caseId}, ${1}, ${"update"},
          ${"super_admin"}, ${actorId}, ${poolId},
          ${JSON.stringify({ ops_status: prevStatus })}::jsonb,
          ${JSON.stringify({ ops_status })}::jsonb,
          ${note?.trim() ?? "상태 변경"}, NOW()
        )
      `).catch(() => {});
      res.json({ ok: true, ops_status });
    } catch (e: any) {
      res.status(500).json({ error: "STATUS_CHANGE_FAILED", message: e?.message });
    }
  },
);

// POST /super/pools/:id/control-center/support/cases/:caseId/notes
router.post(
  "/super/pools/:id/control-center/support/cases/:caseId/notes",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { note } = req.body ?? {};
    if (!note?.trim()) { res.status(400).json({ error: "note 필수" }); return; }
    if (note.trim().length > 4000) { res.status(400).json({ error: "note 최대 4000자" }); return; }
    try {

      const exists = await (superAdminDb as any).execute(sql`
        SELECT id FROM support_cases WHERE id = ${caseId} AND pool_id = ${poolId} LIMIT 1
      `);
      if (!exists?.rows?.length) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      const noteId = wp8Id("scn");
      await (superAdminDb as any).execute(sql`
        INSERT INTO support_case_notes
          (id, support_case_id, pool_id, actor_id, event_type, note)
        VALUES (${noteId}, ${caseId}, ${poolId}, ${actorId}, ${"NOTE_ADDED"}, ${note.trim()})
      `);
      await (superAdminDb as any).execute(sql`
        UPDATE support_cases SET updated_at = NOW() WHERE id = ${caseId}
      `);
      res.status(201).json({ note_id: noteId, ok: true });
    } catch (e: any) {
      res.status(500).json({ error: "NOTE_ADD_FAILED", message: e?.message });
    }
  },
);

// PATCH /super/pools/:id/control-center/support/cases/:caseId/assign
router.patch(
  "/super/pools/:id/control-center/support/cases/:caseId/assign",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { assigned_operator } = req.body ?? {};
    // assigned_operator may be null (unassign)
    try {

      const exists = await (superAdminDb as any).execute(sql`
        SELECT id FROM support_cases WHERE id = ${caseId} AND pool_id = ${poolId} LIMIT 1
      `);
      if (!exists?.rows?.length) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      if (assigned_operator) {
        // Validate operator is a super_admin user
        const opCheck = await (superAdminDb as any).execute(sql`
          SELECT id FROM users WHERE id = ${assigned_operator} AND role = 'super_admin' LIMIT 1
        `).catch(() => ({ rows: [] }));
        if (!opCheck?.rows?.length) {
          res.status(400).json({ error: "유효한 super_admin 운영자가 아닙니다." }); return;
        }
      }
      await (superAdminDb as any).execute(sql`
        UPDATE support_cases
        SET assigned_operator = ${assigned_operator ?? null}, updated_at = NOW()
        WHERE id = ${caseId} AND pool_id = ${poolId}
      `);
      await wp8InsertNote({
        caseId, poolId, actorId, eventType: "ASSIGNED",
        note: assigned_operator ? `담당자 지정: ${assigned_operator}` : "담당자 해제",
      });
      res.json({ ok: true, assigned_operator: assigned_operator ?? null });
    } catch (e: any) {
      res.status(500).json({ error: "ASSIGN_FAILED", message: e?.message });
    }
  },
);

// POST /super/pools/:id/control-center/support/cases/:caseId/resolve
router.post(
  "/super/pools/:id/control-center/support/cases/:caseId/resolve",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { resolution, note } = req.body ?? {};
    if (!resolution?.trim()) { res.status(400).json({ error: "resolution 필수" }); return; }
    try {

      const cur = await (superAdminDb as any).execute(sql`
        SELECT ops_status FROM support_cases WHERE id = ${caseId} AND pool_id = ${poolId} LIMIT 1
      `);
      const row = cur?.rows?.[0] as any;
      if (!row) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      const prev = row.ops_status ?? "OPEN";
      await (superAdminDb as any).execute(sql`
        UPDATE support_cases
        SET ops_status = ${"RESOLVED"}, resolution = ${resolution.trim()},
            resolved_at = NOW(), updated_at = NOW()
        WHERE id = ${caseId} AND pool_id = ${poolId}
      `);
      await wp8InsertNote({
        caseId, poolId, actorId, eventType: "RESOLVED",
        note: note?.trim() ?? resolution.trim(),
        beforeState: prev, afterState: "RESOLVED",
      });
      await (superAdminDb as any).execute(sql`
        INSERT INTO audit_logs
          (id, entity_type, entity_id, entity_version, action,
           actor_type, actor_id, pool_id, before_data, after_data, reason, created_at)
        VALUES (
          ${wp8Id("al")}, ${"SUPPORT_CASE"}, ${caseId}, ${1}, ${"update"},
          ${"super_admin"}, ${actorId}, ${poolId},
          ${JSON.stringify({ ops_status: prev })}::jsonb,
          ${JSON.stringify({ ops_status: "RESOLVED", resolution: resolution.trim() })}::jsonb,
          ${"케이스 해결"}, NOW()
        )
      `).catch(() => {});
      res.json({ ok: true, ops_status: "RESOLVED" });
    } catch (e: any) {
      res.status(500).json({ error: "RESOLVE_FAILED", message: e?.message });
    }
  },
);

// POST /super/pools/:id/control-center/support/cases/:caseId/reopen
router.post(
  "/super/pools/:id/control-center/support/cases/:caseId/reopen",
  requireAuth, requireRole("super_admin"),
  async (req: AuthRequest, res) => {
    const { id: poolId, caseId } = req.params;
    const actorId = (req as any).user?.userId ?? "unknown";
    const { reason } = req.body ?? {};
    if (!reason?.trim()) { res.status(400).json({ error: "reason 필수" }); return; }
    try {

      const cur = await (superAdminDb as any).execute(sql`
        SELECT ops_status FROM support_cases WHERE id = ${caseId} AND pool_id = ${poolId} LIMIT 1
      `);
      const row = cur?.rows?.[0] as any;
      if (!row) { res.status(404).json({ error: "케이스를 찾을 수 없습니다." }); return; }
      if (row.ops_status !== "RESOLVED") {
        res.status(422).json({ error: "RESOLVED 상태인 케이스만 Reopen 가능합니다." }); return;
      }
      await (superAdminDb as any).execute(sql`
        UPDATE support_cases
        SET ops_status = ${"IN_PROGRESS"}, resolved_at = NULL, updated_at = NOW()
        WHERE id = ${caseId} AND pool_id = ${poolId}
      `);
      await wp8InsertNote({
        caseId, poolId, actorId, eventType: "REOPENED",
        note: reason.trim(), beforeState: "RESOLVED", afterState: "IN_PROGRESS",
      });
      res.json({ ok: true, ops_status: "IN_PROGRESS" });
    } catch (e: any) {
      res.status(500).json({ error: "REOPEN_FAILED", message: e?.message });
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



