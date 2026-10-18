import {OperationError,object,text} from "./office-operations-data.js";
import {validateTransportGps,type TransportGps} from "@workspace/api-zod";
export type TransportKind="vehicle"|"stop"|"plan";
export type TransportRecord={id:string;kind:TransportKind;data:Record<string,any>;revision:number};
const reject=(message:string):never=>{throw new OperationError(400,"TRANSPORT_REVIEW_REQUIRED",message);};
const integer=(v:unknown,min:number,max:number,label:string)=>{
  if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)return reject(`${label} 범위를 확인하세요.`);
  return v as number;
};
const time=(v:unknown)=>{
  if(typeof v!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return reject("시각은 같은 날의 HH:MM 형식이어야 합니다.");
  return Number(v.slice(0,2))*60+Number(v.slice(3));
};
function keys(d:Record<string,any>,allowed:string[]){
  if(Object.keys(d).some(k=>!allowed.includes(k)))reject("지원하지 않는 배차 필드가 있습니다.");
}
export function transportData(kind:TransportKind,raw:unknown){
  const d=object(raw);
  if(kind==="vehicle"){
    keys(d,["name","plate","capacity","driverId","status"]);
    return {name:text(d.name,"차량 이름",100),plate:text(d.plate,"차량번호",30),
      capacity:integer(d.capacity,1,60,"정원"),driverId:d.driverId?text(d.driverId,"기사",160):"",
      status:status(d.status)};
  }
  if(kind==="stop"){
    keys(d,["name","address","status","gps"]);
    let gps:TransportGps|undefined;
    if(d.gps!=null){try{gps=validateTransportGps(d.gps);}catch(e:any){return reject(e.message);}}
    return {name:text(d.name,"승차지 이름",100),address:text(d.address,"승차지 주소·위치 안내",500),status:status(d.status),...(gps?{gps}:{})};
  }
  if(kind!=="plan")return reject("차량·승차지·정기 배차만 지원합니다.");
  keys(d,["name","weekday","direction","vehicleId","classGroupId","classTime","earliestTime","bufferMinutes","toCenterMinutes","stops","sourceSnapshotId"]);
  if(!["INBOUND","OUTBOUND"].includes(d.direction))reject("등원·하원 방향을 선택하세요.");
  const result={name:text(d.name,"배차 이름",100),weekday:integer(d.weekday,1,7,"요일"),
    direction:d.direction as "INBOUND"|"OUTBOUND",vehicleId:text(d.vehicleId,"차량",160),
    classGroupId:text(d.classGroupId,"반",160),classTime:d.classTime as string,earliestTime:d.earliestTime as string,
    bufferMinutes:integer(d.bufferMinutes,0,120,"센터 여유시간"),toCenterMinutes:integer(d.toCenterMinutes,0,240,"센터 이동시간"),
    sourceSnapshotId:d.sourceSnapshotId?text(d.sourceSnapshotId,"재사용 원본",160):"",
    stops:[] as Array<{stopId:string;time:string;travelMinutes:number;fixed:boolean;studentIds:string[]}>};
  time(result.classTime);time(result.earliestTime);
  if(!Array.isArray(d.stops)||d.stops.length<1||d.stops.length>100)reject("승차지를 1~100개 입력하세요.");
  const stops=new Set<string>(),students=new Set<string>();
  for(const value of d.stops){
    const s=object(value);keys(s,["stopId","time","travelMinutes","fixed","studentIds"]);
    const stopId=text(s.stopId,"승차지",160);time(s.time);
    if(stops.has(stopId))reject("같은 승차지를 중복 배정할 수 없습니다.");stops.add(stopId);
    if(typeof s.fixed!=="boolean")reject("고정 시간 여부를 확인하세요.");
    if(!Array.isArray(s.studentIds)||!s.studentIds.length||s.studentIds.length>60)reject("승차지별 회원을 1~60명 선택하세요.");
    const studentIds=s.studentIds.map((id:unknown)=>{
      const v=text(id,"회원 ID",160);if(students.has(v))reject("한 운행의 같은 회원을 중복 배정할 수 없습니다.");students.add(v);return v;
    });
    result.stops.push({stopId,time:s.time,travelMinutes:integer(s.travelMinutes,0,240,"직접 확인한 이동시간"),fixed:s.fixed,studentIds});
  }
  if(result.direction==="INBOUND"&&result.stops[0].travelMinutes!==0)reject("등원 첫 승차지의 이전 이동시간은 0으로 입력하세요. 첫 승차 전 도로시간은 검증하지 않습니다.");
  return result;
}
function status(v:unknown){
  if(v!=="active"&&v!=="inactive")return reject("사용·중지 상태를 확인하세요.");
  return v as "active"|"inactive";
}
export function preserveTransportAnchors(previous:Record<string,any>|undefined,next:Record<string,any>){
  for(const old of previous?.stops??[]){
    if(!old.fixed)continue;
    const row=next.stops.find((s:any)=>s.stopId===old.stopId);
    if(!row||row.time!==old.time)reject("기존 고정 승차지는 같은 시각으로 보존하세요. 변경하려면 먼저 고정을 명시적으로 해제해 저장하세요.");
  }
}
/** Feasibility only, using administrator-supplied travel minutes. No road ETA, GPS or solver claim. */
export function reviewTransportPlan(plan:Record<string,any>,records:TransportRecord[],students:Array<{id:string;name:string}>){
  const vehicle=records.find(r=>r.id===plan.vehicleId&&r.kind==="vehicle"&&r.data.status==="active");
  if(!vehicle)return reject("현재 센터의 사용 중 차량을 다시 선택하세요.");
  if(!vehicle.data.driverId)reject("확정 전에 차량의 기사 담당자를 지정하세요.");
  const ids=plan.stops.flatMap((s:any)=>s.studentIds);
  if(ids.length>vehicle.data.capacity)reject("차량 정원을 초과했습니다. 제약을 자동 해제하지 않습니다.");
  let previous=plan.direction==="OUTBOUND"
    ?Math.max(time(plan.earliestTime),time(plan.classTime)+plan.bufferMinutes):time(plan.earliestTime);
  const stops=plan.stops.map((s:any,index:number)=>{
    const stop=records.find(r=>r.id===s.stopId&&r.kind==="stop"&&r.data.status==="active");
    if(!stop)reject("현재 센터의 사용 중 승차지만 배정할 수 있습니다.");
    const minimum=previous+(index===0&&plan.direction==="INBOUND"?0:s.travelMinutes);
    if(time(s.time)<minimum)reject("승차 순서·직접 입력한 이동시간·최소 시작시각이 충돌합니다.");
    previous=time(s.time);
    const members=s.studentIds.map((id:string)=>{
      const member=students.find(v=>v.id===id);if(!member)reject("현재 센터의 유효한 회원만 배정할 수 있습니다.");
      return {id:member!.id,name:member!.name};
    });
    return {...s,name:stop!.data.name,address:stop!.data.address,students:members};
  });
  if(plan.direction==="INBOUND"&&previous+plan.toCenterMinutes+plan.bufferMinutes>time(plan.classTime))
    reject("수업 전 센터 도착 여유시간을 충족하지 못합니다.");
  return {plan,vehicle:{id:vehicle.id,name:vehicle.data.name,plate:vehicle.data.plate,capacity:vehicle.data.capacity,driverId:vehicle.data.driverId,status:vehicle.data.status},stops,studentCount:ids.length,
    timingSource:"administrator_registered_minutes",navigation:false,driverDelivery:"NOT_IMPLEMENTED",
    reviewedConstraints:["capacity","unique-students","stop-order","registered-travel-minutes","class-time-buffer"]};
}
export function transportWindow(plan:Record<string,any>){
  return {start:plan.direction==="INBOUND"?time(plan.stops[0].time):Math.max(time(plan.earliestTime),time(plan.classTime)+plan.bufferMinutes),
    end:time(plan.stops.at(-1).time)+(plan.direction==="INBOUND"?plan.toCenterMinutes:0)};
}
export function rejectTransportOverlap(snapshot:Record<string,any>,others:Array<{snapshot:Record<string,any>}>){
  const a=transportWindow(snapshot.plan),members=new Set(snapshot.plan.stops.flatMap((s:any)=>s.studentIds));
  for(const row of others){
    const other=row.snapshot;
    if(other.plan.weekday!==snapshot.plan.weekday)continue;
    const b=transportWindow(other.plan);
    if(a.start>b.end||b.start>a.end)continue;
    if(other.vehicle.id===snapshot.vehicle.id||other.driver.id===snapshot.driver.id||
      other.plan.stops.some((s:any)=>s.studentIds.some((id:string)=>members.has(id))))
      reject("같은 요일·시간의 확정 배차와 차량·기사·회원 배정이 겹칩니다. 기존 배차를 명시적으로 수정하세요.");
  }
}
