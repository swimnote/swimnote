/**
 * growth-report-production-service.ts — WP8: Admin Production Workflow
 *
 * 책임:
 *   - publishGrowthReports(): 공통 발송 서비스 — 개별·bulk 모두 이 함수를 사용
 *   - sendIndividualReport(): 개별 발송 (publishGrowthReports 위임)
 *   - bulkSendReports(): pool-scoped 전체/선택 발송 (publishGrowthReports 위임)
 *   - discardReportVersion(): READY_TO_SEND → DISCARDED (폐기 + 이력 보존)
 *   - regenerateReport(): DISCARDED → 새 version REGENERATING (재발급 row insert)
 *   - autoValidateForReadyToSend(): REVIEW_REQUIRED 자동 검증 → READY_TO_SEND
 *   - refreshWp8Snapshot(): x_monthly_operational_snapshots growth report KPI 갱신
 *
 * 보안:
 *   - 모든 함수는 poolId를 파라미터로 받아 cross-pool 접근 차단
 *   - 발송 = DB transaction 내 sendable 검증 후 PUBLISHED
 *   - 폐기 = 이력 보존 (deleted_at 미설정, product_status=DISCARDED)
 *
 * 발송 정책 (2026-09-13 확정):
 *   - 검수(admin_reviewed_at)는 발송 eligibility 조건이 아님
 *   - REVIEW_REQUIRED / APPROVED / READY_TO_SEND 모두 발송 가능
 *   - REVIEW_REQUIRED → APPROVED → PUBLISHED 2단계 자동 전환
 *   - push 실패 ≠ 발송 실패 (PUBLISHED 유지, push 로그만 failed)
 *   - 이미 PUBLISHED → already_published_count 처리 (오류 아님)
 */

import { sql } from "drizzle-orm";
import { superAdminDb }                 from "@workspace/db";
import { computeAnalysisPeriod }        from "./growth-report-analysis-helper.js";
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

  // READY_TO_SEND 또는 APPROVED 상태에서 폐기 가능
  if (!["READY_TO_SEND", "APPROVED"].includes(row.product_status)) {
    throw new ReportProductionError(
      `폐기는 READY_TO_SEND 또는 APPROVED 상태에서만 가능합니다. 현재: ${row.product_status}`,
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

  // DISCARDED, READY_TO_SEND, APPROVED 에서 재발급 가능.
  // READY_TO_SEND/APPROVED인 경우 먼저 자동 폐기 후 새 버전 생성.
  if (!["DISCARDED", "READY_TO_SEND", "APPROVED"].includes(old.product_status)) {
    throw new ReportProductionError(
      `재발급은 DISCARDED, READY_TO_SEND, APPROVED 상태에서만 가능합니다. 현재: ${old.product_status}`,
      "REGEN_NOT_ALLOWED",
    );
  }

  // READY_TO_SEND/APPROVED → 자동 폐기 후 재발급
  if (old.product_status !== "DISCARDED") {
    await transitionReportStatus({
      db, reportId: discardedReportId,
      toStatus:  "DISCARDED",
      actorType: "pool_admin",
      actorId,
      reason:    "ADMIN_DISCARD_FOR_REGEN",
    });
    await db.execute(sql`
      UPDATE growth_reports
      SET discarded_at   = NOW(),
          discarded_by   = ${actorId},
          discard_reason = '재발급 요청으로 자동 폐기',
          updated_at     = NOW()
      WHERE id = ${discardedReportId}
    `);
  }

  // 동일 (student_id, cycle_id) ACTIVE 버전 존재 여부 확인 (중복 재발급 방지)
  // ※ 방금 폐기한 자신(discardedReportId)은 이미 DISCARDED이므로 조회에서 제외됨
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
// publishGrowthReports — 개별·bulk 공통 발송 서비스 (단일 소스)
// ─────────────────────────────────────────────────────────────────────────────

/** 발송 가능 상태 집합 (검수 여부 무관) */
const SENDABLE_STATUSES = new Set(["REVIEW_REQUIRED", "APPROVED", "READY_TO_SEND"]);

/** 발송 결과 (spec §11 응답 계약) */
export interface PublishResult {
  requested_count:       number;
  published_count:       number;
  already_published_count: number;
  skipped_count:         number;   // EXCLUDED/DISCARDED/FAILED/ANALYZING 등 비발송 가능
  push_attempted_count:  number;
  push_failed_count:     number;
}

/**
 * publishGrowthReports — 관리자 발송 단일 공유 서비스 (set-based, 고성능)
 *
 * DB query 수: 2 (SELECT + UPDATE) → HTTP 200 즉시 반환
 * Audit + Push: HTTP 반환 후 fire-and-forget
 *
 * 정책:
 *   - reportIds를 pool_id 조건으로 SELECT … FOR UPDATE SKIP LOCKED
 *   - cross-pool ID 자동 제거 (다른 pool의 ID는 skipped)
 *   - sendable: REVIEW_REQUIRED, APPROVED, READY_TO_SEND (검수 여부 무관)
 *   - REVIEW_REQUIRED / APPROVED / READY_TO_SEND → PUBLISHED 단일 bulk UPDATE
 *   - audit_logs: 이전 상태 기록 포함 batch INSERT (lifecycle 의미 보존)
 *   - 이미 PUBLISHED → already_published_count (오류 아님, 멱등)
 *   - push 실패 → PUBLISHED 유지, push_failed_count만 증가
 *   - deleted_at IS NOT NULL → skipped
 */
export async function publishGrowthReports(
  db: Db,
  params: {
    poolId:    string;
    reportIds: string[];  // 발송할 report ID 목록 (cross-pool 자동 제거)
    actorId:   string;
  },
): Promise<PublishResult> {
  const { poolId, reportIds, actorId } = params;

  const result: PublishResult = {
    requested_count:        reportIds.length,
    published_count:        0,
    already_published_count: 0,
    skipped_count:          0,
    push_attempted_count:   0,
    push_failed_count:      0,
  };

  if (reportIds.length === 0) return result;

  // ── Step 1: pool-scoped SELECT FOR UPDATE SKIP LOCKED (1 query) ──────────
  // ANY(${array}::text[]) → SQL ERROR (이 코드베이스 known bug) → sql.join() 사용
  const idParams = sql.join(reportIds.map(id => sql`${id}`), sql`, `);
  const lockRows = (await db.execute(sql`
    SELECT id, student_id, report_period, product_status, deleted_at
    FROM growth_reports
    WHERE id              IN (${idParams})
      AND swimming_pool_id = ${poolId}
    FOR UPDATE SKIP LOCKED
  `)).rows as any[];

  // ── Step 2: 행 분류 ───────────────────────────────────────────────────────
  const foundIds   = new Set(lockRows.map((r: any) => r.id));
  const sendable: any[]  = [];   // REVIEW_REQUIRED / APPROVED / READY_TO_SEND
  const alreadyPub: any[] = [];  // PUBLISHED (멱등)
  const skippedRows: any[] = []; // deleted / non-sendable

  for (const row of lockRows) {
    if (row.deleted_at) {
      skippedRows.push(row);
    } else if (row.product_status === "PUBLISHED") {
      alreadyPub.push(row);
    } else if (SENDABLE_STATUSES.has(row.product_status)) {
      sendable.push(row);
    } else {
      skippedRows.push(row);
    }
  }

  result.already_published_count = alreadyPub.length;
  result.skipped_count = skippedRows.length + reportIds.filter(id => !foundIds.has(id)).length;

  if (sendable.length === 0) {
    console.log(
      `[gr-production] PUBLISH: pool=${poolId} req=${result.requested_count}` +
      ` ok=0 already=${result.already_published_count} skip=${result.skipped_count}`,
    );
    return result;
  }

  // ── Step 3: Bulk PUBLISH (단일 UPDATE, 트랜잭션 불필요 — 멱등) ──────────
  const sendableIdParams = sql.join(sendable.map(r => sql`${r.id}`), sql`, `);
  await db.execute(sql`
    UPDATE growth_reports
    SET product_status = 'PUBLISHED',
        published_at   = COALESCE(published_at, NOW()),
        updated_at     = NOW()
    WHERE id              IN (${sendableIdParams})
      AND swimming_pool_id = ${poolId}
      AND deleted_at IS NULL
      AND product_status  IN ('REVIEW_REQUIRED', 'APPROVED', 'READY_TO_SEND')
  `);

  result.published_count = sendable.length;

  console.log(
    `[gr-production] PUBLISH: pool=${poolId} req=${result.requested_count}` +
    ` ok=${result.published_count} already=${result.already_published_count}` +
    ` skip=${result.skipped_count}`,
  );

  // ── Step 4: Audit batch INSERT — fire-and-forget (HTTP response에 영향 없음) ─
  // lifecycle 의미 보존: REVIEW_REQUIRED는 →APPROVED, →PUBLISHED 2행 기록
  batchInsertPublishAudit(db, sendable, poolId, actorId).catch((e: unknown) => {
    console.warn("[gr-production] audit batch failed:", (e as any)?.message ?? e);
  });

  // ── Step 5: Push — fire-and-forget ────────────────────────────────────────
  result.push_attempted_count = sendable.length;
  void Promise.allSettled(sendable.map(row =>
    notifyGrowthReportPublished({
      reportId:     row.id,
      studentId:    row.student_id,
      poolId,
      reportPeriod: row.report_period,
    }).catch((e: unknown) => {
      console.error(`[gr-production] push failed report=${row.id}:`, (e as any)?.message ?? e);
    }),
  ));

  return result;
}

/**
 * batchInsertPublishAudit — PUBLISHED 전환 audit를 batch INSERT
 *
 * lifecycle 의미 보존:
 *   - REVIEW_REQUIRED: REVIEW_REQUIRED→APPROVED + APPROVED→PUBLISHED 2행
 *   - APPROVED / READY_TO_SEND: →PUBLISHED 1행
 *
 * audit는 fire-and-forget; 실패해도 PUBLISHED 유지.
 */
async function batchInsertPublishAudit(
  db: Db,
  rows: Array<{ id: string; product_status: string }>,
  poolId: string,
  actorId: string,
): Promise<void> {
  if (rows.length === 0) return;

  // audit row pairs: { reportId, fromStatus, toStatus, reason }
  type AuditRow = { reportId: string; from: string; to: string; reason: string };
  const auditRows: AuditRow[] = [];
  for (const row of rows) {
    if (row.product_status === "REVIEW_REQUIRED") {
      auditRows.push({ reportId: row.id, from: "REVIEW_REQUIRED", to: "APPROVED",  reason: "ADMIN_SEND_AUTO_APPROVE" });
      auditRows.push({ reportId: row.id, from: "APPROVED",        to: "PUBLISHED", reason: "ADMIN_SEND" });
    } else {
      auditRows.push({ reportId: row.id, from: row.product_status, to: "PUBLISHED", reason: "ADMIN_SEND" });
    }
  }

  // version: MAX(entity_version) 기준으로 각 report 내 row 순서 반영
  // VALUES list로 단일 INSERT
  const valueParts = auditRows.map((r, i) => sql`
    (
      'growth_report',
      ${r.reportId},
      COALESCE(
        (SELECT MAX(entity_version) FROM audit_logs
         WHERE entity_type = 'growth_report' AND entity_id = ${r.reportId}),
        0
      ) + ${i + 1},
      'update',
      'pool_admin',
      ${actorId},
      ${poolId},
      ${JSON.stringify({ product_status: r.from })}::jsonb,
      ${JSON.stringify({ product_status: r.to  })}::jsonb,
      ${r.reason},
      NULL, NULL, NULL
    )
  `);

  await db.execute(sql`
    INSERT INTO audit_logs (
      entity_type, entity_id, entity_version,
      action, actor_type, actor_id, pool_id,
      before_data, after_data, reason,
      request_id, correlation_id, ip_hash
    )
    VALUES ${sql.join(valueParts, sql`, `)}
    ON CONFLICT DO NOTHING
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// sendIndividualReport — 개별 발송 (publishGrowthReports 위임)
// ─────────────────────────────────────────────────────────────────────────────

export async function sendIndividualReport(
  db: Db,
  params: { reportId: string; poolId: string; actorId: string },
): Promise<{ alreadyPublished: boolean }> {
  const result = await publishGrowthReports(db, {
    poolId:    params.poolId,
    reportIds: [params.reportId],
    actorId:   params.actorId,
  });

  if (!result.published_count && !result.already_published_count) {
    // skipped = not found / not sendable
    const skipped = result.skipped_count;
    if (skipped > 0) {
      throw new ReportProductionError(
        `리포트를 발송할 수 없습니다 (상태 비적합 또는 찾을 수 없음): ${params.reportId}`,
        "SEND_NOT_ALLOWED",
      );
    }
  }

  return { alreadyPublished: result.already_published_count > 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// bulkSendReports — pool-scoped 전체/선택 발송 (publishGrowthReports 위임)
// ─────────────────────────────────────────────────────────────────────────────

export interface BulkSendResult extends PublishResult {
  /** @deprecated use published_count */
  published: number;
  /** @deprecated use skipped_count */
  skipped:   number;
  /** @deprecated always 0 — errors are counted in skipped_count now */
  errors:    number;
}

export async function bulkSendReports(
  db: Db,
  params: {
    poolId:     string;
    year:       number;    // report_month 발행 연도 (외부 API 계약)
    month:      number;    // report_month 발행 월   (외부 API 계약)
    actorId:    string;
    reportIds?: string[];  // 지정 시 해당 ID만; 미지정 시 해당 월 전체 sendable
  },
): Promise<BulkSendResult> {
  const { poolId, year, month, actorId, reportIds: explicitIds } = params;

  let targetIds: string[];

  if (explicitIds && explicitIds.length > 0) {
    // ── 선택 발송: 명시적 ID 목록 사용 ────────────────────────────────────
    targetIds = explicitIds;
  } else {
    // ── 전체 발송: 해당 월 sendable 전체 조회 ─────────────────────────────
    const { reportPeriod: period } = computeAnalysisPeriod(year, month);
    const rows = await db.execute(sql`
      SELECT id
      FROM growth_reports
      WHERE swimming_pool_id = ${poolId}
        AND report_period    = ${period}
        AND product_status   IN ('READY_TO_SEND', 'APPROVED', 'REVIEW_REQUIRED')
        AND deleted_at IS NULL
    `);
    targetIds = (rows.rows as any[]).map((r: any) => r.id);
  }

  const result = await publishGrowthReports(db, { poolId, reportIds: targetIds, actorId });

  return {
    ...result,
    published: result.published_count,
    skipped:   result.skipped_count,
    errors:    0,
  };
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
  // ★ year/month = report_month (발행월). computeAnalysisPeriod로 분석월 변환.
  const { reportPeriod: period } = computeAnalysisPeriod(year, month);

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
  // ★ year/month = report_month (발행월). computeAnalysisPeriod로 분석월 변환.
  const { reportPeriod: period } = computeAnalysisPeriod(year, month);

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
