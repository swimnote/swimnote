import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ParentLinkPanel } from "./OfficeParentLinkPanel";
import { Blocked, ContractError, QState, arr, errMsg, rec } from "./OfficeAppShared";

type Contact = { id: string; name: string; parent_name?: string | null; parent_phone?: string | null; parent_phone2?: string | null; parent_phone3?: string | null; parent_phone4?: string | null };

export function GuardianContacts({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [s, setS] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const [pn, setPn] = useState("");
  const [pp, setPp] = useState("");
  const [msg, setMsg] = useState("");
  const q = useQuery<Contact[]>({ queryKey: ["oap", "students-contacts"], queryFn: async () => {
    const rows = arr<Contact>(await api.get<unknown>("/students"), "GET /students");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.name !== "string") throw new ContractError("GET /students"); });
    return rows;
  } });
  const save = useMutation({
    mutationFn: async (id: string) => { if (rec(await api.patch<unknown>(`/students/${encodeURIComponent(id)}`, { parent_name: pn.trim(), parent_phone: pp.trim() }), "PATCH /students/:id").success !== true) throw new ContractError("PATCH /students/:id"); },
    onSuccess: () => { setMsg("보호자 연락처를 저장했습니다."); setEdit(null); qc.invalidateQueries({ queryKey: ["oap", "students-contacts"] }); qc.invalidateQueries({ queryKey: ["oap", "students"] }); },
    onError: (e) => setMsg(`저장 결과를 확인하세요: ${errMsg(e)}`),
  });
  const rows = (q.data ?? []).filter((r) => !s || r.name.includes(s) || (r.parent_name ?? "").includes(s));
  const submit = (r: Contact) => {
    if (save.isPending) return;
    if (window.confirm(`${r.name} 회원의 보호자 정보를 저장합니다. 같은 전화번호의 보호자 앱 계정이 있으면 서버가 자동으로 연결할 수 있습니다. 진행할까요?`)) save.mutate(r.id);
  };
  return <>
    {canEdit && <ParentLinkPanel />}
    <div className="oap-row"><input placeholder="회원 또는 보호자 이름 검색" value={s} onChange={(e) => setS(e.target.value)} style={{ maxWidth: 260 }} />{msg && <span className="oap-sub" role="status">{msg}</span>}</div>
    <Blocked>회원 등록 시 입력된 연락처 정보입니다. 앱 계정과 연결이 확인된 관계가 아니며, 추가 연락처는 보호자와 짝지어 표시하지 않습니다.</Blocked>
    <QState q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">표시할 연락처가 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>회원</th><th>등록된 보호자명</th><th>등록된 연락처</th><th>앱 계정 연결</th>{canEdit && <th />}</tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.name}</td>
          {edit === r.id ? <><td><input value={pn} onChange={(e) => setPn(e.target.value)} aria-label="보호자명" /></td><td><input value={pp} onChange={(e) => setPp(e.target.value)} aria-label="대표 연락처" /></td><td>연결 확인 보류</td>
            <td className="oap-row"><button disabled={save.isPending} onClick={() => submit(r)}>저장</button><button onClick={() => setEdit(null)}>취소</button></td></>
            : <><td>{r.parent_name || "-"}</td><td>{[r.parent_phone, r.parent_phone2, r.parent_phone3, r.parent_phone4].filter(Boolean).join(" / ") || "-"}</td><td>연결 확인 보류</td>
              {canEdit && <td><button onClick={() => { setEdit(r.id); setPn(r.parent_name ?? ""); setPp(r.parent_phone ?? ""); }}>수정</button></td>}</>}
        </tr>)}</tbody></table></div>)}
    <Blocked>보호자명과 대표 연락처(parent_phone)만 서버 PATCH /students/:id 로 수정할 수 있으며 pool_admin 전용입니다. 추가 연락처(parent_phone2~4)는 서버 PATCH가 받지 않아 수정할 수 없습니다. 앱 계정 연결은 위 연결 요청 목록에서 처리하며, 요청이 없는 보호자를 임의로 연결하는 API는 사용하지 않습니다.</Blocked>
  </>;
}
