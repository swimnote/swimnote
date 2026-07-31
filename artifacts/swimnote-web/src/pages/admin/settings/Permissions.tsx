import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { UserCog, Shield } from "lucide-react";

interface PermissionSetting { role: string; label: string; permissions: Record<string, boolean>; }

const PERMISSION_ITEMS = [
  { key: "view_revenue", label: "수입 조회" },
  { key: "manage_members", label: "회원 관리" },
  { key: "manage_classes", label: "수업 관리" },
  { key: "manage_notices", label: "공지 관리" },
  { key: "manage_attendance", label: "출석 관리" },
  { key: "view_settlement", label: "정산 조회" },
];

export default function Permissions() {
  const [settings, setSettings] = useState<PermissionSetting[]>([
    { role: "sub_admin", label: "부관리자", permissions: {} },
    { role: "teacher", label: "선생님", permissions: {} },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.get<any>("/admin/permissions").then(d => {
      if (d && Array.isArray(d)) setSettings(d);
      else if (d && d.settings) setSettings(d.settings);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function toggle(roleIdx: number, key: string) {
    setSettings(prev => prev.map((s, i) => i === roleIdx ? { ...s, permissions: { ...s.permissions, [key]: !s.permissions[key] } } : s));
  }

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await api.patch("/admin/permissions", { settings });
      setMsg({ text: "저장되었습니다.", ok: true });
    } catch (e: any) {
      setMsg({ text: e?.data?.message || "저장에 실패했습니다.", ok: false });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6"><div className="h-64 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" /></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">권한 설정</h1>
        <p className="text-[13px] text-[#999] mt-1">역할별 접근 권한을 설정합니다.</p>
      </div>
      <div className="space-y-4 mb-4">
        {settings.map((s, ri) => (
          <div key={s.role} className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={16} color="#0369A1" />
              <span className="font-bold text-[15px] text-[#0A0A0A]">{s.label}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {PERMISSION_ITEMS.map(p => (
                <label key={p.key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!s.permissions[p.key]} onChange={() => toggle(ri, p.key)}
                    className="w-4 h-4 rounded accent-[#0369A1]" />
                  <span className="text-[13px] font-medium text-[#333]">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      {msg && <p className={`text-[12px] font-medium mb-3 ${msg.ok ? "text-[#059669]" : "text-red-500"}`}>{msg.text}</p>}
      <button onClick={handleSave} disabled={saving} className="w-full py-3 rounded-xl text-white font-semibold text-[14px] disabled:opacity-60" style={{ background: "#0369A1" }}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}
