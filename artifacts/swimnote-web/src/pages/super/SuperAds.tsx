/**
 * SuperAds — 플랫폼 배너 광고 관리
 * platform_banners 기반 (banner_type='slider')
 * Parent Home carousel 배너 CRUD
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, authHeaders } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

interface Banner {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  image_key: string | null;
  link_url: string | null;
  link_label: string | null;
  color_theme: string;
  target: string;
  target_pool_id: string | null;
  status: string;
  display_start: string;
  display_end: string;
  sort_order: number;
  created_at: string;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  image_url: "",
  image_key: "",
  link_url: "",
  link_label: "",
  target: "all",
  target_pool_id: "",
  status: "inactive",
  display_start: "",
  display_end: "",
  sort_order: "0",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:    { label: "활성", cls: "bg-emerald-100 text-emerald-700" },
  scheduled: { label: "예약", cls: "bg-blue-100 text-blue-700" },
  inactive:  { label: "비활성", cls: "bg-gray-100 text-gray-500" },
};

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function imgSrc(b: Banner) {
  if (!b.image_key && !b.image_url) return null;
  if (b.image_url?.startsWith("http")) return b.image_url;
  if (b.image_key) return `${API_BASE}/uploads/${b.image_key}`;
  return null;
}

export default function SuperAds() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editBanner, setEditBanner] = useState<Banner | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ banners: Banner[] }>("/super/banners?banner_type=slider");
      setBanners(d.banners ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setEditBanner(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError(null);
  }

  function openEdit(b: Banner) {
    setEditBanner(b);
    setForm({
      title:          b.title,
      description:    b.description ?? "",
      image_url:      b.image_url ?? "",
      image_key:      b.image_key ?? "",
      link_url:       b.link_url ?? "",
      link_label:     b.link_label ?? "",
      target:         b.target,
      target_pool_id: b.target_pool_id ?? "",
      status:         b.status,
      display_start:  b.display_start ? b.display_start.slice(0, 16) : "",
      display_end:    b.display_end   ? b.display_end.slice(0, 16)   : "",
      sort_order:     String(b.sort_order),
    });
    setFormOpen(true);
    setError(null);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadingImg(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("images", files[0]);
      const r = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "업로드 실패");
      const key: string = d.urls?.[0] ?? "";
      setForm((p) => ({ ...p, image_key: key, image_url: `${API_BASE}/uploads/${key}` }));
    } catch (e: any) {
      setError(e.message ?? "업로드 오류");
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim())                    { setError("제목을 입력하세요."); return; }
    if (!form.display_start || !form.display_end) { setError("노출 기간을 설정하세요."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body: any = {
        banner_type:   "slider",
        title:         form.title.trim(),
        description:   form.description.trim() || null,
        image_url:     form.image_url || null,
        image_key:     form.image_key || null,
        link_url:      form.link_url.trim() || null,
        link_label:    form.link_label.trim() || null,
        color_theme:   "teal",
        target:        form.target,
        target_pool_id: form.target_pool_id.trim() || null,
        status:        form.status,
        display_start: new Date(form.display_start).toISOString(),
        display_end:   new Date(form.display_end).toISOString(),
        sort_order:    parseInt(form.sort_order, 10) || 0,
      };
      if (editBanner) {
        await api.put(`/super/banners/${editBanner.id}`, body);
      } else {
        await api.post("/super/banners", body);
      }
      setSuccessMsg(editBanner ? "배너가 수정되었습니다." : "배너가 등록되었습니다.");
      setFormOpen(false);
      await load();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message ?? "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(b: Banner) {
    const next = b.status === "active" ? "inactive" : "active";
    try {
      await api.patch(`/super/banners/${b.id}/status`, { status: next });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("이 배너를 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/super/banners/${id}`);
      setSuccessMsg("삭제되었습니다.");
      await load();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#111]">광고 배너 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">Parent Home 캐러셀 배너 (PARENT_HOME_BANNER 슬롯)</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-[#002F5F] text-white text-sm font-semibold rounded-lg hover:bg-[#003f7d] transition"
        >
          + 새 배너
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{successMsg}</div>
      )}
      {error && !formOpen && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm">{error}</div>
      )}

      {/* 폼 모달 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-[15px]">{editBanner ? "배너 수정" : "새 배너 등록"}</h2>
              <button onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded text-sm">{error}</div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">제목 * (최대 100자)</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  maxLength={100}
                  placeholder="배너 제목"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">설명</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F] resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="배너 본문 설명"
                />
              </div>

              {/* 이미지 업로드 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">이미지 (권장 720×240px)</label>
                <div className="flex items-center gap-3">
                  {form.image_key ? (
                    <div className="relative w-32 h-20 rounded-lg overflow-hidden border">
                      <img src={`${API_BASE}/uploads/${form.image_key}`} alt="banner" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setForm((p) => ({ ...p, image_url: "", image_key: "" }))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                      >✕</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImg}
                      className="w-32 h-20 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-xs flex flex-col items-center justify-center gap-1 hover:border-[#002F5F] transition"
                    >
                      {uploadingImg ? "업로드 중..." : <><span className="text-xl">+</span>이미지</>}
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">링크 URL</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    value={form.link_url}
                    onChange={(e) => setForm((p) => ({ ...p, link_url: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">링크 레이블</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                    value={form.link_label}
                    onChange={(e) => setForm((p) => ({ ...p, link_label: e.target.value }))}
                    placeholder="자세히 보기"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">노출 시작 *</label>
                  <input type="datetime-local"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.display_start}
                    onChange={(e) => setForm((p) => ({ ...p, display_start: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">노출 종료 *</label>
                  <input type="datetime-local"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.display_end}
                    onChange={(e) => setForm((p) => ({ ...p, display_end: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">대상</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.target} onChange={(e) => setForm((p) => ({ ...p, target: e.target.value }))}>
                    <option value="all">전체</option>
                    <option value="parent">학부모</option>
                    <option value="teacher">선생님</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">상태</label>
                  <select className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="inactive">비활성</option>
                    <option value="scheduled">예약</option>
                    <option value="active">활성</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">정렬 순서</label>
                  <input type="number" min={0} max={999}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={form.sort_order}
                    onChange={(e) => setForm((p) => ({ ...p, sort_order: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">특정 수영장 ID (빈칸=전체)</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                  value={form.target_pool_id}
                  onChange={(e) => setForm((p) => ({ ...p, target_pool_id: e.target.value }))}
                  placeholder="pool_xxxxxxxx (빈칸이면 전체 대상)"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t">
                <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-gray-600">취소</button>
                <button
                  type="submit"
                  disabled={submitting || uploadingImg}
                  className="px-5 py-2 bg-[#002F5F] text-white text-sm font-semibold rounded-lg hover:bg-[#003f7d] disabled:opacity-50"
                >
                  {submitting ? "저장 중..." : editBanner ? "수정 저장" : "배너 등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 배너 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : banners.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          <div className="text-2xl mb-2">📢</div>
          <p>등록된 배너가 없습니다.</p>
          <p className="text-xs mt-1">배너를 등록하면 학부모 홈 화면에 캐러셀로 표시됩니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {banners.map((b) => {
            const st = STATUS_BADGE[b.status] ?? { label: b.status, cls: "bg-gray-100 text-gray-500" };
            const src = imgSrc(b);
            return (
              <div key={b.id} className="bg-white border rounded-xl p-4 shadow-sm flex gap-4 items-start">
                {src && (
                  <img src={src} alt="banner"
                    className="w-28 h-18 object-cover rounded-lg border shrink-0"
                    style={{ height: 72 }}
                    onError={(e: any) => { e.target.style.display = "none"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-[14px] text-[#111]">{b.title}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">순서 {b.sort_order}</span>
                    {b.target_pool_id && (
                      <span className="text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded">풀 지정</span>
                    )}
                  </div>
                  {b.description && <p className="text-sm text-gray-600 mb-1 line-clamp-1">{b.description}</p>}
                  <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                    <span>노출: {fmtDt(b.display_start)} ~ {fmtDt(b.display_end)}</span>
                    <span>대상: {b.target}</span>
                    {b.link_url && (
                      <a href={b.link_url} target="_blank" rel="noreferrer"
                        className="text-blue-400 hover:underline truncate max-w-[180px]">
                        {b.link_url}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => toggleStatus(b)}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded border transition ${
                      b.status === "active"
                        ? "border-amber-300 text-amber-600 hover:bg-amber-50"
                        : "border-emerald-300 text-emerald-600 hover:bg-emerald-50"
                    }`}
                  >
                    {b.status === "active" ? "비활성화" : "활성화"}
                  </button>
                  <button onClick={() => openEdit(b)}
                    className="text-[12px] text-[#002F5F] border border-[#002F5F]/30 px-3 py-1.5 rounded hover:bg-[#002F5F]/5">
                    수정
                  </button>
                  <button onClick={() => handleDelete(b.id)}
                    className="text-[12px] text-red-400 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50">
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
