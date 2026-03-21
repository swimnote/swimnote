/**
 * store/auditLogStore.ts
 * 감사 로그 — seed data로 초기화, 로그 삭제 금지
 */

import { create } from 'zustand'
import type { AuditLog, ImpactLevel } from '../domain/types'
import { SEED_AUDIT_LOGS } from '../seed/auditLogs'

interface AuditLogState {
  logs: AuditLog[]
  loading: boolean
  filterCategory: string
  filterOperatorId: string

  // selectors
  getFiltered: () => AuditLog[]
  getRecent: (n: number) => AuditLog[]
  getCategories: () => string[]

  // mutations
  setFilterCategory: (cat: string) => void
  setFilterOperatorId: (id: string) => void

  // actions — 로그 삭제 기능 절대 없음
  createLog: (params: {
    category: string
    title: string
    operatorId?: string
    operatorName?: string
    actorName: string
    impact: ImpactLevel
    detail: string
    reason?: string
    metadata?: Record<string, unknown>
  }) => AuditLog
}

let idCounter = 100

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: [...SEED_AUDIT_LOGS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ),
  loading: false,
  filterCategory: '',
  filterOperatorId: '',

  getFiltered: () => {
    const { logs, filterCategory, filterOperatorId } = get()
    let list = logs
    if (filterCategory) list = list.filter(l => l.category === filterCategory)
    if (filterOperatorId) list = list.filter(l => l.operatorId === filterOperatorId)
    return list
  },

  getRecent: (n) => get().logs.slice(0, n),

  getCategories: () => {
    const cats = [...new Set(get().logs.map(l => l.category))]
    return cats.sort()
  },

  setFilterCategory: (filterCategory) => set({ filterCategory }),
  setFilterOperatorId: (filterOperatorId) => set({ filterOperatorId }),

  createLog: (params) => {
    const log: AuditLog = {
      id: `log-${Date.now()}-${++idCounter}`,
      category: params.category,
      title: params.title,
      operatorId: params.operatorId ?? '',
      operatorName: params.operatorName ?? '',
      actorName: params.actorName,
      createdAt: new Date().toISOString(),
      impact: params.impact,
      detail: params.detail,
      reason: params.reason ?? '',
      metadata: params.metadata ?? {},
    }
    set(s => ({ logs: [log, ...s.logs] }))
    return log
  },
}))
