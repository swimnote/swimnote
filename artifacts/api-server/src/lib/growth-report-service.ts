/**
 * growth-report-service.ts — GR1: Growth Report Product Lifecycle Service
 *
 * 범위 (GR1):
 *   - Product Status / Parent Input Status / Cycle Status 타입
 *   - transitionReportStatus(): 중앙 상태 전환 서비스 (route별 하드코딩 금지)
 *   - createReportCycle(): cycle 생성 (idempotent)
 *   - createGrowthReport(): report 생성 (concurrency-safe)
 *   - getPublishedReportHistory(): longitudinal history 조회
 *   - audit: 기존 audit_logs / next_audit_version 재사용
 *
 * 금지 (GR1):
 *   - ENGINE API 호출 → GR3
 *   - Scheduler → GR2
 *   - Parent Question UI → GR4
 *   - Teacher Review UI → GR5
 *   - Feed → GR6
 *   - Push → GR7
 *
 * 원칙:
 *   - APP은 metric_id / metric_states / product content를 재해석하지 않음
 *   - ENGINE 결과는 opaque structured data로 저장
 *   - 질문은 optional (0개 정상, 미응답 시 report 차단 금지)
 *   - PUBLISHED는 terminal (삭제 금지)
 */
import { sql } from "drizzle-orm";
import { superAdminDb } from "@workspace/db";

// ── DB type ───────────────────────────────────────────────────────────────────

export type Db = typeof superAdminDb;

// ── Product Status ────────────────────────────────────────────────────────────

export type ProductStatus =
  | "NOT_OPEN"
  | "OPEN"
  | "PREANALYZING"
  | "QUESTION_AVAILABLE"
  | "READY_FOR_ANALYSIS"
  | "ANALYZING"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "PUBLISHED"
  | "PARTIAL"
  | "FAILED"
  // WP8: Production workflow states
  | "READY_TO_SEND"   // AI generated + validated → admin 발송 대기 (부모 비노출)
  | "DISCARDED"       // 관리자 폐기 (이력 보존, 부모 비노출)
  | "REGENERATING";   // 재발급 새 버전 생성 중

// 금지값 — DB constraint + 런타임 양측에서 차단
const FORBIDDEN_PRODUCT_STATUSES = new Set(["QUESTION_REQUIRED", "CLOSED"]);

export const ALL_PRODUCT_STATUSES: ReadonlySet<ProductStatus> = new Set([
  "NOT_OPEN", "OPEN", "PREANALYZING", "QUESTION_AVAILABLE",
  "READY_FOR_ANALYSIS", "ANALYZING", "REVIEW_REQUIRED",
  "APPROVED", "PUBLISHED", "PARTIAL", "FAILED",
  // WP8
  "READY_TO_SEND", "DISCARDED", "REGENERATING",
]);

// ── Parent Input Status ───────────────────────────────────────────────────────

export type ParentInputStatus = "NONE" | "AVAILABLE" | "ANSWERED" | "CLOSED";

export const ALL_PARENT_INPUT_STATUSES: ReadonlySet<ParentInputStatus> = new Set([
  "NONE", "AVAILABLE", "ANSWERED", "CLOSED",
]);

// ── Cycle Status ──────────────────────────────────────────────────────────────

export type CycleStatus = "PENDING" | "ACTIVE" | "INPUT_CLOSED" | "DONE";

export const ALL_CYCLE_STATUSES: ReadonlySet<CycleStatus> = new Set([
  "PENDING", "ACTIVE", "INPUT_CLOSED", "DONE",
]);

// ── Analysis Status (ENGINE → APP, product_status와 혼용 금지) ───────────────

export type AnalysisStatus =
  | "COMPLETE"
  | "COMPLETE_WITH_QUESTIONS_AVAILABLE"
  | "COMPLETE_WITH_PARENT_EVIDENCE"
  | "PARTIAL";

// ── Allowed Lifecycle Transitions ─────────────────────────────────────────────
//
// ENGINE은 이 상태를 반환하지 않는다.
// APP이 ENGINE analysis_status를 보고 product_status를 결정한다.
//
// PUBLISHED → terminal (전환 불가)
// 질문 미응답으로 Report 차단 금지

export const ALLOWED_TRANSITIONS: Readonly<Record<ProductStatus, ReadonlyArray<ProductStatus>>> = {
  NOT_OPEN:           ["OPEN"],
  OPEN:               ["PREANALYZING"],
  PREANALYZING:       ["QUESTION_AVAILABLE", "READY_FOR_ANALYSIS", "PARTIAL", "FAILED", "OPEN"],
  QUESTION_AVAILABLE: ["READY_FOR_ANALYSIS"],
  READY_FOR_ANALYSIS: ["ANALYZING", "REVIEW_REQUIRED"],
  ANALYZING:          ["REVIEW_REQUIRED", "PARTIAL", "FAILED"],
  PARTIAL:            ["ANALYZING", "REVIEW_REQUIRED"],
  FAILED:             ["ANALYZING", "OPEN"],  // OPEN: super_admin 운영 재처리 경로
  REVIEW_REQUIRED:    ["APPROVED", "ANALYZING", "READY_TO_SEND"],  // WP8: batch auto-validate → READY_TO_SEND
  APPROVED:           ["PUBLISHED"],
  PUBLISHED:          [], // terminal
  // WP8 Production states
  READY_TO_SEND:      ["PUBLISHED", "DISCARDED"],  // admin: 발송 or 폐기
  DISCARDED:          [],   // terminal (재발급은 새 row INSERT — 이 row는 유지)
  REGENERATING:       ["PREANALYZING", "FAILED"],  // 재발급 분석 시작
};

// ── Error types ───────────────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ProductStatus,
    public readonly to: string,
  ) {
    super(`Invalid transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class ForbiddenStatusError extends Error {
  constructor(public readonly status: string) {
    super(`Forbidden product status: ${status}`);
    this.name = "ForbiddenStatusError";
  }
}

export class ReportTerminalError extends Error {
  constructor(public readonly reportId: string) {
    super(`Report ${reportId} is PUBLISHED (terminal). No further transitions allowed.`);
    this.name = "ReportTerminalError";
  }
}

export class ReportNotFoundError extends Error {
  constructor(public readonly reportId: string) {
    super(`Report not found: ${reportId}`);
    this.name = "ReportNotFoundError";
  }
}

export class CycleDuplicateError extends Error {
  constructor(public readonly poolId: string, public readonly period: string) {
    super(`Cycle already exists for pool=${poolId} period=${period}`);
    this.name = "CycleDuplicateError";
  }
}

export class PublishPreconditionError extends Error {
  constructor(public readonly detail: string) {
    super(`Publish precondition failed: ${detail}`);
    this.name = "PublishPreconditionError";
  }
}

export class PublishNotAllowedError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Report cannot be published from status=${currentStatus} (must be APPROVED)`);
    this.name = "PublishNotAllowedError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 금지된 status 값 차단 (QUESTION_REQUIRED, CLOSED)
 */
export function assertNotForbiddenStatus(status: string): void {
  if (FORBIDDEN_PRODUCT_STATUSES.has(status)) {
    throw new ForbiddenStatusError(status);
  }
}

/**
 * valid ProductStatus 확인
 */
export function isValidProductStatus(status: string): status is ProductStatus {
  return ALL_PRODUCT_STATUSES.has(status as ProductStatus);
}

/**
 * transition 허용 여부 검사
 */
export function isAllowedTransition(from: ProductStatus, to: ProductStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as ReadonlyArray<string>).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit helper
// ─────────────────────────────────────────────────────────────────────────────

async function writeReportAudit(params: {
  db: Db;
  reportId: string;
  poolId: string;
  actorType: "super_admin" | "pool_admin" | "teacher" | "parent" | "system";
  actorId: string | null;
  fromStatus: ProductStatus;
  toStatus: ProductStatus;
  reason?: string;
  requestId?: string;
}): Promise<void> {
  const {
    db, reportId, poolId, actorType, actorId,
    fromStatus, toStatus, reason, requestId,
  } = params;

  try {
    const vRes = await db.execute(sql`
      SELECT next_audit_version('growth_report', ${reportId}) AS v
    `);
    const version = (vRes.rows[0] as any)?.v ?? 1;

    await db.execute(sql`
      INSERT INTO audit_logs (
        entity_type, entity_id, entity_version,
        action, actor_type, actor_id, pool_id,
        before_data, after_data, reason,
        request_id, correlation_id, ip_hash
      ) VALUES (
        'growth_report', ${reportId}, ${version},
        'update',
        ${actorType}, ${actorId}, ${poolId},
        ${JSON.stringify({ product_status: fromStatus })}::jsonb,
        ${JSON.stringify({ product_status: toStatus })}::jsonb,
        ${reason ?? "lifecycle_transition"},
        ${requestId ?? null}, NULL, NULL
      )
    `);
  } catch (auditErr: any) {
    // audit 실패는 warn only — 상태 전환 자체를 막지 않음
    console.warn("[growth-report] audit_log 기록 실패:", auditErr.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// transitionReportStatus — 중앙 상태 전환 서비스
// ─────────────────────────────────────────────────────────────────────────────

export interface TransitionParams {
  db: Db;
  reportId: string;
  toStatus: ProductStatus;
  actorType: "super_admin" | "pool_admin" | "teacher" | "parent" | "system";
  actorId: string | null;
  reason?: string;
  requestId?: string;
}

export interface TransitionResult {
  updated: boolean;
  previousStatus: ProductStatus;
  newStatus: ProductStatus;
}

/**
 * transitionReportStatus — 허용된 lifecycle 전환만 실행
 *
 * - PUBLISHED terminal 강제
 * - 금지값(QUESTION_REQUIRED, CLOSED) 차단
 * - allowed transition 검증
 * - audit_logs 기록
 * - 동시 update 방어: SELECT ... FOR UPDATE
 */
export async function transitionReportStatus(
  params: TransitionParams,
): Promise<TransitionResult> {
  const { db, reportId, toStatus, actorType, actorId, reason, requestId } = params;

  // 금지값 차단
  assertNotForbiddenStatus(toStatus);

  // valid status 확인
  if (!isValidProductStatus(toStatus)) {
    throw new InvalidTransitionError("NOT_OPEN" as ProductStatus, toStatus);
  }

  // SELECT ... FOR UPDATE (동시 update 방어)
  const selectRes = await db.execute(sql`
    SELECT id, product_status, swimming_pool_id, deleted_at
    FROM growth_reports
    WHERE id = ${reportId}
    FOR UPDATE
  `);

  if (!selectRes.rows.length) {
    throw new ReportNotFoundError(reportId);
  }

  const row = selectRes.rows[0] as any;

  if (row.deleted_at) {
    throw new ReportNotFoundError(reportId);
  }

  const fromStatus = row.product_status as ProductStatus;
  const poolId = row.swimming_pool_id as string;

  // PUBLISHED terminal 강제
  if (fromStatus === "PUBLISHED") {
    throw new ReportTerminalError(reportId);
  }

  // allowed transition 검증
  if (!isAllowedTransition(fromStatus, toStatus)) {
    throw new InvalidTransitionError(fromStatus, toStatus);
  }

  // UPDATE
  await db.execute(sql`
    UPDATE growth_reports
    SET product_status = ${toStatus},
        updated_at = now()
    WHERE id = ${reportId}
      AND deleted_at IS NULL
  `);

  // published_at 자동 기록
  if (toStatus === "PUBLISHED") {
    await db.execute(sql`
      UPDATE growth_reports
      SET published_at = now()
      WHERE id = ${reportId}
    `);
  }

  // Audit
  await writeReportAudit({
    db, reportId, poolId, actorType, actorId,
    fromStatus, toStatus, reason, requestId,
  });

  console.log(
    `[growth-report] TRANSITION: report=${reportId}` +
    ` pool=${poolId} ${fromStatus} → ${toStatus} by=${actorId ?? actorType}`,
  );

  return { updated: true, previousStatus: fromStatus, newStatus: toStatus };
}

// ─────────────────────────────────────────────────────────────────────────────
// createReportCycle — cycle 생성 (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCycleParams {
  db: Db;
  poolId: string;
  reportPeriod: string; // "YYYY-MM"
  analysisCutoffAt: Date;
  parentInputOpenAt: Date;
  parentInputCloseAt: Date;
  analysisFrom?: Date | null;
  timezone?: string;
}

export interface CreateCycleResult {
  cycleId: string;
  created: boolean; // false = 이미 존재
}

/**
 * createReportCycle — 멱등성 보장
 *
 * UNIQUE(swimming_pool_id, report_period) constraint로 동시 생성 방어.
 * 이미 존재하는 경우 기존 ID 반환.
 */
export async function createReportCycle(
  params: CreateCycleParams,
): Promise<CreateCycleResult> {
  const {
    db, poolId, reportPeriod, analysisCutoffAt,
    parentInputOpenAt, parentInputCloseAt,
    analysisFrom = null,
    timezone = "Asia/Seoul",
  } = params;

  // 기간 형식 검증 (YYYY-MM)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportPeriod)) {
    throw new Error(`Invalid report_period format: ${reportPeriod} (expected YYYY-MM)`);
  }

  // INSERT ... ON CONFLICT DO NOTHING (concurrency-safe)
  const insertRes = await db.execute(sql`
    INSERT INTO growth_report_cycles (
      swimming_pool_id, report_period,
      analysis_from, analysis_cutoff_at,
      parent_input_open_at, parent_input_close_at,
      timezone, cycle_status
    ) VALUES (
      ${poolId}, ${reportPeriod},
      ${analysisFrom ? analysisFrom.toISOString() : null},
      ${analysisCutoffAt.toISOString()},
      ${parentInputOpenAt.toISOString()},
      ${parentInputCloseAt.toISOString()},
      ${timezone}, 'PENDING'
    )
    ON CONFLICT (swimming_pool_id, report_period)
    DO NOTHING
    RETURNING id
  `);

  if (insertRes.rows.length > 0) {
    const cycleId = (insertRes.rows[0] as any).id as string;
    console.log(`[growth-report] CYCLE CREATED: cycle=${cycleId} pool=${poolId} period=${reportPeriod}`);
    return { cycleId, created: true };
  }

  // 이미 존재 — ID 조회
  const existRes = await db.execute(sql`
    SELECT id FROM growth_report_cycles
    WHERE swimming_pool_id = ${poolId}
      AND report_period = ${reportPeriod}
    LIMIT 1
  `);

  const cycleId = (existRes.rows[0] as any).id as string;
  console.log(`[growth-report] CYCLE EXISTS: cycle=${cycleId} pool=${poolId} period=${reportPeriod}`);
  return { cycleId, created: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// createGrowthReport — report 생성 (concurrency-safe)
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateReportParams {
  db: Db;
  poolId: string;
  studentId: string;
  cycleId: string;
  reportPeriod: string; // "YYYY-MM"
  previousReportId?: string | null;
}

export interface CreateReportResult {
  reportId: string;
  created: boolean; // false = 이미 존재 (idempotent)
}

/**
 * createGrowthReport — concurrency-safe report 생성
 *
 * UNIQUE(student_id, cycle_id) WHERE deleted_at IS NULL constraint로
 * check-then-insert race 방지.
 * 이미 존재하는 경우 기존 ID 반환 (idempotent).
 */
export async function createGrowthReport(
  params: CreateReportParams,
): Promise<CreateReportResult> {
  const { db, poolId, studentId, cycleId, reportPeriod, previousReportId = null } = params;

  // INSERT ... ON CONFLICT DO NOTHING (concurrency-safe)
  const insertRes = await db.execute(sql`
    INSERT INTO growth_reports (
      student_id, swimming_pool_id, cycle_id, report_period,
      product_status, parent_input_status, snapshot_version,
      previous_report_id,
      period_start, period_end
    ) VALUES (
      ${studentId}, ${poolId}, ${cycleId}, ${reportPeriod},
      'NOT_OPEN', 'NONE', 0,
      ${previousReportId},
      now()::date, now()::date
    )
    ON CONFLICT (student_id, cycle_id)
      WHERE cycle_id IS NOT NULL AND deleted_at IS NULL
    DO NOTHING
    RETURNING id
  `);

  if (insertRes.rows.length > 0) {
    const reportId = (insertRes.rows[0] as any).id as string;
    console.log(`[growth-report] REPORT CREATED: report=${reportId} student=${studentId} pool=${poolId} period=${reportPeriod}`);
    return { reportId, created: true };
  }

  // 이미 존재 — ID 조회
  const existRes = await db.execute(sql`
    SELECT id FROM growth_reports
    WHERE student_id = ${studentId}
      AND cycle_id = ${cycleId}
      AND deleted_at IS NULL
    LIMIT 1
  `);

  const reportId = (existRes.rows[0] as any).id as string;
  console.log(`[growth-report] REPORT EXISTS: report=${reportId} student=${studentId} pool=${poolId} period=${reportPeriod}`);
  return { reportId, created: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// getPublishedReportHistory — longitudinal history 조회
// ─────────────────────────────────────────────────────────────────────────────

export interface PublishedReportSummary {
  id: string;
  report_period: string;
  cycle_id: string | null;
  product_status: ProductStatus;
  analysis_status: AnalysisStatus | null;
  metric_states: unknown;
  metric_confidences: unknown;
  positive_growth_signals: unknown;
  success_conditions: unknown;
  support_levers: unknown;
  next_growth_targets: unknown;
  next_observation_targets: unknown;
  report_fact_package: unknown;
  sns_summary: unknown;
  published_at: string | null;
  teacher_reviewed_by: string | null;
  teacher_reviewed_at: string | null;
}

/**
 * getPublishedReportHistory — 학생의 모든 Published report structured history
 *
 * ENGINE Longitudinal Snapshot 조립 시 사용.
 * previous_report_id 하나만 따라가는 구조로 제한하지 않음.
 * N개 이전 리포트 모두 조회 가능.
 *
 * 전달 범위(최근 N개월)는 호출부(GR3 context assembler)에서 결정.
 * APP은 제한 없이 조회 가능한 구조를 유지.
 */
export async function getPublishedReportHistory(params: {
  db: Db;
  studentId: string;
  poolId?: string;
  limit?: number;
}): Promise<PublishedReportSummary[]> {
  const { db, studentId, poolId, limit = 24 } = params;

  const res = await db.execute(sql`
    SELECT
      id,
      report_period,
      cycle_id,
      product_status,
      analysis_status,
      metric_states,
      metric_confidences,
      positive_growth_signals,
      success_conditions,
      support_levers,
      next_growth_targets,
      next_observation_targets,
      report_fact_package,
      sns_summary,
      published_at,
      teacher_reviewed_by,
      teacher_reviewed_at
    FROM growth_reports
    WHERE student_id = ${studentId}
      AND product_status = 'PUBLISHED'
      AND deleted_at IS NULL
      ${poolId ? sql`AND swimming_pool_id = ${poolId}` : sql``}
    ORDER BY published_at DESC
    LIMIT ${limit}
  `);

  return res.rows as PublishedReportSummary[];
}

// ─────────────────────────────────────────────────────────────────────────────
// updateParentInputStatus — parent input lifecycle 전환
// ─────────────────────────────────────────────────────────────────────────────

/**
 * updateParentInputStatus — parent input 상태 전환
 *
 * product_status와 독립적으로 관리.
 * parent_input_status=CLOSED ≠ report 종료.
 * CLOSED 후에도 report는 분석→검토→발행 계속 진행.
 */
export async function updateParentInputStatus(params: {
  db: Db;
  reportId: string;
  toStatus: ParentInputStatus;
}): Promise<void> {
  const { db, reportId, toStatus } = params;

  if (!ALL_PARENT_INPUT_STATUSES.has(toStatus)) {
    throw new Error(`Invalid parent_input_status: ${toStatus}`);
  }

  const extraSet = toStatus === "CLOSED"
    ? sql`, parent_input_closed_at = now()`
    : sql``;

  await db.execute(sql`
    UPDATE growth_reports
    SET parent_input_status = ${toStatus},
        updated_at = now()
        ${extraSet}
    WHERE id = ${reportId}
      AND deleted_at IS NULL
  `);

  console.log(`[growth-report] PARENT_INPUT_STATUS: report=${reportId} → ${toStatus}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// autoApproveAndPublishForDelivery — Monthly FREE 자동 발행 (시스템 전용)
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoPublishResult {
  alreadyPublished: boolean;
  publishedAt?:    string;
  studentId?:      string;
  poolId?:         string;
  reportPeriod?:   string;
}

/**
 * autoApproveAndPublishForDelivery — REVIEW_REQUIRED → APPROVED → PUBLISHED (시스템 자동)
 *
 * Monthly FREE 자동 발행 전용. 다음 순서로 처리:
 *   1. 현재 상태 확인 (REVIEW_REQUIRED 아니면 alreadyPublished or throw)
 *   2. teacher_reviewed_at = now(), teacher_reviewed_by = actorId (시스템 마커)
 *   3. REVIEW_REQUIRED → APPROVED (transitionReportStatus)
 *   4. APPROVED → PUBLISHED (publishGrowthReport 내부 로직 직접 실행)
 *
 * 멱등성:
 *   - 이미 PUBLISHED → alreadyPublished: true 반환
 *   - APPROVED 상태 → 4단계부터 실행
 *
 * human review gate 보존:
 *   - transitionReportStatus SELECT FOR UPDATE 경로 유지
 *   - teacher_reviewed_at 기록 (시스템 actor 명시)
 *   - audit 기록
 *
 * AI call 금지, ENGINE call 금지, GPT call 금지.
 */
export async function autoApproveAndPublishForDelivery(params: {
  db: Db;
  reportId: string;
  actorId: string; // e.g. "SYSTEM_MONTHLY_AUTO"
}): Promise<AutoPublishResult> {
  const { db, reportId, actorId } = params;

  // ── 1. Fetch current state ────────────────────────────────────────────────
  const fetchRes = await db.execute(sql`
    SELECT id, product_status, report_content, report_fact_package, sns_summary,
           teacher_reviewed_at, swimming_pool_id, deleted_at, published_at,
           student_id, report_period, analysis_status
    FROM growth_reports
    WHERE id = ${reportId}
    LIMIT 1
  `);

  if (!fetchRes.rows.length) throw new ReportNotFoundError(reportId);
  const row = fetchRes.rows[0] as any;
  if (row.deleted_at) throw new ReportNotFoundError(reportId);

  // ── 2. Idempotency ────────────────────────────────────────────────────────
  if (row.product_status === "PUBLISHED") {
    return {
      alreadyPublished: true,
      publishedAt: row.published_at ?? undefined,
      studentId:   row.student_id,
      poolId:      row.swimming_pool_id,
      reportPeriod: row.report_period,
    };
  }

  // ── 3. Auto-approve: REVIEW_REQUIRED → APPROVED ───────────────────────────
  if (row.product_status === "REVIEW_REQUIRED") {
    // Set teacher_reviewed_at (system marker) before transition
    await db.execute(sql`
      UPDATE growth_reports
      SET teacher_reviewed_at  = now(),
          teacher_reviewed_by  = ${actorId},
          updated_at           = now()
      WHERE id = ${reportId}
        AND teacher_reviewed_at IS NULL
    `);

    await transitionReportStatus({
      db,
      reportId,
      toStatus:  "APPROVED",
      actorType: "system",
      actorId,
      reason:    "MONTHLY_FREE_AUTO_APPROVE",
    });

    console.log(`[growth-report] AUTO_APPROVED: report=${reportId} actor=${actorId}`);
  } else if (row.product_status !== "APPROVED") {
    // 다른 상태면 이미 처리됨 또는 불가
    throw new PublishNotAllowedError(row.product_status);
  }

  // ── 4. Publish: APPROVED → PUBLISHED ─────────────────────────────────────
  // Re-fetch after APPROVED transition (teacher_reviewed_at 반영)
  const approvedRes = await db.execute(sql`
    SELECT product_status, report_content, report_fact_package, sns_summary,
           teacher_reviewed_at, swimming_pool_id, deleted_at, published_at,
           student_id, report_period
    FROM growth_reports
    WHERE id = ${reportId}
    LIMIT 1
  `);
  const approvedRow = approvedRes.rows[0] as any;
  if (!approvedRow || approvedRow.deleted_at) throw new ReportNotFoundError(reportId);

  if (approvedRow.product_status === "PUBLISHED") {
    return {
      alreadyPublished: true,
      publishedAt:  approvedRow.published_at ?? undefined,
      studentId:    approvedRow.student_id,
      poolId:       approvedRow.swimming_pool_id,
      reportPeriod: approvedRow.report_period,
    };
  }

  // Publish preconditions (same as publishGrowthReport)
  const GROUNDING_PASS = new Set(["PASS", "REVISED_PASS"]);

  const rc  = approvedRow.report_content;
  const fp  = approvedRow.report_fact_package;
  const sns = approvedRow.sns_summary;

  if (!rc  || typeof rc  !== "object" || Array.isArray(rc))  throw new PublishPreconditionError("report_content must exist");
  if (!fp  || typeof fp  !== "object" || Array.isArray(fp))  throw new PublishPreconditionError("report_fact_package must exist");
  if (!sns || typeof sns !== "object" || Array.isArray(sns)) throw new PublishPreconditionError("sns_summary must exist");

  const grounding = (fp as Record<string, unknown>).grounding_result;
  if (!GROUNDING_PASS.has(grounding as string)) {
    throw new PublishPreconditionError(`grounding_result=${grounding} must be PASS or REVISED_PASS`);
  }
  const framing = (fp as Record<string, unknown>).growth_framing_result;
  if (!GROUNDING_PASS.has(framing as string)) {
    throw new PublishPreconditionError(`growth_framing_result=${framing} must be PASS or REVISED_PASS`);
  }
  if (!approvedRow.teacher_reviewed_at) {
    throw new PublishPreconditionError("teacher_reviewed_at is required");
  }

  try {
    await transitionReportStatus({
      db,
      reportId,
      toStatus:  "PUBLISHED",
      actorType: "system",
      actorId,
      reason:    "MONTHLY_FREE_AUTO_PUBLISH",
    });
  } catch (err) {
    if (err instanceof ReportTerminalError) {
      return { alreadyPublished: true };
    }
    throw err;
  }

  // Re-fetch published_at
  const afterRes = await db.execute(sql`
    SELECT published_at, student_id, swimming_pool_id, report_period
    FROM growth_reports WHERE id = ${reportId} LIMIT 1
  `);
  const afterRow = afterRes.rows[0] as any;

  console.log(
    `[growth-report] AUTO_PUBLISHED: report=${reportId} actor=${actorId} at=${afterRow?.published_at ?? "?"}`,
  );

  return {
    alreadyPublished: false,
    publishedAt:  afterRow?.published_at   ?? undefined,
    studentId:    afterRow?.student_id     ?? undefined,
    poolId:       afterRow?.swimming_pool_id ?? undefined,
    reportPeriod: afterRow?.report_period  ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// publishGrowthReport — GR6: APPROVED → PUBLISHED
// ─────────────────────────────────────────────────────────────────────────────

const PUBLISH_GROUNDING_PASS = new Set(["PASS", "REVISED_PASS"]);

export interface PublishGrowthReportParams {
  db: Db;
  reportId: string;
  actorId: string;
  actorType: "pool_admin" | "super_admin";
}

export interface PublishGrowthReportResult {
  alreadyPublished: boolean;
  publishedAt?:    string;
  /** GR7: notification payload — only set on first (non-idempotent) publish */
  studentId?:    string;
  poolId?:       string;
  reportPeriod?: string;
}

/**
 * publishGrowthReport — APPROVED → PUBLISHED 공식 publication service
 *
 * 전제조건 (spec §4):
 *   - product_status === APPROVED
 *   - report_content: plain object
 *   - report_fact_package: plain object
 *   - sns_summary: plain object
 *   - grounding_result: PASS | REVISED_PASS
 *   - growth_framing_result: PASS | REVISED_PASS
 *   - teacher_reviewed_at: 존재
 *
 * 멱등성 (spec §20):
 *   - already PUBLISHED → alreadyPublished=true (성공)
 *   - concurrent publish → ReportTerminalError → alreadyPublished=true
 *
 * published_at (spec §5):
 *   - 첫 번째 호출에서만 기록 (transitionReportStatus 내부 처리)
 *   - 재호출 시 timestamp 변경 금지
 *
 * ENGINE 호출 금지 (spec §31).
 * APP GPT 호출 금지 (spec §32).
 */
export async function publishGrowthReport(
  params: PublishGrowthReportParams,
): Promise<PublishGrowthReportResult> {
  const { db, reportId, actorId, actorType } = params;

  // ── Fetch current state ──────────────────────────────────────────────────
  const fetchRes = await db.execute(sql`
    SELECT id, product_status, report_content, report_fact_package, sns_summary,
           teacher_reviewed_at, swimming_pool_id, deleted_at, published_at
    FROM growth_reports
    WHERE id = ${reportId}
    LIMIT 1
  `);

  if (!fetchRes.rows.length) throw new ReportNotFoundError(reportId);
  const row = fetchRes.rows[0] as any;
  if (row.deleted_at) throw new ReportNotFoundError(reportId);

  // ── Idempotency: already PUBLISHED ───────────────────────────────────────
  if (row.product_status === "PUBLISHED") {
    return { alreadyPublished: true, publishedAt: row.published_at ?? undefined };
  }

  // ── Must be APPROVED ─────────────────────────────────────────────────────
  if (row.product_status !== "APPROVED") {
    throw new PublishNotAllowedError(row.product_status);
  }

  // ── Preconditions ─────────────────────────────────────────────────────────
  const rc = row.report_content;
  if (!rc || typeof rc !== "object" || Array.isArray(rc)) {
    throw new PublishPreconditionError(
      "report_content must exist as a plain object",
    );
  }

  const fp = row.report_fact_package;
  if (!fp || typeof fp !== "object" || Array.isArray(fp)) {
    throw new PublishPreconditionError(
      "report_fact_package must exist as a plain object",
    );
  }

  const sns = row.sns_summary;
  if (!sns || typeof sns !== "object" || Array.isArray(sns)) {
    throw new PublishPreconditionError(
      "sns_summary must exist as a plain object",
    );
  }

  const grounding = (fp as Record<string, unknown>).grounding_result;
  if (!PUBLISH_GROUNDING_PASS.has(grounding as string)) {
    throw new PublishPreconditionError(
      `grounding_result=${grounding} must be PASS or REVISED_PASS`,
    );
  }

  const framing = (fp as Record<string, unknown>).growth_framing_result;
  if (!PUBLISH_GROUNDING_PASS.has(framing as string)) {
    throw new PublishPreconditionError(
      `growth_framing_result=${framing} must be PASS or REVISED_PASS`,
    );
  }

  if (!row.teacher_reviewed_at) {
    throw new PublishPreconditionError(
      "teacher_reviewed_at is required before publishing",
    );
  }

  // ── A fix: Empty report gate ──────────────────────────────────────────────
  // 실제 성장 근거가 0건이고 summary + 모든 parent-facing section이 비어 있으면
  // 빈 PDF가 학부모에게 발급되는 것을 차단.
  // 확인 대상 섹션: core_growth, swimming_progress, behavioral_strengths,
  //   longitudinal_comparison, success_conditions, parent_support, next_growth_direction
  {
    const PARENT_SECTIONS = [
      "core_growth", "swimming_progress", "behavioral_strengths",
      "longitudinal_comparison", "success_conditions",
      "parent_support", "next_growth_direction",
    ] as const;
    const rcObj = rc as Record<string, unknown>;
    const summaryText: string = (rcObj["summary_text"] as string) ?? "";
    const sections = (rcObj["sections"] ?? {}) as Record<string, { text?: string }>;
    const hasContent =
      summaryText.trim().length > 0 ||
      PARENT_SECTIONS.some((k) => (sections[k]?.text ?? "").trim().length > 0);
    if (!hasContent) {
      throw new PublishPreconditionError(
        "EMPTY_REPORT: summary_text and all parent sections are empty. " +
        "Cannot publish a report with no content to the parent.",
      );
    }
  }

  // ── Transition APPROVED → PUBLISHED ──────────────────────────────────────
  // transitionReportStatus handles: SELECT FOR UPDATE, published_at, audit
  // ReportTerminalError on concurrent publish → treat as already-published
  try {
    await transitionReportStatus({
      db,
      reportId,
      toStatus: "PUBLISHED",
      actorType,
      actorId,
      reason: "GROWTH_REPORT_PUBLISHED",
    });
  } catch (err) {
    if (err instanceof ReportTerminalError) {
      return { alreadyPublished: true };
    }
    throw err;
  }

  // Re-fetch published_at for caller (also grab GR7 notification payload fields)
  const afterRes = await db.execute(sql`
    SELECT published_at, student_id, swimming_pool_id, report_period
    FROM growth_reports WHERE id = ${reportId} LIMIT 1
  `);
  const afterRow = afterRes.rows[0] as any;
  const publishedAt: string | undefined = afterRow?.published_at ?? undefined;

  console.log(
    `[growth-report] PUBLISHED: report=${reportId} actor=${actorId} at=${publishedAt ?? "?"}`,
  );

  return {
    alreadyPublished: false,
    publishedAt,
    studentId:    afterRow?.student_id      ?? undefined,
    poolId:       afterRow?.swimming_pool_id ?? undefined,
    reportPeriod: afterRow?.report_period    ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteGrowthReport — Admin soft-delete
// ─────────────────────────────────────────────────────────────────────────────

export interface DeleteGrowthReportResult {
  reportId: string;
  deleted: {
    report:        number;
    reactions:     number;
    comments:      number;
    notifications: number;
  };
}

/**
 * deleteGrowthReport — 성장리포트 관리자 삭제
 *
 * SOFT DELETE: growth_reports.deleted_at 설정.
 * HARD DELETE: reactions / comments / notifications (FK 없음).
 *
 * 권한:
 *   pool_admin  → 자기 pool 한정 (callerId poolId 검증 포함)
 *   super_admin → 전체
 *
 * 재발급 안전:
 *   uq_growth_reports_student_cycle 이 WHERE deleted_at IS NULL partial index이므로
 *   삭제 후 동일 (student_id, cycle_id)로 새 report 즉시 생성 가능.
 */
export async function deleteGrowthReport(params: {
  db: Db;
  reportId: string;
  callerRole: string;
  callerPoolId: string | null;
}): Promise<DeleteGrowthReportResult> {
  const { db, reportId, callerRole, callerPoolId } = params;

  return db.transaction(async (tx) => {
    // 1. Report 존재 + pool 소유권 확인 (FOR UPDATE)
    const lockRes = await tx.execute(sql`
      SELECT id, swimming_pool_id, deleted_at
      FROM growth_reports
      WHERE id = ${reportId}
      FOR UPDATE
    `);

    if (lockRes.rows.length === 0) {
      const err: any = new Error("리포트를 찾을 수 없습니다.");
      err.status = 404;
      throw err;
    }

    const row = lockRes.rows[0] as any;

    if (row.deleted_at) {
      const err: any = new Error("이미 삭제된 리포트입니다.");
      err.status = 409;
      throw err;
    }

    // 2. 권한 / pool ownership 확인
    if (callerRole === "pool_admin") {
      if (!callerPoolId || row.swimming_pool_id !== callerPoolId) {
        const err: any = new Error("접근 권한이 없습니다.");
        err.status = 403;
        throw err;
      }
    }
    // super_admin: 전체 허용

    // 3. notifications HARD DELETE
    const notifRes = await tx.execute(sql`
      DELETE FROM notifications
      WHERE ref_id = ${reportId}
        AND ref_type = 'growth_report'
        AND type IN ('GROWTH_REPORT_PUBLISHED', 'growth_report_like', 'growth_report_comment')
    `);
    const notificationsDeleted = (notifRes as any).rowCount ?? 0;

    // 4. growth_report_comments HARD DELETE (root + replies, is_deleted 무관)
    const commentsRes = await tx.execute(sql`
      DELETE FROM growth_report_comments
      WHERE growth_report_id = ${reportId}
    `);
    const commentsDeleted = (commentsRes as any).rowCount ?? 0;

    // 5. growth_report_reactions HARD DELETE
    const reactionsRes = await tx.execute(sql`
      DELETE FROM growth_report_reactions
      WHERE growth_report_id = ${reportId}
    `);
    const reactionsDeleted = (reactionsRes as any).rowCount ?? 0;

    // 6. growth_reports SOFT DELETE
    const updateRes = await tx.execute(sql`
      UPDATE growth_reports
      SET deleted_at = now(),
          updated_at = now()
      WHERE id = ${reportId}
        AND deleted_at IS NULL
    `);
    const reportDeleted = (updateRes as any).rowCount ?? 0;

    if (reportDeleted === 0) {
      // 동시 삭제 레이스 (FOR UPDATE 이후 극히 드문 케이스)
      const err: any = new Error("이미 삭제된 리포트입니다.");
      err.status = 409;
      throw err;
    }

    console.log(
      `[growth-report] DELETED: report=${reportId} by=${callerRole}(pool=${callerPoolId}) ` +
      `reactions=${reactionsDeleted} comments=${commentsDeleted} notifications=${notificationsDeleted}`,
    );

    return {
      reportId,
      deleted: {
        report:        reportDeleted,
        reactions:     reactionsDeleted,
        comments:      commentsDeleted,
        notifications: notificationsDeleted,
      },
    };
  });
}
