/**
 * store/adsStore.ts — 광고 관리
 * 슈퍼관리자가 광고를 등록/수정/상태변경.
 * 지금은 슈퍼관리자 콘솔에서만 관리. 학부모 화면 노출 없음.
 */
import { create } from 'zustand'
import { useAuditLogStore } from './auditLogStore'

export type AdStatus = 'scheduled' | 'active' | 'inactive'

export interface Ad {
  id: string
  title: string
  description: string
  imageUrl: string
  linkUrl: string
  displayStart: string
  displayEnd: string
  status: AdStatus
  target: 'all' | 'parent' | 'teacher' | 'admin'
  createdAt: string
  createdBy: string
  updatedAt: string
}

interface AdsState {
  ads: Ad[]

  // selectors
  getActiveAds: () => Ad[]
  getByStatus: (status: AdStatus) => Ad[]

  // actions
  createAd: (params: Omit<Ad, 'id' | 'createdAt' | 'updatedAt'>, actorName?: string) => Ad
  updateAd: (id: string, patch: Partial<Omit<Ad, 'id' | 'createdAt'>>, actorName?: string) => void
  setStatus: (id: string, status: AdStatus, actorName?: string) => void
  deleteAd: (id: string) => void
}

let counter = 20

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
const daysLater = (d: number) => new Date(Date.now() + d * 86400000).toISOString()

const SEED_ADS: Ad[] = [
  {
    id: 'ad-001',
    title: '스윔노트 프리미엄 플랜',
    description: '무제한 회원 관리 · 자동 출결 · 학부모 알림까지.\n지금 업그레이드하고 30일 무료 체험!',
    imageUrl: '',
    linkUrl: 'https://swimnote.app/premium',
    displayStart: daysAgo(5),
    displayEnd: daysLater(25),
    status: 'active',
    target: 'all',
    createdAt: daysAgo(5),
    createdBy: '슈퍼관리자',
    updatedAt: daysAgo(5),
  },
  {
    id: 'ad-002',
    title: '여름방학 수영 집중반 모집',
    description: '7월~8월 집중반 모집 중. 등록 마감 6월 30일.',
    imageUrl: '',
    linkUrl: '',
    displayStart: daysLater(10),
    displayEnd: daysLater(40),
    status: 'scheduled',
    target: 'parent',
    createdAt: daysAgo(2),
    createdBy: '슈퍼관리자',
    updatedAt: daysAgo(2),
  },
  {
    id: 'ad-003',
    title: '구 이벤트 종료',
    description: '2024 연말 이벤트 종료 광고.',
    imageUrl: '',
    linkUrl: '',
    displayStart: daysAgo(90),
    displayEnd: daysAgo(30),
    status: 'inactive',
    target: 'all',
    createdAt: daysAgo(90),
    createdBy: '슈퍼관리자',
    updatedAt: daysAgo(30),
  },
]

export const useAdsStore = create<AdsState>((set, get) => ({
  ads: SEED_ADS,

  getActiveAds: () => get().ads.filter(a => a.status === 'active'),

  getByStatus: (status) => get().ads.filter(a => a.status === status),

  createAd: (params, actorName = '슈퍼관리자') => {
    const now = new Date().toISOString()
    const ad: Ad = { ...params, id: `ad-${Date.now()}-${++counter}`, createdAt: now, updatedAt: now }
    set(s => ({ ads: [ad, ...s.ads] }))
    useAuditLogStore.getState().createLog({
      category: '광고관리', title: `광고 등록: ${ad.title}`,
      actorName, impact: 'medium', detail: `상태: ${ad.status}, 대상: ${ad.target}`,
    })
    return ad
  },

  updateAd: (id, patch, actorName = '슈퍼관리자') => {
    const now = new Date().toISOString()
    set(s => ({ ads: s.ads.map(a => a.id === id ? { ...a, ...patch, updatedAt: now } : a) }))
    useAuditLogStore.getState().createLog({
      category: '광고관리', title: `광고 수정: ${id}`,
      actorName, impact: 'low', detail: JSON.stringify(patch),
    })
  },

  setStatus: (id, status, actorName = '슈퍼관리자') => {
    const now = new Date().toISOString()
    const ad = get().ads.find(a => a.id === id)
    set(s => ({ ads: s.ads.map(a => a.id === id ? { ...a, status, updatedAt: now } : a) }))
    useAuditLogStore.getState().createLog({
      category: '광고관리', title: `광고 상태 변경: ${ad?.title ?? id} → ${status}`,
      actorName, impact: 'medium', detail: `광고ID: ${id}`,
    })
  },

  deleteAd: (id) => {
    set(s => ({ ads: s.ads.filter(a => a.id !== id) }))
  },
}))
