/**
 * store/supportStore.ts
 * 고객센터 티켓 상태 관리
 */

import { create } from 'zustand'
import type { SupportTicket, SupportStatus, RiskLevel } from '../domain/types'
import { SEED_SUPPORT_TICKETS } from '../seed/supportTickets'
import { SLA_HOURS } from '../domain/policies'

interface SupportState {
  tickets: SupportTicket[]
  loading: boolean
  activeTab: string
  filterType: string

  // selectors
  getFiltered: () => SupportTicket[]
  getSlaOverdueTickets: () => SupportTicket[]
  getOpenCount: () => number
  getSlaOverdueCount: () => number

  // mutations
  setActiveTab: (tab: string) => void
  setFilterType: (type: string) => void

  // actions
  createTicket: (params: Omit<SupportTicket, 'id' | 'createdAt' | 'lastAnsweredAt' | 'slaDueAt' | 'isSlaOverdue'>) => SupportTicket
  updateTicketStatus: (id: string, status: SupportStatus) => void
  assignTicket: (id: string, assigneeName: string) => void
  addInternalMemo: (id: string, memo: string) => void
  markEscalated: (id: string) => void
  markResolved: (id: string) => void
}

let idCounter = 100

function calcSlaDue(createdAt: string, type: string) {
  const hours = SLA_HOURS[type] ?? 72
  return new Date(new Date(createdAt).getTime() + hours * 3600000).toISOString()
}
function isOverdue(slaDueAt: string | null, status: string) {
  if (!slaDueAt || status === 'resolved') return false
  return new Date(slaDueAt).getTime() < Date.now()
}

export const useSupportStore = create<SupportState>((set, get) => ({
  tickets: SEED_SUPPORT_TICKETS,
  loading: false,
  activeTab: 'open',
  filterType: '',

  getFiltered: () => {
    const { tickets, activeTab, filterType } = get()
    let list = tickets
    if (activeTab === 'open') {
      list = list.filter(t => t.status !== 'resolved')
    } else if (activeTab === 'resolved') {
      list = list.filter(t => t.status === 'resolved')
    } else if (activeTab === 'sla') {
      list = list.filter(t => t.isSlaOverdue)
    } else if (activeTab === 'critical') {
      // 긴급: 위험등급 critical/high 또는 복구·보안 유형은 항상 포함
      list = list.filter(t =>
        t.riskLevel === 'critical' || t.riskLevel === 'high' ||
        t.type === 'recovery' || t.type === 'security'
      )
    }
    if (filterType) list = list.filter(t => t.type === filterType)
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  },

  getSlaOverdueTickets: () =>
    get().tickets.filter(t => t.isSlaOverdue),

  getOpenCount: () =>
    get().tickets.filter(t => t.status !== 'resolved').length,

  getSlaOverdueCount: () =>
    get().tickets.filter(t => t.isSlaOverdue).length,

  setActiveTab: (activeTab) => set({ activeTab }),
  setFilterType: (filterType) => set({ filterType }),

  createTicket: (params) => {
    const createdAt = new Date().toISOString()
    const slaDueAt = calcSlaDue(createdAt, params.type)
    const ticket: SupportTicket = {
      ...params,
      id: `tkt-${Date.now()}-${++idCounter}`,
      createdAt,
      lastAnsweredAt: null,
      slaDueAt,
      isSlaOverdue: false,
    }
    set(s => ({ tickets: [ticket, ...s.tickets] }))
    return ticket
  },

  updateTicketStatus: (id, status) => {
    set(s => ({
      tickets: s.tickets.map(t => {
        if (t.id !== id) return t
        const updated = { ...t, status, lastAnsweredAt: new Date().toISOString() }
        updated.isSlaOverdue = isOverdue(t.slaDueAt, status)
        return updated
      }),
    }))
  },

  assignTicket: (id, assigneeName) => set(s => ({
    tickets: s.tickets.map(t =>
      t.id === id ? { ...t, assigneeName, lastAnsweredAt: new Date().toISOString() } : t
    ),
  })),

  addInternalMemo: (id, memo) => set(s => ({
    tickets: s.tickets.map(t =>
      t.id === id ? { ...t, internalMemo: memo } : t
    ),
  })),

  markEscalated: (id) => {
    get().updateTicketStatus(id, 'escalated_to_tech')
  },

  markResolved: (id) => {
    get().updateTicketStatus(id, 'resolved')
  },
}))
