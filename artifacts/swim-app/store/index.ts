/**
 * store/index.ts — 모든 스토어 re-export
 * 각 스토어는 seed data로 초기화되어 즉시 사용 가능
 */

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

// Legacy type re-exports for backward compat with existing screens
export type { Operator, AuditLog, SubscriptionPlan, SupportTicket, FeatureFlag, BackupSnapshot } from '../domain/types'
