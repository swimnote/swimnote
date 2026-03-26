/**
 * store/noticeStore.ts — 공지 dismissed ID 관리
 *
 * ─ 역할 ────────────────────────────────────────────────────────────────
 * AsyncStorage 기반 dismissed 공지 ID 목록 관리 전담.
 * 실제 공지 데이터는 API에서 직접 조회 (NoticePopup → apiRequest).
 *
 * ─ 팝업 흐름 (NoticePopup.tsx 참조) ──────────────────────────────────
 * 콜드런치(프로세스 재시작) 감지 → API 조회 →
 * status=published 필터 → dismissed 제외 →
 * global 먼저, pool 나중 → 1개씩 노출
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from 'zustand';

const DISMISSED_KEY = "swimnote_dismissed_notice_ids";

// ─────────────────────────────────────────────────────────────────────────────
// 타입 (super/notices.tsx 하위호환 유지)
// ─────────────────────────────────────────────────────────────────────────────
export type NoticeTarget = 'all' | 'admin' | 'teacher' | 'parent';

export type NoticeType =
  | 'update'        // 업데이트 예정
  | 'general'       // 일반 안내
  | 'maintenance'   // 서버/장애 안내
  | 'special';      // 특별 공지

export const NOTICE_TYPE_CFG: Record<NoticeType, { label: string; color: string; bg: string; icon: string }> = {
  update:      { label: "업데이트 예정",  color: "#0891B2", bg: "#ECFEFF",  icon: "upload-cloud" },
  general:     { label: "일반 안내",      color: "#4F46E5", bg: "#EEF2FF",  icon: "info" },
  maintenance: { label: "서버/장애 안내", color: "#DC2626", bg: "#FEE2E2",  icon: "alert-triangle" },
  special:     { label: "특별 공지",      color: "#D97706", bg: "#FEF3C7",  icon: "star" },
};

export interface Notice {
  id: string;
  title: string;
  content: string;
  target: NoticeTarget;
  noticeType: NoticeType;
  showFrom: string;
  forcedAck: boolean;
  createdAt: string;
  createdBy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 스토어 인터페이스
// ─────────────────────────────────────────────────────────────────────────────
interface NoticeState {
  notices: Notice[];          // 하위호환 유지 (super/notices.tsx에서 사용)
  dismissedIds: string[];
  _hydrated: boolean;

  isDismissed: (id: string) => boolean;
  dismissForever: (id: string) => void;
  hydrateDismissed: () => Promise<void>;

  // 하위호환 CRUD (super/notices.tsx에서 사용 중)
  createNotice: (params: Omit<Notice, 'id' | 'createdAt'>) => Notice;
  updateNotice: (id: string, patch: Partial<Omit<Notice, 'id' | 'createdAt'>>) => void;
  deleteNotice: (id: string) => void;
  getLatestForRole: (role: string) => Notice | null;
}

let _counter = 0;

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],          // 시드 데이터 없음 — 공지는 API에서 직접 조회
  dismissedIds: [],
  _hydrated: false,

  isDismissed: (id) => get().dismissedIds.includes(id),

  dismissForever: (id) => {
    set(s => {
      if (s.dismissedIds.includes(id)) return s;
      const next = [...s.dismissedIds, id];
      AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(next)).catch(console.error);
      return { dismissedIds: next };
    });
  },

  hydrateDismissed: async () => {
    if (get()._hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(DISMISSED_KEY);
      if (raw) {
        const ids: string[] = JSON.parse(raw);
        set({ dismissedIds: ids, _hydrated: true });
      } else {
        set({ _hydrated: true });
      }
    } catch {
      set({ _hydrated: true });
    }
  },

  // ── 하위호환 CRUD (super/notices.tsx) ────────────────────────────────────
  getLatestForRole: (_role) => null,   // API 전환 후 미사용

  createNotice: (params) => {
    const notice: Notice = {
      ...params,
      id: `notice-${Date.now()}-${++_counter}`,
      createdAt: new Date().toISOString(),
    };
    set(s => ({ notices: [notice, ...s.notices] }));
    return notice;
  },

  updateNotice: (id, patch) => {
    set(s => ({
      notices: s.notices.map(n => n.id === id ? { ...n, ...patch } : n),
    }));
  },

  deleteNotice: (id) => {
    set(s => ({ notices: s.notices.filter(n => n.id !== id) }));
  },
}));
