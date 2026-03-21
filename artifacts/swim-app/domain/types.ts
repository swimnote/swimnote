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
  | 'account'
  | 'data_delete'
  | 'upload_error'
  | 'app_bug'
  | 'policy'
  | 'refund'
  | 'dispute'
  | 'login_permission'
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
  code: 'free_10' | 'pro_100' | 'pro_300' | 'pro_500' | 'pro_1000' | 'enterprise'
  name: string
  memberLimit: number | null
  baseStorageMb: number
  monthlyPrice: number
  includesVideo: boolean
  isActive: boolean
  isArchived: boolean
  note: string
  createdAt: string
  updatedAt: string
}

export interface ExtraStorageProduct {
  id: string
  code: string
  name: string
  additionalMb: number
  monthlyPrice: number
  isActive: boolean
}

export interface BillingRecord {
  id: string
  operatorId: string
  operatorName: string
  planId: string
  planName: string
  amount: number
  status: PaymentStatus
  billingStatus: BillingStatus
  billedAt: string
  nextBillingAt: string | null
  failReason: string | null
  creditUsed: number
  memo: string
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

export interface BackupSnapshot {
  id: string
  bucket: BackupBucket
  scope: BackupScope
  operatorId: string
  operatorName: string
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
