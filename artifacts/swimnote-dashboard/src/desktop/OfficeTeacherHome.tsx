import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { QState, arr, classIdsOf, type ClassGroup, type Student } from "./OfficeAppShared";

/** Teacher landing: own class groups (GET /class-groups is teacher-scoped by the server) and assigned students (GET /students). */
export function OfficeTeacherHome({ onNavigate }: { onNavigate?: (kind: "attendance" | "makeup-assignment" | "album" | "communication" | "notices") => void }) {
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const students = useQuery<Student[]>({ queryKey: ["oap", "teacher-students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    (students.data ?? []).forEach((s) => (classIdsOf(s) ?? []).forEach((id) => m.set(id, (m.get(id) ?? 0) + 1)));
    return m;
  }, [students.data]);
  const go = (k: "attendance" | "makeup-assignment" | "album" | "communication" | "notices", label: string) => <button onClick={() => onNavigate?.(k)} disabled={!onNavigate}>{label}</button>;
  return <div className="oap" data-testid="office-teacher-home">
    <div><h1>선생님 홈</h1><p className="oap-sub">담당 반과 배정된 회원</p></div>
    <div className="oap-row">{go("attendance", "출결")}{go("makeup-assignment", "보강")}{go("album", "앨범")}{go("communication", "소통")}{go("notices", "공지")}</div>
    <QState q={groups} /><QState q={students} />
    {!groups.isLoading && !groups.isError && ((groups.data ?? []).length === 0 ? <div className="oap-empty">담당 반이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>반</th><th>요일</th><th>시간</th><th>회원 수</th></tr></thead><tbody>
        {(groups.data ?? []).map((g) => <tr key={g.id}><td>{g.name}</td><td>{g.schedule_days ?? "-"}</td><td>{g.schedule_time ?? "-"}</td><td>{students.data ? counts.get(g.id) ?? 0 : "-"}</td></tr>)}</tbody></table></div>)}
    {students.data && <p className="oap-sub">{`배정된 회원 ${students.data.length}명`}</p>}
  </div>;
}
