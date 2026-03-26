/**
 * SMS 공통 발송 함수 — Provider 분리 구조
 *
 * Provider 선택 우선순위:
 *   1) SMS_PROVIDER=dev   → devSmsProvider (개발용 우회, 로그 출력, 운영 차단)
 *   2) NAVER_SENS_* 4종   → sensSmsProvider
 *   3) SMS_PROVIDER=coolsms + SMS_API_KEY → coolSmsProvider
 *   4) SMS_PROVIDER=aligo + SMS_API_KEY  → aligoSmsProvider
 *
 * SENS 전환 방법:
 *   환경변수에서 SMS_PROVIDER=dev → sens (또는 NAVER_SENS_* 입력) 으로 변경.
 *   코드/검증/DB 구조는 그대로 사용됨.
 */
import { sendSensSmS }  from "./providers/sens.js";
import { sendCoolSms }  from "./providers/coolsms.js";
import { sendAligoSms } from "./providers/aligo.js";
import { sendDevSms }   from "./providers/dev.js";

export type SmsProvider = "dev" | "sens" | "coolsms" | "aligo";

/**
 * 현재 활성 provider를 반환.
 * dev provider는 운영 환경(NODE_ENV=production)에서 차단됨.
 */
export function getActiveProvider(): SmsProvider | null {
  const smsProvider = (process.env.SMS_PROVIDER ?? "").toLowerCase();

  // dev provider — 개발 환경에서만 허용
  if (smsProvider === "dev") {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[SMS] ⛔ 치명적 오류: NODE_ENV=production 환경에서 SMS_PROVIDER=dev 사용 불가. " +
        "서버를 시작하지 않습니다.",
      );
      // 운영 배포 시 서버 프로세스를 강제 종료하지 않고 null 반환 후 API에서 차단
      return null;
    }
    return "dev";
  }

  // SENS — 4종 환경변수 모두 설정 시 자동 선택 (SMS_PROVIDER 설정 불필요)
  if (
    process.env.NAVER_SENS_ACCESS_KEY &&
    process.env.NAVER_SENS_SECRET_KEY &&
    process.env.NAVER_SENS_SERVICE_ID &&
    process.env.NAVER_SENS_SENDER_PHONE
  ) return "sens";

  // SMS_PROVIDER=sens 명시 (NAVER_SENS_* 는 sensSmsProvider 내부에서 검증)
  if (smsProvider === "sens") return "sens";

  // 기타 provider
  if (smsProvider === "coolsms" && process.env.SMS_API_KEY && process.env.SMS_SENDER_PHONE) return "coolsms";
  if (smsProvider === "aligo"   && process.env.SMS_API_KEY && process.env.SMS_SENDER_PHONE) return "aligo";

  return null;
}

export function isSmsConfigured(): boolean {
  return getActiveProvider() !== null;
}

export function getSmsConfigError(): string | null {
  const provider = getActiveProvider();
  if (provider !== null) return null;

  // 운영 + dev 조합 차단 메시지
  if (
    (process.env.SMS_PROVIDER ?? "").toLowerCase() === "dev" &&
    process.env.NODE_ENV === "production"
  ) {
    return "운영 환경에서는 개발용 SMS provider(dev)를 사용할 수 없습니다.";
  }

  // SENS 부분 설정 감지
  if (process.env.NAVER_SENS_ACCESS_KEY || process.env.NAVER_SENS_SERVICE_ID) {
    if (!process.env.NAVER_SENS_ACCESS_KEY)   return "NAVER_SENS_ACCESS_KEY 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SECRET_KEY)   return "NAVER_SENS_SECRET_KEY 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SERVICE_ID)   return "NAVER_SENS_SERVICE_ID 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SENDER_PHONE) return "NAVER_SENS_SENDER_PHONE 환경변수가 설정되지 않았습니다.";
  }

  return "SMS 서비스가 설정되지 않았습니다. (SMS_PROVIDER=dev/sens 또는 NAVER_SENS_* 환경변수를 확인해주세요)";
}

/**
 * 개발용 인증번호 발송 (dev provider 전용)
 *
 * sendSms()와 달리, 생성된 code를 받아 로그에 출력하고
 * dev_code를 반환 — auth.ts 에서 응답에 포함시킴.
 *
 * 운영 환경에서는 이 함수를 호출하지 않음.
 */
export function sendDevVerification({
  phone,
  code,
  purpose,
}: {
  phone: string;
  code: string;
  purpose: string;
}): string {
  const result = sendDevSms({ phone, code, purpose });
  return result.code;
}

/**
 * 실제 SMS 발송 (sens/coolsms/aligo provider 전용)
 *
 * dev provider는 이 함수를 사용하지 않음.
 * auth.ts 에서 provider 종류에 따라 분기함.
 */
export async function sendSms({
  phone,
  message,
}: {
  phone: string;
  message: string;
}): Promise<void> {
  const provider = getActiveProvider();

  if (!provider || provider === "dev") {
    throw new Error("sendSms()는 실제 SMS provider(sens/coolsms/aligo)에서만 사용합니다.");
  }

  const from = process.env.NAVER_SENS_SENDER_PHONE ?? process.env.SMS_SENDER_PHONE ?? "";

  switch (provider) {
    case "sens":     return sendSensSmS({ phone, message });
    case "coolsms":  return sendCoolSms({ phone, message, from });
    case "aligo":    return sendAligoSms({ phone, message, from });
  }
}
