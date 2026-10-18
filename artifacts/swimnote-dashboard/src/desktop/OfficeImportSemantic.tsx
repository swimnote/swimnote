import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {api} from "../lib/api-client";
import {TARGETS,type OpsItem} from "./office-ops-lib";
import {FINANCE_COLUMNS} from "./office-import-conversation";
import {ui} from "./office-ops-styles";
type Proposal={rules:Record<string,string>;financeRules?:Record<string,string>;question?:string;fingerprint?:string};
/** Optional semantic mapping proposal. No business Action, model retry, or general assistant. */
export function OfficeImportSemantic({scope,cur,files,text,headers,rules,financeRules,locked,onApply}:{
  scope:string;cur:OpsItem|null;files:unknown[];text:string;headers:string[];rules:Record<string,string>;financeRules:Record<string,string>;
  locked:boolean;onApply:(proposal:Proposal)=>void;
}){
  const [busy,setBusy]=useState(false),[proposal,setProposal]=useState<Proposal|null>(null),[message,setMessage]=useState("");
  const cap=useQuery({queryKey:["office-import-model",scope],queryFn:()=>api.get<{aiImportModelEnabled?:boolean}>("/office/operations/capabilities"),retry:false});
  const fingerprint=JSON.stringify([scope,cur?.id,cur?.revision,files,text,headers,rules,financeRules]);
  const latest=useRef(fingerprint);latest.current=fingerprint;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setProposal(null);setMessage("");},[fingerprint]);
  const ask=async()=>{
    if(!cur||locked||busy||cap.data?.aiImportModelEnabled!==true||!text.trim())return;
    if(JSON.stringify(files)!==JSON.stringify(cur.data.files)){setMessage("추가한 원본 파일을 먼저 저장한 후 의미 해석을 요청하세요.");return;}
    const sent=fingerprint;setBusy(true);setProposal(null);setMessage("");
    try{
      const r=await api.post<any>(`/office/operations/imports/${cur.id}/interpret`,{text,expectedRevision:cur.revision});
      if(!mounted.current||latest.current!==sent)return;
      if(r.kind!=="rules"){setMessage(r.message??"해석 결과를 확인하세요.");return;}
      const valid=(v:any,targets:readonly string[])=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.entries(v).every(([k,h])=>targets.includes(k)&&typeof h==="string"&&headers.includes(h));
      if(!valid(r.rules,TARGETS.map(t=>t[0]))||(r.financeRules&&!valid(r.financeRules,FINANCE_COLUMNS.map(t=>t[0]))))throw new Error("지원하지 않는 규칙 응답입니다.");
      setProposal({...r,fingerprint:sent});
    }catch(e:any){if(mounted.current&&latest.current===sent)setMessage(e?.message??"해석 결과 불명입니다. 자동 재시도하지 않습니다.");}
    finally{if(mounted.current)setBusy(false);}
  };
  return <section style={ui.box} data-testid="import-semantic">
    <strong>의미 해석 → 제한된 변환 규칙 제안</strong>
    <p>코드 연결: 구현됨 · 모델 실행: {cap.data?.aiImportModelEnabled===true?"ON · 실제 응답 미확인":"OFF"}.
      정형 문장은 위 일반 코드로 처리합니다. 이 경로는 저장된 원본의 열 매핑만 제안하며 회원 생성·금융 반영·SQL·일상 AI를 실행하지 않습니다.</p>
    <button style={ui.btn2} disabled={locked||busy||!cur||!text.trim()||cap.data?.aiImportModelEnabled!==true} onClick={ask}>
      {busy?"의미 해석 요청 중…":cap.data?.aiImportModelEnabled===true?"의미 해석 제안 요청 · 자동 적용 안 함":"의미 해석 연결 구현됨 · 모델 실행 OFF"}</button>
    {cap.isError&&<p role="alert">모델 실행 상태를 조회하지 못해 요청을 차단했습니다.</p>}
    {proposal&&<div data-testid="import-semantic-proposal">
      {proposal.question&&<p role="alert">{proposal.question} — 의견을 수정하면 이 제안은 폐기됩니다.</p>}
      <p>{files.length}개 파일·시트의 매핑 제안입니다. 기존 회원·금융·잔여권리 자료는 바꾸지 않습니다.</p>
      {Object.entries(proposal.rules).map(([k,v])=><p key={k}>회원 {k}: {rules[k]||"없음"} → {v}</p>)}
      {Object.entries(proposal.financeRules??{}).map(([k,v])=><p key={k}>금융 {k}: {financeRules[k]||"없음"} → {v}</p>)}
      <button style={ui.btn2} disabled={locked||!!proposal.question} onClick={()=>{if(latest.current!==proposal.fingerprint)return;onApply(proposal);setProposal(null);}}>확인한 제안을 규칙에 반영</button>
      <button style={ui.btn2} onClick={()=>setProposal(null)}>제안 취소</button>
    </div>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
