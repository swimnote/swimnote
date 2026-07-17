import { useEffect, useState, useMemo } from "react";
import { Search, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { api } from "@/lib/api";

interface Student {
  id: string;
  name: string;
  pool_status: string;
  class_group_id: string | null;
  class_name?: string;
  weekly_count?: number;
  parent_linked?: boolean;
  phone?: string;
}

interface ClassGroup { id: string; name: string; }

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  normal:            { label: "정상",     color: "#059669", bg: "#DCFCE7" },
  unassigned:        { label: "미배정",   color: "#D97706", bg: "#FEF9C3" },
  suspended:         { label: "연기",     color: "#7C3AED", bg: "#EDE9FE" },
  pending_suspended: { label: "연기예정", color: "#7C3AED", bg: "#EDE9FE" },
  withdrawn:         { label: "퇴원",     color: "#DC2626", bg: "#FEE2E2" },
  pending_withdrawn: { label: "퇴원예정", color: "#DC2626", bg: "#FEE2E2" },
};

const FILTERS = [
  { key: "all",     label: "전체" },
  { key: "normal",  label: "정상" },
  { key: "unassigned", label: "미배정" },
  { key: "suspended", label: "연기" },
];

export default function Members() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", phone: "", class_group_id: "" });
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [st, cl] = await Promise.all([
        api.get<Student[]>("/students"),
        api.get<ClassGroup[]>("/class-groups"),
      ]);
      setStudents(Array.isArray(st) ? st : []);
      setClasses(Array.isArray(cl) ? cl : []);
    } catch { setStudents([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = students;
    if (filter !== "all") list = list.filter(s => s.pool_status === filter);
    if (search) list = list.filter(s => s.name.includes(search) || (s.phone || "").includes(search));
    return list;
  }, [students, filter, search]);

  async function handleDelete(s: Student) {
    if (!confirm(`"${s.name}" 회원을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    setDeletingId(s.id);
    try {
      await api.delete(`/students/${s.id}`);
      setStudents(prev => prev.filter(m => m.id !== s.id));
    } catch (e: any) {
      alert(e?.data?.message || "삭제에 실패했습니다.");
    } finally { setDeletingId(null); }
  }

  async function handleRegister() {
    if (!regForm.name.trim()) { setRegError("이름을 입력해주세요."); return; }
    setRegSaving(true); setRegError("");
    try {
      await api.post("/students", { name: regForm.name.trim(), phone: regForm.phone, class_group_id: regForm.class_group_id || null });
      setShowRegister(false);
      setRegForm({ name: "", phone: "", class_group_id: "" });
      await load();
    } catch (e: any) {
      setRegError(e?.data?.message || e?.data?.error || "등록에 실패했습니다.");
    } finally { setRegSaving(false); }
  }

  const totalByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    students.forEach(s => { m[s.pool_status] = (m[s.pool_status] || 0) + 1; });
    return m;
  }, [students]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">회원 목록</h1>
          <p className="text-[13px] text-[#999] mt-1">전체 {students.length}명 · 정상 {totalByStatus.normal || 0}명 · 미배정 {totalByStatus.unassigned || 0}명</p>
        </div>
        <button onClick={() => setShowRegister(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
          <Plus size={16} /> 회원 등록
        </button>
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-colors ${filter === f.key ? "border-[#0369A1] bg-[#EFF6FF] text-[#0369A1]" : "border-[#E5E5E5] text-[#666]"}`}>
              {f.label} {f.key === "all" ? students.length : totalByStatus[f.key] || 0}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름, 연락처 검색"
            className="pl-9 pr-4 py-2 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1] w-52" />
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-white rounded-xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">{search ? "검색 결과가 없습니다." : "등록된 회원이 없습니다."}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#F5F5F5]">
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">이름</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">상태</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">수업</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">학부모</th>
                <th className="px-5 py-3 text-left text-[12px] font-semibold text-[#999]">연락처</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => {
                const st = STATUS_CONFIG[s.pool_status] || { label: s.pool_status, color: "#666", bg: "#F5F5F5" };
                return (
                  <tr key={s.id} className={`${idx > 0 ? "border-t border-[#F9F9F9]" : ""} hover:bg-[#FAFAFA] transition-colors`}>
                    <td className="px-5 py-3 font-semibold text-[14px] text-[#0A0A0A]">{s.name}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#666]">{s.class_name || "—"}</td>
                    <td className="px-5 py-3">
                      {s.parent_linked
                        ? <span className="text-[11px] font-medium text-[#059669]">연결됨</span>
                        : <span className="text-[11px] text-[#BBB]">미연결</span>}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#666]">{s.phone || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => handleDelete(s)} disabled={deletingId === s.id}
                        className="p-1.5 rounded-lg hover:bg-[#FEF2F2] disabled:opacity-40">
                        <Trash2 size={14} color="#DC2626" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록 모달 */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-bold">회원 등록</h2>
              <button onClick={() => setShowRegister(false)}><X size={18} color="#999" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">이름 *</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} placeholder="학생 이름" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">연락처</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 배정</label>
                <select className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={regForm.class_group_id} onChange={e => setRegForm(f => ({ ...f, class_group_id: e.target.value }))}>
                  <option value="">수업 선택 (선택사항)</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {regError && <p className="text-[12px] text-red-500 mt-3">{regError}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowRegister(false)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleRegister} disabled={regSaving} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
                {regSaving ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
