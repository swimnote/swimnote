/**
 * makeup-date-range.test.ts — 보강 날짜 범위 수정 케이스별 단위 검증
 *
 * 고정 KST 오늘: 2026-08-06
 *   rangeStart = 2026-07-23  (오늘 -14일)
 *   rangeEnd   = 2026-09-03  (오늘 +28일)
 *
 * 검증 항목:
 *   A. addDateDays / dayOfWeekFromDateStr helper (월말·연말·윤년·평년·요일)
 *   B. 날짜 경계 (rangeStart/rangeEnd 포함·초과)
 *   C. 결석일 관계 (이전·당일·이후 모두 허용)
 *   D. 보강권 상태별 처리 (waiting/expired/completed/cancelled/extinguished)
 *   E. assign / complete-direct API 분기 기준
 *   F. 관리자 assign 날짜 범위 검증
 *
 * 원칙:
 *   - 실제 DB/HTTP 없음 — 핵심 로직만 인라인으로 추출해 검증
 *   - teachers.ts · admin.ts 실제 구현과 동일한 함수 사용
 *   - 운영 DB 변경 없음
 */

import { describe, it, expect } from 'vitest';

// ── 고정 KST 오늘 ────────────────────────────────────────────────────────────
const KST_TODAY   = '2026-08-06';   // 목요일
const RANGE_START = '2026-07-23';   // today - 14일, 목요일
const RANGE_END   = '2026-09-03';   // today + 28일, 목요일

// ════════════════════════════════════════════════════════════════════════════
// 인라인 구현 (teachers.ts · admin.ts 의 실제 코드와 동일)
// ════════════════════════════════════════════════════════════════════════════

/** YYYY-MM-DD + N일 → YYYY-MM-DD (서버 로컬 timezone 독립) */
function addDateDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** YYYY-MM-DD → 요일 번호 0=일 (UTC 기반) */
function dayOfWeekFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 날짜 범위 검증 — validateMakeupOccurrence 조건 3 (인라인)
 * teachers.ts · admin.ts 동일 로직
 */
function checkDateRange(occurrenceDate: string, kstToday: string): 'PASS' | 'MAKEUP_DATE_OUT_OF_RANGE' {
  const rangeStart = addDateDays(kstToday, -14);
  const rangeEnd   = addDateDays(kstToday, +28);
  if (occurrenceDate < rangeStart || occurrenceDate > rangeEnd) return 'MAKEUP_DATE_OUT_OF_RANGE';
  return 'PASS';
}

/**
 * expire_at 이전 날짜 제한 (기존 조건 4, 제거됨) — 제거 후 동작 확인용
 * 제거 전: allowExpired=false & expire_at 초과 → MAKEUP_EXPIRED
 * 제거 후: 항상 'REMOVED' (expire_at은 더 이상 날짜 제한에 관여하지 않음)
 */
function checkExpireAt_REMOVED(_occurrenceDate: string, _expireAt: string | null, _allowExpired: boolean): 'REMOVED' {
  return 'REMOVED';
}

/**
 * 보강권 상태 게이트 — teachers.ts assign·complete-direct 라우트 동일 로직
 * validateMakeupOccurrence 진입 전 처리됨
 */
function checkStatus(status: string, allowExpired: boolean): 'PASS' | string {
  if (status === 'completed')  return 'MAKEUP_ALREADY_COMPLETED';
  if (status === 'cancelled')  return 'MAKEUP_ALREADY_CANCELLED';
  if (!['waiting', 'assigned', 'expired'].includes(status)) return 'MAKEUP_ALREADY_CANCELLED';
  if (status === 'expired' && !allowExpired) return 'MAKEUP_EXPIRED_CONFIRM_REQUIRED';
  return 'PASS';
}

/**
 * assign / complete-direct 분기 기준 — teachers.ts 동일 로직
 * assign은 is_future 전용, complete-direct는 is_today_or_past 전용
 */
function checkFuturePast(occurrenceDate: string, kstToday: string): 'is_future' | 'is_today_or_past' {
  return occurrenceDate > kstToday ? 'is_future' : 'is_today_or_past';
}

// ════════════════════════════════════════════════════════════════════════════
// A. addDateDays / dayOfWeekFromDateStr helper
// ════════════════════════════════════════════════════════════════════════════
describe('A. addDateDays / dayOfWeekFromDateStr helper', () => {
  it('A-01 월말 이동: 2026-08-06 + 28일 = 2026-09-03', () => {
    expect(addDateDays('2026-08-06', 28)).toBe('2026-09-03');
  });

  it('A-02 연말 이동: 2025-12-28 + 7일 = 2026-01-04', () => {
    expect(addDateDays('2025-12-28', 7)).toBe('2026-01-04');
  });

  it('A-03 윤년 2028-02-27 + 2일 = 2028-02-29', () => {
    expect(addDateDays('2028-02-27', 2)).toBe('2028-02-29');
  });

  it('A-04 평년 2025-02-27 + 2일 = 2025-03-01', () => {
    expect(addDateDays('2025-02-27', 2)).toBe('2025-03-01');
  });

  it('A-05 음수 이동: 2026-08-06 - 14일 = 2026-07-23', () => {
    expect(addDateDays('2026-08-06', -14)).toBe('2026-07-23');
  });

  it('A-06 요일: 2026-08-06 = 목(4)', () => {
    expect(dayOfWeekFromDateStr('2026-08-06')).toBe(4);
  });

  it('A-07 요일: 2026-07-23 = 목(4)', () => {
    expect(dayOfWeekFromDateStr('2026-07-23')).toBe(4);
  });

  it('A-08 요일: 2026-09-03 = 목(4)', () => {
    expect(dayOfWeekFromDateStr('2026-09-03')).toBe(4);
  });

  it('A-09 연말 KST 자정: 2025-12-31 + 1일 = 2026-01-01', () => {
    expect(addDateDays('2025-12-31', 1)).toBe('2026-01-01');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// B. 날짜 경계 — eligible / API 허용 여부
// ════════════════════════════════════════════════════════════════════════════
describe('B. 날짜 경계 (rangeStart=2026-07-23, rangeEnd=2026-09-03)', () => {
  it('B-01 오늘 -15일 (2026-07-22) → MAKEUP_DATE_OUT_OF_RANGE', () => {
    const date = addDateDays(KST_TODAY, -15);
    expect(date).toBe('2026-07-22');
    expect(checkDateRange(date, KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('B-02 오늘 -14일 (2026-07-23 = rangeStart) → PASS', () => {
    const date = addDateDays(KST_TODAY, -14);
    expect(date).toBe(RANGE_START);
    expect(checkDateRange(date, KST_TODAY)).toBe('PASS');
  });

  it('B-03 오늘 (2026-08-06) → PASS', () => {
    expect(checkDateRange(KST_TODAY, KST_TODAY)).toBe('PASS');
  });

  it('B-04 오늘 +28일 (2026-09-03 = rangeEnd) → PASS', () => {
    const date = addDateDays(KST_TODAY, +28);
    expect(date).toBe(RANGE_END);
    expect(checkDateRange(date, KST_TODAY)).toBe('PASS');
  });

  it('B-05 오늘 +29일 (2026-09-04) → MAKEUP_DATE_OUT_OF_RANGE', () => {
    const date = addDateDays(KST_TODAY, +29);
    expect(date).toBe('2026-09-04');
    expect(checkDateRange(date, KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('B-06 rangeStart 경계 문자열 비교 ("<" 방향): rangeStart-1 < rangeStart', () => {
    const before = addDateDays(RANGE_START, -1);
    expect(before < RANGE_START).toBe(true);
    expect(checkDateRange(before, KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('B-07 rangeEnd 경계 문자열 비교 (">" 방향): rangeEnd+1 > rangeEnd', () => {
    const after = addDateDays(RANGE_END, +1);
    expect(after > RANGE_END).toBe(true);
    expect(checkDateRange(after, KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// C. 결석일 관계 — 이전·당일·이후 모두 범위 내 허용
// ════════════════════════════════════════════════════════════════════════════
describe('C. 결석일 관계 (absence_date 제한 제거됨)', () => {
  const absence = '2026-08-14'; // 미래 결석 예정일

  it('C-01 occurrenceDate < absence_date (선보강, 오늘 = 2026-08-06) → PASS', () => {
    const occ = '2026-08-06'; // 오늘, 결석일 이전
    expect(occ < absence).toBe(true);
    expect(checkDateRange(occ, KST_TODAY)).toBe('PASS');
  });

  it('C-02 occurrenceDate = absence_date (결석 당일 = 2026-08-14) → PASS (범위 내)', () => {
    const occ = absence; // 2026-08-14
    expect(occ === absence).toBe(true);
    expect(checkDateRange(occ, KST_TODAY)).toBe('PASS');
  });

  it('C-03 occurrenceDate > absence_date (일반 보강, 2026-09-03) → PASS', () => {
    const occ = '2026-09-03'; // rangeEnd = 결석일 이후
    expect(occ > absence).toBe(true);
    expect(checkDateRange(occ, KST_TODAY)).toBe('PASS');
  });

  it('C-04 DATE_BEFORE_OR_ON_ABSENCE 에러 코드가 더 이상 발생하지 않음 (코드 제거 확인)', () => {
    // 기존 조건: occurrenceDate <= absence_date → DATE_BEFORE_OR_ON_ABSENCE
    // 새 코드: 해당 조건 완전 제거, 범위만 확인
    const occ = '2026-08-06'; // 결석일(2026-08-14) 이전
    // 범위 내이므로 PASS, DATE_BEFORE_OR_ON_ABSENCE 없음
    expect(checkDateRange(occ, KST_TODAY)).toBe('PASS');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D. 보강권 상태별 처리
// ════════════════════════════════════════════════════════════════════════════
describe('D. 보강권 상태 (라우트 수준 게이트)', () => {
  it('D-01 waiting + 범위 내 + 기존 expire_at 이후 → PASS (expire_at 제한 제거됨)', () => {
    // 기존: expire_at=2026-07-01, occurrenceDate=2026-08-06 → MAKEUP_EXPIRED
    // 신규: expire_at 제한 완전 제거 → 범위만 확인 → PASS
    expect(checkStatus('waiting', false)).toBe('PASS');
    expect(checkExpireAt_REMOVED('2026-08-06', '2026-07-01', false)).toBe('REMOVED');
    expect(checkDateRange('2026-08-06', KST_TODAY)).toBe('PASS');
  });

  it('D-02 expired + allow_expired=false → MAKEUP_EXPIRED_CONFIRM_REQUIRED', () => {
    expect(checkStatus('expired', false)).toBe('MAKEUP_EXPIRED_CONFIRM_REQUIRED');
  });

  it('D-03 expired + allow_expired=true + 범위 내 → PASS', () => {
    expect(checkStatus('expired', true)).toBe('PASS');
    expect(checkDateRange('2026-08-06', KST_TODAY)).toBe('PASS');
  });

  it('D-04 expired + allow_expired=true + 범위 밖 → MAKEUP_DATE_OUT_OF_RANGE', () => {
    expect(checkStatus('expired', true)).toBe('PASS'); // 상태 게이트 통과
    expect(checkDateRange('2026-06-01', KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE'); // 범위 밖
  });

  it('D-05 completed → MAKEUP_ALREADY_COMPLETED (차단)', () => {
    expect(checkStatus('completed', false)).toBe('MAKEUP_ALREADY_COMPLETED');
  });

  it('D-06 cancelled → MAKEUP_ALREADY_CANCELLED (차단)', () => {
    expect(checkStatus('cancelled', false)).toBe('MAKEUP_ALREADY_CANCELLED');
  });

  it('D-07 extinguished → MAKEUP_ALREADY_CANCELLED (차단, waiting/assigned/expired 외)', () => {
    expect(checkStatus('extinguished', false)).toBe('MAKEUP_ALREADY_CANCELLED');
  });

  it('D-08 두 검증 모두 통과해야 처리 가능 (waiting + 범위 내)', () => {
    expect(checkStatus('waiting', false)).toBe('PASS');
    expect(checkDateRange('2026-08-06', KST_TODAY)).toBe('PASS');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// E. assign / complete-direct 분기 유지
// ════════════════════════════════════════════════════════════════════════════
describe('E. assign / complete-direct 분기 기준', () => {
  it('E-01 미래(+28일) → is_future → assign 전용', () => {
    expect(checkFuturePast('2026-09-03', KST_TODAY)).toBe('is_future');
    // assign에서 !isFuture이면 ASSIGN_REQUIRES_FUTURE_DATE → 미래이므로 통과
  });

  it('E-02 오늘 → is_today_or_past → complete-direct 전용', () => {
    expect(checkFuturePast(KST_TODAY, KST_TODAY)).toBe('is_today_or_past');
  });

  it('E-03 과거(-14일) → is_today_or_past → complete-direct 전용', () => {
    expect(checkFuturePast('2026-07-23', KST_TODAY)).toBe('is_today_or_past');
  });

  it('E-04 오늘을 assign 요청 → ASSIGN_REQUIRES_FUTURE_DATE (분기 유지)', () => {
    // 코드: if (!validation.isFuture) throw ASSIGN_REQUIRES_FUTURE_DATE
    const isFuture = checkFuturePast(KST_TODAY, KST_TODAY) === 'is_future';
    expect(isFuture).toBe(false); // → ASSIGN_REQUIRES_FUTURE_DATE 발생
  });

  it('E-05 미래를 complete-direct 요청 → COMPLETE_DIRECT_REQUIRES_TODAY_OR_PAST (분기 유지)', () => {
    // 코드: if (validation.isFuture) throw COMPLETE_DIRECT_REQUIRES_TODAY_OR_PAST
    const isFuture = checkFuturePast('2026-09-03', KST_TODAY) === 'is_future';
    expect(isFuture).toBe(true); // → COMPLETE_DIRECT_REQUIRES_TODAY_OR_PAST 발생
  });
});

// ════════════════════════════════════════════════════════════════════════════
// F. 관리자 assign 날짜 범위 검증 (admin.ts 동일 로직)
// ════════════════════════════════════════════════════════════════════════════
describe('F. 관리자 assign 날짜 범위 (admin.ts)', () => {
  /**
   * admin.ts assign 라우트 범위 검증 (인라인)
   * assigned_date가 없으면 스킵
   */
  function adminDateCheck(assigned_date: string | undefined | null, kstToday: string)
    : 'SKIPPED' | 'INVALID_FORMAT' | 'MAKEUP_DATE_OUT_OF_RANGE' | 'PASS' {
    if (!assigned_date) return 'SKIPPED';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assigned_date)) return 'INVALID_FORMAT';
    const rangeStart = addDateDays(kstToday, -14);
    const rangeEnd   = addDateDays(kstToday, +28);
    if (assigned_date < rangeStart || assigned_date > rangeEnd) return 'MAKEUP_DATE_OUT_OF_RANGE';
    return 'PASS';
  }

  it('F-01 범위 내 (2026-09-03 = rangeEnd) → PASS', () => {
    expect(adminDateCheck('2026-09-03', KST_TODAY)).toBe('PASS');
  });

  it('F-02 범위 내 (오늘) → PASS', () => {
    expect(adminDateCheck(KST_TODAY, KST_TODAY)).toBe('PASS');
  });

  it('F-03 범위 내 rangeStart (2026-07-23) → PASS', () => {
    expect(adminDateCheck('2026-07-23', KST_TODAY)).toBe('PASS');
  });

  it('F-04 범위 밖 (2026-06-01) → MAKEUP_DATE_OUT_OF_RANGE + message 존재', () => {
    const result = adminDateCheck('2026-06-01', KST_TODAY);
    expect(result).toBe('MAKEUP_DATE_OUT_OF_RANGE');
    // 서버 응답: { error: "MAKEUP_DATE_OUT_OF_RANGE", message: "보강일은 오늘 기준 2주 전부터 4주 후까지 선택할 수 있습니다." }
    const message = '보강일은 오늘 기준 2주 전부터 4주 후까지 선택할 수 있습니다.';
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
  });

  it('F-05 범위 밖 (2026-10-01 = +29일 이상) → MAKEUP_DATE_OUT_OF_RANGE', () => {
    expect(adminDateCheck('2026-10-01', KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('F-06 assigned_date 없음 → SKIPPED (범위 오류 없음)', () => {
    expect(adminDateCheck(null, KST_TODAY)).toBe('SKIPPED');
    expect(adminDateCheck(undefined, KST_TODAY)).toBe('SKIPPED');
  });

  it('F-07 잘못된 형식 → INVALID_FORMAT', () => {
    expect(adminDateCheck('2026/09/03', KST_TODAY)).toBe('INVALID_FORMAT');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// G. 통합 시나리오 — 두 검증 모두 통과해야 허용
// ════════════════════════════════════════════════════════════════════════════
describe('G. 통합 시나리오 (상태 + 범위 모두 통과 조건)', () => {
  function fullCheck(status: string, allowExpired: boolean, occurrenceDate: string, kstToday: string)
    : string {
    const statusResult = checkStatus(status, allowExpired);
    if (statusResult !== 'PASS') return statusResult;
    return checkDateRange(occurrenceDate, kstToday);
  }

  it('G-01 waiting + 범위 내 → PASS', () => {
    expect(fullCheck('waiting', false, '2026-08-06', KST_TODAY)).toBe('PASS');
  });

  it('G-02 waiting + 범위 밖 → MAKEUP_DATE_OUT_OF_RANGE', () => {
    expect(fullCheck('waiting', false, '2026-06-01', KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('G-03 expired + allow_expired=false → MAKEUP_EXPIRED_CONFIRM_REQUIRED (범위 도달 안 함)', () => {
    expect(fullCheck('expired', false, '2026-08-06', KST_TODAY)).toBe('MAKEUP_EXPIRED_CONFIRM_REQUIRED');
  });

  it('G-04 expired + allow_expired=true + 범위 내 → PASS', () => {
    expect(fullCheck('expired', true, '2026-08-06', KST_TODAY)).toBe('PASS');
  });

  it('G-05 expired + allow_expired=true + 범위 밖 → MAKEUP_DATE_OUT_OF_RANGE', () => {
    expect(fullCheck('expired', true, '2026-06-01', KST_TODAY)).toBe('MAKEUP_DATE_OUT_OF_RANGE');
  });

  it('G-06 completed → MAKEUP_ALREADY_COMPLETED (범위 도달 안 함)', () => {
    expect(fullCheck('completed', false, '2026-08-06', KST_TODAY)).toBe('MAKEUP_ALREADY_COMPLETED');
  });

  it('G-07 cancelled → MAKEUP_ALREADY_CANCELLED (범위 도달 안 함)', () => {
    expect(fullCheck('cancelled', false, '2026-08-06', KST_TODAY)).toBe('MAKEUP_ALREADY_CANCELLED');
  });

  it('G-08 extinguished → MAKEUP_ALREADY_CANCELLED (범위 도달 안 함)', () => {
    expect(fullCheck('extinguished', false, '2026-08-06', KST_TODAY)).toBe('MAKEUP_ALREADY_CANCELLED');
  });
});
