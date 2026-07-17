import { useEffect, useState } from "react";
import { Plus, Trash2, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";

interface DiaryTemplate { id?: string; level_name: string; items: string[]; }

export default function DiaryTemplates() {
  const [templates, setTemplates] = useState<DiaryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);

  useEffect(() => {
    api.get<any>("/admin/diary-templates").then(d => {
      setTemplates(Array.isArray(d) ? d : d?.templates || []);
    }).catch(() => setTemplates([])).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/admin/diary-templates", { templates });
      setMsg({ text: "저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  function addItem(ti: number) {
    setTemplates(prev => prev.map((t, i) => i === ti ? { ...t, items: [...t.items, ""] } : t));
  }
  function updateItem(ti: number, ii: number, val: string) {
    setTemplates(prev => prev.map((t, i) => i === ti ? { ...t, items: t.items.map((it, j) => j === ii ? val : it) } : t));
  }
  function removeItem(ti: number, ii: number) {
    setTemplates(prev => prev.map((t, i) => i === ti ? { ...t, items: t.items.filter((_, j) => j !== ii) } : t));
  }
  function addTemplate() {
    setTemplates(prev => [...prev, { level_name: "새 레벨", items: [] }]);
    setExpanded(templates.length);
  }
  function removeTemplate(i: number) {
    setTemplates(prev => prev.filter((_, idx) => idx !== i));
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">일지 템플릿</h1>
          <p className="text-[13px] text-[#999] mt-1">레벨별 수업 일지 항목을 설정합니다.</p>
        </div>
        <button onClick={addTemplate} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
          <Plus size={16} /> 템플릿 추가
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center mb-4">
          <FileText size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">등록된 템플릿이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          {templates.map((t, ti) => {
            const open = expanded === ti;
            return (
              <div key={ti} className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
                <button className="w-full flex items-center gap-3 px-5 py-4 text-left" onClick={() => setExpanded(open ? null : ti)}>
                  <div className="flex-1">
                    <input className="font-semibold text-[14px] bg-transparent focus:outline-none w-full" value={t.level_name}
                      onChange={e => setTemplates(prev => prev.map((tp, i) => i === ti ? { ...tp, level_name: e.target.value } : tp))}
                      onClick={ev => ev.stopPropagation()} />
                    {!open && <p className="text-[12px] text-[#999] mt-0.5">항목 {t.items.length}개</p>}
                  </div>
                  <button onClick={ev => { ev.stopPropagation(); removeTemplate(ti); }} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]"><Trash2 size={13} color="#DC2626" /></button>
                  {open ? <ChevronUp size={16} color="#999" /> : <ChevronDown size={16} color="#999" />}
                </button>
                {open && (
                  <div className="px-5 pb-5 border-t border-[#F5F5F5]">
                    <div className="space-y-2 mt-4">
                      {t.items.map((item, ii) => (
                        <div key={ii} className="flex items-center gap-2">
                          <input className="flex-1 px-3 py-2 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]"
                            value={item} onChange={e => updateItem(ti, ii, e.target.value)} placeholder={`항목 ${ii + 1}`} />
                          <button onClick={() => removeItem(ti, ii)} className="p-1.5 rounded-lg hover:bg-[#FEF2F2]"><Trash2 size={13} color="#DC2626" /></button>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => addItem(ti)} className="mt-3 flex items-center gap-1.5 text-[12px] font-semibold text-[#0369A1]">
                      <Plus size={14} /> 항목 추가
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && <p className={`text-[12px] font-medium mb-3 ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
      <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}
