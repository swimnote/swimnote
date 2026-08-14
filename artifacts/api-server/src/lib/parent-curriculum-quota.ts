/**
 * parent-curriculum-quota.ts
 *
 * 학부모 커리큘럼 검색 월 사용량 제한.
 *
 * Quota key: parent_account_id + calendar month (Asia/Seoul)
 * Limit:     MONTHLY_LIMIT (10) successful questions / month
 *
 * 기존 tables 재사용:
 *   parent_ai_daily_usage      — usage_date = 해당 월 첫날 (e.g. 2026-08-01)
 *   parent_ai_usage_reservations — request_id PK으로 아이디팟 처리
 *
 * 원칙:
 *   - 서버 오류 / ENGINE 오류 / timeout → quota 차감 금지 (rollback)
 *   - 동시 요청 race condition 방지: UPDATE WHERE count < limit (atomic)
 *   - 동일 request_id retry → 이중 차감 금지
 */

import { superAdminDb } from "@workspace/db";
import { sql }          from "drizzle-orm";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

export const MONTHLY_LIMIT = 10;

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface UsageInfo {
  limit:     number;
  used:      number;
  remaining: number;
  period:    string;    // 'YYYY-MM'
  resets_at: string;   // ISO 8601 with timezone
}

export type QuotaReserveResult =
  | { ok: true;  isRetry: boolean }    // reservation created or idempotent RESERVED/FAILED retry
  | { ok: false; usageInfo: UsageInfo }; // limit reached

// ─── Timezone 헬퍼 ────────────────────────────────────────────────────────────

/**
 * Asia/Seoul 기준 현재 달의 period key (YYYY-MM-01 형식 date string).
 * 새 달이 되면 자연스럽게 0부터 시작하는 새 row가 생성됨.
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

/**
 * Asia/Seoul 기준 현재 달의 period label (YYYY-MM).
 */
export function getSeoulPeriodLabel(): string {
  const period = getSeoulMonthPeriod(); // 'YYYY-MM-01'
  return period.slice(0, 7);            // 'YYYY-MM'
}

/**
 * 다음 달 1일 자정 (Asia/Seoul) ISO 8601 string.
 */
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
  // 다음 달 1일 Asia/Seoul 자정 = UTC +09:00
  return new Date(
    `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`,
  ).toISOString();
}

// ─── 사용량 조회 ──────────────────────────────────────────────────────────────

/**
 * 현재 월 사용량 조회.
 */
export async function getMonthlyUsageInfo(parentId: string): Promise<UsageInfo> {
  const period = getSeoulMonthPeriod();

  const result = await superAdminDb.execute(sql`
    SELECT completed_count, reserved_count
    FROM parent_ai_daily_usage
    WHERE parent_account_id = ${parentId}
      AND usage_date         = ${period}::date
    LIMIT 1
  `);

  const row         = result.rows[0] as any;
  const completed   = Number(row?.completed_count ?? 0);
  const reserved    = Number(row?.reserved_count  ?? 0);
  const used        = completed; // 성공적으로 완료된 횟수
  const remaining   = Math.max(0, MONTHLY_LIMIT - used);

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
 * 아이디팟: 동일 request_id는 중복 예약 없음.
 *
 * 원자성:
 *   1. Ensure month row exists (INSERT ON CONFLICT DO NOTHING)
 *   2. Atomic check-and-increment:
 *      UPDATE ... WHERE (completed + reserved) < LIMIT RETURNING ...
 *      → 0 rows = limit reached; 1 row = reserved
 *   3. Insert reservation (ON CONFLICT DO NOTHING for idempotency)
 *
 * @returns QuotaReserveResult
 */
export async function tryReserveMonthlyQuota(
  parentId:  string,
  requestId: string,
): Promise<QuotaReserveResult> {
  const period = getSeoulMonthPeriod();

  // ── Idempotency: 기존 예약 확인 ─────────────────────────────────────────────
  const existingReservation = await superAdminDb.execute(sql`
    SELECT status
    FROM parent_ai_usage_reservations
    WHERE request_id = ${requestId}
    LIMIT 1
  `);

  if (existingReservation.rows.length > 0) {
    const status = (existingReservation.rows[0] as any).status as string;
    if (status === "RESERVED") {
      // 이미 예약됨 → retry 허용, 재예약 불필요
      return { ok: true, isRetry: true };
    }
    if (status === "COMPLETED") {
      // 이미 완료됨 → 재차감 금지
      return { ok: true, isRetry: true };
    }
    // FAILED / BLOCKED / EXPIRED → fresh attempt (quota was rolled back)
  }

  // ── Step 1: month row upsert (멱등) ──────────────────────────────────────────
  await superAdminDb.execute(sql`
    INSERT INTO parent_ai_daily_usage (parent_account_id, usage_date, reserved_count, completed_count)
    VALUES (${parentId}, ${period}::date, 0, 0)
    ON CONFLICT (parent_account_id, usage_date) DO NOTHING
  `);

  // ── Step 2: Atomic check-and-increment ───────────────────────────────────────
  // PostgreSQL UPDATE는 row-level lock → concurrent requests serialize correctly.
  // completed_count + reserved_count < LIMIT 조건 실패 → 0 rows
  const updateResult = await superAdminDb.execute(sql`
    UPDATE parent_ai_daily_usage
    SET reserved_count = reserved_count + 1,
        updated_at     = NOW()
    WHERE parent_account_id = ${parentId}
      AND usage_date         = ${period}::date
      AND (completed_count + reserved_count) < ${MONTHLY_LIMIT}
    RETURNING completed_count, reserved_count
  `);

  if (!updateResult.rows.length) {
    // 한도 초과
    const usageInfo = await getMonthlyUsageInfo(parentId);
    return { ok: false, usageInfo };
  }

  // ── Step 3: 예약 row 삽입 (request_id PK → 중복 방지) ────────────────────────
  await superAdminDb.execute(sql`
    INSERT INTO parent_ai_usage_reservations (request_id, parent_account_id, usage_date)
    VALUES (${requestId}, ${parentId}, ${period}::date)
    ON CONFLICT (request_id) DO NOTHING
  `);

  return { ok: true, isRetry: false };
}

// ─── 완료 (Finalize) ──────────────────────────────────────────────────────────

/**
 * 성공적인 ENGINE 응답 후 quota 확정.
 * completed_count +1, reserved_count -1, status → COMPLETED
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
 * reserved_count -1, failed_count +1, status → FAILED
 *
 * 이 함수는 성공한 경우에는 절대 호출하지 않는다.
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
