// domain/types.ts — 스윔노트 MVP 공통 타입 정의

export type UserRole = 'super_admin' | 'operator' | 'teacher' | 'parent'

export type OperatorType =
  | 'franchise'
  | 'swimming_pool'
  | 'rental_team'
  | 'solo_coach'
  | 'weekend_coach'

export type OperatorStatus =
  | 'pending'
  | 'active'
  | 'rejected'
  | 'restricted'
  | 'readonly'
  | 'suspended'

export type BillingStatus =
  | 'trial'
  | 'active'
  | 'payment_failed'
  | 'grace'
  | 'readonly'
  | 'cancelled'
  | 'auto_delete_scheduled'

export type PaymentStatus = 'success' | 'failed' | 'pending' | 'refunded' | 'disputed'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type SupportRole = 'operator' | 'teacher' | 'parent'

export type SupportType =
  | 'payment'
  | 'chargeback'
  | 'account'
  | 'data_delete'
  | 'upload_error'
  | 'app_bug'
  | 'policy'
  | 'refund'
  | 'dispute'
  | 'login_permission'
  | 'recovery'
  | 'security'
  | 'etc'

export type SupportStatus =
  | 'received'
  | 'in_progress'
  | 'resolved'
  | 'on_hold'
  | 'refund_linked'
  | 'policy_sent'
  | 'need_recheck'
  | 'escalated_to_tech'

export type FeatureFlagScope = 'global' | 'operator'
export type ReadonlyScope = 'platform' | 'operator' | 'feature'
export type BackupBucket = 'operator_snapshot' | 'platform_shadow_backup'
export type BackupScope = 'platform' | 'operator'

export type MediaVisibility = 'class_all' | 'student_only'
export type MediaQuality = 'free_preview' | 'paid_preview'
export type MediaStatus = 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed'

export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'

// ── 삭제 사유 구분 ──────────────────────────────────
export type DeletionReason =
  | 'operator_terminated'   // 운영자 해지 확정
  | 'manual_by_admin'       // 슈퍼관리자 수동 삭제
  | 'policy_violation'      // 정책 위반 (슈관 승인 필요)

// ── SMS / 초대 ────────────────────────────────────────
export type SmsType =
  | 'teacher_invite'
  | 'parent_connect'
  | 'phone_verify'
  | 'policy_reconfirm'
  | 'payment_fail'
  | 'storage_warn'
  | 'deletion_notice'

export type InviteRole = 'operator' | 'teacher' | 'parent'
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled'
export type SmsStatus = 'sent' | 'failed' | 'pending'

export interface SmsTemplate {
  id: string
  type: SmsType
  name: string
  body: string
  isActive: boolean
  updatedAt: string
  updatedBy: string
}

export interface SmsRecord {
  id: string
  type: SmsType
  recipientName: string
  recipientPhone: string
  operatorId: string
  operatorName: string
  status: SmsStatus
  sentAt: string
  sentBy: string
  templateId: string
  message: string
  failReason: string | null
}

export interface InviteRecord {
  id: string
  role: InviteRole
  recipientName: string
  recipientPhone: string
  operatorId: string
  operatorName: string
  status: InviteStatus
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  sentBy: string
  note: string
}

// ── 슈퍼관리자 보안 ───────────────────────────────────
export type SuperAdminRole = 'super_admin' | 'senior_admin' | 'read_only_admin' | 'super_manager'

export interface SuperAdminDevice {
  id: string
  label: string
  os: string
  browser: string
  lastUsedAt: string
  isCurrent: boolean
}

export interface SuperAdminSession {
  id: string
  adminId: string
  ip: string
  device: string
  startedAt: string
  expiresAt: string
  isActive: boolean
}

export interface SuperAdminAccount {
  id: string
  name: string
  email: string
  role: SuperAdminRole
  twoFactorEnabled: boolean
  lastLoginAt: string | null
  lastLoginIp: string | null
  loginFailCount: number
  lockedUntil: string | null
  isActive: boolean
  createdAt: string
  devices: SuperAdminDevice[]
  sessions: SuperAdminSession[]
}

// ── 핵심 도메인 ──────────────────────────────────────
export interface Operator {
  id: string
  code: string
  name: string
  type: OperatorType
  representativeName: string
  phone: string
  email: string
  address: string
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null

  status: OperatorStatus
  isApproved: boolean
  isReadOnly: boolean
  isUploadBlocked: boolean
  isDeletionDeferred: boolean

  normalMemberCount: number
  pausedMemberCount: number
  withdrawnMemberCount: number
  activeMemberCount: number

  currentPlanId: string
  currentPlanName: string
  billingStatus: BillingStatus
  nextBillingAt: string | null
  lastPaymentAt: string | null
  lastPaymentStatus: PaymentStatus
  paymentFailCount: number
  creditBalance: number
  hasChargeback: boolean
  hasRefundDispute: boolean
  refundRepeatFlag: boolean
  churnRepeatFlag: boolean

  storageUsedMb: number
  storageTotalMb: number
  storageWarning80: boolean
  storageBlocked95: boolean
  uploadGrowth7dMb: number
  uploadSpikeFlag: boolean
  autoDeleteScheduledAt: string | null

  // 해지/삭제 관련 (선택적 — 기존 시드 호환)
  isTerminationConfirmed?: boolean
  terminationConfirmedAt?: string | null
  deletionReason?: DeletionReason | null
  terminationPolicyAgreed?: boolean
  terminationNoticeSent?: boolean

  // 저장공간 긴급 override
  storageOverrideUntil?: string | null
  storageOverrideBy?: string | null

  policyRefundRead: boolean
  policyPrivacyRead: boolean
  policyTermsAgreed: boolean
  policyLastConfirmedAt: string | null
  policyVersionRefund: string | null
  policyVersionPrivacy: string | null
  policyVersionTerms: string | null

  riskLevel: RiskLevel
  riskFlags: string[]
  authorityStructure: string
  memo: string
}

export interface SubscriptionPlan {
  id: string
  code: string
  tier: string
  plan_id: string
  name: string
  memberLimit: number | null
  baseStorageMb: number
  displayStorage: string
  monthlyPrice: number
  includesVideo: boolean
  isActive: boolean
  isArchived: boolean
  note: string
  createdAt: string
  updatedAt: string
}


export interface AuditLog {
  id: string
  category: string
  title: string
  operatorId: string
  operatorName: string
  actorName: string
  createdAt: string
  impact: ImpactLevel
  detail: string
  reason: string
  metadata: Record<string, unknown>
}

export interface SupportTicket {
  id: string
  requesterName: string
  requesterRole: SupportRole
  operatorId: string
  operatorName: string
  type: SupportType
  status: SupportStatus
  createdAt: string
  lastAnsweredAt: string | null
  slaDueAt: string | null
  isSlaOverdue: boolean
  riskLevel: RiskLevel
  title: string
  body: string
  assigneeName: string
  repeatedIssueFlag: boolean
  internalMemo: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string
  scope: FeatureFlagScope
  operatorId: string
  enabled: boolean
  updatedAt: string
  updatedBy: string
  reason: string
  lastEnabledState?: boolean  // 롤백용 이전 상태
}

export interface ReadonlyControl {
  id: string
  scope: ReadonlyScope
  operatorId: string
  operatorName: string
  targetFeature: string
  level: 'active' | 'warning' | 'emergency'
  enabled: boolean
  reason: string
  createdAt: string
  createdBy: string
}

export type SnapshotType = 'auto' | 'manual' | 'before_restore' | 'before_delete'

export interface BackupSnapshot {
  id: string
  bucket: BackupBucket
  scope: BackupScope
  operatorId: string
  operatorName: string
  snapshotName?: string
  snapshotType?: SnapshotType
  createdAt: string
  createdBy: string
  includes: string[]
  checksum: string
  note: string
  sizeMb: number
  status: 'pending' | 'running' | 'done' | 'failed'
}

export interface RestoreJob {
  id: string
  snapshotId: string
  operatorId: string
  operatorName: string
  createdAt: string
  createdBy: string
  status: 'pending' | 'running' | 'done' | 'failed'
  mode: 'single' | 'dual_compare'
  note: string
}

export interface MediaAsset {
  id: string
  operatorId: string
  journalId: string | null
  classId: string | null
  studentId: string | null
  visibility: MediaVisibility
  status: MediaStatus

  originalInputSizeMb: number
  previewFreeSizeMb: number
  previewPaidSizeMb: number

  originalKey: string | null
  previewFreeKey: string | null
  previewPaidKey: string | null

  sourceLabel: string
  createdAt: string
}

export interface StoragePolicy {
  id: string
  operatorId: string
  operatorName: string
  planStorageMb: number
  extraStorageMb: number
  totalMb: number
  usedMb: number
  usedPercent: number
  isBlocked95: boolean
  isWarning80: boolean
  uploadSpikeFlag: boolean
  uploadGrowth7dMb: number
  autoDeleteScheduledAt: string | null
  storageOverrideUntil?: string | null
}

export interface PolicyDocument {
  id: string
  type: 'refund' | 'privacy' | 'terms'
  version: string
  title: string
  body: string
  publishedAt: string
  updatedAt: string
  updatedBy: string
}

export interface RiskSummary {
  paymentRisk: number
  storageRisk: number
  deletionPending: number
  policyUnsigned: number
  slaOverdue: number
  securityEvents: number
  featureErrors: number
  externalServices: number
  backupWarnings: number
  abuseDetected: number
}
