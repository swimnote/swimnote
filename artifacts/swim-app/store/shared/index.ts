/**
 * store/shared/index.ts — 역할 간 공유 스토어
 *
 * admin, super, common 컴포넌트 모두에서 사용 가능한 스토어.
 */

// 공지 (슈퍼 발행 → 전 역할 노출)
export { useNoticeStore, NOTICE_TYPE_CFG } from '../noticeStore'
export type { Notice, NoticeTarget, NoticeType } from '../noticeStore'

// 운영자 목록 (auth onboarding, admin, super 모두 사용)
export { useOperatorsStore } from '../operatorsStore'
export type { OperatorFilter } from '../operatorsStore'

// 학부모 가입 (auth onboarding, admin 사용)
export { useParentJoinStore, checkAutoApproval } from '../parentJoinStore'
export type { JoinStatus, MatchStatus, ParentJoinRequest, ParentRelation } from '../parentJoinStore'
