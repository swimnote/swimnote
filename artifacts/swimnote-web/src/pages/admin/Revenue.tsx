import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Receipt, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface RevenueData {
  total_revenue?: number;
  member_count?: number;
  payment_count?: number;
  monthly_breakdown?: Array<{ label: string; amount: number; count: number }>;
  by_class?: Array<{ class_name: string; revenue: number; count: number }>;
}

function formatWon(n: number) {
  if (!n) return "0원";
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억원";
  if (n >= 10_000) return Math.floor(n / 10_000).toLocaleString("ko-KR") + "만원";
  return n.toLocaleString("ko-KR") + "원";
}

export default function Revenue() {
  const { user } = useAuth();
  const poolId = (user as any)?.swimming_pool_id;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);

  const ym = `${year}-${String(month).padStart(2, "0")}`;

  useEffect(() => {
    setLoading(true);
    api.get<RevenueData>(`/admin/settlement-summary?month=${ym}`).then(d => setData(d)).catch(() => setData(null)).finally(() => setLoading(false));
  }, [ym]);

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">월별 수입</h1>
        <p className="text-[13px] text-[#999] mt-1">월별 결제 수입을 확인합니다.</p>
      </div>

      {/* 월 선택 */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-4 flex items-center gap-3">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronLeft size={18} /></button>
        <span className="text-[16px] font-bold min-w-[120px] text-center">{year}년 {month}월</span>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronRight size={18} /></button>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-28 bg-white rounded-2xl border border-[#EBEBEB] animate-pulse" />)}</div>
      ) : !data ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <Receipt size={32} className="mx-auto mb-3 text-[#DDD]" />
          <p className="text-[14px] text-[#999]">해당 월 데이터가 없습니다.</p>
        </div>
      ) : (
        <>
          {/* 핵심 지표 */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
              <p className="text-[12px] text-[#999]">총 수입</p>
              <p className="text-[24px] font-bold text-[#059669] mt-1">{formatWon(data.total_revenue || 0)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
              <p className="text-[12px] text-[#999]">결제 건수</p>
              <p className="text-[24px] font-bold text-[#0A0A0A] mt-1">{(data.payment_count || 0)}건</p>
            </div>
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
              <p className="text-[12px] text-[#999]">결제 회원</p>
              <p className="text-[24px] font-bold text-[#0A0A0A] mt-1">{(data.member_count || 0)}명</p>
            </div>
          </div>

          {/* 수업별 수입 */}
          {data.by_class && data.by_class.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
              <h2 className="text-[14px] font-bold mb-4">수업별 수입</h2>
              <div className="space-y-3">
                {data.by_class.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-[#F5F5F5] last:border-0">
                    <span className="text-[13px] font-medium text-[#333]">{item.class_name}</span>
                    <div className="text-right">
                      <span className="text-[14px] font-bold text-[#059669]">{formatWon(item.revenue)}</span>
                      <span className="text-[11px] text-[#999] ml-2">{item.count}건</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!data.by_class || data.by_class.length === 0) && (
            <div className="bg-white rounded-2xl border border-[#EBEBEB] p-8 text-center">
              <TrendingUp size={28} className="mx-auto mb-2 text-[#DDD]" />
              <p className="text-[13px] text-[#999]">상세 수입 내역이 없습니다.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
