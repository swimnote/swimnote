import {transportMinute,validateRunPlan,type TransportRunPlan,type TransportStep} from "./transport";
export type TransportPlanningSettings={departureBufferMinutes:number;handoverBufferMinutes:number;durations:Record<string,number>;
  overrides:{classId:string;date:string;cancelled:boolean;start?:string;end?:string}[];
  travel:{from:string;to:string;minutes:number;evidence:string}[]};
export type TransportCandidate={studentId:string;name:string;enabled:boolean;inboundStopId:string;outboundStopId:string;handover:string;
  windows:{classId:string;start:string;end:string;source:string}[];issues:string[]};
export const emptyTransportSettings=():TransportPlanningSettings=>({departureBufferMinutes:0,handoverBufferMinutes:0,durations:{},overrides:[],travel:[]});
export const transportClock=(n:number)=>`${Math.floor(n/60).toString().padStart(2,"0")}:${(n%60).toString().padStart(2,"0")}`;
export function checkTransportWindows(plan:TransportRunPlan,items:TransportCandidate[],settings:TransportPlanningSettings){
  const issues:string[]=[];
  for(const id of new Set(plan.steps.flatMap(s=>s.studentIds))){
    const item=items.find(x=>x.studentId===id);
    if(!item?.enabled||item.issues.length||!item.windows.length){issues.push(`${id}: ${item?.issues.join(", ")||"운행일 이용·실제 수업 확인 필요"}`);continue;}
    const drop=plan.steps.find(s=>s.action==="DROP"&&s.studentIds.includes(id));
    const pickup=plan.steps.find(s=>s.action==="PICKUP"&&s.studentIds.includes(id));
    if(drop&&!item.windows.some(w=>transportMinute(w.end)+settings.departureBufferMinutes<=transportMinute(plan.steps[0].time)))
      issues.push(`${id}: 수업 종료·센터 출발 버퍼 충돌`);
    if(pickup&&!item.windows.some(w=>transportMinute(w.start)>=transportMinute(plan.steps.at(-1)!.time)+settings.handoverBufferMinutes))
      issues.push(`${id}: 센터 복귀·인계 버퍼·수업 시작 충돌`);
    if((drop&&drop.stopId!==item.outboundStopId)||(pickup&&pickup.stopId!==item.inboundStopId))issues.push(`${id}: 정기·임시 승하차 장소 불일치`);
  }
  return issues;
}
/** Bounded deterministic insertion, not a road route optimizer. Preserves existing order and every fixed time. */
export function calculateTransportDraft(input:TransportRunPlan,items:TransportCandidate[],settings:TransportPlanningSettings,
  stops:{id:string;name:string;address?:string}[],from=1){
  if(!Number.isInteger(from)||from<1||from>=input.steps.length)throw Error("변경 시작 구간을 확인하세요.");
  let plan=structuredClone(input);
  const unassigned:{studentId:string;reason:string}[]=[];
  const present=new Set(plan.steps.flatMap(s=>s.studentIds));
  const fit=(p:TransportRunPlan)=>{
    for(let i=from;i<p.steps.length;i++){
      const step=p.steps[i],previous=p.steps[i-1];
      const edge=settings.travel.find(x=>x.from===previous.stopId&&x.to===step.stopId);
      // Existing, unchanged edges retain their explicitly registered minutes.
      const original=input.steps.findIndex(s=>s.id===step.id);
      const unchanged=original>0&&input.steps[original-1].id===previous.id;
      if(step.stopId===previous.stopId)step.travelMinutes=0;
      else if(edge)step.travelMinutes=edge.minutes;
      else if(!unchanged)throw Error(`${previous.stopId}→${step.stopId}: 등록 이동시간·근거 필요`);
      const t=transportMinute(previous.time)+step.travelMinutes;
      if(t>=1440)throw Error("같은 날 운행 범위 초과");
      if(step.fixed){if(transportMinute(step.time)<t)throw Error("고정시각 충돌");}
      else step.time=transportClock(t);
    }
    p.steps[0].studentIds=p.steps.filter(s=>s.action==="DROP").flatMap(s=>s.studentIds);
    p.steps.at(-1)!.studentIds=p.steps.filter(s=>s.action==="PICKUP").flatMap(s=>s.studentIds);
    validateRunPlan(p);
    const conflicts=checkTransportWindows(p,items,settings);
    if(conflicts.length)throw Error(conflicts.join("; "));
    return p;
  };
  for(const item of [...items].filter(x=>x.enabled&&!present.has(x.studentId)).sort((a,b)=>a.studentId.localeCompare(b.studentId))){
    if(item.issues.length||!item.windows.length){unassigned.push({studentId:item.studentId,reason:item.issues.join("; ")||"수업 시각 없음"});continue;}
    const drop=item.outboundStopId&&item.windows.some(w=>transportMinute(w.end)+settings.departureBufferMinutes<=transportMinute(plan.steps[0].time));
    const action=drop?"DROP":"PICKUP",stopId=drop?item.outboundStopId:item.inboundStopId;
    const stop=stops.find(s=>s.id===stopId);
    if(!stop){unassigned.push({studentId:item.studentId,reason:"승하차 주소·정류장 보완 필요"});continue;}
    let best:TransportRunPlan|undefined,lastReason="정원·수업·고정 구간 제약";
    // Default drop-before-pickup. Existing exceptional mixed order is never reordered.
    for(let i=Math.max(1,from);i<plan.steps.length;i++){
      if(drop&&plan.steps.slice(1,i).some(s=>s.action==="PICKUP"))continue;
      const candidate=structuredClone(plan);
      const step:TransportStep={id:`auto-${action}-${item.studentId}`,action,stopId,name:stop.name,address:stop.address,time:plan.startTime,
        fixed:false,travelMinutes:0,studentIds:[item.studentId]};
      candidate.steps.splice(i,0,step);
      try{fit(candidate);if(!best||transportMinute(candidate.steps.at(-1)!.time)<transportMinute(best.steps.at(-1)!.time))best=candidate;}
      catch(e){lastReason=(e as Error).message;}
    }
    if(best){plan=best;present.add(item.studentId);}else unassigned.push({studentId:item.studentId,reason:lastReason});
  }
  const conflicts=checkTransportWindows(plan,items,settings);
  try{fit(plan);}catch(e){conflicts.push((e as Error).message);}
  return {plan,unassigned,conflicts:[...new Set(conflicts)],source:"DETERMINISTIC_CONSTRAINT_DRAFT" as const,
    complete:!unassigned.length&&!conflicts.length,applied:false as const};
}
