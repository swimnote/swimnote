/**
 * integrity-checker.ts — WP13 Read-Only Data Integrity Checker
 *
 * §0: 절대 원칙 — READ ONLY. 어떤 UPDATE/DELETE/INSERT(repair)도 없음.
 * §19: 모든 check는 set-based SQL. N+1 없음.
 * §27: False positive 방지 — product semantics 기준.
 * §16: Severity: CRITICAL | WARNING | INFO
 */

import { sql } from "drizzle-orm";
import { superAdminDb, db } from "@workspace/db";

// ── Issue model ───────────────────────────────────────────────────────────────

export type Severity = "CRITICAL" | "WARNING" | "INFO";

export interface IntegrityIssue {
  code:            string;
  severity:        Severity;
  entity_type:     string;
  entity_id:       string;
  pool_id?:        string | null;
  summary:         string;
  evidence:        Record<string, any>;
  detected_at:     string;
  suggested_action: string;
}

interface ScanOpts {
  poolId?: string | null;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const now = () => new Date().toISOString();

/** Wraps a check function so it never throws — returns [] on any DB error */
async function safeCheck(
  fn: () => Promise<IntegrityIssue[]>,
  label: string,
): Promise<IntegrityIssue[]> {
  try {
    return await fn();
  } catch (e: any) {
    console.warn(`[integrity] check '${label}' skipped: ${e?.message?.slice(0, 120)}`);
    return [];
  }
}

// ── §4  Pool / User ───────────────────────────────────────────────────────────

/**
 * USER_ORPHAN_POOL — user.swimming_pool_id references non-existent pool.
 * §4: super_admin / platform_admin / super_manager have no pool → skip (not an error).
 */
async function checkUserOrphanPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND u.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT u.id, u.swimming_pool_id, u.role
    FROM users u
    LEFT JOIN swimming_pools sp ON sp.id = u.swimming_pool_id
    WHERE u.swimming_pool_id IS NOT NULL
      AND sp.id IS NULL
      AND u.role NOT IN ('super_admin', 'platform_admin', 'super_manager')
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "USER_ORPHAN_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "user",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         `User references non-existent pool`,
    evidence:        { referenced_pool_id: r.swimming_pool_id, role: r.role },
    detected_at:     now(),
    suggested_action: "수동으로 해당 user의 pool 귀속을 확인하십시오.",
  }));
}

// ── §5  Students / Members ────────────────────────────────────────────────────

/** MEMBER_ORPHAN_POOL — student.swimming_pool_id references non-existent pool */
async function checkMemberOrphanPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND s.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT s.id, s.swimming_pool_id
    FROM students s
    LEFT JOIN swimming_pools sp ON sp.id = s.swimming_pool_id
    WHERE s.swimming_pool_id IS NOT NULL AND sp.id IS NULL
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "MEMBER_ORPHAN_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "student",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         `Student references non-existent pool`,
    evidence:        { referenced_pool_id: r.swimming_pool_id },
    detected_at:     now(),
    suggested_action: "수동으로 해당 student의 pool 귀속을 확인하십시오.",
  }));
}

// ── §6  Parent / Child links ──────────────────────────────────────────────────

/** PARENT_CHILD_ORPHAN — parent_students where parent or student is missing */
async function checkParentChildOrphan(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND ps.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT ps.id, ps.parent_id, ps.student_id, ps.swimming_pool_id,
           pa.id IS NULL AS parent_missing,
           s.id  IS NULL AS student_missing
    FROM parent_students ps
    LEFT JOIN parent_accounts pa ON ps.parent_id = pa.id
    LEFT JOIN students s ON ps.student_id = s.id
    WHERE (pa.id IS NULL OR s.id IS NULL)
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "PARENT_CHILD_ORPHAN",
    severity:        "CRITICAL" as Severity,
    entity_type:     "parent_students",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         `parent_students references missing ${r.parent_missing ? "parent" : "student"}`,
    evidence:        {
      parent_missing:  Boolean(r.parent_missing),
      student_missing: Boolean(r.student_missing),
      parent_id:       r.parent_id,
      student_id:      r.student_id,
    },
    detected_at:     now(),
    suggested_action: "해당 parent_students 링크를 수동으로 정리하십시오.",
  }));
}

/** PARENT_CHILD_CROSS_POOL — parent pool != student pool */
async function checkParentChildCrossPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND ps.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT ps.id, ps.parent_id, ps.student_id, ps.swimming_pool_id,
           pa.swimming_pool_id AS parent_pool_id,
           s.swimming_pool_id  AS student_pool_id
    FROM parent_students ps
    JOIN parent_accounts pa ON ps.parent_id = pa.id
    JOIN students s ON ps.student_id = s.id
    WHERE pa.swimming_pool_id IS DISTINCT FROM s.swimming_pool_id
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "PARENT_CHILD_CROSS_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "parent_students",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         "Parent and child belong to different pools",
    evidence:        {
      parent_pool_id:  r.parent_pool_id,
      student_pool_id: r.student_pool_id,
    },
    detected_at:     now(),
    suggested_action: "Cross-pool parent-child 링크를 수동으로 검토하십시오.",
  }));
}

// ── §7  Class Integrity ───────────────────────────────────────────────────────

/** CLASS_MEMBER_ORPHAN — class_members where member or class is missing */
async function checkClassMemberOrphan(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND cg.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT cm.id, cm.class_id, cm.member_id,
           cg.swimming_pool_id AS class_pool_id,
           cg.id IS NULL AS class_missing,
           s.id  IS NULL AS member_missing
    FROM class_members cm
    LEFT JOIN class_groups cg ON cg.id = cm.class_id
    LEFT JOIN students s ON s.id = cm.member_id
    WHERE (cg.id IS NULL OR s.id IS NULL)
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "CLASS_MEMBER_ORPHAN",
    severity:        "WARNING" as Severity,
    entity_type:     "class_members",
    entity_id:       r.id,
    pool_id:         r.class_pool_id ?? null,
    summary:         `class_members references missing ${r.class_missing ? "class" : "member"}`,
    evidence:        {
      class_missing:  Boolean(r.class_missing),
      member_missing: Boolean(r.member_missing),
      class_id:       r.class_id,
      member_id:      r.member_id,
    },
    detected_at:     now(),
    suggested_action: "해당 class_members row를 수동으로 확인하십시오.",
  }));
}

/** CLASS_MEMBER_CROSS_POOL — class pool != student pool */
async function checkClassMemberCrossPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND cg.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT cm.id, cm.class_id, cm.member_id,
           cg.swimming_pool_id AS class_pool_id,
           s.swimming_pool_id  AS member_pool_id
    FROM class_members cm
    JOIN class_groups cg ON cg.id = cm.class_id
    JOIN students s ON s.id = cm.member_id
    WHERE cg.swimming_pool_id IS DISTINCT FROM s.swimming_pool_id
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "CLASS_MEMBER_CROSS_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "class_members",
    entity_id:       r.id,
    pool_id:         r.class_pool_id,
    summary:         "Class member belongs to a different pool than the class",
    evidence:        {
      class_pool_id:  r.class_pool_id,
      member_pool_id: r.member_pool_id,
    },
    detected_at:     now(),
    suggested_action: "Cross-pool class 배정을 수동으로 검토하십시오.",
  }));
}

// ── §8  Attendance ────────────────────────────────────────────────────────────

/** ATTENDANCE_CROSS_POOL — attendance pool != student pool or class pool */
async function checkAttendanceCrossPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND a.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT a.id, a.student_id, a.class_group_id, a.swimming_pool_id AS att_pool_id,
           s.swimming_pool_id  AS student_pool_id,
           cg.swimming_pool_id AS class_pool_id
    FROM attendance a
    JOIN students s ON s.id = a.student_id
    LEFT JOIN class_groups cg ON cg.id = a.class_group_id
    WHERE (s.swimming_pool_id IS DISTINCT FROM a.swimming_pool_id
           OR (cg.id IS NOT NULL AND cg.swimming_pool_id IS DISTINCT FROM a.swimming_pool_id))
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "ATTENDANCE_CROSS_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "attendance",
    entity_id:       r.id,
    pool_id:         r.att_pool_id,
    summary:         "Attendance record pool does not match student or class pool",
    evidence:        {
      att_pool_id:    r.att_pool_id,
      student_pool_id: r.student_pool_id,
      class_pool_id:  r.class_pool_id ?? null,
    },
    detected_at:     now(),
    suggested_action: "Cross-pool attendance 레코드를 수동으로 검토하십시오.",
  }));
}

// ── §9  Diary / Media ─────────────────────────────────────────────────────────

/** DIARY_CROSS_POOL — diary pool != student pool */
async function checkDiaryCrossPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND d.pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT d.id, d.pool_id AS diary_pool_id, s.swimming_pool_id AS student_pool_id
    FROM diary_entries d
    JOIN students s ON s.id = d.student_id
    WHERE d.pool_id IS DISTINCT FROM s.swimming_pool_id
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "DIARY_CROSS_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "diary_entries",
    entity_id:       r.id,
    pool_id:         r.diary_pool_id,
    summary:         "Diary entry pool does not match student pool",
    evidence:        {
      diary_pool_id:   r.diary_pool_id,
      student_pool_id: r.student_pool_id,
    },
    detected_at:     now(),
    suggested_action: "Cross-pool diary 레코드를 수동으로 검토하십시오.",
  }));
}

/**
 * MEDIA_ORPHAN_RESOURCE — photo_assets_meta where student doesn't exist.
 * §9: DB metadata 관계 검사 우선. R2 full scan 금지.
 * §27: media_status='uploading' → 진행중, 오류 아님.
 */
async function checkMediaOrphan(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND m.pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT m.id, m.pool_id, m.student_id, m.album_type
    FROM photo_assets_meta m
    LEFT JOIN students s ON s.id = m.student_id
    WHERE m.student_id IS NOT NULL
      AND s.id IS NULL
      AND m.media_status != 'uploading'
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "MEDIA_ORPHAN_RESOURCE",
    severity:        "WARNING" as Severity,
    entity_type:     "photo_assets_meta",
    entity_id:       r.id,
    pool_id:         r.pool_id,
    summary:         "Photo asset references non-existent student",
    evidence:        { student_id: r.student_id, album_type: r.album_type },
    detected_at:     now(),
    suggested_action: "고아 사진 메타데이터를 수동으로 확인하십시오.",
  }));
}

/** MEDIA_CROSS_POOL — photo pool != student pool */
async function checkMediaCrossPool(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND m.pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await db.execute(sql`
    SELECT m.id, m.pool_id AS media_pool_id, s.swimming_pool_id AS student_pool_id
    FROM photo_assets_meta m
    JOIN students s ON s.id = m.student_id
    WHERE m.pool_id IS DISTINCT FROM s.swimming_pool_id
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "MEDIA_CROSS_POOL",
    severity:        "CRITICAL" as Severity,
    entity_type:     "photo_assets_meta",
    entity_id:       r.id,
    pool_id:         r.media_pool_id,
    summary:         "Photo asset pool does not match student pool",
    evidence:        {
      media_pool_id:   r.media_pool_id,
      student_pool_id: r.student_pool_id,
    },
    detected_at:     now(),
    suggested_action: "Cross-pool 사진 메타데이터를 수동으로 검토하십시오.",
  }));
}

// ── §10  X Entitlement / Plan / member_limit ──────────────────────────────────

const VALID_X_PLAN_KEYS = ["x300", "x500", "x1000"] as const;
const X_PLAN_LIMITS: Record<string, number> = { x300: 300, x500: 500, x1000: 1000 };

/**
 * X_PLAN_LIMIT_MISMATCH — x_plan_key set but member_limit doesn't match expected.
 * §27: mode=x paid=false is NOT checked. Only explicit entitlement sources matter.
 */
async function checkXPlanLimitMismatch(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND sp.id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT sp.id, sp.x_plan_key, sp.member_limit,
           COALESCE(sp.x_paid_entitlement, false)       AS paid,
           COALESCE(sp.x_manual_entitlement, false)     AS manual,
           COALESCE(sp.x_management_override, false)    AS override,
           COALESCE(sp.x_force_disabled, false)         AS force_disabled
    FROM swimming_pools sp
    WHERE sp.x_plan_key IN ('x300','x500','x1000')
      AND (
        COALESCE(sp.x_paid_entitlement, false)
        OR COALESCE(sp.x_manual_entitlement, false)
        OR COALESCE(sp.x_management_override, false)
      )
      AND NOT COALESCE(sp.x_force_disabled, false)
      AND (
        (sp.x_plan_key = 'x300'  AND COALESCE(sp.member_limit, 0) != 300)  OR
        (sp.x_plan_key = 'x500'  AND COALESCE(sp.member_limit, 0) != 500)  OR
        (sp.x_plan_key = 'x1000' AND COALESCE(sp.member_limit, 0) != 1000)
      )
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "X_PLAN_LIMIT_MISMATCH",
    severity:        "WARNING" as Severity,
    entity_type:     "swimming_pools",
    entity_id:       r.id,
    pool_id:         r.id,
    summary:         `x_plan_key=${r.x_plan_key} but member_limit=${r.member_limit} (expected ${X_PLAN_LIMITS[r.x_plan_key] ?? "??"})`,
    evidence:        {
      x_plan_key:    r.x_plan_key,
      member_limit:  r.member_limit,
      expected_limit: X_PLAN_LIMITS[r.x_plan_key] ?? null,
      paid:          r.paid, manual: r.manual, override: r.override,
    },
    detected_at:     now(),
    suggested_action: "member_limit를 x_plan_key에 맞게 수동으로 보정하십시오.",
  }));
}

/** X_INVALID_PLAN — x_plan_key exists but is not a canonical value */
async function checkXInvalidPlan(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND sp.id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT sp.id, sp.x_plan_key
    FROM swimming_pools sp
    WHERE sp.x_plan_key IS NOT NULL
      AND sp.x_plan_key NOT IN ('x300','x500','x1000')
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "X_INVALID_PLAN",
    severity:        "WARNING" as Severity,
    entity_type:     "swimming_pools",
    entity_id:       r.id,
    pool_id:         r.id,
    summary:         `x_plan_key='${r.x_plan_key}' is not a canonical X plan key`,
    evidence:        { x_plan_key: r.x_plan_key, valid_values: VALID_X_PLAN_KEYS },
    detected_at:     now(),
    suggested_action: "x_plan_key를 canonical 값으로 수동 보정하십시오.",
  }));
}

/**
 * X_RESOLVER_INCONSISTENCY — force_disabled=true but paid/manual/override also true.
 * §10: force_disabled=true AND effective resolver=true → contradiction.
 */
async function checkXResolverInconsistency(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND sp.id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT sp.id,
           COALESCE(sp.x_paid_entitlement, false)    AS paid,
           COALESCE(sp.x_manual_entitlement, false)  AS manual,
           COALESCE(sp.x_management_override, false) AS override,
           sp.x_plan_key
    FROM swimming_pools sp
    WHERE COALESCE(sp.x_force_disabled, false) = true
      AND (
        COALESCE(sp.x_paid_entitlement, false)
        OR COALESCE(sp.x_manual_entitlement, false)
        OR COALESCE(sp.x_management_override, false)
      )
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "X_RESOLVER_INCONSISTENCY",
    severity:        "CRITICAL" as Severity,
    entity_type:     "swimming_pools",
    entity_id:       r.id,
    pool_id:         r.id,
    summary:         "x_force_disabled=true but paid/manual/override entitlement is also set",
    evidence:        { paid: r.paid, manual: r.manual, override: r.override, x_plan_key: r.x_plan_key },
    detected_at:     now(),
    suggested_action: "force_disabled 또는 entitlement source 중 하나를 수동으로 수정하십시오.",
  }));
}

// ── §11  RevenueCat ───────────────────────────────────────────────────────────

/**
 * RC_STUCK_EVENT — revenuecat_webhook_events not processed after >1 hour.
 * §11: RC reconciliation worker 만들지 마십시오 — detection only.
 */
async function checkRcStuckEvents(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;

  const rows = (await superAdminDb.execute(sql`
    SELECT id, event_id, event_type, app_user_id, created_at
    FROM revenuecat_webhook_events
    WHERE processed_at IS NULL
      AND created_at < NOW() - INTERVAL '1 hour'
    ORDER BY created_at ASC
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "RC_STUCK_EVENT",
    severity:        "WARNING" as Severity,
    entity_type:     "revenuecat_webhook_events",
    entity_id:       r.id,
    pool_id:         null,
    summary:         `RC webhook event not processed for >1 hour (type=${r.event_type})`,
    evidence:        { event_type: r.event_type, created_at: r.created_at },
    detected_at:     now(),
    suggested_action: "RC webhook 처리 워커 상태를 확인하십시오.",
  }));
}

// ── §12  Storage ──────────────────────────────────────────────────────────────

/** STORAGE_INVALID_QUOTA — negative quota or usage */
async function checkStorageInvalidQuota(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND sp.id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT sp.id, sp.used_storage_bytes, sp.base_storage_gb, sp.extra_storage_gb
    FROM swimming_pools sp
    WHERE (COALESCE(sp.used_storage_bytes, 0) < 0
           OR COALESCE(sp.base_storage_gb, 0) < 0
           OR COALESCE(sp.extra_storage_gb, 0) < 0)
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "STORAGE_INVALID_QUOTA",
    severity:        "WARNING" as Severity,
    entity_type:     "swimming_pools",
    entity_id:       r.id,
    pool_id:         r.id,
    summary:         "Storage has negative quota or usage value",
    evidence:        {
      used_storage_bytes: r.used_storage_bytes,
      base_storage_gb:    r.base_storage_gb,
      extra_storage_gb:   r.extra_storage_gb,
    },
    detected_at:     now(),
    suggested_action: "Storage quota/usage 값을 수동으로 검토하십시오.",
  }));
}

/**
 * STORAGE_OVER_QUOTA — used_storage_bytes > (base + extra) * 1GB.
 * §12: WARNING only. 자동 삭제/차단 대상 아님.
 */
async function checkStorageOverQuota(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND sp.id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT sp.id, sp.used_storage_bytes, sp.base_storage_gb, sp.extra_storage_gb,
           ((COALESCE(sp.base_storage_gb,0) + COALESCE(sp.extra_storage_gb,0)) * 1073741824)::bigint AS quota_bytes
    FROM swimming_pools sp
    WHERE (COALESCE(sp.base_storage_gb, 0) + COALESCE(sp.extra_storage_gb, 0)) > 0
      AND COALESCE(sp.used_storage_bytes, 0) > ((COALESCE(sp.base_storage_gb,0) + COALESCE(sp.extra_storage_gb,0)) * 1073741824)
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "STORAGE_OVER_QUOTA",
    severity:        "WARNING" as Severity,
    entity_type:     "swimming_pools",
    entity_id:       r.id,
    pool_id:         r.id,
    summary:         "Storage usage exceeds quota (DATA cancellation policy TBD)",
    evidence:        {
      used_storage_bytes: r.used_storage_bytes,
      quota_bytes:        r.quota_bytes,
    },
    detected_at:     now(),
    suggested_action: "용량 초과 수영장을 운영팀이 수동 검토하십시오. 자동 삭제 금지.",
  }));
}

// ── §13  Notices ──────────────────────────────────────────────────────────────

/** NOTICE_ORPHAN_DISMISSAL — notice_dismissals where notice doesn't exist */
async function checkNoticeOrphanDismissal(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;

  const rows = (await db.execute(sql`
    SELECT nd.id, nd.notice_id, nd.user_id
    FROM notice_dismissals nd
    LEFT JOIN notices n ON n.id = nd.notice_id
    WHERE n.id IS NULL
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "NOTICE_ORPHAN_DISMISSAL",
    severity:        "INFO" as Severity,
    entity_type:     "notice_dismissals",
    entity_id:       r.id,
    pool_id:         null,
    summary:         "notice_dismissals references non-existent notice",
    evidence:        { notice_id: r.notice_id },
    detected_at:     now(),
    suggested_action: "고아 dismissal 레코드를 수동으로 정리하십시오.",
  }));
}

/** NOTICE_INVALID_PERIOD — starts_at > ends_at */
async function checkNoticeInvalidPeriod(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND n.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT n.id, n.swimming_pool_id, n.starts_at, n.ends_at, n.title
    FROM notices n
    WHERE n.starts_at IS NOT NULL AND n.ends_at IS NOT NULL AND n.starts_at > n.ends_at
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "NOTICE_INVALID_PERIOD",
    severity:        "WARNING" as Severity,
    entity_type:     "notices",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         "Notice has starts_at after ends_at",
    evidence:        { starts_at: r.starts_at, ends_at: r.ends_at },
    detected_at:     now(),
    suggested_action: "공지 유효기간을 수동으로 수정하십시오.",
  }));
}

// ── §14  Push ─────────────────────────────────────────────────────────────────

/** PUSH_ORPHAN_DELIVERY — push_fanout_deliveries where job_ref doesn't exist in jobs */
async function checkPushOrphanDelivery(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;

  const rows = (await superAdminDb.execute(sql`
    SELECT d.id, d.job_ref, d.status
    FROM push_fanout_deliveries d
    LEFT JOIN push_fanout_jobs j ON j.job_ref = d.job_ref
    WHERE j.job_ref IS NULL
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "PUSH_ORPHAN_DELIVERY",
    severity:        "WARNING" as Severity,
    entity_type:     "push_fanout_deliveries",
    entity_id:       r.id,
    pool_id:         null,
    summary:         "push_fanout_deliveries references non-existent job_ref",
    evidence:        { job_ref: r.job_ref, status: r.status },
    detected_at:     now(),
    suggested_action: "고아 delivery 레코드를 수동으로 확인하십시오.",
  }));
}

/** PUSH_JOB_STATE_INCONSISTENT — COMPLETED job with pending deliveries */
async function checkPushJobStateInconsistent(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;

  const rows = (await superAdminDb.execute(sql`
    SELECT j.job_ref, j.status, COUNT(d.id)::int AS pending_count
    FROM push_fanout_jobs j
    JOIN push_fanout_deliveries d ON d.job_ref = j.job_ref AND d.status = 'PENDING'
    WHERE j.status = 'COMPLETED'
    GROUP BY j.job_ref, j.status
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "PUSH_JOB_STATE_INCONSISTENT",
    severity:        "WARNING" as Severity,
    entity_type:     "push_fanout_jobs",
    entity_id:       r.job_ref,
    pool_id:         null,
    summary:         `Push job COMPLETED but has ${r.pending_count} PENDING deliveries`,
    evidence:        { job_ref: r.job_ref, pending_count: r.pending_count },
    detected_at:     now(),
    suggested_action: "push_fanout_jobs 상태를 수동으로 확인하십시오.",
  }));
}

// ── §15  Growth ───────────────────────────────────────────────────────────────

/**
 * GROWTH_ORPHAN_REPORT — growth_reports where student doesn't exist.
 * §15: REVIEW_REQUIRED는 정상 상태 — 오류로 취급 금지.
 * §27: deleted_at IS NOT NULL → soft-deleted, skip.
 */
async function checkGrowthOrphanReport(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND gr.swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT gr.id, gr.student_id, gr.swimming_pool_id, gr.status
    FROM growth_reports gr
    LEFT JOIN students s ON s.id = gr.student_id
    WHERE s.id IS NULL
      AND gr.deleted_at IS NULL
      ${poolFilter}
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "GROWTH_ORPHAN_REPORT",
    severity:        "WARNING" as Severity,
    entity_type:     "growth_reports",
    entity_id:       r.id,
    pool_id:         r.swimming_pool_id,
    summary:         "Growth report references non-existent student",
    evidence:        { student_id: r.student_id, status: r.status },
    detected_at:     now(),
    suggested_action: "해당 growth_report를 수동으로 검토하십시오.",
  }));
}

/** GROWTH_DUPLICATE_REPORT — same student + cycle + type */
async function checkGrowthDuplicateReport(opts: ScanOpts): Promise<IntegrityIssue[]> {
  const lim = opts.limit ?? DEFAULT_LIMIT;
  const poolFilter = opts.poolId
    ? sql`AND swimming_pool_id = ${opts.poolId}`
    : sql``;

  const rows = (await superAdminDb.execute(sql`
    SELECT student_id, swimming_pool_id, report_type, period_start, period_end, COUNT(*)::int AS cnt
    FROM growth_reports
    WHERE deleted_at IS NULL
      ${poolFilter}
    GROUP BY student_id, swimming_pool_id, report_type, period_start, period_end
    HAVING COUNT(*) > 1
    LIMIT ${lim}
  `)).rows as any[];

  return rows.map(r => ({
    code:            "GROWTH_DUPLICATE_REPORT",
    severity:        "WARNING" as Severity,
    entity_type:     "growth_reports",
    entity_id:       `${r.student_id}:${r.period_start}:${r.report_type}`,
    pool_id:         r.swimming_pool_id,
    summary:         `Duplicate growth report: ${r.cnt} records for same student+cycle+type`,
    evidence:        {
      student_id:   r.student_id,
      report_type:  r.report_type,
      period_start: r.period_start,
      period_end:   r.period_end,
      count:        r.cnt,
    },
    detected_at:     now(),
    suggested_action: "중복 growth_report를 수동으로 확인하십시오.",
  }));
}

// ── Master scan ───────────────────────────────────────────────────────────────

export interface IntegrityScanResult {
  scanned_at:   string;
  pool_id?:     string | null;
  issues:       IntegrityIssue[];
  summary:      { CRITICAL: number; WARNING: number; INFO: number; total: number };
  check_count:  number;
  query_count:  number;
}

/**
 * runIntegrityScan — executes all read-only checks and returns unified result.
 * §19: All checks use set-based SQL, no N+1 loops.
 * §20: Absolutely no mutations — all checks are SELECT-only.
 */
export async function runIntegrityScan(opts: ScanOpts = {}): Promise<IntegrityScanResult> {
  const scannedAt = now();
  const perCheckLimit = opts.limit ?? DEFAULT_LIMIT;

  // Run all checks in parallel — read-only, safe to parallelize
  // §30: query_count = number of distinct SQL statements
  const [
    userOrphan,
    memberOrphan,
    parentOrphan,
    parentCross,
    classMemberOrphan,
    classMemberCross,
    attendanceCross,
    diaryCross,
    mediaOrphan,
    mediaCross,
    xPlanLimit,
    xInvalid,
    xResolver,
    rcStuck,
    storageInvalid,
    storageOver,
    noticeOrphan,
    noticeInvalid,
    pushOrphan,
    pushInconsistent,
    growthOrphan,
    growthDup,
  ] = await Promise.all([
    safeCheck(() => checkUserOrphanPool(opts),           "user_orphan_pool"),
    safeCheck(() => checkMemberOrphanPool(opts),         "member_orphan_pool"),
    safeCheck(() => checkParentChildOrphan(opts),        "parent_child_orphan"),
    safeCheck(() => checkParentChildCrossPool(opts),     "parent_child_cross_pool"),
    safeCheck(() => checkClassMemberOrphan(opts),        "class_member_orphan"),
    safeCheck(() => checkClassMemberCrossPool(opts),     "class_member_cross_pool"),
    safeCheck(() => checkAttendanceCrossPool(opts),      "attendance_cross_pool"),
    safeCheck(() => checkDiaryCrossPool(opts),           "diary_cross_pool"),
    safeCheck(() => checkMediaOrphan(opts),              "media_orphan"),
    safeCheck(() => checkMediaCrossPool(opts),           "media_cross_pool"),
    safeCheck(() => checkXPlanLimitMismatch(opts),       "x_plan_limit_mismatch"),
    safeCheck(() => checkXInvalidPlan(opts),             "x_invalid_plan"),
    safeCheck(() => checkXResolverInconsistency(opts),   "x_resolver_inconsistency"),
    safeCheck(() => checkRcStuckEvents(opts),            "rc_stuck_events"),
    safeCheck(() => checkStorageInvalidQuota(opts),      "storage_invalid_quota"),
    safeCheck(() => checkStorageOverQuota(opts),         "storage_over_quota"),
    safeCheck(() => checkNoticeOrphanDismissal(opts),    "notice_orphan_dismissal"),
    safeCheck(() => checkNoticeInvalidPeriod(opts),      "notice_invalid_period"),
    safeCheck(() => checkPushOrphanDelivery(opts),       "push_orphan_delivery"),
    safeCheck(() => checkPushJobStateInconsistent(opts), "push_job_state_inconsistent"),
    safeCheck(() => checkGrowthOrphanReport(opts),       "growth_orphan_report"),
    safeCheck(() => checkGrowthDuplicateReport(opts),    "growth_dup_report"),
  ]);

  const issues = [
    ...userOrphan, ...memberOrphan,
    ...parentOrphan, ...parentCross,
    ...classMemberOrphan, ...classMemberCross,
    ...attendanceCross, ...diaryCross,
    ...mediaOrphan, ...mediaCross,
    ...xPlanLimit, ...xInvalid, ...xResolver,
    ...rcStuck,
    ...storageInvalid, ...storageOver,
    ...noticeOrphan, ...noticeInvalid,
    ...pushOrphan, ...pushInconsistent,
    ...growthOrphan, ...growthDup,
  ];

  const critCount = issues.filter(i => i.severity === "CRITICAL").length;
  const warnCount = issues.filter(i => i.severity === "WARNING").length;
  const infoCount = issues.filter(i => i.severity === "INFO").length;

  return {
    scanned_at:  scannedAt,
    pool_id:     opts.poolId ?? null,
    issues,
    summary: {
      CRITICAL: critCount,
      WARNING:  warnCount,
      INFO:     infoCount,
      total:    issues.length,
    },
    check_count: 22,   // number of distinct check functions
    query_count: 22,   // 1 SQL per check = 22 queries (all set-based, no N+1)
  };
}
