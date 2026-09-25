/**
 * archive-phone-hash.ts — Archive 전용 전화번호 해시 유틸리티
 *
 * 원문 전화번호 저장 금지.
 * HMAC-SHA256(ARCHIVE_PHONE_HASH_SECRET, normalized_phone)
 *
 * 목적: 관리자 수동 연결 시 "동일 전화번호 여부" boolean만 제공.
 * API 응답에 hash 값 자체를 노출하지 않음.
 */

import { createHmac } from "crypto";
import { normalizePhone } from "./auto-link-v2.js";

/**
 * Archive 전화번호 해시 생성.
 * ARCHIVE_PHONE_HASH_SECRET 미설정 시 null 반환 (hash 없이 저장).
 */
export function hashArchivePhone(phone: string | null | undefined): string | null {
  const secret = process.env.ARCHIVE_PHONE_HASH_SECRET;
  if (!secret) {
    console.warn("[archive-phone-hash] ARCHIVE_PHONE_HASH_SECRET not set — phone hash skipped");
    return null;
  }
  const normalized = normalizePhone(phone ?? "");
  if (!normalized) return null;
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

/**
 * 현재 학생의 parent_phone과 Archive hash 비교.
 * true = 일치, false = 불일치, null = 확인불가 (hash 없음)
 */
export function matchArchivePhone(
  currentParentPhone: string | null | undefined,
  archivePhoneHash: string | null | undefined,
): boolean | null {
  if (!archivePhoneHash) return null;
  const secret = process.env.ARCHIVE_PHONE_HASH_SECRET;
  if (!secret) return null;
  const currentHash = hashArchivePhone(currentParentPhone);
  if (!currentHash) return null;
  return currentHash === archivePhoneHash;
}
