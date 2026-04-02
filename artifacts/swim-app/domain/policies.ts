// domain/policies.ts — 플랜/가격/용량 정책 (최종 확정 기준)
// 수정 시 constants/subscriptionPlans.ts 와 API server의 super.ts seed를 함께 수정할 것.

import type { SubscriptionPlan, ExtraStorageProduct } from './types'

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan-free5',
    code: 'free_5',
    tier: 'free',
    plan_id: 'free_5',
    name: '무료',
    memberLimit: 5,
    baseStorageMb: 100,
    displayStorage: '100MB',
    monthlyPrice: 0,
    includesVideo: false,
    isActive: true,
    isArchived: false,
    note: '5명 / 100MB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'plan-starter30',
    code: 'swimnote_30',
    tier: 'starter',
    plan_id: 'swimnote_30',
    name: '스타터',
    memberLimit: 30,
    baseStorageMb: 600,
    displayStorage: '600MB',
    monthlyPrice: 3500,
    includesVideo: false,
    isActive: true,
    isArchived: false,
    note: '30명 / 600MB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'plan-basic50',
    code: 'swimnote_50',
    tier: 'basic',
    plan_id: 'swimnote_50',
    name: '베이직',
    memberLimit: 50,
    baseStorageMb: 1024,
    displayStorage: '1GB',
    monthlyPrice: 6500,
    includesVideo: false,
    isActive: true,
    isArchived: false,
    note: '50명 / 1GB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'plan-standard100',
    code: 'swimnote_100',
    tier: 'standard',
    plan_id: 'swimnote_100',
    name: '스탠다드',
    memberLimit: 100,
    baseStorageMb: 5120,
    displayStorage: '5GB',
    monthlyPrice: 9500,
    includesVideo: false,
    isActive: true,
    isArchived: false,
    note: '100명 / 5GB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'plan-advance300',
    code: 'swimnote_300',
    tier: 'advance',
    plan_id: 'swimnote_300',
    name: '어드밴스',
    memberLimit: 300,
    baseStorageMb: 20480,
    displayStorage: '20GB',
    monthlyPrice: 29000,
    includesVideo: true,
    isActive: true,
    isArchived: false,
    note: '300명 / 20GB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'swimnote_500',
    code: 'swimnote_500',
    tier: 'pro',
    plan_id: 'swimnote_500',
    name: '프로',
    memberLimit: 500,
    baseStorageMb: 40960,
    displayStorage: '40GB',
    monthlyPrice: 59000,
    includesVideo: true,
    isActive: true,
    isArchived: false,
    note: '500명 / 40GB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'plan-max1000',
    code: 'swimnote_1000',
    tier: 'max',
    plan_id: 'swimnote_1000',
    name: '맥스',
    memberLimit: 1000,
    baseStorageMb: 102400,
    displayStorage: '100GB',
    monthlyPrice: 99000,
    includesVideo: true,
    isActive: true,
    isArchived: false,
    note: '1000명 / 100GB',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
]

export const EXTRA_STORAGE_PRODUCTS: ExtraStorageProduct[] = [
  {
    id: 'extra-10gb',
    code: 'extra_storage_10gb',
    name: '추가저장 10GB',
    additionalMb: 10240,
    monthlyPrice: 3000,
    isActive: true,
  },
  {
    id: 'extra-50gb',
    code: 'extra_storage_50gb',
    name: '추가저장 50GB',
    additionalMb: 51200,
    monthlyPrice: 10000,
    isActive: true,
  },
]

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
