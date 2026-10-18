import { useEffect, useMemo, useRef,useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { SPECS, listOps, listAllOps, coerce, uuid, toCsv, download, type OpsItem, type OpsResource, type Ref, type Field } from "./office-ops-lib";
import { useLocation } from "wouter";
import { OfficeImportsPanel } from "./OfficeImportsPanel";
import { OfficeOpsAiDraft } from "./OfficeOpsAiDraft";
import { OfficeNfcPanel } from "./OfficeNfcPanel";
import { OfficeIntakePanel } from "./OfficeIntakePanel";
import { ui } from "./office-ops-styles";
import {useAuth} from "../contexts/AuthContext";
import { isUnknown,receiptItem } from "./office-unknown";
import { OfficeJourney } from "./OfficeJourney";
import {registerOfficeAiEditor} from "./office-ai-editor";

export type OpsView = "contacts" | "courses" | "sessions" | "imports" | "marketing" | "cards" | "applications" | "support" | "policies";
const VIEW: Record<OpsView, { title: string; res: OpsResource[] }> = {
  contacts: { title: "상담·체험·등록전환", res: ["contacts"] }, courses: { title: "상품·계약·수강", res: ["products", "contracts", "enrollments"] },
  sessions: { title: "수업 세션", res: ["sessions"] }, imports: { title: "엑셀 가져오기", res: ["imports"] },
  marketing: { title: "마케팅 수동 관리", res: ["marketing"] }, cards: { title: "출입 카드", res: ["cards"] },
  applications: { title: "태블릿 가입 신청·확정 양식", res: ["templates"] },
  support: {title:"운영지원",res:["support"]},policies:{title:"센터 운영 기준",res:["policies"]},
};
const {box,inp,btn,btn2}=ui;

const errText = (e: any) => e?.status === 409 ? `충돌: ${e.message ?? "시간·정원 또는 다른 사용자의 수정과 겹칩니다. 새로고침 후 다시 시도하세요."}` : e?.message ?? "요청 실패";

function useRefs(scopeKey:string) {
  const s = useQuery({ queryKey: ["ops-ref",scopeKey,"students"], queryFn: () => api.get<any>("/students") });
  const c = useQuery({ queryKey: ["ops-ref",scopeKey,"classes"], queryFn: () => api.get<any>("/class-groups") });
  const p = useQuery({ queryKey: ["ops-ref", scopeKey, "products"], queryFn: () => listAllOps("products"),staleTime:15000 });
  const k = useQuery({ queryKey: ["ops-ref", scopeKey, "contracts"], queryFn: () => listAllOps("contracts"),staleTime:15000 });
  const a = (x: any) => (Array.isArray(x) ? x : x?.students ?? x?.items ?? x?.data ?? []) as any[];
  const refs=useMemo(() => ({
    students: a(s.data).map(x => [String(x.id), x.name ?? x.id] as [string, string]),
    classes: a(c.data).map(x => [String(x.id), x.name ?? x.class_name ?? x.id] as [string, string]),
    products: (p.data?.items ?? []).map(x => [x.id, x.data.name] as [string, string]),
    contracts: (k.data?.items ?? []).map(x => [x.id, `${x.data.studentId?.slice(0, 6)} / ${x.data.startDate}`] as [string, string]),
  }), [s.data, c.data, p.data, k.data]) as Record<Ref, [string, string][]>;
  return {refs,error:s.error||c.error||p.error||k.error};
}

type Draft = { edit: OpsItem | "new" | null; form: Record<string, string>; reqId: string };
const drafts = new Map<string, Draft>();
const views=new Map<string,{search:string;q:string;offset:number;top:number;left:number}>();
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>{drafts.clear();views.clear();unsure.clear();});
/** Unknown-outcome writes retain identity and input, for receipt lookup only, never replay. */
const unsure = new Map<string, { reqId: string; body: string; target: string }>();

export function ResourceTable({ res,scopeKey,seed,draftKey="",onSaved,onContinue,canContinue,aiActive=true }: { res: Exclude<OpsResource, "imports">;scopeKey:string;seed?:{form:Record<string,string>;edit?:OpsItem};draftKey?:string;onSaved?:(item:OpsItem)=>void;onContinue?:(item:OpsItem)=>void;canContinue?:(item:OpsItem)=>boolean;aiActive?:boolean }) {
  const cacheKey=`${scopeKey}:${res}:${draftKey}`;
  const [, nav] = useLocation();
  const { state: auth } = useAuth(), hasX = auth.status === "authenticated" && auth.user.hasX;
  const spec = SPECS[res], qc = useQueryClient(), refState = useRefs(scopeKey),refs=refState.refs;
  const root=useRef<HTMLElement>(null);
  const v0=views.get(cacheKey);
  const [search, setSearch] = useState(v0?.search??""), [q, setQ] = useState(v0?.q??""), [offset, setOffset] = useState(v0?.offset??0);
  useEffect(()=>{views.set(cacheKey,{search,q,offset,top:views.get(cacheKey)?.top??0,left:views.get(cacheKey)?.left??0});},[cacheKey,search,q,offset]);
  const d0 = drafts.get(cacheKey);
  const [edit, setEdit] = useState<OpsItem | "new" | null>(d0?.edit ?? seed?.edit ?? (seed?"new":null)), [form, setForm] = useState<Record<string, string>>(d0?.form ?? seed?.form ?? {});
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [reqId, setReqId] = useState(d0?.reqId ?? uuid());
  const [lockMsg, setLockMsg] = useState(unsure.has(cacheKey) ? "이전 저장의 결과가 확인되지 않았습니다. 동일 내용·요청 ID 재확인 또는 처리 결과 확인이 필요합니다." : "");
  useEffect(() => { if (edit) drafts.set(cacheKey, { edit, form, reqId }); else drafts.delete(cacheKey); }, [cacheKey, edit, form, reqId]);
  const list = useQuery({ queryKey: ["ops",scopeKey,res,q,offset], queryFn: () => listOps(res, q, offset), retry: false });
  const label = (f: Field, v: any) => f.type === "ref" ? (refs[f.ref!].find(([i]) => i === v)?.[1] ?? v) : f.type === "select" ? (f.options!.find(([i]) => i === v)?.[1] ?? v) : v;
  useEffect(()=>{
    if(!edit||!aiActive||unsure.has(cacheKey))return;
    return registerOfficeAiEditor({scope:scopeKey,resource:res,recordId:edit==="new"?undefined:edit.id,memberId:form.studentId,
      token:JSON.stringify([reqId,form]),stage:data=>{
        if(unsure.has(cacheKey))throw new Error("미확인 저장이 있어 현재 양식의 초안을 변경하지 않았습니다.");
        setForm(f=>({...f,...Object.fromEntries(Object.entries(data).filter(([k,v])=>spec.fields.some(x=>x.key===k)&&v!==null&&v!==undefined).map(([k,v])=>[k,String(v)]))}));
        setReqId(uuid());setMsg("일상 AI 초안을 현재 양식에 채웠습니다. 미저장입니다. 대상과 필드를 확인하고 저장하세요.");
      }});
  },[edit,form,reqId,scopeKey,res,aiActive,cacheKey,unsure.has(cacheKey)]);
  const open = (it: OpsItem | "new") => { if (unsure.has(cacheKey) && edit) return setMsg("미확인 저장이 있습니다. 먼저 해결하세요."); setEdit(it); setMsg(""); setReqId(uuid()); setForm(it === "new" ? (seed&&!seed.edit?{...seed.form}:{}) : Object.fromEntries(Object.entries(it.data).map(([k, v]) => [k, String(v ?? "")]))); };
  const save = async () => {
    const miss = spec.fields.find(f => f.req && !form[f.key]?.trim());
    if (miss) return setMsg(`${miss.label}을(를) 입력하세요.`);
    const data = coerce(spec.fields, form);
    const target = edit === "new" ? "new" : (edit as OpsItem).id;
    const body = JSON.stringify(data);
    const pend = unsure.get(cacheKey);
    if (pend) return setMsg("이전 저장 결과가 미확인입니다. 재전송하지 않고 서버 처리 결과 확인만 가능합니다.");
    const id = reqId;
    unsure.set(cacheKey,{reqId:id,body,target});
    setBusy(true); setMsg("");
    try {
      const result=edit==="new"?await api.post<{item:OpsItem}>(`/office/operations/${res}`,{requestId:id,data}):
        await api.patch<{item:OpsItem}>(`/office/operations/${res}/${(edit as OpsItem).id}`,{requestId:id,expectedRevision:(edit as OpsItem).revision,data});
      if(!result?.item?.id)throw {status:502,message:"저장 결과를 확인하지 못했습니다."};
       unsure.delete(cacheKey); setLockMsg(""); setEdit(null); setReqId(uuid()); qc.invalidateQueries({ queryKey: ["ops"] });qc.invalidateQueries({queryKey:["ops-ref"]});
      setMsg("저장했습니다. 다음 작업을 이어갈 수 있습니다.");onSaved?.(result.item);
    } catch (e: any) {
       if (!isUnknown(e)) { unsure.delete(cacheKey); setLockMsg(""); setReqId(uuid()); setMsg(errText(e)); }
       else { unsure.set(cacheKey, { reqId: id, body, target }); setLockMsg("저장 결과를 확인하지 못했습니다. 새 저장을 막고 서버 영수증 조회만 허용합니다."); setMsg(errText(e)); }
    } finally { setBusy(false); }
  };
  const discardUnknown = async () => {
    try {
      const receipt=await receiptItem(unsure.get(cacheKey)?.reqId??reqId) as {item?:OpsItem}|null;
      if(!receipt?.item) {setMsg("확정된 처리 결과가 없습니다. 동일 요청 ID와 내용을 유지합니다.");return;}
      unsure.delete(cacheKey);setLockMsg("");setEdit(null);setReqId(uuid());qc.invalidateQueries({queryKey:["ops"]});qc.invalidateQueries({queryKey:["ops-ref"]});setMsg("서버 처리 영수증으로 저장을 확인했습니다.");
      onSaved?.(receipt.item);
    } catch {setMsg("결과를 확정하지 못했습니다. 조회 실패·기록 없음은 미처리 증거가 아닙니다. 동일 요청 ID와 내용을 유지합니다.");}
  };
  const items = list.data?.items ?? [];
  useEffect(()=>{const h=(e:Event)=>{if(unsure.get(cacheKey)?.reqId===(e as CustomEvent).detail?.requestId)void discardUnknown();};
    window.addEventListener("office:receipt-recovered",h);return()=>window.removeEventListener("office:receipt-recovered",h);});
  const rows = () => items.map(i => [i.id, i.revision, ...spec.fields.map(f => i.data[f.key])]);
  const head = ["id", "revision", ...spec.fields.map(f => f.label)];
  const print = () => {root.current?.setAttribute("data-resource-print","");try{window.print();}finally{root.current?.removeAttribute("data-resource-print");}};
  return <section ref={root} style={{ ...box, display: "flex", flexDirection: "column", gap: 8 }} data-testid={`ops-${res}`}>
    <style>{`@media print{body:has([data-resource-print]) *{visibility:hidden}[data-resource-print],[data-resource-print] *{visibility:visible}[data-resource-print]{position:absolute;left:0;top:0;width:100%}[data-resource-print] button,[data-resource-print] input,[data-resource-print] [data-resource-editor]{display:none!important}[data-resource-print] div{max-height:none!important;overflow:visible!important}}`}</style>
    <small>검색 조건: {q||"전체"} · 현재 페이지 {offset+1}~{offset+items.length}</small>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <strong>{spec.title}</strong><span style={{ color: "var(--text-muted)", fontSize: 12 }}>총 {list.data?.total ?? 0}건</span>
      <input style={{ ...inp, marginLeft: "auto" }} placeholder="검색" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { setQ(search); setOffset(0); } }} />
      <button style={btn2} onClick={() => { setQ(search); setOffset(0); }}>검색</button>
      <button style={btn2} disabled={!items.length} onClick={() => download(`${res}.csv`, toCsv(head, rows()))}>현재 페이지 CSV</button>
      <button style={btn2} disabled={!items.length} onClick={print}>인쇄</button>
      <button style={btn} onClick={() => open("new")}>새로 등록</button>
    </div>
    {res === "cards" && <p role="note" style={{ fontSize: 12, color: "var(--color-warning)" }}>실제 카드 리더기 연동은 검증되지 않았습니다(NOT VERIFIED). UID는 수동 등록이며 출결은 기존 수동 출결 화면(/admin/attendance)에서 처리합니다.</p>}
    {res === "marketing" && <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>외부 채널 자동 게시는 하지 않습니다. 수동 게시 일정·URL만 기록합니다.</p>}
    {res === "contacts" && <p role="note" style={{ fontSize: 12, color: "var(--text-muted)" }}>등록 전환은 <a href="/admin/members/new" onClick={e => { e.preventDefault(); nav("/admin/members/new"); }}>회원 등록</a>으로 실제 회원을 만든 뒤 아래에서 연결 회원을 선택해 단계를 &lsquo;등록됨&rsquo;으로 저장하세요.</p>}
    {list.isLoading && <div style={{ height: 80, background: "var(--surface-subtle)", borderRadius: 4 }} />}
    {list.isError && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>
      {(list.error as any)?.status === 404 || (list.error as any)?.status === 503 ? "서버 운영 스키마 마이그레이션이 아직 적용되지 않았습니다. 작성 중 내용은 보존되며 목록은 표시하지 않습니다." : errText(list.error)}
      <button style={{ ...btn2, marginLeft: 8 }} onClick={() => list.refetch()}>다시 시도</button></div>}
    {list.data && <div style={{ overflow: "auto",maxHeight:480 }} ref={el=>{if(el){el.scrollTop=views.get(cacheKey)?.top??0;el.scrollLeft=views.get(cacheKey)?.left??0;}}} onScroll={e=>{const v=views.get(cacheKey);if(v)views.set(cacheKey,{...v,top:e.currentTarget.scrollTop,left:e.currentTarget.scrollLeft});}}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead><tr>{spec.fields.filter(f => spec.list.includes(f.key)).map(f => <th key={f.key} style={{ textAlign: "left", padding: 6, borderBottom: "1px solid var(--border-strong)", whiteSpace: "nowrap" }}>{f.label}</th>)}<th /></tr></thead>
      <tbody>{items.map(i => <tr key={i.id}>{spec.fields.filter(f => spec.list.includes(f.key)).map(f => <td key={f.key} style={{ padding: 6, borderBottom: "1px solid var(--border-default)" }}>{String(label(f, i.data[f.key]) ?? "")}</td>)}
        <td style={{ padding: 6, textAlign: "right" }}><button style={btn2} onClick={() => open(i)}>수정</button>{onContinue&&(!canContinue||canContinue(i))&&<button style={btn2} onClick={()=>onContinue(i)}>다음 업무 이어가기</button>}</td></tr>)}
        {!items.length && <tr><td colSpan={9} style={{ padding: 16, color: "var(--text-muted)" }}>저장된 항목이 없습니다.</td></tr>}</tbody></table></div>}
    <div style={{ display: "flex", gap: 6 }}>
      <button style={btn2} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>이전</button>
      <button style={btn2} disabled={!list.data?.has_more} onClick={() => setOffset(offset + 100)}>다음</button>
    </div>
    {edit && <div data-resource-editor style={{ ...box, background: "var(--surface-off)" }}>
      <strong>{edit === "new" ? "새 항목" : `수정 (rev ${edit.revision})`}</strong>
      <OfficeOpsAiDraft key={`${cacheKey}:${edit === "new" ? "new" : edit.id}`} resource={res} recordId={edit === "new" ? undefined : edit.id} hasX={hasX} locked={unsure.has(cacheKey)}
        contextToken={JSON.stringify([form,reqId])}
        onDraft={d => { if (unsure.has(cacheKey)) return; setForm(f => ({ ...f, ...Object.fromEntries(Object.entries(d).filter(([k, v]) => spec.fields.some(x => x.key === k) && v !== null && v !== undefined).map(([k, v]) => [k, String(v)])) })); setReqId(uuid()); setMsg("AI 초안을 채웠습니다. 확인 후 저장하세요."); }} />
      {refState.error&&<p role="alert">대상 참조 조회 실패: {errText(refState.error)}</p>}
      <fieldset disabled={busy||!!lockMsg} style={{border:0,padding:0,display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 8, margin: "8px 0" }}>
        {spec.fields.map(f => <label key={f.key} style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>{f.label}{f.req && " *"}
          {f.type==="textarea"?<textarea rows={5} style={inp} value={form[f.key]??""} onChange={e=>setForm({...form,[f.key]:e.target.value})} />:f.type === "select" || f.type === "ref"
            ? <select style={inp} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })}><option value="">선택</option>
              {(f.type === "select" ? f.options! : refs[f.ref!]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            : <input style={inp} type={f.type ?? "text"} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}</label>)}
      </fieldset>
      {lockMsg && <div role="alert" style={{ color: "var(--color-warning)", fontSize: 13 }}>{lockMsg} <button style={btn2} onClick={discardUnknown}>서버 처리 결과 확인</button></div>}
      {msg && <div role="alert" style={{ color: "var(--color-error)", fontSize: 13 }}>{msg}</div>}
      <div style={{ display: "flex", gap: 6,position:"sticky",bottom:0,background:"var(--surface-off)",padding:8 }}><button style={btn} disabled={busy||!!lockMsg} onClick={save}>{busy ? "저장 중…" : "저장"}</button><button style={btn2} disabled={busy||!!lockMsg} onClick={() => setEdit(null)}>취소</button></div>
    </div>}
  </section>;
}

export function OfficeOperationsPanel({ view }: { view: OpsView }) {
  const {state}=useAuth();
  const scopeKey=state.status==="authenticated"?`${state.user.id}:${state.user.swimming_pool_id}`:"unauthenticated";
  const v = VIEW[view];
  const [tab, setTab] = useState(v.res[0]);
  const [journey,setJourney]=useState<OpsItem|null>(null);
  useEffect(() => {setTab(v.res[0]);setJourney(null);}, [view,scopeKey]);
  const cap = useQuery({ queryKey: ["ops-cap"], queryFn: () => api.get<{ available: boolean; schemaVersion: number; resources: string[] }>("/office/operations/capabilities"), retry: false });
  return <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
    <h1 style={{ fontSize: 18 }}>{v.title}</h1>
    {cap.isError && <div role="alert" style={{ ...box, color: "var(--color-error)" }}>운영 API에 연결할 수 없습니다: {errText(cap.error)} <button style={btn2} onClick={() => cap.refetch()}>다시 시도</button></div>}
    {cap.data && !cap.data.available && <div role="alert" style={{ ...box, color: "var(--color-warning)" }}>서버 마이그레이션 대기 중입니다. 저장 목록은 표시하지 않으며 입력 중인 내용은 이 화면에서 유지됩니다.</div>}
    {cap.data?.available && <>
      {view === "applications" && <OfficeIntakePanel key={scopeKey} scopeKey={scopeKey} />}
      {view === "cards" && <OfficeNfcPanel key={scopeKey} scopeKey={scopeKey} />}
      {v.res.length > 1 && <div style={{ display: "flex", gap: 4 }}>{v.res.map(r => <button key={r} style={tab === r ? btn : btn2} onClick={() => {setTab(r);setJourney(null);}}>{SPECS[r as Exclude<OpsResource, "imports">].title}</button>)}</div>}
      {journey&&<section style={box}><button style={btn2} onClick={()=>setJourney(null)}>연속 작업 접기 · 목록으로</button>
        {tab==="marketing"?<>
          <h2>캠페인 참여·소개·유입 기록</h2><p>참여 사실은 홍보 사용 동의가 아닙니다. 게시·자료 사용 근거는 원 캠페인에서 별도로 기록합니다. 외부 자동 연동이나 게시·신청 전송은 하지 않습니다.</p>
          <ResourceTable key={`campaign-${journey.id}`} res="contacts" scopeKey={scopeKey} draftKey={`campaign-${journey.id}`}
            seed={{form:{campaignId:journey.id,source:journey.data.channel??"",stage:"inquiry"}}}/>
        </>:tab==="cards"?<>
          <h2>분실·폐기 카드의 재발급 등록</h2><p>기존 카드 {journey.id}는 {journey.data.status} 상태로 보존합니다. 같은 회원을 전달했으며 새 카드 UID를 입력·저장해야 합니다. 기존 카드를 재활성화하거나 알림을 자동 발송하지 않습니다.</p>
          <ResourceTable key={`reissue-${journey.id}`} res="cards" scopeKey={scopeKey} draftKey={`reissue-${journey.id}`}
            seed={{form:{studentId:journey.data.studentId,status:"active",note:`분실/폐기 카드 ${journey.id}의 재발급`}}}/>
        </>:tab==="support"?<>
          <h2>{journey.data.name} · 센터 참가 명단 기록</h2><p>원 대회 ID를 전달했습니다. 실제 회원을 선택해 센터 참가 기록을 저장하세요. 주최측 접수 확정·경기 운영·외부 신청 전송이 아닙니다.</p>
          <ResourceTable key={`competition-${journey.id}`} res="support" scopeKey={scopeKey} draftKey={`competition-${journey.id}`}
            seed={{form:{competitionId:journey.id,name:`${journey.data.name} 참가`,kind:"competition",status:"planned",dueDate:journey.data.dueDate??""}}}/>
        </>:<OfficeJourney key={journey.id} scope={scopeKey} contact={tab==="contacts"?journey:undefined} contract={tab==="contracts"?journey:undefined}/>}
      </section>}
      <div hidden={!!journey}>{tab === "imports" ? <OfficeImportsPanel key={scopeKey} scopeKey={scopeKey} /> : <ResourceTable key={`${scopeKey}:${tab}`} scopeKey={scopeKey} res={tab as Exclude<OpsResource, "imports">}
        aiActive={!journey}
        onContinue={["contacts","contracts","marketing","support","cards"].includes(tab)?setJourney:undefined}
        canContinue={tab==="support"?item=>item.data.kind==="competition"&&!item.data.competitionId:tab==="cards"?item=>["lost","revoked"].includes(item.data.status):undefined}
        onSaved={["contacts","contracts"].includes(tab)?setJourney:undefined}/>}</div>
    </>}
  </div>;
}
