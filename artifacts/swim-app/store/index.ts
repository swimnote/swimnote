/**
 * store/index.ts — 전체 스토어 re-export
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  역할별 전용 스토어는 하위 폴더를 사용하세요:                      │
 * │   store/super/   — 슈퍼관리자 전용 스토어                        │
 * │   store/admin/   — 풀 관리자 전용 스토어                         │
 * │   store/shared/  — 역할 간 공유 스토어                           │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 아래는 기존 import 경로 호환을 위한 re-export입니다.
 * 새 코드는 각 역할별 폴더를 직접 import하세요.
 */

// ── 슈퍼관리자 전용 ─────────────────────────────────────────────────
export { useOperatorsStore } from './operatorsStore'
export type { OperatorFilter } from './operatorsStore'

export { useSubscriptionStore } from './subscriptionStore'

export { useStorageStore } from './storageStore'

export { useAuditLogStore } from './auditLogStore'

export { useSupportStore } from './supportStore'

export { useRiskStore } from './riskStore'
export type { RiskCategory } from './riskStore'

export { useFeatureFlagStore } from './featureFlagStore'

export { useReadonlyStore } from './readonlyStore'

export { useMediaStore } from './mediaStore'

export { useBackupStore } from './backupStore'

export { useSecurityStore } from './securityStore'

export { useSmsCreditStore } from './smsCreditStore'

export { useSmsStore } from './smsStore'

export { useAdsStore } from './adsStore'
export type { Ad, AdStatus } from './adsStore'

export { useExtraStorageStore } from './extraStorageStore'
export type { ExtraStorageProduct } from './extraStorageStore'

export { useOperatorEventLogStore } from './operatorEventLogStore'

// ── 관리자 전용 ──────────────────────────────────────────────────────
export { useInviteRecordStore } from './inviteRecordStore'
export type { InviteRecord, InviteTargetType } from './inviteRecordStore'

export { useParentJoinStore, checkAutoApproval } from './parentJoinStore'
export type { JoinStatus, MatchStatus, ParentJoinRequest, ParentRelation } from './parentJoinStore'

// ── 공유 (전 역할) ───────────────────────────────────────────────────
export { useNoticeStore, NOTICE_TYPE_CFG } from './noticeStore'
export type { Notice, NoticeTarget, NoticeType } from './noticeStore'

// Legacy type re-exports for backward compat
export type { Operator, AuditLog, SubscriptionPlan, SupportTicket, FeatureFlag, BackupSnapshot } from '../domain/types'
