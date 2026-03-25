/**
 * store/admin/index.ts — 풀 관리자 전용 스토어 그룹
 *
 * 이 스토어들은 (admin)/ 화면에서 주로 사용됩니다.
 */

// 운영자·풀 (super와 공유)
export { useOperatorsStore } from '../operatorsStore'
export type { OperatorFilter } from '../operatorsStore'

// 초대·회원 가입
export { useInviteRecordStore } from '../inviteRecordStore'
export type { InviteRecord, InviteTargetType } from '../inviteRecordStore'

// 학부모 가입 승인
export { useParentJoinStore } from '../parentJoinStore'
export type { JoinStatus, MatchStatus, ParentJoinRequest, ParentRelation } from '../parentJoinStore'
export { checkAutoApproval } from '../parentJoinStore'

// 저장공간 (추가 용량)
export { useExtraStorageStore } from '../extraStorageStore'

// 백업·복구 (super와 공유)
export { useBackupStore } from '../backupStore'

// 운영 이벤트 로그 (super와 공유)
export { useOperatorEventLogStore } from '../operatorEventLogStore'

// SMS·크레딧 (super와 공유)
export { useSmsCreditStore, CREDIT_PACKAGES } from '../smsCreditStore'
export { useSmsStore } from '../smsStore'
