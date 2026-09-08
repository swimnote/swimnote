/**
 * SuperNotices — 플랫폼 공지 관리
 * GET/POST/DELETE /super/marketing/notices (audience_scope='global')
 * 이미지 업로드: POST /uploads (최대 5장)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, authHeaders } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

interface Notice {
  id: string;
  title: string;
  content: string;
  notice_type: string;
  send_push: boolean;
  show_banner: boolean;
  starts_at: string | null;
  ends_at: string | null;
  deep_link: string | null;
  image_urls: string[] | null;
  push_sent_at: string | null;
  created_at: string;
  author_name: string | null;
}

const EMPTY_FORM = {
  title: "",
  content: "",
  send_push: true,
  show_banner: false,
  starts_at: "",
  ends_at: "",
  deep_link: "",
  image_urls: [] as string[],
};

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Badge({ v, label }: { v: boolean; label: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${v ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-400"}`}>
      {label}
    </span>
  );
}

export default function SuperNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ notices: Notice[] }>("/super/marketing/notices?limit=100");
      setNotices(d.notices ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError(null);
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (form.image_urls.length + files.length > 5) {
      setError("이미지는 최대 5장까지 첨부 가능합니다."); return;
    }
    setUploadingImg(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("images", f));
      const r = await fetch(`${API_BASE}/uploads`, {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "업로드 실패");
      setForm((prev) => ({ ...prev, image_urls: [...prev.image_urls, ...(d.urls ?? [])].slice(0, 5) }));
    } catch (e: any) {
      setError(e.message ?? "업로드 오류");
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeImage(idx: number) {
    setForm((prev) => ({ ...prev, image_urls: prev.image_urls.filter((_, i) => i !== idx) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) { setError("제목과 내용을 입력하세요."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body: any = {
        title:       form.title.trim(),
        content:     form.content.trim(),
        send_push:   form.send_push,
        show_banner: form.show_banner,
        target_all:  true,
        image_urls:  form.image_urls,
      };
      if (form.starts_at) body.starts_at = form.starts_at;
      if (form.ends_at)   body.ends_at   = form.ends_at;
      if (form.deep_link.trim()) body.deep_link = form.deep_link.trim();
      await api.post("/super/marketing/notices", body);
      setSuccessMsg("공지가 등록되었습니다.");
      setFormOpen(false);
      await load();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message ?? "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
      await api.delete(`/super/marketing/notices/${id}`);
      setSuccessMsg("삭제되었습니다.");
      await load();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#111]">공지 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 수영장 대상 글로벌 공지 (audience_scope=global)</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-[#002F5F] text-white text-sm font-semibold rounded-lg hover:bg-[#003f7d] transition"
        >
          + 새 공지
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 px-4 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* 폼 모달 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-[15px]">새 공지 작성</h2>
              <button onClick={() => setFormOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="px-4 py-2 bg-red-50 border border-red-200 text-red-600 rounded text-sm">{error}</div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">제목 *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="공지 제목"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">내용 *</label>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F] resize-none"
                  rows={5}
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  placeholder="공지 내용"
                />
              </div>

              {/* 이미지 업로드 */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">이미지 (최대 5장)</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {form.image_urls.map((key, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border">
                      <img
                        src={`${API_BASE}/uploads/${key}`}
                        alt={`img${i}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                      >✕</button>
                    </div>
                  ))}
                  {form.image_urls.length < 5 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImg}
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 text-xs flex flex-col items-center justify-center gap-1 hover:border-[#002F5F] transition"
                    >
                      {uploadingImg ? "..." : <><span className="text-xl">+</span>사진</>}
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={handleImageUpload} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">노출 시작일</label>
                  <input type="datetime-local"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                    value={form.starts_at}
                    onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">노출 종료일</label>
                  <input type="datetime-local"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                    value={form.ends_at}
                    onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">딥링크 (선택)</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#002F5F]"
                  value={form.deep_link}
                  onChange={(e) => setForm((p) => ({ ...p, deep_link: e.target.value }))}
                  placeholder="예: swimnote://subscription"
                />
              </div>

              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.send_push} onChange={(e) => setForm((p) => ({ ...p, send_push: e.target.checked }))} />
                  <span>푸시 발송</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.show_banner} onChange={(e) => setForm((p) => ({ ...p, show_banner: e.target.checked }))} />
                  <span>배너 표시</span>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t">
                <button type="button" onClick={() => setFormOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">취소</button>
                <button
                  type="submit"
                  disabled={submitting || uploadingImg}
                  className="px-5 py-2 bg-[#002F5F] text-white text-sm font-semibold rounded-lg hover:bg-[#003f7d] disabled:opacity-50"
                >
                  {submitting ? "등록 중..." : "공지 등록"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 공지 목록 */}
      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
      ) : notices.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">등록된 공지가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => (
            <div key={n.id} className="bg-white border rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-[14px] text-[#111]">{n.title}</span>
                    <Badge v={n.send_push} label="푸시" />
                    <Badge v={n.show_banner} label="배너" />
                    {n.push_sent_at && (
                      <span className="text-[11px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">발송 완료</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2 mb-2">{n.content}</p>
                  <div className="flex gap-3 text-[11px] text-gray-400 flex-wrap">
                    <span>작성: {n.author_name ?? "—"}</span>
                    <span>등록: {fmtDt(n.created_at)}</span>
                    {n.starts_at && <span>노출: {fmtDt(n.starts_at)} ~ {fmtDt(n.ends_at)}</span>}
                  </div>
                  {n.image_urls && n.image_urls.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {n.image_urls.map((key, i) => (
                        <img
                          key={i}
                          src={`${API_BASE}/uploads/${key}`}
                          alt={`img${i}`}
                          className="w-14 h-14 object-cover rounded-lg border"
                          onError={(e: any) => { e.target.style.display = "none"; }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(n.id)}
                  className="text-[12px] text-red-400 hover:text-red-600 shrink-0 border border-red-200 rounded px-2 py-1"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
