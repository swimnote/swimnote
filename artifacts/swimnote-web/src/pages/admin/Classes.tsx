import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Users, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface ClassGroup {
  id: string;
  name: string;
  schedule_days: string;
  schedule_time: string;
  capacity: number;
  current_members: number;
  instructor: string;
  teacher_user_id: string | null;
  level?: string;
}

const DAYS_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

function dayStr(days: string) {
  return (days || "").split(",").map(d => DAYS_KO[d.trim()] || d).join("");
}

interface FormData {
  name: string;
  schedule_days: string;
  schedule_time: string;
  capacity: string;
  instructor: string;
}

const EMPTY_FORM: FormData = { name: "", schedule_days: "", schedule_time: "", capacity: "20", instructor: "" };
const DAY_OPTIONS = [
  { key: "mon", label: "월" }, { key: "tue", label: "화" }, { key: "wed", label: "수" },
  { key: "thu", label: "목" }, { key: "fri", label: "금" }, { key: "sat", label: "토" }, { key: "sun", label: "일" },
];

export default function Classes() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ClassGroup | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<ClassGroup[]>("/class-groups");
      setClasses(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setShowForm(true);
  }

  function openEdit(c: ClassGroup) {
    setEditing(c);
    setForm({ name: c.name, schedule_days: c.schedule_days || "", schedule_time: c.schedule_time || "", capacity: String(c.capacity || 20), instructor: c.instructor || "" });
    setError("");
    setShowForm(true);
  }

  function toggleDay(key: string) {
    const parts = form.schedule_days ? form.schedule_days.split(",").map(s => s.trim()).filter(Boolean) : [];
    const next = parts.includes(key) ? parts.filter(d => d !== key) : [...parts, key];
    setForm(f => ({ ...f, schedule_days: next.join(",") }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setError("수업 이름을 입력해주세요."); return; }
    setSaving(true); setError("");
    try {
      const body = { name: form.name.trim(), schedule_days: form.schedule_days, schedule_time: form.schedule_time, capacity: parseInt(form.capacity) || 20, instructor: form.instructor.trim() };
      if (editing) {
        await api.patch(`/class-groups/${editing.id}`, body);
        setClasses(prev => prev.map(c => c.id === editing.id ? { ...c, ...body } : c));
      } else {
        const created = await api.post<ClassGroup>("/class-groups", body);
        setClasses(prev => [created, ...prev]);
      }
      setShowForm(false);
    } catch (e: any) {
      setError(e?.data?.message || e?.data?.error || "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function handleDelete(c: ClassGroup) {
    if (!confirm(`"${c.name}" 수업을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/class-groups/${c.id}`);
      setClasses(prev => prev.filter(cl => cl.id !== c.id));
    } catch (e: any) {
      alert(e?.data?.message || "삭제에 실패했습니다.");
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">수업 목록</h1>
          <p className="text-[13px] text-[#999] mt-1">수업을 추가, 수정, 삭제할 수 있습니다.</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
          <Plus size={16} /> 수업 추가
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}
        </div>
      ) : classes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <p className="text-[#999] text-[14px]">등록된 수업이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {classes.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-[#EBEBEB] px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[15px] text-[#0A0A0A]">{c.name}</span>
                  {c.instructor && <span className="text-[11px] bg-[#EFF6FF] text-[#0369A1] px-2 py-0.5 rounded-full font-medium">{c.instructor}</span>}
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[12px] text-[#999]">
                  {c.schedule_days && (
                    <span className="flex items-center gap-1"><Clock size={12} /> {dayStr(c.schedule_days)} {c.schedule_time}</span>
                  )}
                  <span className="flex items-center gap-1"><Users size={12} /> {c.current_members ?? 0} / {c.capacity ?? 0}명</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(c)} className="p-2 rounded-lg hover:bg-[#F5F5F5] transition-colors">
                  <Pencil size={15} color="#666" />
                </button>
                <button onClick={() => handleDelete(c)} className="p-2 rounded-lg hover:bg-[#FEF2F2] transition-colors">
                  <Trash2 size={15} color="#DC2626" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 폼 모달 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold text-[#0A0A0A] mb-5">{editing ? "수업 수정" : "수업 추가"}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 이름 *</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="예: 초급반 A" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 요일</label>
                <div className="flex gap-2 flex-wrap">
                  {DAY_OPTIONS.map(d => {
                    const selected = (form.schedule_days || "").split(",").map(s => s.trim()).includes(d.key);
                    return (
                      <button key={d.key} onClick={() => toggleDay(d.key)}
                        className={`w-9 h-9 rounded-lg text-[13px] font-semibold border transition-colors ${selected ? "border-[#0369A1] bg-[#EFF6FF] text-[#0369A1]" : "border-[#E5E5E5] text-[#666]"}`}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 시간</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.schedule_time} onChange={e => setForm(f => ({ ...f, schedule_time: e.target.value }))} placeholder="예: 06:00 ~ 07:00" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">정원</label>
                <input type="number" className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">담당 선생님</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={form.instructor} onChange={e => setForm(f => ({ ...f, instructor: e.target.value }))} placeholder="이름 입력" />
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
