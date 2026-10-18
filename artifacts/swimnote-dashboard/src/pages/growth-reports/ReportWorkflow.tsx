import { useState,type Dispatch,type SetStateAction } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useOfficeNavigate } from "@/desktop/OfficeNavigation";
type Period={year:number;month:number};
const periods=new Map<string,Period>();
const pageStates=new Map<string,unknown>();
if(typeof window!=="undefined")window.addEventListener("office:session-invalid",()=>{periods.clear();pageStates.clear();});
export function useReportPageState<T>(name:string,initial:T):[T,Dispatch<SetStateAction<T>>]{
  const {state}=useAuth();
  const key=`${state.status==="authenticated"?`${state.user.id}:${state.user.swimming_pool_id}`:"anonymous"}:${name}`;
  const [value,setValue]=useState<T>(()=>pageStates.has(key)?pageStates.get(key) as T:initial);
  const update:Dispatch<SetStateAction<T>>=next=>setValue(prev=>{const n=typeof next==="function"?(next as (v:T)=>T)(prev):next;pageStates.set(key,n);return n;});
  return [value,update];
}
export function useReportPeriod(year:number,month:number){
  const {state}=useAuth();
  const key=state.status==="authenticated"?`${state.user.id}:${state.user.swimming_pool_id}`:"anonymous";
  const [period,setPeriod]=useState(()=>periods.get(key)??{year,month});
  const update=(patch:Partial<Period>)=>setPeriod(prev=>{const n={...prev,...patch};periods.set(key,n);return n;});
  periods.set(key,period);
  return {year:period.year,month:period.month,setYear:(n:number)=>update({year:n}),setMonth:(n:number)=>update({month:n})};
}
export function ReportWorkflowNav(){
  const navigate=useOfficeNavigate();
  return <nav aria-label="성장리포트 연속 업무" style={{display:"flex",gap:8,margin:"12px 0",flexWrap:"wrap"}}>
    <button onClick={()=>navigate("/admin/growth-reports/pending")}>본문·검수</button>
    <button onClick={()=>navigate("/admin/growth-reports/publish")}>다음: 발급 대상 확인</button>
    <button onClick={()=>navigate("/admin/growth-reports/published")}>발급 이력·본문</button>
    <small>선택한 연월을 유지합니다. 이동만 하며 발급·발송하지 않습니다.</small>
  </nav>;
}
