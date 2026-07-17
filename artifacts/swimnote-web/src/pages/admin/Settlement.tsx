import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Calculator, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface TeacherSettlement {
  teacher_id: string;
  teacher_name: string;
  class_count: number;
  session_count: number;
  amount: number;
  finalized?: boolean;
}

function formatWon(n: number) {
  if (!n) return "0원";
  return n.toLocaleString("ko-KR") + "원";
}

export default function Settlement() {
  const { user } = useAuth();
  const poolId = (user as any)?.swimming_pool_id;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [settlements, setSettlements] = useState<TeacherSettlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState<string | null>(null);

  const ym = `${year}-${String(month).padStart(2, "0")}`;

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/settlement/calculator?pool_id=${poolId}&month=${ym}`)
      .then(d => {
        const list = Array.isArray(d) ? d : d?.settlements || d?.teachers || [];
        setSettlements(list);
      })
      .catch(() => setSettlements([]))
      .finally(() => setLoading(false));
  }, [ym, poolId]);

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  async function handleFinalize(teacherId: string) {
    setFinalizing(teacherId);
    try {
      await api.post("/settlement/finalize", { teacher_id: teacherId, pool_id: poolId, month: ym });
      setSettlements(prev => prev.map(s => s.teacher_id === teacherId ? { ...s, finalized: true } : s));
    } catch (e: any) {
      alert(e?.data?.message || "정산 확정에 실패했습니다.");
    } finally { setFinalizing(null); }
  }

  const total = settlements.reduce((sum, s) => sum + (s.amount || 0), 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">정산</h1>
        <p className="text-[13px] text-[#999] mt-1">선생님별 급여 정산을 관리합니다.</p>
      </div>

      {/* 월 선택 */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-4 flex items-center gap-3">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronLeft size={18} /></button>
        <span className="text-[16px] font-bold min-w-[120px] text-center">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronRight size={18} /></button>
        {settlements.length > 0 && (
          <span className="ml-auto text-[14px] font-bold text-[#059669]">합계: {formatWon(total)}</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : settlements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <Calculator size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">정산 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {settlements.map(s => (
            <div key={s.teacher_id} className="bg-white rounded-2xl border border-[#EBEBEB] p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                <span className="text-[14px] font-bold text-[#0369A1]">{s.teacher_name?.[0] || "T"}</span>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-[14px] text-[#0A0A0A]">{s.teacher_name}</p>
                <p className="text-[12px] text-[#999] mt-0.5">수업 {s.class_count || 0}개 · 수업일 {s.session_count || 0}회</p>
              </div>
              <div className="text-right mr-4">
                <p className="text-[18px] font-bold text-[#0A0A0A]">{formatWon(s.amount)}</p>
              </div>
              {s.finalized ? (
                <span className="flex items-center gap-1 text-[12px] font-semibold text-[#059669] bg-[#DCFCE7] px-3 py-1.5 rounded-xl">
                  <Check size={13} /> 확정됨
                </span>
              ) : (
                <button onClick={() => handleFinalize(s.teacher_id)} disabled={finalizing === s.teacher_id}
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold border border-[#E5E5E5] text-[#666] hover:bg-[#F5F5F5] disabled:opacity-40">
                  {finalizing === s.teacher_id ? "처리 중..." : "확정"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
