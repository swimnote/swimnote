/**
 * SMS 공통 발송 함수
 *
 * 환경변수:
 *   SMS_PROVIDER      — coolsms | aligo
 *   SMS_API_KEY       — provider API key
 *   SMS_API_SECRET    — provider API secret (CoolSMS 전용)
 *   SMS_USER_ID       — provider user ID (알리고 전용)
 *   SMS_SENDER_PHONE  — 발신번호 (예: 01012345678)
 */
import { sendCoolSms } from "./providers/coolsms.js";
import { sendAligoSms } from "./providers/aligo.js";

export function isSmsConfigured(): boolean {
  return !!(
    process.env.SMS_PROVIDER &&
    process.env.SMS_API_KEY &&
    process.env.SMS_SENDER_PHONE
  );
}

export function getSmsConfigError(): string | null {
  if (!process.env.SMS_PROVIDER)     return "SMS_PROVIDER 환경변수가 설정되지 않았습니다.";
  if (!process.env.SMS_API_KEY)      return "SMS_API_KEY 환경변수가 설정되지 않았습니다.";
  if (!process.env.SMS_SENDER_PHONE) return "SMS_SENDER_PHONE 환경변수가 설정되지 않았습니다.";
  const p = process.env.SMS_PROVIDER.toLowerCase();
  if (p === "coolsms" && !process.env.SMS_API_SECRET)
    return "CoolSMS: SMS_API_SECRET 환경변수가 설정되지 않았습니다.";
  if (p === "aligo" && !process.env.SMS_USER_ID)
    return "알리고: SMS_USER_ID 환경변수가 설정되지 않았습니다.";
  return null;
}

export async function sendSms({
  phone,
  message,
}: {
  phone: string;
  message: string;
}): Promise<void> {
  const configErr = getSmsConfigError();
  if (configErr) throw new Error(configErr);

  const provider = process.env.SMS_PROVIDER!.toLowerCase();
  const from     = process.env.SMS_SENDER_PHONE!;
  const args     = { phone, message, from };

  if (provider === "coolsms") {
    return sendCoolSms(args);
  } else if (provider === "aligo") {
    return sendAligoSms(args);
  } else {
    throw new Error(`지원하지 않는 SMS provider: ${provider} (coolsms 또는 aligo만 지원)`);
  }
}
