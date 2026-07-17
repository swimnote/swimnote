import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface Holiday { id: string; date: string; reason?: string; }

const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_LABELS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export default function Holidays() {
  const { user } = useAuth();
  const poolId = (user as any)?.swimming_pool_id;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;

  const load = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    try {
      const data = await api.get<any>(`/holidays?pool_id=${poolId}&month=${ym}`);
      const list = Array.isArray(data) ? data : data?.holidays || [];
      setHolidays(list);
      const cs = await api.get<any>(`/holidays/confirm-status?pool_id=${poolId}&month=${ym}`).catch(() => null);
      setConfirmed(cs?.confirmed === true);
    } catch { setHolidays([]); }
    finally { setLoading(false); }
  }, [poolId, ym]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); }

  const holidayDates = new Set(holidays.map(h => h.date));

  async function handleAdd() {
    if (!newDate) return;
    setSaving(true);
    try {
      await api.post("/holidays", { date: newDate, reason: newReason, pool_id: poolId });
      setShowAddForm(false); setNewDate(""); setNewReason("");
      await load();
    } catch (e: any) {
      alert(e?.data?.message || "추가에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function handleRemove(id: string) {
    if (!confirm("이 휴일을 삭제하시겠습니까?")) return;
    try { await api.delete(`/holidays/${id}`); await load(); }
    catch (e: any) { alert(e?.data?.message || "삭제에 실패했습니다."); }
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      await api.post("/holidays/confirm", { pool_id: poolId, month: ym });
      setConfirmed(true);
    } catch (e: any) { alert(e?.data?.message || "확정에 실패했습니다."); }
    finally { setConfirming(false); }
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#0A0A0A]">휴일 설정</h1>
          <p className="text-[13px] text-[#999] mt-1">수영장 휴일을 달력에서 설정하세요.</p>
        </div>
        <div className="flex items-center gap-2">
          {!confirmed && (
            <button onClick={handleConfirm} disabled={confirming} className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-[#DCFCE7] text-[#059669]">
              <Check size={14} /> {confirming ? "확정 중..." : "이달 휴일 확정"}
            </button>
          )}
          {confirmed && <span className="text-[12px] font-semibold text-[#059669] bg-[#DCFCE7] px-3 py-1.5 rounded-xl">✓ 확정됨</span>}
          <button onClick={() => setShowAddForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold" style={{ background: "#0369A1" }}>
            <Plus size={16} /> 휴일 추가
          </button>
        </div>
      </div>

      {/* 월 네비 */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronLeft size={18} /></button>
          <span className="text-[16px] font-bold">{year}년 {MONTH_LABELS[month]}</span>
          <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#F5F5F5]"><ChevronRight size={18} /></button>
        </div>

        {/* 달력 */}
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {DAYS_KO.map(d => <div key={d} className="text-[11px] font-semibold text-[#999] py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {[...Array(firstDay)].map((_, i) => <div key={`e${i}`} />)}
          {[...Array(daysInMonth)].map((_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isHoliday = holidayDates.has(dateStr);
            const isToday = dateStr === today.toISOString().split("T")[0];
            const dow = new Date(year, month, day).getDay();
            return (
              <div key={day}
                className={`aspect-square flex items-center justify-center rounded-xl text-[13px] font-medium cursor-pointer transition-colors ${
                  isHoliday ? "bg-red-100 text-red-600 font-bold" : isToday ? "bg-[#0369A1] text-white" : dow === 0 ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-[#333] hover:bg-[#F5F5F5]"
                }`}
                onClick={() => { setNewDate(dateStr); setNewReason(""); setShowAddForm(true); }}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* 휴일 목록 */}
      {holidays.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
          <h2 className="text-[14px] font-bold mb-3">{MONTH_LABELS[month]} 휴일 목록</h2>
          <div className="space-y-2">
            {holidays.map(h => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#FEF2F2]">
                <div>
                  <span className="font-semibold text-[13px] text-[#DC2626]">{h.date}</span>
                  {h.reason && <span className="text-[12px] text-[#999] ml-2">({h.reason})</span>}
                </div>
                <button onClick={() => handleRemove(h.id)} className="p-1.5 rounded-lg hover:bg-[#FEE2E2]">
                  <X size={14} color="#DC2626" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 추가 모달 */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-[16px] font-bold mb-5">휴일 추가</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">날짜 *</label>
                <input type="date" className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={newDate} onChange={e => setNewDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#555] mb-1.5">사유 (선택)</label>
                <input className="w-full px-3 py-2.5 border border-[#E5E5E5] rounded-xl text-[14px] focus:outline-none focus:border-[#0369A1]" value={newReason} onChange={e => setNewReason(e.target.value)} placeholder="예: 설날 연휴" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAddForm(false)} className="flex-1 py-2.5 rounded-xl border border-[#E5E5E5] text-[14px] font-semibold text-[#666]">취소</button>
              <button onClick={handleAdd} disabled={saving || !newDate} className="flex-1 py-2.5 rounded-xl text-white text-[14px] font-semibold disabled:opacity-60" style={{ background: "#0369A1" }}>
                {saving ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
