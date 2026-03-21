/**
 * store/mediaStore.ts
 * 미디어 에셋 관리 — 무료/유료 버전 분리 처리
 */

import { create } from 'zustand'
import type { MediaAsset, MediaStatus } from '../domain/types'
import { SEED_MEDIA } from '../seed/media'
import { PHOTO_POLICY } from '../domain/policies'

interface MediaState {
  assets: MediaAsset[]

  // selectors
  getByOperator: (operatorId: string) => MediaAsset[]
  getVisibleMediaForPlan: (operatorId: string, isPaidPlan: boolean) => MediaAsset[]
  calculateMediaUsageByOperator: (operatorId: string) => {
    totalMb: number
    freeMb: number
    paidMb: number
    count: number
  }

  // actions
  uploadMediaMock: (params: {
    operatorId: string
    journalId?: string
    classId?: string
    studentId?: string
    visibility: 'class_all' | 'student_only'
    originalSizeMb: number
    sourceLabel: string
  }) => MediaAsset
  processMediaMock: (id: string) => void
  deleteMedia: (id: string) => void
  deleteAllForOperator: (operatorId: string) => void
  updateAsset: (id: string, patch: Partial<MediaAsset>) => void
}

let idCounter = 100

export const useMediaStore = create<MediaState>((set, get) => ({
  assets: SEED_MEDIA,

  getByOperator: (operatorId) =>
    get().assets.filter(a => a.operatorId === operatorId),

  getVisibleMediaForPlan: (operatorId, isPaidPlan) => {
    const assets = get().getByOperator(operatorId)
    return assets.filter(a => a.status === 'ready').map(a => ({
      ...a,
      // 무료 플랜: previewFree 키 사용, 유료: previewPaid 사용
      activeKey: isPaidPlan ? a.previewPaidKey : a.previewFreeKey,
    })) as MediaAsset[]
  },

  calculateMediaUsageByOperator: (operatorId) => {
    const assets = get().getByOperator(operatorId).filter(a => a.status === 'ready')
    return {
      totalMb: assets.reduce((s, a) => s + a.previewPaidSizeMb, 0),
      freeMb: assets.reduce((s, a) => s + a.previewFreeSizeMb, 0),
      paidMb: assets.reduce((s, a) => s + a.previewPaidSizeMb, 0),
      count: assets.length,
    }
  },

  uploadMediaMock: (params) => {
    const freeMb = +(params.originalSizeMb * PHOTO_POLICY.freePreviewSizeRatio).toFixed(2)
    const paidMb = +(params.originalSizeMb * PHOTO_POLICY.paidPreviewSizeRatio).toFixed(2)
    const asset: MediaAsset = {
      id: `media-${Date.now()}-${++idCounter}`,
      operatorId: params.operatorId,
      journalId: params.journalId ?? null,
      classId: params.classId ?? null,
      studentId: params.studentId ?? null,
      visibility: params.visibility,
      status: 'uploading',
      originalInputSizeMb: params.originalSizeMb,
      previewFreeSizeMb: freeMb,
      previewPaidSizeMb: paidMb,
      originalKey: `${params.operatorId}/originals/img-${Date.now()}.jpg`,
      previewFreeKey: null,
      previewPaidKey: null,
      sourceLabel: params.sourceLabel,
      createdAt: new Date().toISOString(),
    }
    set(s => ({ assets: [asset, ...s.assets] }))

    // 상태 흐름: uploading -> uploaded -> processing -> ready (mock)
    setTimeout(() => get().updateAsset(asset.id, { status: 'uploaded' }), 500)
    setTimeout(() => get().updateAsset(asset.id, { status: 'processing' }), 1000)
    setTimeout(() => {
      get().updateAsset(asset.id, {
        status: 'ready',
        previewFreeKey: `${params.operatorId}/free/img-${Date.now()}-low.jpg`,
        previewPaidKey: `${params.operatorId}/paid/img-${Date.now()}-hd.jpg`,
      })
    }, 2000)

    return asset
  },

  processMediaMock: (id) => {
    get().updateAsset(id, { status: 'processing' })
    setTimeout(() => {
      const asset = get().assets.find(a => a.id === id)
      if (asset) {
        get().updateAsset(id, {
          status: 'ready',
          previewFreeKey: asset.originalKey?.replace('originals', 'free') + '-low.jpg',
          previewPaidKey: asset.originalKey?.replace('originals', 'paid') + '-hd.jpg',
        })
      }
    }, 1500)
  },

  deleteMedia: (id) => set(s => ({ assets: s.assets.filter(a => a.id !== id) })),

  deleteAllForOperator: (operatorId) => set(s => ({
    assets: s.assets.filter(a => a.operatorId !== operatorId),
  })),

  updateAsset: (id, patch) => set(s => ({
    assets: s.assets.map(a => a.id === id ? { ...a, ...patch } : a),
  })),
}))
