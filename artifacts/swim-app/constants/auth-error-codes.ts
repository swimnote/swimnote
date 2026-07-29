/**
 * SWIMNOTE 공통 권한 오류 코드 (앱)
 * 서버 응답 code 필드와 동일한 값 사용
 */
export const AuthErrorCodes = {
  ROLE_REVOKED:      "ROLE_REVOKED",
  ROLE_DISABLED:     "ROLE_DISABLED",
  ROLE_NOT_ALLOWED:  "ROLE_NOT_ALLOWED",
  CENTER_DISABLED:   "CENTER_DISABLED",
  LICENSE_EXPIRED:   "LICENSE_EXPIRED",
  ROLE_CHECK_FAILED: "ROLE_CHECK_FAILED",
} as const;

export type AuthErrorCode = typeof AuthErrorCodes[keyof typeof AuthErrorCodes];
