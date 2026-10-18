import { useEffect,useMemo,useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ContractError, QState, arr, errMsg, okFlag, rec, type Student } from "./OfficeAppShared";
import {OfficeOpsAiDraft} from "./OfficeOpsAiDraft";
import {useOfficeFormOwner,useOfficeFormState,useOfficeFormBridge,officeFormEpoch} from "./office-form-bridge";
import {isUnknown} from "./office-unknown";

type ParentRequest = { id: string; student_id: string; request_type: string; request_date: string | null; content: string | null; status: string; admin_note: string | null; created_at: string };
type RequestMessage = { id: string; request_id: string; sender_type: string; content: string | null; created_at: string };
const STATUS_LABEL: Record<string, string> = { pending: "대기", done: "완료", rejected: "거절" };
type Draft={reply:string;note:string;msg?:string;flight?:string;locked?:boolean;preview?:string};
const EMPTY:Draft={reply:"",note:""};
type Write={id:string;content:string;note:string;status?:"done"|"rejected"|"pending";nonce:string;epoch:number};

export function ParentRequestsPanel() {
  const owner=useOfficeFormOwner();if(!owner.scope)return null;
  return <RequestsEditor key={`${owner.scope}:${owner.role}`} {...owner}/>;
}
function RequestsEditor({scope,role,hasX,isAdmin}:{scope:string;role:string;hasX:boolean;isAdmin:boolean}){
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [drafts,setDrafts]=useOfficeFormState<Record<string,Draft>>(`${scope}:${role}:parent-reply`,{});
  const draft=sel?drafts[sel]??EMPTY:EMPTY,{reply,note,msg}=draft;
  const locked=!!draft.flight||!!draft.locked;
  const patch=(patch:Partial<Draft>)=>{if(sel)setDrafts(s=>({...s,[sel]:{...(s[sel]??EMPTY),...patch}}));};
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const students = useQuery<Student[]>({ queryKey: ["oap", "students",scope,role], queryFn: async () => arr<Student>(await api.get<unknown>("/students"), "GET /students") });
  const names = useMemo(() => new Map((students.data ?? []).map((s) => [s.id, s.name])), [students.data]);
  const q = useQuery<ParentRequest[]>({ queryKey: ["oap", "parent-requests",scope,role], queryFn: async () => {
    const rows = arr<ParentRequest>(await api.get<unknown>("/parent-requests"), "GET /parent-requests");
    rows.forEach((r) => { if (typeof r.id !== "string" || typeof r.status !== "string") throw new ContractError("GET /parent-requests"); });
    return rows;
  } });
  // Opened only by explicit click; the server marks parent messages as read by staff.
  const m = useQuery<RequestMessage[]>({ queryKey: ["oap", "pr-messages",sel,scope,role], enabled: !!sel, staleTime: 0, gcTime: 0, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/parent-requests/${encodeURIComponent(sel as string)}/messages`), "GET /parent-requests/:id/messages");
    if (o.success !== true || !Array.isArray(o.messages)) throw new ContractError("GET /parent-requests/:id/messages");
    return o.messages as RequestMessage[];
  } });
  const send = useMutation({
    mutationFn: async (v:Write) => {
      if(!alive.current||v.epoch!==officeFormEpoch())throw {status:409,message:"이전 화면의 발송을 시작하지 않았습니다."};
      const o = rec(await api.post<unknown>(`/parent-requests/${encodeURIComponent(v.id)}/messages`, { content: v.content }), "POST /parent-requests/:id/messages");
      if (o.success !== true) throw new ContractError("POST /parent-requests/:id/messages");
    },
    onSuccess: (_d, v) => {
      if(v.epoch!==officeFormEpoch())return;
      setDrafts(s=>s[v.id]?.flight===v.nonce?{...s,[v.id]:{...s[v.id],reply:s[v.id].reply.trim()===v.content?"":s[v.id].reply,msg:"답장 발송 응답을 확인했습니다.",flight:undefined,preview:undefined}}:s);
      qc.invalidateQueries({ queryKey: ["oap", "pr-messages", v.id] }); qc.invalidateQueries({ queryKey: ["oap", "parent-requests"] });
    },
    onError: (e,v) => setDrafts(s=>s[v.id]?.flight===v.nonce?{...s,[v.id]:{...s[v.id],flight:undefined,locked:isUnknown(e),msg:`답장 발송 결과를 확인하세요: ${errMsg(e)}${isUnknown(e)?" — 재전송하지 마세요.":""}`}}:s),
  });
  const setStatus = useMutation({
    mutationFn: async (v:Write) => {
      if(!alive.current||v.epoch!==officeFormEpoch())throw {status:409,message:"이전 화면의 상태 변경을 시작하지 않았습니다."};
      return okFlag(await api.patch<unknown>(`/parent-requests/${encodeURIComponent(v.id)}`, { status: v.status, admin_note: v.note.trim() || undefined }), "PATCH /parent-requests/:id");
    },
    onSuccess: (_d,v) => {
      if(v.epoch!==officeFormEpoch())return;
      setDrafts(s=>s[v.id]?.flight===v.nonce?{...s,[v.id]:{...s[v.id],note:s[v.id].note===v.note?"":s[v.id].note,msg:"상태 변경 응답을 확인했습니다.",flight:undefined,preview:undefined}}:s);
      qc.invalidateQueries({ queryKey: ["oap", "parent-requests"] });
    },
    onError: (e,v) => setDrafts(s=>s[v.id]?.flight===v.nonce?{...s,[v.id]:{...s[v.id],flight:undefined,locked:isUnknown(e),msg:errMsg(e)}}:s),
  });
  const open = (id: string) => {
    if (sel === id) { setSel(null); return; }
    if (window.confirm("대화를 열면 학부모가 보낸 메시지가 읽음으로 처리됩니다. 열까요?")) setSel(id);
  };
  const sendReply = () => {
    if (!sel || !reply.trim() || send.isPending||locked||m.isLoading||m.isError) return;
    if(draft.preview!==fingerprint){preview();patch({msg:"미리보기의 요청·회원·본문·알림 영향을 확인한 뒤 다시 발송하세요."});return;}
    if (window.confirm(`요청 ${sel} · ${names.get(cur?.student_id??"")??cur?.student_id}에 답장을 발송합니다. 학부모 앱으로 알림이 전달됩니다. 발송할까요?`)){
      const v={id:sel,content:reply.trim(),note,nonce:crypto.randomUUID(),epoch:officeFormEpoch()};
      patch({flight:v.nonce});send.mutate(v);
    }
  };
  const change = (status: "done" | "rejected" | "pending") => {
    if (!sel || setStatus.isPending||locked) return;
    const label = STATUS_LABEL[status];
    const notify = status !== "pending" ? " 상태가 바뀌면 학부모에게 결과 알림이 발송됩니다." : "";
    if (window.confirm(`요청 ${sel} 상태를 '${label}'(으)로 변경합니다.${notify} 진행할까요?`)){
      const v={id:sel,status,content:reply,note,nonce:crypto.randomUUID(),epoch:officeFormEpoch()};patch({flight:v.nonce});setStatus.mutate(v);
    }
  };
  const rows = q.data ?? [];
  const cur = rows.find((r) => r.id === sel);
  const fingerprint=JSON.stringify([sel,cur,reply,note,m.data]);
  const preview=()=>{if(!locked&&cur)patch({preview:fingerprint});};
  const onDraft=(data:Record<string,unknown>)=>{
    if(locked||!sel)return;
    if(Object.keys(data).some(k=>k!=="content"||typeof data[k]!=="string"))throw new Error("현재 요청의 답장 텍스트만 허용합니다.");
    patch({reply:String(data.content??reply),preview:undefined,msg:"AI 답장 초안을 입력했습니다. 발송되지 않았습니다."});
  };
  useOfficeFormBridge({scope,formKind:"parent-reply",recordId:sel??undefined,fields:{content:reply},token:fingerprint,locked,
    enabled:isAdmin&&!!cur&&!m.isLoading&&!m.isError,canSend:!!cur,onDraft,preview,submit:sendReply});
  return <>
    {msg && <span className="oap-sub" role="status">{msg}</span>}
    <QState q={q} />
    {!q.isLoading && !q.isError && (rows.length === 0 ? <div className="oap-empty">학부모 요청이 없습니다.</div>
      : <div className="oap-card"><table><thead><tr><th>접수일</th><th>회원</th><th>유형</th><th>요청일</th><th>내용</th><th>상태</th><th>관리자 메모</th><th /></tr></thead><tbody>
        {rows.map((r) => <tr key={r.id}><td>{r.created_at?.slice(0, 10) ?? "-"}</td><td>{names.get(r.student_id) ?? r.student_id}</td><td>{r.request_type}</td><td>{r.request_date ?? "-"}</td><td>{r.content ?? "-"}</td><td>{STATUS_LABEL[r.status] ?? r.status}</td><td>{r.admin_note ?? "-"}</td>
          <td><button aria-pressed={sel === r.id} onClick={() => open(r.id)}>대화 열기</button></td></tr>)}</tbody></table></div>)}
    {sel && cur && <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <QState q={m} />
      {!m.isLoading && !m.isError && (m.data && m.data.length > 0 ? m.data.map((x) => <p key={x.id} style={{ margin: "4px 0" }}><b>{x.sender_type}</b> {x.content ?? ""} <span className="oap-sub">{x.created_at?.slice(0, 16).replace("T", " ")}</span></p>) : <div className="oap-empty">대화 내역이 없습니다.</div>)}
      {isAdmin&&<OfficeOpsAiDraft formKind="parent-reply" recordId={sel} hasX={hasX} locked={locked||m.isLoading||m.isError} draftContext={{content:reply}} contextToken={fingerprint} onDraft={onDraft}/>}
      <textarea rows={2} disabled={locked} value={reply} onChange={(e) => patch({reply:e.target.value,preview:undefined})} placeholder="답장 내용" />
      <div className="oap-row"><button disabled={locked||m.isLoading||m.isError} onClick={preview}>답장 미리보기</button><button disabled={!reply.trim() || send.isPending||locked||m.isLoading||m.isError} onClick={sendReply}>{draft.flight ? "처리 중…" : "답장 발송"}</button></div>
      {draft.preview===fingerprint&&<section aria-label="답장 미리보기"><strong>요청 {sel} · 회원 {names.get(cur.student_id)??cur.student_id}</strong><p style={{whiteSpace:"pre-wrap"}}>{reply}</p><p>선택한 요청 대화에 저장하고 해당 학부모에게 알림을 전달합니다. 아직 발송되지 않았습니다.</p></section>}
      <input disabled={locked} value={note} onChange={(e) => patch({note:e.target.value,preview:undefined})} placeholder="처리 메모(거절 사유 등, 선택)" />
      <div className="oap-row">
        <button disabled={locked||setStatus.isPending || cur.status === "done"} onClick={() => change("done")}>완료 처리</button>
        <button disabled={locked||setStatus.isPending || cur.status === "rejected"} onClick={() => change("rejected")}>거절</button>
        <button disabled={locked||setStatus.isPending || cur.status === "pending"} onClick={() => change("pending")}>대기로 되돌림</button>
      </div>
    </div>}
  </>;
}
