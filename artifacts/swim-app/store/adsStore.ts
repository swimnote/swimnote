/**
 * store/adsStore.ts — 플랫폼 배너 관리 (API 연동)
 * bannerType: "slider" | "strip"
 */
import { create } from "zustand";
import { API_BASE } from "@/context/AuthContext";

export type AdStatus = "scheduled" | "active" | "inactive";
export type BannerType = "slider" | "strip";

export interface Ad {
  id: string;
  bannerType: BannerType;
  title: string;
  description: string;
  imageUrl: string;
  imageKey: string;
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

export function mapBanner(raw: any): Ad {
  return {
    id:           raw.id,
    bannerType:   (raw.banner_type as BannerType) ?? "slider",
    title:        raw.title ?? "",
    description:  raw.description ?? "",
    imageUrl:     raw.image_url ?? "",
    imageKey:     raw.image_key ?? "",
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

export interface CreateAdParams {
  bannerType?: BannerType;
  title: string;
  description?: string;
  imageUrl?: string;
  imageKey?: string;
  linkUrl?: string;
  linkLabel?: string;
  colorTheme?: string;
  target?: string;
  status?: AdStatus;
  displayStart: string;
  displayEnd: string;
  sortOrder?: number;
}

interface AdsState {
  ads: Ad[];
  stripAds: Ad[];
  loading: boolean;
  error: string | null;

  getActiveAds: () => Ad[];
  getByStatus: (status: AdStatus) => Ad[];
  getActiveStrip: () => Ad[];

  fetchBanners: (token: string, type?: BannerType) => Promise<void>;
  fetchAllBanners: (token: string) => Promise<void>;
  uploadImage: (token: string, uri: string, fileName?: string, mimeType?: string) => Promise<{ key: string; url: string } | null>;
  createAd: (token: string, params: CreateAdParams) => Promise<Ad | null>;
  updateAd: (token: string, id: string, patch: Partial<Omit<Ad, "id" | "createdAt">>) => Promise<void>;
  setStatus: (token: string, id: string, status: AdStatus) => Promise<void>;
  deleteAd: (token: string, id: string) => Promise<void>;
}

export const useAdsStore = create<AdsState>((set, get) => ({
  ads: [],
  stripAds: [],
  loading: false,
  error: null,

  getActiveAds: () => get().ads.filter(a => a.status === "active" && a.bannerType === "slider"),
  getByStatus: (status) => get().ads.filter(a => a.status === status && a.bannerType === "slider"),
  getActiveStrip: () => get().stripAds.filter(a => a.status === "active"),

  fetchBanners: async (token, type = "slider") => {
    set({ loading: true, error: null });
    try {
      const r = await fetch(`${API_BASE}/super/banners?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("조회 실패");
      const data = await r.json();
      const banners = (data.banners ?? []).map(mapBanner);
      if (type === "strip") set({ stripAds: banners });
      else set({ ads: banners });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  fetchAllBanners: async (token) => {
    set({ loading: true, error: null });
    try {
      const r = await fetch(`${API_BASE}/super/banners`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("조회 실패");
      const data = await r.json();
      const all = (data.banners ?? []).map(mapBanner);
      set({
        ads:      all.filter((b: Ad) => b.bannerType !== "strip"),
        stripAds: all.filter((b: Ad) => b.bannerType === "strip"),
      });
    } catch (e: any) {
      set({ error: e.message });
    } finally {
      set({ loading: false });
    }
  },

  uploadImage: async (token, uri, fileName = "banner.jpg", mimeType = "image/jpeg") => {
    try {
      const formData = new FormData();
      formData.append("image", { uri, name: fileName, type: mimeType } as any);
      const r = await fetch(`${API_BASE}/super/banner-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
  },

  createAd: async (token, params) => {
    try {
      const r = await fetch(`${API_BASE}/super/banners`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          banner_type:   params.bannerType ?? "slider",
          title:         params.title,
          description:   params.description,
          image_url:     params.imageUrl ?? "",
          image_key:     params.imageKey ?? "",
          link_url:      params.linkUrl,
          link_label:    params.linkLabel ?? "",
          color_theme:   params.colorTheme ?? "teal",
          target:        params.target ?? "all",
          status:        params.status ?? "inactive",
          display_start: params.displayStart,
          display_end:   params.displayEnd,
          sort_order:    params.sortOrder ?? 0,
        }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      const ad = mapBanner(data.banner);
      if (ad.bannerType === "strip") {
        set(s => ({ stripAds: [ad, ...s.stripAds] }));
      } else {
        set(s => ({ ads: [ad, ...s.ads] }));
      }
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
      if (patch.imageKey !== undefined)     body.image_key = patch.imageKey;
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
      const updated = mapBanner(data.banner);
      if (updated.bannerType === "strip") {
        set(s => ({ stripAds: s.stripAds.map(a => a.id === id ? updated : a) }));
      } else {
        set(s => ({ ads: s.ads.map(a => a.id === id ? updated : a) }));
      }
    } catch {}
  },

  setStatus: async (token, id, status) => {
    try {
      await fetch(`${API_BASE}/super/banners/${id}/status`, {
        method: "PATCH", headers: authHeaders(token), body: JSON.stringify({ status }),
      });
      set(s => ({
        ads:      s.ads.map(a => a.id === id ? { ...a, status } : a),
        stripAds: s.stripAds.map(a => a.id === id ? { ...a, status } : a),
      }));
    } catch {}
  },

  deleteAd: async (token, id) => {
    try {
      await fetch(`${API_BASE}/super/banners/${id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      });
      set(s => ({
        ads:      s.ads.filter(a => a.id !== id),
        stripAds: s.stripAds.filter(a => a.id !== id),
      }));
    } catch {}
  },
}));
