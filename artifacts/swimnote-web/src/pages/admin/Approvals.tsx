import { useEffect, useState } from "react";
import { ShieldCheck, Check, X, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

interface TeacherRequest {
  id: string;
  student_id: string;
  student_name: string;
  teacher_name?: string;
  teacher_email?: string;
  class_name?: string;
  created_at?: string;
  status?: string;
}

export default function Approvals() {
  const [requests, setRequests] = useState<TeacherRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get<any>("/students/teacher-requests");
      const list = Array.isArray(data) ? data : data?.requests || [];
      setRequests(list);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(id: string) {
    setActionId(id);
    try {
      await api.post(`/students/teacher-requests/${id}/approve`, {});
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (e: any) { alert(e?.data?.message || "처리에 실패했습니다."); }
    finally { setActionId(null); }
  }

  async function handleReject(id: string) {
    if (!confirm("이 요청을 거절하시겠습니까?")) return;
    setActionId(id);
    try {
      await api.delete(`/students/teacher-requests/${id}`);
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (e: any) { alert(e?.data?.message || "처리에 실패했습니다."); }
    finally { setActionId(null); }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">승인 관리</h1>
          <p className="text-[13px] text-[#999] mt-1">대기 중인 요청 {requests.filter(r => !r.status || r.status === "pending").length}건</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#E5E5E5] text-[13px] text-[#666] hover:bg-[#F5F5F5]">
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : requests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <ShieldCheck size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">대기 중인 요청이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-[#EBEBEB] px-5 py-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[14px] text-[#0A0A0A]">{r.student_name}</p>
                <p className="text-[12px] text-[#999] mt-0.5">
                  {r.teacher_name && `담당: ${r.teacher_name}`}
                  {r.class_name && ` · ${r.class_name}`}
                  {r.created_at && ` · ${r.created_at.slice(0, 10)}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleApprove(r.id)} disabled={actionId === r.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#DCFCE7] text-[#059669] disabled:opacity-40">
                  <Check size={13} /> 승인
                </button>
                <button onClick={() => handleReject(r.id)} disabled={actionId === r.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold bg-[#FEE2E2] text-[#DC2626] disabled:opacity-40">
                  <X size={13} /> 거절
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
