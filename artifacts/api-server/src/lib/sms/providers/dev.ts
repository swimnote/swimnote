/**
 * 개발용 SMS Provider (devSmsProvider)
 *
 * - 실제 SMS를 발송하지 않음
 * - 인증번호를 서버 로그에 출력
 * - 응답에 dev_code 포함 (앱 화면 표시용)
 * - 운영 환경(NODE_ENV=production)에서는 절대 사용 불가
 *
 * SENS 승인 후 SMS_PROVIDER=sens 로 변경하면 즉시 실전 전환됨.
 * 코드/검증 구조는 그대로 유지됨.
 */

export interface DevSmsResult {
  code: string;
}

/**
 * 개발용 SMS 발송 (실제 발송 없음)
 * 인증번호를 로그에 출력하고, 코드를 반환함.
 */
export function sendDevSms({
  phone,
  code,
  purpose,
}: {
  phone: string;
  code: string;
  purpose: string;
}): DevSmsResult {
  console.log(`[DEV SMS] phone=${phone} code=${code} purpose=${purpose}`);
  return { code };
}
