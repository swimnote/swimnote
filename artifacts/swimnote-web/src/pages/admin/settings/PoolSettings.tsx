import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export default function PoolSettings() {
  const { user } = useAuth();
  const poolId = (user as any)?.swimming_pool_id;
  const [form, setForm] = useState({ name: "", name_en: "", address: "", intro: "", phone: "" });
  const [content, setContent] = useState({ intro: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<any>("/pools/settings"),
      api.get<any>("/pools/content").catch(() => null),
    ]).then(([s, c]) => {
      setForm({ name: s?.name || "", name_en: s?.name_en || "", address: s?.address || "", intro: s?.intro || "", phone: s?.phone || "" });
      if (c) setContent({ intro: c.intro || "" });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/pools/settings", form);
      if (content.intro) await api.patch("/pools/content", content).catch(() => {});
      setMsg({ text: "저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">수영장 정보</h1>
        <p className="text-[13px] text-[#999] mt-1">수영장 기본 정보를 수정합니다.</p>
      </div>
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-6 space-y-5">
        {[
          { key: "name", label: "수영장 이름 *", placeholder: "수영장 이름" },
          { key: "name_en", label: "영문 이름 (URL)", placeholder: "예: mypool" },
          { key: "address", label: "주소", placeholder: "수영장 주소" },
          { key: "phone", label: "연락처", placeholder: "02-0000-0000" },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-[12px] font-semibold text-[#555] mb-1.5">{label}</label>
            <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]"
              value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder} />
          </div>
        ))}
        <div>
          <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수영장 소개</label>
          <textarea rows={4} className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] resize-none"
            value={content.intro} onChange={e => setContent(c => ({ ...c, intro: e.target.value }))} placeholder="수영장 소개글을 입력하세요" />
        </div>
        {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
        <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
