import { useEffect, useState, useMemo } from "react";
import { Search, Plus, Trash2, Users, X, ChevronUp, ChevronDown, Smartphone } from "lucide-react";
import { api } from "@/lib/api";

interface Student {
  id: string; name: string; pool_status: string;
  class_group_id: string | null; class_name?: string;
  weekly_count?: number; parent_linked?: boolean; phone?: string;
  created_at?: string;
}
interface ClassGroup { id: string; name: string; }

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  normal:            { label: "정상",     color: "#059669", bg: "#DCFCE7" },
  unassigned:        { label: "미배정",   color: "#D97706", bg: "#FEF3C7" },
  suspended:         { label: "연기",     color: "#7C3AED", bg: "#EDE9FE" },
  pending_suspended: { label: "연기예정", color: "#7C3AED", bg: "#EDE9FE" },
  withdrawn:         { label: "퇴원",     color: "#DC2626", bg: "#FEE2E2" },
  pending_withdrawn: { label: "퇴원예정", color: "#DC2626", bg: "#FEE2E2" },
};

const FILTER_TABS = [
  { key: "all",       label: "전체" },
  { key: "normal",    label: "정상" },
  { key: "unassigned",label: "미배정" },
  { key: "suspended", label: "연기" },
];

type SortKey = "name" | "class" | "status" | "parent";
type SortDir = "asc" | "desc";

export default function Members() {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", phone: "", class_group_id: "" });
  const [regSaving, setRegSaving] = useState(false);
  const [regError, setRegError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  async function load() {
    setLoading(true);
    try {
      const [st, cl] = await Promise.all([api.get<Student[]>("/students"), api.get<ClassGroup[]>("/class-groups")]);
      setStudents(Array.isArray(st) ? st : []);
      setClasses(Array.isArray(cl) ? cl : []);
    } catch { setStudents([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    let list = students;
    if (filter !== "all") list = list.filter(s => s.pool_status === filter);
    if (search) list = list.filter(s => s.name.includes(search) || (s.phone || "").includes(search) || (s.class_name || "").includes(search));
    list = [...list].sort((a, b) => {
      let av = "", bv = "";
      if (sortKey === "name")   { av = a.name || ""; bv = b.name || ""; }
      if (sortKey === "class")  { av = a.class_name || ""; bv = b.class_name || ""; }
      if (sortKey === "status") { av = a.pool_status || ""; bv = b.pool_status || ""; }
      if (sortKey === "parent") { av = a.parent_linked ? "1" : "0"; bv = b.parent_linked ? "1" : "0"; }
      return sortDir === "asc" ? av.localeCompare(bv, "ko") : bv.localeCompare(av, "ko");
    });
    return list;
  }, [students, filter, search, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const countByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    students.forEach(s => { m[s.pool_status] = (m[s.pool_status] || 0) + 1; });
    return m;
  }, [students]);

  async function handleDelete(s: Student) {
    if (!confirm(`"${s.name}" 회원을 삭제하시겠습니까?`)) return;
    setDeletingId(s.id);
    try {
      await api.delete(`/students/${s.id}`);
      setStudents(prev => prev.filter(m => m.id !== s.id));
    } catch (e: any) { alert(e?.data?.message || "삭제 실패"); }
    finally { setDeletingId(null); }
  }

  async function handleRegister() {
    if (!regForm.name.trim()) { setRegError("이름을 입력해주세요."); return; }
    setRegSaving(true); setRegError("");
    try {
      await api.post("/students", { name: regForm.name.trim(), phone: regForm.phone, class_group_id: regForm.class_group_id || null });
      setShowRegister(false); setRegForm({ name: "", phone: "", class_group_id: "" }); await load();
    } catch (e: any) { setRegError(e?.data?.message || e?.data?.error || "등록 실패"); }
    finally { setRegSaving(false); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp size={12} className="text-[#DDD]" />;
    return sortDir === "asc" ? <ChevronUp size={12} className="text-[#0369A1]" /> : <ChevronDown size={12} className="text-[#0369A1]" />;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">회원 목록</h1>
          <p className="text-[13px] text-[#999] mt-0.5">
            전체 <span className="font-semibold text-[#333]">{students.length}</span>명 ·
            정상 <span className="font-semibold text-emerald-600">{countByStatus.normal || 0}</span>명 ·
            미배정 <span className="font-semibold text-amber-600">{countByStatus.unassigned || 0}</span>명
          </p>
        </div>
        <button onClick={() => setShowRegister(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold shadow-sm hover:opacity-90 transition-all"
          style={{ background: "#0369A1" }}>
          <Plus size={16} /> 회원 등록
        </button>
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1.5 bg-[#F3F4F6] p-1 rounded-xl">
          {FILTER_TABS.map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                filter === f.key ? "bg-white text-[#0369A1] shadow-sm" : "text-[#888] hover:text-[#555]"}`}>
              {f.label} {f.key === "all" ? students.length : countByStatus[f.key] || 0}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#BBB]" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="이름, 연락처, 수업 검색"
            className="pl-9 pr-4 py-2 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1] w-52 bg-white" />
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          {[...Array(8)].map((_, i) => <div key={i} className={`h-14 animate-pulse ${i > 0 ? "border-t border-[#F5F5F5]" : ""}`} style={{ background: i % 2 === 0 ? "#FAFAFA" : "white" }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-16 text-center">
          <Users size={36} className="mx-auto mb-3 text-[#E5E5E5]" />
          <p className="text-[14px] font-semibold text-[#BBB]">{search ? "검색 결과가 없습니다" : "등록된 회원이 없습니다"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden shadow-sm">
          {/* 테이블 헤더 */}
          <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_1.5fr_40px] gap-0 border-b border-[#F0F0F0] bg-[#FAFAFA]">
            {[
              { label: "이름", key: "name" as SortKey },
              { label: "수업", key: "class" as SortKey },
              { label: "상태", key: "status" as SortKey },
              { label: "학부모", key: "parent" as SortKey },
              { label: "연락처", key: null },
              { label: "", key: null },
            ].map((col, i) => (
              <button key={i}
                onClick={() => col.key ? handleSort(col.key) : undefined}
                className={`px-5 py-3 text-left text-[11px] font-semibold text-[#999] uppercase tracking-wider flex items-center gap-1 ${col.key ? "hover:text-[#555] cursor-pointer" : "cursor-default"}`}>
                {col.label}
                {col.key && <SortIcon col={col.key} />}
              </button>
            ))}
          </div>

          {paginated.map((s, idx) => {
            const st = STATUS_CONFIG[s.pool_status] || { label: s.pool_status, color: "#666", bg: "#F5F5F5" };
            return (
              <div key={s.id}
                className={`grid grid-cols-[2fr_2fr_1.5fr_1fr_1.5fr_40px] items-center hover:bg-[#FAFAFE] transition-colors ${idx > 0 ? "border-t border-[#F5F5F5]" : ""}`}>
                <div className="px-5 py-3.5">
                  <p className="font-semibold text-[13.5px] text-[#0A0A0A]">{s.name}</p>
                </div>
                <div className="px-5 py-3.5 text-[13px] text-[#555]">
                  {s.class_name ? <span className="font-medium">{s.class_name}</span> : <span className="text-[#CCC]">—</span>}
                </div>
                <div className="px-5 py-3.5">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                </div>
                <div className="px-5 py-3.5">
                  {s.parent_linked
                    ? <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Smartphone size={11} /> 연결</span>
                    : <span className="text-[11px] text-[#CCC]">미연결</span>}
                </div>
                <div className="px-5 py-3.5 text-[12px] text-[#888]">{s.phone || <span className="text-[#CCC]">—</span>}</div>
                <div className="px-2 py-3.5 flex justify-center">
                  <button onClick={() => handleDelete(s)} disabled={deletingId === s.id}
                    className="p-1.5 rounded-lg hover:bg-[#FEF2F2] disabled:opacity-30 transition-colors">
                    <Trash2 size={13} color="#DC2626" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-[12px] text-[#999]">{filtered.length}명 중 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}명 표시</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-[12px] font-medium text-[#666] disabled:opacity-30 hover:bg-[#F5F5F5] transition-colors">
              이전
            </button>
            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-[12px] font-medium transition-colors ${p === page ? "text-white" : "text-[#666] hover:bg-[#F5F5F5]"}`}
                  style={p === page ? { background: "#0369A1" } : {}}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] text-[12px] font-medium text-[#666] disabled:opacity-30 hover:bg-[#F5F5F5] transition-colors">
              다음
            </button>
          </div>
        </div>
      )}

      {/* 등록 모달 */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-bold text-[#0A0A0A]">회원 등록</h2>
              <button onClick={() => setShowRegister(false)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]"><X size={16} color="#999" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">이름 *</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] transition-colors"
                  value={regForm.name} onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))} placeholder="학생 이름" autoFocus />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">연락처</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] transition-colors"
                  value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 배정</label>
                <select className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] bg-white"
                  value={regForm.class_group_id} onChange={e => setRegForm(f => ({ ...f, class_group_id: e.target.value }))}>
                  <option value="">수업 선택 (선택사항)</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {regError && <p className="text-[12px] text-red-500 mt-3">{regError}</p>}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowRegister(false)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666] hover:bg-[#F5F5F5] transition-colors">취소</button>
              <button onClick={handleRegister} disabled={regSaving}
                className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60 hover:opacity-90 transition-all shadow-sm" style={{ background: "#0369A1" }}>
                {regSaving ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
