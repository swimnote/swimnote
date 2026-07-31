import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function ClassCapacity() {
  const [form, setForm] = useState({ default_capacity: "20", min_capacity: "5", max_capacity: "50", auto_open: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.get<any>("/admin/class-settings").then(d => {
      if (d) setForm({
        default_capacity: String(d.default_capacity ?? 20),
        min_capacity: String(d.min_capacity ?? 5),
        max_capacity: String(d.max_capacity ?? 50),
        auto_open: d.auto_open ?? false,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/admin/class-settings", {
        default_capacity: parseInt(form.default_capacity),
        min_capacity: parseInt(form.min_capacity),
        max_capacity: parseInt(form.max_capacity),
        auto_open: form.auto_open,
      });
      setMsg({ text: "저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6"><div className="h-48 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">수업 정원</h1>
        <p className="text-[13px] text-[#999] mt-1">수업 기본 정원을 설정합니다.</p>
      </div>
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 space-y-5">
        {[
          { key: "default_capacity", label: "기본 정원", unit: "명" },
          { key: "min_capacity", label: "최소 정원", unit: "명" },
          { key: "max_capacity", label: "최대 정원", unit: "명" },
        ].map(({ key, label, unit }) => (
          <div key={key}>
            <label className="block text-[12px] font-semibold text-[#555] mb-1.5">{label}</label>
            <div className="flex items-center gap-2">
              <input type="number" className="w-32 px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]"
                value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              <span className="text-[13px] text-[#666]">{unit}</span>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <input type="checkbox" id="auto_open" checked={form.auto_open} onChange={e => setForm(f => ({ ...f, auto_open: e.target.checked }))}
            className="w-4 h-4 rounded accent-[#0369A1]" />
          <label htmlFor="auto_open" className="text-[13px] font-medium text-[#333]">정원 초과 시 자동 대기 등록</label>
        </div>
        {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
        <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
