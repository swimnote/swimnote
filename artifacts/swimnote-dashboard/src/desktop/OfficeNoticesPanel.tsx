import { useEffect,useRef,useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { ContractError, Blocked, QState, arr, errMsg, rec } from "./OfficeAppShared";
import {OfficeOpsAiDraft} from "./OfficeOpsAiDraft";
import {useOfficeFormOwner,useOfficeFormState,useOfficeFormBridge,officeFormEpoch} from "./office-form-bridge";
import {isUnknown} from "./office-unknown";

type Notice = { id: string; title: string; content: string; author_name?: string; is_pinned: boolean; created_at: string };
type ReadStats = { read_count: number; unread_count: number; total: number };
type Form = { title: string; content: string; is_pinned: boolean };
const EMPTY: Form = { title: "", content: "", is_pinned: false };
type State={form:Form;editId:string|null;push:boolean;msg:string;locked:boolean;flight?:string;preview?:string};
type Write={id:string|null;form:Form;push:boolean;nonce:string;epoch:number};

/** pool_admin only (server: requireRole super_admin, pool_admin for POST/PATCH/DELETE/read-stats). */
export function NoticesPanel({ canManage }: { canManage: boolean }) {
  const owner=useOfficeFormOwner();
  if(!owner.scope)return null;
  return <NoticeEditor key={`${owner.scope}:${owner.role}`} scope={owner.scope} role={owner.role} hasX={owner.hasX} canManage={canManage&&owner.isAdmin}/>;
}
function NoticeEditor({scope,role,hasX,canManage}:{scope:string;role:string;hasX:boolean;canManage:boolean}){
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [state,setState]=useOfficeFormState<State>(`${scope}:${role}:notice`,{form:EMPTY,editId:null,push:true,msg:"",locked:false});
  const {form,editId,push,msg}=state,locked=state.locked||!!state.flight;
  const setMsg=(msg:string)=>setState(s=>({...s,msg}));
  const setForm=(form:Form)=>setState(s=>({...s,form,preview:undefined}));
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const q = useQuery<Notice[]>({ queryKey: ["oap", "notices",scope,role], queryFn: async () => arr<Notice>(await api.get<unknown>("/notices"), "GET /notices") });
  const stats = useQuery<ReadStats>({ queryKey: ["oap", "notice-stats",scope, open], enabled: !!open && canManage, queryFn: async () => {
    const o = rec(await api.get<unknown>(`/notices/${open}/read-stats`), "GET /notices/:id/read-stats");
    if (typeof o.read_count !== "number" || typeof o.unread_count !== "number" || typeof o.total !== "number") throw new ContractError("read-stats");
    return o as unknown as ReadStats;
  } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["oap", "notices"] });
  const save = useMutation({
    mutationFn: async (v:Write) => {
      if(!alive.current||v.epoch!==officeFormEpoch())throw {status:409,message:"이전 화면의 저장을 시작하지 않았습니다."};
      const fields={title:v.form.title.trim(),content:v.form.content.trim(),is_pinned:v.form.is_pinned};
      const o = v.id? await api.patch<unknown>(`/notices/${v.id}`,fields)
        : await api.post<unknown>("/notices", {...fields,image_urls:[],send_push:v.push});
      if (rec(o, v.id ? "PATCH /notices/:id" : "POST /notices").success !== true) throw new ContractError("공지 저장");
    },
    onSuccess: (_data,v) => {
      if(v.epoch!==officeFormEpoch())return;
      setState(s=>s.flight===v.nonce?{...s,msg:v.id?"공지 수정 응답을 확인했습니다.":"공지 등록 응답을 확인했습니다.",form:EMPTY,editId:null,flight:undefined,preview:undefined}:s);refresh();
    },
    onError: (e,v) => setState(s=>s.flight===v.nonce?{...s,flight:undefined,locked:isUnknown(e),msg:`저장 결과를 확인하세요: ${errMsg(e)}${isUnknown(e)?" — 재전송하지 말고 기존 작업 결과를 확인하세요.":""}`}:s),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { rec(await api.delete<unknown>(`/notices/${id}`), "DELETE /notices/:id"); },
    onSuccess: () => { setMsg("공지를 삭제했습니다."); setOpen(null); refresh(); },
    onError: (e) => setMsg(errMsg(e)),
  });
  const submit = () => {
    if (!form.title.trim() || !form.content.trim()) { setMsg("제목과 내용을 입력해주세요."); return; }
    if (locked||save.isPending||!canManage) return;
    if(state.preview!==fingerprint){preview();setMsg("미리보기의 대상·본문·알림 영향을 확인한 뒤 다시 저장하세요.");return;}
    const text = editId ? "공지를 수정합니다. 진행할까요?" : push ? "공지를 등록하고 학부모, 관리자, 선생님에게 푸시 알림을 발송합니다. 진행할까요?" : "공지를 알림 없이 등록합니다. 진행할까요?";
    if (window.confirm(text)){
      const v={id:editId,form:{...form},push,nonce:crypto.randomUUID(),epoch:officeFormEpoch()};
      if(setState(s=>({...s,flight:v.nonce})))save.mutate(v);
    }
  };
  const fingerprint=JSON.stringify([editId,form,push]);
  const preview=()=>{if(!locked)setState(s=>({...s,preview:fingerprint}));};
  const onDraft=(data:Record<string,unknown>)=>{
    if(locked)return;
    if(Object.keys(data).some(k=>!["title","content"].includes(k)||typeof data[k]!=="string"))throw new Error("공지 텍스트 초안만 허용합니다.");
    setState(s=>({...s,form:{...s.form,...data},preview:undefined,msg:"AI 초안을 입력했습니다. 저장·발송되지 않았습니다."}));
  };
  useOfficeFormBridge({scope,formKind:"notice",recordId:editId??undefined,fields:{title:form.title,content:form.content},token:fingerprint,
    locked,enabled:canManage,canSend:!editId&&push,onDraft,preview,submit});
  const items = q.data ?? [];
  return <>
    {canManage ? <div className="oap-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <OfficeOpsAiDraft formKind="notice" recordId={editId??undefined} hasX={hasX} locked={locked} draftContext={{title:form.title,content:form.content}} contextToken={fingerprint} onDraft={onDraft}/>
      <fieldset disabled={locked} style={{border:0,padding:0,display:"contents"}}>
      <input placeholder="공지 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <textarea rows={3} placeholder="공지 내용" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      <div className="oap-row">
        <label><input type="checkbox" checked={form.is_pinned} onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} /> 고정</label>
         {!editId && <label><input type="checkbox" checked={push} onChange={(e) => setState(s=>({...s,push:e.target.checked,preview:undefined}))} /> 푸시 알림 발송</label>}
         <button onClick={preview}>미리보기</button>
         <button onClick={submit} disabled={locked}>{state.flight ? "저장 중…" : editId ? "수정 저장" : "공지 등록"}</button>
         {editId && <button onClick={() => setState(s=>({...s,editId:null,form:EMPTY,preview:undefined}))}>수정 취소</button>}
      </div>
      </fieldset>
      {state.preview===fingerprint&&<section aria-label="공지 미리보기"><strong>{form.title}</strong><p style={{whiteSpace:"pre-wrap"}}>{form.content}</p><p>{editId?`수정 대상: ${editId} · 알림 재발송 없음`:push?"새 공지 · 기존 센터 수신 대상에게 푸시 발송":"새 공지 · 알림 없음"} · 고정 {form.is_pinned?"예":"아니오"}</p></section>}
      {msg&&<p role="status">{msg}</p>}
    </div> : <Blocked>공지 등록, 수정, 삭제와 읽음 현황은 서버에서 pool_admin 전용입니다. 선생님 역할은 조회만 가능합니다.</Blocked>}
    {canManage && <Blocked>사진 첨부는 이 화면에서 제공하지 않습니다. AI는 텍스트 초안만 입력하며 공지 수정은 알림을 재발송하지 않습니다.</Blocked>}
    <QState q={q} />
    {!q.isLoading && !q.isError && !items.length && <div className="oap-empty">등록된 공지사항이 없습니다.</div>}
    {items.map((n) => <div className="oap-card" key={n.id} style={{ padding: 12 }}>
      <button onClick={() => setOpen(open === n.id ? null : n.id)} aria-expanded={open === n.id}>{n.is_pinned ? "[고정] " : ""}{n.title}</button>
      <span className="oap-sub"> {n.author_name ?? ""} {n.created_at?.slice(0, 10)}</span>
      {open === n.id && <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{n.content}
        {canManage && <p className="oap-sub">{stats.isLoading ? "읽음 현황 조회 중…" : stats.data ? `읽음 ${stats.data.read_count} / 미읽음 ${stats.data.unread_count} / 전체 ${stats.data.total}` : stats.error ? errMsg(stats.error) : ""}</p>}
        {canManage && <div className="oap-row">
          <button disabled={locked||del.isPending} onClick={() => setState(s=>({...s,editId:n.id,form:{ title: n.title, content: n.content, is_pinned: n.is_pinned },preview:undefined}))}>수정</button>
          <button disabled={locked||del.isPending} onClick={() => { if (window.confirm(`'${n.title}' 공지를 삭제합니다. 되돌릴 수 없습니다. 삭제할까요?`)) del.mutate(n.id); }}>삭제</button>
        </div>}
      </div>}
    </div>)}
  </>;
}
