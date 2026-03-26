/**
 * SMS 공통 발송 함수
 *
 * Provider 우선순위:
 *   1) 네이버 SENS  — NAVER_SENS_ACCESS_KEY + NAVER_SENS_SECRET_KEY + NAVER_SENS_SERVICE_ID + NAVER_SENS_SENDER_PHONE
 *   2) CoolSMS      — SMS_PROVIDER=coolsms + SMS_API_KEY + SMS_API_SECRET + SMS_SENDER_PHONE
 *   3) 알리고       — SMS_PROVIDER=aligo   + SMS_API_KEY + SMS_USER_ID   + SMS_SENDER_PHONE
 */
import { sendSensSmS }   from "./providers/sens.js";
import { sendCoolSms }   from "./providers/coolsms.js";
import { sendAligoSms }  from "./providers/aligo.js";

type Provider = "sens" | "coolsms" | "aligo" | null;

function detectProvider(): Provider {
  if (
    process.env.NAVER_SENS_ACCESS_KEY &&
    process.env.NAVER_SENS_SECRET_KEY &&
    process.env.NAVER_SENS_SERVICE_ID &&
    process.env.NAVER_SENS_SENDER_PHONE
  ) return "sens";

  const p = (process.env.SMS_PROVIDER ?? "").toLowerCase();
  if (p === "coolsms" && process.env.SMS_API_KEY && process.env.SMS_SENDER_PHONE) return "coolsms";
  if (p === "aligo"   && process.env.SMS_API_KEY && process.env.SMS_SENDER_PHONE) return "aligo";

  return null;
}

export function isSmsConfigured(): boolean {
  return detectProvider() !== null;
}

export function getSmsConfigError(): string | null {
  const provider = detectProvider();

  // SENS 부분 설정 감지 (일부만 있으면 상세 오류)
  if (process.env.NAVER_SENS_ACCESS_KEY || process.env.NAVER_SENS_SERVICE_ID) {
    if (!process.env.NAVER_SENS_ACCESS_KEY)   return "NAVER_SENS_ACCESS_KEY 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SECRET_KEY)   return "NAVER_SENS_SECRET_KEY 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SERVICE_ID)   return "NAVER_SENS_SERVICE_ID 환경변수가 설정되지 않았습니다.";
    if (!process.env.NAVER_SENS_SENDER_PHONE) return "NAVER_SENS_SENDER_PHONE 환경변수가 설정되지 않았습니다.";
  }

  if (provider !== null) return null;
  return "SMS 서비스가 설정되지 않았습니다. (NAVER_SENS_* 또는 SMS_PROVIDER/SMS_API_KEY 환경변수를 확인해주세요)";
}

export async function sendSms({
  phone,
  message,
}: {
  phone: string;
  message: string;
}): Promise<void> {
  const provider = detectProvider();

  if (!provider) {
    const configErr = getSmsConfigError();
    throw new Error(configErr ?? "SMS provider 미설정");
  }

  const from = process.env.NAVER_SENS_SENDER_PHONE ?? process.env.SMS_SENDER_PHONE ?? "";

  switch (provider) {
    case "sens":
      return sendSensSmS({ phone, message });

    case "coolsms":
      return sendCoolSms({ phone, message, from });

    case "aligo":
      return sendAligoSms({ phone, message, from });
  }
}
