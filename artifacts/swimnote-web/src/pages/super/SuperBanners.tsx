/**
 * SuperBanners — 가로 프로모션 배너 관리 (banner_type='strip')
 *
 * - 좌: 배너 목록 (최대 4개) + 새 배너
 * - 우: 편집 폼 (상단 Preview + TEXT/IMAGE 설정)
 * - APP Super Admin과 동일 platform_banners DB
 * - API: GET/POST/PUT /super/banners, DELETE, PATCH /status
 * - 색상: parseBannerTheme (APP과 동일 색상 의미)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, authHeaders } from "@/lib/api";
import {
  parseBannerTheme, serializeCustomTheme, isValidHex, contrastRatio,
  BANNER_PRESET_KEYS, BANNER_PRESETS, BANNER_PRESET_ACCENTS,
} from "@/lib/bannerTheme";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const MAX_SLIDES = 4;
const TITLE_MAX  = 30;
const DESC_MAX   = 60;

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface StripBanner {
  id: string;
  title: string;
  description: string | null;
  color_theme: string;
  banner_type: string;
  image_url: string | null;
  image_key: string | null;
  display_url: string | null;
  link_url: string | null;
  link_label: string | null;
  display_start: string;
  display_end: string;
  display_seconds: number;
  sort_order: number;
  status: string;
}

type BannerType  = "text" | "image";
type ColorMode   = "preset" | "custom";
type AdStatus    = "active" | "scheduled" | "inactive";

interface FormState {
  bannerType:   BannerType;
  title:        string;
  description:  string;
  linkUrl:      string;
  displayStart: string;
  displayEnd:   string;
  displaySeconds: string;
  sortOrder:    string;
  status:       AdStatus;
  colorTheme:   string;
  colorMode:    ColorMode;
  customBg:     string;
  customText:   string;
  imageFile:    File | null;
  imageKey:     string;
  imageUrl:     string;
  displayUrl:   string;
}

const STATUS_CFG: Record<AdStatus, { label: string; dot: string; badge: string }> = {
  active:    { label: "노출 중", dot: "#22C55E",  badge: "#DCFCE7" },
  scheduled: { label: "예약됨",  dot: "#D97706",  badge: "#FEF9C3" },
  inactive:  { label: "비활성",  dot: "#94A3B8",  badge: "#F1F5F9" },
};

// ── 빈 폼 ──────────────────────────────────────────────────────────────────────
function blankForm(): FormState {
  const today  = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    bannerType: "text", title: "", description: "", linkUrl: "",
    displayStart: today, displayEnd: future,
    displaySeconds: "15", sortOrder: "0", status: "inactive",
    colorTheme: "teal", colorMode: "preset",
    customBg: "#1B3A5C", customText: "#FFFFFF",
    imageFile: null, imageKey: "", imageUrl: "", displayUrl: "",
  };
}

function bannerToForm(b: StripBanner): FormState {
  const hasImage = !!(b.image_key || b.image_url);
  const isCustom = b.color_theme?.startsWith("custom:");
  let customBg = "#1B3A5C", customText = "#FFFFFF";
  if (isCustom) {
    const parts = b.color_theme.split(":");
    customBg   = parts[1] ?? "#1B3A5C";
    customText = parts[2] ?? "#FFFFFF";
  }
  return {
    bannerType:     hasImage ? "image" : "text",
    title:          b.title,
    description:    b.description ?? "",
    linkUrl:        b.link_url ?? "",
    displayStart:   b.display_start?.slice(0, 10) ?? "",
    displayEnd:     b.display_end?.slice(0, 10) ?? "",
    displaySeconds: String(b.display_seconds ?? 15),
    sortOrder:      String(b.sort_order ?? 0),
    status:         (b.status as AdStatus) ?? "inactive",
    colorTheme:     isCustom ? b.color_theme : (b.color_theme ?? "teal"),
    colorMode:      isCustom ? "custom" : "preset",
    customBg, customText,
    imageFile:      null,
    imageKey:       b.image_key ?? "",
    imageUrl:       b.image_url ?? "",
    displayUrl:     b.display_url ?? "",
  };
}

// ── Preview 컴포넌트 ─────────────────────────────────────────────────────────
function BannerPreview({ form }: { form: FormState }) {
  const imgSrc = form.imageFile
    ? URL.createObjectURL(form.imageFile)
    : (form.displayUrl || (form.imageKey ? `${API_BASE}/uploads/${form.imageKey}` : form.imageUrl) || "");

  const effectiveTheme = form.colorMode === "custom"
    ? serializeCustomTheme(
        isValidHex(form.customBg)   ? form.customBg   : "#1B3A5C",
        isValidHex(form.customText) ? form.customText : "#FFFFFF",
      )
    : form.colorTheme;
  const th = parseBannerTheme(effectiveTheme);

  if (form.bannerType === "image" && imgSrc) {
    return (
      <div style={{ aspectRatio: "16/5", borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" }}>
        <img src={imgSrc} alt="preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
  if (form.bannerType === "image" && !imgSrc) {
    return (
      <div style={{
        aspectRatio: "16/5", borderRadius: 10, border: "1px dashed #cbd5e1",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f8fafc", color: "#94a3b8", fontSize: 13,
      }}>
        이미지를 선택하세요
      </div>
    );
  }
  return (
    <div style={{
      aspectRatio: "16/5", borderRadius: 10, overflow: "hidden",
      background: th.bg, border: "1px solid #e2e8f0",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "0 24px", gap: 4, textAlign: "center",
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: th.text, lineHeight: 1.4 }}>
        {form.title || "제목을 입력하세요"}
      </div>
      {form.description && (
        <div style={{ fontSize: 12, color: th.text, opacity: 0.8, lineHeight: 1.4 }}>
          {form.description}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SuperBanners() {
  const [banners, setBanners]     = useState<StripBanner[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId]       = useState<string | null>(null); // null = new
  const [form, setForm]           = useState<FormState>(blankForm());
  const [saving, setSaving]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState<string | null>(null);
  const fileRef                   = useRef<HTMLInputElement>(null);

  // ── Load ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ banners: StripBanner[] }>("/super/banners?type=strip");
      const sorted = (d.banners ?? []).sort((a, b) => a.sort_order - b.sort_order);
      setBanners(sorted);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Select banner ──
  function selectBanner(b: StripBanner) {
    setSelectedId(b.id);
    setEditId(b.id);
    setForm(bannerToForm(b));
    setError(null);
  }

  // ── New banner ──
  function startNew() {
    const activeCount = banners.filter(b => b.status === "active" || b.status === "scheduled").length;
    if (activeCount >= MAX_SLIDES) {
      alert(`가로 배너는 최대 ${MAX_SLIDES}개까지 등록할 수 있습니다.`);
      return;
    }
    setSelectedId(null);
    setEditId(null);
    setForm(blankForm());
    setError(null);
  }

  // ── Image upload ──
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 미리보기용 로컬 저장
    setForm(f => ({ ...f, imageFile: file, imageKey: "", imageUrl: "", displayUrl: "" }));
  }

  async function uploadImage(file: File): Promise<{ key: string; url: string } | null> {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("images", file);
      const r = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "업로드 실패");
      const key: string = d.urls?.[0] ?? "";
      return { key, url: `${API_BASE}/uploads/${key}` };
    } catch (e: any) {
      setError(e.message ?? "이미지 업로드 오류");
      return null;
    } finally {
      setUploading(false);
    }
  }

  // ── Save ──
  async function handleSave() {
    setError(null);

    // 검증
    if (form.bannerType === "text") {
      if (!form.title.trim()) { setError("제목을 입력하세요."); return; }
      if (form.title.length > TITLE_MAX) { setError(`제목은 최대 ${TITLE_MAX}자입니다.`); return; }
      if (form.colorMode === "custom") {
        if (!isValidHex(form.customBg))   { setError("배경색을 올바른 HEX 형식으로 입력하세요."); return; }
        if (!isValidHex(form.customText)) { setError("글자색을 올바른 HEX 형식으로 입력하세요."); return; }
      }
    } else {
      const hasImg = form.imageFile || form.imageKey || form.imageUrl || form.displayUrl;
      if (!hasImg) { setError("이미지를 선택하세요."); return; }
    }

    setSaving(true);
    try {
      let finalKey = form.imageKey;
      let finalUrl = form.imageUrl;

      // 새로 선택한 이미지 업로드
      if (form.bannerType === "image" && form.imageFile) {
        const res = await uploadImage(form.imageFile);
        if (!res) { setSaving(false); return; }
        finalKey = res.key;
        finalUrl = res.url;
      }

      const isImage = form.bannerType === "image";
      const finalColorTheme = (!isImage && form.colorMode === "custom")
        ? serializeCustomTheme(form.customBg, form.customText)
        : form.colorTheme;

      const body: any = {
        banner_type:     "strip",
        title:           isImage ? (form.title.trim() || "배너") : form.title.trim(),
        description:     isImage ? null : (form.description.trim() || null),
        image_url:       isImage ? (finalUrl || null) : null,
        image_key:       isImage ? (finalKey || null) : null,
        link_url:        form.linkUrl.trim() || null,
        link_label:      null,
        color_theme:     finalColorTheme,
        target:          "all",
        status:          form.status,
        display_start:   new Date(form.displayStart).toISOString(),
        display_end:     new Date(form.displayEnd).toISOString(),
        sort_order:      parseInt(form.sortOrder, 10) || 0,
        display_seconds: parseInt(form.displaySeconds, 10) || 15,
      };

      if (editId) {
        await api.put(`/super/banners/${editId}`, body);
      } else {
        const res = await api.post<{ banner: StripBanner }>("/super/banners", body);
        setEditId(res.banner?.id ?? null);
      }

      setSuccess(editId ? "수정되었습니다." : "등록되었습니다.");
      await load();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message ?? "저장 오류");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──
  async function handleDelete(id: string) {
    if (!window.confirm("이 배너를 삭제할까요? 복구 불가합니다.")) return;
    try {
      await api.delete(`/super/banners/${id}`);
      if (selectedId === id) {
        setSelectedId(null);
        setEditId(null);
        setForm(blankForm());
      }
      await load();
    } catch (e: any) { setError(e.message ?? "삭제 오류"); }
  }

  // ── Sort order ──
  async function moveOrder(id: string, dir: -1 | 1) {
    const sorted = [...banners];
    const idx = sorted.findIndex(b => b.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    try {
      await Promise.all([
        api.put(`/super/banners/${a.id}`, { ...a, sort_order: b.sort_order, banner_type: "strip", display_start: a.display_start, display_end: a.display_end }),
        api.put(`/super/banners/${b.id}`, { ...b, sort_order: a.sort_order, banner_type: "strip", display_start: b.display_start, display_end: b.display_end }),
      ]);
      await load();
    } catch (e: any) { setError(e.message ?? "순서 변경 오류"); }
  }

  const activeCount = banners.filter(b => b.status === "active" || b.status === "scheduled").length;
  const isEditing   = editId !== null || selectedId === null; // null selected = new form

  return (
    <div className="flex h-full min-h-0">
      {/* ── 좌: 배너 목록 ── */}
      <aside className="w-60 bg-white border-r border-[#e5e5e5] flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-[#e5e5e5] flex items-center justify-between">
          <div>
            <div className="text-[13px] font-bold text-[#111]">가로 배너</div>
            <div className="text-[11px] text-gray-400">{activeCount}/{MAX_SLIDES}개 활성</div>
          </div>
          <button
            onClick={startNew}
            className="w-7 h-7 rounded-full bg-[#002F5F] text-white text-[16px] flex items-center justify-center hover:bg-[#003f7d] transition"
            title="새 배너 추가"
          >+</button>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-[12px] text-gray-400 text-center">불러오는 중...</div>
        ) : banners.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="text-2xl mb-2">📢</div>
            <p className="text-[12px] text-gray-400">배너 없음</p>
            <button onClick={startNew} className="mt-3 text-[12px] text-[#002F5F] underline">첫 배너 추가</button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {banners.map((b, i) => {
              const cfg = STATUS_CFG[b.status as AdStatus] ?? STATUS_CFG.inactive;
              const isSelected = selectedId === b.id;
              return (
                <div
                  key={b.id}
                  className={`px-3 py-2.5 cursor-pointer border-b border-[#f5f5f7] transition ${
                    isSelected ? "bg-[#EFF6FF]" : "hover:bg-[#f9f9fb]"
                  }`}
                  onClick={() => selectBanner(b)}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
                    <span className="text-[12px] text-gray-400 w-4">{i + 1}</span>
                    <span className="text-[13px] font-semibold text-[#111] truncate flex-1">{b.title || "(이미지)"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 pl-4">
                    <span className="text-[11px] text-gray-400">{cfg.label}</span>
                    <span className="text-[10px] text-gray-300">·</span>
                    <span className="text-[11px] text-gray-400">순서 {b.sort_order}</span>
                  </div>
                  {isSelected && (
                    <div className="flex gap-1 mt-1.5 pl-4">
                      <button onClick={(e) => { e.stopPropagation(); moveOrder(b.id, -1); }}
                        disabled={i === 0}
                        className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">←</button>
                      <button onClick={(e) => { e.stopPropagation(); moveOrder(b.id, 1); }}
                        disabled={i === banners.length - 1}
                        className="text-[11px] px-1.5 py-0.5 border border-gray-200 rounded disabled:opacity-30 hover:bg-gray-50">→</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                        className="ml-auto text-[11px] px-1.5 py-0.5 border border-red-200 text-red-400 rounded hover:bg-red-50">삭제</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>

      {/* ── 우: 편집 폼 ── */}
      <div className="flex-1 overflow-y-auto bg-[#f5f5f7]">
        {!isEditing && selectedId === null && editId === null ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            배너를 선택하거나 + 버튼으로 추가하세요
          </div>
        ) : (
          <div className="max-w-2xl mx-auto py-6 px-6 space-y-4">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-[#111]">
                {editId ? "배너 수정" : "새 배너 등록"}
              </h2>
              {editId && (
                <button
                  onClick={() => { setSelectedId(null); setEditId(null); setForm(blankForm()); }}
                  className="text-[12px] text-gray-400 hover:text-gray-600"
                >✕ 닫기</button>
              )}
            </div>

            {/* 메시지 */}
            {error   && <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{error}</div>}
            {success && <div className="px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{success}</div>}

            {/* ── Preview ── */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-4">
              <div className="text-[11px] text-gray-400 mb-2">미리보기 (16:5 실제 비율)</div>
              <BannerPreview form={form} />
            </div>

            {/* ── 타입 선택 ── */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-4">
              <div className="text-[12px] font-semibold text-gray-600 mb-2">배너 타입</div>
              <div className="flex gap-2">
                {(["text","image"] as BannerType[]).map(t => (
                  <button key={t}
                    onClick={() => setForm(f => ({ ...f, bannerType: t }))}
                    className={`flex-1 py-2 text-sm rounded-lg border transition font-semibold ${
                      form.bannerType === t
                        ? "bg-[#002F5F] text-white border-[#002F5F]"
                        : "bg-white text-gray-500 border-gray-200 hover:border-[#002F5F]"
                    }`}
                  >
                    {t === "text" ? "📝 텍스트" : "🖼 이미지"}
                  </button>
                ))}
              </div>
            </div>

            {/* ── TEXT 입력 ── */}
            {form.bannerType === "text" && (
              <div className="bg-white rounded-xl border border-[#e5e5e5] p-4 space-y-4">
                {/* 제목 */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[12px] font-semibold text-gray-600">제목 *</label>
                    <span className={`text-[11px] ${form.title.length > TITLE_MAX ? "text-red-500" : "text-gray-400"}`}>
                      {form.title.length}/{TITLE_MAX}
                    </span>
                  </div>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value.replace(/\n/g, "") }))}
                    maxLength={TITLE_MAX}
                    placeholder="배너 제목"
                  />
                </div>

                {/* 설명 */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[12px] font-semibold text-gray-600">설명 (선택)</label>
                    <span className={`text-[11px] ${form.description.length > DESC_MAX ? "text-red-500" : "text-gray-400"}`}>
                      {form.description.length}/{DESC_MAX}
                    </span>
                  </div>
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F] resize-none"
                    rows={2}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    maxLength={DESC_MAX}
                    placeholder="부가 설명 (선택)"
                  />
                </div>

                {/* 색상 테마 */}
                <div>
                  <label className="text-[12px] font-semibold text-gray-600 mb-2 block">색상 테마</label>

                  {/* 빠른 색상 — 프리셋 */}
                  <p className="text-[11px] text-gray-400 mb-1.5">빠른 색상</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {BANNER_PRESET_KEYS.map(key => {
                      const preset = BANNER_PRESETS[key];
                      const accent = BANNER_PRESET_ACCENTS[key];
                      const isActive = form.colorMode === "preset" && form.colorTheme === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setForm(f => ({ ...f, colorTheme: key, colorMode: "preset" }))}
                          style={{
                            width: 34, height: 34, borderRadius: 8,
                            background: preset.bg,
                            border: isActive ? `2.5px solid ${accent}` : "1.5px solid #e2e8f0",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer",
                          }}
                          title={key}
                        >
                          <div style={{ width: 13, height: 13, borderRadius: "50%", background: accent }} />
                        </button>
                      );
                    })}
                  </div>

                  {/* 직접 색상 */}
                  <p className="text-[11px] text-gray-400 mb-1.5">직접 색상</p>
                  <div className="grid grid-cols-2 gap-3">
                    {/* 배경색 */}
                    <div>
                      <label className="text-[11px] text-gray-500 mb-1 block">배경색</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={isValidHex(form.customBg) ? form.customBg : "#1B3A5C"}
                          onChange={e => setForm(f => ({ ...f, customBg: e.target.value, colorMode: "custom" }))}
                          style={{ width: 36, height: 36, border: "none", cursor: "pointer", padding: 2, borderRadius: 6, background: "transparent" }}
                          title="배경색 선택"
                        />
                        <input
                          className={`flex-1 border rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 ${
                            form.colorMode === "custom" ? "ring-1 ring-[#7C3AED] border-[#7C3AED]" : "border-gray-200"
                          }`}
                          value={form.customBg}
                          onChange={e => {
                            const hex = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                            setForm(f => ({ ...f, customBg: hex, colorMode: "custom" }));
                          }}
                          placeholder="#1B3A5C"
                          maxLength={7}
                          onFocus={() => setForm(f => ({ ...f, colorMode: "custom" }))}
                        />
                      </div>
                    </div>

                    {/* 글자색 */}
                    <div>
                      <label className="text-[11px] text-gray-500 mb-1 block">글자색</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={isValidHex(form.customText) ? form.customText : "#FFFFFF"}
                          onChange={e => setForm(f => ({ ...f, customText: e.target.value, colorMode: "custom" }))}
                          style={{ width: 36, height: 36, border: "none", cursor: "pointer", padding: 2, borderRadius: 6, background: "transparent" }}
                          title="글자색 선택"
                        />
                        <input
                          className={`flex-1 border rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 ${
                            form.colorMode === "custom" ? "ring-1 ring-[#7C3AED] border-[#7C3AED]" : "border-gray-200"
                          }`}
                          value={form.customText}
                          onChange={e => {
                            const hex = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
                            setForm(f => ({ ...f, customText: hex, colorMode: "custom" }));
                          }}
                          placeholder="#FFFFFF"
                          maxLength={7}
                          onFocus={() => setForm(f => ({ ...f, colorMode: "custom" }))}
                        />
                      </div>
                    </div>
                  </div>

                  {/* 대비 경고 */}
                  {form.colorMode === "custom"
                    && isValidHex(form.customBg)
                    && isValidHex(form.customText)
                    && contrastRatio(form.customBg, form.customText) < 3.0 && (
                      <p className="text-[11px] text-amber-600 mt-2">⚠ 글자가 잘 보이지 않을 수 있습니다.</p>
                    )
                  }
                </div>
              </div>
            )}

            {/* ── IMAGE 업로드 ── */}
            {form.bannerType === "image" && (
              <div className="bg-white rounded-xl border border-[#e5e5e5] p-4 space-y-3">
                <div className="text-[12px] font-semibold text-gray-600">이미지 (16:5 비율 권장, 최대 8MB)</div>

                {(form.imageFile || form.imageKey || form.imageUrl || form.displayUrl) ? (
                  <div className="relative">
                    <img
                      src={form.imageFile
                        ? URL.createObjectURL(form.imageFile)
                        : (form.displayUrl || `${API_BASE}/uploads/${form.imageKey}` || form.imageUrl)}
                      alt="banner"
                      className="w-full rounded-lg border border-gray-200 object-cover"
                      style={{ aspectRatio: "16/5" }}
                    />
                    <button
                      onClick={() => setForm(f => ({ ...f, imageFile: null, imageKey: "", imageUrl: "", displayUrl: "" }))}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-xl text-gray-400 text-sm flex flex-col items-center justify-center gap-1 hover:border-[#002F5F] transition"
                    style={{ aspectRatio: "16/5" }}
                  >
                    <span className="text-2xl">+</span>
                    <span>이미지 선택</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="text-[12px] text-[#002F5F] underline"
                >
                  {(form.imageFile || form.imageKey) ? "이미지 변경" : "이미지 선택"}
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImageFile} />
              </div>
            )}

            {/* ── 공통 설정 ── */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-4 space-y-4">
              <div className="text-[12px] font-semibold text-gray-600">공통 설정</div>

              {/* 링크 */}
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">링크 URL (선택)</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                  value={form.linkUrl}
                  onChange={e => setForm(f => ({ ...f, linkUrl: e.target.value }))}
                  placeholder="https://..."
                />
              </div>

              {/* 노출 기간 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">시작일 *</label>
                  <input type="date"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.displayStart}
                    onChange={e => setForm(f => ({ ...f, displayStart: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">종료일 *</label>
                  <input type="date"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.displayEnd}
                    onChange={e => setForm(f => ({ ...f, displayEnd: e.target.value }))}
                  />
                </div>
              </div>

              {/* 전환 시간 + 순서 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">전환 시간 (초)</label>
                  <input type="number" min={3} max={60}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.displaySeconds}
                    onChange={e => setForm(f => ({ ...f, displaySeconds: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 mb-1 block">정렬 순서</label>
                  <input type="number" min={0}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.sortOrder}
                    onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                  />
                </div>
              </div>

              {/* 상태 */}
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block">상태</label>
                <div className="flex gap-2">
                  {(["scheduled","active","inactive"] as AdStatus[]).map(s => (
                    <button key={s}
                      onClick={() => setForm(f => ({ ...f, status: s }))}
                      className={`flex-1 py-1.5 text-sm rounded-lg border transition font-semibold ${
                        form.status === s
                          ? "bg-[#002F5F] text-white border-[#002F5F]"
                          : "bg-white text-gray-500 border-gray-200 hover:border-[#002F5F]"
                      }`}
                    >
                      {STATUS_CFG[s].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 저장 버튼 ── */}
            <div className="pb-6">
              <button
                onClick={handleSave}
                disabled={saving || uploading}
                className="w-full py-3 bg-[#002F5F] text-white text-sm font-bold rounded-xl hover:bg-[#003f7d] disabled:opacity-50 transition"
              >
                {saving || uploading ? "저장 중..." : editId ? "수정 완료" : "배너 등록"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
