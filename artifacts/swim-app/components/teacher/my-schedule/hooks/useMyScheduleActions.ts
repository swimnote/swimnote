/**
 * useMyScheduleActions — my-schedule 액션 훅
 *
 * 분리 책임: 출결 직접 처리 / 반이동 / 보강 대기 목록 로딩 + state 관리
 * JSX / 렌더 흐름 / API 엔드포인트는 원본 그대로 유지
 */
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import { StudentItem, todayDateStr } from "../utils";

interface DayMakeup {
  id: string; student_id: string; student_name: string;
  absence_date: string; status: string;
  original_class_group_id: string | null;
}

export function useMyScheduleActions({
  token,
  selectedGroup,
  load,
}: {
  token: string | null;
  selectedGroup: TeacherClassGroup | null;
  load: () => Promise<void>;
}) {
  const [dayViewAttState,   setDayViewAttState]   = useState<Record<string, "present" | "absent">>({});
  const [dayViewAttSaving,  setDayViewAttSaving]  = useState<Set<string>>(new Set());
  const [showMoveSheet,     setShowMoveSheet]     = useState(false);
  const [moveStudent,       setMoveStudent]       = useState<StudentItem | null>(null);
  const [moveSheetSaving,   setMoveSheetSaving]   = useState(false);
  const [dayMakeups,        setDayMakeups]        = useState<DayMakeup[]>([]);
  const [dayMakeupsLoading, setDayMakeupsLoading] = useState(false);

  const loadDayMakeups = useCallback(async (classGroupId: string) => {
    setDayMakeupsLoading(true);
    try {
      const res = await apiRequest(token, "/teacher/makeups?status=pending");
      if (res.ok) {
        const all: DayMakeup[] = await res.json();
        setDayMakeups(all.filter(m => m.original_class_group_id === classGroupId));
      }
    } catch (e) { console.error(e); }
    finally { setDayMakeupsLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!selectedGroup || !token) { setDayViewAttState({}); setDayMakeups([]); return; }
    const date = todayDateStr();
    apiRequest(token, `/class-groups/${selectedGroup.id}/attendance?date=${date}`)
      .then(r => r.ok ? r.json() : [])
      .then((arr: { student_id: string; status: string | null }[]) => {
        const map: Record<string, "present" | "absent"> = {};
        arr.forEach(a => { if (a.status === "present" || a.status === "absent") map[a.student_id] = a.status; });
        setDayViewAttState(map);
      })
      .catch(() => {});
    loadDayMakeups(selectedGroup.id);
  }, [selectedGroup, token, loadDayMakeups]);

  const markDayAtt = useCallback(async (studentId: string, requestedStatus: "present" | "absent") => {
    if (!selectedGroup) return;
    const currentStatus = dayViewAttState[studentId];
    const newStatus: "present" | "absent" =
      currentStatus === requestedStatus
        ? (requestedStatus === "absent" ? "present" : "absent")
        : requestedStatus;

    setDayViewAttSaving(prev => { const n = new Set(prev); n.add(studentId); return n; });
    const date = todayDateStr();
    try {
      const res = await apiRequest(token, "/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ student_id: studentId, class_group_id: selectedGroup.id, date, status: newStatus }),
      });
      if (res.ok) {
        setDayViewAttState(prev => ({ ...prev, [studentId]: newStatus }));
        if (newStatus === "absent") {
          await loadDayMakeups(selectedGroup.id);
        } else {
          setDayMakeups(prev => prev.filter(m => !(m.student_id === studentId && m.absence_date === date)));
        }
      }
    } catch (e) { console.error(e); }
    finally { setDayViewAttSaving(prev => { const n = new Set(prev); n.delete(studentId); return n; }); }
  }, [token, selectedGroup, dayViewAttState, loadDayMakeups]);

  const handleMoveToClass = useCallback(async (toClassId: string) => {
    if (!moveStudent || !selectedGroup) return;
    setMoveSheetSaving(true);
    try {
      const res = await apiRequest(token, `/students/${moveStudent.id}/move-class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_class_id: selectedGroup.id, to_class_id: toClassId }),
      });
      if (res.ok) {
        setShowMoveSheet(false);
        setMoveStudent(null);
        load();
      }
    } catch (e) { console.error(e); }
    finally { setMoveSheetSaving(false); }
  }, [token, moveStudent, selectedGroup, load]);

  return {
    dayViewAttState,   setDayViewAttState,
    dayViewAttSaving,
    showMoveSheet,     setShowMoveSheet,
    moveStudent,       setMoveStudent,
    moveSheetSaving,
    dayMakeups,        dayMakeupsLoading,
    loadDayMakeups,
    markDayAtt,
    handleMoveToClass,
  };
}
