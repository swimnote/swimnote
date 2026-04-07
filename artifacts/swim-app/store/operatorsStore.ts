/**
 * store/operatorsStore.ts
 * 운영자 상태 관리 — API 연동 (DB 실데이터 기준)
 */

import { create } from 'zustand'
import type { Operator, OperatorStatus, BillingStatus } from '../domain/types'

/** API 응답 → Operator 도메인 타입 변환 */
function mapApiOperator(raw: any): Operator {
  const approvalToStatus = (s: string): OperatorStatus => {
    if (s === 'approved') return 'active';
    if (s === 'rejected') return 'rejected';
    return 'pending';
  };
  const subToBilling = (s: string | null): BillingStatus => {
    if (!s) return 'trial';
    if (s === 'trial') return 'trial';
    if (s === 'active') return 'active';
    if (s === 'expired' || s === 'suspended') return 'payment_failed';
    if (s === 'cancelled') return 'cancelled';
    return 'trial';
  };
  const totalStorageMb = (raw.total_storage_gb ?? 0) * 1024;
  const usedStorageMb  = raw.used_storage_bytes ? Math.round(raw.used_storage_bytes / 1048576) : 0;
  const usagePct       = raw.usage_pct ?? 0;
  return {
    id:                   raw.id,
    code:                 raw.id.slice(0, 10).toUpperCase(),
    name:                 raw.name ?? '',
    type:                 raw.pool_type ?? 'swimming_pool',
    representativeName:   raw.owner_name ?? '',
    phone:                raw.phone ?? '',
    email:                raw.email ?? '',
    address:              raw.address ?? '',
    createdAt:            raw.created_at ?? new Date().toISOString(),
    updatedAt:            raw.updated_at ?? new Date().toISOString(),
    lastLoginAt:          raw.last_login_at ?? null,
    status:               approvalToStatus(raw.approval_status ?? 'pending'),
    isApproved:           raw.approval_status === 'approved',
    isReadOnly:           raw.is_readonly ?? false,
    isUploadBlocked:      raw.upload_blocked ?? false,
    isDeletionDeferred:   false,
    normalMemberCount:    raw.active_member_count ?? 0,
    pausedMemberCount:    0,
    withdrawnMemberCount: 0,
    activeMemberCount:    raw.active_member_count ?? 0,
    currentPlanId:        raw.subscription_tier ?? 'free',
    currentPlanName:      raw.subscription_tier ?? '무료',
    billingStatus:        subToBilling(raw.subscription_status),
    nextBillingAt:        raw.next_billing_at ?? null,
    lastPaymentAt:        null,
    lastPaymentStatus:    'pending',
    paymentFailCount:     0,
    creditBalance:        raw.credit_balance ?? 0,
    hasChargeback:        false,
    hasRefundDispute:     false,
    refundRepeatFlag:     false,
    churnRepeatFlag:      false,
    storageUsedMb:        usedStorageMb,
    storageTotalMb:       totalStorageMb,
    storageWarning80:     usagePct >= 80,
    storageBlocked95:     usagePct >= 95,
    uploadGrowth7dMb:     0,
    uploadSpikeFlag:      raw.upload_blocked ?? false,
    autoDeleteScheduledAt: raw.deletion_pending ? new Date(Date.now() + 86400000).toISOString() : null,
    policyRefundRead:     true,
    policyPrivacyRead:    true,
    policyTermsAgreed:    true,
    policyLastConfirmedAt: null,
    policyVersionRefund:  null,
    policyVersionPrivacy: null,
    policyVersionTerms:   null,
    riskLevel:            'low',
    riskFlags:            [],
    authorityStructure:   'single',
    memo:                 '',
  };
}

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
  fetchOperators: (token: string, apiBase: string) => Promise<void>
  setOperators: (operators: Operator[]) => void
}

export const useOperatorsStore = create<OperatorsState>((set, get) => ({
  operators: [],
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
      case 'free_over10':  list = list.filter(o => o.currentPlanId === 'free_5' && o.activeMemberCount >= 5); break
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

  setOperators: (operators) => set({ operators }),

  fetchOperators: async (token, apiBase) => {
    set({ loading: true });
    try {
      const res = await fetch(`${apiBase}/super/operators`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows: any[] = await res.json();
      // 빈 배열 덮어쓰기 방지: 기존 데이터가 있고 응답이 빈 배열이면 유지
      const prev = get().operators;
      if (rows.length === 0 && prev.length > 0) {
        console.warn('[operatorsStore] 빈 배열 응답 — 기존 데이터 유지');
        return;
      }
      set({ operators: rows.map(mapApiOperator) });
    } catch (e) {
      console.error('[operatorsStore] fetchOperators 오류:', e);
      // 에러 시 기존 operators 유지 (덮어쓰기 안 함)
    } finally {
      set({ loading: false });
    }
  },
}))
