import { useEffect,useState } from "react";
import { api } from "../lib/api-client";
import { ui } from "./office-ops-styles";
import { useQueryClient } from "@tanstack/react-query";
import { useOfficeNavigate } from "./OfficeNavigation";
type Actor={userId:string;poolId:string;role?:string};
type Pointer={requestId:string;path:string;createdAt:string};
export async function recoveryOwner(actor:Actor){
  const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([actor.userId,actor.poolId])));
  return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,"0")).join("");
}
export function isSavedReceipt(path:string,r:any):boolean{
  if(!r||typeof r!=="object")return false;
  if(path.startsWith("/transport/")){
    const parts=path.split("/");
    if(parts[2]==="onboarding")return typeof r.id==="string"&&r.sent===false&&typeof r.inviteCode==="string";
    if(parts[2]==="planning"&&parts[3]==="ai-propose")return typeof r.id==="string"&&typeof r.source==="string"&&Array.isArray(r.plan?.steps);
    if(parts[2]==="planning")return Number.isInteger(r.revision)||Number.isInteger(r.settings?.revision);
    if(parts[2]==="operations")return typeof r.item?.id==="string"||typeof r.id==="string";
    if(parts[2]==="reconciliation")return r.id===parts[3]||r.item?.id===parts[3];
    if(parts[2]==="runs"&&parts[4]==="certify")return r.id===parts[3]&&r.status==="CERTIFIED"&&typeof r.hash==="string";
    if(path==="/transport/runs/save")return typeof r.item?.id==="string"&&Number.isInteger(r.item.revision);
    if(path==="/transport/memberships/invite")return typeof r.id==="string"&&r.status==="INVITED"&&typeof r.inviteCode==="string";
    if(parts[2]==="preferences")return r.studentId===parts[3]&&Number.isInteger(r.revision);
    if(parts[2]==="vehicles")return r.vehicleId===parts[3]&&Number.isInteger(r.revision);
    if(parts[2]==="runs")return r.id===parts[3]&&Number.isInteger(r.revision)&&["APPROVED","PUBLISHED","ACTIVE"].includes(r.status);
    return r.item?.id===parts[3]&&r.status==="REVOKED";
  }
  if(path==="/students")return r.success===false || (r.success===true&&typeof r.id==="string");
  if(path.startsWith("/office/operations/imports/")||path==="/office/operations/imports")return typeof r.item?.id==="string" || (Array.isArray(r.results)&&Number.isSafeInteger(r.revision));
  if(path.includes("/finance/batch/"))return Array.isArray(r.events)&&r.events.length>0&&r.events.every((e:any)=>typeof e?.id==="string")&&Number.isSafeInteger(r.version);
  if(path.includes("/finance/"))return typeof r.event?.id==="string"&&Number.isSafeInteger(r.version);
  if(path.endsWith("/nfc/scan"))return typeof r.attendance?.id==="string";
  return typeof r.item?.id==="string";
}
let currentActor:Actor|null=null;
export async function confirmRecoveryPointer(requestId:string,result:unknown){
  const bridge=window.officeDesktop?.pendingRequests,actor=currentActor;
  if(!bridge||!actor)return;
  const owner=await recoveryOwner(actor),rows=await bridge({op:"list",owner});
  const p=rows.find(x=>x.requestId===requestId);
  if(!p||!isSavedReceipt(p.path,result))return;
  await bridge({op:"finish",owner,requestId});
  window.dispatchEvent(new CustomEvent("office:receipt-recovered",{detail:{requestId,result}}));
  window.dispatchEvent(new Event("office:recovery-change"));
}
/** Native pointer is durably written BEFORE sending. No body replay or automatic retry. */
export async function recoverableWrite(actor:Actor,path:string,method:string,body:string|FormData|undefined,send:()=>Promise<unknown>){
  if(/^\/transport\/planning\/(calculate|interpret)$/.test(path))return send();
  if((!path.startsWith("/office/operations/")&&!path.startsWith("/transport/")&&path!=="/students")||method==="GET"||/(\/preview|\/prepare|\/interpret|(?<!\/transport\/reconciliation\/[A-Za-z0-9_-]+)\/resolve|\/catalog|\/recalculate)$/.test(path))return send();
  if(typeof body!=="string")return send();
  const data=JSON.parse(body);
  if(typeof data.requestId!=="string")return send();
  const bridge=window.officeDesktop?.pendingRequests;
  if(!bridge)throw {status:400,code:"OFFICE_RECOVERY_UNAVAILABLE",message:"재시작 복구 보관을 사용할 수 없어 요청을 보내지 않았습니다."};
  if(path==="/students"){
    let ready=false;
    try{ready=(await api.get<{memberCreationReceiptVersion?:number}>("/office/operations/capabilities")).memberCreationReceiptVersion===1;}catch{}
    if(!ready)throw {status:400,code:"OFFICE_MEMBER_RECOVERY_NOT_READY",message:"서버의 회원 생성 복구 계약 적용 대기입니다. 요청을 보내지 않았습니다."};
  }
  const owner=await recoveryOwner(actor);
  try{await bridge({op:"begin",owner,requestId:data.requestId,path});}
  catch{throw {status:409,code:"OFFICE_RECOVERY_BLOCKED",message:"미확인 요청 또는 복구 보관 오류입니다. 상단 처리 결과 확인에서 해결하세요. 새 요청은 보내지 않았습니다."};}
  window.dispatchEvent(new Event("office:recovery-change"));
  try{
    const result=await send();
    if(!isSavedReceipt(path,result))throw {status:502,message:"저장 응답을 확정할 수 없습니다. 영수증을 확인하세요."};
    await bridge({op:"finish",owner,requestId:data.requestId});
    return result;
  }catch(e:any){
    if(typeof e?.status==="number"&&e.status>=400&&e.status<500&&![408,429].includes(e.status)&&!["OFFICE_OUTCOME_UNKNOWN","OFFICE_RECOVERY_BLOCKED"].includes(e.code))
      await bridge({op:"finish",owner,requestId:data.requestId});
    throw e;
  }finally{window.dispatchEvent(new Event("office:recovery-change"));}
}
export function OfficeRecovery({actor}:{actor:Actor}){
  const [rows,setRows]=useState<Pointer[]>([]),[msg,setMsg]=useState(""),[busy,setBusy]=useState(false);
  const [recoveredMember,setRecoveredMember]=useState<string|null>(null);
  const qc=useQueryClient(),navigate=useOfficeNavigate();
  useEffect(()=>{
    currentActor=actor;
    let live=true;
    const load=async()=>{try{const owner=await recoveryOwner(actor),r=await window.officeDesktop?.pendingRequests?.({op:"list",owner});if(live){setRows(r??[]);setMsg("");}}catch{if(live)setMsg("복구 보관을 읽지 못했습니다. 기존 요청을 다시 실행하지 마세요.");}};
    void load();window.addEventListener("office:recovery-change",load);
    return()=>{live=false;currentActor=null;window.removeEventListener("office:recovery-change",load);};
  },[actor.userId,actor.poolId]);
  const check=async(p:Pointer)=>{
    setBusy(true);
    try{
      const r=await api.get(p.path.startsWith("/transport/")?`/transport/requests/${encodeURIComponent(p.requestId)}`:`/office/operations/receipts/${encodeURIComponent(p.requestId)}`);
      if(!isSavedReceipt(p.path,r) || (p.path==="/students"&&((r as any).kind!=="member.create"||(r as any).requestId!==p.requestId||(r as any).success!==true)))throw new Error("영수증 형식을 확정하지 못했습니다.");
      await confirmRecoveryPointer(p.requestId,r);
      if(p.path==="/students"){setRecoveredMember((r as any).id);qc.invalidateQueries({queryKey:["students"]});qc.invalidateQueries({queryKey:["ops-ref"]});}
      setRows(rs=>rs.filter(x=>x.requestId!==p.requestId));
      setMsg("서버 영수증으로 저장을 확인했습니다. 원래 화면에서 최신 목록을 조회하세요. 같은 저장을 다시 실행하지 마세요.");
    }catch{setMsg("처리 결과를 확정하지 못했습니다. 404·조회 실패는 미처리 증거가 아닙니다. 재전송 잠금을 유지합니다.");}
    finally{setBusy(false);}
  };
  if(!rows.length&&!msg&&!recoveredMember)return null;
  return <aside data-testid="office-recovery" style={{...ui.box,margin:8}} aria-label="기존 요청 결과 복구">
    <strong>이전 요청 처리 결과 확인</strong>
    {rows.map(p=><div key={p.requestId} style={{display:"flex",gap:8,alignItems:"center"}}>
      <span>{p.path.split("/")[3]} · {p.requestId.slice(0,8)} · {p.createdAt}</span>
      <button style={ui.btn2} disabled={busy} onClick={()=>check(p)}>영수증 조회 (재실행 안 함)</button></div>)}
    {msg&&<p role="status">{msg}</p>}
    {recoveredMember&&<button style={ui.btn2} onClick={()=>navigate(`/admin/members/${encodeURIComponent(recoveredMember)}`)}>확인된 회원 상세 열기 · 새로 등록하지 않음</button>}
  </aside>;
}
