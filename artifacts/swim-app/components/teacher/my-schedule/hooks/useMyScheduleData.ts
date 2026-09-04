/**
 * useMyScheduleData — my-schedule 데이터 로딩 훅
 *
 * 분리 책임: class-groups / students / 오늘 출결·일지 fetch + state 관리
 * JSX / 렌더 흐름 / UI 로직은 건드리지 않음
 */
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/context/AuthContext";
import { TeacherClassGroup } from "@/components/teacher/types";
import { StudentItem, todayDateStr } from "../utils";
import { onDiaryChanged } from "@/utils/diaryEvents";

/**
 * @param isSwitchingRole RoleContext.isSwitchingRole — true인 동안 fetch 금지 (stale admin JWT 방어)
 */
export function useMyScheduleData(token: string | null, isSwitchingRole = false) {
  const [groups,        setGroups]        = useState<TeacherClassGroup[]>([]);
  const [students,      setStudents]      = useState<StudentItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [todayAttMap,   setTodayAttMap]   = useState<Record<string, number>>({});
  const [todayDiarySet, setTodayDiarySet] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    // 역할 전환 중이면 구 admin JWT로 pool 전체 데이터를 fetch하지 않는다
    if (isSwitchingRole) return;
    const today = todayDateStr();
    try {
      const [cgRes, stRes, attRes, dRes] = await Promise.all([
        // ?mine=true: teacher JWT일 때 서버 mineOnly 분기를 명시적으로 강제
        // (pool_admin JWT가 잔류하더라도 서버가 own/co-teacher 반만 반환)
        apiRequest(token, "/class-groups?mine=true"),
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

  // 일지 생성/삭제 이벤트 구독 → todayDiarySet 즉시 갱신 (re-focus 없이도 동기화)
  useEffect(() => {
    return onDiaryChanged(ev => {
      const today = todayDateStr();
      if (ev.lessonDate !== today) return;
      setTodayDiarySet(prev => {
        const next = new Set(prev);
        if (ev.type === "deleted") next.delete(ev.classGroupId);
        else next.add(ev.classGroupId);
        return next;
      });
    });
  }, []);

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
