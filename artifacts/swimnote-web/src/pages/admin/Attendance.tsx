import { useEffect, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Check, X, Clock, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

interface ClassGroup { id: string; name: string; }
interface Student { id: string; name: string; class_group_id: string | null; }
interface AttRecord { id?: string; student_id: string; student_name: string; status: "present" | "absent" | "late" | null; }

const STATUS_CONFIG = {
  present: { label: "출석", color: "#059669", bg: "#DCFCE7", icon: Check },
  absent:  { label: "결석", color: "#DC2626", bg: "#FEE2E2", icon: X },
  late:    { label: "지각", color: "#D97706", bg: "#FEF9C3", icon: Clock },
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(d: string, n: number) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}

const DAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

export default function Attendance() {
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [date, setDate] = useState(todayStr());
  const [records, setRecords] = useState<AttRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    api.get<ClassGroup[]>("/class-groups").then(data => {
      const list = Array.isArray(data) ? data : [];
      setClasses(list);
      if (list.length > 0) setSelectedClass(list[0].id);
    }).catch(() => {});
  }, []);

  const loadAttendance = useCallback(async () => {
    if (!selectedClass) return;
    setLoading(true);
    try {
      const data = await api.get<any[]>(`/attendance?class_group_id=${selectedClass}&date=${date}`);
      setRecords(Array.isArray(data) ? data.map(r => ({ id: r.id, student_id: r.student_id, student_name: r.student_name, status: r.status || null })) : []);
    } catch {
      setRecords([]);
    } finally { setLoading(false); }
  }, [selectedClass, date]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  async function handleStatus(rec: AttRecord, status: "present" | "absent" | "late") {
    const newStatus = rec.status === status ? null : status;
    setSaving(rec.student_id);
    try {
      await api.post<any>("/attendance", { student_id: rec.student_id, class_group_id: selectedClass, date, status: newStatus });
      setRecords(prev => prev.map(r => r.student_id === rec.student_id ? { ...r, status: newStatus } : r));
    } catch (e: any) {
      alert(e?.data?.message || "저장에 실패했습니다.");
    } finally { setSaving(null); }
  }

  const dt = new Date(date);
  const dateLabel = `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS_KO[dt.getDay()]})`;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-[#0A0A0A]">출석 관리</h1>
        <p className="text-[13px] text-[#999] mt-1">날짜와 수업을 선택해 출석을 기록하세요.</p>
      </div>

      {/* 필터 바 */}
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setDate(addDays(date, -1))} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]"><ChevronLeft size={16} /></button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-3 py-1.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]" />
          <button onClick={() => setDate(addDays(date, 1))} className="p-1.5 rounded-lg hover:bg-[#F5F5F5]"><ChevronRight size={16} /></button>
          <span className="text-[13px] text-[#666] font-medium">{dateLabel}</span>
        </div>
        <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
          className="px-3 py-1.5 border border-[#E5E5E5] rounded-xl text-[13px] focus:outline-none focus:border-[#0369A1]">
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={loadAttendance} className="ml-auto p-1.5 rounded-lg hover:bg-[#F5F5F5]">
          <RefreshCw size={15} color="#999" />
        </button>
      </div>

      {/* 출석 통계 */}
      {records.length > 0 && (
        <div className="flex gap-3 mb-4">
          {(["present", "absent", "late"] as const).map(s => {
            const count = records.filter(r => r.status === s).length;
            const cfg = STATUS_CONFIG[s];
            return (
              <div key={s} className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold" style={{ background: cfg.bg, color: cfg.color }}>
                <cfg.icon size={13} /> {cfg.label} {count}명
              </div>
            );
          })}
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold bg-[#F5F5F5] text-[#999]">
            미기록 {records.filter(r => !r.status).length}명
          </div>
        </div>
      )}

      {/* 학생 목록 */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-white rounded-xl border border-[#EBEBEB] animate-pulse" />)}
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-12 text-center">
          <p className="text-[14px] text-[#999]">이 수업에 등록된 학생이 없거나 출석 데이터가 없습니다.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
          {records.map((rec, idx) => (
            <div key={rec.student_id} className={`flex items-center gap-4 px-5 py-3.5 ${idx > 0 ? "border-t border-[#F5F5F5]" : ""}`}>
              <div className="flex-1">
                <span className="font-semibold text-[14px] text-[#0A0A0A]">{rec.student_name}</span>
              </div>
              <div className="flex items-center gap-2">
                {(["present", "absent", "late"] as const).map(s => {
                  const cfg = STATUS_CONFIG[s];
                  const active = rec.status === s;
                  const isSaving = saving === rec.student_id;
                  return (
                    <button
                      key={s}
                      onClick={() => handleStatus(rec, s)}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-all"
                      style={{
                        background: active ? cfg.bg : "#F9F9F9",
                        color: active ? cfg.color : "#999",
                        borderColor: active ? cfg.color + "50" : "#EBEBEB",
                      }}
                    >
                      <cfg.icon size={12} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
