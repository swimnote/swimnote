/**
 * store/operatorEventLogStore.ts
 * 수영장 단위 이벤트 로그 (append-only)
 * 관리자 모드에서 생성 → 슈퍼관리자 operator-detail 로그 탭에서 조회
 */
import { create } from 'zustand'

export type OperatorEventType =
  | 'member_register' | 'member_update' | 'member_delete'
  | 'parent_approve' | 'parent_reject' | 'parent_join_request' | 'parent_hold'
  | 'class_create' | 'class_delete'
  | 'journal_save' | 'attendance_change'
  | 'invite_send_sms' | 'invite_copy_link'
  | 'photo_upload' | 'video_upload'
  | 'restore_execute' | 'snapshot_create' | 'snapshot_auto'
  | 'billing_event' | 'settings_change' | 'teacher_invite' | 'teacher_approve'

export interface OperatorEventLog {
  id: string
  operatorId: string
  actorRole: 'operator' | 'teacher' | 'system'
  actorId: string
  actorName: string
  eventType: OperatorEventType
  targetType: string
  targetId?: string
  summary: string
  changedFields?: Record<string, any>
  createdAt: string
}

const dAgo = (d: number, h = 0) =>
  new Date(Date.now() - d * 86_400_000 - h * 3_600_000).toISOString()

const SEED: OperatorEventLog[] = [
  {
    id: 'evl-001', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'member_register', targetType: 'student', targetId: 'stu-009',
    summary: '회원 등록: 홍길동 (2014년생)', createdAt: dAgo(1, 2),
  },
  {
    id: 'evl-002', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'parent_approve', targetType: 'parent_request', targetId: 'pjr-001',
    summary: '학부모 승인: 김영희 (민수엄마)', createdAt: dAgo(3, 0),
  },
  {
    id: 'evl-003', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'class_create', targetType: 'class', targetId: 'cls-011',
    summary: '반 개설: 토요 아침 초급반 (09:00~10:00)', createdAt: dAgo(5, 3),
  },
  {
    id: 'evl-004', operatorId: 'op-002', actorRole: 'teacher', actorId: 'u-teach-01',
    actorName: '박선생님', eventType: 'journal_save', targetType: 'journal', targetId: 'jnl-021',
    summary: '일지 저장: 화요반 — 발차기 연습 집중', createdAt: dAgo(2, 5),
  },
  {
    id: 'evl-005', operatorId: 'op-002', actorRole: 'teacher', actorId: 'u-teach-01',
    actorName: '박선생님', eventType: 'attendance_change', targetType: 'attendance',
    summary: '출결 변경: 김민수 결석→보강 처리', createdAt: dAgo(1, 6),
  },
  {
    id: 'evl-006', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'invite_send_sms', targetType: 'invite', targetId: 'inv-003',
    summary: '초대 문자 발송: 박예린 보호자 010-3333-4444', createdAt: dAgo(2, 0),
  },
  {
    id: 'evl-007', operatorId: 'op-002', actorRole: 'system', actorId: 'system',
    actorName: '시스템', eventType: 'snapshot_auto', targetType: 'snapshot',
    summary: '자동 스냅샷 생성 (1시간 주기)', createdAt: dAgo(0, 3),
  },
  {
    id: 'evl-008', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'parent_join_request', targetType: 'parent_request', targetId: 'pjr-003',
    summary: '학부모 가입 요청 수신: 박수진 (예린엄마)', createdAt: dAgo(1, 0),
  },
  {
    id: 'evl-009', operatorId: 'op-002', actorRole: 'teacher', actorId: 'u-teach-01',
    actorName: '박선생님', eventType: 'photo_upload', targetType: 'media',
    summary: '사진 업로드: 화요반 수업 사진 3장', createdAt: dAgo(3, 4),
  },
  {
    id: 'evl-010', operatorId: 'op-002', actorRole: 'operator', actorId: 'u-admin-01',
    actorName: '관리자', eventType: 'settings_change', targetType: 'settings',
    summary: '수영장 설정 변경: 월 수업 단가 수정', createdAt: dAgo(7, 2),
  },
  // op-001 (송파) 로그
  {
    id: 'evl-011', operatorId: 'op-001', actorRole: 'operator', actorId: 'u-admin-02',
    actorName: '원장님', eventType: 'member_register', targetType: 'student', targetId: 'stu-010',
    summary: '회원 등록: 이민준 (2016년생)', createdAt: dAgo(2, 1),
  },
  {
    id: 'evl-012', operatorId: 'op-001', actorRole: 'system', actorId: 'system',
    actorName: '시스템', eventType: 'snapshot_auto', targetType: 'snapshot',
    summary: '자동 스냅샷 생성 (1시간 주기)', createdAt: dAgo(0, 2),
  },
]

interface OperatorEventLogState {
  logs: OperatorEventLog[]
  addLog: (log: Omit<OperatorEventLog, 'id' | 'createdAt'>) => OperatorEventLog
  getOperatorLogs: (operatorId: string, limit?: number) => OperatorEventLog[]
}

export const useOperatorEventLogStore = create<OperatorEventLogState>((set, get) => ({
  logs: SEED,

  addLog(logData) {
    const newLog: OperatorEventLog = {
      ...logData,
      id: `evl-${Date.now()}`,
      createdAt: new Date().toISOString(),
    }
    set(s => ({ logs: [newLog, ...s.logs] }))
    return newLog
  },

  getOperatorLogs(operatorId, limit = 50) {
    return get().logs
      .filter(l => l.operatorId === operatorId)
      .slice(0, limit)
  },
}))
