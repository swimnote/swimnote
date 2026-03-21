/**
 * store/operatorsStore.ts
 * 운영자 상태 관리 — seed data로 초기화, 모든 액션 상태 반영
 */

import { create } from 'zustand'
import type { Operator, OperatorStatus, BillingStatus } from '../domain/types'
import { SEED_OPERATORS } from '../seed/operators'

export type OperatorFilter =
  | 'all' | 'pending' | 'payment_failed' | 'storage95' | 'deletion_pending'
  | 'credit' | 'free_over10' | 'new_this_week' | 'solo_coach' | 'franchise'
  | 'refund_repeat' | 'upload_spike' | 'policy_unsigned' | 'readonly' | 'restricted'

interface OperatorsState {
  operators: Operator[]
  loading: boolean
  filter: OperatorFilter
  search: string
  sort: string
  selectedIds: string[]

  // selectors
  getFiltered: () => Operator[]
  getById: (id: string) => Operator | undefined
  getPendingCount: () => number
  getPaymentFailCount: () => number
  getStorage95Count: () => number
  getDeletionPendingCount: () => number

  // mutations
  setFilter: (f: OperatorFilter) => void
  setSearch: (s: string) => void
  setSort: (s: string) => void
  toggleSelected: (id: string) => void
  selectAll: () => void
  clearSelected: () => void
  updateOperator: (id: string, patch: Partial<Operator>) => void

  // actions
  approveOperator: (id: string, actorName: string) => void
  rejectOperator: (id: string, reason: string, actorName: string) => void
  setOperatorReadonly: (id: string, reason: string, actorName: string) => void
  clearOperatorReadonly: (id: string, actorName: string) => void
  setOperatorUploadBlocked: (id: string, blocked: boolean) => void
  updateOperatorPlan: (id: string, planId: string, planName: string, storageMb: number) => void
  updateOperatorStorage: (id: string, extraMb: number) => void
  scheduleAutoDelete: (id: string, scheduledAt: string) => void
  clearAutoDelete: (id: string) => void
  applyCredit: (id: string, amount: number) => void
  applyGrace: (id: string) => void
  setRestricted: (id: string, reason: string) => void
}

const daysLater = (d: number) => new Date(Date.now() + d * 86400000).toISOString()

export const useOperatorsStore = create<OperatorsState>((set, get) => ({
  operators: SEED_OPERATORS,
  loading: false,
  filter: 'all',
  search: '',
  sort: 'createdAt',
  selectedIds: [],

  getFiltered: () => {
    const { operators, filter, search } = get()
    let list = operators

    switch (filter) {
      case 'pending':      list = list.filter(o => o.status === 'pending'); break
      case 'payment_failed': list = list.filter(o => o.billingStatus === 'payment_failed' || o.billingStatus === 'grace'); break
      case 'storage95':    list = list.filter(o => o.storageBlocked95); break
      case 'deletion_pending': list = list.filter(o => !!o.autoDeleteScheduledAt); break
      case 'credit':       list = list.filter(o => o.creditBalance > 0); break
      case 'free_over10':  list = list.filter(o => o.currentPlanId === 'plan-free10' && o.activeMemberCount >= 10); break
      case 'new_this_week':list = list.filter(o => new Date(o.createdAt).getTime() > Date.now() - 7 * 86400000); break
      case 'solo_coach':   list = list.filter(o => o.type === 'solo_coach'); break
      case 'franchise':    list = list.filter(o => o.type === 'franchise'); break
      case 'refund_repeat':list = list.filter(o => o.refundRepeatFlag); break
      case 'upload_spike': list = list.filter(o => o.uploadSpikeFlag); break
      case 'policy_unsigned': list = list.filter(o => !o.policyRefundRead || !o.policyPrivacyRead); break
      case 'readonly':     list = list.filter(o => o.isReadOnly); break
      case 'restricted':   list = list.filter(o => o.status === 'restricted'); break
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        o.name.toLowerCase().includes(q) ||
        o.representativeName.toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q)
      )
    }
    return list
  },

  getById: (id) => get().operators.find(o => o.id === id),

  getPendingCount: () => get().operators.filter(o => o.status === 'pending').length,
  getPaymentFailCount: () => get().operators.filter(o =>
    o.billingStatus === 'payment_failed' || o.billingStatus === 'grace'
  ).length,
  getStorage95Count: () => get().operators.filter(o => o.storageBlocked95).length,
  getDeletionPendingCount: () => get().operators.filter(o => !!o.autoDeleteScheduledAt).length,

  setFilter:   (filter)  => set({ filter }),
  setSearch:   (search)  => set({ search }),
  setSort:     (sort)    => set({ sort }),

  toggleSelected: (id) => set(s => ({
    selectedIds: s.selectedIds.includes(id)
      ? s.selectedIds.filter(x => x !== id)
      : [...s.selectedIds, id],
  })),
  selectAll: () => set(s => ({ selectedIds: s.getFiltered().map(o => o.id) })),
  clearSelected: () => set({ selectedIds: [] }),

  updateOperator: (id, patch) => set(s => ({
    operators: s.operators.map(o => o.id === id ? { ...o, ...patch } : o),
  })),

  approveOperator: (id, _actorName) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, status: 'active' as OperatorStatus, isApproved: true } : o
      ),
    }))
  },

  rejectOperator: (id, _reason, _actorName) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, status: 'rejected' as OperatorStatus, isApproved: false } : o
      ),
    }))
  },

  setOperatorReadonly: (id, _reason, _actorName) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id
          ? { ...o, status: 'readonly' as OperatorStatus, isReadOnly: true, isUploadBlocked: true }
          : o
      ),
    }))
  },

  clearOperatorReadonly: (id, _actorName) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, status: 'active' as OperatorStatus, isReadOnly: false } : o
      ),
    }))
  },

  setOperatorUploadBlocked: (id, blocked) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, isUploadBlocked: blocked } : o
      ),
    }))
  },

  updateOperatorPlan: (id, planId, planName, storageMb) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id
          ? { ...o, currentPlanId: planId, currentPlanName: planName, storageTotalMb: storageMb }
          : o
      ),
    }))
  },

  updateOperatorStorage: (id, extraMb) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id
          ? {
              ...o,
              storageTotalMb: o.storageTotalMb + extraMb,
              storageWarning80: (o.storageUsedMb / (o.storageTotalMb + extraMb)) >= 0.80,
              storageBlocked95: (o.storageUsedMb / (o.storageTotalMb + extraMb)) >= 0.95,
            }
          : o
      ),
    }))
  },

  scheduleAutoDelete: (id, scheduledAt) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id
          ? {
              ...o,
              autoDeleteScheduledAt: scheduledAt,
              billingStatus: 'auto_delete_scheduled' as BillingStatus,
            }
          : o
      ),
    }))
  },

  clearAutoDelete: (id) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, autoDeleteScheduledAt: null } : o
      ),
    }))
  },

  applyCredit: (id, amount) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, creditBalance: o.creditBalance + amount } : o
      ),
    }))
  },

  applyGrace: (id) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, billingStatus: 'grace' as BillingStatus } : o
      ),
    }))
  },

  setRestricted: (id, _reason) => {
    set(s => ({
      operators: s.operators.map(o =>
        o.id === id ? { ...o, status: 'restricted' as OperatorStatus, isUploadBlocked: true } : o
      ),
    }))
  },
}))
