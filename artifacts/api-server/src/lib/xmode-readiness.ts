/**
 * xmode-readiness.ts
 *
 * WP7 FINAL HOLD FIX: checkXPrerequisite
 * — Pool-Specific X Prerequisite + Runtime Evidence
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * 핵심 원칙 (spec §6, §7, WP7 HOLD):
 *   - Upload history (x_setup_submissions / x_setup_files) → prerequisite 금지
 *   - 실제 X runtime이 참조하는 데이터 존재 여부로 결정
 *   - Pool-specific config 없이 global X data만으로 충분한지 runtime code로 증명
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * RUNTIME CODE EVIDENCE — global-only resolver 근거
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. src/lib/diary-template-search.ts:464-484 — loadXGlobalTemplates(setId):
 *      WHERE dt.scope = 'x_global'
 *        AND dt.global_template_set_id = ${setId}
 *        AND dt.swimming_pool_id IS NULL   ← pool_id 필터 없음 (의도적)
 *        AND dt.is_active = true
 *    → X 다이어리 생성 시 pool 단위 템플릿 분기 없음. 모든 pool이 동일한 global set 사용.
 *
 * 2. src/migrations/pool-db-x-init.ts:118-126 — global_template_sets 테이블:
 *      id, version_name, status, created_at, activated_at, archived_at
 *    → pool_id 컬럼 없음. system-wide 테이블.
 *
 * 3. src/migrations/pool-db-x-init.ts:148-150 — UNIQUE INDEX:
 *      ON global_template_sets ((1)) WHERE status = 'ACTIVE'
 *    → 전역에서 ACTIVE set 최대 1개. pool 단위 분리 구조 없음.
 *
 * 4. src/lib/xmode.ts:159-180 — resolvePoolMode(poolId):
 *      SELECT ... FROM swimming_pools WHERE id = poolId
 *    → pool-specific X config 별도 테이블 없음. entitlement만 swimming_pools에서 읽음.
 *
 * 결론: 모든 pool은 동일한 global X template set을 자동 사용.
 *       별도 pool-specific mapping/config 실제로 필요하지 않음.
 *       따라서 global-only resolver 유지 가능 (spec WP7 HOLD §3 조건 충족).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * checkXPrerequisite — 실제 prerequisite 확인 항목
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A. Pool 존재 확인 (pool not found → blocker)
 * B. global_template_sets WHERE status='ACTIVE' 존재 확인
 *    — X runtime이 사용할 active template set 없으면 NOT_READY
 * C. diary_templates WHERE scope='x_global' AND swimming_pool_id IS NULL
 *    AND is_active=true 개수 확인
 *    — 실제 X mode 생성 시 사용할 템플릿 없으면 NOT_READY
 *
 * NOTE: scope='global'은 일반 pool별 다이어리 템플릿(X 무관).
 *       scope='x_global'이 실제 X runtime 사용 대상.
 *
 * DB write:  NO
 * AI calls:  0
 */

import { sql } from "drizzle-orm";

type Db = any;

export type XPrerequisiteStatus = "READY" | "NOT_READY";

export interface XPrerequisiteResult {
  /** READY = 실제 X runtime 데이터 조건 충족, Manual Grant 가능 */
  status:   XPrerequisiteStatus;
  ready:    boolean;
  /** 운영자가 이해할 수 있는 reason (NOT_READY 시) */
  reason:   string | null;
  /** 구체적 누락 항목 (코드 레벨) */
  missing:  string[];
  /** pool approval_status (참고 정보) */
  pool_approval_status: string | null;
  /** active global_template_sets 개수 */
  active_template_set_count: number;
  /** 실제 x_global scope 템플릿 개수 */
  x_global_template_count: number;
}

/**
 * checkXPrerequisite — WP7 공식 X Manual Grant prerequisite resolver.
 *
 * global-only resolver (pool-specific config 없음 — runtime code evidence 참조).
 * Upload history (x_setup_submissions/x_setup_files) 확인 금지.
 *
 * @param poolId  swimming_pools.id
 * @param db      drizzle-compat db instance (superAdminDb)
 */
export async function checkXPrerequisite(
  poolId: string,
  db: Db,
): Promise<XPrerequisiteResult> {
  const missing: string[] = [];

  // ── A. Pool 존재 확인 ─────────────────────────────────────────────────────
  const poolRows = await db.execute(sql`
    SELECT id, approval_status
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `);

  if (!poolRows.rows.length) {
    return {
      status: "NOT_READY",
      ready: false,
      reason: "수영장을 찾을 수 없습니다.",
      missing: ["POOL_NOT_FOUND"],
      pool_approval_status: null,
      active_template_set_count: 0,
      x_global_template_count: 0,
    };
  }
  const pool = poolRows.rows[0] as any;

  // ── B. global_template_sets — ACTIVE set 존재 확인 ───────────────────────
  // X runtime: loadXGlobalTemplates(setId) — setId는 ACTIVE set에서 가져옴.
  // ACTIVE set 없으면 X 다이어리 생성 불가.
  const setRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM global_template_sets
    WHERE status = 'ACTIVE'
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  const activeSetCount = Number((setRows.rows[0] as any)?.cnt ?? 0);
  if (activeSetCount === 0) {
    missing.push("ACTIVE_TEMPLATE_SET: ACTIVE 상태의 global_template_sets 없음. X runtime 다이어리 생성 불가.");
  }

  // ── C. diary_templates — scope='x_global' 템플릿 존재 확인 ───────────────
  // 실제 X runtime 사용 scope: 'x_global' (일반 pool 다이어리의 'global'과 다름)
  // swimming_pool_id IS NULL — 전역 템플릿이므로 pool 필터 없음 (runtime 확인됨)
  const tmplRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM diary_templates
    WHERE scope              = 'x_global'
      AND swimming_pool_id   IS NULL
      AND is_active          = true
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  const xGlobalTemplateCnt = Number((tmplRows.rows[0] as any)?.cnt ?? 0);
  if (xGlobalTemplateCnt === 0) {
    missing.push("X_GLOBAL_TEMPLATES: scope='x_global' 활성 템플릿 없음. X 다이어리 생성 시 사용할 템플릿 없음.");
  }

  const ready = missing.length === 0;

  return {
    status: ready ? "READY" : "NOT_READY",
    ready,
    reason: ready
      ? null
      : missing.map(m => m.split(":")[1]?.trim() ?? m).join("; "),
    missing,
    pool_approval_status: pool.approval_status ?? null,
    active_template_set_count: activeSetCount,
    x_global_template_count: xGlobalTemplateCnt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy: validateXModeReadiness — upload history 기반.
// Manual Grant에서 사용 금지 (WP7 이후 checkXPrerequisite 사용).
// 기존 legacy xmode config transition flow가 필요한 경우에만 재사용.
// ─────────────────────────────────────────────────────────────────────────────

export interface XModeReadinessResult {
  ready:    boolean;
  missing:  string[];
  blockers: string[];
}

/**
 * @deprecated Manual Grant에서 사용 금지 (WP7 이후 checkXPrerequisite 사용).
 *             upload history 기반 check — upload history 없어도 X Grant 가능해야 함.
 *             기존 legacy xmode config transition flow가 필요한 경우에만 재사용.
 */
export async function validateXModeReadiness(
  poolId: string,
  db:     Db,
): Promise<XModeReadinessResult> {
  const missing:  string[] = [];
  const blockers: string[] = [];

  const poolRows = await db.execute(sql`
    SELECT id,
           COALESCE(x_paid_entitlement,   false) AS x_paid,
           COALESCE(x_manual_entitlement, false) AS x_manual,
           COALESCE(x_force_disabled,     false) AS x_force,
           approval_status
    FROM swimming_pools
    WHERE id = ${poolId}
    LIMIT 1
  `);

  if (!poolRows.rows.length) {
    blockers.push("POOL_NOT_FOUND");
    return { ready: false, missing, blockers };
  }

  const p = poolRows.rows[0] as any;
  const hasEntitlement = p.x_paid === true || p.x_manual === true;
  if (!hasEntitlement) {
    missing.push("X_ENTITLEMENT: x_paid_entitlement OR x_manual_entitlement 중 하나 이상이 true여야 합니다");
    blockers.push("NO_ENTITLEMENT");
  }
  if (p.x_force === true) {
    blockers.push("X_FORCE_DISABLED: x_force_disabled=true 상태에서는 READY 불가");
  }
  if (p.approval_status !== "approved") {
    blockers.push(`POOL_NOT_APPROVED: approval_status=${p.approval_status}`);
  }

  const subRows = await db.execute(sql`
    SELECT id, setup_status, submitted_at
    FROM x_setup_submissions
    WHERE pool_id = ${poolId}
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  if (!subRows.rows.length) {
    missing.push("X_SETUP_SUBMISSION: Pool Admin이 X Setup 제출 flow를 아직 시작하지 않았습니다");
    blockers.push("NO_SETUP_SUBMISSION");
    return { ready: false, missing, blockers };
  }

  const currRows = await db.execute(sql`
    SELECT id FROM x_setup_files
    WHERE pool_id   = ${poolId}
      AND file_type = 'curriculum'
      AND is_current = true
      AND deleted_at IS NULL
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  if (!currRows.rows.length) {
    missing.push("CURRICULUM_FILE: curriculum DOCX 파일이 업로드되지 않았습니다");
    blockers.push("NO_CURRICULUM_FILE");
  }

  return {
    ready:    blockers.length === 0,
    missing,
    blockers,
  };
}
