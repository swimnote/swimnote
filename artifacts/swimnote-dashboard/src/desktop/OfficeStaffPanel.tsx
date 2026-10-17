import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { Blocked, ContractError, QState, arr, errMsg, rec } from "./OfficeAppShared";

type Teacher = { id: string; name: string; email?: string; phone?: string; is_activated?: boolean; is_admin_self_teacher?: boolean };

export function StaffPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", phone: "", position: "" });
  const [msg, setMsg] = useState("");
  const [nf, setNf] = useState({ name: "", email: "", phone: "", password: "", self: false });
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const submitting = useRef(false);
  const q = useQuery<Teacher[]>({ queryKey: ["oap", "teachers"], queryFn: async () => arr<Teacher>(await api.get<unknown>("/teachers"), "GET /teachers") });
  const ok = (o: unknown, w: string) => { if (rec(o, w).success !== true) throw new ContractError(w); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["oap", "teachers"] });
  const save = useMutation({
    mutationFn: async (id: string) => ok(await api.patch<unknown>(`/teachers/${encodeURIComponent(id)}`, { name: f.name.trim() || undefined, phone: f.phone.trim() || undefined, position: f.position.trim() || undefined }), "PATCH /teachers/:id"),
    onSuccess: () => { setMsg("강사 정보를 저장했습니다."); setEdit(null); refresh(); },
    onError: (e) => setMsg(`저장 결과를 확인하세요: ${errMsg(e)}`),
  });
  const del = useMutation({
    mutationFn: async (id: string) => ok(await api.delete<unknown>(`/teachers/${encodeURIComponent(id)}`), "DELETE /teachers/:id"),
    onSuccess: () => { setMsg("강사를 삭제했습니다."); refresh(); },
    onError: (e) => setMsg(`삭제 결과를 확인하세요: ${errMsg(e)}`),
  });
  const create = useMutation({
    mutationFn: async () => {
      const o = rec(await api.post<unknown>("/teachers", { name: nf.name.trim(), email: nf.email.trim(), phone: nf.phone.trim(), password: nf.password, is_admin_self_teacher: nf.self }), "POST /teachers");
      const t = rec(o.teacher, "POST /teachers");
      if (typeof t.id !== "string" || typeof o.activation_code !== "string") throw new ContractError("POST /teachers");
      return { name: String(t.name), code: o.activation_code };
    },
    onSuccess: (r) => { setCode(r); setNf({ name: "", email: "", phone: "", password: "", self: false }); setMsg("강사 계정을 생성했습니다. 인증코드를 선생님에게 전달하세요."); refresh(); },
    onError: (e) => setMsg(`생성 결과를 확인하세요: ${errMsg(e)}`),
    onSettled: () => { submitting.current = false; },
  });
  const submitCreate = () => {
    if (submitting.current) return;
    if (!nf.name.trim() || !nf.email.trim() || !nf.phone.trim() || !nf.password) { setMsg("이름, 이메일, 연락처, 비밀번호를 모두 입력하세요."); return; }
    if (nf.password.length < 6) { setMsg("비밀번호는 6자 이상이어야 합니다."); return; }
    if (!/^\S+@\S+\.\S+$/.test(nf.email.trim())) { setMsg("이메일 형식이 올바르지 않습니다."); return; }
    if (!window.confirm(`${nf.name.trim()} (${nf.email.trim()}) 새 ${nf.self ? "관리자 본인용 " : ""}선생님 로그인 계정을 실제로 생성합니다. 계정은 24시간 유효한 인증코드로 활성화됩니다. 생성할까요?`)) return;
    submitting.current = true; create.mutate();
  };
  const rows = q.data ?? [];
  return <>
    {canManage && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <b>강사 계정 생성</b>
      <div className="oap-row">
        <input placeholder="이름" value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} autoComplete="off" />
        <input placeholder="이메일" type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} autoComplete="off" />
        <input placeholder="연락처" value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} autoComplete="off" />
        <input placeholder="비밀번호(6자 이상)" type="password" value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} autoComplete="new-password" />
        <label><input type="checkbox" checked={nf.self} onChange={(e) => setNf({ ...nf, self: e.target.checked })} /> 관리자 본인용(1개만)</label>
        <button disabled={create.isPending} onClick={submitCreate}>{create.isPending ? "생성 중…" : "계정 생성"}</button>
      </div>
      {code && <div className="oap-note" role="status">{`${code.name} 인증코드: ${code.code} (24시간 유효, 이 화면에서만 표시됩니다)`} <button onClick={() => setCode(null)}>닫기</button></div>}
    </div>}
    {msg && <span className="oap-sub" role="status">{msg}</span>}
    <QState q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">등록된 강사가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>이름</th><th>이메일</th><th>연락처</th><th>상태</th>{canManage && <th />}</tr></thead><tbody>
        {rows.map((t) => <tr key={t.id}>
          {edit === t.id ? <><td><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="이름" /></td><td>{t.email ?? "-"}</td><td><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} aria-label="연락처" /> <input value={f.position} placeholder="직책" onChange={(e) => setF({ ...f, position: e.target.value })} aria-label="직책" /></td><td>{t.is_activated ? "활성" : "미활성"}</td>
            <td className="oap-row"><button disabled={save.isPending} onClick={() => { if (!save.isPending && window.confirm("강사 정보를 저장합니다. 진행할까요?")) save.mutate(t.id); }}>저장</button><button onClick={() => setEdit(null)}>취소</button></td></>
            : <><td>{t.name}{t.is_admin_self_teacher ? " (관리자 겸임)" : ""}</td><td>{t.email ?? "-"}</td><td>{t.phone ?? "-"}</td><td>{t.is_activated ? "활성" : "미활성"}</td>
              {canManage && <td className="oap-row"><button onClick={() => { setEdit(t.id); setF({ name: t.name, phone: t.phone ?? "", position: "" }); }}>수정</button>
                <button disabled={del.isPending || !!t.is_admin_self_teacher} onClick={() => { if (window.confirm(`${t.name} 강사 계정을 삭제합니다. 담당 반의 담당자가 비워지고 계정은 복구할 수 없습니다. 삭제할까요?`)) del.mutate(t.id); }}>삭제</button></td>}</>}
        </tr>)}</tbody></table></div>)}
    <Blocked>{canManage ? "이름, 연락처, 직책 수정과 삭제는 서버에서 pool_admin 전용입니다. 앱에 별도의 비활성화나 역할 변경 API가 없어 연결하지 않았습니다. 초대와 비밀번호 변경은 강사 관리 화면에서 처리합니다." : "선생님 역할은 강사 목록 조회만 가능합니다."}</Blocked>
  </>;
}
