import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Palette } from "lucide-react";

const PRESET_COLORS = ["#0369A1", "#059669", "#7C3AED", "#DC2626", "#D97706", "#0891B2", "#1D4ED8", "#374151"];

export default function Branding() {
  const [form, setForm] = useState({ app_name: "", theme_color: "#0369A1", logo_url: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.get<any>("/admin/branding").then(d => {
      if (d) setForm({ app_name: d.app_name || "", theme_color: d.theme_color || "#0369A1", logo_url: d.logo_url || "" });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/admin/branding", form);
      setMsg({ text: "브랜딩 설정이 저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6"><div className="h-48 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">브랜딩</h1>
        <p className="text-[13px] text-[#999] mt-1">앱 이름과 테마 색상을 설정합니다.</p>
      </div>
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 space-y-6">
        <div>
          <label className="block text-[12px] font-semibold text-[#555] mb-1.5">앱 이름 (학부모 앱에 표시)</label>
          <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]"
            value={form.app_name} onChange={e => setForm(f => ({ ...f, app_name: e.target.value }))} placeholder="예: 해피수영장" />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-[#555] mb-3">테마 색상</label>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, theme_color: c }))}
                className={`w-8 h-8 rounded-full border-2 transition-all ${form.theme_color === c ? "border-[#0A0A0A] scale-110" : "border-transparent"}`}
                style={{ background: c }} />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input type="color" className="w-10 h-10 rounded-lg border border-[#E5E5E5] cursor-pointer"
              value={form.theme_color} onChange={e => setForm(f => ({ ...f, theme_color: e.target.value }))} />
            <span className="text-[13px] text-[#666]">직접 선택: {form.theme_color}</span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: form.theme_color }}>
              <Palette size={18} color="#fff" />
            </div>
            <span className="text-[12px] text-[#999]">미리보기</span>
          </div>
        </div>
        {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
        <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
