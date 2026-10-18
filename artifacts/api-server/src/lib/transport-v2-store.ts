import type {PoolClient} from "pg";
import {validateRunPlan,TransportConflict,type TransportRunPlan,type TransportEvent} from "@workspace/api-zod";
import {digest} from "./office-operations-data.js";
export const transportFail=(code:string,message:string):never=>{throw new TransportConflict(code,message);};
export type TransportIdentity={id:string;type:"users"|"parent_accounts";poolId:string;name:string;admin:boolean;key:string};
export async function reviewRun(c:PoolClient,poolId:string,input:TransportRunPlan,runId?:string){
  validateRunPlan(input);
  const plan=structuredClone(input);
  const processed=new Set(runId?(await readRunEvents(c,runId)).filter(e=>["BOARD","ALIGHT","NO_SHOW"].includes(e.kind)).map(e=>e.stepId):[]);
  const vehicle=(await c.query("SELECT data FROM office_transport_records WHERE pool_id=$1 AND id=$2 AND kind='vehicle' AND data->>'status'='active'",[poolId,plan.vehicleId])).rows[0];
  if(!vehicle||vehicle.data.capacity!==plan.capacity)transportFail("VEHICLE","현재 센터의 사용 차량·확인된 운행 정원을 다시 선택하세요.");
  const availability=(await c.query("SELECT data FROM office_transport_vehicle_availability WHERE pool_id=$1 AND vehicle_id=$2",[poolId,plan.vehicleId])).rows[0]?.data;
  const weekday=new Date(`${plan.date}T00:00:00Z`).getUTCDay()||7;
  if(!availability||!availability.weekdays.includes(weekday)||availability.start>plan.startTime||availability.end<plan.returnBy)
    transportFail("AVAILABILITY","차량에 등록된 요일·운행 가능 시간 안에서 배차하세요.");
  const crew=(await c.query(`SELECT id,duty FROM office_transport_memberships WHERE pool_id=$1 AND status='ACTIVE'
    AND id=ANY($2::text[])`,[poolId,[plan.driverId,plan.escortId].filter(Boolean)])).rows;
  if(!crew.some(x=>x.id===plan.driverId&&x.duty==="DRIVER")||(plan.escortId&&!crew.some(x=>x.id===plan.escortId&&x.duty==="ESCORT")))
    transportFail("CREW","본인이 수락한 현재 센터의 운행 전용 기사·인솔자를 배정하세요.");
  const stopIds=plan.steps.filter(s=>s.action==="DROP"||s.action==="PICKUP").map(s=>s.stopId);
  const stops=(await c.query("SELECT id,data FROM office_transport_records WHERE pool_id=$1 AND kind='stop' AND data->>'status'='active' AND id=ANY($2::text[])",[poolId,stopIds])).rows;
  for(const step of plan.steps){
    if(step.action==="DROP"||step.action==="PICKUP"){
      if(processed.has(step.id))continue;
      const stop=stops.find(x=>x.id===step.stopId);if(!stop)transportFail("STOP","현재 센터의 사용 정류장만 배정하세요.");
      step.name=stop.data.name;
      step.address=stop.data.address;
      if(stop.data.gps)step.gps=stop.data.gps;else delete step.gps;
    }else {step.stopId="CENTER";step.name=step.action==="CENTER_BOARD"?"센터 출발":"센터 복귀·인계";}
  }
  const ids=[...new Set(plan.steps.flatMap(s=>s.studentIds))];
  const students=(await c.query(`SELECT s.id,s.name FROM students s WHERE s.swimming_pool_id=$1 AND s.status='active'
    AND s.id=ANY($2::text[]) AND (
      EXISTS(SELECT 1 FROM student_class_history h WHERE h.student_id=s.id AND h.swimming_pool_id=$1
        AND h.enrolled_at::date<=$3::date AND (h.left_at IS NULL OR h.left_at::date>$3::date))
      OR EXISTS(SELECT 1 FROM makeup_sessions m WHERE m.student_id=s.id AND m.swimming_pool_id=$1
        AND m.assigned_date=$3 AND m.assigned_class_group_id IS NOT NULL AND m.cancelled_at IS NULL
        AND m.status NOT IN ('cancelled','expired','extinguished'))
    )`,[poolId,ids,plan.date])).rows;
  if(students.length!==ids.length)transportFail("STUDENT","운행일의 센터 수강 이력·보강 배정이 확인되는 회원만 배정하세요.");
  const absence=(await c.query(`SELECT DISTINCT a.student_id FROM attendance a
    JOIN users u ON u.id=COALESCE(a.modified_by,a.created_by) AND u.swimming_pool_id=a.swimming_pool_id
    WHERE a.swimming_pool_id=$1 AND a.date=$2 AND a.status='absent' AND a.student_id=ANY($3::text[])`,[poolId,plan.date,ids])).rows;
  // An operator-recorded absence must be reconciled, not silently reclassified as safe/no-show.
  if(absence.length)transportFail("ABSENCE_REVIEW","운영자 기록 결석과 배차가 충돌합니다. 결석·임시 이용을 원 업무에서 대조한 뒤 다시 검수하세요.");
  const others=(await c.query(`SELECT id,plan FROM office_transport_runs WHERE pool_id=$1 AND id<>$2
    AND plan->>'date'=$3 AND status IN ('APPROVED','PUBLISHED','ACTIVE')`,[poolId,runId??"",plan.date])).rows;
  for(const row of others){
    const p=row.plan as TransportRunPlan;
    if(plan.returnBy<p.startTime||p.returnBy<plan.startTime)continue;
    if(p.vehicleId===plan.vehicleId||[p.driverId,p.escortId].filter(Boolean).some(x=>[plan.driverId,plan.escortId].includes(x))||
      p.steps.some(s=>s.studentIds.some(id=>ids.includes(id))))transportFail("OVERLAP","같은 날짜·시간에 차량·운행 담당자·회원이 겹칩니다.");
  }
  return {plan,students,hash:digest(plan),timingSource:"ADMIN_REGISTERED_MINUTES_NOT_ROAD_ETA"};
}
export async function readRunEvents(c:PoolClient,runId:string):Promise<TransportEvent[]>{
  const rows=(await c.query("SELECT payload,actor,server_at FROM office_transport_events WHERE run_id=$1 ORDER BY seq",[runId])).rows;
  return rows.map(x=>({...x.payload,actor:x.actor,serverAt:new Date(x.server_at).toISOString()}));
}
export async function transportContacts(c:PoolClient,poolId:string,plan:TransportRunPlan){
  return (await c.query(`SELECT id,name,parent_phone,parent_phone2,parent_phone3,parent_phone4 FROM students
    WHERE swimming_pool_id=$1 AND id=ANY($2::text[])`,[poolId,[...new Set(plan.steps.flatMap(s=>s.studentIds))]])).rows;
}
