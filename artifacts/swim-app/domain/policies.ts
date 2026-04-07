// domain/policies.ts — 정책 상수 (구독 플랜은 DB subscription_plans 테이블이 단일 기준값)
// SUBSCRIPTION_PLANS / EXTRA_STORAGE_PRODUCTS 제거됨 — DB 조회 기준으로 통일

// 사진 처리 정책
export const PHOTO_POLICY = {
  freePreviewQuality: 0.4,    // 저화질 40%
  paidPreviewQuality: 1.0,    // 선명 100%
  freePreviewSizeRatio: 0.25, // 무료: 원본의 25% 크기
  paidPreviewSizeRatio: 0.8,  // 유료: 원본의 80% 크기
}

// 해지/제한 정책
export const CANCELLATION_POLICY = {
  autoDeleteAfterHours: 24,
  textsPreservedAfterDelete: true,
  uploadBlockedOnCancel: true,
  downloadLimitedOnCancel: true,
}

// 저장공간 경고 임계값
export const STORAGE_THRESHOLDS = {
  warning80: 80,
  blocked95: 95,
  spikeThresholdMbPerWeek: 500,
}

// SLA 기준 (시간)
export const SLA_HOURS: Record<string, number> = {
  payment: 4,
  refund: 8,
  dispute: 24,
  account: 12,
  data_delete: 24,
  upload_error: 8,
  app_bug: 24,
  policy: 48,
  login_permission: 4,
  recovery: 4,   // 긴급: 복구 문의는 4시간 SLA
  security: 2,   // 최긴급: 보안 문의는 2시간 SLA
  etc: 72,
}

// 환불 정책 본문
export const REFUND_POLICY_BODY = `구독 변경은 즉시 적용됩니다.
상위 플랜 변경 시 남은 기간 기준 차액이 즉시 결제됩니다.
하위 플랜 변경 시 남은 기간 기준 차액은 환불되지 않고, 다음 결제 시 차감되는 크레딧으로 적립됩니다.
구독 해지 시 유료 기능은 즉시 제한되며, 서비스는 읽기전용 상태로 전환됩니다.
구독 해지 후 24시간이 경과하면 저장된 사진 및 영상 데이터는 자동 삭제되며 복구되지 않습니다.
이미 결제된 이용요금은 원칙적으로 환불되지 않습니다.
단, 다음 결제가 발생하지 않는 상태에서 남아 있는 크레딧은 환불될 수 있습니다.
사용자는 구독 해지 전 데이터 삭제 정책을 충분히 확인해야 하며, 삭제된 데이터는 복구되지 않습니다.`
