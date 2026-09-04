/**
 * xmode-readiness.ts
 *
 * validateXModeReadiness — READY 전환 전 필수 조건 검증
 *
 * PATCH /super/operators/:id/xmode 에서 READY 전환 전에 반드시 호출.
 * 실제 DB 상태(x_setup_submissions, x_setup_files, swimming_pools)를 읽어
 * readiness를 검증한다.
 *
 * Rules (기존 schema를 authority로 사용 — 임의 필드 추가 없음):
 *   1. Pool에 effective entitlement 존재 (x_paid OR x_manual)
 *   2. x_setup_submissions row 존재 (Pool Admin이 setup 제출 flow를 시작했음)
 *   3. curriculum 파일 업로드됨 (x_setup_files WHERE file_type='curriculum' AND is_current=true)
 *
 * NOTE: setup_status='SUBMITTED'/'APPROVED'는 requirement가 아님.
 *       Curriculum 파일 존재 여부가 핵심 prerequisite.
 *
 * AI calls:  0
 * DB write:  NO
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

type Db = NodePgDatabase<any> | LibSQLDatabase<any> | any;

export interface XModeReadinessResult {
  /** true = 모든 조건 충족, READY 전환 가능 */
  ready:    boolean;
  /** 누락된 항목 목록 */
  missing:  string[];
  /** 차단 이유 목록 */
  blockers: string[];
}

/**
 * validateXModeReadiness
 *
 * @param poolId   swimming_pools.id
 * @param db       drizzle db instance (superAdminDb 등)
 * @returns        {ready, missing, blockers}
 */
export async function validateXModeReadiness(
  poolId: string,
  db:     Db,
): Promise<XModeReadinessResult> {
  const missing:  string[] = [];
  const blockers: string[] = [];

  // ── 1. Pool + entitlement 확인 ────────────────────────────────────────────
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

  // ── 2. x_setup_submissions row 존재 확인 ─────────────────────────────────
  const subRows = await db.execute(sql`
    SELECT id, setup_status, curriculum_status, submitted_at
    FROM x_setup_submissions
    WHERE pool_id = ${poolId}
    LIMIT 1
  `);

  if (!subRows.rows.length) {
    missing.push("X_SETUP_SUBMISSION: Pool Admin이 X Setup 제출 flow를 아직 시작하지 않았습니다");
    blockers.push("NO_SETUP_SUBMISSION");
    // curriculum check는 submission이 없으면 의미 없음
    return { ready: false, missing, blockers };
  }

  const sub = subRows.rows[0] as any;
  // setup_status 참고값만 기록 — 현재 SUBMITTED/APPROVED 모두 허용
  if (sub.submitted_at === null) {
    missing.push("X_SETUP_NOT_SUBMITTED: Pool Admin이 Setup을 아직 제출하지 않았습니다 (POST /api/x-setup/submit 미호출)");
  }

  // ── 3. Curriculum 파일 업로드 확인 ────────────────────────────────────────
  const currRows = await db.execute(sql`
    SELECT id, original_filename, uploaded_at
    FROM x_setup_files
    WHERE pool_id   = ${poolId}
      AND file_type = 'curriculum'
      AND is_current = true
      AND deleted_at IS NULL
    LIMIT 1
  `);

  if (!currRows.rows.length) {
    missing.push("CURRICULUM_FILE: curriculum DOCX 파일이 업로드되지 않았습니다 (POST /api/x-setup/upload/curriculum 미호출)");
    blockers.push("NO_CURRICULUM_FILE");
  }

  const ready = blockers.length === 0 && missing.filter(m => !m.startsWith("X_SETUP_NOT_SUBMITTED")).length === 0;
  // submitted_at 누락은 WARNING만 (curriculum 파일이 있으면 계속 진행 가능)
  return {
    ready:    blockers.length === 0 && !missing.some(m => m.startsWith("CURRICULUM_FILE") || m.startsWith("X_SETUP_SUBMISSION:")),
    missing,
    blockers,
  };
}
