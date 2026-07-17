import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Megaphone, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";

interface Notice {
  id: string;
  title: string;
  content: string;
  target: string;
  created_at: string;
  author_name?: string;
}

const TARGET_LABELS: Record<string, string> = {
  all: "전체", parent: "학부모", teacher: "선생님", admin: "관리자",
};

export default function Notices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Notice | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "", target: "all" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<Notice[]>("/notices");
      setNotices(Array.isArray(data) ? data : []);
    } catch { setNotices([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null); setForm({ title: "", content: "", target: "all" }); setError(""); setShowForm(true);
  }

  function openEdit(n: Notice) {
    setEditing(n); setForm({ title: n.title, content: n.content, target: n.target || "all" }); setError(""); setShowForm(true);
  }

  async function handleSave() {
    if (!form.title.trim()) { setError("제목을 입력해주세요."); return; }
    if (!form.content.trim()) { setError("내용을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      if (editing) {
        await api.patch(`/notices/${editing.id}`, form);
      } else {
        await api.post("/notices", form);
      }
      setShowForm(false); await load();
    } catch (e: any) {
      setError(e?.data?.message || "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string, title: string) {
    if (!confirm(`"${title}" 공지를 삭제하시겠습니까?`)) return;
    try { await api.delete(`/notices/${id}`); setNotices(prev => prev.filter(n => n.id !== id)); }
    catch (e: any) { alert(e?.data?.message || "삭제에 실패했습니다."); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">공지사항</h1>
          <p className="text-[13px] text-[#999] mt-1">학부모·선생님에게 공지를 보낼 수 있습니다.</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
          <Plus size={16} /> 공지 작성
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : notices.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <Megaphone size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">작성된 공지가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notices.map(n => {
            const open = expanded === n.id;
            return (
              <div key={n.id} className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
                <button className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[#FAFAFA]" onClick={() => setExpanded(open ? null : n.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[14px] text-[#0A0A0A]">{n.title}</span>
                      <span className="text-[11px] bg-[#EFF6FF] text-[#0369A1] px-2 py-0.5 rounded-full">{TARGET_LABELS[n.target] || n.target}</span>
                    </div>
                    <p className="text-[12px] text-[#999] mt-1">{n.created_at?.slice(0, 10)} {n.author_name && `· ${n.author_name}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={ev => { ev.stopPropagation(); openEdit(n); }} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]"><Pencil size={13} color="#666" /></button>
                    <button onClick={ev => { ev.stopPropagation(); handleDelete(n.id, n.title); }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]"><Trash2 size={13} color="#DC2626" /></button>
                    {open ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                  </div>
                </button>
                {open && (
                  <div className="px-5 pb-5 border-t border-[#F5F5F5]">
                    <p className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap mt-4">{n.content}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-[16px] font-bold mb-5">{editing ? "공지 수정" : "공지 작성"}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">제목 *</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">대상</label>
                <select className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))}>
                  <option value="all">전체</option>
                  <option value="parent">학부모</option>
                  <option value="teacher">선생님</option>
                </select>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">내용 *</label>
                <textarea rows={6} className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] resize-none" value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
              </div>
            </div>
            {error && <p className="text-[12px] text-red-500 mt-3">{error}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
