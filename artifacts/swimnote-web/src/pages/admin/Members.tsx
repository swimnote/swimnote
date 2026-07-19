import { useEffect, useState, useMemo, useRef } from "react";
import {
  Search, Plus, Trash2, Users, X, ChevronUp, ChevronDown,
  Smartphone, Edit2, Check, ChevronRight, RotateCcw, AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";

interface Student {
  id: string;
  name: string;
  phone?: string;
  pool_status?: string;
  status?: string;
  class_group_id?: string | null;
  class_name?: string;
  assigned_class_ids?: string[];
  schedule_labels?: string | null;
  weekly_count?: number;
  parent_linked?: boolean;
  parent_name?: string;
  parent_phone?: string;
  birth_year?: string | null;
  memo?: string | null;
  created_at?: string;
  pending_status_change?: string | null;
  pending_effective_month?: string | null;
}

interface ClassGroup {
  id: string;
  name: string;
  schedule_days?: string;
  schedule_time?: string;
  instructor?: string;
  student_count?: number;
  capacity?: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:               { label: "정상",     color: "#059669", bg: "#DCFCE7" },
  normal:               { label: "정상",     color: "#059669", bg: "#DCFCE7" },
  unassigned:           { label: "미배정",   color: "#D97706", bg: "#FEF3C7" },
  suspended:            { label: "연기",     color: "#7C3AED", bg: "#EDE9FE" },
  pending_suspended:    { label: "연기예정", color: "#7C3AED", bg: "#EDE9FE" },
  withdrawn:            { label: "퇴원",     color: "#DC2626", bg: "#FEE2E2" },
  pending_withdrawn:    { label: "퇴원예정", color: "#DC2626", bg: "#FEE2E2" },
  deleted:              { label: "삭제",     color: "#9CA3AF", bg: "#F3F4F6" },
  pending_parent_link:  { label: "미배정",   color: "#D97706", bg: "#FEF3C7" },
  unregistered:         { label: "미등록",   color: "#9CA3AF", bg: "#F3F4F6" },
  pending_approval:     { label: "승인대기", color: "#0369A1", bg: "#EFF6FF" },
  archived:             { label: "보관",     color: "#9CA3AF", bg: "#F3F4F6" },
};

const FILTER_TABS = [
  { key: "all",       label: "전체" },
  { key: "active",    label: "정상" },
  { key: "unassigned",label: "미배정" },
  { key: "suspended", label: "연기" },
  { key: "withdrawn", label: "퇴원" },
];

type SortKey = "name" | "class" | "status" | "parent";
type SortDir = "asc" | "desc";

function getStatus(s: Student): string {
  return s.status || s.pool_status || "active";
}

function EditField({
  label, value, onSave, type = "text", placeholder,
}: {
  label: string;
  value: string;
  onSave: (v: string) => Promise<void>;
  type?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setVal(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save() {
    if (val === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(val); setEditing(false); }
    catch { setVal(value); }
    finally { setSaving(false); }
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-[#F3F4F6] last:border-0">
      <span className="text-[12px] text-[#999] w-20 shrink-0">{label}</span>
      {editing ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <input
            ref={inputRef}
            type={type}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(value); setEditing(false); } }}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-2 py-1 border border-[#0369A1] rounded-lg text-[13px] focus:outline-none"
          />
          <button onClick={save} disabled={saving} className="p-1 rounded-lg bg-[#0369A1] text-white hover:opacity-90 disabled:opacity-50">
            <Check size={13} />
          </button>
          <button onClick={() => { setVal(value); setEditing(false); }} className="p-1 rounded-lg hover:bg-[#F5F5F5]">
            <X size={13} color="#999" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 justify-end">
          <span className="text-[13px] text-[#0A0A0A] text-right truncate max-w-[200px]">
            {val || <span className="text-[#CCC]">—</span>}
          </span>
          <button onClick={() => setEditing(true)} className="p-1 rounded-lg hover:bg-[#F5F5F5] shrink-0">
            <Edit2 size={12} color="#BBB" />
          </button>
        </div>
      )}
    </div>
  );
}

function StudentDrawer({
  student,
  classes,
  onClose,
  onUpdated,
  onDeleted,
}: {
  student: Student;
  classes: ClassGroup[];
  onClose: () => void;
  onUpdated: (s: Student) => void;
  onDeleted: (id: string) => void;
}) {
  const [s, setS] = useState<Student>(student);
  const [statusChanging, setStatusChanging] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forceDeleting, setForceDeleting] = useState(false);
  const [showForceDeleteConfirm, setShowForceDeleteConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>(
    Array.isArray(student.assigned_class_ids) ? student.assigned_class_ids : (student.class_group_id ? [student.class_group_id] : [])
  );
  const [classAssignMode, setClassAssignMode] = useState(false);

  const st = getStatus(s);
  const statusConf = STATUS_CONFIG[st] || { label: st, color: "#D97706", bg: "#FEF3C7" };

  async function patchInfo(field: string, value: string) {
    try {
      const updated = await api.patch<Student>(`/students/${s.id}`, { [field]: value });
      const merged = { ...s, ...updated };
      setS(merged);
      onUpdated(merged);
      setErrorMsg(null);
    } catch (e: any) {
      const msg = e?.data?.error || e?.data?.message || "저장에 실패했습니다.";
      setErrorMsg(msg);
      throw e;
    }
  }

  async function changeStatus(new_status: string, effective_mode: "immediate" | "next_month" = "immediate") {
    setStatusChanging(true);
    try {
      const res = await api.post<any>(`/students/${s.id}/change-status`, { new_status, effective_mode });
      const merged = { ...s, ...(res.student || {}), status: res.student?.status || new_status };
      setS(merged);
      onUpdated(merged);
      setErrorMsg(null);
    } catch (e: any) { setErrorMsg(e?.data?.error || e?.data?.message || "상태 변경 실패"); }
    finally { setStatusChanging(false); }
  }

  async function restoreStudent() {
    if (!confirm(`"${s.name}" 회원을 복원하시겠습니까?`)) return;
    setStatusChanging(true);
    try {
      await api.post(`/admin/students/${s.id}/restore`, {});
      const merged = { ...s, status: "active", pool_status: "active" };
      setS(merged);
      onUpdated(merged);
      setErrorMsg(null);
    } catch (e: any) { setErrorMsg(e?.data?.error || "복원 실패"); }
    finally { setStatusChanging(false); }
  }

  async function assignClass() {
    setAssignSaving(true);
    try {
      const res = await api.patch<any>(`/students/${s.id}/assign`, { assigned_class_ids: selectedClassIds, weekly_count: s.weekly_count || 1 });
      const merged = { ...s, ...res };
      setS(merged);
      onUpdated(merged);
      setClassAssignMode(false);
      setErrorMsg(null);
    } catch (e: any) { setErrorMsg(e?.data?.message || "반 배정 실패"); }
    finally { setAssignSaving(false); }
  }

  async function deleteStudent() {
    if (!confirm(`"${s.name}" 회원을 삭제하시겠습니까?\n삭제된 회원은 삭제 회원 목록에서 복원할 수 있습니다.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/students/${s.id}`);
      onDeleted(s.id);
      onClose();
    } catch (e: any) { setErrorMsg(e?.data?.message || "삭제 실패"); }
    finally { setDeleting(false); }
  }

  async function forceDeleteStudent() {
    setForceDeleting(true);
    setShowForceDeleteConfirm(false);
    try {
      await api.delete(`/admin/students/${s.id}/force-delete`);
      onDeleted(s.id);
      onClose();
    } catch (e: any) { setErrorMsg(e?.data?.error || e?.data?.message || "즉시 삭제 실패"); }
    finally { setForceDeleting(false); }
  }

  const currentAssignedClasses = classes.filter(c => selectedClassIds.includes(c.id));

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#EBEBEB]">
          <div>
            <h2 className="text-[17px] font-bold text-[#0A0A0A]">{s.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: statusConf.bg, color: statusConf.color }}>
                {statusConf.label}
              </span>
              {s.pending_status_change && (
                <span className="text-[11px] text-[#7C3AED]">
                  → {STATUS_CONFIG[s.pending_status_change]?.label || s.pending_status_change} 예정 ({s.pending_effective_month})
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F5F5F5]"><X size={18} color="#555" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 에러 배너 */}
          {errorMsg && (
            <div className="mx-5 mt-3 px-4 py-2.5 bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl flex items-center justify-between gap-2">
              <span className="text-[12px] text-[#DC2626] font-medium">{errorMsg}</span>
              <button onClick={() => setErrorMsg(null)} className="text-[#DC2626] shrink-0"><X size={14} /></button>
            </div>
          )}

          {/* 기본 정보 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-2">기본 정보</p>
            <div className="bg-[#FAFAFA] rounded-2xl px-4">
              <EditField label="이름" value={s.name} onSave={v => patchInfo("name", v)} />
              <EditField label="생년" value={s.birth_year || ""} onSave={v => patchInfo("birth_year", v)} placeholder="2010" />
              <EditField label="메모" value={s.memo || ""} onSave={v => patchInfo("memo", v)} />
            </div>
          </div>

          {/* 보호자 정보 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-2">보호자 정보</p>
            <div className="bg-[#FAFAFA] rounded-2xl px-4">
              <EditField label="보호자명" value={s.parent_name || ""} onSave={v => patchInfo("parent_name", v)} />
              <EditField label="보호자 연락처" value={s.parent_phone || ""} onSave={v => patchInfo("parent_phone", v)} placeholder="010-0000-0000" />
              <EditField label="연락처2" value={(s as any).parent_phone2 || ""} onSave={v => patchInfo("parent_phone2", v)} placeholder="010-0000-0000" />
              <EditField label="연락처3" value={(s as any).parent_phone3 || ""} onSave={v => patchInfo("parent_phone3", v)} placeholder="010-0000-0000" />
            </div>
            {!s.parent_linked && (
              <p className="text-[11px] text-[#999] mt-1.5 ml-1">보호자 연락처 저장 시 앱 계정이 자동 연결됩니다</p>
            )}
          </div>

          {/* 반 배정 */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-[#999] uppercase tracking-wider">반 배정</p>
              <button
                onClick={() => setClassAssignMode(m => !m)}
                className="text-[12px] font-semibold text-[#0369A1] hover:opacity-75"
              >
                {classAssignMode ? "취소" : "변경"}
              </button>
            </div>

            {classAssignMode ? (
              <div className="bg-[#FAFAFA] rounded-2xl p-3 space-y-1">
                {classes.length === 0 ? (
                  <p className="text-[13px] text-[#CCC] text-center py-3">등록된 수업이 없습니다</p>
                ) : (
                  classes.map(c => {
                    const checked = selectedClassIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedClassIds(prev =>
                          checked ? prev.filter(id => id !== c.id) : [...prev, c.id]
                        )}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left ${checked ? "bg-[#EFF6FF]" : "hover:bg-[#F5F5F5]"}`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-[#0369A1] border-[#0369A1]" : "border-[#DDD]"}`}>
                          {checked && <Check size={10} color="#fff" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#0A0A0A] truncate">{c.name}</p>
                          {c.schedule_days && c.schedule_time && (
                            <p className="text-[11px] text-[#888]">{c.schedule_days} {c.schedule_time}</p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
                <button
                  onClick={assignClass}
                  disabled={assignSaving}
                  className="w-full mt-2 py-2.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50 hover:opacity-90 transition-all"
                  style={{ background: "#0369A1" }}
                >
                  {assignSaving ? "저장 중..." : "반 배정 저장"}
                </button>
              </div>
            ) : (
              <div className="bg-[#FAFAFA] rounded-2xl px-4 py-3">
                {currentAssignedClasses.length > 0 ? (
                  currentAssignedClasses.map(c => (
                    <div key={c.id} className="flex items-center justify-between py-1">
                      <span className="text-[13px] font-semibold text-[#0A0A0A]">{c.name}</span>
                      {c.schedule_days && <span className="text-[12px] text-[#888]">{c.schedule_days} {c.schedule_time}</span>}
                    </div>
                  ))
                ) : (
                  <p className="text-[13px] text-[#CCC] text-center py-1">배정된 수업 없음</p>
                )}
              </div>
            )}
          </div>

          {/* 상태 관리 */}
          <div className="px-5 pt-4 pb-2">
            <p className="text-[11px] font-bold text-[#999] uppercase tracking-wider mb-2">상태 관리</p>
            <div className="bg-[#FAFAFA] rounded-2xl p-3 space-y-2">

              {["withdrawn", "deleted"].includes(st) ? (
                <button
                  onClick={restoreStudent}
                  disabled={statusChanging}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#059669] text-[#059669] text-[13px] font-semibold hover:bg-[#F0FDF4] disabled:opacity-50 transition-colors"
                >
                  <RotateCcw size={14} />
                  {statusChanging ? "처리 중..." : "회원 복원"}
                </button>
              ) : (
                <>
                  {st !== "active" && st !== "unassigned" && (
                    <button
                      onClick={() => changeStatus("active")}
                      disabled={statusChanging}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#059669] text-[#059669] text-[13px] font-semibold hover:bg-[#F0FDF4] disabled:opacity-50 transition-colors"
                    >
                      <RotateCcw size={14} />
                      {statusChanging ? "처리 중..." : "정상 복원"}
                    </button>
                  )}

                  {st !== "suspended" && (
                    <div className="space-y-1">
                      <button
                        onClick={() => changeStatus("suspended", "immediate")}
                        disabled={statusChanging}
                        className="w-full py-2.5 rounded-xl border border-[#7C3AED] text-[#7C3AED] text-[13px] font-semibold hover:bg-[#F5F3FF] disabled:opacity-50 transition-colors"
                      >
                        {statusChanging ? "처리 중..." : "즉시 연기"}
                      </button>
                      <button
                        onClick={() => changeStatus("suspended", "next_month")}
                        disabled={statusChanging}
                        className="w-full py-2.5 rounded-xl border border-[#7C3AED]/50 text-[#7C3AED] text-[12px] font-semibold hover:bg-[#F5F3FF] disabled:opacity-50 transition-colors"
                      >
                        {statusChanging ? "처리 중..." : "다음 달부터 연기"}
                      </button>
                    </div>
                  )}

                  {st !== "withdrawn" && (
                    <div className="space-y-1">
                      <button
                        onClick={() => changeStatus("withdrawn", "immediate")}
                        disabled={statusChanging}
                        className="w-full py-2.5 rounded-xl border border-[#DC2626] text-[#DC2626] text-[13px] font-semibold hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
                      >
                        {statusChanging ? "처리 중..." : "즉시 퇴원"}
                      </button>
                      <button
                        onClick={() => changeStatus("withdrawn", "next_month")}
                        disabled={statusChanging}
                        className="w-full py-2.5 rounded-xl border border-[#DC2626]/50 text-[#DC2626] text-[12px] font-semibold hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
                      >
                        {statusChanging ? "처리 중..." : "다음 달부터 퇴원"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 삭제 */}
          <div className="px-5 pt-4 pb-8 space-y-2">
            <button
              onClick={deleteStudent}
              disabled={deleting || forceDeleting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-[#FEF2F2] text-[#DC2626] text-[13px] font-semibold hover:bg-[#FEE2E2] disabled:opacity-50 transition-colors"
            >
              <Trash2 size={14} />
              {deleting ? "삭제 중..." : "회원 삭제"}
            </button>
            <p className="text-[11px] text-[#BBB] text-center">삭제 후 삭제 회원 탭에서 복원 가능합니다</p>
            <button
              onClick={() => setShowForceDeleteConfirm(true)}
              disabled={deleting || forceDeleting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-[#DC2626] text-[#DC2626] text-[13px] font-semibold hover:bg-[#FEF2F2] disabled:opacity-50 transition-colors"
            >
              <Trash2 size={14} />
              {forceDeleting ? "삭제 중..." : "즉시 완전 삭제"}
            </button>
            <p className="text-[11px] text-[#BBB] text-center">DB에서 완전 삭제 — 복원 불가</p>
          </div>
        </div>
      </div>

      {/* 즉시 삭제 확인 모달 */}
      {showForceDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl mx-5 p-6 max-w-xs w-full shadow-2xl">
            <h3 className="text-[16px] font-bold text-[#0A0A0A] mb-2">즉시 완전 삭제</h3>
            <p className="text-[13px] text-[#555] leading-relaxed mb-5">
              <span className="font-bold text-[#DC2626]">{s.name}</span> 회원의 모든 데이터를 DB에서 완전히 삭제합니다.<br />
              출석 기록, 결제 내역 포함 모든 정보가 삭제되며 <span className="font-bold">복원이 불가능합니다.</span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowForceDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#DDD] text-[#555] text-[13px] font-semibold hover:bg-[#F5F5F5]"
              >
                취소
              </button>
              <button
                onClick={forceDeleteStudent}
                className="flex-1 py-2.5 rounded-xl bg-[#DC2626] text-white text-[13px] font-semibold hover:bg-[#B91C1C]"
              >
                완전 삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [st, cl] = await Promise.all([
        api.get<Student[]>("/students"),
        api.get<ClassGroup[]>("/class-groups"),
      ]);
      setStudents(Array.isArray(st) ? st : []);
      setClasses(Array.isArray(cl) ? cl : []);
    } catch { if (!silent) setStudents([]); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  const filtered = useMemo(() => {
    let list = students.filter(s => {
      const st = getStatus(s);
      if (filter === "all") return !["deleted"].includes(st);
      if (filter === "active") return st === "active" || st === "normal";
      return st === filter;
    });
    if (search) list = list.filter(s =>
      s.name.includes(search) ||
      (s.phone || "").includes(search) ||
      (s.parent_phone || "").includes(search) ||
      (s.class_name || "").includes(search) ||
      (s.schedule_labels || "").includes(search)
    );
    list = [...list].sort((a, b) => {
      let av = "", bv = "";
      if (sortKey === "name")   { av = a.name || ""; bv = b.name || ""; }
      if (sortKey === "class")  { av = a.class_name || a.schedule_labels || ""; bv = b.class_name || b.schedule_labels || ""; }
      if (sortKey === "status") { av = getStatus(a); bv = getStatus(b); }
      if (sortKey === "parent") { av = a.parent_linked ? "1" : "0"; bv = b.parent_linked ? "1" : "0"; }
      return sortDir === "asc" ? av.localeCompare(bv, "ko") : bv.localeCompare(av, "ko");
    });
    return list;
  }, [students, filter, search, sortKey, sortDir]);

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const countByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    students.forEach(s => {
      const st = getStatus(s);
      if (st !== "deleted") m[st] = (m[st] || 0) + 1;
    });
    return m;
  }, [students]);

  function getTabCount(key: string) {
    if (key === "all") return students.filter(s => !["deleted"].includes(getStatus(s))).length;
    if (key === "active") return (countByStatus["active"] || 0) + (countByStatus["normal"] || 0);
    return countByStatus[key] || 0;
  }

  async function handleRegister() {
    if (!regForm.name.trim()) { setRegError("이름을 입력해주세요."); return; }
    setRegSaving(true); setRegError("");
    try {
      await api.post("/students", {
        name: regForm.name.trim(),
        phone: regForm.phone,
        class_group_id: regForm.class_group_id || null,
      });
      setShowRegister(false);
      setRegForm({ name: "", phone: "", class_group_id: "" });
      load(true);
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
            전체 <span className="font-semibold text-[#333]">{getTabCount("all")}</span>명 ·
            정상 <span className="font-semibold text-emerald-600">{getTabCount("active")}</span>명 ·
            미배정 <span className="font-semibold text-amber-600">{countByStatus.unassigned || 0}</span>명
          </p>
        </div>
        <button
          onClick={() => setShowRegister(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13px] font-semibold shadow-sm hover:opacity-90 transition-all"
          style={{ background: "#0369A1" }}
        >
          <Plus size={16} /> 회원 등록
        </button>
      </div>

      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1.5 bg-[#F3F4F6] p-1 rounded-xl">
          {FILTER_TABS.map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${filter === f.key ? "bg-white text-[#0369A1] shadow-sm" : "text-[#888] hover:text-[#555]"}`}
            >
              {f.label} {getTabCount(f.key)}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#BBB]" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="이름, 연락처, 수업 검색"
            className="pl-9 pr-4 py-2 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1] w-52 bg-white"
          />
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          {[...Array(8)].map((_, i) => (
            <div key={i} className={`h-14 animate-pulse ${i > 0 ? "border-t border-[#F5F5F5]" : ""}`}
              style={{ background: i % 2 === 0 ? "#FAFAFA" : "white" }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-16 text-center">
          <Users size={36} className="mx-auto mb-3 text-[#E5E5E5]" />
          <p className="text-[14px] font-semibold text-[#BBB]">{search ? "검색 결과가 없습니다" : "등록된 회원이 없습니다"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden shadow-sm">
          {/* 테이블 헤더 */}
          <div className="grid grid-cols-[2fr_2fr_1.5fr_1fr_1.5fr_24px] border-b border-[#F0F0F0] bg-[#FAFAFA]">
            {[
              { label: "이름", key: "name" as SortKey },
              { label: "수업", key: "class" as SortKey },
              { label: "상태", key: "status" as SortKey },
              { label: "학부모", key: "parent" as SortKey },
              { label: "연락처", key: null },
              { label: "", key: null },
            ].map((col, i) => (
              <button
                key={i}
                onClick={() => col.key ? handleSort(col.key) : undefined}
                className={`px-5 py-3 text-left text-[11px] font-semibold text-[#999] uppercase tracking-wider flex items-center gap-1 ${col.key ? "hover:text-[#555] cursor-pointer" : "cursor-default"}`}
              >
                {col.label}
                {col.key && <SortIcon col={col.key} />}
              </button>
            ))}
          </div>

          {paginated.map((s, idx) => {
            const st = getStatus(s);
            const conf = STATUS_CONFIG[st] || { label: st, color: "#666", bg: "#F5F5F5" };
            return (
              <div
                key={s.id}
                onClick={() => setSelectedStudent(s)}
                className={`grid grid-cols-[2fr_2fr_1.5fr_1fr_1.5fr_24px] items-center hover:bg-[#F8FAFF] cursor-pointer transition-colors ${idx > 0 ? "border-t border-[#F5F5F5]" : ""}`}
              >
                <div className="px-5 py-3.5">
                  <p className="font-semibold text-[13.5px] text-[#0A0A0A]">{s.name}</p>
                  {s.parent_name && <p className="text-[11px] text-[#BBB]">{s.parent_name}</p>}
                </div>
                <div className="px-5 py-3.5 text-[13px] text-[#555]">
                  {s.schedule_labels || s.class_name
                    ? <span className="font-medium">{s.schedule_labels || s.class_name}</span>
                    : <span className="text-[#CCC]">—</span>}
                </div>
                <div className="px-5 py-3.5">
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: conf.bg, color: conf.color }}>
                    {conf.label}
                  </span>
                  {s.pending_status_change && (
                    <p className="text-[10px] text-[#7C3AED] mt-0.5">→ {STATUS_CONFIG[s.pending_status_change]?.label} 예정</p>
                  )}
                </div>
                <div className="px-5 py-3.5">
                  {s.parent_linked
                    ? <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><Smartphone size={11} /> 연결</span>
                    : <span className="text-[11px] text-[#CCC]">미연결</span>}
                </div>
                <div className="px-5 py-3.5 text-[12px] text-[#888]">{s.parent_phone || s.phone || <span className="text-[#CCC]">—</span>}</div>
                <div className="pr-2 py-3.5 flex items-center justify-center">
                  <ChevronRight size={14} color="#CCC" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-[12px] text-[#999]">
            {filtered.length}명 중 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}명 표시
          </p>
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

      {/* 학생 상세 드로어 */}
      {selectedStudent && (
        <StudentDrawer
          student={selectedStudent}
          classes={classes}
          onClose={() => setSelectedStudent(null)}
          onUpdated={(updated) => {
            setStudents(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s));
            setSelectedStudent(updated);
          }}
          onDeleted={(id) => {
            setStudents(prev => prev.filter(s => s.id !== id));
            setSelectedStudent(null);
          }}
        />
      )}

      {/* 등록 모달 */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[16px] font-bold text-[#0A0A0A]">회원 등록</h2>
              <button onClick={() => setShowRegister(false)} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]">
                <X size={16} color="#999" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">이름 *</label>
                <input
                  className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] transition-colors"
                  value={regForm.name}
                  onChange={e => setRegForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="학생 이름"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">연락처</label>
                <input
                  className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] transition-colors"
                  value={regForm.phone}
                  onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="010-0000-0000"
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">수업 배정</label>
                <select
                  className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1] bg-white"
                  value={regForm.class_group_id}
                  onChange={e => setRegForm(f => ({ ...f, class_group_id: e.target.value }))}
                >
                  <option value="">수업 선택 (선택사항)</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            {regError && <p className="text-[12px] text-red-500 mt-3">{regError}</p>}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowRegister(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666] hover:bg-[#F5F5F5] transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleRegister}
                disabled={regSaving}
                className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60 hover:opacity-90 transition-all shadow-sm"
                style={{ background: "#0369A1" }}
              >
                {regSaving ? "등록 중..." : "등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
