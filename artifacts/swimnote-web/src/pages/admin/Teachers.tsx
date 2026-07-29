import { useEffect, useState } from "react";
import { UserCheck, Trash2, Mail, Phone } from "lucide-react";
import { api } from "@/lib/api";

interface Teacher {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role?: string;
  class_count?: number;
  status?: string;
}

export default function Teachers() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<any>("/admin/teachers");
      const list = Array.isArray(data) ? data : data?.teachers || [];
      setTeachers(list);
    } catch { setTeachers([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(t: Teacher) {
    if (!confirm(`"${t.name}" 선생님을 삭제하시겠습니까?`)) return;
    setDeletingId(t.id);
    try {
      await api.delete(`/teachers/${t.id}`);
      setTeachers(prev => prev.filter(m => m.id !== t.id));
    } catch (e: any) {
      alert(e?.data?.message || "삭제에 실패했습니다.");
    } finally { setDeletingId(null); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">선생님 목록</h1>
        <p className="text-[13px] text-[#999] mt-1">등록된 선생님 {teachers.length}명</p>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : teachers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <UserCheck size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">등록된 선생님이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {teachers.map(t => (
            <div key={t.id} className="bg-white rounded-2xl border border-[#EBEBEB] p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                <span className="text-[14px] font-bold text-[#0369A1]">{t.name?.[0] || "T"}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[14px] text-[#0A0A0A]">{t.name}</span>
                  {t.role && <span className="text-[11px] bg-[#F3F4F6] text-[#666] px-2 py-0.5 rounded-full">{t.role === "teacher" ? "선생님" : t.role}</span>}
                </div>
                <div className="flex flex-col gap-1 mt-1.5">
                  {t.email && (
                    <span className="flex items-center gap-1.5 text-[12px] text-[#999]">
                      <Mail size={12} /> {t.email}
                    </span>
                  )}
                  {t.phone && (
                    <span className="flex items-center gap-1.5 text-[12px] text-[#999]">
                      <Phone size={12} /> {t.phone}
                    </span>
                  )}
                  {t.class_count !== undefined && (
                    <span className="text-[12px] text-[#BBB]">담당 수업 {t.class_count}개</span>
                  )}
                </div>
              </div>
              <button onClick={() => handleDelete(t)} disabled={deletingId === t.id}
                className="p-1.5 rounded-lg hover:bg-[#FEF2F2] disabled:opacity-40">
                <Trash2 size={14} color="#DC2626" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
