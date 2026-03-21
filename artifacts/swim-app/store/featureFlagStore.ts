/**
 * store/featureFlagStore.ts
 * 기능 플래그 — 토글 시 사유 필수, 롤백 지원, 감사 로그 자동 생성
 */

import { create } from 'zustand'
import type { FeatureFlag, FeatureFlagScope } from '../domain/types'
import { SEED_FEATURE_FLAGS } from '../seed/featureFlags'

interface FeatureFlagState {
  flags: FeatureFlag[]
  loading: boolean

  getGlobalFlags: () => FeatureFlag[]
  getOperatorFlags: (operatorId: string) => FeatureFlag[]
  getFlagByKey: (key: string, operatorId?: string) => FeatureFlag | undefined
  isEnabled: (key: string, operatorId?: string) => boolean

  toggleFlag: (id: string, enabled: boolean, reason: string, actorName: string) => FeatureFlag | null
  rollbackFlag: (id: string, reason: string, actorName: string) => FeatureFlag | null
  setOperatorFlag: (params: {
    key: string
    name: string
    operatorId: string
    operatorName: string
    enabled: boolean
    reason: string
    actorName: string
  }) => FeatureFlag
  updateFlag: (id: string, patch: Partial<FeatureFlag>) => void
}

let idCounter = 100

// 시드 데이터에 lastEnabledState 초기화
const initFlags: FeatureFlag[] = SEED_FEATURE_FLAGS.map(f => ({
  ...f,
  lastEnabledState: f.enabled,
}))

export const useFeatureFlagStore = create<FeatureFlagState>((set, get) => ({
  flags: initFlags,
  loading: false,

  getGlobalFlags: () => get().flags.filter(f => f.scope === 'global'),

  getOperatorFlags: (operatorId) =>
    get().flags.filter(f => f.scope === 'operator' && f.operatorId === operatorId),

  getFlagByKey: (key, operatorId) => {
    const { flags } = get()
    if (operatorId) {
      const opFlag = flags.find(f => f.key === key && f.scope === 'operator' && f.operatorId === operatorId)
      if (opFlag) return opFlag
    }
    return flags.find(f => f.key === key && f.scope === 'global')
  },

  isEnabled: (key, operatorId) => {
    const flag = get().getFlagByKey(key, operatorId)
    return flag?.enabled ?? false
  },

  toggleFlag: (id, enabled, reason, actorName) => {
    if (!reason.trim()) return null
    let result: FeatureFlag | null = null
    set(s => ({
      flags: s.flags.map(f => {
        if (f.id !== id) return f
        result = {
          ...f,
          lastEnabledState: f.enabled,  // 이전 상태 저장
          enabled,
          reason,
          updatedAt: new Date().toISOString(),
          updatedBy: actorName,
        }
        return result
      }),
    }))
    return result
  },

  rollbackFlag: (id, reason, actorName) => {
    if (!reason.trim()) return null
    let result: FeatureFlag | null = null
    set(s => ({
      flags: s.flags.map(f => {
        if (f.id !== id) return f
        const previousState = f.lastEnabledState ?? !f.enabled
        result = {
          ...f,
          lastEnabledState: f.enabled,
          enabled: previousState,
          reason: `[롤백] ${reason}`,
          updatedAt: new Date().toISOString(),
          updatedBy: actorName,
        }
        return result
      }),
    }))
    return result
  },

  setOperatorFlag: (params) => {
    const existing = get().flags.find(
      f => f.key === params.key && f.scope === 'operator' && f.operatorId === params.operatorId
    )
    if (existing) {
      let result = existing
      set(s => ({
        flags: s.flags.map(f => {
          if (f.id !== existing.id) return f
          result = {
            ...f,
            lastEnabledState: f.enabled,
            enabled: params.enabled,
            reason: params.reason,
            updatedAt: new Date().toISOString(),
            updatedBy: params.actorName,
          }
          return result
        }),
      }))
      return result
    }
    const newFlag: FeatureFlag = {
      id: `ff-${Date.now()}-${++idCounter}`,
      key: params.key,
      name: params.name + ' (운영자 예외)',
      description: `${params.operatorName} 운영자 예외 설정`,
      scope: 'operator' as FeatureFlagScope,
      operatorId: params.operatorId,
      enabled: params.enabled,
      lastEnabledState: !params.enabled,
      updatedAt: new Date().toISOString(),
      updatedBy: params.actorName,
      reason: params.reason,
    }
    set(s => ({ flags: [...s.flags, newFlag] }))
    return newFlag
  },

  updateFlag: (id, patch) => set(s => ({
    flags: s.flags.map(f =>
      f.id === id ? { ...f, ...patch, updatedAt: new Date().toISOString() } : f
    ),
  })),
}))
