/**
 * store/noticeStore.ts — 공지/팝업 시스템
 * 슈퍼관리자가 등록한 공지를 대상별로 강제 확인 팝업으로 노출.
 * - 최신 1개만 사용자에게 노출
 * - 이전 공지는 슈퍼관리자 보관용으로만 저장 (사용자에게 노출 안 함)
 * - 다시 보지 않기: dismissedIds에 noticeId 저장 (AsyncStorage 영속화)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from 'zustand'

const DISMISSED_KEY = "swimnote_dismissed_notice_ids";

export type NoticeTarget = 'all' | 'admin' | 'teacher' | 'parent'

export type NoticeType =
  | 'update'        // 업데이트 예정
  | 'general'       // 일반 안내
  | 'maintenance'   // 서버/장애 안내
  | 'special'       // 특별 공지

export const NOTICE_TYPE_CFG: Record<NoticeType, { label: string; color: string; bg: string; icon: string }> = {
  update:      { label: "업데이트 예정",  color: "#0891B2", bg: "#ECFEFF",  icon: "upload-cloud" },
  general:     { label: "일반 안내",      color: "#4F46E5", bg: "#EEF2FF",  icon: "info" },
  maintenance: { label: "서버/장애 안내", color: "#DC2626", bg: "#FEE2E2",  icon: "alert-triangle" },
  special:     { label: "특별 공지",      color: "#D97706", bg: "#FEF3C7",  icon: "star" },
}

export interface Notice {
  id: string
  title: string
  content: string
  target: NoticeTarget
  noticeType: NoticeType
  showFrom: string    // ISO — 노출 시작일시
  forcedAck: boolean
  createdAt: string
  createdBy: string
}

// 역할 → target 매핑
function roleMatchesTarget(role: string, target: NoticeTarget): boolean {
  if (target === 'all') return true
  if (target === 'admin' && (role === 'pool_admin' || role === 'sub_admin' || role === 'super_admin' || role === 'platform_admin')) return true
  if (target === 'teacher' && role === 'teacher') return true
  if (target === 'parent' && (role === 'parent' || role === 'parent_account')) return true
  return false
}

interface NoticeState {
  notices: Notice[]
  dismissedIds: string[]
  _hydrated: boolean

  // selectors
  getLatestForRole: (role: string) => Notice | null
  isDismissed: (noticeId: string) => boolean

  // actions
  createNotice: (params: Omit<Notice, 'id' | 'createdAt'>) => Notice
  updateNotice: (id: string, patch: Partial<Omit<Notice, 'id' | 'createdAt'>>) => void
  deleteNotice: (id: string) => void
  dismissForever: (noticeId: string) => void
  hydrateDismissed: () => Promise<void>
}

let counter = 10

const now = new Date()
const SEED_NOTICES: Notice[] = [
  {
    id: 'notice-001',
    title: '스윔노트 앱 업데이트 안내',
    content: '스윔노트 앱이 v2.1로 업데이트되었습니다.\n주요 변경사항:\n- 학부모 가입 승인 흐름 개선\n- 성능 개선 및 버그 수정\n\n불편하신 점은 고객센터로 문의해 주세요.',
    target: 'all',
    noticeType: 'update',
    showFrom: new Date(now.getTime() - 2 * 86400000).toISOString(),
    forcedAck: true,
    createdAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    createdBy: '슈퍼관리자',
  },
]

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: SEED_NOTICES,
  dismissedIds: [],
  _hydrated: false,

  getLatestForRole: (role) => {
    const { notices, dismissedIds } = get()
    const now = new Date()
    const candidates = notices
      .filter(n => roleMatchesTarget(role, n.target))
      .filter(n => !n.showFrom || new Date(n.showFrom) <= now)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const latest = candidates[0] ?? null
    if (!latest) return null
    if (dismissedIds.includes(latest.id)) return null
    return latest
  },

  isDismissed: (noticeId) => get().dismissedIds.includes(noticeId),

  createNotice: (params) => {
    const notice: Notice = {
      ...params,
      id: `notice-${Date.now()}-${++counter}`,
      createdAt: new Date().toISOString(),
    }
    set(s => ({ notices: [notice, ...s.notices] }))
    return notice
  },

  updateNotice: (id, patch) => {
    set(s => ({
      notices: s.notices.map(n => n.id === id ? { ...n, ...patch } : n),
    }))
  },

  deleteNotice: (id) => {
    set(s => ({ notices: s.notices.filter(n => n.id !== id) }))
  },

  dismissForever: (noticeId) => {
    set(s => {
      if (s.dismissedIds.includes(noticeId)) return s
      const next = [...s.dismissedIds, noticeId]
      // AsyncStorage에 영속화
      AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(console.error)
      return { dismissedIds: next }
    })
  },

  // 앱 시작 시 AsyncStorage에서 dismissedIds 복원
  hydrateDismissed: async () => {
    if (get()._hydrated) return
    try {
      const raw = await AsyncStorage.getItem(DISMISSED_KEY)
      if (raw) {
        const ids: string[] = JSON.parse(raw)
        set({ dismissedIds: ids, _hydrated: true })
      } else {
        set({ _hydrated: true })
      }
    } catch {
      set({ _hydrated: true })
    }
  },
}))
