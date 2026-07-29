import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function UnitPricing() {
  const { user } = useAuth();
  const poolId = (user as any)?.swimming_pool_id;
  const [form, setForm] = useState({ price_1: "", price_2: "", price_3: "", currency: "KRW" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!poolId) return;
    api.get<any>(`/pricing?pool_id=${poolId}`).then(d => {
      if (d) setForm({
        price_1: String(d.price_1 ?? d.weekly_1 ?? ""),
        price_2: String(d.price_2 ?? d.weekly_2 ?? ""),
        price_3: String(d.price_3 ?? d.weekly_3 ?? ""),
        currency: d.currency || "KRW",
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, [poolId]);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch(`/pricing/${poolId}`, {
        price_1: parseInt(form.price_1) || 0,
        price_2: parseInt(form.price_2) || 0,
        price_3: parseInt(form.price_3) || 0,
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
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">단가 설정</h1>
        <p className="text-[13px] text-[#999] mt-1">주 횟수별 수강료를 설정합니다.</p>
      </div>
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 space-y-5">
        {[
          { key: "price_1", label: "주 1회" },
          { key: "price_2", label: "주 2회" },
          { key: "price_3", label: "주 3회" },
        ].map(({ key, label }) => (
          <div key={key}>
            <label className="block text-[12px] font-semibold text-[#555] mb-1.5">{label}</label>
            <div className="flex items-center gap-2">
              <input type="number" className="w-40 px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]"
                value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder="0" />
              <span className="text-[13px] text-[#666]">원</span>
            </div>
          </div>
        ))}
        {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
        <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
