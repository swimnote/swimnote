/**
 * store/readonlyStore.ts
 * 읽기전용 제어 — 플랫폼/운영자/기능별
 */

import { create } from 'zustand'
import type { ReadonlyControl, ReadonlyScope } from '../domain/types'

interface ReadonlyState {
  controls: ReadonlyControl[]
  platformReadonly: boolean
  platformReadonlyReason: string
  platformReadonlyLevel: 'active' | 'warning' | 'emergency'

  // selectors
  getPlatformControls: () => ReadonlyControl[]
  getOperatorControls: (operatorId: string) => ReadonlyControl[]
  getFeatureControls: () => ReadonlyControl[]
  isOperatorReadonly: (operatorId: string) => boolean
  isFeatureReadonly: (feature: string) => boolean

  // actions
  setPlatformReadonly: (enabled: boolean, reason: string, level: 'active' | 'warning' | 'emergency', actorName: string) => void
  setOperatorReadonly: (params: {
    operatorId: string
    operatorName: string
    enabled: boolean
    reason: string
    level: 'active' | 'warning' | 'emergency'
    actorName: string
  }) => ReadonlyControl
  setFeatureReadonly: (params: {
    targetFeature: string
    enabled: boolean
    reason: string
    level: 'active' | 'warning' | 'emergency'
    actorName: string
  }) => ReadonlyControl
  removeControl: (id: string) => void
}

let idCounter = 100

// 기본 seed: 약간의 초기 제어 상태
const INITIAL_CONTROLS: ReadonlyControl[] = [
  {
    id: 'rc-001',
    scope: 'operator',
    operatorId: 'op-005',
    operatorName: '인천수영학원',
    targetFeature: '',
    level: 'active',
    enabled: true,
    reason: '구독 해지 처리',
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    createdBy: '시스템',
  },
  {
    id: 'rc-002',
    scope: 'operator',
    operatorId: 'op-010',
    operatorName: '울산마스터즈',
    targetFeature: '',
    level: 'emergency',
    enabled: true,
    reason: 'Grace 기간 만료. 자동삭제 예약.',
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    createdBy: '시스템',
  },
]

export const useReadonlyStore = create<ReadonlyState>((set, get) => ({
  controls: INITIAL_CONTROLS,
  platformReadonly: false,
  platformReadonlyReason: '',
  platformReadonlyLevel: 'active',

  getPlatformControls: () => get().controls.filter(c => c.scope === 'platform'),
  getOperatorControls: (operatorId) =>
    get().controls.filter(c => c.scope === 'operator' && c.operatorId === operatorId),
  getFeatureControls: () => get().controls.filter(c => c.scope === 'feature'),

  isOperatorReadonly: (operatorId) =>
    get().controls.some(c => c.scope === 'operator' && c.operatorId === operatorId && c.enabled),

  isFeatureReadonly: (feature) =>
    get().controls.some(c => c.scope === 'feature' && c.targetFeature === feature && c.enabled),

  setPlatformReadonly: (enabled, reason, level, _actorName) => {
    set({ platformReadonly: enabled, platformReadonlyReason: reason, platformReadonlyLevel: level })
    if (enabled) {
      const control: ReadonlyControl = {
        id: `rc-${Date.now()}-${++idCounter}`,
        scope: 'platform',
        operatorId: '',
        operatorName: '전체 플랫폼',
        targetFeature: '',
        level,
        enabled: true,
        reason,
        createdAt: new Date().toISOString(),
        createdBy: _actorName,
      }
      set(s => ({ controls: [control, ...s.controls] }))
    } else {
      set(s => ({
        controls: s.controls.map(c =>
          c.scope === 'platform' ? { ...c, enabled: false } : c
        ),
      }))
    }
  },

  setOperatorReadonly: (params) => {
    const existing = get().controls.find(
      c => c.scope === 'operator' && c.operatorId === params.operatorId
    )
    if (existing) {
      let result = existing
      set(s => ({
        controls: s.controls.map(c => {
          if (c.id !== existing.id) return c
          result = { ...c, enabled: params.enabled, reason: params.reason, level: params.level }
          return result
        }),
      }))
      return result
    }
    const control: ReadonlyControl = {
      id: `rc-${Date.now()}-${++idCounter}`,
      scope: 'operator',
      operatorId: params.operatorId,
      operatorName: params.operatorName,
      targetFeature: '',
      level: params.level,
      enabled: params.enabled,
      reason: params.reason,
      createdAt: new Date().toISOString(),
      createdBy: params.actorName,
    }
    set(s => ({ controls: [control, ...s.controls] }))
    return control
  },

  setFeatureReadonly: (params) => {
    const existing = get().controls.find(
      c => c.scope === 'feature' && c.targetFeature === params.targetFeature
    )
    if (existing) {
      let result = existing
      set(s => ({
        controls: s.controls.map(c => {
          if (c.id !== existing.id) return c
          result = { ...c, enabled: params.enabled, reason: params.reason, level: params.level }
          return result
        }),
      }))
      return result
    }
    const control: ReadonlyControl = {
      id: `rc-${Date.now()}-${++idCounter}`,
      scope: 'feature',
      operatorId: '',
      operatorName: '',
      targetFeature: params.targetFeature,
      level: params.level,
      enabled: params.enabled,
      reason: params.reason,
      createdAt: new Date().toISOString(),
      createdBy: params.actorName,
    }
    set(s => ({ controls: [control, ...s.controls] }))
    return control
  },

  removeControl: (id) => set(s => ({
    controls: s.controls.filter(c => c.id !== id),
  })),
}))
