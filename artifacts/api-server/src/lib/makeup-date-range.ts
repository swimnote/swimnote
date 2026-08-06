/**
 * makeup-date-range.ts — 보강 날짜 범위 검증 공용 helper
 *
 * teachers.ts · admin.ts 양쪽에서 실제 import하여 사용한다.
 * 서버 로컬 timezone 독립: 모든 날짜 연산은 Date.UTC 기반.
 * 테스트는 이 파일을 직접 import하여 운영 코드와 동일 로직을 검증한다.
 */

/**
 * YYYY-MM-DD 문자열에 N일을 더한 날짜 문자열을 반환한다.
 * - 서버 로컬 timezone 독립: Date.UTC 기반 순수 날짜 연산
 * - 음수 days 허용 (오늘 -14일 등)
 * - 월말·연말·윤년: Date.UTC 내장 처리
 */
export function addDateDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * YYYY-MM-DD 문자열을 요일 번호로 변환한다 (0=일, UTC 기반).
 * 서버 로컬 timezone 독립.
 */
export function dayOfWeekFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * YYYY-MM-DD 형식인지 정규식만으로 확인한다.
 * 실존 날짜 여부는 포함하지 않는다.
 */
export function isValidDateFormat(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * YYYY-MM-DD 형식이면서 달력에 실존하는 날짜인지 확인한다.
 * - 2026-02-31 → false (2월에 31일 없음)
 * - 2026-13-01 → false (13월 없음)
 * - 2026-00-10 → false (0월 없음)
 * - 2028-02-29 → true  (윤년)
 * - 2025-02-29 → false (평년)
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (!isValidDateFormat(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth()    === m - 1 &&
    dt.getUTCDate()     === d
  );
}

/**
 * KST 오늘 기준 보강 가능 날짜 범위를 반환한다.
 * rangeStart = kstToday - 14일
 * rangeEnd   = kstToday + 28일 (총 43일)
 */
export function getMakeupDateRange(kstToday: string): { rangeStart: string; rangeEnd: string } {
  return {
    rangeStart: addDateDays(kstToday, -14),
    rangeEnd:   addDateDays(kstToday, +28),
  };
}

/**
 * 보강일이 허용 범위 밖이면 { code, message, status } 형태로 throw한다.
 * 범위 내이면 아무것도 하지 않는다.
 * throw 형태는 라우트 catch 블록에서 `if (e.code && e.status)` 패턴으로 처리된다.
 */
export function validateMakeupDateRange(occurrenceDate: string, kstToday: string): void {
  const { rangeStart, rangeEnd } = getMakeupDateRange(kstToday);
  if (occurrenceDate < rangeStart || occurrenceDate > rangeEnd) {
    throw {
      code: "MAKEUP_DATE_OUT_OF_RANGE",
      message: "보강일은 오늘 기준 2주 전부터 4주 후까지 선택할 수 있습니다.",
      status: 400,
    };
  }
}
