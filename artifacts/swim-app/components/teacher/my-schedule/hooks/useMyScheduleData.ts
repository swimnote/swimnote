/**
 * useMyScheduleData — my-schedule 데이터 로딩 훅
 *
 * 분리 책임: class-groups / students / 오늘 출결·일지 fetch + state 관리
 * JSX / 렌더 흐름 / UI 로직은 건드리지 않음
 */
import { useCallback, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import { StudentItem, todayDateStr } from "../utils";

export function useMyScheduleData(token: string | null) {
  const [groups,        setGroups]        = useState<TeacherClassGroup[]>([]);
  const [students,      setStudents]      = useState<StudentItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [todayAttMap,   setTodayAttMap]   = useState<Record<string, number>>({});
  const [todayDiarySet, setTodayDiarySet] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const today = todayDateStr();
    try {
      const [cgRes, stRes, attRes, dRes] = await Promise.all([
        apiRequest(token, "/class-groups"),
        apiRequest(token, "/students"),
        apiRequest(token, `/attendance?date=${today}`),
        apiRequest(token, `/diary?date=${today}`),
      ]);
      if (cgRes.ok)  setGroups(await cgRes.json());
      if (stRes.ok)  setStudents(await stRes.json());
      if (attRes.ok) {
        const arr: any[] = await attRes.json();
        const map: Record<string, number> = {};
        arr.forEach(a => { const cid = a.class_group_id || a.class_id; if (cid) map[cid] = (map[cid] || 0) + 1; });
        setTodayAttMap(map);
      }
      if (dRes.ok) {
        const arr: any[] = await dRes.json();
        setTodayDiarySet(new Set(arr.map((d: any) => d.class_group_id).filter(Boolean)));
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  return {
    groups,        setGroups,
    students,      setStudents,
    loading,       setLoading,
    refreshing,    setRefreshing,
    todayAttMap,
    todayDiarySet,
    load,
  };
}
