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
  | 'restore_execute' | 'snapshot_create' | 'snapshot_auto' | 'snapshot_delete'
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

const SEED: OperatorEventLog[] = []

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
      id: `evl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      // 안전한 기본값 — undefined/null 방지
      actorName:  logData.actorName  || '시스템',
      actorId:    logData.actorId    || 'system',
      actorRole:  logData.actorRole  || 'system',
      targetType: logData.targetType || 'unknown',
      summary:    logData.summary    || `${logData.eventType} 이벤트`,
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
