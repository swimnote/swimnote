/**
 * xmode-readiness.ts
 *
 * WP7 REWRITE: checkXPrerequisite — Manual X Grant 실제 전제조건 검증
 *
 * 핵심 원칙 (spec §6, §7):
 *   - "upload record 없음 → Manual Grant 불가"가 아님
 *   - X runtime이 실제로 참조하는 데이터 존재 여부를 기준으로 판단
 *   - upload history 없어도 global X curriculum/template이 이미
 *     code/DB에 존재하면 READY여야 함
 *
 * 실제 prerequisite:
 *   1. Pool이 존재할 것
 *   2. Global diary templates (X 운영 핵심 데이터)가 시스템에 존재할 것
 *      — scope='global' AND status='active' AND version > 0
 *   3. (참고 정보) approval_status
 *
 * 금지:
 *   - x_setup_submissions row 유무 확인 (upload history)
 *   - x_setup_files curriculum 파일 업로드 확인 (upload history)
 *   - xmode_config_status를 blind READY로 강제
 *
 * DB write:  NO
 * AI calls:  0
 */

import { sql } from "drizzle-orm";

type Db = any;

export type XPrerequisiteStatus = "READY" | "NOT_READY";

export interface XPrerequisiteResult {
  /** READY = 모든 실제 X runtime 조건 충족, Manual Grant 가능 */
  status:   XPrerequisiteStatus;
  ready:    boolean;
  /** 운영자가 이해할 수 있는 reason (NOT_READY 시) */
  reason:   string | null;
  /** 구체적 누락 항목 */
  missing:  string[];
  /** pool approval_status (참고) */
  pool_approval_status: string | null;
  /** 시스템 global template 개수 (참고) */
  global_template_count: number;
}

/**
 * checkXPrerequisite
 *
 * WP7 공식 X Manual Grant prerequisite resolver.
 *
 * @param poolId  swimming_pools.id
 * @param db      drizzle-compat db instance (superAdminDb)
 */
export async function checkXPrerequisite(
  poolId: string,
  db: Db,
): Promise<XPrerequisiteResult> {
  const missing: string[] = [];

  // ── 1. Pool 존재 확인 ─────────────────────────────────────────────────────
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
      global_template_count: 0,
    };
  }
  const pool = poolRows.rows[0] as any;

  // ── 2. Global X diary templates 존재 확인 ────────────────────────────────
  // X runtime은 global scope diary templates를 참조한다.
  // 업로드 이력이 아닌 실제 운영 데이터 존재 여부로 판단.
  const tmplRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM diary_templates
    WHERE scope = 'global'
      AND status = 'active'
  `).catch(() => ({ rows: [{ cnt: 0 }] }));

  const globalTemplateCnt = Number((tmplRows.rows[0] as any)?.cnt ?? 0);

  if (globalTemplateCnt === 0) {
    missing.push("GLOBAL_X_TEMPLATES: 시스템에 활성 global diary template이 없습니다. X runtime 운영 불가.");
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
    global_template_count: globalTemplateCnt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy: validateXModeReadiness — 기존 xmode_config_status READY 전환 flow에서
// 사용 가능 (super.ts xmode config-status 관련 다른 endpoint가 있을 경우 재사용).
// Manual Grant에서는 사용하지 않음 (WP7 이후 checkXPrerequisite 사용).
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

  // Legacy: x_setup_submissions + curriculum file check
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
