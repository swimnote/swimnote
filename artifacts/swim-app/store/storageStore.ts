/**
 * store/storageStore.ts
 * 저장공간 정책 및 사용량 상태 관리
 */

import { create } from 'zustand'
import type { StoragePolicy } from '../domain/types'
import { SEED_OPERATORS } from '../seed/operators'
import { calcPercent } from '../domain/formatters'

// operators seed에서 storage policy 파생
function buildStoragePolicies(): StoragePolicy[] {
  return SEED_OPERATORS.map(op => ({
    id: `sp-${op.id}`,
    operatorId: op.id,
    operatorName: op.name,
    planStorageMb: op.storageTotalMb,
    extraStorageMb: 0,
    totalMb: op.storageTotalMb,
    usedMb: op.storageUsedMb,
    usedPercent: calcPercent(op.storageUsedMb, op.storageTotalMb),
    isBlocked95: op.storageBlocked95,
    isWarning80: op.storageWarning80,
    uploadSpikeFlag: op.uploadSpikeFlag,
    uploadGrowth7dMb: op.uploadGrowth7dMb,
    autoDeleteScheduledAt: op.autoDeleteScheduledAt,
  }))
}

interface StorageState {
  policies: StoragePolicy[]
  storageTab: string

  // selectors
  getBlocked95: () => StoragePolicy[]
  getWarning80: () => StoragePolicy[]
  getUploadSpike: () => StoragePolicy[]
  getDeletionPending: () => StoragePolicy[]
  getByTab: () => StoragePolicy[]
  getByOperatorId: (id: string) => StoragePolicy | undefined

  // mutations
  setStorageTab: (tab: string) => void
  updatePolicy: (operatorId: string, patch: Partial<StoragePolicy>) => void

  // actions
  setStoragePolicy: (operatorId: string, params: { extraMb: number }) => void
  updateUsage: (operatorId: string, usedMb: number) => void
  mark95Blocked: (operatorId: string, blocked: boolean) => void
  mark80Warning: (operatorId: string, warning: boolean) => void
  detectUploadSpike: (operatorId: string, growth7dMb: number) => void
  getStorageRiskQueue: () => StoragePolicy[]
}

export const useStorageStore = create<StorageState>((set, get) => ({
  policies: buildStoragePolicies(),
  storageTab: 'all',

  getBlocked95: () => get().policies.filter(p => p.isBlocked95),
  getWarning80: () => get().policies.filter(p => p.isWarning80 && !p.isBlocked95),
  getUploadSpike: () => get().policies.filter(p => p.uploadSpikeFlag),
  getDeletionPending: () => get().policies.filter(p => !!p.autoDeleteScheduledAt),

  getByTab: () => {
    const { policies, storageTab } = get()
    switch (storageTab) {
      case 'blocked95': return get().getBlocked95()
      case 'warning80': return get().getWarning80()
      case 'spike':     return get().getUploadSpike()
      case 'deletion':  return get().getDeletionPending()
      default:          return policies
    }
  },

  getByOperatorId: (id) => get().policies.find(p => p.operatorId === id),

  getStorageRiskQueue: () =>
    get().policies.filter(p => p.isBlocked95 || p.uploadSpikeFlag || !!p.autoDeleteScheduledAt),

  setStorageTab: (storageTab) => set({ storageTab }),

  updatePolicy: (operatorId, patch) => set(s => ({
    policies: s.policies.map(p =>
      p.operatorId === operatorId ? { ...p, ...patch } : p
    ),
  })),

  setStoragePolicy: (operatorId, { extraMb }) => {
    set(s => ({
      policies: s.policies.map(p => {
        if (p.operatorId !== operatorId) return p
        const newTotal = p.planStorageMb + extraMb
        const pct = calcPercent(p.usedMb, newTotal)
        return {
          ...p,
          extraStorageMb: extraMb,
          totalMb: newTotal,
          usedPercent: pct,
          isBlocked95: pct >= 95,
          isWarning80: pct >= 80,
        }
      }),
    }))
  },

  updateUsage: (operatorId, usedMb) => {
    set(s => ({
      policies: s.policies.map(p => {
        if (p.operatorId !== operatorId) return p
        const pct = calcPercent(usedMb, p.totalMb)
        return {
          ...p,
          usedMb,
          usedPercent: pct,
          isBlocked95: pct >= 95,
          isWarning80: pct >= 80,
        }
      }),
    }))
  },

  mark95Blocked: (operatorId, blocked) => {
    get().updatePolicy(operatorId, { isBlocked95: blocked })
  },

  mark80Warning: (operatorId, warning) => {
    get().updatePolicy(operatorId, { isWarning80: warning })
  },

  detectUploadSpike: (operatorId, growth7dMb) => {
    get().updatePolicy(operatorId, { uploadSpikeFlag: growth7dMb >= 500, uploadGrowth7dMb: growth7dMb })
  },
}))
