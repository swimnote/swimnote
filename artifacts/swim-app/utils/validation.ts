/**
 * validation.ts — 앱 전체 공통 입력 검증 함수
 *
 * 기존 studentUtils / phoneUtils 를 건드리지 않고
 * 추후 각 화면의 검증 로직을 이쪽으로 단계적으로 이전하기 위한 준비 파일.
 *
 * ─ 이름 충돌 없음 ─
 *   studentUtils : normalizePhone  (하이픈 포함 포맷 반환)
 *   studentUtils : isValidPhone    (한국 모바일 패턴 정규식)
 *   studentUtils : isValidBirthYear (2000~현재, 어린이 기준)
 *   phoneUtils   : isValidPhone    (null|undefined 수용, 단순 10~11자리)
 *   ↑ 위 함수들은 그대로 유지. 아래 함수는 독립적으로 동작.
 */

/** 이름 유효성 검사
 *  - 공백 trim 후 1자 이상이면 true
 *  - 빈 문자열 / 공백만 있으면 false
 */
export function validateName(name: string): boolean {
  return name.trim().length > 0;
}

/** 전화번호 유효성 검사
 *  - 숫자 이외 문자(-, 공백 등) 제거 후 10~11자리이면 true
 *  - 입력 예: "010-1234-5678", "01012345678", "0212345678"
 */
export function validatePhone(phone: string): boolean {
  const digits = phone.replace(/[^0-9]/g, "");
  return digits.length >= 10 && digits.length <= 11;
}

/** 전화번호 정규화
 *  - 숫자만 남긴 순수 digit 문자열을 반환 (하이픈 없음)
 *  - 입력이 9자리일 경우 앞에 "0" 추가 (예: 1012345678 → 01012345678)
 *  - 기존 studentUtils.normalizePhone 과 달리 하이픈 포함 포맷을 반환하지 않음
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 10 && !digits.startsWith("0")) {
    return "0" + digits;
  }
  return digits;
}

/** 출생년도 유효성 검사
 *  - 빈 문자열은 허용 (선택 필드) → true 반환
 *  - 값이 있으면 4자리 숫자이고 1940 ~ 현재 연도 범위이어야 true
 *    (성인 회원도 등록 가능하도록 1940부터 허용)
 */
export function validateBirthYear(year: string): boolean {
  if (year.trim() === "") return true;
  if (!/^\d{4}$/.test(year.trim())) return false;
  const y = parseInt(year, 10);
  const current = new Date().getFullYear();
  return y >= 1940 && y <= current;
}
