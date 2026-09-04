/**
 * growth-report-production-service.ts — WP8: Admin Production Workflow
 *
 * 책임:
 *   - discardReportVersion(): READY_TO_SEND → DISCARDED (폐기 + 이력 보존)
 *   - regenerateReport(): DISCARDED → 새 version REGENERATING (재발급 row insert)
 *   - autoValidateForReadyToSend(): REVIEW_REQUIRED 자동 검증 → READY_TO_SEND
 *   - sendIndividualReport(): READY_TO_SEND → PUBLISHED (개별 발송)
 *   - bulkSendReports(): pool-scoped READY_TO_SEND → all PUBLISHED (전체 발송)
 *   - refreshWp8Snapshot(): x_monthly_operational_snapshots growth report KPI 갱신
 *
 * 보안:
 *   - 모든 함수는 poolId를 파라미터로 받아 cross-pool 접근 차단
 *   - 발송 = DB transaction 내 READY_TO_SEND 검증 후 PUBLISHED
 *   - 폐기 = 이력 보존 (deleted_at 미설정, product_status=DISCARDED)
 *
 * 원칙:
 *   - AUTO GENERATE ≠ AUTO SEND (관리자 발송 필수)
 *   - DISCARDED version은 부모 비노출 (PUBLISHED final만 노출)
 *   - 재발급 = 새 row insert (기존 DISCARDED 보존)
 *   - transitionReportStatus 재사용 (audit 자동 기록)
 */

import { sql } from "drizzle-orm";
import { superAdminDb }                 from "@workspace/db";
import {
  transitionReportStatus,
  ReportNotFoundError,
  InvalidTransitionError,
} from "./growth-report-service.js";
import { notifyGrowthReportPublished }  from "../utils/notify.js";

export type Db = typeof superAdminDb;

// ── Discard reasons ───────────────────────────────────────────────────────────

export const DISCARD_REASONS = [
  "글자·레이아웃 오류",
  "내용 오류",
  "데이터 누락",
  "기타",
] as const;

export type DiscardReason = typeof DISCARD_REASONS[number] | string;

// ── Validation result ─────────────────────────────────────────────────────────

export interface ValidationResult {
  ok:     boolean;
  issues: string[];
}

// ── Error types ───────────────────────────────────────────────────────────────

export class ReportProductionError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ReportProductionError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// autoValidateForReadyToSend — 구조 검증
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 관리자에게 올리기 전 서버 자동 구조 검증.
 *
 * AI 2차 판단 없음. 구조 검증만.
 * 실패 시 READY_TO_SEND 전환 금지.
 */
export function autoValidateForReadyToSend(row: {
  report_content:     unknown;
  report_fact_package: unknown;
  sns_summary:        unknown;
  student_id:         string | null;
  swimming_pool_id:   string | null;
  analysis_status:    string | null;
}): ValidationResult {
  const issues: string[] = [];

  // content 존재 및 구조
  if (!row.report_content || typeof row.report_content !== "object" || Array.isArray(row.report_content)) {
    issues.push("report_content 누락 또는 잘못된 형식");
  }
  if (!row.report_fact_package || typeof row.report_fact_package !== "object" || Array.isArray(row.report_fact_package)) {
    issues.push("report_fact_package 누락 또는 잘못된 형식");
  }
  if (!row.sns_summary || typeof row.sns_summary !== "object" || Array.isArray(row.sns_summary)) {
    issues.push("sns_summary 누락 또는 잘못된 형식");
  }

  // 필수 참조
  if (!row.student_id)       issues.push("student_id 누락");
  if (!row.swimming_pool_id) issues.push("swimming_pool_id 누락");

  // analysis_status
  const VALID_ANALYSIS = new Set([
    "COMPLETE",
    "COMPLETE_WITH_QUESTIONS_AVAILABLE",
    "COMPLETE_WITH_PARENT_EVIDENCE",
  ]);
  if (row.analysis_status && !VALID_ANALYSIS.has(row.analysis_status)) {
    issues.push(`analysis_status=${row.analysis_status} — COMPLETE 계열 필요`);
  }

  // report_content 내부 기본 필드
  const rc = row.report_content as Record<string, unknown> | null;
  if (rc && typeof rc === "object") {
    if (!rc["student_name"] && !rc["name"]) {
      issues.push("report_content.student_name 누락 (placeholder 가능성)");
    }
    // placeholder 패턴 탐지
    const contentStr = JSON.stringify(rc);
    if (/{{|<<|__PLACEHOLDER__|\[학생명\]/.test(contentStr)) {
      issues.push("report_content에 placeholder 감지됨");
    }
  }

  return { ok: issues.length === 0, issues };
}

// ─────────────────────────────────────────────────────────────────────────────
// transitionToReadyToSend — REVIEW_REQUIRED → READY_TO_SEND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배치 완료 후 REVIEW_REQUIRED 리포트를 자동 검증 후 READY_TO_SEND로 전환.
 *
 * - 자동 validation FAIL → REVIEW_REQUIRED 유지 (관리자가 확인 필요)
 * - 성공 → READY_TO_SEND (부모 비노출; 관리자 발송 대기)
 */
export async function transitionToReadyToSend(
  db: Db,
  reportId: string,
  actorId: string = "SYSTEM_WP8_BATCH",
): Promise<{ success: boolean; reason?: string }> {
  // fetch current state
  const r = await db.execute(sql`
    SELECT id, product_status, swimming_pool_id,
           report_content, report_fact_package, sns_summary,
           student_id, analysis_status, deleted_at
    FROM growth_reports
    WHERE id = ${reportId}
    LIMIT 1
  `);
  if (!r.rows.length) throw new ReportNotFoundError(reportId);
  const row = r.rows[0] as any;
  if (row.deleted_at) throw new ReportNotFoundError(reportId);

  if (row.product_status === "READY_TO_SEND") {
    return { success: true };  // idempotent
  }
  if (row.product_status !== "REVIEW_REQUIRED") {
    return { success: false, reason: `product_status=${row.product_status} — REVIEW_REQUIRED 필요` };
  }

  // auto validate
  const validation = autoValidateForReadyToSend(row);
  if (!validation.ok) {
    console.warn(`[gr-production] VALIDATION_FAIL report=${reportId} issues=${validation.issues.join("; ")}`);
    return { success: false, reason: `validation_failed: ${validation.issues.join("; ")}` };
  }

  // transition
  await transitionReportStatus({
    db, reportId,
    toStatus:  "READY_TO_SEND",
    actorType: "system",
    actorId,
    reason:    "BATCH_AUTO_VALIDATE_PASS",
  });

  console.log(`[gr-production] READY_TO_SEND: report=${reportId}`);
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// discardReportVersion — READY_TO_SEND → DISCARDED
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscardParams {
  reportId:   string;
  poolId:     string;
  actorId:    string;
  reason:     DiscardReason;
  memo?:      string;
}

export async function discardReportVersion(
  db: Db,
  params: DiscardParams,
): Promise<void> {
  const { reportId, poolId, actorId, reason, memo } = params;

  // Fetch + pool guard
  const r = await db.execute(sql`
    SELECT id, product_status, swimming_pool_id, deleted_at
    FROM growth_reports
    WHERE id = ${reportId}
      AND swimming_pool_id = ${poolId}
    FOR UPDATE
  `);
  if (!r.rows.length) throw new ReportNotFoundError(reportId);
  const row = r.rows[0] as any;
  if (row.deleted_at) throw new ReportNotFoundError(reportId);

  if (row.product_status === "DISCARDED") return;  // idempotent

  if (row.product_status !== "READY_TO_SEND") {
    throw new ReportProductionError(
      `폐기는 READY_TO_SEND 상태에서만 가능합니다. 현재: ${row.product_status}`,
      "DISCARD_NOT_ALLOWED",
    );
  }

  // Transition first (audit)
  await transitionReportStatus({
    db, reportId,
    toStatus:  "DISCARDED",
    actorType: "pool_admin",
    actorId,
    reason:    `ADMIN_DISCARD: ${reason}`,
  });

  // Record discard metadata
  const fullReason = memo ? `${reason} — ${memo}` : reason;
  await db.execute(sql`
    UPDATE growth_reports
    SET discarded_at   = NOW(),
        discarded_by   = ${actorId},
        discard_reason = ${fullReason},
        updated_at     = NOW()
    WHERE id = ${reportId}
  `);

  console.log(`[gr-production] DISCARDED: report=${reportId} actor=${actorId} reason="${fullReason}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// regenerateReport — DISCARDED 후 새 version 생성
// ─────────────────────────────────────────────────────────────────────────────

export interface RegenerateResult {
  newReportId: string;
  versionNumber: number;
}

export async function regenerateReport(
  db: Db,
  params: {
    discardedReportId: string;
    poolId:            string;
    actorId:           string;
  },
): Promise<RegenerateResult> {
  const { discardedReportId, poolId, actorId } = params;

  // Fetch discarded version → get cycle_id, student_id, batch_job_id
  const r = await db.execute(sql`
    SELECT id, product_status, swimming_pool_id, deleted_at,
           cycle_id, student_id, report_period,
           period_start, period_end, version_number, batch_job_id
    FROM growth_reports
    WHERE id = ${discardedReportId}
      AND swimming_pool_id = ${poolId}
    FOR UPDATE
  `);
  if (!r.rows.length) throw new ReportNotFoundError(discardedReportId);
  const old = r.rows[0] as any;
  if (old.deleted_at) throw new ReportNotFoundError(discardedReportId);

  if (old.product_status !== "DISCARDED") {
    throw new ReportProductionError(
      `재발급은 DISCARDED 상태에서만 가능합니다. 현재: ${old.product_status}`,
      "REGEN_NOT_ALLOWED",
    );
  }

  // 동일 (student_id, cycle_id) ACTIVE 버전 존재 여부 확인 (중복 재발급 방지)
  const activeCheck = await db.execute(sql`
    SELECT id, product_status FROM growth_reports
    WHERE student_id       = ${old.student_id}
      AND cycle_id         = ${old.cycle_id}
      AND product_status  != 'DISCARDED'
      AND deleted_at IS NULL
    LIMIT 1
  `);
  if (activeCheck.rows.length > 0) {
    const active = activeCheck.rows[0] as any;
    throw new ReportProductionError(
      `이미 진행 중인 버전이 있습니다. id=${active.id} status=${active.product_status}`,
      "REGEN_DUPLICATE",
    );
  }

  // 새 version_number = max existing + 1
  const maxVerRes = await db.execute(sql`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver
    FROM growth_reports
    WHERE student_id = ${old.student_id}
      AND cycle_id   = ${old.cycle_id}
  `);
  const nextVer = Number((maxVerRes.rows[0] as any)?.next_ver ?? 2);

  // 새 row INSERT (REGENERATING 상태)
  const newIdRes = await db.execute(sql`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id, cycle_id,
      report_period, period_start, period_end,
      product_status, version_number, batch_job_id,
      created_at, updated_at
    )
    VALUES (
      ${old.student_id}, ${poolId}, ${old.cycle_id},
      ${old.report_period}, ${old.period_start}, ${old.period_end},
      'REGENERATING', ${nextVer}, ${old.batch_job_id ?? null},
      NOW(), NOW()
    )
    RETURNING id
  `);
  const newReportId = (newIdRes.rows[0] as any).id as string;

  console.log(`[gr-production] REGENERATED: old=${discardedReportId} new=${newReportId} ver=${nextVer} actor=${actorId}`);
  return { newReportId, versionNumber: nextVer };
}

// ─────────────────────────────────────────────────────────────────────────────
// sendIndividualReport — READY_TO_SEND → PUBLISHED (개별 발송)
// ─────────────────────────────────────────────────────────────────────────────

export async function sendIndividualReport(
  db: Db,
  params: {
    reportId: string;
    poolId:   string;
    actorId:  string;
  },
): Promise<{ alreadyPublished: boolean }> {
  const { reportId, poolId, actorId } = params;

  const r = await db.execute(sql`
    SELECT id, product_status, swimming_pool_id, deleted_at,
           student_id, report_period, report_content, report_fact_package, sns_summary
    FROM growth_reports
    WHERE id = ${reportId}
      AND swimming_pool_id = ${poolId}
    FOR UPDATE
  `);
  if (!r.rows.length) throw new ReportNotFoundError(reportId);
  const row = r.rows[0] as any;
  if (row.deleted_at) throw new ReportNotFoundError(reportId);

  if (row.product_status === "PUBLISHED") {
    return { alreadyPublished: true };
  }

  if (row.product_status !== "READY_TO_SEND") {
    throw new ReportProductionError(
      `발송은 READY_TO_SEND 상태에서만 가능합니다. 현재: ${row.product_status}`,
      "SEND_NOT_ALLOWED",
    );
  }

  // READY_TO_SEND → PUBLISHED
  await transitionReportStatus({
    db, reportId,
    toStatus:  "PUBLISHED",
    actorType: "pool_admin",
    actorId,
    reason:    "ADMIN_INDIVIDUAL_SEND",
  });

  // published_at 기록
  await db.execute(sql`
    UPDATE growth_reports
    SET published_at = NOW(), updated_at = NOW()
    WHERE id = ${reportId}
  `);

  console.log(`[gr-production] PUBLISHED (individual): report=${reportId} actor=${actorId}`);

  // 부모 push (fire-and-forget)
  void notifyGrowthReportPublished({
    reportId,
    studentId:   row.student_id,
    poolId,
    reportPeriod: row.report_period,
  }).catch((e: unknown) => {
    console.error(`[gr-production] parent push failed report=${reportId}:`, e);
  });

  return { alreadyPublished: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkSendReports — pool-scoped READY_TO_SEND 전체 발송
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkSendResult {
  published:   number;
  skipped:     number;  // DISCARDED/FAILED/REGENERATING/PUBLISHED
  errors:      number;
}

export async function bulkSendReports(
  db: Db,
  params: {
    poolId:  string;
    year:    number;
    month:   number;
    actorId: string;
  },
): Promise<BulkSendResult> {
  const { poolId, year, month, actorId } = params;

  // 해당 pool/year/month의 READY_TO_SEND 리포트 전체 조회
  // report_period = 'YYYY-MM' (이전달)
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const period    = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  const candidates = await db.execute(sql`
    SELECT id, student_id, report_period
    FROM growth_reports
    WHERE swimming_pool_id = ${poolId}
      AND report_period    = ${period}
      AND product_status   = 'READY_TO_SEND'
      AND deleted_at IS NULL
    FOR UPDATE SKIP LOCKED
  `);

  const result: BulkSendResult = { published: 0, skipped: 0, errors: 0 };

  for (const row of candidates.rows as any[]) {
    try {
      await transitionReportStatus({
        db,
        reportId:  row.id,
        toStatus:  "PUBLISHED",
        actorType: "pool_admin",
        actorId,
        reason:    "ADMIN_BULK_SEND",
      });

      await db.execute(sql`
        UPDATE growth_reports
        SET published_at = NOW(), updated_at = NOW()
        WHERE id = ${row.id}
      `);

      result.published++;

      // 부모 push (fire-and-forget)
      void notifyGrowthReportPublished({
        reportId:    row.id,
        studentId:   row.student_id,
        poolId,
        reportPeriod: row.report_period,
      }).catch((e: unknown) => {
        console.error(`[gr-production] bulk send parent push failed report=${row.id}:`, e);
      });

    } catch (err: any) {
      if (err?.name === "InvalidTransitionError") {
        result.skipped++;
      } else {
        result.errors++;
        console.error(`[gr-production] bulk send error report=${row.id}:`, err.message);
      }
    }
  }

  console.log(
    `[gr-production] BULK_SEND: pool=${poolId} period=${period} ` +
    `published=${result.published} skipped=${result.skipped} errors=${result.errors}`
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// getMonthlyReportSummary — admin report-hub 요약
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthlyReportSummary {
  year:             number;
  month:            number;
  period:           string;    // 'YYYY-MM' (이전달)
  target_count:     number;    // 대상 학생 수
  ready_count:      number;    // READY_TO_SEND
  published_count:  number;    // PUBLISHED
  failed_count:     number;    // FAILED (최종)
  regenerating_count: number;  // REGENERATING + ANALYZING 계열
  discarded_count:  number;    // DISCARDED (이력)
  batch_status:     string | null;
}

export async function getMonthlyReportSummary(
  db: Db,
  params: { poolId: string; year: number; month: number },
): Promise<MonthlyReportSummary> {
  const { poolId, year, month } = params;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const period    = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  // 최신 버전 집계: 동일 (student, cycle)에서 최신 version_number만
  const kpiRes = await db.execute(sql`
    WITH latest AS (
      -- 학생별 최신 활성 버전 (DISCARDED 제외)
      SELECT DISTINCT ON (student_id, cycle_id)
        id, product_status, student_id, cycle_id
      FROM growth_reports
      WHERE swimming_pool_id = ${poolId}
        AND report_period    = ${period}
        AND deleted_at IS NULL
        AND cycle_id IS NOT NULL
        AND product_status != 'DISCARDED'
      ORDER BY student_id, cycle_id, version_number DESC NULLS LAST, created_at DESC
    ),
    discarded_hist AS (
      SELECT COUNT(*) AS cnt
      FROM growth_reports
      WHERE swimming_pool_id = ${poolId}
        AND report_period    = ${period}
        AND deleted_at IS NULL
        AND product_status   = 'DISCARDED'
    )
    SELECT
      COUNT(*) FILTER (WHERE product_status != 'NOT_OPEN')     AS target_count,
      COUNT(*) FILTER (WHERE product_status = 'READY_TO_SEND') AS ready_count,
      COUNT(*) FILTER (WHERE product_status = 'PUBLISHED')      AS published_count,
      COUNT(*) FILTER (WHERE product_status = 'FAILED')         AS failed_count,
      COUNT(*) FILTER (WHERE product_status IN ('REGENERATING','ANALYZING','PREANALYZING','OPEN','READY_FOR_ANALYSIS')) AS regenerating_count,
      (SELECT cnt FROM discarded_hist)                           AS discarded_count
    FROM latest
  `);

  const kpi = kpiRes.rows[0] as any;

  // batch status
  const batchRes = await db.execute(sql`
    SELECT status FROM growth_report_batch_jobs
    WHERE swimming_pool_id = ${poolId}
      AND year = ${year}
      AND month = ${month}
      AND job_type = 'MONTHLY_AUTO'
    LIMIT 1
  `);
  const batchStatus = batchRes.rows.length
    ? (batchRes.rows[0] as any).status as string
    : null;

  return {
    year, month, period,
    target_count:      Number(kpi?.target_count     ?? 0),
    ready_count:       Number(kpi?.ready_count      ?? 0),
    published_count:   Number(kpi?.published_count  ?? 0),
    failed_count:      Number(kpi?.failed_count     ?? 0),
    regenerating_count: Number(kpi?.regenerating_count ?? 0),
    discarded_count:   Number(kpi?.discarded_count  ?? 0),
    batch_status:      batchStatus,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// refreshWp8Snapshot — x_monthly_operational_snapshots WP8 KPI 갱신
// ─────────────────────────────────────────────────────────────────────────────

/**
 * growth_report KPI → x_monthly_operational_snapshots UPSERT
 *
 * RAW recount 방식 (WP9/WP10 동일 원칙):
 *   - +1 only 금지
 *   - UPSERT overwrite (해당 필드만)
 *   - WP9/WP10 컬럼 절대 건드리지 않음
 *
 * KPI 정의:
 *   - target_count: 해당 pool/month에 report가 만들어진 유니크 학생 수 (logical)
 *   - generated_count: READY_TO_SEND/PUBLISHED 인 학생 수 (발송 가능 리포트 생성됨)
 *   - failed_count: 최신 version이 FAILED인 학생 수 (발송 불가)
 *   - sent_count: PUBLISHED인 학생 수 (실제 발송)
 *   (재발급 v1/v2/v3: logical student 기준 1건 — 중복 count 금지)
 */
export async function refreshWp8Snapshot(
  db: Db,
  params: { poolId: string; year: number; month: number },
): Promise<void> {
  const { poolId, year, month } = params;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const period    = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;

  const res = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (student_id, cycle_id)
        student_id, product_status
      FROM growth_reports
      WHERE swimming_pool_id = ${poolId}
        AND report_period    = ${period}
        AND deleted_at IS NULL
        AND cycle_id IS NOT NULL
      ORDER BY student_id, cycle_id, version_number DESC NULLS LAST, created_at DESC
    )
    SELECT
      COUNT(*)                                                                        AS target_count,
      COUNT(*) FILTER (WHERE product_status IN ('READY_TO_SEND','PUBLISHED'))         AS generated_count,
      COUNT(*) FILTER (WHERE product_status = 'FAILED')                               AS failed_count,
      COUNT(*) FILTER (WHERE product_status = 'PUBLISHED')                            AS sent_count
    FROM latest
    WHERE product_status != 'NOT_OPEN'
  `);

  const kpi = res.rows[0] as any;

  await db.execute(sql`
    INSERT INTO x_monthly_operational_snapshots (
      swimming_pool_id, year, month,
      growth_report_target_count,
      growth_report_generated_count,
      growth_report_failed_count,
      growth_report_sent_count,
      updated_at
    )
    VALUES (
      ${poolId}, ${year}, ${month},
      ${Number(kpi?.target_count    ?? 0)},
      ${Number(kpi?.generated_count ?? 0)},
      ${Number(kpi?.failed_count    ?? 0)},
      ${Number(kpi?.sent_count      ?? 0)},
      NOW()
    )
    ON CONFLICT (swimming_pool_id, year, month)
    DO UPDATE SET
      growth_report_target_count    = EXCLUDED.growth_report_target_count,
      growth_report_generated_count = EXCLUDED.growth_report_generated_count,
      growth_report_failed_count    = EXCLUDED.growth_report_failed_count,
      growth_report_sent_count      = EXCLUDED.growth_report_sent_count,
      updated_at                    = NOW()
  `);

  console.log(
    `[gr-production] KPI refreshed pool=${poolId} period=${period} ` +
    `target=${kpi?.target_count} gen=${kpi?.generated_count} failed=${kpi?.failed_count} sent=${kpi?.sent_count}`
  );
}
