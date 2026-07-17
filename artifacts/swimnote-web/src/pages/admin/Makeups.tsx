import { useEffect, useState } from "react";
import { RefreshCw, Check, X, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface MakeupSession {
  id: string;
  student_id: string;
  student_name: string;
  original_class_group_name: string;
  original_teacher_name: string;
  absence_date: string;
  status: string;
}

interface EligibleClass {
  id: string; name: string; schedule_days: string; schedule_time: string;
  capacity: number; current_members: number; available_slots: number; instructor: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "대기", color: "#D97706", bg: "#FEF9C3" },
  assigned:  { label: "배정됨", color: "#059669", bg: "#DCFCE7" },
  completed: { label: "완료", color: "#0369A1", bg: "#EFF6FF" },
  cancelled: { label: "취소", color: "#DC2626", bg: "#FEE2E2" },
};

export default function Makeups() {
  const { user } = useAuth();
  const [makeups, setMakeups] = useState<MakeupSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [eligibleClasses, setEligibleClasses] = useState<EligibleClass[]>([]);
  const [assignTarget, setAssignTarget] = useState<MakeupSession | null>(null);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("pending");

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<any>(`/admin/makeups/pending`);
      const list = Array.isArray(data) ? data : data?.makeups || [];
      setMakeups(list);
    } catch { setMakeups([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function openAssign(mk: MakeupSession) {
    setAssignTarget(mk);
    setSelectedClassId("");
    try {
      const data = await api.get<EligibleClass[]>(`/admin/makeups/eligible-classes?teacher_id=${mk.original_teacher_name || ""}`);
      setEligibleClasses(Array.isArray(data) ? data : []);
    } catch { setEligibleClasses([]); }
  }

  async function handleAssign() {
    if (!assignTarget || !selectedClassId) return;
    setAssigning(true);
    try {
      await api.patch(`/admin/makeups/${assignTarget.id}/assign`, { class_group_id: selectedClassId });
      setAssignTarget(null);
      await load();
    } catch (e: any) {
      alert(e?.data?.message || "배정에 실패했습니다.");
    } finally { setAssigning(false); }
  }

  async function handleAction(id: string, action: "complete" | "cancel") {
    try {
      await api.patch(`/admin/makeups/${id}/${action}`, {});
      await load();
    } catch (e: any) {
      alert(e?.data?.message || "처리에 실패했습니다.");
    }
  }

  const filtered = makeups.filter(m => statusFilter === "all" || m.status === statusFilter);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">보강 관리</h1>
          <p className="text-[13px] text-[#999] mt-1">결석한 학생의 보강을 배정하고 관리합니다.</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#E5E5E5] text-[13px] text-[#666] hover:bg-[#F5F5F5]">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[["pending", "대기"], ["assigned", "배정됨"], ["completed", "완료"], ["all", "전체"]].map(([val, label]) => (
          <button key={val} onClick={() => setStatusFilter(val)}
            className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-colors ${statusFilter === val ? "border-[#0369A1] bg-[#EFF6FF] text-[#0369A1]" : "border-[#E5E5E5] text-[#666]"}`}>
            {label} {val !== "all" && `(${makeups.filter(m => m.status === val).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <RefreshCw size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">보강 내역이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(mk => {
            const st = STATUS_LABELS[mk.status] || STATUS_LABELS.pending;
            return (
              <div key={mk.id} className="bg-white rounded-2xl border border-[#EBEBEB] px-5 py-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[14px] text-[#0A0A0A]">{mk.student_name}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: st.bg, color: st.color }}>{st.label}</span>
                    </div>
                    <p className="text-[12px] text-[#999] mt-1">{mk.original_class_group_name} · 결석일: {mk.absence_date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {mk.status === "pending" && (
                      <button onClick={() => openAssign(mk)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-white" style={{ background: "#0369A1" }}>
                        <ChevronDown size={13} /> 수업 배정
                      </button>
                    )}
                    {mk.status === "assigned" && (
                      <>
                        <button onClick={() => handleAction(mk.id, "complete")} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[12px] font-semibold bg-[#DCFCE7] text-[#059669]">
                          <Check size={12} /> 완료
                        </button>
                        <button onClick={() => handleAction(mk.id, "cancel")} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[12px] font-semibold bg-[#FEE2E2] text-[#DC2626]">
                          <X size={12} /> 취소
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 배정 모달 */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-[16px] font-bold mb-2">보강 수업 배정</h2>
            <p className="text-[13px] text-[#666] mb-5"><b>{assignTarget.student_name}</b>의 보강 수업을 선택하세요.</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {eligibleClasses.length === 0 ? (
                <p className="text-[13px] text-[#999] text-center py-4">배정 가능한 수업이 없습니다.</p>
              ) : eligibleClasses.map(c => (
                <button key={c.id} onClick={() => setSelectedClassId(c.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${selectedClassId === c.id ? "border-[#0369A1] bg-[#EFF6FF]" : "border-[#E5E5E5] hover:bg-[#F9F9F9]"}`}>
                  <p className="font-semibold text-[13px] text-[#0A0A0A]">{c.name}</p>
                  <p className="text-[11px] text-[#999] mt-0.5">{c.instructor} · 잔여 {c.available_slots}석</p>
                </button>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAssignTarget(null)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleAssign} disabled={!selectedClassId || assigning} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
                {assigning ? "배정 중..." : "배정"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
