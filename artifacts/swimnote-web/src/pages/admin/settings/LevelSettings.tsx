import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Layers } from "lucide-react";
import { api } from "@/lib/api";

interface Level { id?: string; name: string; description?: string; order?: number; color?: string; }

export default function LevelSettings() {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", color: "#0369A1" });

  useEffect(() => {
    api.get<any>("/admin/level-settings").then(d => {
      setLevels(Array.isArray(d) ? d : d?.levels || []);
    }).catch(() => setLevels([])).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/admin/level-settings", { levels });
      setMsg({ text: "레벨 설정이 저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  function openAdd() { setEditIdx(null); setForm({ name: "", description: "", color: "#0369A1" }); setShowForm(true); }
  function openEdit(i: number) { const l = levels[i]; setEditIdx(i); setForm({ name: l.name, description: l.description || "", color: l.color || "#0369A1" }); setShowForm(true); }

  function handleFormSave() {
    if (!form.name.trim()) return;
    if (editIdx !== null) {
      setLevels(prev => prev.map((l, i) => i === editIdx ? { ...l, ...form } : l));
    } else {
      setLevels(prev => [...prev, { name: form.name, description: form.description, color: form.color }]);
    }
    setShowForm(false);
  }

  function removeLevel(i: number) { setLevels(prev => prev.filter((_, idx) => idx !== i)); }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">레벨 설정</h1>
          <p className="text-[13px] text-[#999] mt-1">수영 레벨을 설정합니다.</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
          <Plus size={16} /> 레벨 추가
        </button>
      </div>

      {levels.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center mb-4">
          <Layers size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">설정된 레벨이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-4">
          {levels.map((l, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#EBEBEB] px-5 py-3.5 flex items-center gap-4">
              <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: l.color || "#0369A1" }} />
              <div className="flex-1">
                <span className="font-semibold text-[14px] text-[#0A0A0A]">{l.name}</span>
                {l.description && <span className="text-[12px] text-[#999] ml-2">{l.description}</span>}
              </div>
              <button onClick={() => openEdit(i)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]"><Pencil size={13} color="#666" /></button>
              <button onClick={() => removeLevel(i)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]"><Trash2 size={13} color="#DC2626" /></button>
            </div>
          ))}
        </div>
      )}

      {msg && <p className={`text-[12px] font-medium mb-3 ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
      <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
        {saving ? "저장 중..." : "저장"}
      </button>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold mb-5">{editIdx !== null ? "레벨 수정" : "레벨 추가"}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">레벨 이름 *</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="예: 초급" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">설명</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="레벨 설명" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">색상</label>
                <div className="flex items-center gap-3">
                  <input type="color" className="w-10 h-10 rounded-lg border border-[#E5E5E5] cursor-pointer" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
                  <span className="text-[13px] text-[#666]">{form.color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleFormSave} disabled={!form.name.trim()} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
