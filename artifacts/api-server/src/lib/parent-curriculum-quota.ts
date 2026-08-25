/**
 * parent-curriculum-quota.ts — WP2B / WP2B.2
 *
 * 학부모 커리큘럼 검색 월 사용량 제한.
 *
 * Quota key: parent_account_id + feature + calendar month (Asia/Seoul)
 * Limit:     MONTHLY_LIMIT (4) successful questions / month
 *
 * 기존 tables 재사용:
 *   parent_ai_daily_usage      — feature 컬럼으로 격리 (WP2B.2 추가)
 *   parent_ai_usage_reservations — request_id PK + feature 컬럼
 *
 * 원칙:
 *   - COMPLETED 재시도 → route에서 replay 처리 (이 서비스 미호출)
 *   - FAILED 재시도 → FAILED→RESERVED atomic 전환 + 경쟁 시 rollback
 *   - 서버/ENGINE 오류 → rollback (reserved_count 복구)
 *   - 동시 요청 → UPDATE WHERE count < LIMIT (atomic)
 */

import { superAdminDb } from "@workspace/db";
import { sql }          from "drizzle-orm";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** Curriculum Search feature ID — 모든 DB row에서 동일 값 사용. */
export const CURRICULUM_SEARCH_FEATURE = "parent_curriculum_search" as const;

export const MONTHLY_LIMIT = 4;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface UsageInfo {
  limit:     number;
  used:      number;
  remaining: number;
  period:    string;    // 'YYYY-MM'
  resets_at: string;   // ISO 8601 with timezone
}

export type QuotaReserveResult =
  | { ok: true;  isRetry: boolean }
  | { ok: false; usageInfo: UsageInfo };

/** reservation table에서 조회한 기존 request 상태. */
export type PriorReservationStatus =
  | "COMPLETED"
  | "RESERVED"
  | "FAILED"
  | "BLOCKED"
  | "EXPIRED"
  | "NONE";

// ─── Timezone 헬퍼 ────────────────────────────────────────────────────────────

/**
 * Asia/Seoul 기준 현재 달의 period key (YYYY-MM-01 형식 date string).
 * 새 달이 되면 새 row가 자연 생성 → 0부터 시작.
 */
export function getSeoulMonthPeriod(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  });
  const formatted = formatter.format(now); // 'YYYY-MM-DD'
  const [year, month] = formatted.split("-");
  return `${year}-${month}-01`;
}

/** Asia/Seoul 기준 현재 달의 period label (YYYY-MM). */
export function getSeoulPeriodLabel(): string {
  return getSeoulMonthPeriod().slice(0, 7);
}

/** 다음 달 1일 자정 (Asia/Seoul) ISO 8601 string. */
export function getResetsAt(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  });
  const formatted = formatter.format(now);
  const [year, month] = formatted.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  return new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`,
  ).toISOString();
}

// ─── Prior State 조회 ─────────────────────────────────────────────────────────

/**
 * 동일 request_id의 기존 reservation 상태 조회.
 *
 * Route에서 COMPLETED 여부를 quota reservation 이전에 확인하기 위해 사용.
 * COMPLETED → persisted result replay (ENGINE 재호출 금지, quota 차감 금지).
 */
export async function getPriorReservationStatus(
  requestId: string,
): Promise<PriorReservationStatus> {
  const result = await superAdminDb.execute(sql`
    SELECT status
    FROM parent_ai_usage_reservations
    WHERE request_id = ${requestId}
    LIMIT 1
  `);
  if (!result.rows.length) return "NONE";
  return (result.rows[0] as any).status as PriorReservationStatus;
}

// ─── 사용량 조회 ──────────────────────────────────────────────────────────────

/** 현재 월 Curriculum Search 사용량 조회. */
export async function getMonthlyUsageInfo(parentId: string): Promise<UsageInfo> {
  const period = getSeoulMonthPeriod();

  const result = await superAdminDb.execute(sql`
    SELECT completed_count, reserved_count
    FROM parent_ai_daily_usage
    WHERE parent_account_id = ${parentId}
      AND feature            = ${CURRICULUM_SEARCH_FEATURE}
      AND usage_date         = ${period}::date
    LIMIT 1
  `);

  const row       = result.rows[0] as any;
  const completed = Number(row?.completed_count ?? 0);
  const used      = completed;
  const remaining = Math.max(0, MONTHLY_LIMIT - used);

  return {
    limit:     MONTHLY_LIMIT,
    used,
    remaining,
    period:    getSeoulPeriodLabel(),
    resets_at: getResetsAt(),
  };
}

// ─── 예약 (Reservation) ───────────────────────────────────────────────────────

/**
 * 월 quota 예약 시도.
 *
 * 호출 전제: route에서 이미 getPriorReservationStatus() 로 COMPLETED 여부 확인.
 * 이 함수는 COMPLETED가 아닌 경우(NONE / RESERVED / FAILED / BLOCKED / EXPIRED)에만 호출.
 *
 * FAILED 재시도:
 *   기존 FAILED row → RESERVED 전환 (atomic UPDATE WHERE status='FAILED').
 *   quota increment와 상태 전환 사이 경쟁 시: 상태 전환 실패 → quota rollback → ok:false.
 *
 * RESERVED 재시도:
 *   이미 예약됨 → isRetry:true 반환 (quota 재차감 없음).
 *
 * NONE / BLOCKED / EXPIRED:
 *   새 reservation INSERT.
 */
export async function tryReserveMonthlyQuota(
  parentId:  string,
  requestId: string,
): Promise<QuotaReserveResult> {
  const period = getSeoulMonthPeriod();

  // ── Idempotency: 기존 예약 확인 ──────────────────────────────────────────────
  const existing = await superAdminDb.execute(sql`
    SELECT status
    FROM parent_ai_usage_reservations
    WHERE request_id = ${requestId}
    LIMIT 1
  `);

  let isFailed = false;

  if (existing.rows.length > 0) {
    const status = (existing.rows[0] as any).status as string;
    if (status === "RESERVED") {
      // 이미 예약됨 → retry 허용
      return { ok: true, isRetry: true };
    }
    if (status === "COMPLETED") {
      // Safety net — route에서 사전 처리됐어야 함
      return { ok: true, isRetry: true };
    }
    if (status === "FAILED") {
      isFailed = true;
    }
    // BLOCKED / EXPIRED → fresh attempt (INSERT path)
  }

  // ── Step 1: month+feature row upsert (멱등) ──────────────────────────────────
  await superAdminDb.execute(sql`
    INSERT INTO parent_ai_daily_usage
      (parent_account_id, feature, usage_date, reserved_count, completed_count)
    VALUES
      (${parentId}, ${CURRICULUM_SEARCH_FEATURE}, ${period}::date, 0, 0)
    ON CONFLICT (parent_account_id, feature, usage_date) DO NOTHING
  `);

  // ── Step 2: Atomic check-and-increment ───────────────────────────────────────
  // PostgreSQL UPDATE row-level lock → concurrent requests serialize correctly.
  const updateResult = await superAdminDb.execute(sql`
    UPDATE parent_ai_daily_usage
    SET reserved_count = reserved_count + 1,
        updated_at     = NOW()
    WHERE parent_account_id = ${parentId}
      AND feature            = ${CURRICULUM_SEARCH_FEATURE}
      AND usage_date         = ${period}::date
      AND (completed_count + reserved_count) < ${MONTHLY_LIMIT}
    RETURNING id
  `);

  if (!updateResult.rows.length) {
    const usageInfo = await getMonthlyUsageInfo(parentId);
    return { ok: false, usageInfo };
  }

  // ── Step 3: Reservation row ──────────────────────────────────────────────────
  if (isFailed) {
    // FAILED → RESERVED atomic 전환
    // WHERE status='FAILED' 조건: concurrent retry가 먼저 전환하면 0 rows
    const reservationUpdate = await superAdminDb.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status       = 'RESERVED',
          reserved_at  = NOW(),
          completed_at = NULL,
          error_code   = NULL,
          expires_at   = NOW() + interval '10 minutes',
          usage_date   = ${period}::date,
          feature      = ${CURRICULUM_SEARCH_FEATURE}
      WHERE request_id = ${requestId}
        AND status     = 'FAILED'
      RETURNING request_id
    `);

    if (!reservationUpdate.rows.length) {
      // 경쟁 상황에서 패배 → quota increment 롤백
      await superAdminDb.execute(sql`
        UPDATE parent_ai_daily_usage
        SET reserved_count = GREATEST(0, reserved_count - 1),
            updated_at     = NOW()
        WHERE parent_account_id = ${parentId}
          AND feature            = ${CURRICULUM_SEARCH_FEATURE}
          AND usage_date         = ${period}::date
      `).catch((err) => {
        console.error("[curriculum-quota] FAILED retry rollback error:", err?.message);
      });

      const usageInfo = await getMonthlyUsageInfo(parentId);
      return { ok: false, usageInfo };
    }
  } else {
    // NONE / BLOCKED / EXPIRED → 새 reservation INSERT
    await superAdminDb.execute(sql`
      INSERT INTO parent_ai_usage_reservations
        (request_id, parent_account_id, feature, usage_date)
      VALUES
        (${requestId}, ${parentId}, ${CURRICULUM_SEARCH_FEATURE}, ${period}::date)
      ON CONFLICT (request_id) DO NOTHING
    `);
  }

  return { ok: true, isRetry: false };
}

// ─── 완료 (Finalize) ──────────────────────────────────────────────────────────

/**
 * ENGINE 성공 후 quota 확정.
 * completed_count +1, reserved_count -1, status → COMPLETED.
 */
export async function finalizeQuotaSuccess(
  parentId:  string,
  requestId: string,
): Promise<void> {
  const period = getSeoulMonthPeriod();

  await superAdminDb.execute(sql`
    UPDATE parent_ai_daily_usage
    SET reserved_count  = GREATEST(0, reserved_count - 1),
        completed_count = completed_count + 1,
        updated_at      = NOW()
    WHERE parent_account_id = ${parentId}
      AND feature            = ${CURRICULUM_SEARCH_FEATURE}
      AND usage_date         = ${period}::date
  `);

  await superAdminDb.execute(sql`
    UPDATE parent_ai_usage_reservations
    SET status       = 'COMPLETED',
        completed_at = NOW()
    WHERE request_id = ${requestId}
      AND status     = 'RESERVED'
  `);
}

// ─── 롤백 (Rollback) ──────────────────────────────────────────────────────────

/**
 * ENGINE 실패 / 검증 실패 시 quota 복구.
 * reserved_count -1, failed_count +1, status → FAILED.
 */
export async function rollbackQuotaReservation(
  parentId:  string,
  requestId: string,
  errorCode: string,
): Promise<void> {
  const period = getSeoulMonthPeriod();

  await superAdminDb.execute(sql`
    UPDATE parent_ai_daily_usage
    SET reserved_count = GREATEST(0, reserved_count - 1),
        failed_count   = failed_count + 1,
        updated_at     = NOW()
    WHERE parent_account_id = ${parentId}
      AND feature            = ${CURRICULUM_SEARCH_FEATURE}
      AND usage_date         = ${period}::date
  `).catch((err) => {
    console.error("[curriculum-quota] rollback usage update failed:", err?.message);
  });

  await superAdminDb.execute(sql`
    UPDATE parent_ai_usage_reservations
    SET status       = 'FAILED',
        completed_at = NOW(),
        error_code   = ${errorCode}
    WHERE request_id = ${requestId}
      AND status     = 'RESERVED'
  `).catch((err) => {
    console.error("[curriculum-quota] rollback reservation update failed:", err?.message);
  });
}

// ─── 원자적 성공 확정 (WP2B.3) ────────────────────────────────────────────────

/**
 * finalizeCurriculumSearchSuccess — WP2B.3
 *
 * ENGINE 성공 후 단일 DB transaction으로 원자적 성공 확정:
 *   1. ASSISTANT message INSERT  (ON CONFLICT DO NOTHING — 멱등)
 *   2. reservation RESERVED → COMPLETED
 *   3. usage reserved_count -1, completed_count +1
 *
 * 실패 시: drizzle transaction 자동 rollback
 *   → reservation RESERVED 유지 → 동일 request_id retry 가능.
 *
 * 보장 (invariant):
 *   COMPLETED reservation이 존재하면 반드시 ASSISTANT message도 존재한다.
 *   "COMPLETED + no persisted result" 상태 불가능.
 *
 * 외부 HTTP 호출 금지 — ENGINE 호출 완료 후 DB-only 작업만.
 *
 * @param params.parentId         학부모 account ID
 * @param params.requestId        요청 UUID (reservation PK)
 * @param params.conversationId   conversation row ID
 * @param params.content          ASSISTANT answer text
 * @param params.safeMetadataJson 직렬화된 metadata JSON (null 허용)
 */
export async function finalizeCurriculumSearchSuccess(params: {
  parentId:         string;
  requestId:        string;
  conversationId:   string;
  content:          string;
  safeMetadataJson: string | null;
}): Promise<void> {
  const { parentId, requestId, conversationId, content, safeMetadataJson } = params;
  const period = getSeoulMonthPeriod();

  await superAdminDb.transaction(async (tx) => {
    // 1. ASSISTANT message — UNIQUE(request_id, role) 보장 → 재시도 시 중복 없음
    await tx.execute(sql`
      INSERT INTO parent_curriculum_messages
        (conversation_id, request_id, role, content, metadata)
      VALUES
        (${conversationId}, ${requestId}, 'ASSISTANT', ${content}, ${safeMetadataJson}::jsonb)
      ON CONFLICT (request_id, role) DO NOTHING
    `);

    // 2. reservation RESERVED → COMPLETED
    //    status='RESERVED' 조건: FAILED / COMPLETED 상태에서 이 경로에 오지 않음
    await tx.execute(sql`
      UPDATE parent_ai_usage_reservations
      SET status       = 'COMPLETED',
          completed_at = NOW()
      WHERE request_id = ${requestId}
        AND status     = 'RESERVED'
    `);

    // 3. usage counters: atomic dec/inc
    await tx.execute(sql`
      UPDATE parent_ai_daily_usage
      SET reserved_count  = GREATEST(0, reserved_count - 1),
          completed_count = completed_count + 1,
          updated_at      = NOW()
      WHERE parent_account_id = ${parentId}
        AND feature            = ${CURRICULUM_SEARCH_FEATURE}
        AND usage_date         = ${period}::date
    `);
  });
}
