/**
 * historyUtils.ts — student_class_history 종료 유틸
 *
 * KST 날짜 계산 + effective_date 검증 + history 종료 함수
 * students.ts / admin.ts 공통 사용
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// tx 타입: execute 메서드만 요구 (Drizzle 버전 의존성 없이 실제 사용 메서드만 요구)
export interface HistoryTx {
  execute: typeof db.execute;
}

/**
 * KST 기준 오늘 날짜 YYYY-MM-DD 반환
 *
 * 구현: Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format()
 * - en-CA locale은 YYYY-MM-DD 형식을 직접 반환하므로 파싱 불필요
 * - KST = UTC+9, DST 없음 → UTC+9 고정 오프셋도 동일하나 Intl이 더 명시적
 * - 서버 로케일·시스템 시간대에 무관
 * - 00:00~08:59 KST(= UTC 전날 15:00~23:59)에도 정확한 한국 날짜 반환
 *
 * 코드베이스 동일 패턴: today-schedule.ts 의 todayKST() (UTC+9 offset 방식)
 * → 동일 결과. Intl 방식이 DST-safe하므로 통일
 */
export function kstTodayStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * YYYY-MM-DD 형식 및 실존 날짜 검증
 * @returns 정규화된 날짜 문자열, 오류 시 null
 */
export function validateEffectiveDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  // 재구성 후 원본과 비교 (2024-02-30 같은 존재하지 않는 날짜 방지)
  const reconstructed = d.toISOString().slice(0, 10);
  if (reconstructed !== value) return null;
  return value;
}

/**
 * 학생의 모든 활성 history 종료 (전체 반 이탈용)
 * suspended / withdrawn / archived / unassigned 전환 시 사용
 * class_group_id 조건 없음 → 활성 history 전체 종료
 */
export async function closeAllActiveClassHistory(
  tx: HistoryTx,
  studentId: string,
  effectiveDate: string, // KST YYYY-MM-DD
): Promise<void> {
  await tx.execute(sql`
    UPDATE student_class_history
    SET left_at = ${effectiveDate}::date
    WHERE student_id = ${studentId}
      AND left_at IS NULL
  `);
}

/**
 * 특정 반의 활성 history 종료 (특정 반 이탈용)
 * remove-from-class (즉시, new_status 없음) 시 사용
 */
export async function closeClassHistory(
  tx: HistoryTx,
  studentId: string,
  classGroupId: string,
  effectiveDate: string, // KST 또는 클라이언트 전송 YYYY-MM-DD
): Promise<void> {
  await tx.execute(sql`
    UPDATE student_class_history
    SET left_at = ${effectiveDate}::date
    WHERE student_id = ${studentId}
      AND class_group_id = ${classGroupId}
      AND left_at IS NULL
  `);
}
