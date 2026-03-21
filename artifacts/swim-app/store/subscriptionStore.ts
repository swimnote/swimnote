/**
 * store/subscriptionStore.ts
 * 구독·결제 상태 관리
 */

import { create } from 'zustand'
import type { SubscriptionPlan, BillingRecord, ExtraStorageProduct } from '../domain/types'
import { SUBSCRIPTION_PLANS, EXTRA_STORAGE_PRODUCTS } from '../domain/policies'
import { SEED_BILLING_RECORDS } from '../seed/subscriptions'

interface SubscriptionState {
  plans: SubscriptionPlan[]
  extraProducts: ExtraStorageProduct[]
  billingRecords: BillingRecord[]
  loading: boolean

  // selectors
  getPlanById: (id: string) => SubscriptionPlan | undefined
  getBillingIssueQueue: () => BillingRecord[]
  getActivePlanCount: () => number

  // plan CRUD
  addPlan: (plan: SubscriptionPlan) => void
  updatePlan: (id: string, patch: Partial<SubscriptionPlan>) => void
  archivePlan: (id: string) => void

  // billing actions
  setBillingRecord: (record: BillingRecord) => void
  updateBillingRecord: (id: string, patch: Partial<BillingRecord>) => void
  retryBilling: (operatorId: string) => void
  applyGrace: (operatorId: string) => void
  cancelSubscription: (operatorId: string, reason: string) => void
  applyCredit: (operatorId: string, amount: number) => void
  setReadonlyScheduled: (operatorId: string) => void
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  plans: SUBSCRIPTION_PLANS,
  extraProducts: EXTRA_STORAGE_PRODUCTS,
  billingRecords: SEED_BILLING_RECORDS,
  loading: false,

  getPlanById: (id) => get().plans.find(p => p.id === id),

  getBillingIssueQueue: () =>
    get().billingRecords.filter(r =>
      r.status === 'failed' || r.status === 'disputed' ||
      r.billingStatus === 'grace' || r.billingStatus === 'auto_delete_scheduled'
    ),

  getActivePlanCount: () => get().plans.filter(p => p.isActive && !p.isArchived).length,

  addPlan: (plan) => set(s => ({ plans: [plan, ...s.plans] })),

  updatePlan: (id, patch) => set(s => ({
    plans: s.plans.map(p => p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p),
  })),

  archivePlan: (id) => set(s => ({
    plans: s.plans.map(p => p.id === id ? { ...p, isArchived: true, isActive: false } : p),
  })),

  setBillingRecord: (record) => set(s => ({
    billingRecords: [record, ...s.billingRecords.filter(r => r.id !== record.id)],
  })),

  updateBillingRecord: (id, patch) => set(s => ({
    billingRecords: s.billingRecords.map(r => r.id === id ? { ...r, ...patch } : r),
  })),

  retryBilling: (operatorId) => set(s => ({
    billingRecords: s.billingRecords.map(r =>
      r.operatorId === operatorId
        ? { ...r, status: 'pending', billingStatus: 'active', failReason: null }
        : r
    ),
  })),

  applyGrace: (operatorId) => set(s => ({
    billingRecords: s.billingRecords.map(r =>
      r.operatorId === operatorId
        ? { ...r, billingStatus: 'grace' }
        : r
    ),
  })),

  cancelSubscription: (operatorId, _reason) => set(s => ({
    billingRecords: s.billingRecords.map(r =>
      r.operatorId === operatorId
        ? { ...r, billingStatus: 'cancelled', nextBillingAt: null }
        : r
    ),
  })),

  applyCredit: (operatorId, amount) => set(s => ({
    billingRecords: s.billingRecords.map(r =>
      r.operatorId === operatorId ? { ...r, creditUsed: r.creditUsed + amount } : r
    ),
  })),

  setReadonlyScheduled: (operatorId) => set(s => ({
    billingRecords: s.billingRecords.map(r =>
      r.operatorId === operatorId
        ? { ...r, billingStatus: 'readonly', nextBillingAt: null }
        : r
    ),
  })),
}))
