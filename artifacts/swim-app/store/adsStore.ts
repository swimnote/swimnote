/**
 * store/adsStore.ts — 플랫폼 배너 관리 (API 연동)
 * 슈퍼관리자가 배너를 등록/수정/상태변경/삭제.
 * 학부모 화면에는 활성 배너가 실시간 노출됨.
 */
import { create } from "zustand";
import { API_BASE } from "@/context/AuthContext";

export type AdStatus = "scheduled" | "active" | "inactive";

export interface Ad {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  linkUrl: string;
  linkLabel: string;
  colorTheme: string;
  displayStart: string;
  displayEnd: string;
  status: AdStatus;
  target: "all" | "parent" | "teacher" | "admin";
  sortOrder: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

function mapBanner(raw: any): Ad {
  return {
    id:           raw.id,
    title:        raw.title ?? "",
    description:  raw.description ?? "",
    imageUrl:     raw.image_url ?? "",
    linkUrl:      raw.link_url ?? "",
    linkLabel:    raw.link_label ?? "",
    colorTheme:   raw.color_theme ?? "teal",
    displayStart: raw.display_start ?? new Date().toISOString(),
    displayEnd:   raw.display_end ?? new Date().toISOString(),
    status:       (raw.status as AdStatus) ?? "inactive",
    target:       raw.target ?? "all",
    sortOrder:    raw.sort_order ?? 0,
    createdAt:    raw.created_at ?? new Date().toISOString(),
    createdBy:    raw.created_by ?? "",
    updatedAt:    raw.updated_at ?? new Date().toISOString(),
  };
}

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

interface AdsState {
  ads: Ad[];
  loading: boolean;
  error: string | null;

  getActiveAds: () => Ad[];
  getByStatus: (status: AdStatus) => Ad[];

  fetchBanners: (token: string) => Promise<void>;
  createAd: (token: string, params: Omit<Ad, "id" | "createdAt" | "updatedAt" | "imageUrl" | "linkLabel" | "sortOrder" | "colorTheme"> & {
    imageUrl?: string; linkLabel?: string; sortOrder?: number; colorTheme?: string;
  }) => Promise<Ad | null>;
  updateAd: (token: string, id: string, patch: Partial<Omit<Ad, "id" | "createdAt">>) => Promise<void>;
  setStatus: (token: string, id: string, status: AdStatus) => Promise<void>;
  deleteAd: (token: string, id: string) => Promise<void>;
}

export const useAdsStore = create<AdsState>((set, get) => ({
  ads: [],
  loading: false,
  error: null,

  getActiveAds: () => get().ads.filter(a => a.status === "active"),
  getByStatus: (status) => get().ads.filter(a => a.status === status),

  fetchBanners: async (token) => {
    set({ loading: true, error: null });
    try {
      const r = await fetch(`${API_BASE}/super/banners`, { headers: authHeaders(token) });
      if (!r.ok) throw new Error("조회 실패");
      const data = await r.json();
      set({ ads: (data.banners ?? []).map(mapBanner) });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  createAd: async (token, params) => {
    try {
      const r = await fetch(`${API_BASE}/super/banners`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          title:         params.title,
          description:   params.description,
          image_url:     params.imageUrl ?? "",
          link_url:      params.linkUrl,
          link_label:    params.linkLabel ?? "",
          color_theme:   params.colorTheme ?? "teal",
          target:        params.target,
          status:        params.status,
          display_start: params.displayStart,
          display_end:   params.displayEnd,
          sort_order:    params.sortOrder ?? 0,
        }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      const ad = mapBanner(data.banner);
      set(s => ({ ads: [ad, ...s.ads] }));
      return ad;
    } catch {
      return null;
    }
  },

  updateAd: async (token, id, patch) => {
    try {
      const body: any = {};
      if (patch.title !== undefined)        body.title = patch.title;
      if (patch.description !== undefined)  body.description = patch.description;
      if (patch.imageUrl !== undefined)     body.image_url = patch.imageUrl;
      if (patch.linkUrl !== undefined)      body.link_url = patch.linkUrl;
      if (patch.linkLabel !== undefined)    body.link_label = patch.linkLabel;
      if (patch.colorTheme !== undefined)   body.color_theme = patch.colorTheme;
      if (patch.target !== undefined)       body.target = patch.target;
      if (patch.status !== undefined)       body.status = patch.status;
      if (patch.displayStart !== undefined) body.display_start = patch.displayStart;
      if (patch.displayEnd !== undefined)   body.display_end = patch.displayEnd;
      if (patch.sortOrder !== undefined)    body.sort_order = patch.sortOrder;

      const r = await fetch(`${API_BASE}/super/banners/${id}`, {
        method: "PUT", headers: authHeaders(token), body: JSON.stringify(body),
      });
      if (!r.ok) return;
      const data = await r.json();
      set(s => ({ ads: s.ads.map(a => a.id === id ? mapBanner(data.banner) : a) }));
    } catch {}
  },

  setStatus: async (token, id, status) => {
    try {
      const r = await fetch(`${API_BASE}/super/banners/${id}/status`, {
        method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ status }),
      });
      if (!r.ok) return;
      set(s => ({ ads: s.ads.map(a => a.id === id ? { ...a, status } : a) }));
    } catch {}
  },

  deleteAd: async (token, id) => {
    try {
      await fetch(`${API_BASE}/super/banners/${id}`, {
        method: "DELETE", headers: authHeaders(token),
      });
      set(s => ({ ads: s.ads.filter(a => a.id !== id) }));
    } catch {}
  },
}));
