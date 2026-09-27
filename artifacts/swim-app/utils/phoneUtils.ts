import { Linking, Platform } from "react-native";

export const CALL_COLOR = "#64748B";
export const SMS_COLOR  = "#10B981";

// ── 공식 스토어 링크 (Single Source of Truth) ─────────────────────────────────
export const IOS_STORE_URL     = "https://apps.apple.com/kr/app/id6761360360";
export const ANDROID_STORE_URL = "https://play.google.com/store/apps/details?id=com.swimnote.app";

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
 * iOS:     sms:PHONE&body=MESSAGE  (& separator)
 * Android: sms:PHONE?body=MESSAGE  (? separator)
 */
export function sendSmsWithBody(phone: string | null | undefined, body: string) {
  if (!isValidPhone(phone)) return;
  const cleaned  = phone!.replace(/[^0-9]/g, "");
  const encoded  = encodeURIComponent(body);
  const sep      = Platform.OS === "ios" ? "&" : "?";
  Linking.openURL(`sms:${cleaned}${sep}body=${encoded}`).catch(() => {});
}

/**
 * 학부모 초대 SMS 본문 생성
 *
 * @param poolName   수영장명 (없으면 "SWIMNOTE" fallback)
 * @param studentName 학생명 (없으면 "자녀" fallback)
 */
export function buildParentInviteSmsBody(
  poolName:    string | null | undefined,
  studentName: string | null | undefined,
): string {
  const pool    = poolName?.trim()    || null;
  const student = studentName?.trim() || null;

  const header   = pool ? `[${pool}] SWIMNOTE 학부모 앱 가입 안내` : "[SWIMNOTE] 학부모 앱 가입 안내";
  const greeting = pool ? `안녕하세요. ${pool}입니다.` : "안녕하세요. SWIMNOTE 학부모 앱 가입을 안내드립니다.";
  const subject  = student
    ? `${student} 회원님의 수업일지, 사진, 공지와 성장기록을 확인하실 수 있도록 SWIMNOTE 학부모 앱 가입을 안내드립니다.`
    : "자녀의 수업일지, 사진, 공지와 성장기록을 확인하실 수 있도록 SWIMNOTE 학부모 앱 가입을 안내드립니다.";
  const closing  = pool ? `감사합니다.\n${pool}` : "감사합니다.";

  return [
    header,
    "",
    greeting,
    subject,
    "",
    "아래에서 앱을 설치한 뒤 학부모 회원가입을 진행해주세요.",
    "",
    "아이폰(App Store)",
    IOS_STORE_URL,
    "",
    "안드로이드(Google Play)",
    ANDROID_STORE_URL,
    "",
    closing,
  ].join("\n");
}

/**
 * 학부모 초대 SMS 앱 실행
 * 수신자 + 완성된 초대 본문을 함께 전달.
 * 사용자는 전송 버튼만 누르면 됨.
 */
export function sendParentInviteSms(
  phone:       string | null | undefined,
  poolName:    string | null | undefined,
  studentName: string | null | undefined,
) {
  if (!isValidPhone(phone)) return;
  const body = buildParentInviteSmsBody(poolName, studentName);
  sendSmsWithBody(phone, body);
}

/** 전화번호 포맷: 01012345678 → 010-1234-5678 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[^0-9]/g, "");
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return phone;
}
