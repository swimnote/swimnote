import { useEffect, useState } from "react";
import { UserMinus, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";

interface Student { id: string; name: string; pool_status: string; class_group_id: string | null; phone?: string; }
interface ClassGroup { id: string; name: string; }

export default function PeoplePending() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ student: Student; classId: string } | null>(null);

  useEffect(() => {
    Promise.all([api.get<Student[]>("/students"), api.get<ClassGroup[]>("/class-groups")])
      .then(([st, cl]) => {
        setStudents((Array.isArray(st) ? st : []).filter(s => !s.class_group_id || s.pool_status === "unassigned"));
        setClasses(Array.isArray(cl) ? cl : []);
      }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleAssign() {
    if (!selected) return;
    setAssigning(selected.student.id);
    try {
      await api.patch(`/students/${selected.student.id}/assign`, { class_group_id: selected.classId });
      setStudents(prev => prev.filter(s => s.id !== selected.student.id));
      setSelected(null);
    } catch (e: any) { alert(e?.data?.message || "배정에 실패했습니다."); }
    finally { setAssigning(null); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">미배정 회원</h1>
        <p className="text-[13px] text-[#999] mt-1">수업에 배정되지 않은 회원 {students.length}명</p>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-white rounded-xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <UserMinus size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">미배정 회원이 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          {students.map((s, idx) => (
            <div key={s.id} className={`flex items-center gap-4 px-5 py-3.5 ${idx > 0 ? "border-t border-[#F9F9F9]" : ""}`}>
              <div className="flex-1">
                <p className="font-semibold text-[14px] text-[#0A0A0A]">{s.name}</p>
                {s.phone && <p className="text-[12px] text-[#999]">{s.phone}</p>}
              </div>
              <button onClick={() => setSelected({ student: s, classId: "" })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold" style={{ background: "#EFF6FF", color: "#0369A1" }}>
                수업 배정 <ChevronRight size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold mb-2">수업 배정</h2>
            <p className="text-[13px] text-[#666] mb-4"><b>{selected.student.name}</b>을(를) 배정할 수업을 선택하세요.</p>
            <select className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] mb-4"
              value={selected.classId} onChange={e => setSelected({ ...selected, classId: e.target.value })}>
              <option value="">수업 선택</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setSelected(null)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleAssign} disabled={!selected.classId || assigning === selected.student.id}
                className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
                {assigning ? "배정 중..." : "배정"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
