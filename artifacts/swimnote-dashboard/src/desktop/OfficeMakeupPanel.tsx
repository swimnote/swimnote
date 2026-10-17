import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ContractError, QState, Blocked, arr, errMsg, okFlag, rec, type ClassGroup, type OfficeRole, type Student } from "./OfficeAppShared";

/** makeup_sessions row (SELECT ms.*). Names are resolved from /students and /class-groups, not from ms. */
type Makeup = { id: string; student_id: string; original_class_group_id: string | null; assigned_class_group_id: string | null; absence_date: string; assigned_date: string | null; status: string; expire_at?: string | null; is_expired?: boolean };
type EligibleClass = { id: string; name: string; schedule_days: string; schedule_time: string; capacity: number | null; instructor: string | null; current_members: number | string; available_slots: number | string; is_mine?: boolean; is_eligible?: boolean };
type Occurrence = { class_group_id: string; class_name: string; occurrence_date: string; schedule_time: string; teacher_name: string | null; available_slots: number; is_full: boolean; is_past: boolean; is_today: boolean; is_future: boolean };
type Occurrences = { makeup_id: string; absence_date: string; class_group_id: string; class_name: string; occurrences: Occurrence[] };
const STATUS: Record<string, string> = { waiting: "대기", assigned: "배정", completed: "완료", cancelled: "취소", expired: "만료", transferred: "이관", extinguished: "소멸" };
const REASONS = ["보강원하지않음", "무단결석", "기타"];

export function MakeupPanel({ role }: { role: OfficeRole }) {
  const qc = useQueryClient();
  const teacher = role === "teacher";
  const [tab, setTab] = useState<"waiting" | "assigned">("waiting");
  const [sel, setSel] = useState<string | null>(null);
  const [cls, setCls] = useState("");
  const [occ, setOcc] = useState("");
  const [msg, setMsg] = useState("");
  const [reason, setReason] = useState("");
  const [custom, setCustom] = useState("");
  const [allowExpired, setAllowExpired] = useState(false);

  const students = useQuery<Student[]>({ queryKey: ["oap", "students"], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
  const groups = useQuery<ClassGroup[]>({ queryKey: ["oap", "class-groups"], queryFn: async () => arr<ClassGroup>(await api.get<unknown>("/class-groups"), "GET /class-groups") });
  const listPath = teacher ? (tab === "waiting" ? "/teacher/makeups?status=waiting" : "/teacher/makeups/assigned") : `/admin/makeups?status=${tab}`;
  const list = useQuery<Makeup[]>({ queryKey: ["oap", "makeups", role, tab], queryFn: async () => {
    const rows = arr<Makeup>(await api.get<unknown>(listPath), `GET ${listPath}`);
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.student_id !== "string" || typeof r.status !== "string") throw new ContractError(`GET ${listPath}`); });
    return rows;
  } });
  const sName = useMemo(() => new Map((students.data ?? []).map((s) => [s.id, s.name])), [students.data]);
  const gName = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const rows = list.data ?? [];
  const target = rows.find((r) => r.id === sel);

  const elPath = teacher ? "/teacher/makeups/eligible-classes?all=true" : "/admin/makeups/eligible-classes";
  const eligible = useQuery<EligibleClass[]>({ queryKey: ["oap", "makeup-eligible", role], enabled: !!sel && tab === "waiting", queryFn: async () => {
    const rs = arr<EligibleClass>(await api.get<unknown>(elPath), `GET ${elPath}`);
    rs.forEach((r) => { if (typeof r.id !== "string" || typeof r.name !== "string") throw new ContractError(`GET ${elPath}`); });
    return rs;
  } });
  const occQ = useQuery<Occurrences>({ queryKey: ["oap", "makeup-occ", sel, cls], enabled: teacher && !!sel && !!cls && tab === "waiting", queryFn: async () => {
    const o = rec(await api.get<unknown>(`/teacher/makeups/${encodeURIComponent(sel as string)}/eligible-occurrences?class_group_id=${encodeURIComponent(cls)}`), "GET eligible-occurrences");
    if (!Array.isArray(o.occurrences)) throw new ContractError("GET eligible-occurrences");
    return o as unknown as Occurrences;
  } });
  const chosen = (occQ.data?.occurrences ?? []).find((o) => `${o.class_group_id}|${o.occurrence_date}` === occ);

  const done = (m: string) => { setMsg(m); setSel(null); setCls(""); setOcc(""); qc.invalidateQueries({ queryKey: ["oap", "makeups"] }); qc.invalidateQueries({ queryKey: ["makeups"] }); };
  const call = useMutation({
    mutationFn: async (v: { method: "PATCH" | "POST"; path: string; body?: unknown }) => {
      const res = v.method === "PATCH" ? await api.patch<unknown>(v.path, v.body ?? {}) : await api.post<unknown>(v.path, v.body ?? {});
      okFlag(res, v.path);
    },
    onError: (e) => setMsg(errMsg(e)),
  });
  const run = (label: string, confirmText: string, v: { method: "PATCH" | "POST"; path: string; body?: unknown }) => {
    if (call.isPending) return;
    if (window.confirm(confirmText)) call.mutate(v, { onSuccess: () => done(`${label} 처리했습니다.`) });
  };
  const nm = (m: Makeup) => sName.get(m.student_id) ?? "(이름 없음)";
  const cn = (id: string | null) => (id ? gName.get(id) ?? "-" : "-");

  const assign = () => {
    if (!target) return;
    if (teacher) {
      if (!chosen) return;
      run("보강 배정", `${nm(target)} 회원을 ${chosen.class_name} ${chosen.occurrence_date}에 배정합니다. 학부모 앱으로 보강 일정 알림이 발송됩니다. 진행할까요?`,
        { method: "PATCH", path: `/teacher/makeups/${target.id}/assign`, body: { class_group_id: chosen.class_group_id, assigned_date: chosen.occurrence_date, allow_expired: allowExpired } });
    }
  };
  const completeDirect = () => {
    if (!target || !chosen) return;
    run("보강 직접 완료", `${nm(target)} 회원의 ${chosen.occurrence_date} ${chosen.class_name} 보강을 출석 처리하여 완료합니다. 진행할까요?`,
      { method: "PATCH", path: `/teacher/makeups/${target.id}/complete-direct`, body: { date: chosen.occurrence_date, class_group_id: chosen.class_group_id, allow_expired: allowExpired } });
  };

  return <>
    <div className="oap-row">
      {(["waiting", "assigned"] as const).map((t) => <button key={t} aria-pressed={tab === t} onClick={() => { setTab(t); setSel(null); setCls(""); setOcc(""); }}>{t === "waiting" ? "보강 대기" : "배정됨"}</button>)}
      {msg && <span className="oap-sub" role="status">{msg}</span>}
    </div>
    <QState q={students} /><QState q={groups} /><QState q={list} />
    {!list.isLoading && !list.isError && (rows.length === 0 ? <div className="oap-empty">표시할 보강이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>원반</th><th>결석일</th><th>배정 반</th><th>보강일</th><th>상태</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{nm(r)}</td><td>{cn(r.original_class_group_id)}</td><td>{r.absence_date}</td><td>{cn(r.assigned_class_group_id)}</td><td>{r.assigned_date ?? "-"}</td><td>{STATUS[r.status] ?? r.status}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => { setSel(sel === r.id ? null : r.id); setCls(""); setOcc(""); setReason(""); setCustom(""); }}>선택</button></td></tr>)}</tbody></table></div>)}

    {target && teacher && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{nm(target)}</b><span className="oap-sub">결석일 {target.absence_date} / 상태 {STATUS[target.status] ?? target.status}</span>
      {tab === "waiting" && <>
        <QState q={eligible} />
        {!eligible.isLoading && !eligible.isError && <select value={cls} onChange={(e) => { setCls(e.target.value); setOcc(""); }} aria-label="보강 반">
          <option value="">반 선택</option>
          {(eligible.data ?? []).map((c) => <option key={c.id} value={c.id}>{`${c.name} (${c.schedule_days} ${c.schedule_time}) 여유 ${c.available_slots}${c.is_mine ? " / 내 반" : ""}`}</option>)}
        </select>}
        {cls && <QState q={occQ} />}
        {occQ.data && <select value={occ} onChange={(e) => setOcc(e.target.value)} aria-label="보강 회차">
          <option value="">회차 선택</option>
          {occQ.data.occurrences.map((o) => <option key={o.occurrence_date} value={`${o.class_group_id}|${o.occurrence_date}`} disabled={o.is_full}>{`${o.occurrence_date} ${o.schedule_time}${o.is_full ? " (정원 마감)" : ""}${o.is_today ? " (오늘)" : o.is_past ? " (지난 회차)" : ""}`}</option>)}
        </select>}
        <label><input type="checkbox" checked={allowExpired} onChange={(e) => setAllowExpired(e.target.checked)} /> 만료된 보강도 진행 허용</label>
        {chosen && <div className="oap-sub" role="status">{`미리보기: ${nm(target)} -> ${chosen.class_name} ${chosen.occurrence_date} ${chosen.schedule_time}`}</div>}
        <div className="oap-row">
          <button disabled={!chosen || call.isPending} onClick={assign}>보강 배정</button>
          <button disabled={!chosen || chosen.is_future || call.isPending} title={chosen?.is_future ? "미래 회차는 직접 완료할 수 없습니다" : undefined} onClick={completeDirect}>직접 완료</button>
        </div>
        <div className="oap-row">
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="소멸 사유"><option value="">소멸 사유</option>{REASONS.map((x) => <option key={x}>{x}</option>)}</select>
          {reason === "기타" && <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="사유 입력" />}
          <button disabled={!reason || (reason === "기타" && !custom.trim()) || call.isPending}
            onClick={() => run("결석 소멸", `${nm(target)} 회원의 결석을 소멸 처리합니다(${reason}). 진행할까요?`, { method: "POST", path: `/teacher/makeups/${target.id}/extinguish`, body: { cancelled_reason: reason, cancelled_custom: reason === "기타" ? custom.trim() : undefined } })}>결석 소멸</button>
        </div>
      </>}
      {tab === "assigned" && <div className="oap-row">
        <button disabled={call.isPending} onClick={() => run("배정 취소", `${nm(target)} 회원의 보강 배정을 취소하고 보강 대기로 되돌립니다. 진행할까요?`, { method: "PATCH", path: `/teacher/makeups/${target.id}/revert` })}>배정 취소</button>
        <button disabled={call.isPending} onClick={() => run("보강 완료", `${nm(target)} 회원의 보강을 완료 처리합니다. 진행할까요?`, { method: "PATCH", path: `/teacher/makeups/${target.id}/complete` })}>완료 처리</button>
      </div>}
    </div>}

    {target && !teacher && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{nm(target)}</b><span className="oap-sub">결석일 {target.absence_date} / 상태 {STATUS[target.status] ?? target.status}</span>
      <div className="oap-row">
        {target.status === "waiting" && <button disabled={call.isPending} onClick={() => run("만료", `${nm(target)} 회원의 보강을 만료 처리합니다. 진행할까요?`, { method: "PATCH", path: `/admin/makeups/${target.id}/status-override`, body: { target_status: "expired" } })}>만료 처리</button>}
        {target.status === "expired" && <button disabled={call.isPending} onClick={() => run("대기 복원", `${nm(target)} 회원의 보강을 대기 상태로 복원합니다. 진행할까요?`, { method: "PATCH", path: `/admin/makeups/${target.id}/status-override`, body: { target_status: "waiting" } })}>대기 복원</button>}
      </div>
    </div>}
    {!teacher && <Blocked>pool_admin 권한으로는 서버 경로 PATCH /admin/makeups/:id/assign, complete, revert, POST extinguish 가 super_admin 전용이고, 선생님용 /teacher/makeups 경로는 teacher 역할 전용입니다. 따라서 배정, 완료, 취소, 소멸은 서버 권한 변경 전까지 pool_admin 에서 제출할 수 없습니다. 이 제한은 우회하지 않습니다. 선생님 역할로 로그인하면 해당 처리를 사용할 수 있습니다.</Blocked>}
  </>;
}
