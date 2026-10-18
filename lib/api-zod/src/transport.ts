/** One transport contract for OFFICE, the driver card and parent projections. No network/model/device dependencies. */
export type TransportGps={latitude:number;longitude:number;radiusMeters:number;dwellSeconds:number;verified:true};
export type TransportStep = {
  id:string; action:"CENTER_BOARD"|"DROP"|"PICKUP"|"CENTER_HANDOVER";
  stopId:string; name:string; address?:string; gps?:TransportGps; time:string; travelMinutes:number; fixed:boolean; studentIds:string[];
};
export type TransportRunPlan = {
  name:string; date:string; vehicleId:string; driverId:string; escortId:string;
  capacity:number; startTime:string; returnBy:string; steps:TransportStep[];
};
export type TransportEventKind = "ACK"|"START"|"BOARD"|"ALIGHT"|"NO_SHOW"|"CORRECT"|"FINISH";
export type TransportCommand = {
  requestId:string; revision:number; kind:TransportEventKind; deviceAt:string;
  stepId?:string; studentIds?:string[]; corrects?:string; reason?:string; cabinChecked?:boolean;centerReturned?:boolean;
};
export type TransportEvent = TransportCommand & {actor:string; serverAt:string};
export class TransportConflict extends Error {
  constructor(public code:string,message:string){super(message);}
}
function fail(code:string,message:string):never{throw new TransportConflict(code,message);}
export function validateTransportGps(g:TransportGps){
  if(!g||Object.keys(g).some(k=>!["latitude","longitude","radiusMeters","dwellSeconds","verified"].includes(k))||
    ![g.latitude,g.longitude,g.radiusMeters,g.dwellSeconds].every(Number.isFinite)||Math.abs(g.latitude)>90||Math.abs(g.longitude)>180||
    g.radiusMeters<=0||g.radiusMeters>10000||!Number.isInteger(g.dwellSeconds)||g.dwellSeconds<0||g.dwellSeconds>3600||g.verified!==true)
    fail("GPS_PROFILE","좌표·접근 반경·머무름 값을 현장에서 확인한 뒤 등록하세요. 공통 기본값으로 추정하지 않습니다.");
  return g;
}
/** Only an active driver's local foreground hint. Coordinates are never uploaded or an attendance event. */
export function transportApproach(g:TransportGps|undefined,p:{latitude:number;longitude:number;accuracy:number|null;timestamp:number},since:number|null,now:number){
  const outside={since:null as number|null,near:false};
  if(!g||!Number.isFinite(p.timestamp)||now-p.timestamp>30000||p.timestamp>now+5000||p.accuracy===null||!Number.isFinite(p.accuracy)||p.accuracy<0||p.accuracy>g.radiusMeters)return outside;
  validateTransportGps(g);
  if(![p.latitude,p.longitude].every(Number.isFinite)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180)return outside;
  const rad=(x:number)=>x*Math.PI/180,dlat=rad(g.latitude-p.latitude),dlon=rad(g.longitude-p.longitude);
  const h=Math.sin(dlat/2)**2+Math.cos(rad(g.latitude))*Math.cos(rad(p.latitude))*Math.sin(dlon/2)**2;
  if(6371000*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))))>g.radiusMeters)return outside;
  const entered=since===null||since>now?now:since;
  return {since:entered,near:now-entered>=g.dwellSeconds*1000};
}
export const transportMinute=(s:string)=>{
  if(typeof s!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))return fail("TIME","같은 날 HH:MM 시각을 확인하세요.");
  return Number(s.slice(0,2))*60+Number(s.slice(3));
};
export function validateRunPlan(p:TransportRunPlan){
  if(!p||typeof p.name!=="string"||!p.name.trim()||p.name.length>100||
    typeof p.date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(`${p.date}T00:00:00Z`))||new Date(`${p.date}T00:00:00Z`).toISOString().slice(0,10)!==p.date)
    fail("PLAN","운행 이름·유효한 날짜를 확인하세요.");
  for(const id of [p.vehicleId,p.driverId])if(typeof id!=="string"||!id||id.length>160)fail("PLAN","차량·운행 전용 기사 배정이 필요합니다.");
  if(typeof p.escortId!=="string"||p.escortId.length>160||p.escortId===p.driverId)fail("PLAN","기사와 인솔자 배정을 구분하세요.");
  if(!Number.isSafeInteger(p.capacity)||p.capacity<1||p.capacity>60)fail("CAPACITY","확인된 차량 운행 정원을 입력하세요.");
  if(!Array.isArray(p.steps)||p.steps.length<3||p.steps.length>102)fail("STEPS","센터 출발·정류장·센터 복귀를 확인하세요.");
  if(p.steps[0].action!=="CENTER_BOARD"||p.steps[p.steps.length-1].action!=="CENTER_HANDOVER")fail("CENTER","센터 출발과 복귀 인계를 보존하세요.");
  let previous=transportMinute(p.startTime),load=0;
  const ids=new Set<string>(),drop=new Set<string>(),pickup=new Set<string>();
  for(let i=0;i<p.steps.length;i++){
    const s=p.steps[i];
    if(!s||typeof s.id!=="string"||!s.id||s.id.length>160||ids.has(s.id)||!["CENTER_BOARD","DROP","PICKUP","CENTER_HANDOVER"].includes(s.action))
      fail("STEP","정류장 ID·승하차 구분을 확인하세요.");
    ids.add(s.id);
    if(s.gps!==undefined)validateTransportGps(s.gps);
    if((i>0&&s.action==="CENTER_BOARD")||(i<p.steps.length-1&&s.action==="CENTER_HANDOVER"))fail("CENTER","센터 단계는 출발·복귀에만 사용하세요.");
    if(typeof s.stopId!=="string"||s.stopId.length>160||typeof s.name!=="string"||!s.name||s.name.length>150||typeof s.fixed!=="boolean"||
      !Number.isSafeInteger(s.travelMinutes)||s.travelMinutes<0||s.travelMinutes>240)fail("STEP","등록 정류장·고정 여부·관리자 이동시간을 확인하세요.");
    const minute=transportMinute(s.time);
    if(minute<previous+(i?s.travelMinutes:0))fail("TIME","정류장 순서와 등록 이동시간이 충돌합니다.");
    previous=minute;
    if(!Array.isArray(s.studentIds)||s.studentIds.length>60||new Set(s.studentIds).size!==s.studentIds.length||
      s.studentIds.some(x=>typeof x!=="string"||!x||x.length>160))fail("STUDENTS","정류장별 회원 ID와 중복을 확인하세요.");
    if((s.action==="DROP"||s.action==="PICKUP")&&!s.studentIds.length)fail("STUDENTS","대상 없는 정류장을 제거하세요.");
    for(const id of s.studentIds){
      const set=s.action==="DROP"?drop:s.action==="PICKUP"?pickup:null;
      if(set?.has(id))fail("DUPLICATE","같은 방향의 회원을 중복 배정할 수 없습니다.");
      set?.add(id);
    }
    load+=(s.action==="CENTER_BOARD"||s.action==="PICKUP")?s.studentIds.length:-s.studentIds.length;
    if(load<0||load>p.capacity)fail("CAPACITY","구간별 탑승 인원·정원이 충돌합니다.");
  }
  const equal=(xs:string[],ys:Set<string>)=>xs.length===ys.size&&xs.every(x=>ys.has(x));
  if(!equal(p.steps[0].studentIds,drop)||!equal(p.steps[p.steps.length-1].studentIds,pickup)||load!==0)
    fail("CENTER","귀가 회원의 센터 출발·하차, 등원 회원의 승차·센터 인계를 연결하세요.");
  if([...pickup].some(x=>drop.has(x)))fail("DUPLICATE","한 운행에서 같은 회원의 등원·귀가 중복을 확인하세요.");
  if(previous>transportMinute(p.returnBy))fail("ARRIVAL","센터 복귀·수업 도착 제한 시각을 넘었습니다.");
  return p;
}
/** Explicit correction voids only the last confirmation; the original remains in the event log. */
export function transportState(plan:TransportRunPlan,events:TransportEvent[]){
  const voided=new Set(events.filter(e=>e.kind==="CORRECT").map(e=>e.corrects));
  const confirmations=events.filter(e=>!voided.has(e.requestId)&&["BOARD","ALIGHT","NO_SHOW"].includes(e.kind));
  const children:Record<string,{status:"WAITING"|"ONBOARD"|"HANDED_OVER"|"NO_SHOW";event?:TransportEvent}>=Object.create(null);
  for(const s of plan.steps)for(const id of s.studentIds)children[id]??={status:"WAITING"};
  for(const e of confirmations)for(const id of e.studentIds??[]){
    children[id]={status:e.kind==="BOARD"?"ONBOARD":e.kind==="ALIGHT"?"HANDED_OVER":"NO_SHOW",event:e};
  }
  const pending=plan.steps.filter(s=>s.studentIds.some(id=>{
    if(children[id]?.status==="NO_SHOW")return false;
    return !confirmations.some(e=>e.stepId===s.id&&e.studentIds?.includes(id));
  })).map(s=>s.id);
  return {children,pending,onboard:Object.keys(children).filter(x=>children[x].status==="ONBOARD"),
    started:events.some(e=>e.kind==="START"),closed:events.some(e=>e.kind==="FINISH"),
    lastServerAt:events[events.length-1]?.serverAt??null};
}
export function checkTransportCommand(plan:TransportRunPlan,events:TransportEvent[],c:TransportCommand,actor:string,revision:number){
  if(!c||typeof c.requestId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.requestId)||
    typeof c.deviceAt!=="string"||!Number.isFinite(Date.parse(c.deviceAt))||!Number.isSafeInteger(c.revision))
    fail("COMMAND","요청 ID·버전·기기 확인 시각을 확인하세요.");
  if(c.revision!==revision)fail("VERSION_CHANGED","운행 게시 버전이 바뀌었습니다. 대기 기록을 지우지 말고 동기화·대조하세요.");
  const state=transportState(plan,events);
  if(state.closed)fail("CLOSED","이미 종료한 운행입니다.");
  if(c.kind==="ACK"){
    if(events.some(e=>e.kind==="ACK"&&e.actor===actor&&e.revision===revision))fail("ALREADY_ACKNOWLEDGED","이미 이 게시 버전을 수신 확인했습니다.");
    return;
  }
  if(!events.some(e=>e.kind==="ACK"&&e.actor===actor&&e.revision===revision))fail("ACK_REQUIRED","현재 게시 버전을 먼저 수신 확인하세요.");
  if(c.kind==="START"){if(state.started)fail("STARTED","이미 시작한 운행입니다.");return;}
  if(!state.started)fail("START_REQUIRED","운행 시작을 먼저 확인하세요.");
  if(c.kind==="FINISH"){
    if(state.pending.length||state.onboard.length||c.cabinChecked!==true||c.centerReturned!==true)fail("SAFETY","센터 복귀·인계와 미처리·미하차를 해결하고 차량 내부 최종 확인 후 종료하세요.");
    return;
  }
  if(c.kind==="CORRECT"){
    const last=events.filter(e=>["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)&&!events.some(v=>v.corrects===e.requestId)).slice(-1)[0];
    if(!last||last.requestId!==c.corrects||last.actor!==actor||typeof c.reason!=="string"||!c.reason.trim()||c.reason.length>500)
      fail("CORRECTION","본인이 마지막으로 확인한 기록과 정정 사유를 확인하세요.");
    return;
  }
  if(!["BOARD","ALIGHT","NO_SHOW"].includes(c.kind))fail("COMMAND","지원하지 않는 운행 동작입니다.");
  const step=plan.steps.find(s=>s.id===c.stepId);
  if(!step||!Array.isArray(c.studentIds)||!c.studentIds.length||new Set(c.studentIds).size!==c.studentIds.length||
    c.studentIds.some(id=>!step.studentIds.includes(id)))fail("TARGET","현재 운행·정류장의 회원을 다시 확인하세요.");
  const board=step.action==="PICKUP"||step.action==="CENTER_BOARD";
  if((c.kind==="BOARD"||c.kind==="NO_SHOW")?!board:board)fail("ACTION","승차·하차 정류장에 맞는 동작을 선택하세요.");
  for(const id of c.studentIds!){
    const child=state.children[id];
    const done=events.some(e=>!events.some(v=>v.corrects===e.requestId)&&e.stepId===step.id&&e.studentIds?.includes(id)&&["BOARD","ALIGHT","NO_SHOW"].includes(e.kind));
    if(done)fail("ALREADY_CONFIRMED","이미 확인한 회원입니다. 중복 처리 대신 원기록을 확인하세요.");
    if(c.kind==="ALIGHT"&&child?.status!=="ONBOARD")fail("NOT_ONBOARD","실제 승차 확인이 없는 회원의 하차를 기록할 수 없습니다.");
    if(c.kind!=="ALIGHT"&&child?.status!=="WAITING")fail("ALREADY_CONFIRMED","회원의 현재 탑승 상태를 확인하세요.");
  }
  if(c.kind==="BOARD"&&state.onboard.length+c.studentIds!.length>plan.capacity)fail("CAPACITY","현재 탑승 인원이 운행 정원을 넘습니다.");
}
export function nextTransportStep(plan:TransportRunPlan,pending:string[],selected:string){
  const index=plan.steps.findIndex(s=>s.id===selected);
  return plan.steps.slice(index+1).find(s=>pending.includes(s.id))?.id??plan.steps.find(s=>pending.includes(s.id))?.id??null;
}
/** A single foreground hint; never changes selection and never produces attendance events. */
export function transportHint(plan:TransportRunPlan,pending:string[],seen:string[],revision:number,nowMinute:number,nearStepId?:string,runId?:string){
  const s=plan.steps.find(s=>pending.includes(s.id));
  if(!s||s.action==="CENTER_BOARD"||s.action==="CENTER_HANDOVER")return null;
  const key=`${runId?`${runId}:`:""}${revision}:${s.id}`;
  if(seen.includes(key))return null;
  return nearStepId===s.id||nowMinute>=transportMinute(s.time)?{key,stepId:s.id,reason:nearStepId===s.id?"GPS_APPROACH":"SCHEDULE_TIME"}:null;
}
export function recalculateTransport(plan:TransportRunPlan,from:number){
  if(!Number.isInteger(from)||from<1||from>=plan.steps.length)fail("RECALCULATE","재계산 시작 구간을 선택하세요.");
  const copy=structuredClone(plan);
  for(let i=from;i<copy.steps.length;i++){
    const s=copy.steps[i],t=transportMinute(copy.steps[i-1].time)+s.travelMinutes;
    if(t>=1440)fail("TIME","날짜를 넘는 운행은 분리하세요.");
    if(s.fixed){if(transportMinute(s.time)<t)fail("ANCHOR","고정 시각을 유지할 수 없습니다. 제약을 임의 해제하지 않습니다.");}
    else s.time=`${Math.floor(t/60).toString().padStart(2,"0")}:${(t%60).toString().padStart(2,"0")}`;
  }
  validateRunPlan(copy);
  return {plan:copy,source:"REGISTERED_MINUTES_NOT_AI" as const};
}
