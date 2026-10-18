import { useSyncExternalStore,type Dispatch,type SetStateAction } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOfficeNavigate } from "@/desktop/OfficeNavigation";
type Period={year:number;month:number};
const pageStates=new Map<string,unknown>();
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(fn=>fn());
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>{pageStates.clear();notify();});
export function useReportPageState<T>(name:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
  const {state}=useAuth();
  const key=`${state.status==="authenticated"?`${state.user.id}:${state.user.swimming_pool_id}`:"anonymous"}:${name}`;
  if(!pageStates.has(key))pageStates.set(key,initial);
  const value=useSyncExternalStore(subscribe,()=>pageStates.get(key) as T);
  const update:Dispatch<SetStateAction<T>>=next=>{
    const prev=pageStates.has(key)?pageStates.get(key) as T:initial;
    const n=typeof next==="function"?(next as (v:T)=>T)(prev):next;
    if(Object.is(prev,n))return;
    pageStates.set(key,n);notify();
  };
  return [value,update];
}
export function useReportPeriod(year:number,month:number){
  const [period,setPeriod]=useReportPageState<Period>("period",{year,month});
  const update=(patch:Partial<Period>)=>setPeriod(prev=>({...prev,...patch}));
  return {year:period.year,month:period.month,setYear:(n:number)=>update({year:n}),setMonth:(n:number)=>update({month:n})};
}
export type ReportTarget={id:string;studentId:string;name:string;period:string;version?:number};
export const useReportTarget=()=>useReportPageState<ReportTarget|null>("workflow-target",null);
export function issuePeriod(reportPeriod:string):Period|null{
  const m=/^(\d{4})-(0[1-9]|1[0-2])/.exec(reportPeriod);
  if(!m)return null;
  const year=Number(m[1]),month=Number(m[2]);
  return month===12?{year:year+1,month:1}:{year,month:month+1};
}
export function ReportWorkflowNav({target}:{target?:ReportTarget}={}){
  const navigate=useOfficeNavigate();
  const [selected,setSelected]=useReportTarget();
  const now=new Date(),period=useReportPeriod(now.getFullYear(),now.getMonth()+1);
  const active=target??selected;
  const go=(path:string)=>{
    if(active){
      setSelected(active);
      const p=issuePeriod(active.period);
      if(p){period.setYear(p.year);period.setMonth(p.month);}
    }
    navigate(path);
  };
  return <nav aria-label="성장리포트 연속 업무" style={{display:"flex",gap:8,margin:"12px 0",flexWrap:"wrap"}}>
    {active&&<span>선택: {active.name} · {active.period} · 버전 {active.version??"상세 확인"} · ID {active.id}</span>}
    <button onClick={()=>go("/admin/growth-reports/pending")}>본문·관리자 확인</button>
    <button onClick={()=>go("/admin/growth-reports/publish")}>다음: 발급·발송 대상 확인</button>
    <button onClick={()=>go("/admin/growth-reports/published")}>발급 이력·본문</button>
    {selected&&!target&&<button onClick={()=>setSelected(null)}>대상 해제 · 전체 목록</button>}
    <small>이동만 합니다. 관리자 확인은 강사 검수나 발급·발송이 아닙니다.</small>
  </nav>;
}
