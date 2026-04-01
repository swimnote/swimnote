import { Linking } from "react-native";

export const CALL_COLOR = "#64748B";
export const SMS_COLOR  = "#10B981";

/** 유효한 전화번호 여부 (숫자 추출 후 10~11자리) */
export function isValidPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const cleaned = phone.replace(/[^0-9]/g, "");
  return cleaned.length >= 10 && cleaned.length <= 11;
}

/**
 * 즉시 전화 앱 실행
 * - 숫자 외 문자 제거
 * - 유효 번호(10~11자리)일 때만 실행
 * - 확인 단계 없음
 */
export function callPhone(phone: string | null | undefined) {
  if (!isValidPhone(phone)) return;
  const cleaned = phone!.replace(/[^0-9]/g, "");
  Linking.openURL(`tel:${cleaned}`).catch(() => {});
}

/**
 * SMS 앱 실행 (수신자 번호 자동 입력)
 */
export function sendSms(phone: string | null | undefined) {
  if (!isValidPhone(phone)) return;
  const cleaned = phone!.replace(/[^0-9]/g, "");
  Linking.openURL(`sms:${cleaned}`).catch(() => {});
}

/**
 * SMS 앱 실행 (번호 + 메시지 내용 자동 입력)
 * iOS:     sms:PHONE&body=MESSAGE
 * Android: sms:PHONE?body=MESSAGE
 */
export function sendSmsWithBody(phone: string | null | undefined, body: string) {
  if (!isValidPhone(phone)) return;
  const cleaned = phone!.replace(/[^0-9]/g, "");
  const encoded = encodeURIComponent(body);
  Linking.openURL(`sms:${cleaned}?body=${encoded}`).catch(() => {});
}

/** 전화번호 포맷: 01012345678 → 010-1234-5678 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return phone;
}
